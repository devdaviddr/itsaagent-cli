import { Box, useApp, useInput } from "ink";
import { useEffect, useReducer, useRef, useState } from "react";
import type { AgentRuntime } from "../../agent/AgentRuntime.js";
import type { AgentDefinition } from "../../agent/AgentDefinition.js";
import { getDefaultTools } from "../../tools/index.js";
import { loadConfig, saveConfig } from "../config.js";
import { parseChatInput, matchCommands, CHAT_HELP } from "../chatCommands.js";
import {
  conversationReducer,
  initialConversation,
} from "./state/conversation.js";
import { resolveTheme, themeNames } from "./theme.js";
import { useAgentEvents } from "./hooks/useAgentEvents.js";
import { Header } from "./layout/Header.js";
import { MessageLog } from "./layout/MessageLog.js";
import { InputBox } from "./layout/InputBox.js";
import { StatusLine } from "./layout/StatusLine.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { entryHeight, windowEntries } from "./layout/viewport.js";
import type { TuiMode } from "./layout/chrome.js";

export interface AppAgentInfo {
  id: string;
  description: string;
  builtin: boolean;
}

interface AppProps {
  runtime: AgentRuntime;
  agents: AppAgentInfo[];
  resolveAgent: (name: string) => AgentDefinition | undefined;
  seedTask?: string;
  providerOk: boolean;
  themeName?: string;
}

function termDims(): { rows: number; cols: number } {
  return { rows: process.stdout.rows || 24, cols: process.stdout.columns || 80 };
}

/**
 * The persistent TUI: header, scrollable log, fixed input, status line. Owns one
 * AgentRuntime for the whole session — turns preserve context via continueChat().
 */
export function App({ runtime, agents, resolveAgent, seedTask, providerOk, themeName: initialThemeName }: AppProps) {
  const { exit } = useApp();

  const [conv, dispatch] = useReducer(conversationReducer, undefined, initialConversation);
  const [mode, setMode] = useState<"idle" | "running">("idle");
  const [usage, setUsage] = useState<{ used: number; max: number; ratio: number } | null>(null);
  const [agentId, setAgentId] = useState(runtime.agentId);
  const [model, setModel] = useState(runtime.model);
  const [themeName, setThemeName] = useState(initialThemeName);
  const [value, setValue] = useState("");
  const [selectedToolId, setSelectedToolId] = useState<number | null>(null);
  const [dims, setDims] = useState(termDims());
  const firstRef = useRef(true);

  const theme = resolveTheme(themeName);

  useEffect(() => {
    const onResize = (): void => setDims(termDims());
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);

  useAgentEvents(runtime, dispatch, {
    onUsage: setUsage,
    onIdle: () => setMode("idle"),
  });

  function runTurn(text: string): void {
    const cont = !firstRef.current;
    firstRef.current = false;
    dispatch({ type: "user", text });
    dispatch({ type: "scrollToTail" });
    setMode("running");
    const p = cont ? runtime.continueChat(text) : runtime.run(text);
    p.catch((err: unknown) => {
      dispatch({ type: "error", text: err instanceof Error ? err.message : String(err) });
      setMode("idle");
    });
  }

  async function handleSubmit(raw: string): Promise<void> {
    setValue("");
    if (!raw.trim()) return;
    const cmd = parseChatInput(raw);
    switch (cmd.kind) {
      case "message":
        runTurn(cmd.text);
        return;
      case "exit":
        exit();
        return;
      case "clear":
        runtime.initSession();
        firstRef.current = true;
        dispatch({ type: "notice", text: "Context cleared." });
        return;
      case "help":
        dispatch({ type: "notice", text: CHAT_HELP });
        return;
      case "agents":
        dispatch({
          type: "notice",
          text: agents
            .map((a) => `  ${a.id}${a.builtin ? "" : " [custom]"} — ${a.description}`)
            .join("\n"),
        });
        return;
      case "agent": {
        const def = resolveAgent(cmd.name);
        if (!def) {
          dispatch({ type: "error", text: `Unknown agent "${cmd.name}". Try /agents.` });
          return;
        }
        runtime.setAgent(def);
        runtime.initSession();
        firstRef.current = true;
        setAgentId(def.id);
        dispatch({ type: "notice", text: `Switched to ${def.id} — context cleared.` });
        return;
      }
      case "model": {
        const { ok, models } = await runtime.checkProvider();
        if (!ok) {
          dispatch({ type: "error", text: "Provider unreachable." });
          return;
        }
        if (!models.some((m) => m.name === cmd.name)) {
          dispatch({
            type: "error",
            text: `Unknown model "${cmd.name}". Available: ${models.map((m) => m.name).join(", ")}`,
          });
          return;
        }
        runtime.setModel(cmd.name);
        const conf = await loadConfig();
        await saveConfig({ ...conf, model: cmd.name });
        setModel(cmd.name);
        dispatch({ type: "notice", text: `Model switched to ${cmd.name}.` });
        return;
      }
      case "models": {
        const { ok, models } = await runtime.checkProvider();
        if (!ok) {
          dispatch({ type: "error", text: "Provider unreachable." });
          return;
        }
        dispatch({ type: "notice", text: `Models:\n${models.map((m) => `  ${m.name}`).join("\n")}` });
        return;
      }
      case "theme": {
        const names = themeNames();
        if (!names.includes(cmd.name)) {
          dispatch({
            type: "error",
            text: `Unknown theme "${cmd.name}". Available: ${names.join(", ")}`,
          });
          return;
        }
        const conf = await loadConfig();
        await saveConfig({ ...conf, theme: cmd.name });
        setThemeName(cmd.name);
        dispatch({ type: "notice", text: `Theme switched to ${cmd.name}.` });
        return;
      }
      case "tools": {
        const list = getDefaultTools()
          .map((t) => `  ${t.definition.name} — ${t.definition.description}`)
          .join("\n");
        dispatch({ type: "notice", text: `Tools:\n${list}` });
        return;
      }
      case "unknown":
        dispatch({ type: "error", text: `Unknown command "/${cmd.cmd}". Try /help.` });
        return;
    }
  }

  const contentWidth = Math.max(20, dims.cols - 2);
  const logRows = Math.max(3, dims.rows - 5);
  const heights = conv.entries.map((e) => entryHeight(e, contentWidth));
  const win = windowEntries(heights, logRows, conv.scrollOffset);
  const visible = conv.entries.slice(win.startIndex, win.endIndex);

  const matches = matchCommands(value);
  const toolIds = conv.entries.filter((e) => e.kind === "tool").map((e) => e.id);
  const selected = selectedToolId ?? (toolIds.length > 0 ? toolIds[toolIds.length - 1] : null);

  function moveSelection(dir: -1 | 1): void {
    if (toolIds.length === 0) return;
    const cur = selected ?? toolIds[toolIds.length - 1];
    const idx = Math.min(toolIds.length - 1, Math.max(0, toolIds.indexOf(cur) + dir));
    setSelectedToolId(toolIds[idx]);
  }

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    // Tab completes the highlighted slash command.
    if (key.tab && matches.length > 0) {
      const top = matches[0];
      setValue(`/${top.name}${top.arg ? " " : ""}`);
      return;
    }
    // Ctrl+R expands or collapses every tool block at once.
    if (key.ctrl && input === "r") {
      const anyCollapsed = conv.entries.some((e) => e.kind === "tool" && !e.expanded);
      dispatch({ type: "toggleExpandAll", expanded: anyCollapsed });
      return;
    }
    if (key.pageUp) {
      dispatch({ type: "scrollUp", lines: logRows });
      return;
    }
    if (key.pageDown) {
      dispatch({ type: "scrollDown", lines: logRows });
      return;
    }
    if (key.escape) {
      dispatch({ type: "scrollToTail" });
      return;
    }
    // When the input line is empty, the arrow/enter keys drive tool-block focus
    // instead of text editing (the text field has nothing to act on).
    if (value === "") {
      if (key.upArrow) {
        moveSelection(-1);
        return;
      }
      if (key.downArrow) {
        moveSelection(1);
        return;
      }
      if (key.return && selected !== null) {
        dispatch({ type: "toggleExpand", id: selected });
        return;
      }
    }
  });

  const lastIsError =
    conv.entries.length > 0 && conv.entries[conv.entries.length - 1].kind === "error";
  const tuiMode: TuiMode =
    mode === "running" ? "running" : !conv.following ? "scrolled" : lastIsError ? "error" : "idle";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header theme={theme} agent={agentId} model={model} usage={usage} providerOk={providerOk} />
      <MessageLog
        visible={visible}
        theme={theme}
        width={contentWidth}
        live={mode === "running" && conv.following ? conv.live : ""}
        focusedToolId={selected}
      />
      {mode !== "running" ? <CommandPalette matches={matches} theme={theme} /> : null}
      <InputBox
        theme={theme}
        prompt={`${agentId} ›`}
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        running={mode === "running"}
      />
      <StatusLine theme={theme} mode={tuiMode} hiddenAbove={win.hiddenAbove} />
    </Box>
  );
}

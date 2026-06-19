import { Box, useApp, useInput } from "ink";
import { useEffect, useReducer, useRef, useState } from "react";
import type { AgentRuntime } from "../../agent/AgentRuntime.js";
import type { AgentDefinition } from "../../agent/AgentDefinition.js";
import { getDefaultTools } from "../../tools/index.js";
import { loadConfig, saveConfig } from "../config.js";
import { parseChatInput, matchCommands, CHAT_HELP, type CommandMeta, type ChatCommand } from "../chatCommands.js";
import {
  conversationReducer,
  initialConversation,
} from "./state/conversation.js";
import { basename } from "node:path";
import { VERSION } from "../../version.js";
import { aboutText } from "./about.js";
import { resolveTheme, themeNames } from "./theme.js";
import { useAgentEvents } from "./hooks/useAgentEvents.js";
import { MessageLog } from "./layout/MessageLog.js";
import { InputBox } from "./layout/InputBox.js";
import { StatusLine } from "./layout/StatusLine.js";
import { Banner } from "./components/Banner.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { SelectModal } from "./components/SelectModal.js";
import { filterItems, clampIndex, type SelectItem } from "./components/select.js";
import { entryHeight, windowEntries } from "./layout/viewport.js";
import type { TuiMode } from "./layout/chrome.js";

export interface AppAgentInfo {
  id: string;
  description: string;
  builtin: boolean;
}

type ModalKind = "agent" | "model" | "theme";
interface ModalState {
  kind: ModalKind;
  title: string;
  items: SelectItem[];
  query: string;
  index: number;
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
 * The persistent TUI: centered home/log, a fixed input panel with a navigable
 * slash-command palette, and floating select modals for agent/model/theme. Owns
 * one AgentRuntime for the whole session — turns preserve context via continueChat().
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
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [selectedToolId, setSelectedToolId] = useState<number | null>(null);
  const [dims, setDims] = useState(termDims());
  const firstRef = useRef(true);
  /** True once the in-flight run has been asked to cancel — a second Ctrl+C then quits. */
  const cancelArmedRef = useRef(false);

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

  useEffect(() => {
    runtime.initSession();
    if (seedTask && seedTask.trim()) runTurn(seedTask.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onChangeValue(v: string): void {
    setValue(v);
    setPaletteIndex(0);
  }

  function runTurn(text: string): void {
    const cont = !firstRef.current;
    firstRef.current = false;
    cancelArmedRef.current = false;
    dispatch({ type: "user", text });
    dispatch({ type: "scrollToTail" });
    setMode("running");
    const p = cont ? runtime.continueChat(text) : runtime.run(text);
    p.catch((err: unknown) => {
      dispatch({ type: "error", text: err instanceof Error ? err.message : String(err) });
      setMode("idle");
    });
  }

  /** Execute a fully-parsed command (typed with its argument, or selected from the palette). */
  async function runCommand(cmd: ChatCommand): Promise<void> {
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
        switchAgent(def);
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
        await switchModel(cmd.name);
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
        if (!themeNames().includes(cmd.name)) {
          dispatch({
            type: "error",
            text: `Unknown theme "${cmd.name}". Available: ${themeNames().join(", ")}`,
          });
          return;
        }
        await switchTheme(cmd.name);
        return;
      }
      case "tools": {
        const list = getDefaultTools()
          .map((t) => `  ${t.definition.name} — ${t.definition.description}`)
          .join("\n");
        dispatch({ type: "notice", text: `Tools:\n${list}` });
        return;
      }
      case "about":
        dispatch({ type: "notice", text: aboutText() });
        return;
      case "unknown":
        dispatch({ type: "error", text: `Unknown command "/${cmd.cmd}". Try /help.` });
        return;
    }
  }

  function switchAgent(def: AgentDefinition): void {
    runtime.setAgent(def);
    runtime.initSession();
    firstRef.current = true;
    setAgentId(def.id);
    dispatch({ type: "notice", text: `Switched to ${def.id} — context cleared.` });
  }

  async function switchModel(name: string): Promise<void> {
    runtime.setModel(name);
    const conf = await loadConfig();
    await saveConfig({ ...conf, model: name });
    setModel(name);
    dispatch({ type: "notice", text: `Model switched to ${name}.` });
  }

  async function switchTheme(name: string): Promise<void> {
    const conf = await loadConfig();
    await saveConfig({ ...conf, theme: name });
    setThemeName(name);
    dispatch({ type: "notice", text: `Theme switched to ${name}.` });
  }

  /** A palette selection: arg-taking commands open a modal; the rest run immediately. */
  function selectCommand(meta: CommandMeta): void {
    setValue("");
    setPaletteIndex(0);
    if (meta.name === "agent") {
      setModal({
        kind: "agent",
        title: "Select agent",
        items: agents.map((a) => ({
          value: a.id,
          label: a.id,
          desc: a.builtin ? a.description : `[custom] ${a.description}`,
        })),
        query: "",
        index: 0,
      });
      return;
    }
    if (meta.name === "theme") {
      setModal({
        kind: "theme",
        title: "Select theme",
        items: themeNames().map((n) => ({ value: n, label: n })),
        query: "",
        index: 0,
      });
      return;
    }
    if (meta.name === "model") {
      void openModelModal();
      return;
    }
    void runCommand(parseChatInput(`/${meta.name}`));
  }

  async function openModelModal(): Promise<void> {
    const { ok, models } = await runtime.checkProvider();
    if (!ok) {
      dispatch({ type: "error", text: "Provider unreachable." });
      return;
    }
    setModal({
      kind: "model",
      title: "Select model",
      items: models.map((m) => ({ value: m.name, label: m.name })),
      query: "",
      index: 0,
    });
  }

  async function applySelection(selectedValue: string): Promise<void> {
    const kind = modal?.kind;
    setModal(null);
    if (kind === "agent") {
      const def = resolveAgent(selectedValue);
      if (def) switchAgent(def);
    } else if (kind === "model") {
      await switchModel(selectedValue);
    } else if (kind === "theme") {
      await switchTheme(selectedValue);
    }
  }

  async function handleSubmit(raw: string): Promise<void> {
    // If the palette is open, Enter chooses the highlighted command rather than
    // submitting the partial text.
    const live = matchCommands(raw);
    if (live.length > 0) {
      selectCommand(live[clampIndex(paletteIndex, live.length)]);
      return;
    }
    setValue("");
    if (!raw.trim()) return;
    await runCommand(parseChatInput(raw));
  }

  const contentWidth = Math.max(20, dims.cols - 3);
  const matches = matchCommands(value);
  const paletteOpen = !modal && mode !== "running" && matches.length > 0;
  // Reserve rows for the input panel (3), hint + status bar (2), and any open palette.
  const logRows = Math.max(3, dims.rows - 6 - (paletteOpen ? matches.length : 0));
  const heights = conv.entries.map((e) => entryHeight(e, contentWidth));
  const win = windowEntries(heights, logRows, conv.scrollOffset);
  const visible = conv.entries.slice(win.startIndex, win.endIndex);

  const toolIds = conv.entries.filter((e) => e.kind === "tool").map((e) => e.id);
  const selected = selectedToolId ?? (toolIds.length > 0 ? toolIds[toolIds.length - 1] : null);

  function moveSelection(dir: -1 | 1): void {
    if (toolIds.length === 0) return;
    const cur = selected ?? toolIds[toolIds.length - 1];
    const idx = Math.min(toolIds.length - 1, Math.max(0, toolIds.indexOf(cur) + dir));
    setSelectedToolId(toolIds[idx]);
  }

  function moveModal(dir: -1 | 1): void {
    setModal((m) => (m ? { ...m, index: clampIndex(m.index + dir, filterItems(m.items, m.query).length) } : m));
  }

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (mode === "running" && !cancelArmedRef.current) {
        cancelArmedRef.current = true;
        runtime.cancel();
        return;
      }
      exit();
      return;
    }

    // Modal owns navigation; its search field handles typing + Enter.
    if (modal) {
      if (key.escape) {
        setModal(null);
        return;
      }
      if (key.upArrow) {
        moveModal(-1);
        return;
      }
      if (key.downArrow) {
        moveModal(1);
        return;
      }
      return;
    }

    // Palette open: ↑/↓ navigate, Tab completes, Esc closes. Enter is handled by the input's onSubmit.
    if (paletteOpen) {
      if (key.upArrow) {
        setPaletteIndex((i) => clampIndex(i - 1, matches.length));
        return;
      }
      if (key.downArrow) {
        setPaletteIndex((i) => clampIndex(i + 1, matches.length));
        return;
      }
      if (key.tab) {
        const m = matches[clampIndex(paletteIndex, matches.length)];
        setValue(`/${m.name}${m.arg ? " " : ""}`);
        setPaletteIndex(0);
        return;
      }
      if (key.escape) {
        setValue("");
        setPaletteIndex(0);
        return;
      }
      return;
    }

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
      if (mode === "running") {
        cancelArmedRef.current = true;
        runtime.cancel();
      } else {
        dispatch({ type: "scrollToTail" });
      }
      return;
    }
    // With an empty input, arrow/enter drive tool-block focus instead of text editing.
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

  const isEmpty = conv.entries.length === 0 && mode !== "running";
  const centered = Boolean(modal) || isEmpty;

  return (
    <Box flexDirection="column" paddingX={1} height={dims.rows}>
      <Box
        flexGrow={1}
        flexDirection="column"
        justifyContent={centered ? "center" : "flex-end"}
        alignItems={modal ? "center" : undefined}
      >
        {modal ? (
          <SelectModal
            theme={theme}
            title={modal.title}
            items={modal.items}
            query={modal.query}
            index={modal.index}
            width={contentWidth}
            onQueryChange={(q) => setModal((m) => (m ? { ...m, query: q, index: 0 } : m))}
            onSubmit={(v) => void applySelection(v)}
          />
        ) : isEmpty ? (
          <Banner theme={theme} />
        ) : (
          <MessageLog
            visible={visible}
            theme={theme}
            width={contentWidth}
            live={mode === "running" && conv.following ? conv.live : ""}
            focusedToolId={selected}
          />
        )}
      </Box>
      {paletteOpen ? (
        <CommandPalette
          matches={matches}
          theme={theme}
          width={contentWidth}
          index={clampIndex(paletteIndex, matches.length)}
        />
      ) : null}
      {!modal ? (
        <InputBox
          theme={theme}
          agent={agentId}
          model={model}
          value={value}
          onChange={onChangeValue}
          onSubmit={handleSubmit}
          running={mode === "running"}
          providerOk={providerOk}
        />
      ) : null}
      <StatusLine
        theme={theme}
        mode={tuiMode}
        hiddenAbove={win.hiddenAbove}
        cwd={basename(process.cwd())}
        version={VERSION}
        ctxRatio={usage ? usage.ratio : null}
      />
    </Box>
  );
}

import { Box, Modal, useApp, useInput, useModal, useStdout, useTextInput } from "tuir";
import { useEffect, useReducer, useRef, useState } from "react";
import { basename } from "node:path";
import type { AgentRuntime } from "../../agent/AgentRuntime.js";
import type { AgentDefinition } from "../../agent/AgentDefinition.js";
import { getDefaultTools } from "../../tools/index.js";
import { loadConfig, saveConfig } from "../config.js";
import { saveSessionTranscript } from "../saveTranscript.js";
import { parseChatInput, matchCommands, CHAT_HELP, type CommandMeta, type ChatCommand } from "../chatCommands.js";
import { GUIDED_PROCESS, nextStageIndex, type ProcessDef } from "../../agent/Process.js";
import { conversationReducer, initialConversation, lastAnswer } from "./state/conversation.js";
import { VERSION } from "../../version.js";
import { aboutText } from "./about.js";
import { resolveTheme, themeNames, type ThemeOverrides } from "./theme.js";
import { useAgentEvents } from "./hooks/useAgentEvents.js";
import { MessageLog } from "./layout/MessageLog.js";
import { InputBox } from "./layout/InputBox.js";
import { StatusLine } from "./layout/StatusLine.js";
import { Banner } from "./components/Banner.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { SelectModal, type ModalVariant } from "./components/SelectModal.js";
import { filterItems, clampIndex, type SelectItem } from "./components/select.js";
import { flattenConversation, windowLines } from "./layout/flatten.js";
import type { TuiMode } from "./layout/chrome.js";

export interface AppAgentInfo {
  id: string;
  description: string;
  builtin: boolean;
}

type ModalKind = "agent" | "model" | "theme" | "tools" | "info";
interface ModalState {
  kind: ModalKind;
  title: string;
  items: SelectItem[];
  index: number;
  variant: ModalVariant;
}

export interface AppProps {
  runtime: AgentRuntime;
  agents: AppAgentInfo[];
  resolveAgent: (name: string) => AgentDefinition | undefined;
  seedTask?: string;
  providerOk: boolean;
  themeName?: string;
  customTheme?: ThemeOverrides;
}

/**
 * Track terminal size. We deliberately avoid tuir's <Viewport> (which forces a
 * full-height Box and triggers tuir's clear-the-whole-screen-every-frame flicker
 * path); a plain root Box sized one row short keeps output under the terminal
 * height so tuir uses its incremental-diff renderer.
 */
function useTermSize(): { rows: number; cols: number } {
  const { stdout } = useStdout();
  const [dims, setDims] = useState({ rows: stdout.rows || 24, cols: stdout.columns || 80 });
  useEffect(() => {
    const onResize = (): void => setDims({ rows: stdout.rows || 24, cols: stdout.columns || 80 });
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return dims;
}

export function App({ runtime, agents, resolveAgent, seedTask, providerOk, themeName: initialThemeName, customTheme }: AppProps) {
  const { exit } = useApp();
  const { rows: height, cols: width } = useTermSize();

  const mainInput = useTextInput("");
  const searchInput = useTextInput("");
  const value = mainInput.value;
  const query = searchInput.value;

  const [conv, dispatch] = useReducer(conversationReducer, undefined, initialConversation);
  const [mode, setMode] = useState<"idle" | "running">("idle");
  const [usage, setUsage] = useState<{ used: number; max: number; ratio: number } | null>(null);
  const [agentId, setAgentId] = useState(runtime.agentId);
  const [model, setModel] = useState(runtime.model);
  const [themeName, setThemeName] = useState(initialThemeName);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [modal, setModal] = useState<ModalState | null>(null);
  // Bumped on every submit to re-trigger the input re-arm effect even when
  // mode/modal don't change (e.g. /clear stays idle with no modal).
  const [rearmTick, setRearmTick] = useState(0);
  // Set while the agent is awaiting an answer to ask_user; the next submission
  // resolves it (instead of starting a new turn) and the loop continues.
  const [pendingAsk, setPendingAsk] = useState<{ resolve: (answer: string) => void } | null>(null);
  // Active advised process (e.g. guided: plan → build), with the current stage index.
  const [proc, setProc] = useState<{ def: ProcessDef; stage: number } | null>(null);
  const firstRef = useRef(true);
  const cancelArmedRef = useRef(false);

  const theme = resolveTheme(themeName, customTheme);
  const hasCustom = Boolean(customTheme);
  const { modal: modalObj, showModal, hideModal } = useModal({ show: null, hide: null });

  useAgentEvents(runtime, dispatch, { onUsage: setUsage, onIdle: () => setMode("idle") });

  useEffect(() => {
    // A resumed session already has history — don't wipe it; otherwise seed the prompt.
    if (!runtime.session.hasHistory) runtime.initSession();
    // When the agent calls ask_user, show the question and pause for the answer.
    runtime.setAskUserHandler((question) => {
      dispatch({ type: "notice", text: `? ${question}` });
      dispatch({ type: "scrollToTail" });
      return new Promise<string>((resolve) => setPendingAsk({ resolve }));
    });
    if (seedTask && seedTask.trim()) runTurn(seedTask.trim());
    return () => runtime.setAskUserHandler(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset the palette highlight whenever the input text changes.
  useEffect(() => setPaletteIndex(0), [value]);

  // Keep the tuir Modal visibility in sync with our state. Depend ONLY on
  // Boolean(modal) — showModal/hideModal get fresh identities every render, so
  // including them would loop ("Maximum update depth exceeded").
  useEffect(() => {
    if (modal) showModal();
    else hideModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(modal)]);

  // Re-arm the main input whenever we return to idle with no modal open. The
  // TextInput only auto-enters insert mode on (re)mount; commands like /clear or
  // a typed /theme keep it mounted but exit insert mode, so without this the
  // keyboard goes dead. Deferred a tick so it runs after the re-render settles.
  useEffect(() => {
    if (mode !== "running" && !modal) {
      const t = setTimeout(() => mainInput.enterInsert(), 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, Boolean(modal), rearmTick]);

  function runTurn(text: string, taskOverride?: string): void {
    const cont = !firstRef.current;
    firstRef.current = false;
    cancelArmedRef.current = false;
    dispatch({ type: "user", text });
    dispatch({ type: "scrollToTail" });
    setMode("running");
    const task = taskOverride ?? text;
    const p = cont ? runtime.continueChat(task) : runtime.run(task);
    p.catch((err: unknown) => {
      dispatch({ type: "error", text: err instanceof Error ? err.message : String(err) });
      setMode("idle");
    });
  }

  /** Start the guided process: plan the task, then Tab hands off to build. */
  function startGuided(task: string): void {
    const t = task.trim();
    if (!t) {
      dispatch({ type: "error", text: "Usage: /guided <task>  (e.g. /guided build an express api)" });
      return;
    }
    const planDef = resolveAgent("plan");
    if (!planDef) {
      dispatch({ type: "error", text: "Plan agent not available." });
      return;
    }
    runtime.setAgent(planDef);
    setAgentId("plan");
    firstRef.current = true; // fresh plan context seeded with the task
    setProc({ def: GUIDED_PROCESS, stage: 0 });
    dispatch({ type: "notice", text: `Guided · planning — press Tab when the plan is ready to hand off to build.` });
    runTurn(t);
  }

  /** Hand the plan agent's approach off to build (Tab in plan mode). */
  function handoffToBuild(): void {
    const plan = lastAnswer(conv.entries);
    if (!plan) {
      dispatch({ type: "notice", text: "Ask plan for an approach first, then press Tab to hand it to build." });
      return;
    }
    const buildDef = resolveAgent("build");
    if (!buildDef) return;
    setAgentId("build");
    // Advance the guided process to its build stage, if one is running.
    setProc((p) => (p ? { ...p, stage: nextStageIndex(p.def, p.stage) ?? p.stage } : p));
    // Build continues the session after the handoff; later messages use continueChat.
    firstRef.current = false;
    cancelArmedRef.current = false;
    dispatch({ type: "notice", text: "→ Handed off to build — implementing the plan." });
    dispatch({ type: "user", text: "Implement the plan above." });
    dispatch({ type: "scrollToTail" });
    setMode("running");
    // The runtime seeds build with the plan + a compact summary of what plan examined.
    runtime.handoffToBuild(buildDef, plan).catch((err: unknown) => {
      dispatch({ type: "error", text: err instanceof Error ? err.message : String(err) });
      setMode("idle");
    });
  }

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
        dispatch({ type: "reset" });
        return;
      case "help":
        openInfoModal("Help", CHAT_HELP.split("\n"));
        return;
      case "agents":
        openAgentModal();
        return;
      case "agent": {
        const def = resolveAgent(cmd.name);
        if (!def) {
          dispatch({ type: "error", text: `Unknown agent "${cmd.name}". Try /agent.` });
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
          dispatch({ type: "error", text: `Unknown model "${cmd.name}".` });
          return;
        }
        await switchModel(cmd.name);
        return;
      }
      case "models":
        await openModelModal();
        return;
      case "theme": {
        if (!themeNames(hasCustom).includes(cmd.name)) {
          dispatch({ type: "error", text: `Unknown theme "${cmd.name}".` });
          return;
        }
        await switchTheme(cmd.name);
        return;
      }
      case "tools":
        openToolsModal();
        return;
      case "about":
        openInfoModal("About", aboutText().split("\n"));
        return;
      case "guided":
        startGuided(cmd.task);
        return;
      case "save":
        try {
          const conf = await loadConfig();
          const path = await saveSessionTranscript(runtime.session, cmd.path, conf.logDir);
          dispatch({ type: "notice", text: `Saved session transcript → ${path}` });
        } catch (err) {
          dispatch({ type: "error", text: `Could not save transcript: ${err instanceof Error ? err.message : String(err)}` });
        }
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

  function openModal(state: ModalState): void {
    searchInput.setValue("");
    setModal(state);
  }
  function openAgentModal(): void {
    openModal({
      kind: "agent",
      title: "Select agent",
      variant: "select",
      index: 0,
      items: agents.map((a) => ({
        value: a.id,
        label: a.id,
        desc: a.builtin ? a.description : `[custom] ${a.description}`,
      })),
    });
  }
  function openThemeModal(): void {
    openModal({
      kind: "theme",
      title: "Select theme",
      variant: "select",
      index: 0,
      items: themeNames(hasCustom).map((n) => ({ value: n, label: n })),
    });
  }
  function openInfoModal(title: string, lines: string[]): void {
    openModal({ kind: "info", title, variant: "info", index: 0, items: lines.map((l) => ({ value: "", label: l })) });
  }

  function openToolsModal(): void {
    openModal({
      kind: "tools",
      title: "Tools — select to view details",
      variant: "select",
      index: 0,
      items: getDefaultTools().map((t) => ({
        value: t.definition.name,
        label: t.definition.name,
        desc: t.definition.description,
      })),
    });
  }

  function openToolDetail(name: string): void {
    const tool = getDefaultTools().find((t) => t.definition.name === name);
    if (!tool) return;
    const d = tool.definition;
    const required = new Set(d.parameters.required);
    const lines: string[] = [d.description, "", "Parameters:"];
    const props = Object.entries(d.parameters.properties);
    if (props.length === 0) lines.push("  (none)");
    for (const [param, spec] of props) {
      lines.push(`  ${param}  (${spec.type})${required.has(param) ? "  required" : ""}`);
      lines.push(`     ${spec.description}`);
    }
    openInfoModal(`Tool: ${name}`, lines);
  }
  async function openModelModal(): Promise<void> {
    const { ok, models } = await runtime.checkProvider();
    if (!ok) {
      dispatch({ type: "error", text: "Provider unreachable." });
      return;
    }
    openModal({
      kind: "model",
      title: "Select model",
      variant: "select",
      index: 0,
      items: models.map((m) => ({ value: m.name, label: m.name })),
    });
  }

  function closeModal(): void {
    setModal(null);
    searchInput.setValue("");
  }

  async function applySelection(selectedValue: string): Promise<void> {
    const kind = modal?.kind;
    closeModal();
    if (kind === "agent") {
      const def = resolveAgent(selectedValue);
      if (def) switchAgent(def);
    } else if (kind === "model") {
      await switchModel(selectedValue);
    } else if (kind === "theme") {
      await switchTheme(selectedValue);
    } else if (kind === "tools") {
      openToolDetail(selectedValue);
    }
  }

  function selectCommand(meta: CommandMeta): void {
    mainInput.setValue("");
    setPaletteIndex(0);
    if (meta.name === "agent") return openAgentModal();
    if (meta.name === "theme") return openThemeModal();
    if (meta.name === "model") return void openModelModal();
    void runCommand(parseChatInput(`/${meta.name}`));
  }

  function handleMainSubmit(v: string): void {
    // If the agent asked a question, this submission is the answer — feed it back
    // to the paused loop rather than starting a new turn.
    if (pendingAsk) {
      pendingAsk.resolve(v);
      setPendingAsk(null);
      dispatch({ type: "user", text: v });
      dispatch({ type: "scrollToTail" });
      mainInput.setValue("");
      return;
    }
    // Re-trigger the re-arm effect after this submit (Enter exits insert mode).
    setRearmTick((t) => t + 1);
    const live = matchCommands(v);
    if (live.length > 0) {
      selectCommand(live[clampIndex(paletteIndex, live.length)]);
      mainInput.setValue("");
      return;
    }
    mainInput.setValue("");
    if (v.trim()) void runCommand(parseChatInput(v));
  }

  const contentWidth = Math.max(20, width - 4);
  const matches = matchCommands(value);
  const paletteOpen = !modal && mode !== "running" && matches.length > 0;
  // Render one row short of the terminal so total output height < rows; tuir
  // full-clears (flickers) only when output height >= rows.
  const appHeight = Math.max(8, height - 1);
  // Reserve: input panel (3) + status (2) + a slack row + palette.
  const logRows = Math.max(3, appHeight - 6 - (paletteOpen ? matches.length : 0));
  const allLines = flattenConversation(
    conv.entries,
    contentWidth,
    theme,
    mode === "running" ? conv.live : "",
  );
  const win = windowLines(allLines, logRows, conv.scrollOffset);
  const modalInnerWidth = Math.max(10, Math.floor(width * 0.6) - 6);

  function moveModal(dir: number): void {
    setModal((m) => (m ? { ...m, index: clampIndex(m.index + dir, filterItems(m.items, query).length) } : m));
  }
  function onMainUp(): void {
    if (paletteOpen) setPaletteIndex((i) => clampIndex(i - 1, matches.length));
    else dispatch({ type: "scrollUp", lines: 1 });
  }
  function onMainDown(): void {
    if (paletteOpen) setPaletteIndex((i) => clampIndex(i + 1, matches.length));
    else dispatch({ type: "scrollDown", lines: 1 });
  }

  // Global keys: Ctrl+C, Ctrl+R (expand tools), Ctrl+U/D (page scroll), Tab, Esc.
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
    if (modal) {
      if (key.esc) {
        closeModal();
        return;
      }
      if (modal.variant === "info") {
        if (key.return) closeModal();
        else if (key.up) moveModal(-1);
        else if (key.down) moveModal(1);
      }
      return;
    }
    if (key.ctrl && input === "r") {
      const anyCollapsed = conv.entries.some((e) => e.kind === "tool" && !e.expanded);
      dispatch({ type: "toggleExpandAll", expanded: anyCollapsed });
      return;
    }
    if (key.ctrl && input === "u") {
      dispatch({ type: "scrollUp", lines: Math.max(1, Math.floor(logRows / 2)) });
      return;
    }
    if (key.ctrl && input === "d") {
      dispatch({ type: "scrollDown", lines: Math.max(1, Math.floor(logRows / 2)) });
      return;
    }
    if (paletteOpen) {
      if (key.tab) {
        const m = matches[clampIndex(paletteIndex, matches.length)];
        mainInput.setValue(`/${m.name}${m.arg ? " " : ""}`);
        return;
      }
      if (key.esc) mainInput.setValue("");
      return;
    }
    // Tab in plan mode hands the approach off to the build agent.
    if (key.tab) {
      if (agentId === "plan" && mode !== "running") handoffToBuild();
      return;
    }
    if (key.esc) {
      if (pendingAsk) {
        // Cancel the pending question: unblock the loop, then cancel the run.
        pendingAsk.resolve("(The user cancelled. Stop and summarise what remains.)");
        setPendingAsk(null);
        cancelArmedRef.current = true;
        runtime.cancel();
      } else if (mode === "running") {
        cancelArmedRef.current = true;
        runtime.cancel();
      } else {
        dispatch({ type: "scrollToTail" });
      }
      return;
    }
  });

  const lastIsError = conv.entries.length > 0 && conv.entries[conv.entries.length - 1].kind === "error";
  const tuiMode: TuiMode =
    mode === "running" ? "running" : !conv.following ? "scrolled" : lastIsError ? "error" : "idle";
  const isEmpty = conv.entries.length === 0 && mode !== "running";

  return (
    <Box
      flexDirection="column"
      height={appHeight}
      width={width}
      paddingX={1}
      backgroundColor={theme.background}
      onScrollUp={() => dispatch({ type: "scrollUp", lines: 3 })}
      onScrollDown={() => dispatch({ type: "scrollDown", lines: 3 })}
    >
      <Box flexGrow={1} flexDirection="column" overflow="hidden" justifyContent={isEmpty ? "center" : "flex-end"} alignItems={isEmpty ? "center" : undefined}>
        {isEmpty ? (
          <Banner theme={theme} />
        ) : (
          <MessageLog lines={win.lines} theme={theme} rows={logRows} width={Math.max(20, width - 2)} />
        )}
      </Box>
      {paletteOpen ? (
        <CommandPalette matches={matches} theme={theme} width={contentWidth} index={clampIndex(paletteIndex, matches.length)} />
      ) : null}
      <InputBox
        theme={theme}
        agent={agentId}
        model={model}
        onChange={mainInput.onChange}
        value={value}
        onSubmit={handleMainSubmit}
        onUpArrow={onMainUp}
        onDownArrow={onMainDown}
        running={mode === "running" && !pendingAsk}
        providerOk={providerOk}
      />
      <StatusLine
        theme={theme}
        mode={tuiMode}
        hiddenAbove={win.hiddenAbove}
        cwd={basename(process.cwd())}
        version={VERSION}
        ctxRatio={usage ? usage.ratio : null}
        note={
          agentId === "plan" && mode !== "running" && !modal && conv.entries.some((e) => e.kind === "answer")
            ? proc
              ? "Guided · plan ✓ — Tab → build"
              : "Tab → hand off to build"
            : proc && agentId === "build"
              ? "Guided · build"
              : undefined
        }
      />
      {modal ? (
        <Modal
          modal={modalObj}
          justifySelf="center"
          alignSelf="center"
          width="60"
          borderStyle="round"
          borderColor={theme.border}
          backgroundColor={theme.panel ?? theme.background}
          flexDirection="column"
          paddingX={2}
          paddingY={1}
        >
          <SelectModal
            theme={theme}
            title={modal.title}
            items={modal.items}
            query={query}
            index={modal.index}
            width={modalInnerWidth}
            variant={modal.variant}
            searchOnChange={searchInput.onChange}
            onSubmit={(v) => void applySelection(v)}
            onUpArrow={() => moveModal(-1)}
            onDownArrow={() => moveModal(1)}
          />
        </Modal>
      ) : null}
    </Box>
  );
}

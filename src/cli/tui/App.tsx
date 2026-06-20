import { Box, Modal, useApp, useInput, useModal, useStdout, useTextInput } from "tuir";
import { useEffect, useReducer, useRef, useState } from "react";
import { basename } from "node:path";
import type { AgentRuntime } from "../../agent/AgentRuntime.js";
import type { AgentDefinition } from "../../agent/AgentDefinition.js";
import { getDefaultTools } from "../../tools/index.js";
import { loadConfig, saveConfig } from "../config.js";
import { parseChatInput, matchCommands, CHAT_HELP, type CommandMeta, type ChatCommand } from "../chatCommands.js";
import { conversationReducer, initialConversation } from "./state/conversation.js";
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
import { entryHeight, windowEntries } from "./layout/viewport.js";
import type { TuiMode } from "./layout/chrome.js";

export interface AppAgentInfo {
  id: string;
  description: string;
  builtin: boolean;
}

type ModalKind = "agent" | "model" | "theme" | "info";
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
  const [selectedToolId, setSelectedToolId] = useState<number | null>(null);
  const firstRef = useRef(true);
  const cancelArmedRef = useRef(false);

  const theme = resolveTheme(themeName, customTheme);
  const hasCustom = Boolean(customTheme);
  const { modal: modalObj, showModal, hideModal } = useModal({ show: null, hide: null });

  useAgentEvents(runtime, dispatch, { onUsage: setUsage, onIdle: () => setMode("idle") });

  useEffect(() => {
    runtime.initSession();
    if (seedTask && seedTask.trim()) runTurn(seedTask.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset the palette highlight whenever the input text changes.
  useEffect(() => setPaletteIndex(0), [value]);

  // Keep the tuir Modal visibility in sync, and re-arm the main input on close.
  useEffect(() => {
    if (modal) {
      showModal();
      return;
    }
    hideModal();
    // The main TextInput's isFocus never changes, so its autoEnter effect won't
    // re-fire after the modal's search input tears down. Re-enter insert mode
    // on the next tick so typing works again.
    const t = setTimeout(() => mainInput.enterInsert(), 0);
    return () => clearTimeout(t);
  }, [modal, showModal, hideModal, mainInput]);

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
        openInfoModal(
          "Tools",
          getDefaultTools().map((t) => `${t.definition.name} — ${t.definition.description}`),
        );
        return;
      case "about":
        openInfoModal("About", aboutText().split("\n"));
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
    const live = matchCommands(v);
    if (live.length > 0) {
      selectCommand(live[clampIndex(paletteIndex, live.length)]);
      mainInput.setValue("");
      mainInput.enterInsert();
      return;
    }
    mainInput.setValue("");
    if (v.trim()) void runCommand(parseChatInput(v));
    mainInput.enterInsert();
  }

  const contentWidth = Math.max(20, width - 3);
  const matches = matchCommands(value);
  const paletteOpen = !modal && mode !== "running" && matches.length > 0;
  // Render one row short of the terminal so total output height < rows; tuir
  // full-clears (flickers) only when output height >= rows.
  const appHeight = Math.max(8, height - 1);
  const logRows = Math.max(3, appHeight - 6 - (paletteOpen ? matches.length : 0));
  const heights = conv.entries.map((e) => entryHeight(e, contentWidth));
  const win = windowEntries(heights, logRows, conv.scrollOffset);
  const visible = conv.entries.slice(win.startIndex, win.endIndex);

  const toolIds = conv.entries.filter((e) => e.kind === "tool").map((e) => e.id);
  const selected = selectedToolId ?? (toolIds.length > 0 ? toolIds[toolIds.length - 1] : null);
  const modalInnerWidth = Math.max(10, Math.floor(width * 0.6) - 6);

  function moveSelection(dir: -1 | 1): void {
    if (toolIds.length === 0) return;
    const cur = selected ?? toolIds[toolIds.length - 1];
    const idx = Math.min(toolIds.length - 1, Math.max(0, toolIds.indexOf(cur) + dir));
    setSelectedToolId(toolIds[idx]);
  }
  function moveModal(dir: number): void {
    setModal((m) => (m ? { ...m, index: clampIndex(m.index + dir, filterItems(m.items, query).length) } : m));
  }
  function onMainUp(): void {
    if (paletteOpen) setPaletteIndex((i) => clampIndex(i - 1, matches.length));
    else if (value === "") moveSelection(-1);
  }
  function onMainDown(): void {
    if (paletteOpen) setPaletteIndex((i) => clampIndex(i + 1, matches.length));
    else if (value === "") moveSelection(1);
  }

  // Global keys: Ctrl+C, Ctrl+R, Tab, Esc, and info-modal nav (no text field there).
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
    if (paletteOpen) {
      if (key.tab) {
        const m = matches[clampIndex(paletteIndex, matches.length)];
        mainInput.setValue(`/${m.name}${m.arg ? " " : ""}`);
        return;
      }
      if (key.esc) mainInput.setValue("");
      return;
    }
    if (key.esc) {
      if (mode === "running") {
        cancelArmedRef.current = true;
        runtime.cancel();
      } else {
        dispatch({ type: "scrollToTail" });
      }
      return;
    }
    if (value === "" && key.return && selected !== null) {
      dispatch({ type: "toggleExpand", id: selected });
    }
  });

  const lastIsError = conv.entries.length > 0 && conv.entries[conv.entries.length - 1].kind === "error";
  const tuiMode: TuiMode =
    mode === "running" ? "running" : !conv.following ? "scrolled" : lastIsError ? "error" : "idle";
  const isEmpty = conv.entries.length === 0 && mode !== "running";

  return (
    <Box flexDirection="column" height={appHeight} width={width} paddingX={1} backgroundColor={theme.background}>
      <Box flexGrow={1} flexDirection="column" justifyContent={isEmpty ? "center" : "flex-end"} alignItems={isEmpty ? "center" : undefined}>
        {isEmpty ? (
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
        running={mode === "running"}
        providerOk={providerOk}
      />
      <StatusLine
        theme={theme}
        mode={tuiMode}
        hiddenAbove={win.hiddenAbove}
        cwd={basename(process.cwd())}
        version={VERSION}
        ctxRatio={usage ? usage.ratio : null}
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

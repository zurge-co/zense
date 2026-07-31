import { create } from "zustand";
import { getActiveEditor } from "../lib/editorRef";

export type Activity = "git" | "explorer" | "search" | "graph" | "prompts";
export type Screen = "welcome" | "workspace";
export type SettingsSection = "general" | "appearance" | "agent" | "shortcuts" | "terminal";
export type DiffMode = "split" | "inline";
export type MainView = "editor" | "graph";

/** A tab in the editor area — either a normal file or a working-tree diff. */
export interface EditorTab {
  kind: "file" | "diff";
  path: string;
}

export const tabKey = (t: EditorTab) => `${t.kind}:${t.path}`;

/** A piece of code context attached to a composed prompt. */
export interface ContextChip {
  path: string;
  range?: { start: number; end: number };
}

export const chipLabel = (c: ContextChip) =>
  c.range
    ? c.range.start === c.range.end
      ? `${c.path}#L${c.range.start}`
      : `${c.path}#L${c.range.start}-${c.range.end}`
    : c.path;

export interface SentEntry {
  id: number;
  time: string;
  text: string;
  chips: ContextChip[];
}

interface UIState {
  screen: Screen;
  activity: Activity;
  mainView: MainView;
  sidebarVisible: boolean;
  chatVisible: boolean;
  bottomVisible: boolean;

  openTabs: EditorTab[];
  activeTabKey: string | null;
  selectedFile: string | null;
  diffMode: DiffMode;

  settingsOpen: boolean;
  settingsSection: SettingsSection;

  // Agent composer
  agentCommand: string;
  attachCode: boolean;
  autoOpenTerminal: boolean;
  composerDraft: string;
  contextChips: ContextChip[];
  sentLog: SentEntry[];

  setScreen: (s: Screen) => void;
  setActivity: (a: Activity) => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
  toggleBottom: () => void;
  openFile: (path: string) => void;
  openDiff: (path: string) => void;
  closeTab: (key: string) => void;
  setActiveTab: (key: string) => void;
  toggleDiffMode: () => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setSettingsSection: (s: SettingsSection) => void;

  setAgentCommand: (cmd: string) => void;
  setAttachCode: (v: boolean) => void;
  setAutoOpenTerminal: (v: boolean) => void;
  setComposerDraft: (d: string) => void;
  addChip: (chip: ContextChip) => void;
  removeChip: (index: number) => void;
  /** Attach the current Monaco selection (or cursor line) as a chip. */
  addSelectionChip: () => void;
  sendToAgent: () => void;
}

let nextSentId = 1;

const now = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const initialTab: EditorTab = { kind: "file", path: "src/auth/login.ts" };

export const useUIStore = create<UIState>((set) => ({
  screen: "welcome",
  activity: "git",
  mainView: "editor",
  sidebarVisible: true,
  chatVisible: true,
  bottomVisible: true,

  openTabs: [initialTab],
  activeTabKey: tabKey(initialTab),
  selectedFile: initialTab.path,
  diffMode: "split",

  settingsOpen: false,
  settingsSection: "general",

  agentCommand: "claude",
  attachCode: true,
  autoOpenTerminal: true,
  composerDraft: "",
  contextChips: [{ path: "src/auth/login.ts", range: { start: 9, end: 20 } }],
  sentLog: [
    {
      id: nextSentId++,
      time: "14:32",
      text: "Explain how the authentication flow works in this repo.",
      chips: [{ path: "src/auth/login.ts" }, { path: "src/middleware/auth.ts" }],
    },
  ],

  setScreen: (screen) => set({ screen }),
  setActivity: (activity) =>
    set((s) => {
      if (activity === "graph") {
        return { activity, mainView: "graph", sidebarVisible: false };
      }
      const wasGraph = s.mainView === "graph";
      return {
        activity,
        mainView: "editor" as MainView,
        sidebarVisible: wasGraph
          ? true
          : s.activity === activity
            ? !s.sidebarVisible
            : true,
      };
    }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleChat: () => set((s) => ({ chatVisible: !s.chatVisible })),
  toggleBottom: () => set((s) => ({ bottomVisible: !s.bottomVisible })),
  openFile: (path) => {
    const tab: EditorTab = { kind: "file", path };
    const key = tabKey(tab);
    set((s) => ({
      selectedFile: path,
      activeTabKey: key,
      openTabs: s.openTabs.some((t) => tabKey(t) === key) ? s.openTabs : [...s.openTabs, tab],
    }));
  },
  openDiff: (path) => {
    const tab: EditorTab = { kind: "diff", path };
    const key = tabKey(tab);
    set((s) => ({
      selectedFile: path,
      activeTabKey: key,
      openTabs: s.openTabs.some((t) => tabKey(t) === key) ? s.openTabs : [...s.openTabs, tab],
    }));
  },
  closeTab: (key) =>
    set((s) => {
      const openTabs = s.openTabs.filter((t) => tabKey(t) !== key);
      const activeTabKey =
        s.activeTabKey === key
          ? (openTabs.length ? tabKey(openTabs[openTabs.length - 1]) : null)
          : s.activeTabKey;
      return { openTabs, activeTabKey };
    }),
  setActiveTab: (key) =>
    set((s) => {
      const tab = s.openTabs.find((t) => tabKey(t) === key);
      return tab
        ? { activeTabKey: key, selectedFile: tab.path }
        : { activeTabKey: key };
    }),
  toggleDiffMode: () =>
    set((s) => ({ diffMode: s.diffMode === "split" ? "inline" : "split" })),
  openSettings: (section = "general") =>
    set({ settingsOpen: true, settingsSection: section }),
  closeSettings: () => set({ settingsOpen: false }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),

  setAgentCommand: (agentCommand) => set({ agentCommand }),
  setAttachCode: (attachCode) => set({ attachCode }),
  setAutoOpenTerminal: (autoOpenTerminal) => set({ autoOpenTerminal }),
  setComposerDraft: (composerDraft) => set({ composerDraft }),
  addChip: (chip) =>
    set((s) => ({
      contextChips: s.contextChips.some(
        (c) => c.path === chip.path && c.range?.start === chip.range?.start,
      )
        ? s.contextChips
        : [...s.contextChips, chip],
    })),
  removeChip: (index) =>
    set((s) => ({ contextChips: s.contextChips.filter((_, i) => i !== index) })),
  addSelectionChip: () =>
    set((s) => {
      const editor = getActiveEditor();
      const tab = s.openTabs.find((t) => tabKey(t) === s.activeTabKey);
      if (!editor || !tab || tab.kind !== "file") return s;

      const selection = editor.getSelection();
      if (!selection) return s;

      const start = selection.startLineNumber;
      const end = selection.endLineNumber;
      const chip: ContextChip = { path: tab.path, range: { start, end } };
      const exists = s.contextChips.some(
        (c) =>
          c.path === chip.path &&
          c.range?.start === chip.range?.start &&
          c.range?.end === chip.range?.end,
      );
      return {
        contextChips: exists ? s.contextChips : [...s.contextChips, chip],
        chatVisible: true,
      };
    }),
  sendToAgent: () =>
    set((s) => {
      const text = s.composerDraft.trim();
      if (!text && s.contextChips.length === 0) return s;
      return {
        sentLog: [
          ...s.sentLog,
          { id: nextSentId++, time: now(), text, chips: s.contextChips },
        ],
        composerDraft: "",
        contextChips: [],
        // Mock behavior: jump to the terminal where the agent would run.
        bottomVisible: s.autoOpenTerminal ? true : s.bottomVisible,
      };
    }),
}));

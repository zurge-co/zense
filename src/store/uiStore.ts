import { create } from "zustand";

export type Activity = "review" | "history" | "explorer";
export type Screen = "welcome" | "workspace";
export type SettingsSection = "general" | "appearance" | "llm" | "shortcuts";
export type DiffMode = "split" | "inline";

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

interface UIState {
  screen: Screen;
  workspacePath: string | null;
  workspaceName: string | null;
  /** Incremented to request focus on the composer input. */
  composerFocusNonce: number;
  activity: Activity;
  sidebarVisible: boolean;
  chatVisible: boolean;

  openTabs: EditorTab[];
  activeTabKey: string | null;
  selectedFile: string | null;
  diffMode: DiffMode;

  settingsOpen: boolean;
  settingsSection: SettingsSection;

  setScreen: (s: Screen) => void;
  openWorkspace: (path: string) => void;
  setActivity: (a: Activity) => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
  openFile: (path: string) => void;
  openDiff: (path: string) => void;
  closeTab: (key: string) => void;
  closeOtherTabs: (key: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (key: string) => void;
  toggleDiffMode: () => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setSettingsSection: (s: SettingsSection) => void;
}

export const useUIStore = create<UIState>((set) => ({
  screen: "welcome",
  workspacePath: null,
  workspaceName: null,
  composerFocusNonce: 0,
  activity: "review",
  sidebarVisible: true,
  chatVisible: true,

  openTabs: [],
  activeTabKey: null,
  selectedFile: null,
  diffMode: "split",

  settingsOpen: false,
  settingsSection: "general",

  setScreen: (screen) => set({ screen }),
  openWorkspace: (path) =>
    set({
      screen: "workspace" as Screen,
      workspacePath: path,
      workspaceName: path.split(/[\\/]/).filter(Boolean).pop() ?? path,
      openTabs: [],
      activeTabKey: null,
      selectedFile: null,
    }),
  setActivity: (activity) =>
    set((s) => ({
      activity,
      sidebarVisible: s.activity === activity ? !s.sidebarVisible : true,
    })),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleChat: () => set((s) => ({ chatVisible: !s.chatVisible })),
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
      const newActiveKey =
        s.activeTabKey === key
          ? (openTabs.length ? tabKey(openTabs[openTabs.length - 1]) : null)
          : s.activeTabKey;
      const newTab = openTabs.find((t) => tabKey(t) === newActiveKey);
      return { openTabs, activeTabKey: newActiveKey, selectedFile: newTab?.path ?? null };
    }),
  closeOtherTabs: (key) =>
    set((s) => {
      const openTabs = s.openTabs.filter((t) => tabKey(t) === key);
      if (openTabs.length === 0) return s;
      const kept = openTabs[0];
      return { openTabs, activeTabKey: tabKey(kept), selectedFile: kept.path };
    }),
  closeAllTabs: () => set({ openTabs: [], activeTabKey: null, selectedFile: null }),
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
}));

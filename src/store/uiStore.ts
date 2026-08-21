import { create } from "zustand";

export type Activity = "review" | "history" | "editor" | "search" | "terminal";
export type Screen = "welcome" | "workspace";
export type SettingsSection = "general" | "appearance" | "llm" | "shortcuts";
export type DiffMode = "split" | "inline";

/**
 * A tab in the editor area.
 * - `file` — editable file from disk (`path` = workspace-relative path)
 * - `diff` — working-tree diff vs HEAD (`path` = file path)
 * - `commit` — commit detail view (`path` = commit sha)
 * - `commitDiff` — file diff between commits (`path` = file path,
 *   `toSha` = commit, `fromSha` = explicit base or null → first parent)
 * - `compare` — compare view between two commits (`path` = "from..to")
 */
export interface EditorTab {
  kind: "file" | "diff" | "commit" | "commitDiff" | "compare";
  path: string;
  fromSha?: string | null;
  toSha?: string;
}

export const tabKey = (t: EditorTab) =>
  `${t.kind}:${t.path}:${t.fromSha ?? ""}:${t.toSha ?? ""}`;

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
  /** Incremented to request focus on the workspace search input. */
  searchFocusNonce: number;
  activity: Activity;
  sidebarVisible: boolean;
  chatVisible: boolean;

  openTabs: EditorTab[];
  activeTabKey: string | null;
  selectedFile: string | null;
  diffMode: DiffMode;

  settingsOpen: boolean;
  settingsSection: SettingsSection;

  /** Live cursor position of the active editor (StatusBar). */
  cursorPos: { line: number; col: number } | null;
  /** Quick-open file modal (⌘P). */
  quickOpenVisible: boolean;
  /** Optional right-hand split pane showing this tab key (⌘\). */
  splitTabKey: string | null;
  /** Bumped to ask EditorArea to close the active tab (dirty-aware). */
  closeActiveTabNonce: number;

  setScreen: (s: Screen) => void;
  openWorkspace: (path: string) => void;
  setActivity: (a: Activity) => void;
  /** Open the workspace search panel and focus its input (⌘⇧F). */
  openSearch: () => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
  /** Open terminal panel and focus its input (⌘`). */
  toggleTerminal: () => void;
  /** Commit sha selected as the base for "Compare with Selected". */
  historyCompareBase: string | null;

  openFile: (path: string) => void;
  openDiff: (path: string) => void;
  openCommit: (sha: string) => void;
  openCompare: (fromSha: string, toSha: string) => void;
  openCommitFileDiff: (path: string, toSha: string, fromSha?: string | null) => void;
  setHistoryCompareBase: (sha: string | null) => void;
  closeTab: (key: string) => void;
  closeOtherTabs: (key: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (key: string) => void;
  toggleDiffMode: () => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setSettingsSection: (s: SettingsSection) => void;

  setCursorPos: (p: { line: number; col: number } | null) => void;
  setQuickOpenVisible: (v: boolean) => void;
  toggleQuickOpen: () => void;
  /** Split the active tab into the right pane (or close the split). */
  toggleSplit: () => void;
  closeSplit: () => void;
  requestCloseActiveTab: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  screen: "welcome",
  workspacePath: null,
  workspaceName: null,
  composerFocusNonce: 0,
  searchFocusNonce: 0,
  activity: "review",
  sidebarVisible: true,
  chatVisible: true,

  openTabs: [],
  activeTabKey: null,
  selectedFile: null,
  diffMode: "split",
  historyCompareBase: null,
  cursorPos: null,
  quickOpenVisible: false,
  splitTabKey: null,
  closeActiveTabNonce: 0,

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
      splitTabKey: null,
      cursorPos: null,
    }),
  setActivity: (activity) =>
    set((s) => ({
      activity,
      sidebarVisible: s.activity === activity ? !s.sidebarVisible : true,
    })),
  openSearch: () =>
    set((state) => ({
      activity: "search" as Activity,
      sidebarVisible: true,
      searchFocusNonce: state.searchFocusNonce + 1,
    })),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleChat: () => set((s) => ({ chatVisible: !s.chatVisible })),
  toggleTerminal: () =>
    set((_s) => ({
      activity: "terminal" as Activity,
      sidebarVisible: true,
      quickOpenVisible: false,
    })),
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
  openCommit: (sha) => {
    const tab: EditorTab = { kind: "commit", path: sha };
    const key = tabKey(tab);
    set((s) => ({
      activeTabKey: key,
      openTabs: s.openTabs.some((t) => tabKey(t) === key) ? s.openTabs : [...s.openTabs, tab],
    }));
  },
  openCompare: (fromSha, toSha) => {
    const tab: EditorTab = { kind: "compare", path: `${fromSha}..${toSha}`, fromSha, toSha };
    const key = tabKey(tab);
    set((s) => ({
      activeTabKey: key,
      historyCompareBase: null,
      openTabs: s.openTabs.some((t) => tabKey(t) === key) ? s.openTabs : [...s.openTabs, tab],
    }));
  },
  openCommitFileDiff: (path, toSha, fromSha = null) => {
    const tab: EditorTab = { kind: "commitDiff", path, fromSha, toSha };
    const key = tabKey(tab);
    set((s) => ({
      selectedFile: path,
      activeTabKey: key,
      openTabs: s.openTabs.some((t) => tabKey(t) === key) ? s.openTabs : [...s.openTabs, tab],
    }));
  },
  setHistoryCompareBase: (historyCompareBase) => set({ historyCompareBase }),
  closeTab: (key) =>
    set((s) => {
      const openTabs = s.openTabs.filter((t) => tabKey(t) !== key);
      const newActiveKey =
        s.activeTabKey === key
          ? (openTabs.length ? tabKey(openTabs[openTabs.length - 1]) : null)
          : s.activeTabKey;
      const newTab = openTabs.find((t) => tabKey(t) === newActiveKey);
      return {
        openTabs,
        activeTabKey: newActiveKey,
        selectedFile: newTab?.path ?? null,
        splitTabKey: s.splitTabKey === key ? null : s.splitTabKey,
      };
    }),
  closeOtherTabs: (key) =>
    set((s) => {
      const openTabs = s.openTabs.filter((t) => tabKey(t) === key);
      if (openTabs.length === 0) return s;
      const kept = openTabs[0];
      return { openTabs, activeTabKey: tabKey(kept), selectedFile: kept.path };
    }),
  closeAllTabs: () =>
    set({ openTabs: [], activeTabKey: null, selectedFile: null, splitTabKey: null, cursorPos: null }),
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

  setCursorPos: (cursorPos) => set({ cursorPos }),
  setQuickOpenVisible: (quickOpenVisible) => set({ quickOpenVisible }),
  toggleQuickOpen: () => set((s) => ({ quickOpenVisible: !s.quickOpenVisible })),
  toggleSplit: () =>
    set((s) => ({
      splitTabKey: s.splitTabKey ? null : s.activeTabKey,
    })),
  closeSplit: () => set({ splitTabKey: null }),
  requestCloseActiveTab: () => set((s) => ({ closeActiveTabNonce: s.closeActiveTabNonce + 1 })),
}));

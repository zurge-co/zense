import { create } from "zustand";

/** Editor sidebar tabs: the Explorer or the workspace-wide Search (⌘⇧F). */
export type Activity = "review" | "history" | "editor" | "terminal";
export type Screen = "welcome" | "workspace";
export type SettingsSection = "general" | "appearance" | "llm" | "shortcuts";
export type DiffMode = "split" | "inline";

/**
 * The Editor activity's sidebar content. Search is an Editor *mode* — there
 * is no standalone Search activity anymore (⌘⇧F / Find in Files lands here).
 */
export type EditorPanelMode = "files" | "search";

/**
 * SINGLE SOURCE OF TRUTH for the ActivityBar menu order (workflow order,
 * spec v3): Terminal → Review → Editor → History. Both the ActivityBar's
 * buttons and the store's INITIAL activity derive from this array — the
 * workspace always opens on the FIRST menu item (`ACTIVITY_MENU[0]`),
 * never a hardcoded id, so reordering the menu reorders the default.
 */
export const ACTIVITY_MENU: { id: Activity; label: string }[] = [
  { id: "terminal", label: "Terminal (⌘`)" },
  { id: "review", label: "Review" },
  { id: "editor", label: "Editor" },
  { id: "history", label: "History" },
];

/**
 * A tab in the editor area.
 * - `file` — editable file from disk (`path` = workspace-relative path)
 * - `diff` — working-tree diff vs HEAD (`path` = file path)
 * - `commit` — commit detail view (`path` = commit sha)
 * - `commitDiff` — file diff between commits (`path` = file path,
 *   `toSha` = commit, `fromSha` = explicit base or null → first parent)
 * - `compare` — compare view between two commits (`path` = "from..to")
 * - `preview` — read-only rendered preview of a doc file (svg/md/html),
 *   opened via the file tree's right-click "Open Preview"
 * - `untitled` — unsaved new file (Ctrl+T): pseudo-path "untitled:N",
 *   in-memory buffer only, promoted to a `file` tab by the save-as flow
 */
export interface EditorTab {
  kind: "file" | "diff" | "commit" | "commitDiff" | "compare" | "preview" | "untitled";
  path: string;
  fromSha?: string | null;
  toSha?: string;
}

export const tabKey = (t: EditorTab) =>
  `${t.kind}:${t.path}:${t.fromSha ?? ""}:${t.toSha ?? ""}`;

/**
 * Tab areas (per-activity tab partitions). Editor tabs (files, previews,
 * untitled buffers) NEVER mix with Review's working-tree diffs or
 * History's commit views — each area keeps its own tab list and its own
 * active tab, so switching activities away and back restores exactly what
 * that area had open.
 */
export type TabArea = "editor" | "review" | "history";

export interface AreaTabs {
  openTabs: EditorTab[];
  activeTabKey: string | null;
}

/** Which tab area a tab belongs to, derived from its kind. */
export const areaOfTab = (t: EditorTab): TabArea =>
  t.kind === "diff"
    ? "review"
    : t.kind === "commit" || t.kind === "commitDiff" || t.kind === "compare"
      ? "history"
      : "editor";

/** The tab area an activity displays; the terminal has no tabs. */
export const areaOfActivity = (a: Activity): TabArea | null =>
  a === "terminal" ? null : a;

/** Fresh empty per-area tab state (initial state, workspace switch, tests). */
export const emptyTabsByArea = (): Record<TabArea, AreaTabs> => ({
  editor: { openTabs: [], activeTabKey: null },
  review: { openTabs: [], activeTabKey: null },
  history: { openTabs: [], activeTabKey: null },
});

interface UIState {
  screen: Screen;
  workspacePath: string | null;
  workspaceName: string | null;
  /** Incremented to request focus on the workspace search input. */
  searchFocusNonce: number;
  /** Which panel the Editor activity shows: Explorer or Search. */
  editorPanelMode: EditorPanelMode;
  activity: Activity;
  sidebarVisible: boolean;

  /** Tabs partitioned per area — see TabArea. Never share across areas. */
  tabsByArea: Record<TabArea, AreaTabs>;
  selectedFile: string | null;
  diffMode: DiffMode;

  settingsOpen: boolean;
  settingsSection: SettingsSection;

  /** Live cursor position of the active editor (StatusBar). */
  cursorPos: { line: number; col: number } | null;
  /** Quick-open file modal (⌘P). */
  quickOpenVisible: boolean;
  /** Focus tasks popover anchored to the TitleBar's top-right button. */
  focusPopoverOpen: boolean;
  /** Optional right-hand split pane showing this tab key (⌘\). */
  splitTabKey: string | null;
  /** Bumped to ask EditorArea to close the active tab (dirty-aware). */
  closeActiveTabNonce: number;

  /** AI conflict Resolution Workspace: the conflicted path open right now
   *  (null = closed). Launched from the Review conflict list / banner. */
  resolutionPath: string | null;

  setScreen: (s: Screen) => void;
  openWorkspace: (path: string) => void;
  setActivity: (a: Activity) => void;
  /** Switch the Editor sidebar between the Explorer and Search. */
  setEditorPanelMode: (mode: EditorPanelMode) => void;
  /** Open the Editor activity in search mode and focus its input (⌘⇧F). */
  openSearch: () => void;
  toggleSidebar: () => void;
  /** Open terminal panel and focus its input (⌘`). */
  toggleTerminal: () => void;
  /** Commit sha selected as the base for "Compare with Selected". */
  historyCompareBase: string | null;

  /** Pending go-to-line set by openFile/openDiff(path, line) — e.g. AI
   *  Review finding refs. The view rendering `path` reveals the line and
   *  consumes the request (matched by nonce, never by path alone). */
  revealLineRequest: { path: string; line: number; nonce: number; at: number } | null;
  /** Mark a reveal request as handled (or expired) so stale requests
   *  never fire on a later, unrelated mount of the same path. */
  consumeRevealLine: (nonce: number) => void;

  /** Open a file in the EDITOR area and switch the activity to it —
   *  file tabs can never appear in Review/History, so the view follows. */
  openFile: (path: string, line?: number) => void;
  /** Open a working-tree diff tab in the REVIEW area. */
  openDiff: (path: string, line?: number) => void;
  /** Open a commit detail tab in the HISTORY area. */
  openCommit: (sha: string) => void;
  /** Open a compare tab in the HISTORY area. */
  openCompare: (fromSha: string, toSha: string) => void;
  /** Open a between-commits file diff tab in the HISTORY area. */
  openCommitFileDiff: (path: string, toSha: string, fromSha?: string | null) => void;
  /** Open a rendered preview in the EDITOR area (switches activity). */
  openPreview: (path: string) => void;
  /** Open/activate an untitled editor tab in the EDITOR area (Ctrl+T,
   *  see lib/untitled); switches the activity so the tab is visible. */
  openUntitled: (path: string) => void;
  setHistoryCompareBase: (sha: string | null) => void;
  /** Close one tab (in whichever area owns it). */
  closeTab: (key: string) => void;
  /** Close every OTHER tab in the area that owns `key`. */
  closeOtherTabs: (key: string) => void;
  /** Close all tabs of the CURRENT activity's area (no-op on terminal). */
  closeAllTabs: () => void;
  setActiveTab: (key: string) => void;
  toggleDiffMode: () => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setSettingsSection: (s: SettingsSection) => void;

  setCursorPos: (p: { line: number; col: number } | null) => void;
  setQuickOpenVisible: (v: boolean) => void;
  toggleQuickOpen: () => void;
  toggleFocusPopover: () => void;
  setFocusPopover: (open: boolean) => void;
  /** Split the active tab into the right pane (or close the split). */
  toggleSplit: () => void;
  closeSplit: () => void;
  requestCloseActiveTab: () => void;
  openResolution: (path: string) => void;
  closeResolution: () => void;
}

/** The tab-area state the CURRENT activity displays (null on terminal). */
export const currentAreaTabs = (
  s: Pick<UIState, "activity" | "tabsByArea">,
): AreaTabs | null => {
  const area = areaOfActivity(s.activity);
  return area ? s.tabsByArea[area] : null;
};

const TAB_AREAS: TabArea[] = ["editor", "review", "history"];

/** Return a `tabsByArea` patch with `area` replaced by fn(areaState). */
const patchArea = (
  s: Pick<UIState, "tabsByArea">,
  area: TabArea,
  fn: (a: AreaTabs) => AreaTabs,
): Pick<UIState, "tabsByArea"> => ({
  tabsByArea: { ...s.tabsByArea, [area]: fn(s.tabsByArea[area]) },
});

/** Build a revealLineRequest patch for open* calls: only when a line was
 *  given. Line-less opens leave any unconsumed request untouched. */
const revealPatch = (
  s: Pick<UIState, "revealLineRequest">,
  path: string,
  line?: number,
): Pick<UIState, "revealLineRequest"> =>
  line === undefined
    ? { revealLineRequest: s.revealLineRequest }
    : {
        revealLineRequest: {
          path,
          line,
          nonce: (s.revealLineRequest?.nonce ?? 0) + 1,
          at: Date.now(),
        },
      };

/** Append-if-missing + activate `tab` inside one area's state. */
const upsertTab = (a: AreaTabs, tab: EditorTab): AreaTabs => {
  const key = tabKey(tab);
  return {
    openTabs: a.openTabs.some((t) => tabKey(t) === key) ? a.openTabs : [...a.openTabs, tab],
    activeTabKey: key,
  };
};

/** The area currently owning `key`, if any. */
const areaOfKey = (tabsByArea: Record<TabArea, AreaTabs>, key: string): TabArea | undefined =>
  TAB_AREAS.find((area) => tabsByArea[area].openTabs.some((t) => tabKey(t) === key));

export const useUIStore = create<UIState>((set) => ({
  screen: "welcome",
  workspacePath: null,
  workspaceName: null,
  searchFocusNonce: 0,
  editorPanelMode: "files",
  // Default = FIRST ActivityBar menu item — never a hardcoded id.
  activity: ACTIVITY_MENU[0].id,
  sidebarVisible: true,

  tabsByArea: emptyTabsByArea(),
  selectedFile: null,
  diffMode: "split",
  historyCompareBase: null,
  cursorPos: null,
  quickOpenVisible: false,
  focusPopoverOpen: false,
  splitTabKey: null,
  closeActiveTabNonce: 0,
  resolutionPath: null,

  settingsOpen: false,
  settingsSection: "general",

  setScreen: (screen) => set({ screen }),
  openWorkspace: (path) =>
    set({
      screen: "workspace" as Screen,
      workspacePath: path,
      workspaceName: path.split(/[\\/]/).filter(Boolean).pop() ?? path,
      tabsByArea: emptyTabsByArea(),
      selectedFile: null,
      splitTabKey: null,
      cursorPos: null,
      resolutionPath: null,
    }),
  setActivity: (activity) =>
    set((s) => ({
      activity,
      sidebarVisible: s.activity === activity ? !s.sidebarVisible : true,
    })),
  setEditorPanelMode: (editorPanelMode) => set({ editorPanelMode }),
  openSearch: () =>
    set((state) => ({
      activity: "editor" as Activity,
      editorPanelMode: "search" as EditorPanelMode,
      sidebarVisible: true,
      searchFocusNonce: state.searchFocusNonce + 1,
    })),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleTerminal: () =>
    set((_s) => ({
      activity: "terminal" as Activity,
      sidebarVisible: true,
      quickOpenVisible: false,
    })),
  revealLineRequest: null,
  consumeRevealLine: (nonce) =>
    set((s) => (s.revealLineRequest?.nonce === nonce ? { revealLineRequest: null } : s)),
  openFile: (path, line) =>
    set((s) => ({
      // File tabs belong to the editor area ONLY — follow them there.
      activity: "editor" as Activity,
      sidebarVisible: true,
      selectedFile: path,
      ...patchArea(s, "editor", (a) => upsertTab(a, { kind: "file", path })),
      ...revealPatch(s, path, line),
    })),
  openDiff: (path, line) =>
    set((s) => ({
      selectedFile: path,
      ...patchArea(s, "review", (a) => upsertTab(a, { kind: "diff", path })),
      ...revealPatch(s, path, line),
    })),
  openCommit: (sha) =>
    set((s) => ({
      ...patchArea(s, "history", (a) => upsertTab(a, { kind: "commit", path: sha })),
    })),
  openCompare: (fromSha, toSha) =>
    set((s) => ({
      historyCompareBase: null,
      ...patchArea(s, "history", (a) =>
        upsertTab(a, { kind: "compare", path: `${fromSha}..${toSha}`, fromSha, toSha }),
      ),
    })),
  openPreview: (path) =>
    set((s) => ({
      activity: "editor" as Activity,
      sidebarVisible: true,
      selectedFile: path,
      ...patchArea(s, "editor", (a) => upsertTab(a, { kind: "preview", path })),
    })),
  openCommitFileDiff: (path, toSha, fromSha = null) =>
    set((s) => ({
      selectedFile: path,
      ...patchArea(s, "history", (a) => upsertTab(a, { kind: "commitDiff", path, fromSha, toSha })),
    })),
  openUntitled: (path) =>
    set((s) => ({
      activity: "editor" as Activity,
      sidebarVisible: true,
      ...patchArea(s, "editor", (a) => upsertTab(a, { kind: "untitled", path })),
    })),
  setHistoryCompareBase: (historyCompareBase) => set({ historyCompareBase }),
  closeTab: (key) =>
    set((s) => {
      const area = areaOfKey(s.tabsByArea, key);
      const splitTabKey = s.splitTabKey === key ? null : s.splitTabKey;
      if (!area) return { splitTabKey };
      const a = s.tabsByArea[area];
      const openTabs = a.openTabs.filter((t) => tabKey(t) !== key);
      const newActiveKey =
        a.activeTabKey === key
          ? (openTabs.length ? tabKey(openTabs[openTabs.length - 1]) : null)
          : a.activeTabKey;
      const newTab = openTabs.find((t) => tabKey(t) === newActiveKey);
      return {
        ...patchArea(s, area, () => ({ openTabs, activeTabKey: newActiveKey })),
        selectedFile: newTab?.path ?? null,
        splitTabKey,
      };
    }),
  closeOtherTabs: (key) =>
    set((s) => {
      const area = areaOfKey(s.tabsByArea, key);
      if (!area) return s;
      const kept = s.tabsByArea[area].openTabs.find((t) => tabKey(t) === key);
      if (!kept) return s;
      const splitTabKey =
        s.splitTabKey && s.splitTabKey !== key ? null : s.splitTabKey;
      return {
        ...patchArea(s, area, () => ({ openTabs: [kept], activeTabKey: key })),
        selectedFile: kept.path,
        splitTabKey,
      };
    }),
  closeAllTabs: () =>
    set((s) => {
      const area = areaOfActivity(s.activity);
      if (!area) return s;
      const a = s.tabsByArea[area];
      const splitInArea =
        s.splitTabKey !== null && a.openTabs.some((t) => tabKey(t) === s.splitTabKey);
      return {
        ...patchArea(s, area, () => ({ openTabs: [], activeTabKey: null })),
        // Editor-coupled fields only reset when the editor area is cleared.
        selectedFile: area === "editor" ? null : s.selectedFile,
        splitTabKey: splitInArea ? null : s.splitTabKey,
        cursorPos: area === "editor" ? null : s.cursorPos,
      };
    }),
  setActiveTab: (key) =>
    set((s) => {
      const area = areaOfKey(s.tabsByArea, key);
      if (!area) return s;
      const tab = s.tabsByArea[area].openTabs.find((t) => tabKey(t) === key)!;
      return {
        ...patchArea(s, area, (a) => ({ ...a, activeTabKey: key })),
        selectedFile: tab.path,
      };
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
  toggleFocusPopover: () => set((s) => ({ focusPopoverOpen: !s.focusPopoverOpen })),
  setFocusPopover: (open) => set({ focusPopoverOpen: open }),
  toggleSplit: () =>
    set((s) => ({
      splitTabKey: s.splitTabKey ? null : (currentAreaTabs(s)?.activeTabKey ?? null),
    })),
  closeSplit: () => set({ splitTabKey: null }),
  requestCloseActiveTab: () => set((s) => ({ closeActiveTabNonce: s.closeActiveTabNonce + 1 })),
  openResolution: (resolutionPath) => set({ resolutionPath }),
  closeResolution: () => set({ resolutionPath: null }),
}));

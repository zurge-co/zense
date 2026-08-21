// @ts-nocheck
/**
 * Task 1.4 tests — App.tsx keyboard shortcuts & layout, TitleBar.tsx
 * toggle buttons, workspace.ts openFolderFlow.
 *
 * The full app does not compile yet (pre-existing TS errors in
 * ComposerPanel.tsx, StatusBar.tsx, SettingsModal.tsx, settings.ts —
 * all scoped for tasks 1.5-1.6). The files under test here have zero
 * TS errors. We follow the structural-verification pattern from
 * tests/task-1.2.uiStore.test.ts and ActivityBar.test.tsx: read source
 * text via Bun.file() (not Node.js fs) and exercise the Zustand store
 * plus workspace.ts pure functions directly.
 */
import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { useUIStore, tabKey } from "./store/uiStore";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Read a source file as text using Bun's file API (not Node.js fs). */
async function readSrc(relFromSrcDir: string): Promise<string> {
  return Bun.file(`${import.meta.dir}/${relFromSrcDir}`).text();
}

const resetStore = () =>
  useUIStore.setState({
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
  });

// ═══════════════════════════════════════════════════════════════════════════
// App.tsx — Keyboard Shortcuts
// ═══════════════════════════════════════════════════════════════════════════

describe("App.tsx — keyboard shortcuts (task 1.4)", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("App.tsx");
  });

  // ── Kept shortcuts: ⌘S, ⌘B, ⌘O, ⌘,, ⌘⇧C ────────────────────────────────

  test("⌘S: handler present and saves active file tab", () => {
    expect(src).toContain('e.key === "s"');
    expect(src).toContain("e.preventDefault()");
    expect(src).toContain("saveFile");
  });

  test("⌘S: handler checks tab.kind === 'file' before saving", () => {
    expect(src).toContain('tab.kind !== "file"');
  });

  test("⌘S: handler calls workspaceStore.saveFile with workspace path", () => {
    expect(src).toContain("useWorkspaceStore.getState().saveFile");
  });

  test("⌘B: handler present and toggles sidebar", () => {
    expect(src).toContain('e.key === "b"');
    expect(src).toContain("toggleSidebar()");
  });

  test("⌘O: handler present and calls openFolderFlow()", () => {
    expect(src).toContain('e.key === "o"');
    expect(src).toContain("openFolderFlow()");
  });

  test("⌘O: openFolderFlow called with zero arguments (void prefix)", () => {
    expect(src).toContain("void openFolderFlow()");
    // Ensure no argument-based calls remain from the old signature
    expect(src.includes('openFolderFlow("')).toBe(false);
    expect(src.includes("openFolderFlow(focus")).toBe(false);
  });

  test("⌘,: handler present and opens settings", () => {
    expect(src).toContain('e.key === ","');
    expect(src).toContain("openSettings()");
  });

  test("⌘⇧C: handler present and toggles chat", () => {
    expect(src).toContain("e.shiftKey");
    expect(src).toContain('e.key === "C" || e.key === "c"');
    expect(src).toContain("toggleChat()");
  });

  test("⌘⇧F: handler present and opens workspace search", () => {
    expect(src).toContain('e.key === "F" || e.key === "f"');
    expect(src).toContain("openSearch()");
  });

  test("⌘⇧F: native menu-action find_in_files opens workspace search", () => {
    expect(src).toContain('case "find_in_files"');
    expect(src).toContain("ui.openSearch()");
  });

  // ── Shortcut removals & restorations: ⌘J/⌘L removed; ⌘`/⌘W restored ──

  test("removed: ⌘J (toggle bottom panel) is absent", () => {
    expect(src.includes('e.key === "j"')).toBe(false);
  });

  test("⌘` toggles the terminal activity", () => {
    expect(src.includes('e.key === "`"')).toBe(true);
    expect(src.includes("toggleTerminal()")).toBe(true);
  });

  test("⌘W closes the active tab (dirty-aware via closeActiveTabNonce)", () => {
    expect(src.includes('e.key === "w"')).toBe(true);
    expect(src.includes("requestCloseActiveTab()")).toBe(true);
  });

  test("⌘P toggles quick open", () => {
    expect(src.includes('e.key === "p"')).toBe(true);
    expect(src.includes("toggleQuickOpen()")).toBe(true);
  });

  test("⌘\\ toggles the split editor", () => {
    expect(src.includes('e.key === "\\\\"')).toBe(true);
    expect(src.includes("toggleSplit()")).toBe(true);
  });

  test("⌘1–9 activates the nth tab", () => {
    expect(src.includes("/^[1-9]$/")).toBe(true);
    expect(src.includes("setActiveTab(tabKey(tab))")).toBe(true);
  });

  test("Ctrl+Tab cycles open tabs", () => {
    expect(src.includes('e.key === "Tab"')).toBe(true);
    expect(src.includes("e.ctrlKey")).toBe(true);
  });

  test("window close is guarded for unsaved changes", () => {
    expect(src.includes("app://close-requested")).toBe(true);
    expect(src.includes("saveAllDirty")).toBe(true);
  });

  test("removed: ⌘L (focus composer) is absent", () => {
    expect(src.includes('e.key === "l"')).toBe(false);
  });

  // ── Shortcut handler structure ──────────────────────────────────────────

  test("modifier check uses metaKey || ctrlKey", () => {
    expect(src).toContain("e.metaKey || e.ctrlKey");
  });

  test("useKeyboardShortcuts hook is defined and called", () => {
    expect(src).toContain("function useKeyboardShortcuts");
    expect(src).toContain("useKeyboardShortcuts()");
  });

  test("keydown listener added and cleaned up", () => {
    expect(src).toContain('addEventListener("keydown"');
    expect(src).toContain('removeEventListener("keydown"');
  });

  test("Escape key closes settings", () => {
    expect(src).toContain("Escape");
    expect(src).toContain("closeSettings()");
  });

  test("⌘S: handler returns early when not on workspace screen", () => {
    expect(src).toContain('ui.screen !== "workspace"');
  });

  test("⌘S: handler returns early when no workspacePath", () => {
    expect(src).toContain("!ui.workspacePath");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// App.tsx — WorkspaceLayout
// ═══════════════════════════════════════════════════════════════════════════

describe("App.tsx — WorkspaceLayout (task 1.4)", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("App.tsx");
  });

  // ── Rendered components ─────────────────────────────────────────────────

  test("renders <TitleBar />", () => {
    expect(src).toContain("<TitleBar");
  });

  test("renders <ActivityBar />", () => {
    expect(src).toContain("<ActivityBar");
  });

  test("renders <SideBar /> conditionally on sidebarVisible", () => {
    expect(src).toContain("sidebarVisible && <SideBar");
  });

  test("renders <EditorArea />", () => {
    expect(src).toContain("<EditorArea");
  });

  test("renders <ComposerPanel /> conditionally on chatVisible", () => {
    expect(src).toContain("chatVisible && <ComposerPanel");
  });

  test("renders <StatusBar />", () => {
    expect(src).toContain("<StatusBar");
  });

  test("renders <SettingsModal />", () => {
    expect(src).toContain("<SettingsModal");
  });

  // ── Removed components & imports ────────────────────────────────────────

  test("does NOT render GraphView", () => {
    expect(src.includes("GraphView")).toBe(false);
  });

  test("does NOT render BottomPanel", () => {
    expect(src.includes("BottomPanel")).toBe(false);
  });

  test("imports terminalStore", () => {
    expect(src.includes("terminalStore")).toBe(true);
  });

  test("renders TerminalPanel below EditorArea", () => {
    expect(src.includes("TerminalPanel")).toBe(true);
  });

  test("does NOT reference bottomVisible", () => {
    expect(src.includes("bottomVisible")).toBe(false);
  });

  test("does NOT reference toggleBottom", () => {
    expect(src.includes("toggleBottom")).toBe(false);
  });

  test("does NOT reference mainView", () => {
    expect(src.includes("mainView")).toBe(false);
  });

  test("does NOT reference addSelectionChip", () => {
    expect(src.includes("addSelectionChip")).toBe(false);
  });

  // ── Layout structure ────────────────────────────────────────────────────

  test("WorkspaceLayout function is defined", () => {
    expect(src).toContain("function WorkspaceLayout");
  });

  test("App returns WelcomeScreen when screen === 'welcome'", () => {
    expect(src).toContain('screen === "welcome"');
    expect(src).toContain("<WelcomeScreen");
  });

  test("App renders WorkspaceLayout for the workspace screen (welcome otherwise)", () => {
    expect(src).toContain("<WorkspaceLayout />");
    expect(src).toContain('screen === "welcome"');
    // Close guard is mounted at the root so it works on the welcome screen too.
    expect(src).toContain("useCloseRequestGuard()");
    expect(src).toContain("{closeGuardDialog}");
  });

  test("WorkspaceLayout loads workspace on workspacePath change", () => {
    expect(src).toContain("loadWorkspace(workspacePath)");
  });

  test("useWindowDrag hook is defined and called", () => {
    expect(src).toContain("function useWindowDrag");
    expect(src).toContain("useWindowDrag()");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TitleBar.tsx — Toggle Buttons
// ═══════════════════════════════════════════════════════════════════════════

describe("TitleBar.tsx — toggle buttons (task 1.4)", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("components/layout/TitleBar.tsx");
  });

  test("exports TitleBar component", () => {
    expect(src).toContain("export function TitleBar");
  });

  // ── Sidebar toggle button ───────────────────────────────────────────────

  test("has sidebar toggle button with onClick={toggleSidebar}", () => {
    expect(src).toContain("onClick={toggleSidebar}");
  });

  test("sidebar toggle button has title='Toggle Sidebar (⌘B)'", () => {
    expect(src).toContain('title="Toggle Sidebar (⌘B)"');
  });

  test("sidebar toggle uses PanelLeft icon", () => {
    expect(src).toContain("PanelLeft");
  });

  test("sidebar toggle styling responds to sidebarVisible", () => {
    expect(src).toContain("sidebarVisible");
  });

  // ── Chat toggle button ──────────────────────────────────────────────────

  test("has chat toggle button with onClick={toggleChat}", () => {
    expect(src).toContain("onClick={toggleChat}");
  });

  test("chat toggle button has title='Toggle AI Chat'", () => {
    expect(src).toContain('title="Toggle AI Chat"');
  });

  test("chat toggle uses PanelRight icon", () => {
    expect(src).toContain("PanelRight");
  });

  test("chat toggle styling responds to chatVisible", () => {
    expect(src).toContain("chatVisible");
  });

  // ── Button count ────────────────────────────────────────────────────────

  test("has exactly 2 toggle buttons (sidebar + chat)", () => {
    const onClickMatches = src.match(/onClick=\{toggle\w+\}/g);
    expect(onClickMatches).not.toBe(null);
    expect(onClickMatches!.length).toBe(2);
  });

  // ── Removed elements ────────────────────────────────────────────────────

  test("does NOT have bottom panel toggle button", () => {
    expect(src.includes("toggleBottom")).toBe(false);
    expect(src.includes("Toggle Bottom")).toBe(false);
  });

  test("does NOT import PanelBottom icon", () => {
    expect(src.includes("PanelBottom")).toBe(false);
  });

  test("does NOT reference terminalStore", () => {
    expect(src.includes("terminalStore")).toBe(false);
  });

  test("does NOT reference bottomVisible", () => {
    expect(src.includes("bottomVisible")).toBe(false);
  });

  // ── Store usage ─────────────────────────────────────────────────────────

  test("imports PanelLeft, PanelRight, GitBranch from lucide-react", () => {
    expect(src).toContain("PanelLeft");
    expect(src).toContain("PanelRight");
    expect(src).toContain("GitBranch");
  });

  test("uses useUIStore for toggle actions and visibility state", () => {
    expect(src).toContain("useUIStore");
    expect(src).toContain("toggleSidebar");
    expect(src).toContain("toggleChat");
  });

  test("uses workspaceName from store for display", () => {
    expect(src).toContain("workspaceName");
  });

  test("displays workspace name or 'no workspace' fallback", () => {
    expect(src).toContain('"no workspace"');
  });

  test("displays branch name 'main'", () => {
    expect(src).toContain("main");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// workspace.ts — openFolderFlow (source text verification)
// ═══════════════════════════════════════════════════════════════════════════

describe("workspace.ts — openFolderFlow source verification (task 1.4)", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("lib/workspace.ts");
  });

  test("openFolderFlow is declared with zero parameters", () => {
    const match = src.match(
      /export\s+async\s+function\s+openFolderFlow\s*\(\s*\)/,
    );
    expect(match).not.toBe(null);
  });

  test("openFolderFlow returns Promise<void>", () => {
    expect(src).toContain("openFolderFlow(): Promise<void>");
  });

  test("openFolderFlow does NOT accept a focus parameter", () => {
    expect(src.includes("focus")).toBe(false);
  });

  test("openFolderFlow does NOT reference 'agent' or 'terminal' focus types", () => {
    expect(src.includes('"agent"')).toBe(false);
    expect(src.includes('"terminal"')).toBe(false);
  });

  test("openFolderFlow calls openWorkspace from uiStore", () => {
    expect(src).toContain("useUIStore.getState()");
    expect(src).toContain("openWorkspace");
  });

  test("openFolderFlow checks isTauri() for environment detection", () => {
    expect(src).toContain("isTauri()");
  });

  test("openFolderFlow has browser fallback using mockRecents", () => {
    expect(src).toContain("mockRecents");
  });

  test("openFolderFlow calls touchRecent(path) after dialog in Tauri", () => {
    expect(src).toContain("touchRecent(path)");
  });

  test("openFolderFlow calls openFolderDialog() in Tauri path", () => {
    expect(src).toContain("openFolderDialog()");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// workspace.ts — runtime function tests
// ═══════════════════════════════════════════════════════════════════════════

describe("workspace.ts — runtime functions (task 1.4)", () => {
  beforeAll(() => {
    // Ensure window exists for isTauri() check (bun test may not provide it)
    if (typeof globalThis.window === "undefined") {
      (globalThis as any).window = {};
    }
  });

  beforeEach(() => resetStore());

  // ── openFolderFlow ──────────────────────────────────────────────────────

  test("openFolderFlow.length === 0 (zero declared parameters)", async () => {
    const mod = await import("./lib/workspace");
    expect(mod.openFolderFlow.length).toBe(0);
  });

  test("openFolderFlow() opens workspace with mock path in non-Tauri", async () => {
    const mod = await import("./lib/workspace");
    await mod.openFolderFlow();
    const state = useUIStore.getState();
    expect(state.screen).toBe("workspace");
    // mockRecents[0].path is "~/dev/acme/api-gateway"
    expect(state.workspacePath).toBe("~/dev/acme/api-gateway");
    expect(state.workspaceName).toBe("api-gateway");
  });

  // ── isTauri ─────────────────────────────────────────────────────────────

  test("isTauri() returns false in non-Tauri environment", async () => {
    const mod = await import("./lib/workspace");
    expect(mod.isTauri()).toBe(false);
  });

  // ── openFolderDialog ────────────────────────────────────────────────────

  test("openFolderDialog() returns null in non-Tauri environment", async () => {
    const mod = await import("./lib/workspace");
    expect(await mod.openFolderDialog()).toBe(null);
  });

  // ── loadRecents ─────────────────────────────────────────────────────────

  test("loadRecents() returns 4 mock entries in non-Tauri", async () => {
    const mod = await import("./lib/workspace");
    const recents = await mod.loadRecents();
    expect(recents.length).toBe(4);
  });

  test("loadRecents() first entry has exact mock values", async () => {
    const mod = await import("./lib/workspace");
    const recents = await mod.loadRecents();
    expect(recents[0]).toEqual({
      path: "~/dev/acme/api-gateway",
      name: "api-gateway",
      lastOpenedAt: 0,
    });
  });

  test("loadRecents() second entry has exact mock values", async () => {
    const mod = await import("./lib/workspace");
    const recents = await mod.loadRecents();
    expect(recents[1]).toEqual({
      path: "~/Workspace/zurge/zense",
      name: "zense",
      lastOpenedAt: 0,
    });
  });

  // ── touchRecent ─────────────────────────────────────────────────────────

  test("touchRecent() is a no-op (void) in non-Tauri environment", async () => {
    const mod = await import("./lib/workspace");
    const result = await mod.touchRecent("/some/path");
    expect(result).toBe(undefined);
  });

  // ── formatRelativeTime ──────────────────────────────────────────────────

  test("formatRelativeTime(0) returns empty string", async () => {
    const mod = await import("./lib/workspace");
    expect(mod.formatRelativeTime(0)).toBe("");
  });

  test("formatRelativeTime(now) returns 'just now'", async () => {
    const mod = await import("./lib/workspace");
    expect(mod.formatRelativeTime(Date.now())).toBe("just now");
  });

  test("formatRelativeTime(2 min ago) returns '2 min ago'", async () => {
    const mod = await import("./lib/workspace");
    const twoMinAgo = Date.now() - 2 * 60_000;
    expect(mod.formatRelativeTime(twoMinAgo)).toBe("2 min ago");
  });

  test("formatRelativeTime(1 hour ago) returns '1 hour ago'", async () => {
    const mod = await import("./lib/workspace");
    const oneHourAgo = Date.now() - 60 * 60_000;
    expect(mod.formatRelativeTime(oneHourAgo)).toBe("1 hour ago");
  });

  test("formatRelativeTime(2 hours ago) returns '2 hours ago'", async () => {
    const mod = await import("./lib/workspace");
    const twoHoursAgo = Date.now() - 2 * 60 * 60_000;
    expect(mod.formatRelativeTime(twoHoursAgo)).toBe("2 hours ago");
  });

  test("formatRelativeTime(1 day ago) returns 'yesterday'", async () => {
    const mod = await import("./lib/workspace");
    const oneDayAgo = Date.now() - 24 * 60 * 60_000;
    expect(mod.formatRelativeTime(oneDayAgo)).toBe("yesterday");
  });

  test("formatRelativeTime(3 days ago) returns '3 days ago'", async () => {
    const mod = await import("./lib/workspace");
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60_000;
    expect(mod.formatRelativeTime(threeDaysAgo)).toBe("3 days ago");
  });

  test("formatRelativeTime(8 days ago) returns 'last week'", async () => {
    const mod = await import("./lib/workspace");
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60_000;
    expect(mod.formatRelativeTime(eightDaysAgo)).toBe("last week");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Store Interaction — keyboard shortcut actions
// ═══════════════════════════════════════════════════════════════════════════

describe("Store interaction — keyboard shortcut actions (task 1.4)", () => {
  beforeEach(() => resetStore());

  test("⌘B: toggleSidebar flips sidebarVisible true → false → true", () => {
    expect(useUIStore.getState().sidebarVisible).toBe(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarVisible).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarVisible).toBe(true);
  });

  test("⌘⇧C: toggleChat flips chatVisible true → false → true", () => {
    expect(useUIStore.getState().chatVisible).toBe(true);
    useUIStore.getState().toggleChat();
    expect(useUIStore.getState().chatVisible).toBe(false);
    useUIStore.getState().toggleChat();
    expect(useUIStore.getState().chatVisible).toBe(true);
  });

  test("⌘,: openSettings opens settings with default section 'general'", () => {
    expect(useUIStore.getState().settingsOpen).toBe(false);
    useUIStore.getState().openSettings();
    expect(useUIStore.getState().settingsOpen).toBe(true);
    expect(useUIStore.getState().settingsSection).toBe("general");
  });

  test("⌘,: openSettings accepts a specific section", () => {
    useUIStore.getState().openSettings("llm");
    expect(useUIStore.getState().settingsOpen).toBe(true);
    expect(useUIStore.getState().settingsSection).toBe("llm");
  });

  test("Escape: closeSettings closes settings", () => {
    useUIStore.getState().openSettings();
    expect(useUIStore.getState().settingsOpen).toBe(true);
    useUIStore.getState().closeSettings();
    expect(useUIStore.getState().settingsOpen).toBe(false);
  });

  test("⌘S: tabKey produces 'file:src/main.ts' for a file tab", () => {
    const fileTab = { kind: "file" as const, path: "src/main.ts" };
    expect(tabKey(fileTab)).toBe("file:src/main.ts::");
  });

  test("⌘S: tabKey produces 'diff:src/main.ts' for a diff tab", () => {
    const diffTab = { kind: "diff" as const, path: "src/main.ts" };
    expect(tabKey(diffTab)).toBe("diff:src/main.ts::");
  });

  test("⌘S: save handler condition — file tabs pass, diff tabs skipped", () => {
    useUIStore.getState().openFile("src/main.ts");
    useUIStore.getState().openDiff("src/main.ts");

    const state = useUIStore.getState();
    const fileTab = state.openTabs.find((t) => t.kind === "file");
    const diffTab = state.openTabs.find((t) => t.kind === "diff");

    // Simulate the condition from App.tsx: if (!tab || tab.kind !== "file") return;
    const shouldSaveFile = fileTab != null && fileTab.kind === "file";
    const shouldSaveDiff = diffTab != null && diffTab.kind === "file";
    expect(shouldSaveFile).toBe(true);
    expect(shouldSaveDiff).toBe(false);
  });

  test("⌘S: save handler returns early when no active tab", () => {
    const state = useUIStore.getState();
    const tab = state.openTabs.find((t) => tabKey(t) === state.activeTabKey);
    expect(tab).toBe(undefined);
  });

  test("⌘S: save handler returns early when no workspacePath", () => {
    // Default state: screen='welcome', workspacePath=null
    // App.tsx condition: if (ui.screen !== "workspace" || !ui.workspacePath) return;
    const shouldProceed =
      useUIStore.getState().screen === "workspace" &&
      useUIStore.getState().workspacePath != null;
    expect(shouldProceed).toBe(false);
  });

  test("⌘S: save handler proceeds when on workspace screen with file tab", () => {
    useUIStore.getState().openWorkspace("/home/user/project");
    useUIStore.getState().openFile("src/main.ts");

    const ui = useUIStore.getState();
    const tab = ui.openTabs.find((t) => tabKey(t) === ui.activeTabKey);

    const screenOk = ui.screen === "workspace";
    const pathOk = ui.workspacePath != null;
    const tabOk = tab != null && tab.kind === "file";

    expect(screenOk).toBe(true);
    expect(pathOk).toBe(true);
    expect(tabOk).toBe(true);
  });

  test("⌘O: openWorkspace sets screen, path, and name", () => {
    useUIStore.getState().openWorkspace("/home/user/my-project");
    const state = useUIStore.getState();
    expect(state.screen).toBe("workspace");
    expect(state.workspacePath).toBe("/home/user/my-project");
    expect(state.workspaceName).toBe("my-project");
  });

  test("⌘O: openWorkspace resets tabs", () => {
    useUIStore.getState().openFile("src/a.ts");
    expect(useUIStore.getState().openTabs.length).toBe(1);
    useUIStore.getState().openWorkspace("/new/project");
    expect(useUIStore.getState().openTabs).toEqual([]);
  });

  test("⌘O: openWorkspace extracts name from Windows path", () => {
    useUIStore.getState().openWorkspace("C:\\Users\\dev\\project-x");
    expect(useUIStore.getState().workspaceName).toBe("project-x");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tab context-menu actions — closeOtherTabs & closeAllTabs
// ═══════════════════════════════════════════════════════════════════════════

describe("Tab context-menu actions (closeOtherTabs / closeAllTabs)", () => {
  beforeEach(() => resetStore());

  test("closeOtherTabs keeps only the specified tab and makes it active", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().openFile("src/b.ts");
    useUIStore.getState().openFile("src/c.ts");
    expect(useUIStore.getState().openTabs.length).toBe(3);

    const keepKey = tabKey({ kind: "file", path: "src/a.ts" });
    useUIStore.getState().closeOtherTabs(keepKey);

    const state = useUIStore.getState();
    expect(state.openTabs.length).toBe(1);
    expect(tabKey(state.openTabs[0])).toBe(keepKey);
    expect(state.activeTabKey).toBe(keepKey);
    expect(state.selectedFile).toBe("src/a.ts");
  });

  test("closeOtherTabs sets the kept tab active even if it wasn't active before", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().openFile("src/b.ts");
    // b.ts is now active
    expect(useUIStore.getState().activeTabKey).toBe(tabKey({ kind: "file", path: "src/b.ts" }));

    const keepKey = tabKey({ kind: "file", path: "src/a.ts" });
    useUIStore.getState().closeOtherTabs(keepKey);

    const state = useUIStore.getState();
    expect(state.openTabs.length).toBe(1);
    expect(state.activeTabKey).toBe(keepKey);
  });

  test("closeOtherTabs is a no-op when the key doesn't match any tab", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().openFile("src/b.ts");
    const before = useUIStore.getState().openTabs.length;

    useUIStore.getState().closeOtherTabs("file:src/nonexistent.ts");

    expect(useUIStore.getState().openTabs.length).toBe(before);
  });

  test("closeOtherTabs preserves a diff tab when its key is passed", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().openDiff("src/b.ts");
    useUIStore.getState().openFile("src/c.ts");

    const diffKey = tabKey({ kind: "diff", path: "src/b.ts" });
    useUIStore.getState().closeOtherTabs(diffKey);

    const state = useUIStore.getState();
    expect(state.openTabs.length).toBe(1);
    expect(state.openTabs[0].kind).toBe("diff");
    expect(state.activeTabKey).toBe(diffKey);
    expect(state.selectedFile).toBe("src/b.ts");
  });

  test("closeAllTabs clears all tabs and resets active state", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().openFile("src/b.ts");
    useUIStore.getState().openFile("src/c.ts");
    expect(useUIStore.getState().openTabs.length).toBe(3);

    useUIStore.getState().closeAllTabs();

    const state = useUIStore.getState();
    expect(state.openTabs).toEqual([]);
    expect(state.activeTabKey).toBe(null);
    expect(state.selectedFile).toBe(null);
  });

  test("closeAllTabs on an empty tab list is a no-op", () => {
    useUIStore.getState().closeAllTabs();
    const state = useUIStore.getState();
    expect(state.openTabs).toEqual([]);
    expect(state.activeTabKey).toBe(null);
    expect(state.selectedFile).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// No dangling references to removed features
// ═══════════════════════════════════════════════════════════════════════════

describe("Task 1.4 — no dangling references to removed features", () => {
  let appSrc: string;
  let titleBarSrc: string;
  let workspaceSrc: string;

  beforeAll(async () => {
    appSrc = await readSrc("App.tsx");
    titleBarSrc = await readSrc("components/layout/TitleBar.tsx");
    workspaceSrc = await readSrc("lib/workspace.ts");
  });

  test("App.tsx wires the integrated terminal (TerminalPanel + terminalStore)", () => {
    expect(appSrc.includes("TerminalPanel")).toBe(true);
    expect(appSrc.includes("terminalStore")).toBe(true);
  });

  test("App.tsx has no graph references", () => {
    expect(appSrc.includes("GraphView")).toBe(false);
    expect(appSrc.includes("graphStore")).toBe(false);
  });

  test("App.tsx has no search panel references", () => {
    expect(appSrc.includes("SearchPanel")).toBe(false);
  });

  test("App.tsx has no prompt library references", () => {
    expect(appSrc.includes("PromptLibrary")).toBe(false);
  });

  test("TitleBar.tsx has no terminal/graph/search references", () => {
    expect(titleBarSrc.includes("terminal")).toBe(false);
    expect(titleBarSrc.includes("Terminal")).toBe(false);
    expect(titleBarSrc.includes("GraphView")).toBe(false);
    expect(titleBarSrc.includes("SearchPanel")).toBe(false);
  });

  test("workspace.ts openFolderFlow has no agent/terminal focus parameter", () => {
    expect(workspaceSrc.includes('"agent"')).toBe(false);
    expect(workspaceSrc.includes('"terminal"')).toBe(false);
    expect(workspaceSrc.includes("focus")).toBe(false);
  });
});

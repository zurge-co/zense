import { describe, test, expect, beforeEach } from "bun:test";
import { useUIStore, emptyTabsByArea } from "../src/store/uiStore";

describe("uiStore — task 1.2 cleanup verification", () => {
  beforeEach(() => {
    // Reset to a known state before each test.
    useUIStore.setState({
      screen: "welcome",
      workspacePath: null,
      workspaceName: null,
      activity: "review",
      sidebarVisible: true,
      editorPanelMode: "files",
      focusPopoverOpen: false,
      tabsByArea: emptyTabsByArea(),
      selectedFile: null,
      diffMode: "split",
      settingsOpen: false,
      settingsSection: "general",
    });
  });

  // ── Removed fields must not exist on the store ──────────────────────────

  const removedFields = [
    "mainView",
    "bottomVisible",
    "agentCommand",
    "attachCode",
    "autoOpenTerminal",
    "composerDraft",
    "contextChips",
    "sentLog",
    "shellProfile",
    "bottomHeight",
  ];

  const removedActions = [
    "toggleBottom",
    "setAgentCommand",
    "setAttachCode",
    "setAutoOpenTerminal",
    "setShellProfile",
    "setBottomHeight",
    "setComposerDraft",
    "addChip",
    "removeChip",
    "addSelectionChip",
    "sendToAgent",
  ];

  test.each(removedFields)("store does NOT have removed field: %s", (field) => {
    const state = useUIStore.getState();
    expect(field in state).toBe(false);
  });

  test.each(removedActions)("store does NOT have removed action: %s", (action) => {
    const state = useUIStore.getState();
    expect(action in state).toBe(false);
  });

  // ── Default values ──────────────────────────────────────────────────────

  test("initial activity derives from the first ActivityBar menu item", () => {
    // The app DEFAULT (store initializer) is ACTIVITY_MENU[0].id, never a
    // hardcoded id — see tests/per-area-tabs.test.ts. Here we only verify
    // the field is settable (this suite's reset parks it on "review").
    useUIStore.setState({ activity: "review" });
    expect(useUIStore.getState().activity).toBe("review");
  });

  test("initial screen is 'welcome'", () => {
    expect(useUIStore.getState().screen).toBe("welcome");
  });

  test("initial diffMode is 'split'", () => {
    expect(useUIStore.getState().diffMode).toBe("split");
  });

  test("initial sidebarVisible is true", () => {
    expect(useUIStore.getState().sidebarVisible).toBe(true);
  });

  test("initial editorPanelMode is 'files'", () => {
    expect(useUIStore.getState().editorPanelMode).toBe("files");
  });

  test("initial tabsByArea is empty for every area", () => {
    expect(useUIStore.getState().tabsByArea).toEqual(emptyTabsByArea());
  });

  test("initial per-area activeTabKey is null", () => {
    const { tabsByArea } = useUIStore.getState();
    expect(tabsByArea.editor.activeTabKey).toBe(null);
    expect(tabsByArea.review.activeTabKey).toBe(null);
    expect(tabsByArea.history.activeTabKey).toBe(null);
  });

  test("initial selectedFile is null", () => {
    expect(useUIStore.getState().selectedFile).toBe(null);
  });

  test("initial settingsOpen is false", () => {
    expect(useUIStore.getState().settingsOpen).toBe(false);
  });

  test("initial settingsSection is 'general'", () => {
    expect(useUIStore.getState().settingsSection).toBe("general");
  });

  // ── Kept fields DO exist ────────────────────────────────────────────────

  test("store has field: editorPanelMode", () => {
    expect("editorPanelMode" in useUIStore.getState()).toBe(true);
  });

  test("store has action: openSearch", () => {
    expect(typeof useUIStore.getState().openSearch).toBe("function");
  });

  // ── setActivity ─────────────────────────────────────────────────────────

  test("setActivity switches activity to 'history'", () => {
    useUIStore.getState().setActivity("history");
    const state = useUIStore.getState();
    expect(state.activity).toBe("history");
    expect(state.sidebarVisible).toBe(true);
  });

  test("setActivity switches activity to 'editor'", () => {
    useUIStore.getState().setActivity("editor");
    expect(useUIStore.getState().activity).toBe("editor");
  });

  test("setActivity toggles sidebar when same activity clicked", () => {
    useUIStore.getState().setActivity("review"); // same as default → toggles to false
    expect(useUIStore.getState().sidebarVisible).toBe(false);
    useUIStore.getState().setActivity("review"); // toggles back to true
    expect(useUIStore.getState().sidebarVisible).toBe(true);
  });

  test("setActivity shows sidebar when switching to a different activity", () => {
    useUIStore.getState().setActivity("review"); // toggle off
    expect(useUIStore.getState().sidebarVisible).toBe(false);
    useUIStore.getState().setActivity("history"); // different → force true
    const state = useUIStore.getState();
    expect(state.activity).toBe("history");
    expect(state.sidebarVisible).toBe(true);
  });

  // ── openWorkspace ───────────────────────────────────────────────────────

  test("openWorkspace sets screen, path, name and resets tabs", () => {
    useUIStore.getState().openWorkspace("/home/user/my-project");
    const state = useUIStore.getState();
    expect(state.screen).toBe("workspace");
    expect(state.workspacePath).toBe("/home/user/my-project");
    expect(state.workspaceName).toBe("my-project");
    expect(state.tabsByArea).toEqual(emptyTabsByArea());
    expect(state.selectedFile).toBe(null);
  });

  test("openWorkspace extracts workspace name from Windows-style path", () => {
    useUIStore.getState().openWorkspace("C:\\Users\\dev\\project-x");
    expect(useUIStore.getState().workspaceName).toBe("project-x");
  });

  test("openWorkspace resets tabs even if previously populated", () => {
    useUIStore.getState().openFile("src/foo.ts");
    expect(useUIStore.getState().tabsByArea.editor.openTabs.length).toBe(1);
    useUIStore.getState().openWorkspace("/home/user/new-project");
    expect(useUIStore.getState().tabsByArea).toEqual(emptyTabsByArea());
  });

  // ── Tab management ──────────────────────────────────────────────────────

  test("openFile adds a file tab to the EDITOR area and sets it active", () => {
    useUIStore.getState().openFile("src/main.ts");
    const state = useUIStore.getState();
    expect(state.tabsByArea.editor.openTabs).toEqual([{ kind: "file", path: "src/main.ts" }]);
    expect(state.tabsByArea.editor.activeTabKey).toBe("file:src/main.ts::");
    expect(state.selectedFile).toBe("src/main.ts");
  });

  test("openFile does not duplicate an already-open tab", () => {
    useUIStore.getState().openFile("src/main.ts");
    useUIStore.getState().openFile("src/main.ts");
    expect(useUIStore.getState().tabsByArea.editor.openTabs).toEqual([
      { kind: "file", path: "src/main.ts" },
    ]);
  });

  test("openDiff adds a diff tab to the REVIEW area and sets it active", () => {
    useUIStore.getState().openDiff("src/main.ts");
    const state = useUIStore.getState();
    expect(state.tabsByArea.review.openTabs).toEqual([{ kind: "diff", path: "src/main.ts" }]);
    expect(state.tabsByArea.review.activeTabKey).toBe("diff:src/main.ts::");
    expect(state.selectedFile).toBe("src/main.ts");
  });

  test("openFile and openDiff never mix: one tab per area for the same path", () => {
    useUIStore.getState().openFile("src/main.ts");
    useUIStore.getState().openDiff("src/main.ts");
    const { tabsByArea } = useUIStore.getState();
    expect(tabsByArea.editor.openTabs).toEqual([{ kind: "file", path: "src/main.ts" }]);
    expect(tabsByArea.review.openTabs).toEqual([{ kind: "diff", path: "src/main.ts" }]);
  });

  test("closeTab removes the tab", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().openFile("src/b.ts");
    useUIStore.getState().closeTab("file:src/a.ts::");
    const state = useUIStore.getState();
    expect(state.tabsByArea.editor.openTabs).toEqual([{ kind: "file", path: "src/b.ts" }]);
  });

  test("closeTab on active tab switches active to last remaining tab", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().openFile("src/b.ts");
    // active is now b
    useUIStore.getState().closeTab("file:src/b.ts::");
    const state = useUIStore.getState();
    expect(state.tabsByArea.editor.activeTabKey).toBe("file:src/a.ts::");
    expect(state.selectedFile).toBe("src/a.ts");
  });

  test("closeTab on active tab with no remaining tabs nulls activeTabKey", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().closeTab("file:src/a.ts::");
    expect(useUIStore.getState().tabsByArea.editor.activeTabKey).toBe(null);
  });

  test("closeTab on inactive tab does not change activeTabKey", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().openFile("src/b.ts");
    useUIStore.getState().closeTab("file:src/a.ts::");
    expect(useUIStore.getState().tabsByArea.editor.activeTabKey).toBe("file:src/b.ts::");
  });

  test("setActiveTab updates activeTabKey and selectedFile", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().openFile("src/b.ts");
    useUIStore.getState().setActiveTab("file:src/a.ts::");
    const state = useUIStore.getState();
    expect(state.tabsByArea.editor.activeTabKey).toBe("file:src/a.ts::");
    expect(state.selectedFile).toBe("src/a.ts");
  });

  // ── toggleDiffMode ──────────────────────────────────────────────────────

  test("toggleDiffMode switches split → inline → split", () => {
    expect(useUIStore.getState().diffMode).toBe("split");
    useUIStore.getState().toggleDiffMode();
    expect(useUIStore.getState().diffMode).toBe("inline");
    useUIStore.getState().toggleDiffMode();
    expect(useUIStore.getState().diffMode).toBe("split");
  });

  // ── Settings ────────────────────────────────────────────────────────────

  test("openSettings opens with default section 'general'", () => {
    useUIStore.getState().openSettings();
    const state = useUIStore.getState();
    expect(state.settingsOpen).toBe(true);
    expect(state.settingsSection).toBe("general");
  });

  test("openSettings opens with specified section", () => {
    useUIStore.getState().openSettings("llm");
    const state = useUIStore.getState();
    expect(state.settingsOpen).toBe(true);
    expect(state.settingsSection).toBe("llm");
  });

  test("closeSettings closes settings", () => {
    useUIStore.getState().openSettings();
    useUIStore.getState().closeSettings();
    expect(useUIStore.getState().settingsOpen).toBe(false);
  });

  test("setSettingsSection changes section", () => {
    useUIStore.getState().setSettingsSection("appearance");
    expect(useUIStore.getState().settingsSection).toBe("appearance");
  });

  // ── toggleSidebar / search mode ───────────────────────────────────────

  test("toggleSidebar flips sidebarVisible", () => {
    expect(useUIStore.getState().sidebarVisible).toBe(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarVisible).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarVisible).toBe(true);
  });

  test("openSearch opens the Editor activity in search mode (⌘⇧F)", () => {
    const before = useUIStore.getState().searchFocusNonce;
    useUIStore.getState().openSearch();
    const s = useUIStore.getState();
    expect(s.activity).toBe("editor");
    expect(s.editorPanelMode).toBe("search");
    expect(s.sidebarVisible).toBe(true);
    expect(s.searchFocusNonce).toBe(before + 1);
  });

  test("setEditorPanelMode switches back to the file explorer", () => {
    useUIStore.getState().openSearch();
    useUIStore.getState().setEditorPanelMode("files");
    expect(useUIStore.getState().editorPanelMode).toBe("files");
  });

  test("toggleFocusPopover flips focusPopoverOpen", () => {
    expect(useUIStore.getState().focusPopoverOpen).toBe(false);
    useUIStore.getState().toggleFocusPopover();
    expect(useUIStore.getState().focusPopoverOpen).toBe(true);
    useUIStore.getState().toggleFocusPopover();
    expect(useUIStore.getState().focusPopoverOpen).toBe(false);
  });

  // ── setScreen ───────────────────────────────────────────────────────────

  test("setScreen changes screen value", () => {
    useUIStore.getState().setScreen("workspace");
    expect(useUIStore.getState().screen).toBe("workspace");
    useUIStore.getState().setScreen("welcome");
    expect(useUIStore.getState().screen).toBe("welcome");
  });
});

// ── CodeEditor.tsx structural verification ──────────────────────────────
// We verify the source text directly rather than rendering, since the full
// app won't compile until tasks 1.3-1.6.

describe("CodeEditor.tsx — task 1.2 structural verification", () => {
  const fs = require("fs");
  const path = require("path");
  const src: string = fs.readFileSync(
    path.resolve(__dirname, "../src/components/editor/CodeEditor.tsx"),
    "utf-8",
  );

  test("imports useUIStore only for live cursor reporting (StatusBar)", () => {
    expect(src).toContain("useUIStore");
    expect(src).toContain("setCursorPos");
  });

  test("does NOT contain addSelectionChip", () => {
    expect(src.includes("addSelectionChip")).toBe(false);
  });

  test("does NOT contain 'Add Selection' action", () => {
    expect(src.includes("Add Selection")).toBe(false);
  });

  test("does NOT contain 'zense.addSelectionToAgent' action id", () => {
    expect(src.includes("zense.addSelectionToAgent")).toBe(false);
  });

  test("does NOT use monacoInstance parameter", () => {
    expect(src.includes("monacoInstance")).toBe(false);
  });

  test("has readOnly prop with default false", () => {
    expect(src.includes("readOnly = false")).toBe(true);
  });

  test("has onChange callback prop", () => {
    expect(src.includes("onChange")).toBe(true);
  });

  test("passes readOnly to Monaco options (not hardcoded true)", () => {
    expect(src.includes("readOnly: true")).toBe(false);
    expect(src.includes("readOnly,")).toBe(true);
  });
});

// ── EditorArea.tsx structural verification ──────────────────────────────

describe("EditorArea.tsx — task 1.2 structural verification", () => {
  const fs = require("fs");
  const path = require("path");
  const src: string = fs.readFileSync(
    path.resolve(__dirname, "../src/components/editor/EditorArea.tsx"),
    "utf-8",
  );

  test("does NOT contain explainInAgent function", () => {
    expect(src.includes("explainInAgent")).toBe(false);
  });

  test("does NOT contain 'Explain' button", () => {
    // Match the word "Explain" as a button label, not as a substring of other words
    expect(src.match(/\bExplain\b/)).toBe(null);
  });

  test("does NOT destructure addChip from uiStore", () => {
    expect(src.includes("addChip")).toBe(false);
  });

  test("does NOT destructure chatVisible from uiStore", () => {
    // chatVisible should not be destructured from the store in EditorArea
    // (it may appear in other files, but not here)
    expect(src.includes("chatVisible")).toBe(false);
  });

  test("does NOT destructure toggleChat from uiStore", () => {
    expect(src.includes("toggleChat")).toBe(false);
  });

  test("imports markDirty from workspaceStore", () => {
    expect(src.includes("markDirty")).toBe(true);
  });

  test("imports saveFile from workspaceStore", () => {
    expect(src.includes("saveFile")).toBe(true);
  });

  test("imports clearDirty from workspaceStore", () => {
    expect(src.includes("clearDirty")).toBe(true);
  });

  test("uses dirtyPaths from workspaceStore", () => {
    expect(src.includes("dirtyPaths")).toBe(true);
  });

  test("passes onChange to CodeEditor", () => {
    expect(src.includes("onChange={(value) => markDirty")).toBe(true);
  });

  test("Sparkles import is still used (empty state)", () => {
    expect(src.includes("Sparkles")).toBe(true);
  });
});

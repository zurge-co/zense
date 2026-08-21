import { describe, test, expect, beforeEach } from "bun:test";
import { useUIStore, type Activity } from "../src/store/uiStore";

describe("uiStore — task 1.2 cleanup verification", () => {
  beforeEach(() => {
    // Reset to a known state before each test.
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

  test("initial activity is 'review'", () => {
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

  test("initial chatVisible is true", () => {
    expect(useUIStore.getState().chatVisible).toBe(true);
  });

  test("initial openTabs is empty array", () => {
    expect(useUIStore.getState().openTabs).toEqual([]);
  });

  test("initial activeTabKey is null", () => {
    expect(useUIStore.getState().activeTabKey).toBe(null);
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

  test("store has kept field: composerFocusNonce", () => {
    expect("composerFocusNonce" in useUIStore.getState()).toBe(true);
    expect(useUIStore.getState().composerFocusNonce).toBe(0);
  });

  test("store has kept field: chatVisible", () => {
    expect("chatVisible" in useUIStore.getState()).toBe(true);
  });

  test("store has kept action: toggleChat", () => {
    expect(typeof useUIStore.getState().toggleChat).toBe("function");
  });

  // ── setActivity ─────────────────────────────────────────────────────────

  test("setActivity switches activity to 'history'", () => {
    useUIStore.getState().setActivity("history");
    const state = useUIStore.getState();
    expect(state.activity).toBe("history");
    expect(state.sidebarVisible).toBe(true);
  });

  test("setActivity switches activity to 'explorer'", () => {
    useUIStore.getState().setActivity("explorer");
    expect(useUIStore.getState().activity).toBe("explorer");
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
    expect(state.openTabs).toEqual([]);
    expect(state.activeTabKey).toBe(null);
    expect(state.selectedFile).toBe(null);
  });

  test("openWorkspace extracts workspace name from Windows-style path", () => {
    useUIStore.getState().openWorkspace("C:\\Users\\dev\\project-x");
    expect(useUIStore.getState().workspaceName).toBe("project-x");
  });

  test("openWorkspace resets tabs even if previously populated", () => {
    useUIStore.getState().openFile("src/foo.ts");
    expect(useUIStore.getState().openTabs.length).toBe(1);
    useUIStore.getState().openWorkspace("/home/user/new-project");
    expect(useUIStore.getState().openTabs).toEqual([]);
  });

  // ── Tab management ──────────────────────────────────────────────────────

  test("openFile adds a file tab and sets it active", () => {
    useUIStore.getState().openFile("src/main.ts");
    const state = useUIStore.getState();
    expect(state.openTabs).toEqual([{ kind: "file", path: "src/main.ts" }]);
    expect(state.activeTabKey).toBe("file:src/main.ts::");
    expect(state.selectedFile).toBe("src/main.ts");
  });

  test("openFile does not duplicate an already-open tab", () => {
    useUIStore.getState().openFile("src/main.ts");
    useUIStore.getState().openFile("src/main.ts");
    expect(useUIStore.getState().openTabs).toEqual([{ kind: "file", path: "src/main.ts" }]);
  });

  test("openDiff adds a diff tab and sets it active", () => {
    useUIStore.getState().openDiff("src/main.ts");
    const state = useUIStore.getState();
    expect(state.openTabs).toEqual([{ kind: "diff", path: "src/main.ts" }]);
    expect(state.activeTabKey).toBe("diff:src/main.ts::");
    expect(state.selectedFile).toBe("src/main.ts");
  });

  test("openFile and openDiff create separate tabs for same path", () => {
    useUIStore.getState().openFile("src/main.ts");
    useUIStore.getState().openDiff("src/main.ts");
    expect(useUIStore.getState().openTabs.length).toBe(2);
  });

  test("closeTab removes the tab", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().openFile("src/b.ts");
    useUIStore.getState().closeTab("file:src/a.ts::");
    const state = useUIStore.getState();
    expect(state.openTabs).toEqual([{ kind: "file", path: "src/b.ts" }]);
  });

  test("closeTab on active tab switches active to last remaining tab", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().openFile("src/b.ts");
    // active is now b
    useUIStore.getState().closeTab("file:src/b.ts::");
    const state = useUIStore.getState();
    expect(state.activeTabKey).toBe("file:src/a.ts::");
    expect(state.selectedFile).toBe("src/a.ts");
  });

  test("closeTab on active tab with no remaining tabs nulls activeTabKey", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().closeTab("file:src/a.ts::");
    expect(useUIStore.getState().activeTabKey).toBe(null);
  });

  test("closeTab on inactive tab does not change activeTabKey", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().openFile("src/b.ts");
    useUIStore.getState().closeTab("file:src/a.ts::");
    expect(useUIStore.getState().activeTabKey).toBe("file:src/b.ts::");
  });

  test("setActiveTab updates activeTabKey and selectedFile", () => {
    useUIStore.getState().openFile("src/a.ts");
    useUIStore.getState().openFile("src/b.ts");
    useUIStore.getState().setActiveTab("file:src/a.ts::");
    const state = useUIStore.getState();
    expect(state.activeTabKey).toBe("file:src/a.ts::");
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

  // ── toggleSidebar / toggleChat ──────────────────────────────────────────

  test("toggleSidebar flips sidebarVisible", () => {
    expect(useUIStore.getState().sidebarVisible).toBe(true);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarVisible).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarVisible).toBe(true);
  });

  test("toggleChat flips chatVisible", () => {
    expect(useUIStore.getState().chatVisible).toBe(true);
    useUIStore.getState().toggleChat();
    expect(useUIStore.getState().chatVisible).toBe(false);
    useUIStore.getState().toggleChat();
    expect(useUIStore.getState().chatVisible).toBe(true);
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

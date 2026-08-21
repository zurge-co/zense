// @ts-nocheck
/**
 * Text-editor readiness tests (spec v2): file watcher, unsaved guard,
 * auto-save, revert, real StatusBar, tab shortcuts, split editor, quick open.
 * Structural source verification (project pattern) + store behavior tests.
 */
import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { useUIStore, tabKey } from "../../store/uiStore";
import { useWorkspaceStore } from "../../store/workspaceStore";

const ROOT = `${import.meta.dir}/../../..`;
const srcRead = (rel: string) => Bun.file(`${ROOT}/src/${rel}`).text();

const resetUI = () =>
  useUIStore.setState({
    openTabs: [],
    activeTabKey: null,
    splitTabKey: null,
    cursorPos: null,
    quickOpenVisible: false,
    closeActiveTabNonce: 0,
  });

const resetWs = () =>
  useWorkspaceStore.setState({ conflicts: {}, dirtyPaths: new Set(), autoSave: false });

// ── File watcher ────────────────────────────────────────────────────────────

describe("file watcher (watcher.rs + workspaceStore)", () => {
  let rs: string;
  let libRs: string;
  let store: string;

  beforeAll(async () => {
    rs = await Bun.file(`${ROOT}/src-tauri/src/watcher.rs`).text();
    libRs = await Bun.file(`${ROOT}/src-tauri/src/lib.rs`).text();
    store = await srcRead("store/workspaceStore.ts");
  });

  test("watcher uses notify with per-window state", () => {
    expect(rs).toContain("RecommendedWatcher");
    expect(rs).toContain("notify::recommended_watcher");
    expect(rs).toContain("HashMap<String, WatchEntry>");
  });

  test("filters noisy directories", () => {
    for (const d of [".git", "node_modules", "target", ".swarm", ".pi", "dist"]) {
      expect(rs).toContain(`"${d}"`);
    }
  });

  test("emits debounced fs://changed with relative paths", () => {
    expect(rs).toContain("fs://changed");
    expect(rs).toContain("DEBOUNCE");
    expect(rs).toContain("strip_prefix");
  });

  test("commands registered and state managed", () => {
    expect(libRs).toContain("watcher::watch_workspace");
    expect(libRs).toContain("watcher::stop_watch");
    expect(libRs).toContain(".manage(watcher::WatchManager::default())");
  });

  test("frontend subscribes and flags dirty conflicts", () => {
    expect(store).toContain('listen<string[]>("fs://changed"');
    expect(store).toContain("\"modified\" | \"deleted\"");
    expect(store).toContain("conflicts");
  });

  test("clean open files reload silently; deleted clean files close tabs", () => {
    expect(store).toContain("originalContents: { ...prev.originalContents, [p]: content }");
    expect(store).toContain('t.kind === "file" && t.path === p');
  });

  test("notify crate added", async () => {
    const cargo = await Bun.file(`${ROOT}/src-tauri/Cargo.toml`).text();
    expect(cargo).toContain('notify = "');
  });
});

// ── Unsaved guard ───────────────────────────────────────────────────────────

describe("unsaved close guard", () => {
  let libRs: string;
  let app: string;

  beforeAll(async () => {
    libRs = await Bun.file(`${ROOT}/src-tauri/src/lib.rs`).text();
    app = await srcRead("App.tsx");
  });

  test("Rust prevents close and forwards to the frontend", () => {
    expect(libRs).toContain("WindowEvent::CloseRequested");
    expect(libRs).toContain("prevent_close()");
    expect(libRs).toContain("app://close-requested");
  });

  test("App prompts with save-all / discard / cancel", () => {
    expect(app).toContain("Save All & Close");
    expect(app).toContain("Close Without Saving");
    expect(app).toContain("saveAllDirty");
    expect(app).toContain("getCurrentWindow().destroy()");
  });

  test("ConfirmDialog supports the third action", async () => {
    const dlg = await srcRead("components/ConfirmDialog.tsx");
    expect(dlg).toContain("secondaryLabel");
    expect(dlg).toContain("onSecondary");
  });

  test("dirty single-tab close is confirmed (EditorArea)", async () => {
    const ea = await srcRead("components/editor/EditorArea.tsx");
    expect(ea).toContain('kind: "single"');
    expect(ea).toContain("Close Without Saving");
  });
});

// ── Auto-save ───────────────────────────────────────────────────────────────

describe("auto-save", () => {
  let store: string;
  let settings: string;
  let modal: string;

  beforeAll(async () => {
    store = await srcRead("store/workspaceStore.ts");
    settings = await srcRead("lib/settings.ts");
    modal = await srcRead("components/settings/SettingsModal.tsx");
  });

  test("debounced save ~1s after typing stops", () => {
    expect(store).toContain("scheduleAutosave");
    expect(store).toContain("1000");
    expect(store).toContain("if (!st.autoSave) return");
  });

  test("persisted via plugin-store", () => {
    expect(settings).toContain("KEY_AUTO_SAVE");
    expect(settings).toContain("applyAutoSave");
    expect(settings).toContain("loadUiPrefs");
  });

  test("Settings > General has the toggle", () => {
    expect(modal).toContain("Auto-save files");
    expect(modal).toContain("applyAutoSave(!autoSave)");
  });

  test("store behavior: setAutoSave toggles flag", () => {
    resetWs();
    useWorkspaceStore.getState().setAutoSave(true);
    expect(useWorkspaceStore.getState().autoSave).toBe(true);
    useWorkspaceStore.getState().setAutoSave(false);
    expect(useWorkspaceStore.getState().autoSave).toBe(false);
  });
});

// ── Revert / conflicts ──────────────────────────────────────────────────────

describe("revert + conflict UI", () => {
  let ea: string;

  beforeAll(async () => {
    ea = await srcRead("components/editor/EditorArea.tsx");
  });

  test("EditorArea has conflict banner with Reload / Keep mine", () => {
    expect(ea).toContain("revertFile");
    expect(ea).toContain("keepMine");
    expect(ea).toContain("changed on disk");
    expect(ea).toContain("deleted on disk");
  });

  test("tab context menu offers Revert File for dirty files", () => {
    expect(ea).toContain('"revert"');
    expect(ea).toContain("Revert File");
  });

  test("store behavior: keepMine clears the conflict flag", () => {
    resetWs();
    useWorkspaceStore.setState({ conflicts: { "a.ts": "modified" } });
    useWorkspaceStore.getState().keepMine("a.ts");
    expect(useWorkspaceStore.getState().conflicts["a.ts"]).toBeUndefined();
  });
});

// ── ADR-003: save guard for externally-changed buffers ─────────────────────

describe("ADR-003 conflict save guard", () => {
  let storeSrc: string;

  beforeAll(async () => {
    storeSrc = await srcRead("store/workspaceStore.ts");
  });

  test("saveFile is guarded by the conflicts map", () => {
    expect(storeSrc).toContain("conflicts[path]");
    expect(storeSrc).toContain("pendingConflictSave: path");
  });

  test("blocked save stays dirty — saveAllDirty reports it as failed", () => {
    expect(storeSrc).toContain("if (get().dirtyPaths.has(path)) failed.push(path);");
  });

  test("App renders the conflict overwrite confirm dialog", async () => {
    const app = await srcRead("App.tsx");
    expect(app).toContain("pendingConflictSave");
  });
});

// ── Split editor ────────────────────────────────────────────────────────────

describe("split editor", () => {
  let ea: string;

  beforeAll(async () => {
    ea = await srcRead("components/editor/EditorArea.tsx");
  });

  test("split button is wired (no dead button)", () => {
    expect(ea).toContain("toggleSplit()");
    expect(ea).toContain("closeSplit");
    expect(ea).toContain("Split Square Horizontal".replace(/ /g, "")); // SplitSquareHorizontal
  });

  test("store behavior: toggleSplit uses the active tab", () => {
    resetUI();
    const ui = useUIStore.getState();
    ui.openFile("src/a.ts");
    useUIStore.getState().toggleSplit();
    expect(useUIStore.getState().splitTabKey).toBe(tabKey({ kind: "file", path: "src/a.ts" }));
    useUIStore.getState().toggleSplit();
    expect(useUIStore.getState().splitTabKey).toBe(null);
  });

  test("closing the split tab clears splitTabKey", () => {
    resetUI();
    const ui = useUIStore.getState();
    ui.openFile("src/a.ts");
    useUIStore.getState().toggleSplit();
    const key = useUIStore.getState().splitTabKey!;
    useUIStore.getState().closeTab(key);
    expect(useUIStore.getState().splitTabKey).toBe(null);
  });
});

// ── Quick open ──────────────────────────────────────────────────────────────

describe("quick open (⌘P)", () => {
  let qo: string;

  beforeAll(async () => {
    qo = await srcRead("components/QuickOpen.tsx");
  });

  test("searches the workspace file index and opens files", () => {
    expect(qo).toContain("fileIndex");
    expect(qo).toContain("openFile(path)");
  });

  test("keyboard navigation: arrows, enter, escape", () => {
    expect(qo).toContain("ArrowDown");
    expect(qo).toContain("ArrowUp");
    expect(qo).toContain('"Enter"');
    expect(qo).toContain('"Escape"');
  });

  test("store behavior: toggleQuickOpen flips visibility", () => {
    resetUI();
    useUIStore.getState().toggleQuickOpen();
    expect(useUIStore.getState().quickOpenVisible).toBe(true);
    useUIStore.getState().toggleQuickOpen();
    expect(useUIStore.getState().quickOpenVisible).toBe(false);
  });
});

// ── Live cursor ─────────────────────────────────────────────────────────────

describe("live cursor position", () => {
  test("store behavior: setCursorPos updates state", () => {
    resetUI();
    useUIStore.getState().setCursorPos({ line: 12, col: 5 });
    expect(useUIStore.getState().cursorPos).toEqual({ line: 12, col: 5 });
  });

  test("CodeEditor reports cursor changes", async () => {
    const ce = await srcRead("components/editor/CodeEditor.tsx");
    expect(ce).toContain("onDidChangeCursorPosition");
    expect(ce).toContain("setCursorPos");
  });
});

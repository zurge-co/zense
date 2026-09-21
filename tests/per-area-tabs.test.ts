/**
 * Per-area tab partitioning + workspace default activity (menus[0]).
 *
 * Two behaviors under test:
 * 1. The workspace's initial activity is the FIRST ActivityBar menu item,
 *    derived from the shared ACTIVITY_MENU order — never a hardcoded id.
 * 2. Editor/Review/History keep SEPARATE tab lists and active tabs:
 *    editor = file/preview/untitled, review = working-tree diff,
 *    history = commit/commitDiff/compare. Tabs never leak across areas,
 *    close/cycle ops are area-scoped, and openFile routes into the editor
 *    area AND switches the activity to it.
 *
 * House style: exercise the real Zustand store directly + read source
 * text for wiring that can't be observed behaviorally (the store
 * initializer's default activity — module state is mutated by other
 * suites, so the initial value is verified at the source level).
 */
import { describe, test, expect, beforeEach } from "bun:test";
import {
  useUIStore,
  ACTIVITY_MENU,
  areaOfActivity,
  areaOfTab,
  currentAreaTabs,
  emptyTabsByArea,
  tabKey,
  type EditorTab,
} from "../src/store/uiStore";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), "utf-8");

const resetStore = () =>
  useUIStore.setState({
    screen: "workspace",
    workspacePath: "/tmp/ws",
    activity: "review",
    sidebarVisible: true,
    tabsByArea: emptyTabsByArea(),
    selectedFile: null,
    splitTabKey: null,
    editorPanelMode: "files",
  });

// ── 1. Default activity = first menu item, never hardcoded ───────────────

describe("default activity = first ActivityBar menu item (menus[0])", () => {
  const uiSrc = readSrc("src/store/uiStore.ts");
  const barSrc = readSrc("src/components/layout/ActivityBar.tsx");

  test("uiStore initial activity derives from ACTIVITY_MENU[0].id", () => {
    expect(uiSrc).toContain("activity: ACTIVITY_MENU[0].id");
  });

  test("uiStore has no hardcoded activity default literals", () => {
    expect(uiSrc).not.toContain('activity: "review"');
    expect(uiSrc).not.toContain('activity: "terminal",');
    expect(uiSrc).not.toContain('activity: "editor",');
    expect(uiSrc).not.toContain('activity: "history",');
  });

  test("ACTIVITY_MENU's first entry is 'terminal' (current default)", () => {
    expect(ACTIVITY_MENU[0].id).toBe("terminal");
  });

  test("ActivityBar renders the shared ACTIVITY_MENU (same source as the default)", () => {
    expect(barSrc).toContain("ACTIVITY_MENU.map(");
    expect(barSrc).toMatch(/import \{[^}]*ACTIVITY_MENU[^}]*\} from "\.\.\/\.\.\/store\/uiStore"/);
  });
});

// ── 2. kind → area mapping ───────────────────────────────────────────────

describe("kind → area partition", () => {
  test.each<[EditorTab["kind"], "editor" | "review" | "history"]>([
    ["file", "editor"],
    ["preview", "editor"],
    ["untitled", "editor"],
    ["diff", "review"],
    ["commit", "history"],
    ["commitDiff", "history"],
    ["compare", "history"],
  ])("areaOfTab(%s) = %s", (kind, area) => {
    expect(areaOfTab({ kind, path: "p" })).toBe(area);
  });

  test("areaOfActivity mirrors the activity; terminal is tab-less", () => {
    expect(areaOfActivity("editor")).toBe("editor");
    expect(areaOfActivity("review")).toBe("review");
    expect(areaOfActivity("history")).toBe("history");
    expect(areaOfActivity("terminal")).toBe(null);
  });
});

// ── 3. Tabs never leak + each area keeps its own state ──────────────────

describe("per-area tab lists + retention across activity switches", () => {
  beforeEach(resetStore);

  test("each opener lands ONLY in its own area", () => {
    const s = useUIStore.getState();
    s.openFile("src/a.ts");
    s.openDiff("src/b.ts");
    s.openCommit("abc123");
    const { tabsByArea } = useUIStore.getState();
    expect(tabsByArea.editor.openTabs).toEqual([{ kind: "file", path: "src/a.ts" }]);
    expect(tabsByArea.review.openTabs).toEqual([{ kind: "diff", path: "src/b.ts" }]);
    expect(tabsByArea.history.openTabs).toEqual([{ kind: "commit", path: "abc123" }]);
  });

  test("each area remembers its own active tab across activity switches", () => {
    const s = useUIStore.getState();
    s.openFile("src/one.ts");
    s.openFile("src/two.ts");
    s.openDiff("src/changed.ts");
    s.openCommit("deadbeef");
    // Park each area on a specific tab.
    s.setActiveTab(tabKey({ kind: "file", path: "src/one.ts" }));

    // Switch away and back — every area restores its own tabs + active tab.
    useUIStore.getState().setActivity("review");
    expect(currentAreaTabs(useUIStore.getState())?.activeTabKey).toBe(
      tabKey({ kind: "diff", path: "src/changed.ts" }),
    );
    useUIStore.getState().setActivity("history");
    expect(currentAreaTabs(useUIStore.getState())?.activeTabKey).toBe(
      tabKey({ kind: "commit", path: "deadbeef" }),
    );
    useUIStore.getState().setActivity("editor");
    const editorTabs = currentAreaTabs(useUIStore.getState())!;
    expect(editorTabs.openTabs.map((t) => t.path)).toEqual(["src/one.ts", "src/two.ts"]);
    expect(editorTabs.activeTabKey).toBe(tabKey({ kind: "file", path: "src/one.ts" }));
    // The other areas were never disturbed.
    const { tabsByArea } = useUIStore.getState();
    expect(tabsByArea.review.openTabs).toHaveLength(1);
    expect(tabsByArea.history.openTabs).toHaveLength(1);
  });

  test("currentAreaTabs returns null on the terminal activity", () => {
    useUIStore.setState({ activity: "terminal" });
    expect(currentAreaTabs(useUIStore.getState())).toBe(null);
  });
});

// ── 4. openFile routes to the editor area AND switches activity ─────────

describe("openFile / openPreview / openUntitled route to the editor area", () => {
  beforeEach(resetStore);

  test("openFile from the review activity switches to editor", () => {
    useUIStore.setState({ activity: "review" });
    useUIStore.getState().openFile("src/conflicted.ts");
    const s = useUIStore.getState();
    expect(s.activity).toBe("editor");
    expect(s.sidebarVisible).toBe(true);
    expect(s.tabsByArea.editor.openTabs).toEqual([
      { kind: "file", path: "src/conflicted.ts" },
    ]);
    // The review area must never see the file tab.
    expect(s.tabsByArea.review.openTabs).toEqual([]);
  });

  test("openPreview and openUntitled also switch to the editor activity", () => {
    useUIStore.setState({ activity: "history" });
    useUIStore.getState().openPreview("docs/spec.md");
    expect(useUIStore.getState().activity).toBe("editor");
    useUIStore.setState({ activity: "review" });
    useUIStore.getState().openUntitled("untitled:1");
    const s = useUIStore.getState();
    expect(s.activity).toBe("editor");
    expect(s.tabsByArea.editor.openTabs.map((t) => t.kind)).toEqual(["preview", "untitled"]);
  });

  test("diff/commit openers stay in their own area without switching activity", () => {
    useUIStore.setState({ activity: "review" });
    useUIStore.getState().openDiff("src/b.ts");
    expect(useUIStore.getState().activity).toBe("review");
    useUIStore.setState({ activity: "history" });
    useUIStore.getState().openCommit("cafef00d");
    expect(useUIStore.getState().activity).toBe("history");
  });
});

// ── 5. Close / cycle operations are area-scoped ─────────────────────────

describe("area-scoped close and tab cycling", () => {
  beforeEach(resetStore);

  test("closeAllTabs clears only the CURRENT activity's area", () => {
    const s = useUIStore.getState();
    s.openFile("src/a.ts");
    s.openDiff("src/b.ts");
    s.openCommit("abc123");
    useUIStore.setState({ activity: "review" });
    useUIStore.getState().closeAllTabs();
    const { tabsByArea } = useUIStore.getState();
    expect(tabsByArea.review.openTabs).toEqual([]);
    expect(tabsByArea.editor.openTabs).toHaveLength(1);
    expect(tabsByArea.history.openTabs).toHaveLength(1);
  });

  test("closeAllTabs is a no-op on the terminal activity", () => {
    const s = useUIStore.getState();
    s.openDiff("src/b.ts");
    useUIStore.setState({ activity: "terminal" });
    useUIStore.getState().closeAllTabs();
    expect(useUIStore.getState().tabsByArea.review.openTabs).toHaveLength(1);
  });

  test("closeOtherTabs keeps only `key` inside its OWN area", () => {
    const s = useUIStore.getState();
    s.openFile("src/a.ts");
    s.openFile("src/b.ts");
    useUIStore.getState().openDiff("src/c.ts");
    useUIStore.getState().closeOtherTabs(tabKey({ kind: "diff", path: "src/c.ts" }));
    const { tabsByArea } = useUIStore.getState();
    expect(tabsByArea.review.openTabs).toEqual([{ kind: "diff", path: "src/c.ts" }]);
    // Editor area untouched — no cross-area closes, ever.
    expect(tabsByArea.editor.openTabs).toHaveLength(2);
  });

  test("closeTab in one area never changes another area's active tab", () => {
    const s = useUIStore.getState();
    s.openFile("src/a.ts");
    s.openDiff("src/b.ts");
    const diffKey = tabKey({ kind: "diff", path: "src/b.ts" });
    const fileKey = tabKey({ kind: "file", path: "src/a.ts" });
    useUIStore.getState().closeTab(diffKey);
    const { tabsByArea } = useUIStore.getState();
    expect(tabsByArea.review.activeTabKey).toBe(null);
    expect(tabsByArea.editor.activeTabKey).toBe(fileKey);
  });

  test("⌘1-9 / cycling helpers only see the current area's tabs", () => {
    // Simulate App.tsx's ⌘N handler: index into currentAreaTabs only.
    const s = useUIStore.getState();
    s.openFile("src/a.ts");
    s.openDiff("src/b.ts");
    s.openCommit("abc123");
    useUIStore.setState({ activity: "editor" });
    const editorTabs = currentAreaTabs(useUIStore.getState())!;
    expect(editorTabs.openTabs).toHaveLength(1);
    // ⌘2 in the editor area finds nothing — the other areas' tabs are
    // not part of this numbering.
    expect(editorTabs.openTabs[1]).toBe(undefined);
    useUIStore.setState({ activity: "history" });
    const historyTabs = currentAreaTabs(useUIStore.getState())!;
    expect(historyTabs.openTabs[Number("1") - 1]?.kind).toBe("commit");
  });

  test("toggleSplit splits the current area's active tab only", () => {
    const s = useUIStore.getState();
    s.openFile("src/a.ts");
    s.openDiff("src/b.ts");
    useUIStore.setState({ activity: "review" });
    useUIStore.getState().toggleSplit();
    expect(useUIStore.getState().splitTabKey).toBe(tabKey({ kind: "diff", path: "src/b.ts" }));
    useUIStore.getState().toggleSplit();
    expect(useUIStore.getState().splitTabKey).toBe(null);
  });

  test("toggleSplit has nothing to split on the terminal activity", () => {
    useUIStore.setState({ activity: "terminal", splitTabKey: null });
    useUIStore.getState().toggleSplit();
    expect(useUIStore.getState().splitTabKey).toBe(null);
  });
});

// ── 6. Cross-cutting flows stay area-aware (structural wiring) ──────────

describe("fs-watch close, untitled promote, StatusBar stay area-aware", () => {
  test("workspaceStore closes deleted file tabs from the EDITOR area only", () => {
    const src = readSrc("src/store/workspaceStore.ts");
    expect(src).toContain("tabsByArea.editor.openTabs");
    expect(src).not.toContain("ui.openTabs");
  });

  test("untitled save-as swaps the tab inside the editor area", () => {
    const src = readSrc("src/lib/untitled.ts");
    expect(src).toContain("tabsByArea.editor");
    // No top-level openTabs state access may remain (word-boundary so the
    // editor-area alias `editorTabs.openTabs` does not false-positive).
    expect(/\bs\.openTabs/.test(src)).toBe(false);
    expect(/\bui\.openTabs/.test(src)).toBe(false);
  });

  test("StatusBar resolves the active tab from the current area only", () => {
    const src = readSrc("src/components/layout/StatusBar.tsx");
    expect(src).toContain("currentAreaTabs");
  });

  test("EditorArea renders the current area's tab slice", () => {
    const src = readSrc("src/components/editor/EditorArea.tsx");
    expect(src).toContain("tabsByArea[area]");
    expect(src).toContain("areaOfActivity");
  });
});

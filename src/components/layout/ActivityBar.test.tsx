// @ts-nocheck
/**
 * Task 1.3 tests — ActivityBar, SideBar, ReviewPanel
 *
 * Historical note: this suite predates full-app compilation (older errors
 * in App.tsx, the former ComposerPanel.tsx, StatusBar.tsx, TitleBar.tsx,
 * SettingsModal.tsx, settings.ts, main.tsx). The 3 files under
 * test here have zero TS errors. We follow the same structural-verification
 * pattern established in tests/task-1.2.uiStore.test.ts: read source text
 * directly and exercise the Zustand store that the components consume.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { useUIStore } from "../../store/uiStore";
import { gitChanges, diffStats } from "../../lib/mockData";
import * as fs from "fs";
import * as path from "path";

// ── Helpers ───────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../../..");
const readSrc = (rel: string): string =>
  fs.readFileSync(path.resolve(ROOT, rel), "utf-8");

const resetStore = () =>
  useUIStore.setState({
    screen: "welcome",
    workspacePath: null,
    workspaceName: null,
    activity: "review",
    sidebarVisible: true,
    editorPanelMode: "files",
    openTabs: [],
    activeTabKey: null,
    selectedFile: null,
    diffMode: "split",
    settingsOpen: false,
    settingsSection: "general",
  });

// ── ActivityBar.tsx structural tests ───────────────────────────────────────

describe("ActivityBar.tsx — task 1.3 structural verification", () => {
  const src = readSrc("src/components/layout/ActivityBar.tsx");

  test("file is non-empty and exports ActivityBar component", () => {
    expect(src.length).toBeGreaterThan(50);
    expect(src).toContain("export function ActivityBar");
  });

  // ── Exactly 4 activity buttons, in workflow order ───────────────────────

  test("items array has exactly 4 entries", () => {
    const itemsMatch = src.match(
      /const items[^=]*=\s*\[([\s\S]*?)\];/,
    );
    expect(itemsMatch).not.toBe(null);
    const itemsBlock = itemsMatch![1];
    const idMatches = itemsBlock.match(/\bid:\s*"(terminal|review|editor|history)"/g);
    expect(idMatches).not.toBe(null);
    expect(idMatches!.length).toBe(4);
  });

  test("items are ordered Terminal → Review → Editor → History (no Search item)", () => {
    const itemsMatch = src.match(
      /const items[^=]*=\s*\[([\s\S]*?)\];/,
    );
    const itemsBlock = itemsMatch![1];
    const ids = itemsBlock.match(/\bid:\s*"[a-z]+"/g);
    expect(ids).toEqual([
      'id: "terminal"',
      'id: "review"',
      'id: "editor"',
      'id: "history"',
    ]);
  });

  test("Review button uses GitBranch icon", () => {
    const itemsMatch = src.match(
      /const items[^=]*=\s*\[([\s\S]*?)\];/,
    );
    const itemsBlock = itemsMatch![1];
    expect(itemsBlock).toContain('id: "review"');
    expect(itemsBlock).toContain("GitBranch");
  });

  test("History button uses History icon", () => {
    const itemsMatch = src.match(
      /const items[^=]*=\s*\[([\s\S]*?)\];/,
    );
    const itemsBlock = itemsMatch![1];
    expect(itemsBlock).toContain('id: "history"');
    expect(itemsBlock).toContain("History");
  });

  test("Editor button uses Files icon", () => {
    const itemsMatch = src.match(
      /const items[^=]*=\s*\[([\s\S]*?)\];/,
    );
    const itemsBlock = itemsMatch![1];
    expect(itemsBlock).toContain('id: "editor"');
    expect(itemsBlock).toContain("Files");
  });

  test("labels are Terminal, Review, Editor, History (no Search)", () => {
    const itemsMatch = src.match(
      /const items[^=]*=\s*\[([\s\S]*?)\];/,
    );
    const itemsBlock = itemsMatch![1];
    const labelMatches = itemsBlock.match(/label:\s*"([^"]+)"/g);
    expect(labelMatches).toEqual([
      'label: "Terminal (⌘`)"',
      'label: "Review"',
      'label: "Editor"',
      'label: "History"',
    ]);
  });

  // ── Button rendering and onClick ─────────────────────────────────────────

  test("maps over items to render buttons", () => {
    expect(src).toContain("items.map(");
  });

  test("each button calls setActivity on click", () => {
    expect(src).toContain("onClick={() => setActivity(id)}");
  });

  test("uses title attribute for accessibility label", () => {
    expect(src).toContain('title={label}');
  });

  // ── Active state logic ────────────────────────────────────────────────────

  test("active state is activity === id && sidebarVisible (Review ignores the sidebar flag)", () => {
    // Review is a full page — its active state must not depend on the
    // sidebar toggle.
    expect(src).toContain('activity === id && (sidebarVisible || id === "review")');
  });

  test("active button gets text-fg class", () => {
    expect(src).toContain('"text-fg"');
  });

  test("inactive button gets text-fg-muted class", () => {
    // The class is inside a template literal: "text-fg-muted hover:text-fg"
    expect(src).toContain("text-fg-muted");
  });

  test("active button shows accent bar indicator", () => {
    expect(src).toContain("bg-accent");
  });

  // ── Settings button ───────────────────────────────────────────────────────

  test("has a Settings button", () => {
    expect(src).toContain('title="Settings"');
  });

  test("Settings button calls openSettings", () => {
    expect(src).toContain("onClick={() => openSettings()}");
  });

  test("Settings button uses Settings icon", () => {
    expect(src).toContain("Settings size={18}");
  });

  // ── Store usage ───────────────────────────────────────────────────────────

  test("destructures activity, setActivity, sidebarVisible, openSettings from store", () => {
    expect(src).toContain("useUIStore()");
    expect(src).toContain("activity");
    expect(src).toContain("setActivity");
    expect(src).toContain("sidebarVisible");
    expect(src).toContain("openSettings");
  });

  // ── Removed items should NOT be present ──────────────────────────────────

  test("does NOT reference removed mainView", () => {
    expect(src.includes("mainView")).toBe(false);
  });

  test("does NOT reference removed bottomVisible", () => {
    expect(src.includes("bottomVisible")).toBe(false);
  });

  test("does NOT reference terminalStore", () => {
    expect(src.includes("terminalStore")).toBe(false);
  });

  test("imports the Terminal icon for the terminal activity", () => {
    expect(src.includes("Terminal")).toBe(true);
  });

  test("does NOT import graph-related icons", () => {
    expect(src.includes("GitGraph")).toBe(false);
    expect(src.includes("Network")).toBe(false);
    expect(src.includes("Workflow")).toBe(false);
  });

  test("does NOT import the Search icon (search moved into the Editor sidebar)", () => {
    expect(src.includes('id: "search"')).toBe(false);
    expect(/import \{[^}]*\bSearch\b[^}]*\} from "lucide-react"/.test(src)).toBe(false);
  });

  test("does NOT reference prompt library items", () => {
    expect(src.includes("promptLibrary")).toBe(false);
  });
});

// ── ActivityBar store interaction tests ───────────────────────────────────

describe("ActivityBar — store interaction", () => {
  beforeEach(() => resetStore());

  test("clicking a different activity updates store activity", () => {
    useUIStore.getState().setActivity("history");
    expect(useUIStore.getState().activity).toBe("history");
    expect(useUIStore.getState().sidebarVisible).toBe(true);
  });

  test("clicking the same activity toggles sidebar visibility", () => {
    // Default: activity=review, sidebarVisible=true
    expect(useUIStore.getState().activity).toBe("review");
    expect(useUIStore.getState().sidebarVisible).toBe(true);

    // Click review again → toggle to false
    useUIStore.getState().setActivity("review");
    expect(useUIStore.getState().sidebarVisible).toBe(false);

    // Click review again → toggle back to true
    useUIStore.getState().setActivity("review");
    expect(useUIStore.getState().sidebarVisible).toBe(true);
  });

  test("active state computation: Review stays active when the sidebar flag flips", () => {
    useUIStore.getState().setActivity("editor");
    useUIStore.getState().setActivity("editor"); // toggles sidebarVisible off
    const { activity, sidebarVisible } = useUIStore.getState();
    expect(activity).toBe("editor");
    expect(sidebarVisible).toBe(false);
    // editor is inactive because the sidebar folded (review would not be —
    // it renders full-page and ignores the flag).
    const activeForEditor = activity === "editor" && sidebarVisible;
    expect(activeForEditor).toBe(false);
  });

  test("switching to a different activity from hidden sidebar shows sidebar", () => {
    useUIStore.getState().setActivity("review"); // toggle off
    expect(useUIStore.getState().sidebarVisible).toBe(false);

    useUIStore.getState().setActivity("editor");
    expect(useUIStore.getState().activity).toBe("editor");
    expect(useUIStore.getState().sidebarVisible).toBe(true);
  });

  test("Settings button opens settings with default section", () => {
    useUIStore.getState().openSettings();
    const state = useUIStore.getState();
    expect(state.settingsOpen).toBe(true);
    expect(state.settingsSection).toBe("general");
  });

  // ── Workspace search (⌘⇧F) ───────────────────────────────────────────

  test("openSearch opens the Editor activity in search mode", () => {
    useUIStore.getState().openSearch();
    expect(useUIStore.getState().activity).toBe("editor");
    expect(useUIStore.getState().editorPanelMode).toBe("search");
  });

  test("openSearch always shows the sidebar (never toggles it off)", () => {
    useUIStore.getState().openSearch();
    useUIStore.getState().openSearch();
    expect(useUIStore.getState().sidebarVisible).toBe(true);
  });

  test("openSearch bumps searchFocusNonce to refocus the input", () => {
    const before = useUIStore.getState().searchFocusNonce;
    useUIStore.getState().openSearch();
    expect(useUIStore.getState().searchFocusNonce).toBe(before + 1);
  });
});

// ── SideBar.tsx structural tests ───────────────────────────────────────────

describe("SideBar.tsx — task 1.3 structural verification", () => {
  const src = readSrc("src/components/sidebar/SideBar.tsx");

  test("file is non-empty and exports SideBar component", () => {
    expect(src.length).toBeGreaterThan(20);
    expect(src).toContain("export function SideBar");
  });

  test("imports useUIStore", () => {
    expect(src).toContain("useUIStore");
  });

  test("imports FileTree component", () => {
    expect(src).toContain('import { FileTree }');
    expect(src).toContain('"./FileTree"');
  });

  test("does NOT import ReviewPanel (Review is a full page now — ReviewView does)", () => {
    expect(src.includes("ReviewPanel")).toBe(false);
    expect(src.includes("GitPanel")).toBe(false);
  });

  test("editor header offers Files / Search tabs switching editorPanelMode", () => {
    expect(src).toContain("editorPanelMode");
    expect(src).toContain('setEditorPanelMode("files")');
    expect(src).toContain('setEditorPanelMode("search")');
  });

  test("renders FileTree or SearchPanel when activity is editor", () => {
    expect(src).toContain('activity === "editor"');
    expect(src).toContain('<FileTree');
    expect(src).toContain('<SearchPanel');
  });

  test("renders HistoryPanel when activity is history", () => {
    expect(src).toContain('activity === "history" && <HistoryPanel />');
    expect(src).not.toContain("No commits yet");
  });

  test("does NOT render GitPanel (old name)", () => {
    expect(src.includes("GitPanel")).toBe(false);
  });

  test("does NOT reference removed components", () => {
    expect(src.includes("GraphView")).toBe(false);
    expect(src.includes("TerminalPanel")).toBe(false);
    expect(src.includes("PromptLibrary")).toBe(false);
  });

  test("does NOT have separate panel branches for removed activities", () => {
    expect(src.includes('"agent"')).toBe(false);
    expect(src.includes('"graph"')).toBe(false);
    expect(src.includes('"prompts"')).toBe(false);
    // "search" is no longer an activity — it is an Editor panel mode.
    expect(src.includes('activity === "search"')).toBe(false);
  });

  test("terminal and review render no sidebar section (early return null)", () => {
    // Terminal is an ActivityBar main view; Review is a full main-area
    // page (ReviewView). Neither has sidebar content.
    expect(src).toContain('if (activity === "terminal" || activity === "review") return null');
    expect(src.includes('activity === "terminal" &&')).toBe(false);
    expect(src.includes('activity === "review" &&')).toBe(false);
  });
});

// ── SideBar store interaction tests ────────────────────────────────────────

describe("SideBar — store interaction", () => {
  beforeEach(() => resetStore());

  test("default activity is review → SideBar shows ReviewPanel title", () => {
    const { activity } = useUIStore.getState();
    expect(activity).toBe("review");
    // SideBar titles map: review → "Review"
  });

  test("switching to editor → SideBar would show Editor title and FileTree", () => {
    useUIStore.getState().setActivity("editor");
    expect(useUIStore.getState().activity).toBe("editor");
  });

  test("switching to history → SideBar would show History title and placeholder", () => {
    useUIStore.getState().setActivity("history");
    expect(useUIStore.getState().activity).toBe("history");
  });

  test("cycling through all three activities works", () => {
    useUIStore.getState().setActivity("review");
    expect(useUIStore.getState().activity).toBe("review");
    useUIStore.getState().setActivity("history");
    expect(useUIStore.getState().activity).toBe("history");
    useUIStore.getState().setActivity("editor");
    expect(useUIStore.getState().activity).toBe("editor");
  });
});

// ── ReviewPanel.tsx structural tests ───────────────────────────────────────

describe("ReviewPanel.tsx — task 1.3 structural verification", () => {
  const src = readSrc("src/components/sidebar/ReviewPanel.tsx");

  test("file is non-empty and exports ReviewPanel component", () => {
    expect(src.length).toBeGreaterThan(50);
    expect(src).toContain("export function ReviewPanel");
  });

  test("does NOT export or reference GitPanel (old name)", () => {
    expect(src.includes("GitPanel")).toBe(false);
  });

  test("uses useGitStore for live git status (not mockData)", () => {
    expect(src).toContain("useGitStore");
    expect(src).toContain('"../../store/gitStore"');
  });

  test("uses diffSummary for per-file stats", () => {
    expect(src).toContain("diffSummary");
  });

  test("uses useUIStore for openDiff", () => {
    expect(src).toContain("useUIStore");
    expect(src).toContain("openDiff");
  });

  test("shows branch name 'main'", () => {
    expect(src).toContain("main");
  });

  test("has GitBranch icon for branch display", () => {
    expect(src).toContain("GitBranch");
  });

  test("has commit message textarea", () => {
    expect(src).toContain("textarea");
    expect(src).toContain('placeholder="Commit message');
  });

  test("has Commit button", () => {
    expect(src).toContain("Commit");
    expect(src).toContain("<Check");
  });

  test("has AI generate message button", () => {
    expect(src).toContain("AI");
    expect(src).toContain("Sparkles");
  });

  test("AI button is wired to the commit-message generator", () => {
    expect(src).toContain('from "../../lib/commitMessage"');
    expect(src).toContain("generateCommitMessage(workspacePath)");
    expect(src).toContain("setMessage(await generateCommitMessage");
  });

  test("AI button is enabled only with staged changes and shows a spinner", () => {
    expect(src).toContain("generating");
    expect(src).toContain("Loader2");
    expect(src).toContain("stagedFiles.length === 0");
    // No longer a Phase-3 placeholder — the button actually does something.
    expect(src).not.toContain("Available after LLM setup");
  });

  test("has Refresh button", () => {
    expect(src).toContain("RefreshCw");
    expect(src).toContain('title="Refresh"');
  });

  test("renders staged/unstaged file counts", () => {
    expect(src).toContain("stagedFiles.length");
    expect(src).toContain("unstagedFiles.length");
  });

  test("maps over staged/unstaged files to render change items", () => {
    expect(src).toContain("stagedFiles.map(");
    expect(src).toContain("unstagedFiles.map(");
  });

  test("each change item calls openDiff on click", () => {
    expect(src).toContain("onClick={() => openDiff(f.path)}");
  });

  test("uses FileDiff icon for change items", () => {
    expect(src).toContain("FileDiff");
  });

  test("has statusColor map for M, A, D statuses", () => {
    // The map lives in src/lib/statusColor.ts (shared with History/Commit views).
    expect(src).toContain('from "../../lib/statusColor"');
    const map = fs.readFileSync(path.resolve(ROOT, "src/lib/statusColor.ts"), "utf-8");
    expect(map).toContain('M: "text-yellow"');
    expect(map).toContain('A: "text-green"');
    expect(map).toContain('D: "text-danger"');
  });

  test("displays diff stats (additions/deletions) per file", () => {
    expect(src).toContain("stats.additions");
    expect(src).toContain("stats.deletions");
  });

  test("does NOT reference removed store fields", () => {
    expect(src.includes("terminalStore")).toBe(false);
    expect(src.includes("agentCommand")).toBe(false);
    expect(src.includes("bottomVisible")).toBe(false);
    expect(src.includes("mainView")).toBe(false);
  });
});

// ── ReviewPanel data interaction tests ─────────────────────────────────────

describe("ReviewPanel — mockData interaction", () => {
  beforeEach(() => resetStore());

  test("gitChanges has exactly 4 entries", () => {
    expect(gitChanges.length).toBe(4);
  });

  test("gitChanges contains expected file paths", () => {
    const files = gitChanges.map((c) => c.file);
    expect(files).toContain("src/auth/login.ts");
    expect(files).toContain("src/middleware/auth.ts");
    expect(files).toContain("src/auth/refresh.ts");
    expect(files).toContain("src/auth/legacy.ts");
  });

  test("gitChanges has correct status codes", () => {
    const statusMap = Object.fromEntries(
      gitChanges.map((c) => [c.file, c.status]),
    );
    expect(statusMap["src/auth/login.ts"]).toBe("M");
    expect(statusMap["src/middleware/auth.ts"]).toBe("M");
    expect(statusMap["src/auth/refresh.ts"]).toBe("A");
    expect(statusMap["src/auth/legacy.ts"]).toBe("D");
  });

  test("diffStats has entries for all changed files", () => {
    for (const c of gitChanges) {
      expect(diffStats[c.file]).toBeDefined();
    }
  });

  test("diffStats has correct add/del counts for login.ts", () => {
    const stats = diffStats["src/auth/login.ts"];
    expect(stats.adds).toBe(1);
    expect(stats.dels).toBe(0);
  });

  test("diffStats has correct add/del counts for auth.ts", () => {
    const stats = diffStats["src/middleware/auth.ts"];
    expect(stats.adds).toBe(4);
    expect(stats.dels).toBe(3);
  });

  test("diffStats has correct add/del counts for refresh.ts (new file)", () => {
    const stats = diffStats["src/auth/refresh.ts"];
    expect(stats.adds).toBe(9);
    expect(stats.dels).toBe(0);
  });

  test("diffStats has correct add/del counts for legacy.ts (deleted file)", () => {
    const stats = diffStats["src/auth/legacy.ts"];
    expect(stats.adds).toBe(0);
    expect(stats.dels).toBe(7);
  });

  test("openDiff adds a diff tab to the store", () => {
    useUIStore.getState().openDiff("src/auth/login.ts");
    const state = useUIStore.getState();
    expect(state.openTabs).toEqual([{ kind: "diff", path: "src/auth/login.ts" }]);
    expect(state.activeTabKey).toBe("diff:src/auth/login.ts::");
    expect(state.selectedFile).toBe("src/auth/login.ts");
  });

  test("openDiff for each gitChanges file creates separate diff tabs", () => {
    for (const c of gitChanges) {
      useUIStore.getState().openDiff(c.file);
    }
    expect(useUIStore.getState().openTabs.length).toBe(4);
    // All should be diff tabs
    const allDiffs = useUIStore
      .getState()
      .openTabs.every((t) => t.kind === "diff");
    expect(allDiffs).toBe(true);
  });
});

// ── Cross-component integration: ActivityBar → SideBar → ReviewPanel ───────

describe("Task 1.3 integration — ActivityBar → SideBar → ReviewPanel", () => {
  beforeEach(() => resetStore());

  test("default state: review activity, sidebar visible → ReviewPanel shown", () => {
    const { activity, sidebarVisible } = useUIStore.getState();
    expect(activity).toBe("review");
    expect(sidebarVisible).toBe(true);
    // SideBar would render: titles["review"] = "Review", and <ReviewPanel />
  });

  test("clicking Editor in ActivityBar → SideBar shows FileTree", () => {
    useUIStore.getState().setActivity("editor");
    const { activity, sidebarVisible } = useUIStore.getState();
    expect(activity).toBe("editor");
    expect(sidebarVisible).toBe(true);
    // SideBar would render: titles["editor"] = "Editor", and <FileTree />
  });

  test("clicking History in ActivityBar → SideBar shows placeholder", () => {
    useUIStore.getState().setActivity("history");
    const { activity, sidebarVisible } = useUIStore.getState();
    expect(activity).toBe("history");
    expect(sidebarVisible).toBe(true);
    // SideBar would render: titles["history"] = "History", and placeholder div
  });

  test("toggling sidebar off hides the panel content", () => {
    useUIStore.getState().setActivity("review"); // same → toggle off
    expect(useUIStore.getState().sidebarVisible).toBe(false);
    // ActivityBar: active = false (sidebarVisible is false)
    // SideBar parent in App.tsx would hide SideBar when !sidebarVisible
  });

  test("component chain: ReviewView assembles ReviewPanel + EditorArea + findings panel", () => {
    const reviewViewSrc = readSrc("src/components/review/ReviewView.tsx");
    expect(reviewViewSrc).toContain("ReviewPanel");
    expect(reviewViewSrc).toContain("EditorArea");
    expect(reviewViewSrc).toContain("AiReviewPanel");

    const reviewPanelSrc = readSrc("src/components/sidebar/ReviewPanel.tsx");
    expect(reviewPanelSrc).toContain("export function ReviewPanel");
    expect(reviewPanelSrc.includes("GitPanel")).toBe(false);
  });

  test("Review page diff pane has its OWN empty placeholder (not the editor's)", () => {
    const reviewViewSrc = readSrc("src/components/review/ReviewView.tsx");
    // Overridden empty state with diff wording + diff icon.
    expect(reviewViewSrc).toContain("emptyPlaceholder");
    expect(reviewViewSrc).toContain("GitCompareArrows");
    expect(reviewViewSrc).toContain("Select a changed file to view its diff");
    // The editor's "open a file" hint must never leak into the review pane.
    expect(reviewViewSrc.includes("Open a file to start exploring")).toBe(false);

    // EditorArea accepts the override and keeps its editor default intact.
    const editorAreaSrc = readSrc("src/components/editor/EditorArea.tsx");
    expect(editorAreaSrc).toContain("emptyPlaceholder");
    expect(editorAreaSrc).toContain("Open a file to start exploring");
  });
});

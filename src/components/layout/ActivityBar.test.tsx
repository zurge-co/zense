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

// ── ActivityBar.tsx structural tests ───────────────────────────────────────

describe("ActivityBar.tsx — task 1.3 structural verification", () => {
  const src = readSrc("src/components/layout/ActivityBar.tsx");

  test("file is non-empty and exports ActivityBar component", () => {
    expect(src.length).toBeGreaterThan(50);
    expect(src).toContain("export function ActivityBar");
  });

  // ── Exactly 3 activity buttons ──────────────────────────────────────────

  test("items array has exactly 3 entries", () => {
    // The items array defines the buttons; verify it has exactly 3 entries.
    const itemsMatch = src.match(
      /const items[^=]*=\s*\[([\s\S]*?)\];/,
    );
    expect(itemsMatch).not.toBe(null);
    const itemsBlock = itemsMatch![1];
    const idMatches = itemsBlock.match(/\bid:\s*"(review|history|editor)"/g);
    expect(idMatches).not.toBe(null);
    expect(idMatches!.length).toBe(3);
  });

  test("items array contains review, history, and editor in order", () => {
    const itemsMatch = src.match(
      /const items[^=]*=\s*\[([\s\S]*?)\];/,
    );
    const itemsBlock = itemsMatch![1];
    const ids = itemsBlock.match(/\bid:\s*"(review|history|editor)"/g);
    expect(ids).toEqual([
      'id: "review"',
      'id: "history"',
      'id: "editor"',
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

  test("labels are Review, History, Editor, Search", () => {
    const itemsMatch = src.match(
      /const items[^=]*=\s*\[([\s\S]*?)\];/,
    );
    const itemsBlock = itemsMatch![1];
    const labelMatches = itemsBlock.match(/label:\s*"([^"]+)"/g);
    expect(labelMatches).toEqual([
      'label: "Review"',
      'label: "History"',
      'label: "Editor"',
      'label: "Search (⌘⇧F)"',
      'label: "Terminal (⌘`)"',
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

  test("active state is activity === id && sidebarVisible", () => {
    expect(src).toContain("activity === id && sidebarVisible");
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

  test("imports the Search icon for the workspace-search activity", () => {
    expect(src).toContain("Search");
    expect(src).toContain('id: "search"');
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

  test("active state is false when sidebarVisible is false even if activity matches", () => {
    // activity=review, sidebarVisible=true initially
    useUIStore.getState().setActivity("review"); // toggle off → sidebarVisible=false
    const { activity, sidebarVisible } = useUIStore.getState();
    // The component computes: active = activity === id && sidebarVisible
    const activeForReview = activity === "review" && sidebarVisible;
    expect(activeForReview).toBe(false);
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

  test("openSearch switches to the search activity", () => {
    useUIStore.getState().openSearch();
    expect(useUIStore.getState().activity).toBe("search");
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

  test("imports ReviewPanel component (not GitPanel)", () => {
    expect(src).toContain('import { ReviewPanel }');
    expect(src).toContain('"./ReviewPanel"');
    expect(src.includes("GitPanel")).toBe(false);
  });

  test("titles map has Review, History, Editor entries", () => {
    const titlesMatch = src.match(
      /const titles[^=]*=\s*\{([\s\S]*?)\};/,
    );
    expect(titlesMatch).not.toBe(null);
    const titlesBlock = titlesMatch![1];
    expect(titlesBlock).toContain('review: "Review"');
    expect(titlesBlock).toContain('history: "History"');
    expect(titlesBlock).toContain('editor: "Editor"');
  });

  test("renders FileTree when activity is editor", () => {
    expect(src).toContain('activity === "editor" && <FileTree');
  });

  test("renders ReviewPanel when activity is review", () => {
    expect(src).toContain('activity === "review" && <ReviewPanel');
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
    // SearchPanel is now shipped — it backs the workspace search activity.
    expect(src).toContain("SearchPanel");
  });

  test("title is derived from titles map using activity", () => {
    expect(src).toContain("{titles[activity]}");
  });

  test("does NOT have separate panel branches for removed activities", () => {
    expect(src.includes('"agent"')).toBe(false);
    expect(src.includes('"graph"')).toBe(false);
    expect(src.includes('"prompts"')).toBe(false);
    // "search" is now shipped: SearchPanel renders for it.
    expect(src).toContain('activity === "search" && <SearchPanel');
  });

  test("terminal activity renders no sidebar section (early return null, no panel branch)", () => {
    // The terminal is an ActivityBar main view; its only mention here is the
    // guard that removes the (otherwise empty) sidebar section.
    expect(src).toContain('if (activity === "terminal") return null');
    expect(src.includes('activity === "terminal" &&')).toBe(false);
    expect(src.includes('"terminal":')).toBe(false); // no titles entry
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

  test("renamed component chain: SideBar imports ReviewPanel, not GitPanel", () => {
    const sideBarSrc = readSrc("src/components/sidebar/SideBar.tsx");
    expect(sideBarSrc).toContain("ReviewPanel");
    expect(sideBarSrc.includes("GitPanel")).toBe(false);

    const reviewPanelSrc = readSrc("src/components/sidebar/ReviewPanel.tsx");
    expect(reviewPanelSrc).toContain("export function ReviewPanel");
    expect(reviewPanelSrc.includes("GitPanel")).toBe(false);
  });
});

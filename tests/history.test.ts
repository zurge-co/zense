/**
 * History Panel tests — commit list UI, commit detail view, compare commits.
 *
 * Follows the structural-verification pattern from task-1.2.uiStore.test.ts:
 * exercise the real Zustand store and pure helpers directly, and read
 * component source text to assert wiring (imports, commands, openers).
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { useUIStore, tabKey } from "../src/store/uiStore";
import { formatRelativeTime, formatAbsoluteTime, formatFullTime } from "../src/lib/time";
import * as fs from "fs";
import * as path from "path";

// ── Helpers ───────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), "utf-8");

const A_SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const B_SHA = "b2c3d4e5f60718293a4b5c6d7e8f9012345678a1";

const resetStore = () =>
  useUIStore.setState({
    openTabs: [],
    activeTabKey: null,
    selectedFile: null,
    historyCompareBase: null,
  });

// ── uiStore: new tab kinds ────────────────────────────────────────────────

describe("uiStore — history tab kinds", () => {
  beforeEach(resetStore);

  test("openCommit adds a commit tab keyed by sha", () => {
    useUIStore.getState().openCommit(A_SHA);
    const s = useUIStore.getState();
    expect(s.openTabs).toHaveLength(1);
    expect(s.openTabs[0].kind).toBe("commit");
    expect(s.openTabs[0].path).toBe(A_SHA);
    expect(s.activeTabKey).toBe(tabKey({ kind: "commit", path: A_SHA }));
  });

  test("openCommit is idempotent for the same sha", () => {
    const { openCommit } = useUIStore.getState();
    openCommit(A_SHA);
    openCommit(A_SHA);
    expect(useUIStore.getState().openTabs).toHaveLength(1);
  });

  test("openCommitFileDiff defaults fromSha to null (commit vs parent)", () => {
    useUIStore.getState().openCommitFileDiff("src/a.ts", A_SHA);
    const tab = useUIStore.getState().openTabs[0];
    expect(tab.kind).toBe("commitDiff");
    expect(tab.path).toBe("src/a.ts");
    expect(tab.toSha).toBe(A_SHA);
    expect(tab.fromSha).toBeNull();
  });

  test("commitDiff tabs for different shas of the same file are distinct", () => {
    const s = useUIStore.getState();
    s.openCommitFileDiff("src/a.ts", A_SHA);
    s.openCommitFileDiff("src/a.ts", B_SHA);
    s.openCommitFileDiff("src/a.ts", B_SHA, A_SHA);
    const tabs = useUIStore.getState().openTabs;
    expect(tabs).toHaveLength(3);
    const keys = tabs.map(tabKey);
    expect(new Set(keys).size).toBe(3);
  });

  test("openCompare sets shas and clears the compare-base selection", () => {
    useUIStore.getState().setHistoryCompareBase(A_SHA);
    useUIStore.getState().openCompare(A_SHA, B_SHA);
    const s = useUIStore.getState();
    expect(s.historyCompareBase).toBeNull();
    expect(s.openTabs[0]).toMatchObject({
      kind: "compare",
      fromSha: A_SHA,
      toSha: B_SHA,
      path: `${A_SHA}..${B_SHA}`,
    });
  });

  test("setHistoryCompareBase toggles via null", () => {
    useUIStore.getState().setHistoryCompareBase(A_SHA);
    expect(useUIStore.getState().historyCompareBase).toBe(A_SHA);
    useUIStore.getState().setHistoryCompareBase(null);
    expect(useUIStore.getState().historyCompareBase).toBeNull();
  });

  test("file and commitDiff tabs with the same path do not collide", () => {
    const s = useUIStore.getState();
    s.openFile("src/a.ts");
    s.openCommitFileDiff("src/a.ts", A_SHA);
    expect(useUIStore.getState().openTabs).toHaveLength(2);
  });

  test("closeTab removes a commit tab and keeps others", () => {
    const s = useUIStore.getState();
    s.openFile("src/a.ts");
    s.openCommit(A_SHA);
    const commitKey = tabKey({ kind: "commit", path: A_SHA });
    expect(useUIStore.getState().activeTabKey).toBe(commitKey);
    useUIStore.getState().closeTab(commitKey);
    const after = useUIStore.getState();
    expect(after.openTabs).toHaveLength(1);
    expect(after.openTabs[0].kind).toBe("file");
    // Active tab falls back to the remaining tab.
    expect(after.activeTabKey).toBe(tabKey({ kind: "file", path: "src/a.ts" }));
  });
});

// ── time helpers ──────────────────────────────────────────────────────────

describe("time.ts — formatting", () => {
  const now = Math.floor(Date.now() / 1000);

  test("just now for < 1 minute", () => {
    expect(formatRelativeTime(now)).toBe("just now");
    expect(formatRelativeTime(now - 30)).toBe("just now");
  });

  test("minutes / hours / days", () => {
    expect(formatRelativeTime(now - 5 * 60)).toBe("5m ago");
    expect(formatRelativeTime(now - 2 * 3600)).toBe("2h ago");
    expect(formatRelativeTime(now - 3 * 86400)).toBe("3d ago");
  });

  test("older than a week falls back to a date string", () => {
    const r = formatRelativeTime(now - 30 * 86400);
    expect(r).not.toContain("ago");
    expect(r.length).toBeGreaterThan(3);
  });

  test("absolute time includes month and day", () => {
    const r = formatAbsoluteTime(0); // Jan 1 1970
    expect(r).toContain("1");
    expect(formatFullTime(now - 3600)).toContain(":");
  });
});

// ── Structural wiring ─────────────────────────────────────────────────────

describe("History panel — source wiring", () => {
  test("SideBar renders HistoryPanel instead of the placeholder", () => {
    const src = readSrc("src/components/sidebar/SideBar.tsx");
    expect(src).toContain('import { HistoryPanel } from "./HistoryPanel"');
    expect(src).toContain('activity === "history" && <HistoryPanel />');
    expect(src).not.toContain("No commits yet");
  });

  test("HistoryPanel uses store commits + infinite scroll via IntersectionObserver", () => {
    const src = readSrc("src/components/sidebar/HistoryPanel.tsx");
    expect(src).toContain("useGitStore");
    expect(src).toContain("loadMoreCommits");
    expect(src).toContain("IntersectionObserver");
    expect(src).toContain("logHasMore");
    expect(src).toContain("openCommit(");
    expect(src).toContain("openCompare(");
    expect(src).toContain("historyCompareBase");
  });

  test("CommitDetail loads git_show and opens commit-file diffs", () => {
    const src = readSrc("src/components/editor/CommitDetail.tsx");
    expect(src).toContain("gitShow");
    expect(src).toContain("openCommitFileDiff(f.path, commit.sha)");
    expect(src).toContain("merge");
  });

  test("CompareView loads git_diff_commits and opens cross-commit diffs", () => {
    const src = readSrc("src/components/editor/CompareView.tsx");
    expect(src).toContain("gitDiffCommits");
    expect(src).toContain("openCommitFileDiff(f.path, toSha, fromSha)");
  });

  test("DiffView supports commit mode via git_diff_commit_file", () => {
    const src = readSrc("src/components/editor/DiffView.tsx");
    expect(src).toContain("gitDiffCommitFile");
    expect(src).toContain('tab.kind === "commitDiff"');
  });

  test("EditorArea renders the new tab kinds", () => {
    const src = readSrc("src/components/editor/EditorArea.tsx");
    expect(src).toContain("<CommitDetail");
    expect(src).toContain("<CompareView");
    expect(src).toContain("<DiffView tab={activeTab} />");
  });

  test("git.ts exposes gitDiffCommitFile with a browser mock", () => {
    const src = readSrc("src/lib/git.ts");
    expect(src).toContain("export async function gitDiffCommitFile");
    expect(src).toContain('"git_diff_commit_file"');
  });

  test("Rust backend registers git_diff_commit_file", () => {
    const cmd = readSrc("src-tauri/src/gitcmd.rs");
    expect(cmd).toContain("pub fn git_diff_commit_file");
    const lib = readSrc("src-tauri/src/lib.rs");
    expect(lib).toContain("gitcmd::git_diff_commit_file");
  });
});

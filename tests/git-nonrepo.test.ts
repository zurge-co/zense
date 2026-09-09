/**
 * Non-git workspace refresh — the store must land on a real empty state,
 * never on the browser-dev mock data.
 *
 * gitStore.refresh() used to Promise.all() every command at once; on a
 * non-repo root git_branch_info/git_diff_summary error in the Rust backend,
 * the whole refresh rejected and the mock initial state survived on screen.
 * These tests mock src/lib/git the way the backend behaves for such roots.
 */
import { describe, test, expect, mock } from "bun:test";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), "utf-8");

// Mutable scenario knobs — flipped per test before refresh() is called.
let notARepo = true;
let emptyRepo = false;

mock.module("../src/lib/git", () => ({
  gitStatus: async () => ({ files: [], notARepo, emptyRepo }),
  // The Rust backend errors on non-repo and (for branch info) empty repos.
  gitBranchInfo: async () => {
    throw new Error("not a git repository");
  },
  gitDiffSummary: async () => {
    if (notARepo) throw new Error("not a git repository");
    return { staged: [], unstaged: [] };
  },
  gitLog: async () => [],
  gitStage: async () => {},
  gitUnstage: async () => {},
  gitDiscardFile: async () => {},
  gitCommit: async () => "deadbeef",
  gitMergeInProgress: async () => {
    if (notARepo) throw new Error("not a git repository");
    return { inProgress: false };
  },
  gitConflicts: async () => [],
  gitMergeAbort: async () => {},
  mockGitStatus: { files: [], notARepo: false, emptyRepo: false },
  // Must match the required GitBranchInfo schema (hasUpstream included).
  mockBranchInfo: { branch: "mock", detached: false, ahead: 0, behind: 0, hasUpstream: true },
  mockDiffSummary: { staged: [], unstaged: [] },
  mockGitLog: [],
  mockMergeInProgress: { inProgress: false },
}));

const { useGitStore } = await import("../src/store/gitStore");

describe("gitStore.refresh on a non-git workspace", () => {
  test("clears all state — no mock data survives", async () => {
    notARepo = true;
    emptyRepo = false;
    const s = useGitStore.getState();
    // Pre-seed the leftover state the bug left on screen.
    useGitStore.setState({
      status: { files: [{ path: "x.ts", unstaged: "M" }], notARepo: false, emptyRepo: false },
      branchInfo: { branch: "main", detached: false, ahead: 2, behind: 0, hasUpstream: true },
      commits: [
        { sha: "a", shortSha: "a", message: "m", summary: "m", author: "d", time: 0, parentCount: 1, isMerge: false, filesChanged: 1, additions: 1, deletions: 0 },
      ],
    });
    await s.refresh("/tmp/definitely-not-a-repo");
    const next = useGitStore.getState();
    expect(next.status.notARepo).toBe(true);
    expect(next.status.files).toEqual([]);
    expect(next.branchInfo.branch).toBeUndefined();
    expect(next.branchInfo.ahead).toBe(0);
    // Fail-closed: unknown branch state must keep Push locked, not open it.
    expect(next.branchInfo.hasUpstream).toBe(true);
    expect(next.diffSummary).toEqual({ staged: [], unstaged: [] });
    expect(next.commits).toEqual([]);
    expect(next.logHasMore).toBe(false);
    expect(next.mergeInfo.inProgress).toBe(false);
    expect(next.conflicts).toEqual([]);
    expect(next.error).toBeNull();
    expect(next.loading).toBe(false);
  });

  test("empty repo: a failing gitBranchInfo falls back instead of rejecting", async () => {
    notARepo = false;
    emptyRepo = true;
    await useGitStore.getState().refresh("/tmp/empty-repo");
    const s = useGitStore.getState();
    expect(s.status.notARepo).toBe(false);
    expect(s.status.emptyRepo).toBe(true);
    expect(s.branchInfo.branch).toBeUndefined();
    expect(s.branchInfo.detached).toBe(false);
    // Fail-closed: an un-pushable empty repo must keep Push locked
    // (hasUpstream true + ahead 0 reproduces the old ahead === 0 lock).
    expect(s.branchInfo.hasUpstream).toBe(true);
    expect(s.commits).toEqual([]);
    expect(s.error).toBeNull();
  });
});

// ── Structural checks (repo test pattern) ─────────────────────────────────

describe("gitStore.ts non-repo handling — source wiring", () => {
  const src = readSrc("src/store/gitStore.ts");

  test("refresh early-returns with a cleared state when status.notARepo", () => {
    expect(src).toContain("status.notARepo");
    expect(src).toContain("commits: []");
    expect(src).toContain("logHasMore: false");
  });

  test("each backend command has its own fallback", () => {
    expect(src).toContain("gitBranchInfo(root).catch(");
    expect(src).toContain("gitDiffSummary(root).catch(");
    expect(src).toContain("gitLog(root, 0, 50).catch(");
    expect(src).toContain("gitMergeInProgress(root).catch(");
    expect(src).toContain("gitConflicts(root).catch(");
  });
});

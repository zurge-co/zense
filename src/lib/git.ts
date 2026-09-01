import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./workspace";
import { mockFiles } from "./mockData";

/**
 * Git commands (Rust backend via git2). Every function falls back to mock
 * data in plain browser dev so the UI stays explorable without Tauri.
 */

export interface GitFileStatus {
  path: string;
  staged?: "M" | "A" | "D" | "R" | "C";
  unstaged?: "M" | "A" | "D" | "R" | "C";
  oldPath?: string;
}

export interface GitStatus {
  files: GitFileStatus[];
  notARepo: boolean;
  emptyRepo: boolean;
}

export interface GitBranchInfo {
  branch?: string;
  detached: boolean;
  ahead: number;
  behind: number;
}

export interface GitDiffEntry {
  path: string;
  status: "M" | "A" | "D" | "R" | "C";
  additions: number;
  deletions: number;
  oldPath?: string;
}

export interface GitDiffSummary {
  staged: GitDiffEntry[];
  unstaged: GitDiffEntry[];
}

export interface GitDiffFile {
  path: string;
  status: "M" | "A" | "D" | "R" | "C";
  original: string;
  modified: string;
  isBinary: boolean;
  oldPath?: string;
}

export interface GitLogEntry {
  sha: string;
  shortSha: string;
  message: string;
  summary: string;
  author: string;
  time: number;
  parentCount: number;
  isMerge: boolean;
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface GitShowCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  time: number;
  parentCount: number;
  isMerge: boolean;
  files: GitDiffEntry[];
}

export interface GitDiffCommits {
  fromSha: string;
  toSha: string;
  files: GitDiffEntry[];
}

// ---------------------------------------------------------------------------
// Browser-dev mock data
// ---------------------------------------------------------------------------

export const mockGitStatus: GitStatus = {
  files: [
    { path: "src/auth/login.ts", unstaged: "M" },
    { path: "src/middleware/auth.ts", unstaged: "M" },
    { path: "src/auth/refresh.ts", unstaged: "A" },
    { path: "src/auth/legacy.ts", unstaged: "D" },
  ],
  notARepo: false,
  emptyRepo: false,
};

export const mockBranchInfo: GitBranchInfo = {
  branch: "main",
  detached: false,
  ahead: 2,
  behind: 0,
};

export const mockDiffSummary: GitDiffSummary = {
  staged: [],
  unstaged: [
    { path: "src/auth/login.ts", status: "M", additions: 1, deletions: 0 },
    { path: "src/middleware/auth.ts", status: "M", additions: 4, deletions: 3 },
    { path: "src/auth/refresh.ts", status: "A", additions: 9, deletions: 0 },
    { path: "src/auth/legacy.ts", status: "D", additions: 0, deletions: 7 },
  ],
};

const now = Math.floor(Date.now() / 1000);
const day = 86400;

export const mockGitLog: GitLogEntry[] = [
  { sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", shortSha: "a1b2c3d", message: "Add token refresh endpoint", summary: "Add token refresh endpoint", author: "dev", time: now - 3600, parentCount: 1, isMerge: false, filesChanged: 2, additions: 40, deletions: 3 },
  { sha: "b2c3d4e5f60718293a4b5c6d7e8f9012345678a1", shortSha: "b2c3d4e", message: "Merge branch 'feature/auth-cleanup'", summary: "Merge branch 'feature/auth-cleanup'", author: "dev", time: now - day, parentCount: 2, isMerge: true, filesChanged: 0, additions: 0, deletions: 0 },
  { sha: "c3d4e5f60718293a4b5c6d7e8f9012345678a1b2", shortSha: "c3d4e5f", message: "Fix session expiry edge case", summary: "Fix session expiry edge case", author: "dev", time: now - day * 2, parentCount: 1, isMerge: false, filesChanged: 1, additions: 12, deletions: 4 },
  { sha: "d4e5f60718293a4b5c6d7e8f9012345678a1b2c3", shortSha: "d4e5f60", message: "Introduce audit log middleware", summary: "Introduce audit log middleware", author: "dev", time: now - day * 3, parentCount: 1, isMerge: false, filesChanged: 3, additions: 88, deletions: 0 },
  { sha: "e5f60718293a4b5c6d7e8f9012345678a1b2c3d4", shortSha: "e5f6071", message: "Initial commit", summary: "Initial commit", author: "dev", time: now - day * 4, parentCount: 0, isMerge: false, filesChanged: 5, additions: 210, deletions: 0 },
];

const mockShowCommit: GitShowCommit = {
  sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  shortSha: "a1b2c3d",
  message: "Add token refresh endpoint",
  author: "dev",
  time: now - 3600,
  parentCount: 1,
  isMerge: false,
  files: [
    { path: "src/auth/refresh.ts", status: "A", additions: 35, deletions: 0 },
    { path: "src/auth/login.ts", status: "M", additions: 5, deletions: 3 },
  ],
};

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

export async function gitStatus(root: string): Promise<GitStatus> {
  if (!isTauri()) return mockGitStatus;
  return invoke<GitStatus>("git_status", { root });
}

export async function gitBranchInfo(root: string): Promise<GitBranchInfo> {
  if (!isTauri()) return mockBranchInfo;
  return invoke<GitBranchInfo>("git_branch_info", { root });
}

export async function gitDiffSummary(root: string): Promise<GitDiffSummary> {
  if (!isTauri()) return mockDiffSummary;
  return invoke<GitDiffSummary>("git_diff_summary", { root });
}

export async function gitDiffFile(root: string, path: string, staged: boolean): Promise<GitDiffFile> {
  if (!isTauri()) {
    const content = mockFiles[path]?.content ?? "// mock content\n";
    return {
      path,
      status: "M",
      original: `// old version\n${content}`,
      modified: content,
      isBinary: false,
    };
  }
  return invoke<GitDiffFile>("git_diff_file", { root, path, staged });
}

export async function gitStage(root: string, path: string): Promise<void> {
  if (!isTauri()) return; // browser dev: no-op
  return invoke<void>("git_stage", { root, path });
}

export async function gitUnstage(root: string, path: string): Promise<void> {
  if (!isTauri()) return; // browser dev: no-op
  return invoke<void>("git_unstage", { root, path });
}

/** Reset a file to HEAD: tracked → discard working+staged changes back to
 *  the HEAD version; staged-new/untracked → remove from the index and
 *  delete the file. Browser dev: no-op. */
export async function gitDiscardFile(root: string, path: string): Promise<void> {
  if (!isTauri()) return; // browser dev: no-op
  return invoke<void>("git_discard_file", { root, path });
}

export interface DiscardLinesArgs {
  /** 1-based inclusive bounds on the working-tree side (empty range:
   *  end = start - 1, i.e. re-insert the staged lines before `start`). */
  startLine: number;
  endLine: number;
  /** 1-based inclusive bounds on the staged side (empty range: remove the
   *  working-tree lines without re-inserting anything). */
  originalStartLine: number;
  originalEndLine: number;
  /** Exact texts the diff view rendered — stale-content guards. */
  workContent: string;
  baseContent: string;
}

/** Revert one change block of the working-tree diff back to the staged
 *  (index) version. Backend refuses stale content instead of patching
 *  wrong lines. Browser dev: no-op. */
export async function gitDiscardLines(root: string, path: string, args: DiscardLinesArgs): Promise<void> {
  if (!isTauri()) return; // browser dev: no-op
  return invoke<void>("git_discard_lines", {
    root,
    path,
    startLine: args.startLine,
    endLine: args.endLine,
    originalStartLine: args.originalStartLine,
    originalEndLine: args.originalEndLine,
    workContent: args.workContent,
    baseContent: args.baseContent,
  });
}

export async function gitCommit(root: string, message: string): Promise<string> {
  if (!isTauri()) return "0123456789abcdef0123456789abcdef01234567";
  return invoke<string>("git_commit", { root, message });
}

export async function gitLog(root: string, offset: number, limit: number): Promise<GitLogEntry[]> {
  if (!isTauri()) return offset === 0 ? mockGitLog : [];
  return invoke<GitLogEntry[]>("git_log", { root, offset, limit });
}

export async function gitShow(root: string, sha: string): Promise<GitShowCommit> {
  if (!isTauri()) return { ...mockShowCommit, sha, shortSha: sha.slice(0, 7) };
  return invoke<GitShowCommit>("git_show", { root, sha });
}

/**
 * Per-file content diff between two commits (or a commit vs its first
 * parent when `fromSha` is null; root commit diffs against the empty tree).
 */
export async function gitDiffCommitFile(
  root: string,
  path: string,
  fromSha: string | null,
  toSha: string
): Promise<GitDiffFile> {
  if (!isTauri()) {
    const content = mockFiles[path]?.content ?? "// mock content\n";
    return {
      path,
      status: "M",
      original: `// at ${fromSha ? fromSha.slice(0, 7) : "parent"}\n${content}`,
      modified: content,
      isBinary: false,
    };
  }
  return invoke<GitDiffFile>("git_diff_commit_file", { root, path, fromSha, toSha });
}

export async function gitDiffCommits(root: string, fromSha: string, toSha: string): Promise<GitDiffCommits> {
  if (!isTauri()) {
    return {
      fromSha,
      toSha,
      files: [
        { path: "src/auth/login.ts", status: "M", additions: 12, deletions: 3 },
        { path: "src/auth/refresh.ts", status: "A", additions: 45, deletions: 0 },
      ],
    };
  }
  return invoke<GitDiffCommits>("git_diff_commits", { root, fromSha, toSha });
}

// ── Branch menu (StatusBar): junior-friendly fetch/pull/checkout ──────────

export interface GitBranchEntry {
  name: string;
  isHead: boolean;
  /** Remote-tracking entries ("origin/x") — shown after locals with a
   *  server tag; checking out creates a local tracking branch. */
  isRemote: boolean;
}

export interface GitOpResult {
  ok: boolean;
  message: string;
}

export async function gitListBranches(root: string): Promise<GitBranchEntry[]> {
  if (!isTauri()) {
    return [
      { name: "main", isHead: true, isRemote: false },
      { name: "feature/demo", isHead: false, isRemote: false },
      { name: "origin/new-teammate-work", isHead: false, isRemote: true },
    ];
  }
  return invoke<GitBranchEntry[]>("git_list_branches", { root });
}

export async function gitCheckoutBranch(root: string, name: string): Promise<void> {
  if (!isTauri()) return;
  return invoke("git_checkout_branch", { root, name });
}

/** Checkout "origin/x": switch if local exists, else create tracking
 *  branch + switch — same dwim behavior as the git CLI. */
export async function gitCheckoutRemoteBranch(root: string, name: string): Promise<void> {
  if (!isTauri()) return;
  return invoke("git_checkout_remote_branch", { root, name });
}

export async function gitCreateBranch(root: string, name: string): Promise<string> {
  if (!isTauri()) return name;
  return invoke<string>("git_create_branch", { root, name });
}

export async function gitFetch(root: string): Promise<GitOpResult> {
  if (!isTauri()) return { ok: true, message: "Fetched — nothing new on the remote. (preview)" };
  return invoke<GitOpResult>("git_fetch", { root });
}

export async function gitPull(root: string): Promise<GitOpResult> {
  if (!isTauri()) return { ok: true, message: "Already up to date. (preview)" };
  return invoke<GitOpResult>("git_pull", { root });
}

export async function gitPush(root: string): Promise<GitOpResult> {
  if (!isTauri()) return { ok: true, message: "Pushed your commits to the remote. (preview)" };
  return invoke<GitOpResult>("git_push", { root });
}

/** Unified patch of the staged index vs HEAD — the AI commit-message
 *  generator's input. Capped server-side; empty string when nothing staged. */
export async function gitStagedDiff(root: string): Promise<string> {
  if (!isTauri())
    return 'diff --git a/src/app.ts b/src/app.ts\nindex 1111111..2222222 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n export const x = 1;\n+console.log("preview staged diff");\n export const y = 2;\n';
  return invoke<string>("git_staged_diff", { root });
}

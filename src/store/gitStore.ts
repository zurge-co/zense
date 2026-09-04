import { create } from "zustand";
import { appendZenseTrailer } from "../lib/commitTrailer";
import { useWorkspaceStore } from "./workspaceStore";
import {
  gitStatus,
  gitBranchInfo,
  gitDiffSummary,
  gitLog,
  gitStage,
  gitUnstage,
  gitDiscardFile,
  gitCommit,
  gitMergeInProgress,
  gitConflicts,
  gitMergeAbort,
  mockGitStatus,
  mockBranchInfo,
  mockDiffSummary,
  mockGitLog,
  mockMergeInProgress,
  type GitStatus,
  type GitBranchInfo,
  type GitDiffSummary,
  type GitLogEntry,
  type GitMergeInProgress,
  type GitConflictEntry,
} from "../lib/git";

/**
 * Chunk 2 derive step: a conflicted path that vanished from the index
 * conflict list while the operation is still in flight counts as resolved
 * (the user staged their fix). A clean repo resets the bookkeeping.
 * Pure and exported for tests.
 */
export function deriveResolvedPaths(
  prev: { conflicts: GitConflictEntry[]; resolvedPaths: string[] },
  nextInfo: GitMergeInProgress,
  nextConflicts: GitConflictEntry[]
): string[] {
  if (!nextInfo.inProgress) return [];
  const nextPaths = new Set(nextConflicts.map((c) => c.path));
  const newlyResolved = prev.conflicts
    .map((c) => c.path)
    .filter((p) => !nextPaths.has(p));
  return [...new Set([...prev.resolvedPaths, ...newlyResolved])];
}

/**
 * Git state: status, branch info, diff summary and commit log. Starts with
 * mock data so browser dev keeps working; `refresh` replaces it with the
 * real thing when a workspace is open.
 */
interface GitState {
  status: GitStatus;
  branchInfo: GitBranchInfo;
  diffSummary: GitDiffSummary;
  commits: GitLogEntry[];
  logHasMore: boolean;
  loading: boolean;
  logLoading: boolean;
  error: string | null;
  currentRoot: string | null;

  // ── Chunk 2: Conflict Resolution Mode ──────────────────────────────────
  /** Merge/rebase/cherry-pick/revert currently parked mid-flight. */
  mergeInfo: GitMergeInProgress;
  /** Files still conflicted in the index. */
  conflicts: GitConflictEntry[];
  /** Paths that left the conflict list during this operation (resolved). */
  resolvedPaths: string[];
  /** `git merge --abort`. Throws the backend's message verbatim (callers
   *  render it) — e.g. the terminal hint for non-merge operations. */
  abortMerge: () => Promise<void>;

  /** Full refresh after open/stage/unstage/commit/file save. */
  refresh: (root: string) => Promise<void>;
  /** Append next 50 commits (infinite scroll). */
  loadMoreCommits: () => Promise<void>;
  stageFile: (path: string) => Promise<void>;
  unstageFile: (path: string) => Promise<void>;
  /** Reset a file to HEAD: discard working+staged changes; new files are
   *  removed. The caller is responsible for confirming first. */
  discardFile: (path: string) => Promise<void>;
  stageAll: () => Promise<void>;
  commit: (message: string) => Promise<string>;
}

/** Incremented per refresh(); stale responses are discarded. */
let refreshNonce = 0;

export const useGitStore = create<GitState>((set, get) => ({
  status: mockGitStatus,
  branchInfo: mockBranchInfo,
  diffSummary: mockDiffSummary,
  commits: mockGitLog,
  logHasMore: false,
  loading: false,
  logLoading: false,
  error: null,
  currentRoot: null,
  mergeInfo: mockMergeInProgress,
  conflicts: [],
  resolvedPaths: [],

  abortMerge: async () => {
    const { currentRoot } = get();
    if (!currentRoot) throw new Error("No workspace open");
    await gitMergeAbort(currentRoot);
    await get().refresh(currentRoot);
  },

  refresh: async (root) => {
    const nonce = ++refreshNonce;
    set({ loading: true, currentRoot: root });
    try {
      const [status, branchInfo, diffSummary, page, mergeInfo, conflicts] = await Promise.all([
        gitStatus(root),
        gitBranchInfo(root),
        gitDiffSummary(root),
        gitLog(root, 0, 50),
        gitMergeInProgress(root),
        gitConflicts(root),
      ]);
      if (nonce !== refreshNonce) return; // a newer refresh superseded this one
      const resolvedPaths = deriveResolvedPaths(get(), mergeInfo, conflicts);
      set({
        status,
        branchInfo,
        diffSummary,
        commits: page,
        logHasMore: page.length === 50,
        mergeInfo,
        conflicts,
        resolvedPaths,
        error: null,
      });
    } catch (err) {
      if (nonce === refreshNonce) set({ error: String(err) });
    } finally {
      if (nonce === refreshNonce) set({ loading: false });
    }
  },

  loadMoreCommits: async () => {
    const { currentRoot, commits, logLoading, logHasMore } = get();
    if (!currentRoot || logLoading || !logHasMore) return;
    set({ logLoading: true });
    try {
      const page = await gitLog(currentRoot, commits.length, 50);
      set((s) => ({
        commits: [...s.commits, ...page],
        logHasMore: page.length === 50,
      }));
    } catch (err) {
      set({ error: String(err) });
    } finally {
      set({ logLoading: false });
    }
  },

  stageFile: async (path) => {
    const { currentRoot } = get();
    if (!currentRoot) return;
    try {
      await gitStage(currentRoot, path);
      await get().refresh(currentRoot);
    } catch (err) {
      set({ error: String(err) });
    }
  },

  unstageFile: async (path) => {
    const { currentRoot } = get();
    if (!currentRoot) return;
    try {
      await gitUnstage(currentRoot, path);
      await get().refresh(currentRoot);
    } catch (err) {
      set({ error: String(err) });
    }
  },

  discardFile: async (path) => {
    const { currentRoot } = get();
    if (!currentRoot) return;
    try {
      await gitDiscardFile(currentRoot, path);
      await get().refresh(currentRoot);
    } catch (err) {
      set({ error: String(err) });
    }
  },

  stageAll: async () => {
    const { currentRoot, status } = get();
    if (!currentRoot) return;
    const unstagedPaths = status.files
      .filter((f) => f.unstaged)
      .map((f) => f.path);
    for (const p of unstagedPaths) {
      await gitStage(currentRoot, p);
    }
    await get().refresh(currentRoot);
  },

  commit: async (message) => {
    const { currentRoot } = get();
    if (!currentRoot) throw new Error("No workspace open");
    const { commitStamp, commitStampName } = useWorkspaceStore.getState();
    const finalMessage = commitStamp ? appendZenseTrailer(message, commitStampName) : message;
    const sha = await gitCommit(currentRoot, finalMessage);
    await get().refresh(currentRoot);
    return sha;
  },
}));

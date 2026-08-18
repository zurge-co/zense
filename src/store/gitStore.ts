import { create } from "zustand";
import {
  gitStatus,
  gitBranchInfo,
  gitDiffSummary,
  gitLog,
  gitStage,
  gitUnstage,
  gitCommit,
  mockGitStatus,
  mockBranchInfo,
  mockDiffSummary,
  mockGitLog,
  type GitStatus,
  type GitBranchInfo,
  type GitDiffSummary,
  type GitLogEntry,
} from "../lib/git";

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

  /** Full refresh after open/stage/unstage/commit/file save. */
  refresh: (root: string) => Promise<void>;
  /** Append next 50 commits (infinite scroll). */
  loadMoreCommits: () => Promise<void>;
  stageFile: (path: string) => Promise<void>;
  unstageFile: (path: string) => Promise<void>;
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

  refresh: async (root) => {
    const nonce = ++refreshNonce;
    set({ loading: true, currentRoot: root });
    try {
      const [status, branchInfo, diffSummary, page] = await Promise.all([
        gitStatus(root),
        gitBranchInfo(root),
        gitDiffSummary(root),
        gitLog(root, 0, 50),
      ]);
      if (nonce !== refreshNonce) return; // a newer refresh superseded this one
      set({
        status,
        branchInfo,
        diffSummary,
        commits: page,
        logHasMore: page.length === 50,
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
    const sha = await gitCommit(currentRoot, message);
    await get().refresh(currentRoot);
    return sha;
  },
}));

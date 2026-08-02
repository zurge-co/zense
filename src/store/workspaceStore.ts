import { create } from "zustand";
import { listFiles, readFileContent, readFileTree } from "../lib/workspaceFs";
import { isTauri } from "../lib/workspace";
import {
  allFiles,
  extraWorkingFiles,
  fileTree as mockTree,
  mockFiles,
  type FileNode,
} from "../lib/mockData";

/**
 * Real workspace contents: file tree, flat file index (@-mentions) and
 * on-demand file contents for the editor. Starts with mock data so browser
 * dev keeps working; `loadWorkspace` replaces it with the real thing.
 */
interface WorkspaceFsState {
  fileTree: FileNode[];
  fileIndex: string[];
  /** path → file content (loaded lazily when a tab opens). */
  fileContents: Record<string, string>;
  /** path → error message for files that failed to load. */
  fileErrors: Record<string, string>;

  loadWorkspace: (root: string) => Promise<void>;
  loadFile: (root: string, path: string) => Promise<void>;
}

const mockContents = (): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(mockFiles).map(([p, f]) => [p, f.content])),
  ...Object.fromEntries(Object.entries(extraWorkingFiles).map(([p, f]) => [p, f.content])),
});

export const useWorkspaceStore = create<WorkspaceFsState>((set, get) => ({
  fileTree: mockTree,
  fileIndex: allFiles,
  fileContents: mockContents(),
  fileErrors: {},

  loadWorkspace: async (root) => {
    if (!isTauri()) return; // browser dev keeps the mock workspace
    try {
      const [fileTree, fileIndex] = await Promise.all([readFileTree(root), listFiles(root)]);
      // Drop contents of any previous workspace along with the tree.
      set({ fileTree, fileIndex, fileContents: {}, fileErrors: {} });
    } catch (err) {
      console.error("failed to load workspace:", err);
    }
  },

  loadFile: async (root, path) => {
    if (path in get().fileContents || path in get().fileErrors) return;
    try {
      const content = await readFileContent(root, path);
      set((s) => ({ fileContents: { ...s.fileContents, [path]: content } }));
    } catch (err) {
      set((s) => ({ fileErrors: { ...s.fileErrors, [path]: String(err) } }));
    }
  },
}));

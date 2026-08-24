import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./workspace";
import {
  allFiles,
  extraWorkingFiles,
  fallbackFile,
  fileTree as mockTree,
  mockFiles,
  type FileNode,
} from "./mockData";

/**
 * Workspace file-system access (Rust commands). Every function falls back to
 * mock data in plain browser dev so the UI stays explorable without Tauri.
 */

export async function listFiles(root: string): Promise<string[]> {
  if (!isTauri()) return allFiles;
  return invoke<string[]>("list_files", { root });
}

export async function readFileTree(root: string): Promise<FileNode[]> {
  if (!isTauri()) return mockTree;
  return invoke<FileNode[]>("read_file_tree", { root });
}

export async function readFileContent(root: string, path: string): Promise<string> {
  if (!isTauri()) {
    return (mockFiles[path] ?? extraWorkingFiles[path] ?? fallbackFile).content;
  }
  return invoke<string>("read_file", { root, path });
}

export async function writeFileContent(root: string, path: string, content: string): Promise<void> {
  if (!isTauri()) return; // browser dev: no-op
  return invoke<void>("write_file", { root, path, content });
}

export async function createDir(root: string, path: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("create_dir", { root, path });
}

export async function renameFile(root: string, from: string, to: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("rename_file", { root, from, to });
}

export async function deleteFile(root: string, path: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("delete_file", { root, path });
}

export async function copyEntry(root: string, from: string, toDir: string): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("copy_entry", { root, from, toDir });
}

/**
 * Import files/folders dropped from the OS file manager. Returns the
 * workspace-relative destination paths (collision-safe auto-renames included).
 */
export async function importExternalEntries(
  root: string,
  destDir: string,
  sources: string[],
): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>("import_entries", { root, sources, destDir });
}

/** Move workspace-relative entries into a workspace folder (internal DnD). */
export async function moveWorkspaceEntries(
  root: string,
  destDir: string,
  sources: string[],
): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>("move_entries", { root, sources, destDir });
}

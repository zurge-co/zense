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

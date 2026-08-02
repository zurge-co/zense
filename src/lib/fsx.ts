import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./workspace";
import { getSnippet } from "./mockData";

/**
 * Read a 1-based inclusive line range from a workspace file (Rust command,
 * path-traversal guarded). Falls back to mock snippets in browser dev.
 */
export async function readFileRange(
  root: string,
  path: string,
  start: number,
  end: number,
): Promise<string> {
  if (!isTauri()) return getSnippet(path, start, end);
  return invoke<string>("read_file_range", { root, path, start, end });
}

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

/** Open a workspace file (e.g. .html) in the system default browser (file://).
 *  Used by the file-tree right-click "Open in Browser" action. The browser
 *  dev fallback cannot reach the local filesystem, so no-op. */
export async function openInBrowser(root: string, path: string): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("open_in_browser", { root, path });
}

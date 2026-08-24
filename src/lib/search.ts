import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./workspace";

/** A single workspace search hit (mirrors the Rust SearchMatch). */
export interface SearchMatch {
  /** Workspace-relative path. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based char column where the match starts. */
  column: number;
  /** Match length in chars (differs from query length for regex hits). */
  length: number;
  /** The full text of the matched line. */
  lineText: string;
}

/** Match options shared by search and replace. */
export interface SearchOptions {
  caseSensitive: boolean;
  isRegex: boolean;
  /** Comma-separated gitignore-style globs ("" = all files). */
  include: string;
  /** Comma-separated gitignore-style globs ("" = none). */
  exclude: string;
  /** Include dotfiles/dotfolders in the backend walk. */
  includeHidden: boolean;
}

/** A match the backend should replace (mirrors the Rust ReplaceTarget). */
export interface ReplaceTarget {
  path: string;
  line: number;
  column: number;
}

/** Per-file replace summary (mirrors the Rust ReplaceSummary). */
export interface ReplaceSummary {
  path: string;
  count: number;
}

/** Total matches replaced across all files. */
export const totalReplaced = (summaries: ReplaceSummary[]) =>
  summaries.reduce((n, s) => n + s.count, 0);

/** Stable identity of a match — used to scope a single replace. */
export const targetOf = (m: SearchMatch): ReplaceTarget => ({
  path: m.path,
  line: m.line,
  column: m.column,
});

/**
 * Search all workspace files for `query` (Rust command, .gitignore-aware,
 * glob-filtered, literal or regex). Empty outside Tauri.
 */
export async function searchWorkspace(
  root: string,
  query: string,
  opts: SearchOptions,
): Promise<SearchMatch[]> {
  if (!isTauri()) return [];
  return invoke<SearchMatch[]>("search_files", { root, query, ...opts });
}

/**
 * Replace occurrences of `query` with `replacement` on disk. Pass `targets`
 * (match line/column from a previous search) to replace only specific hits;
 * omit to replace everything the current query + filters would find.
 * Regex mode expands `$1` capture references in `replacement`.
 */
export async function replaceInWorkspace(
  root: string,
  query: string,
  replacement: string,
  opts: SearchOptions,
  targets?: ReplaceTarget[],
): Promise<ReplaceSummary[]> {
  if (!isTauri()) return [];
  return invoke<ReplaceSummary[]>("replace_in_files", {
    root,
    query,
    replacement,
    ...opts,
    targets: targets ?? null,
  });
}

/** Group flat matches by file path, preserving order. */
export function groupByFile(matches: SearchMatch[]): [string, SearchMatch[]][] {
  const groups = new Map<string, SearchMatch[]>();
  for (const m of matches) {
    const list = groups.get(m.path);
    if (list) list.push(m);
    else groups.set(m.path, [m]);
  }
  return [...groups.entries()];
}

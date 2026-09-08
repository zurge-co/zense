/**
 * Diff-chunk extraction for the "Explain this change with AI" context action
 * in the diff view. Pure functions over Monaco's ILineChange so tests can
 * exercise them without mounting a DiffEditor.
 */
import type * as monaco from "monaco-editor";

export interface ChangeChunk {
  /** Lines removed from the original side ("" for pure insertions). */
  removed: string;
  /** Lines added on the modified side ("" for pure deletions). */
  added: string;
  /** 1-based inclusive bounds on the modified side. */
  startLine: number;
  endLine: number;
}

/**
 * Monaco encodes an empty range (pure insert/delete) with end = 0 (or
 * end < start). Normalize to 1-based inclusive bounds, where an empty range
 * is start..start-1 — mirroring the revert-change logic in DiffView.
 */
export function toInclusiveRange(start: number, end: number): { start: number; end: number } {
  return end === 0 || end < start ? { start: start + 1, end: start } : { start, end };
}

/**
 * The change under `line` (line number on `side` — the modified side by
 * default, or the original side when the user right-clicks the left/old
 * pane). Pure deletions/insertions cover a single context line on the side
 * where their range is empty. When no change contains the line, return the
 * nearest one so a right-click slightly off a chunk still explains
 * something useful; undefined only when there are no changes.
 */
export function findChangeAtLine(
  changes: readonly monaco.editor.ILineChange[],
  line: number,
  side: "modified" | "original" = "modified",
): monaco.editor.ILineChange | undefined {
  let best: monaco.editor.ILineChange | undefined;
  let bestDist = Infinity;
  for (const ch of changes) {
    const rawStart =
      side === "modified" ? ch.modifiedStartLineNumber : ch.originalStartLineNumber;
    const rawEnd =
      side === "modified" ? ch.modifiedEndLineNumber : ch.originalEndLineNumber;
    const range = toInclusiveRange(rawStart, rawEnd);
    // An empty range still "covers" its insertion point (start-1) — the
    // line the cursor sits on when viewing a pure add/delete.
    const coverStart = Math.min(range.start, rawStart);
    const coverEnd = Math.max(range.end, rawStart);
    if (line >= coverStart && line <= coverEnd) return ch;
    const dist = line < coverStart ? coverStart - line : line - coverEnd;
    if (dist < bestDist) {
      bestDist = dist;
      best = ch;
    }
  }
  return best;
}

function sliceLines(text: string, start: number, end: number): string {
  if (end < start) return "";
  return text.split("\n").slice(start - 1, end).join("\n");
}

/** Pull the removed/added text of one change out of the full file contents. */
export function extractChunk(
  change: monaco.editor.ILineChange,
  original: string,
  modified: string,
): ChangeChunk {
  const orig = toInclusiveRange(change.originalStartLineNumber, change.originalEndLineNumber);
  const work = toInclusiveRange(change.modifiedStartLineNumber, change.modifiedEndLineNumber);
  return {
    removed: sliceLines(original, orig.start, orig.end),
    added: sliceLines(modified, work.start, work.end),
    startLine: work.start,
    endLine: work.end,
  };
}

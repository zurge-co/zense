/**
 * Format a workspace-relative file reference for AI chat:
 *
 *   formatReference("src/foo.ts")         → "src/foo.ts"
 *   formatReference("src/foo.ts", 42)     → "src/foo.ts:42"
 *   formatReference("src/foo.ts", 10, 25) → "src/foo.ts:10-25"
 *
 * Lines are 1-based. A single-line or degenerate range collapses to the
 * single-position form so the output stays paste-friendly.
 */
export function formatReference(path: string, startLine?: number, endLine?: number): string {
  if (startLine === undefined || startLine <= 0) return path;
  if (endLine !== undefined && endLine > startLine) return `${path}:${startLine}-${endLine}`;
  return `${path}:${startLine}`;
}

/**
 * Derive the covered line range from a Monaco selection. A selection that
 * ends in column 1 of a later line (e.g. dragging whole lines) really only
 * covers up to the previous line — normalize that here.
 */
export function selectionLines(selection: {
  startLineNumber: number;
  endLineNumber: number;
  endColumn: number;
}): { start: number; end: number } {
  let end = selection.endLineNumber;
  if (selection.endColumn === 1 && end > selection.startLineNumber) end -= 1;
  return { start: selection.startLineNumber, end };
}

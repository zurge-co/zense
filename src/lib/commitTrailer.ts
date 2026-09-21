/**
 * "Zense-Reviewed" trailer — the stamp appended to a commit message when the
 * user commits from the app (Settings > General > Zense review stamp).
 *
 * Pure helpers so the format is unit-testable without touching git.
 */

export const ZENSE_TRAILER_KEY = "Zense-Reviewed";

const TRAILER_LINE = new RegExp(`^${ZENSE_TRAILER_KEY}:`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Human-readable, locale-independent, e.g. "4 Sep 2026, 15:30" (local time). */
function formatStampTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Append the trailer after a blank line. Idempotent: any existing
 * Zense-Reviewed line is replaced, so re-committing never duplicates it.
 * `name` empty → just the timestamp.
 */
export function appendZenseTrailer(message: string, name: string, now: Date = new Date()): string {
  const stamp = name.trim()
    ? `${ZENSE_TRAILER_KEY}: ${name.trim()} at ${formatStampTime(now)}`
    : `${ZENSE_TRAILER_KEY}: ${formatStampTime(now)}`;
  const lines = message
    .replace(/\s+$/, "")
    .split("\n")
    .filter((l) => !TRAILER_LINE.test(l.trim()));
  // Trim trailing blank lines left over after filtering an old trailer.
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return [...lines, "", stamp].join("\n");
}

// ── Merge-resolution audit (AI Conflict Resolution V1) ──────────────────
//
// The merge commit body IS the audit trail — no database. Plain-language
// summary a human can scan in `git log -v`, plus machine-readable footer
// keys Zense can parse back without any local storage. Deliberately
// summary-only: full evidence payloads bloat the commit and go stale.

export const ZENSE_RESOLUTION_KEY = "Zense-Resolution";
export const ZENSE_VERSION_KEY = "Zense-Version";
export const ZENSE_RESOLVED_FILES_KEY = "Zense-Resolved-Files";
export const ZENSE_RESOLUTION_VERSION = "1.0.0";

export interface ResolutionAuditEntry {
  path: string;
  /** "AI-proposed" | "resolved manually" | "kept modified/deleted" | … */
  label: string;
  approvedBy: string;
  /** Tool-verified facts that held at accept time. */
  evidenceCount: number;
}

/** `Merge branch 'x'` + audit body. Empty entries → the message as-is
 *  (a merge finished without any AI involvement stays clean). */
export function buildResolutionAudit(message: string, entries: ResolutionAuditEntry[]): string {
  if (entries.length === 0) return message;
  const lines: string[] = [message.replace(/\s+$/, ""), "", "Zense AI resolutions:"];
  for (const e of entries) {
    lines.push(`- ${e.path}: ${e.label}, approved by ${e.approvedBy} (evidence: ${e.evidenceCount} verified facts)`);
  }
  lines.push(
    "",
    `${ZENSE_RESOLUTION_KEY}: ai`,
    `${ZENSE_VERSION_KEY}: ${ZENSE_RESOLUTION_VERSION}`,
    `${ZENSE_RESOLVED_FILES_KEY}: ${entries.length}`,
  );
  return lines.join("\n");
}

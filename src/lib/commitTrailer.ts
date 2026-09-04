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

/**
 * Terminal tab titles from the FIRST typed command.
 *
 * A terminal session starts as "Terminal N"; the first non-empty command
 * the user types and runs (Enter) replaces that label, and the title never
 * changes again afterwards (subsequent commands, shell restarts).
 *
 * Detection is an input-side heuristic: we watch the keystrokes xterm
 * emits via onData (what is sent to the PTY), keeping a plain-text line
 * buffer — we deliberately do NOT trust OSC title sequences or parse the
 * screen buffer, since full-screen programs (vim, claude) would clobber
 * those constantly.
 */

/** Max tab label length before truncation (with ellipsis). */
export const MAX_TITLE_LEN = 24;

/**
 * Feed one xterm onData chunk into the line buffer.
 * Returns the updated buffer plus the finished command when a non-empty
 * line was submitted (Enter), otherwise `command` is null.
 *
 * Heuristics:
 * - chunks containing ESC (arrow keys, bracketed paste, alt-keys) are
 *   skipped wholesale — they never contribute to the "typed" line, so a
 *   command pasted via bracketed paste doesn't count as typed;
 * - backspace (DEL/BS) pops one character (CJK/Thai combining marks are
 *   close enough for a tab title);
 * - Ctrl+C clears the pending line (the shell aborts it too);
 * - other control characters are ignored.
 */
export function feedLineBuffer(
  buf: string,
  data: string,
): { buf: string; command: string | null } {
  if (data.includes("\x1b")) return { buf, command: null };
  for (const ch of data) {
    if (ch === "\r") {
      const cmd = buf.replace(/\s+/g, " ").trim();
      buf = "";
      if (cmd) return { buf, command: cmd };
    } else if (ch === "\x7f" || ch === "\b") {
      buf = buf.slice(0, -1);
    } else if (ch === "\x03") {
      buf = ""; // Ctrl+C aborts the line
    } else if (ch >= " ") {
      buf += ch;
    }
  }
  return { buf, command: null };
}

/** Collapse a command into a tab title (truncated with "…"). */
export function shortenTitle(cmd: string): string {
  return cmd.length > MAX_TITLE_LEN ? `${cmd.slice(0, MAX_TITLE_LEN - 1)}…` : cmd;
}

import { chipLabel, useUIStore, type ContextChip } from "../store/uiStore";
import { useTerminalStore } from "../store/terminalStore";
import { ptyAvailable, ptyWrite } from "./pty";
import { readFileRange } from "./fsx";

// Bracketed paste keeps multi-line prompts intact in TUI agent CLIs
// (claude, aider, …) instead of submitting on the first newline.
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** Grace period for a freshly spawned agent CLI to initialize its TUI. */
const AGENT_BOOT_MS = 1200;

/**
 * Composer submit flow: compose the prompt (text + real code snippets for the
 * attached chips), log it in the composer, then pipe it into the agent CLI's
 * terminal — spawning the CLI first if it isn't running yet.
 */
export async function sendPromptToAgent(): Promise<void> {
  const s = useUIStore.getState();
  const text = s.composerDraft.trim();
  const chips = s.contextChips;
  if (!text && chips.length === 0) return;

  // Compose before sendToAgent() clears the draft/chips.
  const prompt = await composePrompt(text, chips, s.attachCode, s.workspacePath);

  // Existing behavior: append to sent log, clear composer, reveal the panel
  // when "reveal terminal on send" is on. Also the browser-dev fallback
  // (no PTY) ends here.
  s.sendToAgent();

  if (!ptyAvailable() || !s.workspacePath) return;

  const { id, created } = useTerminalStore
    .getState()
    .ensureAgentSession(s.workspacePath, s.agentCommand);

  // The BottomPanel spawns the PTY after render; retry until it exists.
  if (created) await sleep(AGENT_BOOT_MS);
  await writeWhenReady(id, `${PASTE_START}${prompt}${PASTE_END}\r`);
}

/** Build the piped prompt: user text + file refs + real snippets per chip. */
async function composePrompt(
  text: string,
  chips: ContextChip[],
  attachCode: boolean,
  root: string | null,
): Promise<string> {
  const parts: string[] = [];
  if (text) parts.push(text);

  const ranged = chips.filter((c) => c.range);
  const bare = chips.filter((c) => !c.range);
  if (bare.length > 0) {
    parts.push(`Referenced files: ${bare.map((c) => `@${c.path}`).join(" ")}`);
  }

  if (ranged.length > 0) {
    if (attachCode && root) {
      for (const c of ranged) {
        const { start, end } = c.range!;
        let body: string;
        try {
          body = (await readFileRange(root, c.path, start, end)) || "(empty range)";
        } catch (err) {
          body = `(could not read: ${String(err)})`;
        }
        parts.push(`--- ${chipLabel(c)} ---\n${body}`);
      }
    } else {
      parts.push(`Referenced code: ${ranged.map((c) => `@${chipLabel(c)}`).join(" ")}`);
    }
  }

  return parts.join("\n\n");
}

/** Retry until the Rust side has registered the PTY session. */
async function writeWhenReady(id: string, data: string, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await ptyWrite(id, data);
      return;
    } catch (err) {
      if (!String(err).includes("not found")) throw err;
      await sleep(150);
    }
  }
  console.error(`agent session '${id}' never became ready`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

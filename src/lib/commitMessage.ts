/**
 * AI commit-message generator for the Review panel: reads the staged diff,
 * asks the configured LLM for a commit message, and cleans the reply so the
 * result can land in the textarea verbatim. Pure post-processing lives in
 * `cleanCommitMessage` for unit testing.
 */
import { gitStagedDiff } from "./git";
import { chatSend, loadLlmConfig } from "./llm";

export const COMMIT_MESSAGE_SYSTEM_PROMPT = `You write git commit messages from a staged diff.

Rules:
- Output ONLY the commit message — no quotes, no explanation, no markdown code fences.
- Use Conventional Commits when the change fits: feat:, fix:, refactor:, docs:, test:, chore:, perf:
- Subject line: imperative mood, max 72 characters.
- Add a short body (bullet points, "- …") only when the change spans multiple concerns.`;

/**
 * Normalizes the reply back into a plain commit message: some models wrap it in
 * ``` fences, prefix "Commit message:", or quote the whole thing.
 */
export function cleanCommitMessage(raw: string): string {
  let text = raw.trim();
  // Unwrap a code fence around the whole reply (```\n…\n```).
  const fence = text.match(/^```[a-zA-Z-]*\s*\n([\s\S]*?)\n?```\s*$/);
  if (fence) text = fence[1].trim();
  // Drop a "Commit message:"-style prefix.
  text = text.replace(/^(commit\s*message|commit)\s*:\s*/i, "");
  // Strip quotes only when they wrap the entire reply.
  if (text.length >= 2 && /^["']/.test(text) && text.endsWith(text[0])) {
    text = text.slice(1, -1);
  }
  return text.trim();
}

/**
 * Generate a commit message for everything currently staged in `root`.
 * Throws user-readable errors: nothing staged, AI provider not configured,
 * or the backend's own error text from chat_send.
 */
export async function generateCommitMessage(root: string): Promise<string> {
  const diff = await gitStagedDiff(root);
  if (!diff.trim()) {
    throw new Error("No staged changes — stage a file first, then ask AI to write the message.");
  }

  const config = await loadLlmConfig();
  if (!config || !config.model || !config.baseUrl) {
    throw new Error("Set up the AI provider first (Settings → AI Provider).");
  }

  // The diff is already inline — filesystem/git tools would only burn
  // turns, so this call runs tool-free.
  const toolFree = {
    ...config,
    enabledTools: { readFile: false, readFileRange: false, listFiles: false, gitTools: false },
  };

  let streamed = "";
  const finalText = await chatSend(
    toolFree,
    COMMIT_MESSAGE_SYSTEM_PROMPT,
    [{ role: "user", content: `Staged diff:\n\n${diff}` }],
    root,
    (e) => {
      if (e.type === "textDelta") streamed += e.text;
    },
  );

  // chatSend's return value is authoritative; deltas are the fallback.
  const message = cleanCommitMessage(finalText || streamed);
  if (!message) throw new Error("The AI returned an empty message — try again.");
  return message;
}

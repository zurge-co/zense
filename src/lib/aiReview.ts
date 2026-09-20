/**
 * Auto Review orchestration: staged diff → per-file chunks (hunk-split over
 * budget) → sequential strict-JSON review calls → streamed findings →
 * critic pass → cross-file synthesis. The findings land in aiReviewStore;
 * this module owns the async pipeline and its error semantics.
 *
 * Retry contract: only FormatError (unparseable reply) consumes one of the
 * 2 retries — provider/network errors abort the run immediately. When the
 * retries are exhausted the raw markdown reply is salvaged as a last
 * resort instead of dropping the chunk.
 */
import { gitStagedDiff } from "./git";
import { errMessage } from "./errors";
import { chatSend, type IpcMessage, type LlmConfig } from "./llm";
import { systemPrompt } from "./systemPrompt";
import { useAiReviewStore } from "../store/aiReviewStore";
import { useLlmConfigStore } from "../store/llmConfigStore";
import {
  FormatError,
  buildChunkReviewPrompt,
  buildCriticPrompt,
  buildRetryInstruction,
  buildSynthesisPrompt,
  parseFindingsJson,
  parseFindingsMarkdownFallback,
  type RawFinding,
} from "./aiReviewPrompts";
import { chunkDiff, splitDiffByFile } from "./diffChunk";

/** Max format-error retries per LLM call (2 retries → up to 3 attempts). */
const MAX_FORMAT_RETRIES = 2;

type SendFn = (
  config: LlmConfig,
  systemPrompt: string,
  messages: IpcMessage[],
  root: string,
  onEvent: (e: unknown) => void,
) => Promise<string>;

/**
 * One strict-JSON round trip with the retry harness: initial attempt + up
 * to MAX_FORMAT_RETRIES follow-ups that show the model its parse error.
 * Callers pass `send` so tests can drive the harness without Tauri.
 */
export async function askFindingsJson(
  send: SendFn,
  config: LlmConfig,
  sysPrompt: string,
  root: string,
  prompt: string,
): Promise<RawFinding[]> {
  const messages: IpcMessage[] = [{ role: "user", content: prompt }];
  let lastReply = "";
  let lastError: FormatError | null = null;
  for (let attempt = 0; attempt <= MAX_FORMAT_RETRIES; attempt++) {
    lastReply = await send(config, sysPrompt, messages, root, () => {});
    try {
      return parseFindingsJson(lastReply);
    } catch (err) {
      if (!(err instanceof FormatError)) throw err;
      lastError = err;
      messages.push({ role: "assistant", content: lastReply });
      messages.push({ role: "user", content: buildRetryInstruction(err.message) });
    }
  }
  // Last resort: keep whatever the model said as markdown findings instead
  // of failing the chunk after 3 replies.
  const salvaged = parseFindingsMarkdownFallback(lastReply);
  if (salvaged.length > 0) return salvaged;
  throw lastError ?? new FormatError("the model returned no usable findings");
}

const NO_TOOLS = {
  enabledTools: { readFile: false, readFileRange: false, listFiles: false, gitTools: false },
};

/**
 * Run a full Auto Review over the staged diff. Throws user-readable errors
 * for setup problems (nothing staged, provider not configured); pipeline
 * errors land on the store so partial findings survive a late failure.
 */
export async function runAutoReview(root: string): Promise<void> {
  const llmStore = useLlmConfigStore.getState();
  if (!llmStore.configLoaded) await llmStore.loadConfig();
  const config = useLlmConfigStore.getState().config;
  if (!config || !config.model || !config.baseUrl) {
    throw new Error("Set up the AI provider first (Settings → AI Provider).");
  }

  const diff = await gitStagedDiff(root);
  if (!diff.trim()) {
    throw new Error("No staged changes — stage files first, then run Auto Review.");
  }

  // The diff is embedded inline — tools would only burn turns, so every
  // call in the pipeline runs tool-free (same as commitMessage.ts).
  const toolFree: LlmConfig = { ...config, ...NO_TOOLS };
  const sysPrompt = systemPrompt(root, config.preferredLanguage);
  const files = splitDiffByFile(diff).map((f) => f.path);
  const chunks = chunkDiff(diff);

  const store = useAiReviewStore.getState();
  const session = store.begin();
  const stale = () => !useAiReviewStore.getState().isCurrent(session);
  const send = chatSend as SendFn;

  try {
    for (let i = 0; i < chunks.length; i++) {
      if (stale()) return;
      store.setPhase(`chunk ${i + 1} of ${chunks.length}`);
      const findings = await askFindingsJson(
        send,
        toolFree,
        sysPrompt,
        root,
        buildChunkReviewPrompt({
          patch: chunks[i].patch,
          path: chunks[i].path,
          part: chunks[i].part,
          parts: chunks[i].parts,
          chunkIndex: i + 1,
          chunkCount: chunks.length,
          files,
        }),
      );
      if (stale()) return;
      useAiReviewStore.getState().addFindings(session, findings);
    }

    const compact = (): RawFinding[] =>
      useAiReviewStore.getState().findings.map(({ id: _id, done: _done, ...f }) => f);

    if (compact().length > 0) {
      if (stale()) return;
      store.setPhase("critic pass");
      const critiqued = await askFindingsJson(
        send,
        toolFree,
        sysPrompt,
        root,
        buildCriticPrompt(compact()),
      );
      if (stale()) return;
      useAiReviewStore.getState().replaceFindings(session, critiqued);

      if (stale()) return;
      store.setPhase("cross-file synthesis");
      const synthesized = await askFindingsJson(
        send,
        toolFree,
        sysPrompt,
        root,
        buildSynthesisPrompt(compact(), files),
      );
      if (stale()) return;
      useAiReviewStore.getState().replaceFindings(session, synthesized);
    }

    useAiReviewStore.getState().finish(session);
  } catch (err) {
    if (!stale()) {
      useAiReviewStore.getState().finish(session, errMessage(err));
    }
  }
}

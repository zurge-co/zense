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
  dedupeFindings,
  parseFindingsJson,
  parseFindingsMarkdownFallback,
  type RawFinding,
} from "./aiReviewPrompts";
import { changedNewLines, chunkDiff, snapLine, splitDiffByFile } from "./diffChunk";

/** Max format-error retries per LLM call (2 retries → up to 3 attempts). */
const MAX_FORMAT_RETRIES = 2;

/** Safety cap on chunks per run — each chunk is a billed model request. */
export const MAX_AUTO_REVIEW_CHUNKS = 20;

/** Staged diff needs more chunks than the cap; the UI confirms and retries
 *  with the allow-many flag. Thrown before the session begins so existing
 *  findings are untouched. */
export class TooManyChunksError extends Error {
  readonly chunks: number;
  constructor(chunks: number) {
    super(
      `This staged diff splits into ${chunks} AI review chunks (cap: ${MAX_AUTO_REVIEW_CHUNKS}) — roughly ${chunks + 2} model requests. Re-run from the findings panel to confirm and review anyway.`,
    );
    this.name = "TooManyChunksError";
    this.chunks = chunks;
  }
}

/** Over-cap chunk counts abort unless the user explicitly allowed many. */
export function assertChunkCount(chunks: number, allowManyChunks = false): void {
  if (chunks > MAX_AUTO_REVIEW_CHUNKS && !allowManyChunks) {
    throw new TooManyChunksError(chunks);
  }
}

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
      messages.push({
        role: "user",
        content: buildRetryInstruction(err.message, attempt === MAX_FORMAT_RETRIES - 1),
      });
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
export async function runAutoReview(
  root: string,
  opts?: { allowManyChunks?: boolean },
): Promise<void> {
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
  assertChunkCount(chunks.length, opts?.allowManyChunks);

  const store = useAiReviewStore.getState();
  const session = store.begin();
  const stale = () => !useAiReviewStore.getState().isCurrent(session);
  const send = chatSend as SendFn;

  // Snap model-reported lines onto lines the staged diff actually changed —
  // the model's line numbers are routinely a few rows off.
  const changed = changedNewLines(diff);
  const snapLines = (list: RawFinding[]): RawFinding[] =>
    list.map((f) =>
      f.line === undefined || !f.file
        ? f
        : { ...f, line: snapLine(changed.get(f.file), f.line) },
    );

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
      useAiReviewStore.getState().addFindings(session, dedupeFindings(snapLines(findings)));
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
        buildCriticPrompt(dedupeFindings(compact())),
      );
      if (stale()) return;
      useAiReviewStore.getState().replaceFindings(session, dedupeFindings(snapLines(critiqued)));

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
      useAiReviewStore.getState().replaceFindings(session, dedupeFindings(snapLines(synthesized)));
    }

    useAiReviewStore.getState().finish(session);
  } catch (err) {
    if (!stale()) {
      useAiReviewStore.getState().finish(session, errMessage(err));
    }
  }
}

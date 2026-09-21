/**
 * AI conflict resolution orchestration (spec V1). Pipeline per conflicted
 * file:
 *
 *   classify (aiConflictPrompts) →
 *   normal: read base/ours/theirs → trivial? mechanical proposal (no LLM)
 *     : strict-JSON proposal via chatSend (retry + salvage, aiReview-style)
 *   → evidence engine collects TOOL-DERIVED facts (never LLM prose)
 *   → conflictResolutionStore
 *
 * Dedicated flows: modify-delete (keep modified / keep deleted) and binary
 * (keep a side) never touch the LLM. Ask Zense is read-only scoped Q&A.
 * Finish creates the merge commit with the audit trailer.
 */
import {
  gitReadConflictFile,
  gitResolveFile,
  gitResolveDelete,
  gitResolveSide,
  gitMergeContinue,
  type GitMergeInProgress,
} from "./git";
import { chatSend, type IpcMessage, type LlmConfig } from "./llm";
import { systemPrompt } from "./systemPrompt";
import { searchWorkspace } from "./search";
import { isTauri } from "./workspace";
import { errMessage } from "./errors";
import {
  buildResolutionAudit,
  type ResolutionAuditEntry,
} from "./commitTrailer";
import {
  FormatError,
  buildConflictPrompt,
  buildConflictRetryInstruction,
  parseConflictProposal,
  salvageConflictProposal,
  classifyConflict,
  detectTrivial,
  hasConflictMarkers,
  MAX_FORMAT_RETRIES,
} from "./aiConflictPrompts";
import { useLlmConfigStore } from "../store/llmConfigStore";
import { useGitStore } from "../store/gitStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import {
  useConflictResolutionStore,
  effectiveContent,
  type EvidenceFact,
  type ResolutionRecord,
} from "../store/conflictResolutionStore";

const NO_TOOLS = {
  enabledTools: { readFile: false, readFileRange: false, listFiles: false, gitTools: false },
};

/** Config with tools off — the whole context travels inline (aiReview
 *  pattern: tools would only burn turns). Throws a user-readable setup
 *  error when the provider is not configured. */
async function loadToolFreeConfig(): Promise<LlmConfig> {
  const llmStore = useLlmConfigStore.getState();
  if (!llmStore.configLoaded) await llmStore.loadConfig();
  const config = useLlmConfigStore.getState().config;
  if (!config || !config.model || !config.baseUrl) {
    throw new Error("Set up the AI provider first (Settings → AI Provider).");
  }
  return { ...config, ...NO_TOOLS };
}

type SendFn = (
  config: LlmConfig,
  systemPrompt: string,
  messages: IpcMessage[],
  root: string,
  onEvent: (e: unknown) => void,
) => Promise<string>;

/** One strict-JSON round trip with the retry harness; the final failure
 *  salvages a fenced code block instead of dropping the analysis
 *  (same contract as aiReview.askFindingsJson). */
export async function askProposalJson(
  send: SendFn,
  config: LlmConfig,
  sysPrompt: string,
  root: string,
  prompt: string,
) {
  const messages: IpcMessage[] = [{ role: "user", content: prompt }];
  let lastReply = "";
  let lastError: FormatError | null = null;
  for (let attempt = 0; attempt <= MAX_FORMAT_RETRIES; attempt++) {
    lastReply = await send(config, sysPrompt, messages, root, () => {});
    try {
      return parseConflictProposal(lastReply);
    } catch (err) {
      if (!(err instanceof FormatError)) throw err;
      lastError = err;
      messages.push({ role: "assistant", content: lastReply });
      messages.push({ role: "user", content: buildConflictRetryInstruction(err.message) });
    }
  }
  return salvageConflictProposal(lastReply || String(lastError?.message ?? ""));
}

// ── Evidence engine — TOOL-GENERATED facts only ─────────────────────────

const TEST_NAME = (n: string) =>
  new RegExp(`(^|/)${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(test|spec)\\.[a-z0-9]+$|(^|/)__tests__/.*${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");

/**
 * Every fact here comes from a tool (regex on the proposal, the workspace
 * file index, the backend search) — the LLM is not in the loop. ok=false
 * facts render as warnings, never as green checkmarks.
 */
export async function collectEvidence(
  root: string,
  path: string,
  proposal: string,
): Promise<EvidenceFact[]> {
  const facts: EvidenceFact[] = [];

  const markerFree = !hasConflictMarkers(proposal);
  facts.push({
    kind: "marker-free",
    label: markerFree
      ? "No conflict markers left in the proposal"
      : "The proposal still contains conflict markers",
    ok: markerFree,
  });

  const base = path.split("/").pop() ?? path;
  const name = base.replace(/\.[a-z0-9]+$/i, "");
  const testMatches = useWorkspaceStore.getState().fileIndex.filter((p) => TEST_NAME(name).test(p));
  facts.push({
    kind: "test-file",
    label: testMatches.length > 0 ? `Test file found: ${testMatches[0]}` : `No test file found that covers '${name}'`,
    ok: testMatches.length > 0,
    detail: testMatches.join("\n"),
  });

  if (isTauri()) {
    try {
      const hits = await searchWorkspace(root, name, {
        caseSensitive: false,
        isRegex: false,
        include: "",
        exclude: "",
        includeHidden: false,
      });
      const files = [...new Set(hits.filter((h) => h.path !== path).map((h) => h.path))];
      facts.push({
        kind: "references",
        label:
          files.length > 0
            ? `'${name}' is referenced in ${files.length} other file${files.length === 1 ? "" : "s"}`
            : `No other file references '${name}'`,
        ok: files.length > 0,
        detail: files.slice(0, 8).join("\n"),
      });
    } catch {
      // Search is best-effort evidence — never fail the analysis over it.
    }
  }
  return facts;
}

// ── Analysis ────────────────────────────────────────────────────────────

function mergeLabels(mergeInfo: GitMergeInProgress): { operation: string; sourceBranch?: string; sourceSummary?: string } {
  return {
    operation: mergeInfo.operation ?? "merge",
    sourceBranch: mergeInfo.sourceBranch,
    sourceSummary: mergeInfo.sourceSummary,
  };
}

async function readStage(root: string, path: string, stage: "base" | "ours" | "theirs"): Promise<string | null> {
  try {
    return await gitReadConflictFile(root, path, stage);
  } catch {
    // A missing stage (one side added/deleted the file) is legitimate.
    return null;
  }
}

/**
 * Run the full analysis for one conflicted file into the store.
 * modify-delete/binary route to their dedicated flows — no LLM, no-op
 * here. Safe to re-run after an error.
 */
export async function analyzeConflict(root: string, path: string): Promise<void> {
  const entry = useGitStore.getState().conflicts.find((c) => c.path === path);
  if (!entry) return;
  const store = useConflictResolutionStore.getState();
  const kind = classifyConflict(entry);
  store.ensure(path, kind);
  if (kind !== "content") return; // dedicated flows need no analysis

  const existing = useConflictResolutionStore.getState().records[path];
  if (
    existing &&
    existing.status !== "detected" &&
    existing.status !== "error"
  ) {
    // proposed/accepted/review-requested/analyzing must survive re-opens —
    // re-analysis only ever restarts from detected or after an error.
    return;
  }
  store.beginAnalysis(path);
  try {
    const [base, ours, theirs] = await Promise.all([
      readStage(root, path, "base"),
      readStage(root, path, "ours"),
      readStage(root, path, "theirs"),
    ]);
    if (ours === null || theirs === null) {
      throw new Error("One side of this conflict has no content — use the keep-modified / keep-deleted actions.");
    }

    // Mechanical conflicts settle without an LLM call: both versions are
    // equivalent (whitespace) or hold the same import lines reordered —
    // either side IS the merge.
    const trivial = detectTrivial(ours, theirs);
    if (trivial) {
      const evidence = await collectEvidence(root, path, ours);
      store.setProposal(path, {
        story:
          trivial === "whitespace"
            ? "Both sides made the same change — only whitespace/formatting differs. Either version is the correct merge."
            : "Both sides have the same import lines in a different order. Either version is the correct merge.",
        proposal: ours,
        confidence: "high",
        reasoningPoints: [],
        evidence,
        trivial,
      });
      return;
    }

    const config = await loadToolFreeConfig();
    const sysPrompt = systemPrompt(root, config.preferredLanguage);
    const proposal = await askProposalJson(
      chatSend as SendFn,
      config,
      sysPrompt,
      root,
      buildConflictPrompt({ path, ...mergeLabels(useGitStore.getState().mergeInfo), base, ours, theirs }),
    );
    const evidence = await collectEvidence(root, path, proposal.proposal);
    store.setProposal(path, { ...proposal, evidence, trivial: null });
  } catch (err) {
    store.setError(path, errMessage(err));
  }
}

// ── Ask Zense — scoped READ-ONLY Q&A ────────────────────────────────────

/**
 * Answer a question about THIS conflict's story/proposal/evidence. It can
 * explain but never rewrite the proposal — immutability is enforced by
 * not giving this function any code path back into setProposal.
 */
export async function askConflictQuestion(
  root: string,
  record: ResolutionRecord,
  question: string,
): Promise<string> {
  const config = await loadToolFreeConfig();
  const sysPrompt = `${systemPrompt(root, config.preferredLanguage)}

You are answering questions about ONE git merge conflict. Rules:
- Answer ONLY from the context below — if it is not there, say so.
- Explain; do NOT produce a new version of the file. The user decides via the Accept / Edit actions.
- Keep answers short.

File: ${record.path}

What the AI understood (story):
${record.story ?? "(no story yet)"}

Verified facts collected by tools:
${record.evidence.map((f) => `${f.ok ? "PASS" : "WARN"}: ${f.label}`).join("\n") || "(none)"}

The proposed resolution:
\`\`\`
${(record.editDraft ?? record.proposal ?? "").slice(0, 12_000)}
\`\`\``;
  const messages: IpcMessage[] = record.qa.flatMap((x) => [
    { role: "user" as const, content: x.question },
    { role: "assistant" as const, content: x.answer },
  ]);
  messages.push({ role: "user", content: question });
  const answer = await chatSend(config, sysPrompt, messages, root, () => {});
  useConflictResolutionStore.getState().appendQa(record.path, { question, answer });
  return answer;
}

// ── Decisions & application ─────────────────────────────────────────────

function approverName(): string {
  return useWorkspaceStore.getState().commitStampName.trim() || "local user";
}

async function afterApplied(root: string, path: string): Promise<void> {
  useConflictResolutionStore.getState().markAccepted(path, approverName());
  // The audit label is recomputed from kind/choice at finish time — the
  // story stays untouched for the record.
  await useGitStore.getState().refresh(root);
}

/** Accept the (possibly human-edited) proposal: write + stage, mark the
 *  path resolved, refresh git state. */
export async function acceptResolution(root: string, path: string): Promise<void> {
  const r = useConflictResolutionStore.getState().records[path];
  const content = r ? effectiveContent(r) : undefined;
  if (content === undefined) throw new Error("Nothing to accept yet — wait for the analysis.");
  await gitResolveFile(root, path, content);
  await afterApplied(root, path);
}

/** modify-delete "Keep modified" / binary "Keep yours/Keep theirs". */
export async function acceptSide(root: string, path: string, side: "ours" | "theirs"): Promise<void> {
  await gitResolveSide(root, path, side);
  await afterApplied(root, path);
}

/** modify-delete "Keep deleted". */
export async function acceptDeletion(root: string, path: string): Promise<void> {
  await gitResolveDelete(root, path);
  await afterApplied(root, path);
}

/** The Request Review handoff packet (copyable) — the full context a
 *  teammate needs to take the decision over, per spec V1. */
export function buildReviewPacket(record: ResolutionRecord): string {
  const content = effectiveContent(record) ?? "(no proposal yet)";
  return [
    `Merge conflict — review requested`,
    ``,
    `File: ${record.path}`,
    `Type: ${record.kind}${record.trivial ? ` (trivial: ${record.trivial})` : ""}`,
    ``,
    `── What the AI understood (interpretation) ──`,
    record.story ?? "(no story yet)",
    ...(record.reasoningPoints?.length ? ["", ...record.reasoningPoints.map((p) => `• ${p}`)] : []),
    ``,
    `── Verified facts (tool-generated) ──`,
    ...(record.evidence.length
      ? record.evidence.map((f) => `${f.ok ? "✓" : "⚠"} ${f.label}`)
      : ["(none)"]),
    ``,
    `── Proposed resolution ${record.editDraft != null ? "(with human edits)" : ""} ──`,
    "```",
    content,
    "```",
  ].join("\n");
}

// ── Finish ──────────────────────────────────────────────────────────────

const AUDIT_LABEL: Record<string, string> = {
  content: "AI-proposed",
  "modify-delete": "kept modified/deleted",
  binary: "kept one side",
};

/**
 * Create the merge commit once every conflict left the index; the audit
 * trail (per-file label + approver + evidence count, machine footer) goes
 * into the commit body — spec V1: the commit IS the audit store.
 */
export async function finishMerge(root: string, message: string): Promise<string> {
  const git = useGitStore.getState();
  if (git.mergeInfo.operation !== "merge") {
    throw new Error("Finish is available for merges only — continue this operation in the integrated terminal.");
  }
  if (git.conflicts.length > 0) {
    throw new Error("There are still unresolved conflicts.");
  }
  const records = useConflictResolutionStore.getState().records;
  const manual = new Set(Object.keys(records));
  const entries: ResolutionAuditEntry[] = [
    ...Object.values(records)
      .filter((r) => r.status === "accepted" || r.status === "review-requested")
      .map((r) => ({
        path: r.path,
        label: AUDIT_LABEL[r.kind] ?? "AI-proposed",
        approvedBy: r.approvedBy ?? approverName(),
        evidenceCount: r.evidence.filter((f) => f.ok).length,
      })),
    // Files resolved through the manual escape hatch (staged directly).
    ...git.resolvedPaths
      .filter((p) => !manual.has(p))
      .map((p) => ({ path: p, label: "resolved manually", approvedBy: approverName(), evidenceCount: 0 })),
  ];
  const sha = await gitMergeContinue(root, buildResolutionAudit(message, entries));
  useConflictResolutionStore.getState().reset();
  await useGitStore.getState().refresh(root);
  return sha;
}

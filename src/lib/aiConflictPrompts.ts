/**
 * Prompt builders + the strict-JSON parse harness for AI conflict
 * resolution. Pure functions so tests can exercise them without a
 * workspace, git, or LLM — same house pattern as aiReviewPrompts.ts.
 *
 * THE core invariant of the whole feature lives here: the model's reply
 * schema is {story, proposal, confidence, reasoning_points} and nothing
 * else. An "evidence" key is a FORMAT ERROR — the model may interpret
 * (story) and propose (proposal), but checkmarks are tool-generated only
 * (see aiConflict.ts's evidence engine). If a model ships its own
 * evidence, we throw it away loudly instead of rendering fake facts.
 */

import type { GitConflictEntry } from "./git";

/** Throwing type marker: only FormatError consumes a retry — provider and
 *  network errors must abort immediately (same contract as aiReview). */
export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatError";
  }
}

// ── Conflict classification ─────────────────────────────────────────────

/** How a conflicted file routes through the pipeline. */
export type ConflictKind = "content" | "modify-delete" | "binary";

/** Route one index conflict entry: binary first (no LLM ever), then the
 *  dedicated modify-delete flow, else the normal AI resolver. */
export function classifyConflict(entry: GitConflictEntry): ConflictKind {
  if (entry.binary) return "binary";
  return entry.conflictType === "modify-delete" ? "modify-delete" : "content";
}

// ── Trivial-conflict detection (pre-selection, never auto-apply) ─────────

export type TrivialKind = "whitespace" | "import-order";

/** Lines that are safe to reorder mechanically. */
const IMPORT_LINE = /^\s*(import\b|export\b.+from\b|export\s*\{)/;

/**
 * A conflict both sides can settle mechanically:
 * - "whitespace": every difference is whitespace/formatting — the merged
 *   text is identical once whitespace is ignored;
 * - "import-order": both sides contain the SAME set of import/export
 *   lines (plus blanks), only reordered — sorting settles it.
 * Everything else is semantic and needs the AI proposal + human review.
 * Note statement-order changes do NOT qualify: only import-ish lines.
 */
export function detectTrivial(ours: string, theirs: string): TrivialKind | null {
  if (ours.replace(/\s+/g, "") === theirs.replace(/\s+/g, "")) return "whitespace";
  const linesOf = (t: string) =>
    t
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
  const a = linesOf(ours);
  const b = linesOf(theirs);
  if (a.length > 0 && a.every((l) => IMPORT_LINE.test(l)) && b.every((l) => IMPORT_LINE.test(l))) {
    const sort = (xs: string[]) => [...xs].sort().join("\n");
    if (sort(a) === sort(b)) return "import-order";
  }
  return null;
}

/** Markers git leaves in a conflicted file — a proposal still containing
 *  these is not a resolution. */
export function hasConflictMarkers(text: string): boolean {
  return /^(<{7}|={7}|>{7})( |\n|$)/m.test(text);
}

// ── Strict-JSON proposal ────────────────────────────────────────────────

export type ProposalConfidence = "high" | "medium" | "low";

/** One AI proposal (INTERPRETATION + result — evidence lives elsewhere). */
export interface RawConflictProposal {
  /** What each side was trying to do and how it can coexist (prose). */
  story: string;
  /** The full resolved file content. */
  proposal: string;
  confidence: ProposalConfidence;
  /** Short bullets backing the proposal (rendered as interpretation). */
  reasoningPoints: string[];
}

export const MAX_FORMAT_RETRIES = 2;

/** Context budget: entire file versions are sent as-is below this cap;
 *  above it the middle of each side is elided (V1 progressive stage 1). */
export const MAX_CONFLICT_CONTEXT_CHARS = 30_000;

const SCHEMA = `{
  "story": "what each side was trying to do, and how the two intents can coexist (plain prose)",
  "proposal": "the FULL resolved file content, exactly as it should be saved",
  "confidence": "high" | "medium" | "low",
  "reasoning_points": ["short bullet backing the proposal"]
}`;

const RULES = `Rules:
- Reconstruct what the file SHOULD look like after both changes are integrated — do not just pick a side.
- "proposal" must be the complete file (not a diff, not a snippet, no conflict markers <<<<<<< ======= >>>>>>>).
- Keep every behavior from BOTH sides unless the base proves one was deleted or replaced.
- "confidence" is "high" only when both intents are clear and compatible.
- Write story/reasoning_points in your answer language; JSON keys and the confidence value stay in English.
- NEVER include an "evidence" key or claims about tests/files you did not see in this prompt — a separate system verifies facts.`;

/** Truncate the middle of a long version, keeping head and tail intact —
 *  conflict hunks rarely live in the elided middle of a huge file and the
 *  marker advertises the cut to the model. */
function elide(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const head = Math.floor(cap / 2);
  const tail = cap - head;
  return `${text.slice(0, head)}\n/* … ${text.length - cap} characters elided … */\n${text.slice(text.length - tail)}`;
}

/** Per-file resolution prompt — strict JSON, stage-1 context only. */
export function buildConflictPrompt(args: {
  path: string;
  operation: string;
  sourceBranch?: string;
  sourceSummary?: string;
  base: string | null;
  ours: string;
  theirs: string;
}): string {
  const cap = Math.floor(MAX_CONFLICT_CONTEXT_CHARS / 3);
  const intent = [
    args.sourceBranch ? `The incoming work comes from branch '${args.sourceBranch}'.` : "",
    args.sourceSummary ? `Its latest commit says: "${args.sourceSummary}".` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `A git ${args.operation} left \`${args.path}\` in conflict. Propose the resolution.

${intent || "No extra context about the incoming work is available."}

You get three full versions of the file:
- BASE: the common ancestor both sides started from;
- CURRENT: the branch being integrated INTO;
- INCOMING: the work being integrated.

\`\`\`text BASE
${elide(args.base ?? "(no base version — one side added this file as new)", cap)}
\`\`\`

\`\`\`text CURRENT
${elide(args.ours, cap)}
\`\`\`

\`\`\`text INCOMING
${elide(args.theirs, cap)}
\`\`\`

Reply with ONLY a JSON object — no markdown fences, no commentary, no text before or after:
${SCHEMA}

${RULES}`;
}

/** Follow-up message when the model's reply was not parseable JSON. */
export function buildConflictRetryInstruction(parseError: string): string {
  return `Your reply could not be parsed (${parseError}). Reply with ONLY the JSON object described above — no markdown fences, no commentary, nothing else. Remember: no "evidence" key, and "proposal" must be the complete resolved file.`;
}

/** Strip an optional code fence and isolate the outermost JSON object. */
function extractJson(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (fence) text = fence[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new FormatError("no JSON object found in the reply");
  }
  return text.slice(start, end + 1);
}

const CONFIDENCES: ProposalConfidence[] = ["high", "medium", "low"];

/**
 * Strict-JSON parse of a proposal reply. Anything off-shape — including a
 * model-supplied "evidence" key, which is BANNED by design — throws
 * FormatError so the caller burns a format retry instead of rendering a
 * fake fact.
 */
export function parseConflictProposal(raw: string): RawConflictProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    if (err instanceof FormatError) throw err;
    throw new FormatError(err instanceof Error ? err.message : String(err));
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new FormatError("expected a JSON object");
  }
  const p = parsed as Record<string, unknown>;
  if ("evidence" in p) {
    // The model tried to mint its own checkmarks — the exact failure mode
    // the evidence engine exists to prevent. Loud rejection, never render.
    throw new FormatError('the reply must not contain an "evidence" key — evidence is tool-generated');
  }
  if (typeof p.story !== "string" || !p.story.trim()) {
    throw new FormatError("missing a story");
  }
  if (typeof p.proposal !== "string" || !p.proposal.trim()) {
    throw new FormatError("missing a proposal");
  }
  if (hasConflictMarkers(p.proposal)) {
    throw new FormatError("the proposal still contains conflict markers — send the fully merged file");
  }
  const confidence = CONFIDENCES.includes(p.confidence as ProposalConfidence)
    ? (p.confidence as ProposalConfidence)
    : "medium";
  const reasoningPoints = Array.isArray(p.reasoning_points)
    ? p.reasoning_points.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : [];
  return {
    story: p.story.trim(),
    proposal: p.proposal,
    confidence,
    reasoningPoints: reasoningPoints.map((x) => x.trim()),
  };
}

/**
 * Last resort after all format retries fail: if the raw reply contains a
 * fenced code block, treat it as the proposal with low confidence and use
 * the surrounding prose as the story. No fence → give up (FormatError).
 */
export function salvageConflictProposal(raw: string): RawConflictProposal {
  const fence = raw.match(/```[^\n]*\n([\s\S]*?)```/);
  if (!fence || !fence[1].trim() || hasConflictMarkers(fence[1])) {
    throw new FormatError("the model returned no usable proposal");
  }
  const story = raw
    .replace(/```[\s\S]*?```/, "")
    .trim()
    .slice(0, 500);
  return {
    story: story || "Recovered from an unparseable reply — review this proposal carefully.",
    proposal: fence[1],
    confidence: "low",
    reasoningPoints: [],
  };
}

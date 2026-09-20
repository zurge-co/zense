/**
 * Prompt builders + the strict-JSON parse harness for Auto Review. Pure
 * functions so tests can exercise them without a workspace, git, or LLM.
 *
 * All prompts, JSON keys and category enum values are English-only — the
 * findings parser must stay language-independent. The answer language is
 * controlled solely by the system prompt's "Always answer in …" directive;
 * only the free-text fields (title/detail/suggestion) may come back in the
 * user's preferred language.
 */

export type FindingCategory = "bug" | "risk" | "human-review";

export const FINDING_CATEGORIES: FindingCategory[] = ["bug", "risk", "human-review"];

/** One finding as the model returns it (before id/done are attached). */
export interface RawFinding {
  category: FindingCategory;
  title: string;
  file?: string;
  line?: number;
  detail?: string;
  suggestion?: string;
}

/** Throwing type marker: only FormatError consumes a retry — provider and
 *  network errors must abort immediately (constraint: no retry burn). */
export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatError";
  }
}

const SCHEMA = `{
  "findings": [
    {
      "category": "bug" | "risk" | "human-review",
      "title": "one-line title",
      "file": "path/to/file",
      "line": 42,
      "detail": "what the problem is and why",
      "suggestion": "what to do instead"
    }
  ]
}`;

const RULES = `Rules:
- "category" is exactly one of "bug", "risk", "human-review":
  bug = a defect that produces wrong behavior now;
  risk = could break under some condition or edge case;
  human-review = a decision a human must make (business rules, constants, naming), not a defect.
- Report only what the diff actually shows — never invent files or lines.
- "line" is the new-side line number the finding refers to (omit when unknown).
- Keep "title" to one line. Write title/detail/suggestion in your answer language;
  JSON keys and the category values stay in English exactly as shown.
- Return {"findings": []} when there is nothing worth reporting.`;

/** Per-chunk review prompt — strict JSON, findings for THIS chunk only. */
export function buildChunkReviewPrompt(args: {
  patch: string;
  path: string;
  part: number;
  parts: number;
  chunkIndex: number;
  chunkCount: number;
  files: string[];
}): string {
  const part =
    args.parts > 1 ? ` (part ${args.part} of ${args.parts})` : "";
  return `You are reviewing a staged git diff, chunk ${args.chunkIndex} of ${args.chunkCount}.

All changed files in this commit: ${args.files.join(", ")}

Review ONLY the following chunk — file \`${args.path}\`${part}:

\`\`\`diff
${args.patch}
\`\`\`

Reply with ONLY a JSON object — no markdown fences, no commentary, no text before or after:
${SCHEMA}

${RULES}`;
}

/** Follow-up message when the model's reply was not parseable JSON. */
export function buildRetryInstruction(parseError: string): string {
  return `Your reply could not be parsed (${parseError}). Reply with ONLY the JSON object described above — no markdown fences, no commentary, nothing else.`;
}

/** Critic pass: prune duplicates and unsupported findings. */
export function buildCriticPrompt(findings: RawFinding[]): string {
  return `A chunk-by-chunk review of a staged diff produced these findings:

\`\`\`json
${JSON.stringify({ findings }, null, 2)}
\`\`\`

Act as a critic:
- remove duplicates and near-duplicates,
- drop findings that are speculative, trivial style nits, or not actionable,
- fix wrong categories when obvious,
- keep everything else unchanged.

Reply with ONLY the JSON object — same schema, no commentary:
${SCHEMA}`;
}

/** Final cross-file synthesis over the compact findings + file list. */
export function buildSynthesisPrompt(findings: RawFinding[], files: string[]): string {
  return `A chunk-by-chunk review produced these findings:

\`\`\`json
${JSON.stringify({ findings }, null, 2)}
\`\`\`

Changed files: ${files.join(", ")}

Do the final cross-file pass:
- ADD findings that only appear when looking across files (broken call sites, mismatched contracts, a change whose counterpart in another file is missing),
- merge duplicated findings,
- keep everything else unchanged.

Reply with ONLY the JSON object — same schema, no commentary:
${SCHEMA}`;
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

function toFinding(value: unknown, index: number): RawFinding {
  if (typeof value !== "object" || value === null) {
    throw new FormatError(`findings[${index}] is not an object`);
  }
  const f = value as Record<string, unknown>;
  if (typeof f.title !== "string" || !f.title.trim()) {
    throw new FormatError(`findings[${index}] is missing a title`);
  }
  if (!FINDING_CATEGORIES.includes(f.category as FindingCategory)) {
    throw new FormatError(`findings[${index}] has an invalid category`);
  }
  const finding: RawFinding = {
    category: f.category as FindingCategory,
    title: f.title.trim(),
  };
  if (typeof f.file === "string" && f.file.trim()) finding.file = f.file.trim();
  if (typeof f.line === "number" && Number.isFinite(f.line)) finding.line = Math.round(f.line);
  if (typeof f.detail === "string" && f.detail.trim()) finding.detail = f.detail.trim();
  if (typeof f.suggestion === "string" && f.suggestion.trim()) {
    finding.suggestion = f.suggestion.trim();
  }
  return finding;
}

/**
 * Strict-JSON parse: the model must return {"findings": […]} (a wrapping
 * code fence or stray prose around the object is tolerated). Anything else
 * throws FormatError so the caller can retry (format errors only).
 */
export function parseFindingsJson(raw: string): RawFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    if (err instanceof FormatError) throw err;
    throw new FormatError(err instanceof Error ? err.message : String(err));
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { findings?: unknown }).findings)) {
    throw new FormatError('expected an object with a "findings" array');
  }
  return (parsed as { findings: unknown[] }).findings.map(toFinding);
}

/**
 * Last resort after all format retries fail: salvage bullet/heading lines
 * from the raw markdown reply instead of discarding the run. Keyword map
 * stays English — the model is instructed to keep structure English, and a
 * wrong guess lands safely in "human-review".
 */
export function parseFindingsMarkdownFallback(raw: string): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(\S.*)$/);
    if (!m) continue;
    let title = m[1].trim();
    if (title.length < 8 || /^(#{1,6}\s*)?(findings?|summary|notes?)\b/i.test(title)) continue;
    title = title.replace(/^#{1,6}\s*/, "");
    if (title.length > 200) title = `${title.slice(0, 197)}…`;
    let category: FindingCategory = "human-review";
    if (/\b(bug|error|crash|broken|incorrect|wrong|null|undefined|overflow)\b/i.test(title)) {
      category = "bug";
    } else if (/\b(risk|warning|edge case|might|could break|race)\b/i.test(title)) {
      category = "risk";
    }
    findings.push({ category, title });
    if (findings.length >= 50) break; // a wall of bullets is not findings
  }
  return findings;
}

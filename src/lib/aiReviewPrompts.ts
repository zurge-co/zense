/**
 * Prompt builders + patch helpers for the AI Review feature. Pure functions
 * so tests can exercise them without a workspace, git, or LLM.
 *
 * The four review kinds map to the user's four review actions:
 * - file-summary  — right-click a change → summarize that file's changes
 * - review-all    — the AI button in the Review panel → summarize everything
 *                   + points a human must review
 * - bug-hunt      — find bugs / mistakes / edge cases in the changes
 * - explain       — right-click code/chunk → explain what it is, its risks,
 *                   how to verify
 *
 * Prompt templates are English-only; the answer language is controlled by
 * the system prompt's preferred-language directive, not by these prompts.
 * Only the user-facing UI labels (KIND_LABEL, userBubbleLabel) stay Thai.
 */

export type AiReviewKind = "file-summary" | "review-all" | "bug-hunt" | "explain";

export const KIND_LABEL: Record<AiReviewKind, string> = {
  "file-summary": "สรุปไฟล์",
  "review-all": "Review ทั้งหมด",
  "bug-hunt": "หาบั๊ก",
  explain: "อธิบายโค้ด",
};

/** Short thread title for the AI Review panel. */
export function threadTitle(kind: AiReviewKind, target?: string): string {
  const label = KIND_LABEL[kind];
  return target ? `${label} · ${target}` : label;
}

/**
 * Extract the per-file section of a unified patch. A patch is a series of
 * `diff --git a/<old> b/<new>` sections; a file matches when either side of
 * its header equals `path` (rename: old or new path). Returns "" when the
 * file is not in the patch (e.g. untracked files never appear in the
 * workdir-vs-index patch).
 */
export function filterPatchForPath(patch: string, path: string): string {
  if (!patch.trim()) return "";
  const header = `diff --git a/${path} b/${path}`;
  const sections = patch.split(/(?=^diff --git )/m);
  const hit = sections.find((s) => {
    const firstLine = s.split("\n", 1)[0];
    if (firstLine === header) return true;
    // Renames / quoted paths: fall back to a token match on a/<path> or b/<path>.
    return (
      firstLine.startsWith("diff --git ") &&
      (firstLine.includes(` a/${path} `) ||
        firstLine.endsWith(` a/${path}`) ||
        firstLine.includes(` b/${path} `) ||
        firstLine.endsWith(` b/${path}`))
    );
  });
  return hit ? hit.trim() : "";
}

/** Cap an inline snippet so a fat selection can't blow up the request. */
const MAX_SNIPPET = 4000;
function clip(text: string): string {
  return text.length > MAX_SNIPPET
    ? `${text.slice(0, MAX_SNIPPET)}\n… (truncated — use the read_file tool to read more) …`
    : text;
}

/**
 * Summarize the changes of a single file (right-click a change in the
 * Review panel). When `patch` is empty the file may be untracked — fall
 * back to tools.
 */
export function buildFileSummaryPrompt(path: string, patch: string, staged: boolean): string {
  const scope = staged ? "staged (vs HEAD)" : "unstaged (vs index)";
  const context = patch.trim()
    ? `Unified diff of that file (${scope}):\n\n\`\`\`diff\n${clip(patch)}\n\`\`\``
    : `No diff for this file in the patch (${scope}) — it may be a new untracked file or the diff was truncated. Use the git_status / read_file tools to read the current file and summarize from its actual content.`;
  return `Please summarize the changes in \`${path}\`.

${context}

Answer format:
1. **Overview** — 1–2 sentences: what changed and why
2. **Key details** — bullets (cite file:line)
3. **Points a reviewer must check** (say "none" if there are none)`;
}

/** Summarize all changes + points a human must review (AI button in the Review panel). */
export function buildReviewAllPrompt(stagedPatch: string, unstagedPatch: string): string {
  const staged = stagedPatch.trim() ? clip(stagedPatch) : "(no staged changes)";
  const unstaged = unstagedPatch.trim() ? clip(unstagedPatch) : "(no unstaged changes)";
  return `Please review all uncommitted changes in this workspace.

Staged diff (vs HEAD):
\`\`\`diff
${staged}
\`\`\`

Unstaged diff (vs index):
\`\`\`diff
${unstaged}
\`\`\`

Answer format:
1. **Overview** — what this change set does and why
2. **Per file/group** — what each file changed, briefly
3. **⭐ Points a human must review** — a checklist of things an AI cannot decide: behavior-changing logic, business rules, constants, migrations, compatibility with other parts
4. **Overall risk** — what should be tested before committing

Use the git_diff / read_file tools to inspect details if the patch is not enough.`;
}

/**
 * Summarize the changes of a file between two commits (commitDiff tabs from
 * History/CompareView). There is no commit-patch tool in the backend
 * (git_show gives only line stats), so both versions are embedded inline
 * (clipped).
 */
export function buildCommitFileSummaryPrompt(
  path: string,
  fromLabel: string,
  toLabel: string,
  original: string,
  modified: string,
): string {
  return `Please summarize the changes in \`${path}\` between commit \`${fromLabel}\` → \`${toLabel}\`.

Old code (at \`${fromLabel}\`):
\`\`\`
${clip(original)}
\`\`\`

New code (at \`${toLabel}\`):
\`\`\`
${clip(modified)}
\`\`\`

(If the content was truncated, summarize what you can see and say so.)
Answer format:
1. **Overview** — 1–2 sentences: what changed and why (you may check the commit message via git_show)
2. **Key details** — bullets (cite file:line)
3. **Points a reviewer must check** (say "none" if there are none)`;
}

/** Find bugs / mistakes / edge cases in changes (scope = a path or "all changes"). */
export function buildBugHuntPrompt(scope: string, patch: string): string {
  const context = patch.trim()
    ? `Unified diff to analyze:\n\n\`\`\`diff\n${clip(patch)}\n\`\`\``
    : `No inline diff — use the git_diff / read_file tools to fetch the changes of ${scope} and analyze them yourself.`;
  return `Please find bugs / mistakes / edge cases that may come from ${scope}.

${context}

Analyze deeply: wrong logic, off-by-one, null/undefined, missing error handling, race conditions, side effects on callers, cases that worked before and will break now.
Answer as findings in the system's code review format ([severity] category — file:line), critical first.
If no problems are found, say so clearly and suggest 1–2 things worth testing.`;
}

export interface ExplainInput {
  path: string;
  /** 1-based inclusive line range on the working-tree side. */
  startLine: number;
  endLine: number;
  /** Selected code (editor) or added lines (diff chunk). */
  snippet: string;
  /** Diff chunk only: lines that were removed. */
  removed?: string;
}

/** Explain code/chunk — what it is, why it changed, what it relates to, how to verify, risks. */
export function buildExplainPrompt(input: ExplainInput): string {
  const ref =
    input.startLine === input.endLine
      ? `${input.path}:${input.startLine}`
      : `${input.path}:${input.startLine}-${input.endLine}`;
  const context =
    input.removed !== undefined
      ? `Change chunk in \`${input.path}\` (new side starts at line ${input.startLine}):

Old code that was removed/replaced:
\`\`\`
${clip(input.removed) || "(none — pure addition)"}
\`\`\`

New code:
\`\`\`
${clip(input.snippet) || "(none — pure deletion)"}
\`\`\``
      : `Selection \`${ref}\`:

\`\`\`
${clip(input.snippet)}
\`\`\``;
  return `Please explain this code.

${context}

Cover all 5 points:
1. **What it is** — one sentence: what this code/chunk does
2. **Why** — its purpose / the problem it solves (if it is a diff chunk, compare with the old code)
3. **Related code** — use the read_file / read_file_range tools to follow callers, imports, or related files, then say what this change affects
4. **How to verify** — how to check it is correct (tests to run / cases to try)
5. **Risk** — what may break if this part is wrong`;
}

/** Short heading for the user-side bubble in a thread — not the full prompt. */
export function userBubbleLabel(kind: AiReviewKind, target?: string): string {
  switch (kind) {
    case "file-summary":
      return `สรุปการเปลี่ยนแปลงของ \`${target}\``;
    case "review-all":
      return "สรุป changes ทั้งหมด + จุดที่ต้อง review";
    case "bug-hunt":
      return target ? `หาบั๊กใน \`${target}\`` : "หาบั๊กใน changes ทั้งหมด";
    case "explain":
      return `อธิบาย \`${target}\``;
  }
}

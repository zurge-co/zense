/**
 * Orchestration layer for the AI Review feature: turns a UI trigger (right-
 * click a change, the AI Review button, a Monaco context action) into a
 * thread in the AI Review panel. Fetching diff context lives here so the
 * components stay thin and the prompt builders stay pure (aiReviewPrompts).
 *
 * Errors are thrown as user-readable strings; callers surface them.
 */
import { gitStagedDiff, gitUnstagedDiff } from "./git";
import { useAiReviewStore } from "../store/aiReviewStore";
import { useUIStore } from "../store/uiStore";
import {
  buildBugHuntPrompt,
  buildCommitFileSummaryPrompt,
  buildExplainPrompt,
  buildFileSummaryPrompt,
  buildReviewAllPrompt,
  filterPatchForPath,
  threadTitle,
  type AiReviewKind,
} from "./aiReviewPrompts";

/**
 * Open the AI Review panel and start a thread. When the LLM is not
 * configured the panel shows its setup empty state and no thread is
 * created (returns null).
 */
async function begin(kind: AiReviewKind, target: string | undefined, prompt: string, root: string): Promise<string | null> {
  const store = useAiReviewStore.getState();
  if (!store.configLoaded) await store.loadConfig();
  useUIStore.getState().setRightTab("aiReview");
  if (!useAiReviewStore.getState().isConfigured()) return null;
  return useAiReviewStore.getState().startReview({
    kind,
    title: threadTitle(kind, target),
    prompt,
    root,
  });
}

/** The working-tree patch a file appears in, based on where it's listed. */
async function patchForFile(root: string, path: string, staged: boolean): Promise<string> {
  const raw = staged ? await gitStagedDiff(root) : await gitUnstagedDiff(root);
  return filterPatchForPath(raw, path);
}

/** คลิกขวาที่ change → สรุปการเปลี่ยนแปลงของไฟล์นั้น */
export async function summarizeFileChange(root: string, path: string, staged: boolean): Promise<void> {
  const patch = await patchForFile(root, path, staged);
  await begin("file-summary", path, buildFileSummaryPrompt(path, patch, staged), root);
}

/** ปุ่ม AI ใน Review panel → สรุป changes ทั้งหมด + จุดที่คนต้อง review */
export async function reviewAllChanges(root: string): Promise<void> {
  const [staged, unstaged] = await Promise.all([gitStagedDiff(root), gitUnstagedDiff(root)]);
  if (!staged.trim() && !unstaged.trim()) {
    throw new Error("No changes to review — ยังไม่มีการเปลี่ยนแปลงใด ๆ");
  }
  await begin("review-all", undefined, buildReviewAllPrompt(staged, unstaged), root);
}

/** หา bug / ความผิดพลาดจาก changes — ทั้ง repo หรือเฉพาะไฟล์ */
export async function findBugsInChanges(root: string, path?: string, staged = false): Promise<void> {
  let scope = "all changes (staged + unstaged)";
  let patch: string;
  if (path) {
    scope = `the changes in \`${path}\``;
    patch = await patchForFile(root, path, staged);
  } else {
    const [stagedPatch, unstagedPatch] = await Promise.all([
      gitStagedDiff(root),
      gitUnstagedDiff(root),
    ]);
    if (!stagedPatch.trim() && !unstagedPatch.trim()) {
      throw new Error("No changes to scan — ยังไม่มีการเปลี่ยนแปลงใด ๆ");
    }
    patch = `--- Staged ---\n${stagedPatch}\n--- Unstaged ---\n${unstagedPatch}`;
  }
  await begin("bug-hunt", path, buildBugHuntPrompt(scope, patch), root);
}

/** คลิกขวาใน commitDiff tab → สรุปการเปลี่ยนแปลงของไฟล์ระหว่างสอง commit */
export async function summarizeCommitFileChange(args: {
  root: string;
  path: string;
  fromLabel: string;
  toLabel: string;
  original: string;
  modified: string;
}): Promise<void> {
  await begin(
    "file-summary",
    args.path,
    buildCommitFileSummaryPrompt(
      args.path,
      args.fromLabel,
      args.toLabel,
      args.original,
      args.modified,
    ),
    args.root,
  );
}

/** คลิกขวาที่ selection ใน editor → อธิบายโค้ด */
export async function explainSelection(args: {
  root: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
}): Promise<void> {
  if (!args.snippet.trim()) return;
  const target =
    args.startLine === args.endLine
      ? `${args.path}:${args.startLine}`
      : `${args.path}:${args.startLine}-${args.endLine}`;
  await begin(
    "explain",
    target,
    buildExplainPrompt({
      path: args.path,
      startLine: args.startLine,
      endLine: args.endLine,
      snippet: args.snippet,
    }),
    args.root,
  );
}

/** คลิกขวาที่ chunk ใน diff view → อธิบายการเปลี่ยนแปลงของ chunk นั้น */
export async function explainDiffChange(args: {
  root: string;
  path: string;
  startLine: number;
  endLine: number;
  removed: string;
  added: string;
}): Promise<void> {
  if (!args.removed.trim() && !args.added.trim()) return;
  const target = `${args.path}:${args.startLine}${args.endLine > args.startLine ? `-${args.endLine}` : ""}`;
  await begin(
    "explain",
    target,
    buildExplainPrompt({
      path: args.path,
      startLine: args.startLine,
      endLine: args.endLine,
      snippet: args.added,
      removed: args.removed,
    }),
    args.root,
  );
}

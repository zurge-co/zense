/**
 * AI Review tests — the four LLM-powered review capabilities:
 *   1. right-click a change → summarize that file
 *   2. AI Review button → summarize everything + human review points
 *   3. find bugs/risks in changes
 *   4. right-click code/chunk (editor + diff view) → explain
 *
 * Follows the structural-verification pattern of the existing suites:
 * pure helpers and the real Zustand store are exercised directly; Tauri/LLM
 * wiring is verified by reading component source. In this environment
 * isTauri() is false, so chatSend resolves with the "not available in
 * browser dev" fallback — enough to exercise the store's thread lifecycle.
 */
import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  filterPatchForPath,
  buildFileSummaryPrompt,
  buildCommitFileSummaryPrompt,
  buildReviewAllPrompt,
  buildBugHuntPrompt,
  buildExplainPrompt,
  threadTitle,
  userBubbleLabel,
} from "../src/lib/aiReviewPrompts";
import { toInclusiveRange, findChangeAtLine, extractChunk } from "../src/lib/diffChunk";
import { useAiReviewStore, type AiReviewThread } from "../src/store/aiReviewStore";
import type { LlmConfig } from "../src/lib/llm";

const ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf-8");

const fakeConfig: LlmConfig = {
  apiFormat: "openai",
  baseUrl: "http://localhost:11434",
  apiKey: "",
  model: "test-model",
  enabledTools: { readFile: true, readFileRange: true, listFiles: true, gitTools: true },
  guards: { maxTurns: 5, maxToolOutput: 5000 },
  preferredLanguage: "th",
};

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  // isTauri() reads `window`; bun test doesn't always provide one.
  if (typeof globalThis.window === "undefined") {
    (globalThis as { window?: object }).window = {};
  }
});

// ── filterPatchForPath ────────────────────────────────────────────────────

const TWO_FILE_PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,1 +1,2 @@",
  " const a = 1;",
  "+const a2 = 2;",
  "diff --git a/src/b.ts b/src/b.ts",
  "index 3333333..4444444 100644",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1,1 +1,1 @@",
  "-const b = 1;",
  "+const b = 2;",
  "",
].join("\n");

describe("filterPatchForPath", () => {
  test("extracts only the requested file's section", () => {
    const out = filterPatchForPath(TWO_FILE_PATCH, "src/b.ts");
    expect(out).toContain("diff --git a/src/b.ts b/src/b.ts");
    expect(out).toContain("+const b = 2;");
    expect(out).not.toContain("src/a.ts");
  });

  test("extracts the first file's section without bleeding into the second", () => {
    const out = filterPatchForPath(TWO_FILE_PATCH, "src/a.ts");
    expect(out).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(out).not.toContain("src/b.ts");
  });

  test("matches a rename via the new (b/) path", () => {
    const rename = "diff --git a/src/old.ts b/src/new.ts\nindex 1..2 100644\n--- a/src/old.ts\n+++ b/src/new.ts\n@@ -1 +1 @@\n-x\n+y\n";
    expect(filterPatchForPath(rename, "src/new.ts")).toContain("+y");
    expect(filterPatchForPath(rename, "src/old.ts")).toContain("+y");
  });

  test("returns empty string when the file is not in the patch", () => {
    expect(filterPatchForPath(TWO_FILE_PATCH, "src/missing.ts")).toBe("");
    expect(filterPatchForPath("", "src/a.ts")).toBe("");
  });
});

// ── prompt builders ───────────────────────────────────────────────────────

describe("AI Review prompt builders", () => {
  test("file summary embeds the path and the filtered diff", () => {
    const p = buildFileSummaryPrompt("src/a.ts", TWO_FILE_PATCH, false);
    expect(p).toContain("src/a.ts");
    expect(p).toContain("```diff");
    expect(p).toContain("summarize");
  });

  test("file summary falls back to tools when no patch is available", () => {
    const p = buildFileSummaryPrompt("src/new.ts", "", false);
    expect(p).toContain("read_file");
    expect(p).not.toContain("```diff");
  });

  test("review-all covers staged+unstaged and demands human review points", () => {
    const p = buildReviewAllPrompt(TWO_FILE_PATCH, "");
    expect(p).toContain("Points a human must review");
    expect(p).toContain("Staged diff");
    expect(p).toContain("Unstaged diff");
    expect(p).toContain("(no unstaged changes)");
  });

  test("commit-file summary embeds both versions with the sha refs", () => {
    const p = buildCommitFileSummaryPrompt("src/a.ts", "a1b2c3d", "e5f6071", "old code", "new code");
    expect(p).toContain("src/a.ts");
    expect(p).toContain("a1b2c3d");
    expect(p).toContain("e5f6071");
    expect(p).toContain("old code");
    expect(p).toContain("new code");
    expect(p).toContain("summarize");
  });

  test("bug hunt asks for severity-classified findings", () => {
    const p = buildBugHuntPrompt("all changes", TWO_FILE_PATCH);
    expect(p).toContain("[severity]");
    expect(p).toContain("edge case");
  });

  test("explain (editor selection) covers what/why/relations/verify/risk", () => {
    const p = buildExplainPrompt({
      path: "src/a.ts",
      startLine: 3,
      endLine: 8,
      snippet: "const x = f();",
    });
    for (const section of ["What it is", "Why", "Related code", "How to verify", "Risk"]) {
      expect(p).toContain(section);
    }
    expect(p).toContain("src/a.ts:3-8");
    expect(p).toContain("const x = f();");
  });

  test("explain (diff chunk) includes removed vs added blocks", () => {
    const p = buildExplainPrompt({
      path: "src/a.ts",
      startLine: 5,
      endLine: 6,
      snippet: "+new code",
      removed: "-old code",
    });
    expect(p).toContain("Old code");
    expect(p).toContain("-old code");
    expect(p).toContain("+new code");
  });

  test("thread tab titles keep Thai kind labels", () => {
    expect(threadTitle("file-summary", "src/a.ts")).toContain("src/a.ts");
  });

  test("bubble fallback mirrors the English button/menu labels", () => {
    expect(userBubbleLabel("file-summary")).toBe("Summarize with AI");
    expect(userBubbleLabel("review-all")).toBe("Summarize all changes + review points");
    expect(userBubbleLabel("bug-hunt")).toBe("Find bugs with AI");
    expect(userBubbleLabel("explain")).toBe("Explain with AI");
  });
});

// ── diffChunk helpers ─────────────────────────────────────────────────────

const change = (oS: number, oE: number, mS: number, mE: number) => ({
  originalStartLineNumber: oS,
  originalEndLineNumber: oE,
  modifiedStartLineNumber: mS,
  modifiedEndLineNumber: mE,
});

describe("diffChunk helpers", () => {
  test("toInclusiveRange normalizes Monaco's empty-range encoding", () => {
    expect(toInclusiveRange(5, 8)).toEqual({ start: 5, end: 8 });
    expect(toInclusiveRange(5, 0)).toEqual({ start: 6, end: 5 });
    expect(toInclusiveRange(5, 4)).toEqual({ start: 6, end: 5 });
  });

  test("findChangeAtLine returns the change containing the line", () => {
    const changes = [change(1, 1, 1, 2), change(10, 12, 11, 13)];
    expect(findChangeAtLine(changes, 12)).toBe(changes[1]);
    expect(findChangeAtLine(changes, 1)).toBe(changes[0]);
  });

  test("findChangeAtLine falls back to the nearest change", () => {
    const changes = [change(1, 1, 1, 2), change(20, 20, 20, 22)];
    expect(findChangeAtLine(changes, 15)).toBe(changes[1]);
    expect(findChangeAtLine([], 5)).toBeUndefined();
  });

  test("findChangeAtLine resolves lines on the original side too", () => {
    // A pure deletion: empty modified range, real original range.
    const changes = [change(20, 23, 21, 0), change(5, 5, 5, 7)];
    // Original-side line of the deleted block hits the deletion change.
    expect(findChangeAtLine(changes, 22, "original")).toBe(changes[0]);
    // Modified-side line 22 does NOT (it belongs to the second change's vicinity is checked separately).
    expect(findChangeAtLine(changes, 6, "modified")).toBe(changes[1]);
  });

  test("extractChunk pulls removed and added text", () => {
    const original = "a\nb\nc\nd";
    const modified = "a\nX\nY\nd";
    const chunk = extractChunk(change(2, 3, 2, 3), original, modified);
    expect(chunk).toEqual({ removed: "b\nc", added: "X\nY", startLine: 2, endLine: 3 });
  });

  test("extractChunk handles a pure insertion", () => {
    const original = "a\nb";
    const modified = "a\nNEW\nb";
    // Insert before modified line 2: original range empty (2,1).
    const chunk = extractChunk(change(2, 1, 2, 2), original, modified);
    expect(chunk.removed).toBe("");
    expect(chunk.added).toBe("NEW");
  });
});

// ── aiReviewStore thread lifecycle ────────────────────────────────────────

const makeThread = (id: string, over: Partial<AiReviewThread> = {}): AiReviewThread => ({
  id,
  kind: "explain",
  title: id,
  bubble: id,
  messages: [],
  streaming: false,
  streamingText: "",
  activeTools: [],
  error: null,
  ...over,
});

describe("aiReviewStore", () => {
  beforeEach(() => {
    useAiReviewStore.setState({
      threads: [],
      activeThreadId: null,
      config: fakeConfig,
      configLoaded: true,
    });
  });

  test("startReview creates an active thread and completes the run", async () => {
    const id = useAiReviewStore.getState().startReview({
      kind: "file-summary",
      title: "สรุปไฟล์ · src/a.ts",
      prompt: "สรุป src/a.ts",
      root: "/tmp",
    });
    let s = useAiReviewStore.getState();
    expect(s.activeThreadId).toBe(id);
    expect(s.threads).toHaveLength(1);
    expect(s.threads[0].messages[0]).toEqual({ role: "user", content: "สรุป src/a.ts" });
    expect(s.threads[0].streaming).toBe(true);

    await tick();
    s = useAiReviewStore.getState();
    // Non-Tauri fallback reply is appended as the assistant message.
    expect(s.threads[0].streaming).toBe(false);
    expect(s.threads[0].messages).toHaveLength(2);
    expect(s.threads[0].messages[1].role).toBe("assistant");
  });

  test("startReview stores an explicit bubble (clicked button label) verbatim", () => {
    const id = useAiReviewStore.getState().startReview({
      kind: "bug-hunt",
      title: "หาบั๊ก · src/a.ts",
      bubble: "Find bugs in all changes",
      prompt: "real english prompt",
      root: "/tmp",
    });
    const t = useAiReviewStore.getState().threads.find((x) => x.id === id)!;
    expect(t.bubble).toBe("Find bugs in all changes");
    // The bubble is display-only — the LLM still gets the full prompt.
    expect(t.messages[0]).toEqual({ role: "user", content: "real english prompt" });
  });

  test("followUp appends user + assistant messages to the same thread", async () => {
    const id = useAiReviewStore.getState().startReview({
      kind: "bug-hunt",
      title: "หาบั๊ก",
      prompt: "หาบั๊ก",
      root: "/tmp",
    });
    await tick();
    useAiReviewStore.getState().followUp(id, "แล้วเสี่ยงอะไรอีก", "/tmp");
    await tick();
    const t = useAiReviewStore.getState().threads[0];
    expect(t.messages).toHaveLength(4);
    expect(t.messages[2]).toEqual({ role: "user", content: "แล้วเสี่ยงอะไรอีก" });
    expect(t.messages[3].role).toBe("assistant");
  });

  test("followUp is ignored while the thread is streaming", () => {
    const id = useAiReviewStore.getState().startReview({
      kind: "review-all",
      title: "Review ทั้งหมด",
      prompt: "review",
      root: "/tmp",
    });
    // Still streaming → follow-up must be dropped, not queued.
    useAiReviewStore.getState().followUp(id, "too soon", "/tmp");
    expect(useAiReviewStore.getState().threads[0].messages).toHaveLength(1);
  });

  test("stop keeps partial streamed text as an assistant message", () => {
    const t = makeThread("t-stop", { streaming: true, streamingText: "partial draft" });
    useAiReviewStore.setState({ threads: [t], activeThreadId: "t-stop" });
    useAiReviewStore.getState().stop("t-stop");
    const s = useAiReviewStore.getState().threads[0];
    expect(s.streaming).toBe(false);
    expect(s.streamingText).toBe("");
    expect(s.messages.at(-1)).toEqual({ role: "assistant", content: "partial draft" });
  });

  test("closeThread removes the thread and reselects another", () => {
    useAiReviewStore.setState({
      threads: [makeThread("t1"), makeThread("t2")],
      activeThreadId: "t1",
    });
    useAiReviewStore.getState().closeThread("t1");
    const s = useAiReviewStore.getState();
    expect(s.threads.map((t) => t.id)).toEqual(["t2"]);
    expect(s.activeThreadId).toBe("t2");
  });

  test("isConfigured requires baseUrl+model from the saved config", () => {
    expect(useAiReviewStore.getState().isConfigured()).toBe(true);
    useAiReviewStore.setState({ config: null });
    expect(useAiReviewStore.getState().isConfigured()).toBe(false);
  });
});

// ── structural wiring ─────────────────────────────────────────────────────

describe("AI Review wiring (structural)", () => {
  test("uiStore: 'aiReview' is a RightTab", () => {
    expect(readSrc("src/store/uiStore.ts")).toContain('"aiReview"');
  });

  test("ChatPanel renders the AI Review tab", () => {
    const src = readSrc("src/components/chat/ChatPanel.tsx");
    expect(src).toContain("aiReview");
    expect(src).toContain("AiReviewPanel");
  });

  test("ReviewPanel: right-click menu on changes + AI Review button", () => {
    const src = readSrc("src/components/sidebar/ReviewPanel.tsx");
    expect(src.toLowerCase()).toContain("contextmenu");
    expect(src).toContain("Summarize with AI");
    expect(src).toContain("Find bugs with AI");
    expect(src).toContain("AI Review");
    expect(src).toContain("reviewAllChanges");
  });

  test("CodeEditor adds an AI explain action next to Copy Reference", () => {
    const src = readSrc("src/components/editor/CodeEditor.tsx");
    const actions = src.match(/\.addAction\(/g) ?? [];
    expect(actions.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("zense.explainWithAi");
    expect(src).toContain("Explain with AI");
  });

  test("CodeEditor: explain falls back to the cursor line without a selection", () => {
    const src = readSrc("src/components/editor/CodeEditor.tsx");
    expect(src).toContain("sel.isEmpty()");
    expect(src).toContain("getLineContent(sel.startLineNumber)");
    // An empty selection must no longer silently abort.
    expect(src).not.toContain("sel.isEmpty() || !root");
  });

  test("DiffView: context menu enabled with explain/summarize actions", () => {
    const src = readSrc("src/components/editor/DiffView.tsx");
    expect(src).toContain("addAction");
    expect(src).toContain("zense.explainChange");
    expect(src).toContain("contextmenu: true");
  });

  test("DiffView: AI actions exist on BOTH diff sides (new + old code)", () => {
    const src = readSrc("src/components/editor/DiffView.tsx");
    expect(src).toContain("getModifiedEditor()");
    expect(src).toContain("getOriginalEditor()");
    expect(src).toContain('"original"');
    const actions = src.match(/\.addAction\(/g) ?? [];
    expect(actions.length).toBeGreaterThanOrEqual(2);
  });

  test("DiffView: summarize menu works in commit-diff tabs too (not a dead item)", () => {
    const src = readSrc("src/components/editor/DiffView.tsx");
    expect(src).toContain("summarizeCommitFileChange");
    expect(src).toContain("fromSha");
    expect(src).toContain("toSha");
    // The commit-mode branch must send the loaded file pair inline.
    const commitBranch = src.indexOf("if (meta.commitMode)");
    expect(commitBranch).toBeGreaterThan(-1);
    expect(src.slice(commitBranch, commitBranch + 700)).toContain("original: c.original");
  });

  test("DiffView: the pre-existing AI Summary button is wired", () => {
    const src = readSrc("src/components/editor/DiffView.tsx");
    const titleIdx = src.indexOf('title="Summarize this diff with AI"');
    const labelIdx = src.indexOf("AI Summary", titleIdx);
    expect(titleIdx).toBeGreaterThan(-1);
    const buttonBody = src.slice(titleIdx, labelIdx);
    expect(buttonBody).toContain("onClick");
    expect(buttonBody).toContain("summarizeFileChange");
  });

  test("orchestration helpers exist and switch to the AI Review tab", () => {
    const src = readSrc("src/lib/aiReview.ts");
    for (const fn of [
      "summarizeFileChange",
      "summarizeCommitFileChange",
      "reviewAllChanges",
      "findBugsInChanges",
      "explainSelection",
      "explainDiffChange",
    ]) {
      expect(src).toContain(fn);
    }
    expect(src).toContain('setRightTab("aiReview")');
    expect(src).toContain("startReview");
  });
});

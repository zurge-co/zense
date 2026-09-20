/**
 * Auto Review tests — the chunked, strict-JSON review pipeline:
 *   1. diffChunk: split the staged diff by file, sub-split by hunk over budget
 *   2. aiReviewPrompts: strict-JSON parse harness (+ markdown last resort)
 *   3. aiReview.askFindingsJson: ≤2 format-error-only retries
 *   4. aiReviewStore: findings state, sessions, checkboxes (Closed sections)
 *
 * Follows the structural-verification pattern of the existing suites: pure
 * helpers and the real Zustand store are exercised directly; Tauri/LLM
 * wiring is verified by reading source. isTauri() is false under bun test,
 * so no real chat_send happens — the `send` seam is stubbed instead.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { chunkDiff, splitDiffByFile } from "../src/lib/diffChunk";
import {
  FormatError,
  buildChunkReviewPrompt,
  buildCriticPrompt,
  buildRetryInstruction,
  buildSynthesisPrompt,
  parseFindingsJson,
  parseFindingsMarkdownFallback,
} from "../src/lib/aiReviewPrompts";
import { askFindingsJson, runAutoReview } from "../src/lib/aiReview";
import { useAiReviewStore } from "../src/store/aiReviewStore";
import type { IpcMessage, LlmConfig } from "../src/lib/llm";

const ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf-8");

// isTauri() reads `window`; bun test doesn't always provide one.
if (typeof globalThis.window === "undefined") {
  (globalThis as { window?: object }).window = {};
}

const fakeConfig: LlmConfig = {
  apiFormat: "openai",
  baseUrl: "http://localhost:11434",
  apiKey: "",
  model: "test-model",
  enabledTools: { readFile: false, readFileRange: false, listFiles: false, gitTools: false },
  guards: { maxTurns: 5, maxToolOutput: 5000 },
  preferredLanguage: "en",
};

// ── diffChunk ─────────────────────────────────────────────────────────────

const TWO_FILE_PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,1 +1,2 @@",
  " line1",
  "+line2",
  "diff --git a/src/b.ts b/src/b.ts",
  "index 3333333..4444444 100644",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -5,3 +5,3 @@",
  " ctx",
  "-old",
  "+new",
  " ctx",
].join("\n");

describe("splitDiffByFile", () => {
  test("splits a patch into per-file sections with headers and hunks", () => {
    const files = splitDiffByFile(TWO_FILE_PATCH);
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(files[0].header).toContain("diff --git a/src/a.ts");
    expect(files[0].hunks).toHaveLength(1);
    expect(files[0].hunks[0]).toContain("@@ -1,1 +1,2 @@");
  });

  test("empty patch yields no sections", () => {
    expect(splitDiffByFile("")).toEqual([]);
    expect(splitDiffByFile("   \n")).toEqual([]);
  });

  test("deleted file (no +++ b/ path) falls back to the a/ side", () => {
    const patch = [
      "diff --git a/src/gone.ts b/src/gone.ts",
      "deleted file mode 100644",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n");
    expect(splitDiffByFile(patch)[0].path).toBe("src/gone.ts");
  });
});

describe("chunkDiff", () => {
  test("one chunk per file when everything fits the budget", () => {
    const chunks = chunkDiff(TWO_FILE_PATCH, 10_000);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ path: "src/a.ts", part: 1, parts: 1 });
    expect(chunks[0].patch).toContain("+++ b/src/a.ts");
  });

  test("an oversized file is split by hunk, header repeated per chunk", () => {
    const hunks = Array.from({ length: 4 }, (_, i) =>
      [`@@ -${i * 10},3 +${i * 10},3 @@`, " ctx", `-old${i}`, `+new${i}`].join("\n"),
    );
    const patch = [
      "diff --git a/big.ts b/big.ts",
      "--- a/big.ts",
      "+++ b/big.ts",
      ...hunks,
    ].join("\n");
    const chunks = chunkDiff(patch, 90);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.path).toBe("big.ts");
      expect(c.patch).toContain("diff --git a/big.ts");
      expect(c.parts).toBe(chunks.length);
    }
    expect(chunks.map((c) => c.part)).toEqual(chunks.map((_, i) => i + 1));
  });

  test("a single hunk larger than the budget stays in one piece", () => {
    const hugeHunk = `@@ -1,${300} +1,${300} @@\n` + "+x\n".repeat(300);
    const patch = `diff --git a/h.ts b/h.ts\n--- a/h.ts\n+++ b/h.ts\n${hugeHunk}`;
    const chunks = chunkDiff(patch, 50);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].patch).toContain("+x");
  });
});

// ── parse harness ─────────────────────────────────────────────────────────

const VALID = JSON.stringify({
  findings: [
    {
      category: "bug",
      title: "Null deref in save",
      file: "src/save.ts",
      line: 42,
      detail: "config may be null",
      suggestion: "guard before use",
    },
  ],
});

describe("parseFindingsJson", () => {
  test("accepts a bare JSON object", () => {
    const out = parseFindingsJson(VALID);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: "bug", title: "Null deref in save", line: 42 });
  });

  test("tolerates a code fence and surrounding prose", () => {
    const fenced = `Here are my findings:\n\`\`\`json\n${VALID}\n\`\`\`\nDone.`;
    expect(parseFindingsJson(fenced)).toHaveLength(1);
  });

  test("empty findings array is valid", () => {
    expect(parseFindingsJson('{"findings": []}')).toEqual([]);
  });

  test("rejects non-JSON replies with FormatError", () => {
    expect(() => parseFindingsJson("I found no issues!")).toThrow(FormatError);
    expect(() => parseFindingsJson('{"result": []}')).toThrow(FormatError);
  });

  test("rejects invalid categories and missing titles", () => {
    expect(() =>
      parseFindingsJson('{"findings":[{"category":"style","title":"x"}]}'),
    ).toThrow(FormatError);
    expect(() => parseFindingsJson('{"findings":[{"category":"bug"}]}')).toThrow(FormatError);
  });

  test("drops unknown optional fields but keeps file/detail/suggestion", () => {
    const out = parseFindingsJson(
      '{"findings":[{"category":"risk","title":"t","file":"a.ts","line":3.7,"detail":"d","suggestion":"s","extra":1}]}',
    );
    expect(out[0]).toEqual({ category: "risk", title: "t", file: "a.ts", line: 4, detail: "d", suggestion: "s" });
  });
});

describe("parseFindingsMarkdownFallback", () => {
  test("salvages bullet lines and keyword-maps categories", () => {
    const raw = [
      "Findings:",
      "- Bug: null check missing in parser",
      "- Risk: race condition when two saves overlap",
      "- Decide whether the timeout value is right",
    ].join("\n");
    const out = parseFindingsMarkdownFallback(raw);
    expect(out.map((f) => f.category)).toEqual(["bug", "risk", "human-review"]);
  });

  test("ignores headings and short lines", () => {
    expect(parseFindingsMarkdownFallback("# Summary\n- ok")).toEqual([]);
  });

  test("returns empty for prose without bullets", () => {
    expect(parseFindingsMarkdownFallback("All good, nothing to report.")).toEqual([]);
  });
});

// ── askFindingsJson retry harness ─────────────────────────────────────────

type StubSend = (config: LlmConfig, sys: string, messages: IpcMessage[], root: string, onEvent: (e: unknown) => void) => Promise<string>;

const stubSend = (replies: Array<string | Error>, seen?: string[]): StubSend => {
  let i = 0;
  return async (_c, _s, messages) => {
    seen?.push(messages[messages.length - 1].content);
    const next = replies[Math.min(i++, replies.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
};

describe("askFindingsJson", () => {
  test("parses a valid first reply without retries", async () => {
    const out = await askFindingsJson(stubSend([VALID]), fakeConfig, "sys", "/root", "prompt");
    expect(out).toHaveLength(1);
  });

  test("retries on format errors with the retry instruction", async () => {
    const seen: string[] = [];
    const out = await askFindingsJson(
      stubSend(["not json at all", VALID], seen),
      fakeConfig,
      "sys",
      "/root",
      "prompt",
    );
    expect(out).toHaveLength(1);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("could not be parsed");
  });

  test("gives up after 2 format retries and salvages markdown", async () => {
    const calls = { n: 0 };
    const send: StubSend = async () => {
      calls.n++;
      return "- Bug: something is definitely wrong here";
    };
    const out = await askFindingsJson(send, fakeConfig, "sys", "/root", "prompt");
    expect(calls.n).toBe(3); // initial + 2 retries
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("bug");
  });

  test("throws FormatError when nothing salvageable remains after retries", async () => {
    await expect(
      askFindingsJson(stubSend(["???"]), fakeConfig, "sys", "/root", "prompt"),
    ).rejects.toThrow(FormatError);
  });

  test("provider/network errors do NOT consume retries — they propagate", async () => {
    const calls = { n: 0 };
    const send: StubSend = async () => {
      calls.n++;
      throw new Error("connection refused");
    };
    await expect(
      askFindingsJson(send, fakeConfig, "sys", "/root", "prompt"),
    ).rejects.toThrow("connection refused");
    expect(calls.n).toBe(1);
  });
});

// ── prompts ───────────────────────────────────────────────────────────────

describe("prompt builders", () => {
  test("chunk prompt embeds the patch, position, and the strict-JSON schema", () => {
    const p = buildChunkReviewPrompt({
      patch: "@@ -1 +1 @@",
      path: "src/a.ts",
      part: 2,
      parts: 3,
      chunkIndex: 2,
      chunkCount: 4,
      files: ["src/a.ts", "src/b.ts"],
    });
    expect(p).toContain("chunk 2 of 4");
    expect(p).toContain("part 2 of 3");
    expect(p).toContain("`src/a.ts`");
    expect(p).toContain("src/a.ts, src/b.ts");
    expect(p).toContain('"category"');
    expect(p).toContain('"human-review"');
    expect(p).toContain("Reply with ONLY a JSON object");
  });

  test("retry instruction quotes the parse error", () => {
    expect(buildRetryInstruction("boom")).toContain("boom");
  });

  test("critic and synthesis prompts carry the findings JSON", () => {
    const findings = parseFindingsJson(VALID);
    expect(buildCriticPrompt(findings)).toContain("Null deref in save");
    expect(buildSynthesisPrompt(findings, ["src/save.ts"])).toContain("src/save.ts");
  });
});

// ── store ─────────────────────────────────────────────────────────────────

describe("aiReviewStore", () => {
  beforeEach(() => {
    useAiReviewStore.setState({
      findings: [],
      running: false,
      phase: null,
      error: null,
      session: 0,
    });
  });

  const raw = (title: string, category: "bug" | "risk" | "human-review" = "bug") => ({
    category,
    title,
  });

  test("begin clears findings and starts a fresh session", () => {
    const s = useAiReviewStore.getState();
    s.addFindings(1, [raw("old")]); // ignored — no session started
    const session = useAiReviewStore.getState().begin();
    useAiReviewStore.getState().addFindings(session, [raw("first")]);
    expect(useAiReviewStore.getState().findings).toHaveLength(1);
    expect(useAiReviewStore.getState().running).toBe(true);
    const again = useAiReviewStore.getState().begin();
    expect(again).toBe(session + 1);
    expect(useAiReviewStore.getState().findings).toHaveLength(0);
  });

  test("addFindings assigns ids and appends; stale sessions are ignored", () => {
    const session = useAiReviewStore.getState().begin();
    useAiReviewStore.getState().addFindings(session, [raw("a"), raw("b", "risk")]);
    useAiReviewStore.getState().addFindings(session - 1, [raw("stale")]);
    const { findings } = useAiReviewStore.getState();
    expect(findings.map((f) => f.title)).toEqual(["a", "b"]);
    expect(findings[0].id).not.toBe(findings[1].id);
    expect(findings.every((f) => !f.done)).toBe(true);
  });

  test("toggleDone flags a finding for the Closed section", () => {
    const session = useAiReviewStore.getState().begin();
    useAiReviewStore.getState().addFindings(session, [raw("a")]);
    const id = useAiReviewStore.getState().findings[0].id;
    useAiReviewStore.getState().toggleDone(id);
    expect(useAiReviewStore.getState().findings[0].done).toBe(true);
    useAiReviewStore.getState().toggleDone(id);
    expect(useAiReviewStore.getState().findings[0].done).toBe(false);
  });

  test("replaceFindings swaps the whole list (critic/synthesis)", () => {
    const session = useAiReviewStore.getState().begin();
    useAiReviewStore.getState().addFindings(session, [raw("a"), raw("b")]);
    useAiReviewStore.getState().replaceFindings(session, [raw("c", "human-review")]);
    const { findings } = useAiReviewStore.getState();
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("human-review");
  });

  test("finish clears running/phase and records an error", () => {
    const session = useAiReviewStore.getState().begin();
    useAiReviewStore.getState().setPhase("chunk 1 of 2");
    useAiReviewStore.getState().finish(session, "boom");
    const s = useAiReviewStore.getState();
    expect(s.running).toBe(false);
    expect(s.phase).toBeNull();
    expect(s.error).toBe("boom");
  });
});

// ── runAutoReview guards (no Tauri here, so the pipeline itself can't run) ──

describe("runAutoReview guards", () => {
  test("throws a setup error when the provider is not configured", async () => {
    await expect(runAutoReview("/tmp/nowhere")).rejects.toThrow(/AI provider/i);
  });
});

// ── structural wiring ─────────────────────────────────────────────────────

describe("Auto Review structural wiring", () => {
  test("Rust backend keeps chat_send + llm_test_connection, drops toggle_chat", () => {
    const lib = readSrc("src-tauri/src/lib.rs");
    expect(lib).toContain("chatcmd::chat_send");
    expect(lib).toContain("chatcmd::llm_test_connection");
    expect(lib).not.toContain("toggle_chat");
  });

  test("Review panel runs the chunked Auto Review pipeline", () => {
    const panel = readSrc("src/components/sidebar/ReviewPanel.tsx");
    expect(panel).toContain("runAutoReview");
    expect(panel).not.toContain("summarizeFileChange");
    expect(panel).not.toContain("findBugsInChanges");
    expect(panel).not.toContain("reviewAllChanges");
  });

  test("removed AI actions are gone from the editor and diff view", () => {
    const editor = readSrc("src/components/editor/CodeEditor.tsx");
    const diff = readSrc("src/components/editor/DiffView.tsx");
    for (const src of [editor, diff]) {
      expect(src).not.toContain("Explain with AI");
      expect(src).not.toContain("explainSelection");
      expect(src).not.toContain("explainDiffChange");
      expect(src).not.toContain("summarizeCommitFileChange");
    }
  });

  test("findings panel groups Bug / Risk / Human Review with Closed sections", () => {
    const panel = readSrc("src/components/aiReview/AiReviewPanel.tsx");
    expect(panel).toContain("Bug");
    expect(panel).toContain("Risk");
    expect(panel).toContain("Human Review");
    expect(panel).toContain("Closed");
    expect(panel).toContain("toggleDone");
  });

  test("prompts and parse harness are English-only (language-independent parser)", () => {
    const prompts = readSrc("src/lib/aiReviewPrompts.ts");
    expect(prompts).toContain('"bug"');
    expect(prompts).toContain('"risk"');
    expect(prompts).toContain('"human-review"');
    // The language directive stays in the shared system prompt.
    expect(readSrc("src/lib/systemPrompt.ts")).toContain("Always answer in");
    // No Thai characters anywhere in the review pipeline.
    expect(readSrc("src/lib/aiReview.ts")).not.toMatch(/[ก-๙]/);
    expect(prompts).not.toMatch(/[ก-๙]/);
  });
});

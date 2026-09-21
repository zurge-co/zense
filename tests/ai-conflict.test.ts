/**
 * AI Conflict Resolution V1 tests — house pattern (see conflict-mode.test.ts):
 * exercise the pure pipeline/store logic directly, and read component source
 * text to assert the wiring (workspace mount, launch points, finish action,
 * semantic labels, the no-LLM-evidence invariant).
 */
import { describe, test, expect, beforeEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import {
  classifyConflict,
  detectTrivial,
  hasConflictMarkers,
  parseConflictProposal,
  salvageConflictProposal,
  buildConflictPrompt,
  FormatError,
} from "../src/lib/aiConflictPrompts";
import {
  buildResolutionAudit,
  ZENSE_RESOLUTION_KEY,
  ZENSE_VERSION_KEY,
  ZENSE_RESOLVED_FILES_KEY,
  ZENSE_RESOLUTION_VERSION,
} from "../src/lib/commitTrailer";
import {
  useConflictResolutionStore,
  effectiveContent,
} from "../src/store/conflictResolutionStore";
import type { GitConflictEntry } from "../src/lib/git";

const ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf-8");

const entry = (over: Partial<GitConflictEntry> = {}): GitConflictEntry => ({
  path: "src/a.ts",
  base: "b",
  ours: "o",
  theirs: "t",
  conflictType: "content",
  ...over,
});

// ── classifier ──────────────────────────────────────────────────────────

describe("classifyConflict", () => {
  test("binary flag routes first — no LLM, no text edit", () => {
    expect(classifyConflict(entry({ binary: true }))).toBe("binary");
    expect(
      classifyConflict(entry({ binary: true, conflictType: "modify-delete", theirs: undefined })),
    ).toBe("binary");
  });

  test("modify-delete and normal content route by conflictType", () => {
    expect(classifyConflict(entry({ conflictType: "modify-delete", theirs: undefined }))).toBe(
      "modify-delete",
    );
    expect(classifyConflict(entry())).toBe("content");
  });
});

// ── trivial detection ───────────────────────────────────────────────────

describe("detectTrivial", () => {
  test("whitespace-only differences are trivial", () => {
    expect(detectTrivial("const x  =  1;\n", "const x = 1;\n")).toBe("whitespace");
    expect(detectTrivial("a\n\n\nb", "a\nb")).toBe("whitespace");
  });

  test("same import set in a different order is trivial", () => {
    const ours = 'import a from "a";\nimport b from "b";\nimport c from "c";\n';
    const theirs = 'import c from "c";\nimport a from "a";\nimport b from "b";\n';
    expect(detectTrivial(ours, theirs)).toBe("import-order");
  });

  test("reordered STATEMENTS are not trivial (behavior can change)", () => {
    const ours = "await save();\nawait notify();\n";
    const theirs = "await notify();\nawait save();\n";
    expect(detectTrivial(ours, theirs)).toBeNull();
  });

  test("different import sets are not trivial", () => {
    const ours = 'import a from "a";\n';
    const theirs = 'import a from "a";\nimport b from "b";\n';
    expect(detectTrivial(ours, theirs)).toBeNull();
  });

  test("real content changes are not trivial", () => {
    expect(detectTrivial("return price * 0.9;", "return price * 0.8;")).toBeNull();
  });
});

// ── markers ─────────────────────────────────────────────────────────────

describe("hasConflictMarkers", () => {
  test("detects all three marker lines", () => {
    expect(hasConflictMarkers("<<<<<<< HEAD\na\n")).toBe(true);
    expect(hasConflictMarkers("a\n=======\nb")).toBe(true);
    expect(hasConflictMarkers("a\n>>>>>>> feature\n")).toBe(true);
  });

  test("clean content and lookalikes pass", () => {
    expect(hasConflictMarkers("const x = 1;\n")).toBe(false);
    expect(hasConflictMarkers(">>>>>> short\n")).toBe(false);
    expect(hasConflictMarkers("a ======= b inline\n")).toBe(false);
  });
});

// ── strict-JSON proposal parse — the no-LLM-evidence invariant ──────────

describe("parseConflictProposal", () => {
  const good = JSON.stringify({
    story: "Both sides touched createUser.",
    proposal: "function createUser() {\n  return userService.create();\n}\n",
    confidence: "high",
    reasoning_points: ["keeps both intents"],
  });

  test("parses a well-formed reply (fences tolerated)", () => {
    const p = parseConflictProposal(`Here you go:\n\`\`\`json\n${good}\n\`\`\``);
    expect(p.story).toContain("createUser");
    expect(p.proposal).toContain("userService.create");
    expect(p.confidence).toBe("high");
    expect(p.reasoningPoints).toEqual(["keeps both intents"]);
  });

  test("REJECTS a model-supplied evidence key — facts are tool-generated only", () => {
    const withEvidence = JSON.parse(good);
    withEvidence.evidence = ["Existing tests cover this behavior"];
    expect(() => parseConflictProposal(JSON.stringify(withEvidence))).toThrow(FormatError);
    expect(() => parseConflictProposal(JSON.stringify(withEvidence))).toThrow(/evidence/);
  });

  test("rejects proposals that still carry conflict markers", () => {
    const marked = JSON.parse(good);
    marked.proposal = "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> f\n";
    expect(() => parseConflictProposal(JSON.stringify(marked))).toThrow(/markers/);
  });

  test("rejects missing story/proposal and garbage", () => {
    expect(() => parseConflictProposal(JSON.stringify({ story: "x" }))).toThrow(FormatError);
    expect(() => parseConflictProposal("no json here")).toThrow(FormatError);
  });

  test("unknown confidence degrades to medium, never crashes", () => {
    const weird = JSON.parse(good);
    weird.confidence = "very-high";
    expect(parseConflictProposal(JSON.stringify(weird)).confidence).toBe("medium");
  });
});

describe("salvageConflictProposal", () => {
  test("recovers a fenced code block with low confidence", () => {
    const p = salvageConflictProposal("Sorry, here is the file:\n```ts\nconst x = 1;\n```");
    expect(p.proposal).toContain("const x = 1;");
    expect(p.confidence).toBe("low");
  });

  test("refuses to salvage markers or plain prose", () => {
    expect(() => salvageConflictProposal("<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> z")).toThrow(FormatError);
    expect(() => salvageConflictProposal("just talking")).toThrow(FormatError);
  });
});

describe("buildConflictPrompt", () => {
  test("carries operation + intent, bans evidence, demands full file", () => {
    const prompt = buildConflictPrompt({
      path: "src/a.ts",
      operation: "merge",
      sourceBranch: "feature/x",
      sourceSummary: "add x",
      base: "base",
      ours: "ours",
      theirs: "theirs",
    });
    expect(prompt).toContain("merge");
    expect(prompt).toContain("feature/x");
    expect(prompt).toContain("add x");
    expect(prompt).toContain("NEVER include an \"evidence\" key");
    expect(prompt).toContain("complete file");
  });
});

// ── audit trailer ───────────────────────────────────────────────────────

describe("buildResolutionAudit", () => {
  test("plain summary + machine footer", () => {
    const msg = buildResolutionAudit("Merge branch 'feature/discount'", [
      { path: "src/pay.ts", label: "AI-proposed", approvedBy: "saint", evidenceCount: 4 },
      { path: "src/user.ts", label: "resolved manually", approvedBy: "saint", evidenceCount: 0 },
    ]);
    expect(msg).toContain("Merge branch 'feature/discount'");
    expect(msg).toContain("Zense AI resolutions:");
    expect(msg).toContain("- src/pay.ts: AI-proposed, approved by saint (evidence: 4 verified facts)");
    expect(msg).toContain("- src/user.ts: resolved manually, approved by saint (evidence: 0 verified facts)");
    expect(msg).toContain(`${ZENSE_RESOLUTION_KEY}: ai`);
    expect(msg).toContain(`${ZENSE_VERSION_KEY}: ${ZENSE_RESOLUTION_VERSION}`);
    expect(msg).toContain(`${ZENSE_RESOLVED_FILES_KEY}: 2`);
  });

  test("no entries → the message untouched (manual merges stay clean)", () => {
    expect(buildResolutionAudit("Merge branch 'x'", [])).toBe("Merge branch 'x'");
  });
});

// ── resolution store state machine ─────────────────────────────────────

describe("conflictResolutionStore", () => {
  beforeEach(() => useConflictResolutionStore.getState().reset());

  const propose = () => {
    useConflictResolutionStore.getState().setProposal("a.ts", {
      story: "story",
      proposal: "merged\n",
      confidence: "high",
      reasoningPoints: [],
      evidence: [{ kind: "marker-free", label: "clean", ok: true }],
      trivial: null,
    });
  };

  test("detected → analyzing → proposed → accepted", () => {
    const s = useConflictResolutionStore.getState();
    s.ensure("a.ts", "content");
    expect(useConflictResolutionStore.getState().records["a.ts"].status).toBe("detected");
    s.beginAnalysis("a.ts");
    expect(useConflictResolutionStore.getState().records["a.ts"].status).toBe("analyzing");
    propose();
    expect(useConflictResolutionStore.getState().records["a.ts"].status).toBe("proposed");
    s.markAccepted("a.ts", "saint");
    const r = useConflictResolutionStore.getState().records["a.ts"];
    expect(r.status).toBe("accepted");
    expect(r.approvedBy).toBe("saint");
  });

  test("the proposal is immutable — human edits live in editDraft", () => {
    const s = useConflictResolutionStore.getState();
    s.ensure("a.ts", "content");
    propose();
    s.setDraft("a.ts", "merged + human tweak\n");
    const r = useConflictResolutionStore.getState().records["a.ts"];
    expect(r.proposal).toBe("merged\n");
    expect(effectiveContent(r)).toBe("merged + human tweak\n");
    s.setDraft("a.ts", null);
    expect(effectiveContent(useConflictResolutionStore.getState().records["a.ts"])).toBe("merged\n");
  });

  test("analyzing never regresses a proposed/accepted record", () => {
    const s = useConflictResolutionStore.getState();
    s.ensure("a.ts", "content");
    propose();
    s.beginAnalysis("a.ts");
    expect(useConflictResolutionStore.getState().records["a.ts"].status).toBe("proposed");
  });

  test("Ask Zense appends Q&A without touching the proposal", () => {
    const s = useConflictResolutionStore.getState();
    s.ensure("a.ts", "content");
    propose();
    s.appendQa("a.ts", { question: "why?", answer: "because" });
    const r = useConflictResolutionStore.getState().records["a.ts"];
    expect(r.qa).toHaveLength(1);
    expect(r.proposal).toBe("merged\n");
  });

  test("review-requested is a terminal decision state", () => {
    const s = useConflictResolutionStore.getState();
    s.ensure("a.ts", "content");
    propose();
    s.markReviewRequested("a.ts");
    expect(useConflictResolutionStore.getState().records["a.ts"].status).toBe("review-requested");
  });
});

// ── wiring (source-text assertions, house pattern) ──────────────────────

describe("git.ts conflict wrappers", () => {
  const src = readSrc("src/lib/git.ts");

  for (const cmd of ["git_resolve_delete", "git_resolve_side"]) {
    test(`wraps ${cmd} (browser-dev safe)`, () => {
      expect(src).toContain(`"${cmd}"`);
      const sections = src.split("export async function git");
      const name = cmd === "git_resolve_delete" ? "ResolveDelete" : "ResolveSide";
      const section = sections.find((x) => x.startsWith(`${name}(`));
      expect(section, `git${name} wrapper missing`).toBeDefined();
      expect(section!).toContain("isTauri()");
    });
  }
});

describe("ResolutionWorkspace component", () => {
  const src = readSrc("src/components/conflicts/ResolutionWorkspace.tsx");

  test("has the content flow + dedicated modify-delete/binary flows", () => {
    expect(src).toContain("ModifyDeleteFlow");
    expect(src).toContain("BinaryFlow");
    expect(src).toContain("ContentFlow");
  });

  test("semantic labels only — ours/theirs jargon never shown", () => {
    expect(src).toContain("Keep modified");
    expect(src).toContain("Keep deleted");
    expect(src).toContain("Keep current");
    expect(src).toContain("Keep incoming");
    expect(src).not.toContain("Accept Current");
    expect(src).not.toContain("Accept Incoming");
  });

  test("separates AI INTERPRETATION from VERIFIED facts", () => {
    expect(src).toContain("AI interpretation");
    expect(src).toContain("Verified — tool-generated facts");
  });

  test("non-merge operations get an honest terminal handoff", () => {
    expect(src).toContain("cannot safely continue");
    expect(src).toContain("integrated terminal");
  });

  test("mounted workspace-wide in App.tsx", () => {
    expect(readSrc("src/App.tsx")).toContain("<ResolutionWorkspace />");
  });
});

describe("launch points + finish", () => {
  test("ReviewPanel opens the workspace and can finish the merge", () => {
    const src = readSrc("src/components/sidebar/ReviewPanel.tsx");
    expect(src).toContain("openResolution(c.path)");
    expect(src).toContain("finishMerge");
    expect(src).toContain("openFile(c.path)"); // raw escape hatch preserved
  });

  test("ConflictBanner surfaces the workspace while conflicts remain", () => {
    const src = readSrc("src/components/layout/ConflictBanner.tsx");
    expect(src).toContain("openResolution");
  });

  test("finishMerge writes the audit into the merge commit", () => {
    const src = readSrc("src/lib/aiConflict.ts");
    expect(src).toContain("buildResolutionAudit");
    expect(src).toContain("gitMergeContinue");
    expect(src).toContain("resolved manually");
  });
});

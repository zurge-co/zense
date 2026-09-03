// @ts-nocheck
/**
 * Tests for the thinking/loading indicator in ChatPanel.tsx — the
 * animated feedback shown while an LLM run is in flight but has not yet
 * produced visible output, so the user can tell the app isn't hung.
 *
 * Follows the structural-verification pattern from App.test.tsx and
 * TitleBar.test.tsx: read source via Bun.file(), verify structure and
 * store interaction without rendering React.
 */
import { describe, test, expect, beforeAll } from "bun:test";

async function readSrc(relFromThisDir: string): Promise<string> {
  return Bun.file(`${import.meta.dir}/${relFromThisDir}`).text();
}

// ═══════════════════════════════════════════════════════════════════════════
// ChatPanel.tsx — thinking/loading indicator
// ═══════════════════════════════════════════════════════════════════════════

describe("ChatPanel.tsx — thinking indicator", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("./ChatPanel.tsx");
  });

  // ── Indicator component ─────────────────────────────────────────────────

  test("defines a ThinkingIndicator component", () => {
    expect(src).toContain("function ThinkingIndicator");
  });

  test("indicator is animated (proves the app isn't hung)", () => {
    // Tailwind animate-bounce dots with staggered delays.
    expect(src).toContain("animate-bounce");
    expect(src).toContain("animationDelay");
  });

  test("indicator shows an elapsed-seconds timer that ticks every second", () => {
    expect(src).toContain("setInterval");
    // Elapsed time derived from a start timestamp, floored to seconds.
    expect(src).toMatch(/Math\.floor\(/);
    expect(src).toContain("elapsed");
  });

  test("indicator cleans up its interval on unmount", () => {
    expect(src).toContain("clearInterval");
  });

  test("indicator is labelled 'Thinking…'", () => {
    expect(src).toContain("Thinking…");
  });

  // ── Render condition ────────────────────────────────────────────────────

  test("renders only while streaming with no streamed text and no active tool calls", () => {
    expect(src).toMatch(
      /streaming && !streamingText && activeTools\.length === 0 && <ThinkingIndicator/
    );
  });

  test("indicator appears in the messages scroll area (after streaming text block)", () => {
    const streamBlock = src.indexOf("Streaming text");
    const indicatorBlock = src.indexOf("<ThinkingIndicator />");
    expect(streamBlock).toBeGreaterThan(-1);
    expect(indicatorBlock).toBeGreaterThan(-1);
    expect(indicatorBlock).toBeGreaterThan(streamBlock);
  });

  test("existing streaming-text bubble condition is untouched", () => {
    expect(src).toContain("streaming && streamingText &&");
  });

  // ── Stop button preserved (spec constraint) ─────────────────────────────

  test("Stop button (Square icon) during streaming is preserved", () => {
    expect(src).toContain("Stop generating");
    expect(src).toContain("Square");
    expect(src).toContain("onClick={stop}");
  });

  // ── Tab-header spinner while streaming ──────────────────────────────────

  test("Chat tab shows a spinning loader while streaming", () => {
    expect(src).toContain('id === "chat" && streaming');
    expect(src).toContain("animate-spin");
    expect(src).toContain("Loader2");
  });

  // ── No store changes (pure presentation fix per spec) ───────────────────

  test("does not introduce new chatStore state selectors beyond existing ones", () => {
    // thinkingSince (or any new store field) must not be consumed here —
    // the spec restricts changes to presentation only.
    expect(src).not.toContain("thinkingSince");
  });

  test("no new dependencies — only react, lucide-react, and existing local modules are imported", () => {
    const importLines = src.match(/^import .* from "(.*)";$/gm) ?? [];
    for (const line of importLines) {
      const m = line.match(/from "(.*)"/);
      expect(m).not.toBe(null);
      const pkg = m![1];
      const allowed =
        pkg === "react" ||
        pkg === "lucide-react" ||
        pkg.startsWith(".");
      expect(allowed).toBe(true);
    }
  });
});

// @ts-nocheck
/**
 * ErrorBoundary tests — structural verification, following the repo's
 * established pattern (read source text via Bun.file(), no DOM rendering
 * infra in this project). Covers spec v3: a root error boundary that keeps
 * the app recoverable (and closable) when a component crashes.
 */
const { describe, test, expect } = await import("bun:test");

/** Read a source file as text using Bun's file API (not Node.js fs). */
async function readSrc(relFromThisDir: string): Promise<string> {
  return Bun.file(`${import.meta.dir}/${relFromThisDir}`).text();
}

describe("ErrorBoundary.tsx — structural verification", () => {
  test("is a class component with the error-catching lifecycle hooks", async () => {
    const src = await readSrc("./ErrorBoundary.tsx");
    expect(src.includes("extends Component")).toBe(true);
    expect(src.includes("static getDerivedStateFromError")).toBe(true);
    expect(src.includes("componentDidCatch")).toBe(true);
    expect(src.includes("console.error")).toBe(true);
  });

  test("renders children when there is no error", async () => {
    const src = await readSrc("./ErrorBoundary.tsx");
    expect(src.includes("if (!error) return this.props.children")).toBe(true);
  });

  test("recovery UI offers reload / retry / copy error", async () => {
    const src = await readSrc("./ErrorBoundary.tsx");
    expect(src.includes("location.reload()")).toBe(true);
    expect(src.includes("onRetry")).toBe(true);
    expect(src.includes('this.setState({ error: null })')).toBe(true);
    expect(src.includes("writeClipboardText")).toBe(true);
  });

  test("shows the error message and a details (stack) toggle", async () => {
    const src = await readSrc("./ErrorBoundary.tsx");
    expect(src.includes("error.message")).toBe(true);
    expect(src.includes("error.stack")).toBe(true);
    expect(src.includes("Show details")).toBe(true);
  });
});

describe("App.tsx — boundary placement", () => {
  test("mounts ErrorBoundary around screen content", async () => {
    const src = await readSrc("../App.tsx");
    expect(src.includes("<ErrorBoundary>")).toBe(true);
    expect(src.includes('"./components/ErrorBoundary"')).toBe(true);
  });

  test("close guard and conflict dialog stay OUTSIDE the boundary", async () => {
    const src = await readSrc("../App.tsx");
    const boundaryEnd = src.indexOf("</ErrorBoundary>");
    const closeGuardAt = src.indexOf("{closeGuardDialog}");
    const conflictAt = src.indexOf("<ConflictSaveDialog />");
    // Mounted after the boundary closes → they survive a content crash.
    expect(boundaryEnd).toBeGreaterThan(-1);
    expect(closeGuardAt).toBeGreaterThan(boundaryEnd);
    expect(conflictAt).toBeGreaterThan(boundaryEnd);
  });
});

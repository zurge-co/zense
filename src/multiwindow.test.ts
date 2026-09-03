// @ts-nocheck
/**
 * Multi-project windowing (File > New Window) — structural tests.
 *
 * Verifies the Rust-side window management in src-tauri/src/lib.rs and the
 * frontend window-title hook in App.tsx, following the repo's existing
 * structural-verification pattern (read source text via Bun.file()).
 */
import { describe, test, expect, beforeAll } from "bun:test";

const ROOT = `${import.meta.dir}/..`;

describe("multi-window: new window creation", () => {
  let libRs: string;

  beforeAll(async () => {
    libRs = await Bun.file(`${ROOT}/src-tauri/src/lib.rs`).text();
  });

  test("menu has New Window with ⌘⇧N", () => {
    expect(libRs).toContain('"new_window"');
    expect(libRs).toContain("New Window");
    expect(libRs).toContain("CmdOrCtrl+Shift+N");
  });

  test("new window label is the first unused label, not a window count", () => {
    // Counting open windows breaks after closing a middle window
    // (window-2 + window-3 open, close 2 → len 2 → "window-3" collides).
    expect(libRs.includes("webview_windows().len()")).toBe(false);
    expect(libRs).toContain("get_webview_window(&candidate).is_none()");
  });

  test("new windows get the same chrome as the main window", () => {
    expect(libRs).toContain("WebviewWindowBuilder::new(app, &label");
    expect(libRs).toContain("title_bar_style(tauri::TitleBarStyle::Overlay)");
  });
});

describe("multi-window: menu actions route to the focused window only", () => {
  let libRs: string;

  beforeAll(async () => {
    libRs = await Bun.file(`${ROOT}/src-tauri/src/lib.rs`).text();
  });

  test("menu-action is NOT broadcast to every window", () => {
    expect(libRs.includes('app.emit("menu-action"')).toBe(false);
  });

  test("focused window is tracked via WindowEvent::Focused", () => {
    expect(libRs).toContain("WindowEvent::Focused(true)");
    expect(libRs).toContain("FocusedWindow");
  });

  test("menu-action is emitted to a single (focused) window", () => {
    expect(libRs).toContain('w.emit("menu-action", other)');
  });

  test("close-requested still goes to the requesting window only", () => {
    expect(libRs).toContain('window.emit("app://close-requested", ())');
  });
});

describe("multi-window: native title reflects the per-window project", () => {
  let app: string;

  beforeAll(async () => {
    app = await Bun.file(`${ROOT}/src/App.tsx`).text();
  });

  test("App.tsx updates the native window title from workspaceName", () => {
    expect(app).toContain("useWindowTitle");
    expect(app).toContain("setTitle");
    expect(app).toContain("workspaceName");
  });
});

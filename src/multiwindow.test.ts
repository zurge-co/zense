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
    // Emitter::emit broadcasts to every window — must use emit_to(label).
    expect(libRs).toContain('w.emit_to(w.label(), "menu-action", other)');
  });

  test("close-requested still goes to the requesting window only", () => {
    // A broadcast here makes closing one window close them all.
    expect(libRs).toContain('window.emit_to(window.label(), "app://close-requested", ())');
  });
});

describe("multi-window: frontend listeners are window-scoped", () => {
  let app: string;

  beforeAll(async () => {
    app = await Bun.file(`${ROOT}/src/App.tsx`).text();
  });

  // Global listen() registers target=Any, and Tauri delivers emit_to-scoped
  // events to every webview's Any listeners (tauri event/listener.rs
  // match_any_or_filter) — so these MUST go through getCurrentWindow().listen,
  // otherwise closing one window destroys them all / menu actions fire in
  // every window.
  test("close-requested is listened on the current window only", () => {
    expect(app).toContain('getCurrentWindow().listen("app://close-requested"');
    // No bare (unscoped/global) listen for this event may remain.
    const every = app.split('listen("app://close-requested"').length - 1;
    const scoped = app.split('getCurrentWindow().listen("app://close-requested"').length - 1;
    expect(every).toBe(scoped);
  });

  test("menu-action is listened on the current window only", () => {
    expect(app).toContain('getCurrentWindow().listen<string>("menu-action"');
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

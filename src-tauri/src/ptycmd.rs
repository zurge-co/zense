//! Pseudo-terminal commands: multiple concurrent shell sessions per window
//! (see ADR-006), streamed to the frontend terminal (xterm.js) via Tauri
//! events. Each `pty_spawn` returns a session id; every command and event is
//! keyed by it, so tabs can run independent shells at once.
//!
//! Events emitted (payloads carry the session id — `OutEvent` / `ExitEvent`):
//! - `pty://output`  payload: `{ id, data }` (UTF-8 chunk of child output)
//! - `pty://exit`    payload: `{ id, code }` (exit code, -1 when killed)
//!
//! Output is coalesced in an emitter thread (see FLUSH_IDLE / FLUSH_CAP) so a
//! TUI that redraws whole screens per frame (pi, vim, htop) produces a handful
//! of large events instead of one Tauri event per raw read — otherwise the
//! webview event loop floods and xterm falls behind the live frame, which
//! makes the terminal look frozen mid-redraw and keystrokes appear to do
//! nothing. UTF-8 is never split across events (see flush_pending).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, TryRecvError};
use std::sync::Mutex;
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

pub const EVT_OUTPUT: &str = "pty://output";
pub const EVT_EXIT: &str = "pty://exit";

/// Payload of `pty://output` — the session id routes the chunk to the right
/// frontend tab.
#[derive(Serialize, Clone)]
pub struct OutEvent {
  pub id: String,
  pub data: String,
}

/// Payload of `pty://exit` — emitted exactly once per session, after its
/// final output is flushed.
#[derive(Serialize, Clone)]
pub struct ExitEvent {
  pub id: String,
  pub code: i32,
}

/// Accumulate PTY bytes this long before flushing an event while output is
/// idle-ish. TUI apps redraw whole screens per frame — one Tauri event per
/// raw read floods the webview event loop and xterm falls behind the live
/// frame (the terminal looks frozen mid-redraw). ~8ms keeps interactive echo
/// snappy while batching a redraw burst into few events.
const FLUSH_IDLE: Duration = Duration::from_millis(8);
/// Force a flush once this many bytes are buffered (≈ one large TUI frame).
const FLUSH_CAP: usize = 32 * 1024;

struct PtyHandles {
  child: Box<dyn Child + Send + Sync>,
  master: Box<dyn MasterPty + Send>,
  writer: Box<dyn Write + Send>,
}

/// All live PTY sessions, keyed by the session id `pty_spawn` returns.
#[derive(Default)]
pub struct PtyManager(Mutex<HashMap<String, PtyHandles>>);

impl PtyManager {
  /// Kill one session and drop its handles (no-op when the id is gone).
  fn kill_inner(guard: &mut HashMap<String, PtyHandles>, id: &str) {
    if let Some(mut h) = guard.remove(id) {
      h.child.kill().ok();
    }
  }

  /// Kill every live session (workspace switch / app teardown).
  fn kill_all_inner(guard: &mut HashMap<String, PtyHandles>) {
    for (_, mut h) in guard.drain() {
      h.child.kill().ok();
    }
  }
}

/// Default interactive shell for the current platform.
fn shell_command(cwd: &str) -> CommandBuilder {
  #[cfg(windows)]
  {
    let mut c = CommandBuilder::new("powershell.exe");
    c.cwd(cwd);
    c
  }
  #[cfg(not(windows))]
  {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut c = CommandBuilder::new(shell);
    c.arg("-l"); // login shell: pick up the user's PATH/profile
    c.cwd(cwd);
    c
  }
}

/// Spawn a new PTY session rooted at `cwd` (absolute path) and return its
/// session id. Output is streamed as coalesced `pty://output` events (see
/// `coalesce_and_emit`) keyed by that id.
#[tauri::command]
pub fn pty_spawn(
  app: AppHandle,
  mgr: State<'_, PtyManager>,
  cwd: String,
  cols: u16,
  rows: u16,
) -> Result<String, String> {
  let pair = native_pty_system()
    .openpty(PtySize {
      rows: rows.max(1),
      cols: cols.max(1),
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|e| format!("openpty: {e}"))?;

  let child = pair
    .slave
    .spawn_command(shell_command(&cwd))
    .map_err(|e| format!("spawn shell: {e}"))?;
  drop(pair.slave); // master-only from here; keeps EOF/child-exit detection working

  let mut reader = pair
    .master
    .try_clone_reader()
    .map_err(|e| format!("clone reader: {e}"))?;
  let writer = pair.master.take_writer().map_err(|e| format!("take writer: {e}"))?;

  // Unique session id (monotonic + wall clock: short, non-reusable, no
  // shared state needed).
  static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
  let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
  let id = format!(
    "pty-{}-{}",
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_millis())
      .unwrap_or(0),
    n
  );

  {
    let mut guard = mgr.0.lock().map_err(|e| e.to_string())?;
    guard.insert(
      id.clone(),
      PtyHandles {
        child,
        master: pair.master,
        writer,
      },
    );
  }

  // Reader thread: forward raw bytes until EOF. It only shuttles bytes into a
  // channel — coalescing/UTF-8 framing happens in the emitter thread so a
  // burst of small reads still becomes few large events.
  let (tx, rx) = channel::<Vec<u8>>();
  std::thread::spawn(move || {
    let mut buf = [0u8; 8192];
    loop {
      match reader.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => {
          if tx.send(buf[..n].to_vec()).is_err() {
            return; // emitter gone — stop reading
          }
        }
        Err(_) => break,
      }
    }
    // tx dropped here → emitter sees the disconnect as EOF.
  });

  // Emitter thread: coalesce chunks into as few `pty://output` events as
  // possible — flush after an idle window or at FLUSH_CAP — and report the
  // session exit exactly once after the final flush.
  let emit_id = id.clone();
  std::thread::spawn(move || coalesce_and_emit(app, emit_id, rx));

  Ok(id)
}

/// Emit `pending` as one event, keeping any incomplete trailing UTF-8
/// sequence for the next round (a multi-byte char — Thai vowel, box-drawing
/// glyph — split across reads must never become U+FFFD mid-frame, or the TUI's
/// differential redraw stops matching what the user sees). With `final_flush`
/// (EOF) the tail is completed lossily so nothing is dropped. Returns false
/// when the frontend is gone and the loop must stop.
fn flush_pending(app: &AppHandle, id: &str, pending: &mut Vec<u8>, final_flush: bool) -> bool {
  if pending.is_empty() {
    return true;
  }
  // Longest valid-UTF-8 prefix, and whether the trailing error is just an
  // incomplete sequence (i.e. a codepoint straddling the chunk boundary).
  let (valid_up_to, incomplete) = match std::str::from_utf8(pending) {
    Ok(_) => (pending.len(), false),
    Err(e) => (e.valid_up_to(), e.error_len().is_none()),
  };
  let emit_len = if final_flush {
    // EOF: flush everything, completing any partial tail lossily.
    pending.len()
  } else if valid_up_to > 0 {
    // Emit the valid prefix; keep the (possibly incomplete) tail for next time.
    valid_up_to
  } else if incomplete {
    // Whole buffer is the start of a partial codepoint (≤3 bytes so far) —
    // wait for the rest. A UTF-8 sequence is ≤4 bytes, so this can't stall.
    return true;
  } else {
    // Genuine invalid lead byte at the head: drop it lossily to make progress
    // (otherwise the loop would spin on the same bad byte forever).
    1
  };
  let chunk: String = if final_flush {
    String::from_utf8_lossy(&pending[..]).into_owned()
  } else if emit_len <= valid_up_to {
    // Valid prefix — from_utf8 cannot fail here.
    String::from_utf8(pending[..emit_len].to_vec()).unwrap_or_default()
  } else {
    // Invalid-byte drop — lossy so it becomes U+FFFD rather than panicking.
    String::from_utf8_lossy(&pending[..emit_len]).into_owned()
  };
  pending.drain(..emit_len);
  if chunk.is_empty() {
    return true;
  }
  app.emit(EVT_OUTPUT, OutEvent { id: id.into(), data: chunk }).is_ok()
}

/// Coalescing loop for one PTY session (see FLUSH_IDLE / FLUSH_CAP). Emits
/// `pty://exit` exactly once after the last buffered bytes are flushed.
fn coalesce_and_emit(app: AppHandle, id: String, rx: Receiver<Vec<u8>>) {
  let mut pending: Vec<u8> = Vec::with_capacity(FLUSH_CAP);
  let mut alive = true;
  while alive {
    match rx.recv_timeout(FLUSH_IDLE) {
      Ok(chunk) => {
        pending.extend_from_slice(&chunk);
        // Drain whatever the reader already queued before deciding to flush,
        // so a burst of small reads becomes one event up to FLUSH_CAP.
        loop {
          match rx.try_recv() {
            Ok(c) => pending.extend_from_slice(&c),
            Err(TryRecvError::Empty) => break,
            Err(TryRecvError::Disconnected) => {
              alive = false;
              break;
            }
          }
          if pending.len() >= FLUSH_CAP {
            break;
          }
        }
        if pending.len() >= FLUSH_CAP && !flush_pending(&app, &id, &mut pending, false) {
          alive = false;
        }
      }
      Err(RecvTimeoutError::Timeout) => {
        if !flush_pending(&app, &id, &mut pending, false) {
          alive = false;
        }
      }
      Err(RecvTimeoutError::Disconnected) => alive = false,
    }
  }
  // Session is over once the master reader hits EOF: flush the remainder
  // (lossy tail allowed) before reporting the exit, exactly once.
  flush_pending(&app, &id, &mut pending, true);
  app.emit(EVT_EXIT, ExitEvent { id, code: 0 }).ok();
}

/// Write user input (as produced by xterm `onData`) into the session's PTY.
#[tauri::command]
pub fn pty_write(mgr: State<'_, PtyManager>, id: String, data: String) -> Result<(), String> {
  let mut guard = mgr.0.lock().map_err(|e| e.to_string())?;
  let h = guard.get_mut(&id).ok_or("no such pty session")?;
  h.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
  h.writer.flush().map_err(|e| e.to_string())
}

/// Notify the session's PTY of a terminal resize (xterm fit).
#[tauri::command]
pub fn pty_resize(
  mgr: State<'_, PtyManager>,
  id: String,
  cols: u16,
  rows: u16,
) -> Result<(), String> {
  let guard = mgr.0.lock().map_err(|e| e.to_string())?;
  let h = guard.get(&id).ok_or("no such pty session")?;
  h.master
    .resize(PtySize {
      rows: rows.max(1),
      cols: cols.max(1),
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|e| e.to_string())
}

/// Kill one session by id (tab close / restart). Idempotent — restarting a
/// shell whose old session already exited must not error.
#[tauri::command]
pub fn pty_kill(mgr: State<'_, PtyManager>, id: String) -> Result<(), String> {
  let mut guard = mgr.0.lock().map_err(|e| e.to_string())?;
  PtyManager::kill_inner(&mut guard, &id);
  Ok(())
}

/// Kill every live session (workspace switch / panel unmount / app teardown).
#[tauri::command]
pub fn pty_kill_all(mgr: State<'_, PtyManager>) -> Result<(), String> {
  let mut guard = mgr.0.lock().map_err(|e| e.to_string())?;
  PtyManager::kill_all_inner(&mut guard);
  Ok(())
}

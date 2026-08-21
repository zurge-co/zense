//! Pseudo-terminal commands: one interactive shell session per window,
//! streamed to the frontend terminal (xterm.js) via Tauri events.
//!
//! Events emitted:
//! - `pty://output`  payload: String (UTF-8 lossy chunk of child output)
//! - `pty://exit`    payload: i32 exit code (or -1 when killed)

use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};

pub const EVT_OUTPUT: &str = "pty://output";
pub const EVT_EXIT: &str = "pty://exit";

struct PtyHandles {
  child: Box<dyn Child + Send + Sync>,
  master: Box<dyn MasterPty + Send>,
  writer: Box<dyn Write + Send>,
}

#[derive(Default)]
pub struct PtyManager(Mutex<Option<PtyHandles>>);

impl PtyManager {
  /// Kill an active session (if any) and drop its handles.
  fn kill_inner(guard: &mut Option<PtyHandles>) {
    if let Some(mut h) = guard.take() {
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

/// Spawn a new PTY session rooted at `cwd` (absolute path). Kills any
/// existing session first. Output is streamed as `pty://output` events.
#[tauri::command]
pub fn pty_spawn(
  app: AppHandle,
  mgr: State<'_, PtyManager>,
  cwd: String,
  cols: u16,
  rows: u16,
) -> Result<(), String> {
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

  {
    let mut guard = mgr.0.lock().map_err(|e| e.to_string())?;
    PtyManager::kill_inner(&mut guard);
    *guard = Some(PtyHandles {
      child,
      master: pair.master,
      writer,
    });
  }

  // Reader thread: forward raw bytes until EOF, then report exit.
  std::thread::spawn(move || {
    let mut buf = [0u8; 8192];
    loop {
      match reader.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => {
          let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
          if app.emit(EVT_OUTPUT, chunk).is_err() {
            break;
          }
        }
        Err(_) => break,
      }
    }
    // Session is over once the master reader hits EOF.
    app.emit(EVT_EXIT, 0).ok();
  });

  Ok(())
}

/// Write user input (as produced by xterm `onData`) into the PTY.
#[tauri::command]
pub fn pty_write(mgr: State<'_, PtyManager>, data: String) -> Result<(), String> {
  let mut guard = mgr.0.lock().map_err(|e| e.to_string())?;
  let h = guard.as_mut().ok_or("no active pty session")?;
  h.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
  h.writer.flush().map_err(|e| e.to_string())
}

/// Notify the PTY of a terminal resize (xterm fit).
#[tauri::command]
pub fn pty_resize(mgr: State<'_, PtyManager>, cols: u16, rows: u16) -> Result<(), String> {
  let guard = mgr.0.lock().map_err(|e| e.to_string())?;
  let h = guard.as_ref().ok_or("no active pty session")?;
  h.master
    .resize(PtySize {
      rows: rows.max(1),
      cols: cols.max(1),
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|e| e.to_string())
}

/// Kill the active session (if any). Emitted by panel close / workspace switch.
#[tauri::command]
pub fn pty_kill(mgr: State<'_, PtyManager>) -> Result<(), String> {
  let mut guard = mgr.0.lock().map_err(|e| e.to_string())?;
  PtyManager::kill_inner(&mut guard);
  Ok(())
}

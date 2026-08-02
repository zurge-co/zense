//! PTY sessions for the integrated terminal.
//!
//! Each session owns a pseudo-terminal spawned via `portable-pty`. A reader
//! thread streams raw output bytes to the frontend over a Tauri `Channel`,
//! and emits `pty-exit:{id}` when the child process terminates.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct PtySession {
  writer: Box<dyn Write + Send>,
  master: Box<dyn MasterPty + Send>,
  child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState(pub Mutex<HashMap<String, PtySession>>);

fn login_shell() -> String {
  std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

/// Spawn a new PTY session.
///
/// `command` = `None` starts an interactive login shell (`$SHELL -l`).
/// `Some(cmd)` runs the command through a login shell (`$SHELL -lc "exec cmd"`)
/// so PATH and profile env are available (agent CLIs like `claude`, `aider`, …).
#[tauri::command]
pub fn pty_spawn(
  id: String,
  cwd: Option<String>,
  command: Option<String>,
  cols: u16,
  rows: u16,
  on_output: Channel<Vec<u8>>,
  state: State<'_, PtyState>,
  app: AppHandle,
) -> Result<(), String> {
  let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
  if sessions.contains_key(&id) {
    return Err(format!("pty session '{id}' already exists"));
  }

  let pair = native_pty_system()
    .openpty(PtySize {
      rows: rows.max(1),
      cols: cols.max(1),
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|e| e.to_string())?;

  let mut cmd = match &command {
    Some(c) => {
      let mut b = CommandBuilder::new(login_shell());
      b.args(["-lc", &format!("exec {c}")]);
      b
    }
    None => {
      let mut b = CommandBuilder::new(login_shell());
      b.arg("-l");
      b
    }
  };
  if let Some(dir) = &cwd {
    cmd.cwd(dir);
  }

  let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
  let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
  let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

  sessions.insert(
    id.clone(),
    PtySession {
      writer,
      master: pair.master,
      child,
    },
  );
  drop(sessions);

  // Reader thread: forward PTY output, then clean up on child exit.
  let exit_id = id.clone();
  std::thread::spawn(move || {
    let mut buf = [0u8; 8192];
    loop {
      match reader.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => {
          if on_output.send(buf[..n].to_vec()).is_err() {
            break; // frontend went away
          }
        }
        Err(_) => break,
      }
    }
    // Reap the child and drop the session.
    if let Some(mut s) = app.state::<PtyState>().0.lock().ok() {
      if let Some(mut session) = s.remove(&exit_id) {
        let _ = session.child.wait();
      }
    }
    let _ = app.emit(&format!("pty-exit:{exit_id}"), ());
  });

  Ok(())
}

#[tauri::command]
pub fn pty_write(id: String, data: String, state: State<'_, PtyState>) -> Result<(), String> {
  let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
  let session = sessions
    .get_mut(&id)
    .ok_or_else(|| format!("pty session '{id}' not found"))?;
  session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
  session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
  id: String,
  cols: u16,
  rows: u16,
  state: State<'_, PtyState>,
) -> Result<(), String> {
  let sessions = state.0.lock().map_err(|e| e.to_string())?;
  let session = sessions
    .get(&id)
    .ok_or_else(|| format!("pty session '{id}' not found"))?;
  session
    .master
    .resize(PtySize {
      rows: rows.max(1),
      cols: cols.max(1),
      pixel_width: 0,
      pixel_height: 0,
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(id: String, state: State<'_, PtyState>) -> Result<(), String> {
  let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
  if let Some(session) = sessions.get_mut(&id) {
    let _ = session.child.kill();
    // The reader thread sees EOF and removes + reaps the session.
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Write as _;
  use std::time::{Duration, Instant};

  /// Roundtrip: spawn `cat` in a PTY, write a line, expect it echoed back.
  #[test]
  fn echo_roundtrip() {
    let pair = native_pty_system()
      .openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
      })
      .unwrap();
    let mut child = pair
      .slave
      .spawn_command(CommandBuilder::new("cat"))
      .unwrap();
    let mut writer = pair.master.take_writer().unwrap();
    let mut reader = pair.master.try_clone_reader().unwrap();

    writer.write_all(b"hello-zense\n").unwrap();
    writer.flush().unwrap();

    let deadline = Instant::now() + Duration::from_secs(5);
    let mut out = Vec::new();
    let mut buf = [0u8; 1024];
    while Instant::now() < deadline {
      match reader.read(&mut buf) {
        Ok(n) if n > 0 => {
          out.extend_from_slice(&buf[..n]);
          if String::from_utf8_lossy(&out).contains("hello-zense") {
            break;
          }
        }
        _ => std::thread::sleep(Duration::from_millis(10)),
      }
    }
    let _ = child.kill();
    let _ = child.wait();
    assert!(
      String::from_utf8_lossy(&out).contains("hello-zense"),
      "expected echo, got: {:?}",
      String::from_utf8_lossy(&out)
    );
  }
}

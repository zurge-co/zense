//! Workspace file watcher: one `notify` watcher per window, so external
//! changes (git checkout/pull, edits in other apps) are pushed to the UI
//! as `fs://changed` events. Paths are workspace-relative, deduped, and
//! batched with a short debounce so bulk operations (checkouts, codegen)
//! arrive as one event instead of hundreds.

use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State, Window};

pub const EVT_FS_CHANGED: &str = "fs://changed";

/// Directory segments never reported to the UI.
const IGNORED_DIRS: [&str; 6] = [".git", "node_modules", "target", ".swarm", ".pi", "dist"];

/// Debounce window for batching raw OS events into one `fs://changed`.
const DEBOUNCE: Duration = Duration::from_millis(300);

struct WatchEntry {
  _watcher: RecommendedWatcher, // kept alive for the lifetime of the entry
}

#[derive(Default)]
pub struct WatchManager(Mutex<HashMap<String, WatchEntry>>);

/// True when any path segment is an ignored directory.
fn is_ignored(rel: &str) -> bool {
  rel.split('/').any(|seg| IGNORED_DIRS.contains(&seg))
}

/// Start (or restart) watching `root` for this window. Emits
/// `fs://changed` with a payload of workspace-relative changed paths.
#[tauri::command]
pub fn watch_workspace(
  app: AppHandle,
  window: Window,
  mgr: State<'_, WatchManager>,
  root: String,
) -> Result<(), String> {
  let label = window.label().to_string();
  let root_path = Path::new(&root).to_path_buf();
  if !root_path.is_dir() {
    return Err(format!("workspace root is not a directory: {root}"));
  }

  let (tx, rx) = channel::<Vec<String>>();
  let root_for_events = root.clone();
  let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
    let Ok(event) = res else { return };
    let paths: Vec<String> = event
      .paths
      .iter()
      .filter_map(|p| {
        let rel = p.strip_prefix(&root_for_events).ok()?;
        let rel = rel.to_string_lossy().replace('\\', "/");
        if rel.is_empty() || is_ignored(&rel) {
          None
        } else {
          Some(rel)
        }
      })
      .collect();
    if !paths.is_empty() {
      tx.send(paths).ok();
    }
  })
  .map_err(|e| format!("create watcher: {e}"))?;

  watcher
    .watch(&root_path, RecursiveMode::Recursive)
    .map_err(|e| format!("watch workspace: {e}"))?;

  {
    let mut guard = mgr.0.lock().map_err(|e| e.to_string())?;
    guard.insert(label.clone(), WatchEntry { _watcher: watcher });
  }

  // Debounce thread: batch raw batches into a deduped path list per window.
  std::thread::spawn(move || {
    let mut pending: Vec<String> = Vec::new();
    loop {
      match rx.recv_timeout(DEBOUNCE) {
        Ok(batch) => pending.extend(batch),
        Err(RecvTimeoutError::Timeout) => {
          if pending.is_empty() {
            continue;
          }
          pending.sort();
          pending.dedup();
          let payload = std::mem::take(&mut pending);
          // A closed window fails emit; stop the thread (entry is dropped
          // by stop_watch / app teardown).
          if app.emit_to(&label, EVT_FS_CHANGED, payload).is_err() {
            break;
          }
        }
        Err(RecvTimeoutError::Disconnected) => break,
      }
    }
  });

  Ok(())
}

/// Stop watching for this window (workspace switch / window teardown).
#[tauri::command]
pub fn stop_watch(window: Window, mgr: State<'_, WatchManager>) -> Result<(), String> {
  let mut guard = mgr.0.lock().map_err(|e| e.to_string())?;
  guard.remove(window.label());
  Ok(())
}

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

/// Git metadata changed (checkout/commit/pull/rebase) — the frontend
/// refreshes branch info, status and history on this event.
pub const EVT_GIT_CHANGED: &str = "git://changed";

/// Directory segments never reported to the UI via `fs://changed`. `.git`
/// stays ignored there; git metadata goes out on `git://changed` instead.
const IGNORED_DIRS: [&str; 6] = [".git", "node_modules", "target", ".swarm", ".pi", "dist"];

/// Debounce window for batching raw OS events into one `fs://changed` /
/// `git://changed`.
const DEBOUNCE: Duration = Duration::from_millis(300);

struct WatchEntry {
  _watcher: RecommendedWatcher,
  /// Second, narrower watcher on `.git` — None for non-git workspaces and
  /// gitfile-based worktrees/submodules (a `.git` FILE, kept alive when Some).
  _git_watcher: Option<RecommendedWatcher>,
}

/// The `.git` directory to watch for this root, if any. Plain repos have a
/// `.git` directory; linked worktrees and submodules have a `.git` *file*
/// (a gitdir pointer), which we deliberately do NOT follow — watching the
/// real gitdir would leak events from other worktrees sharing it.
fn git_dir_to_watch(root: &Path) -> Option<std::path::PathBuf> {
  let d = root.join(".git");
  d.is_dir().then_some(d)
}

/// A batched change from one of the two watchers feeding a window.
enum Batch {
  /// Workspace files — emitted as `fs://changed`.
  Fs(Vec<String>),
  /// Paths under `.git` — emitted as `git://changed`.
  Git(Vec<String>),
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

  let (tx, rx) = channel::<Batch>();
  let root_for_events = root.clone();
  let tx_fs = tx.clone();
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
      tx_fs.send(Batch::Fs(paths)).ok();
    }
  })
  .map_err(|e| format!("create watcher: {e}"))?;

  watcher
    .watch(&root_path, RecursiveMode::Recursive)
    .map_err(|e| format!("watch workspace: {e}"))?;

  // Second watcher: git metadata only. The main watcher ignores `.git`, so
  // an external/terminal `git checkout`, commit, pull or rebase otherwise
  // never reaches the UI and the branch label goes stale. Missing `.git`
  // (non-git workspace) and gitfile-based worktrees are skipped silently.
  let git_watcher = match git_dir_to_watch(&root_path) {
    Some(git_dir) => {
      let git_root = git_dir.clone();
      let tx_git = tx.clone();
      let mut gw = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let paths: Vec<String> = event
          .paths
          .iter()
          .filter_map(|p| p.strip_prefix(&git_root).ok())
          .map(|rel| rel.to_string_lossy().replace('\\', "/"))
          .filter(|rel| !rel.is_empty())
          .collect();
        if !paths.is_empty() {
          tx_git.send(Batch::Git(paths)).ok();
        }
      })
      .map_err(|e| format!("create git watcher: {e}"))?;
      gw.watch(&git_dir, RecursiveMode::Recursive)
        .map_err(|e| format!("watch .git: {e}"))?;
      Some(gw)
    }
    None => None,
  };

  {
    let mut guard = mgr.0.lock().map_err(|e| e.to_string())?;
    guard.insert(
      label.clone(),
      WatchEntry {
        _watcher: watcher,
        _git_watcher: git_watcher,
      },
    );
  }

  // Debounce thread: batch raw batches into a deduped path list per window,
  // one pending list per event channel.
  std::thread::spawn(move || {
    let mut pending_fs: Vec<String> = Vec::new();
    let mut pending_git: Vec<String> = Vec::new();
    loop {
      match rx.recv_timeout(DEBOUNCE) {
        Ok(batch) => match batch {
          Batch::Fs(paths) => pending_fs.extend(paths),
          Batch::Git(paths) => pending_git.extend(paths),
        },
        Err(RecvTimeoutError::Timeout) => {
          // A closed window fails emit; stop the thread (entries are dropped
          // by stop_watch / app teardown).
          if !pending_fs.is_empty() {
            pending_fs.sort();
            pending_fs.dedup();
            let payload = std::mem::take(&mut pending_fs);
            if app.emit_to(&label, EVT_FS_CHANGED, payload).is_err() {
              break;
            }
          }
          if !pending_git.is_empty() {
            pending_git.sort();
            pending_git.dedup();
            let payload = std::mem::take(&mut pending_git);
            if app.emit_to(&label, EVT_GIT_CHANGED, payload).is_err() {
              break;
            }
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

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  /// Unique temp root per test (no tempfile dep in this crate).
  fn temp_root(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
      "zense-watcher-test-{name}-{}-{}",
      std::process::id(),
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn git_dir_watched_when_git_is_a_directory() {
    let root = temp_root("gitdir");
    fs::create_dir_all(root.join(".git")).unwrap();
    assert_eq!(git_dir_to_watch(&root), Some(root.join(".git")));
    fs::remove_dir_all(&root).ok();
  }

  #[test]
  fn git_dir_skipped_when_git_is_a_gitfile() {
    // Linked worktrees / submodules: .git is a file ("gitdir: ...").
    // Following it would leak events from other worktrees — skip silently.
    let root = temp_root("gitfile");
    fs::write(root.join(".git"), "gitdir: /elsewhere/real/.git").unwrap();
    assert_eq!(git_dir_to_watch(&root), None);
    fs::remove_dir_all(&root).ok();
  }

  #[test]
  fn git_dir_skipped_when_absent() {
    let root = temp_root("nogit");
    assert_eq!(git_dir_to_watch(&root), None);
    fs::remove_dir_all(&root).ok();
  }

  #[test]
  fn is_ignored_still_covers_git_for_fs_events() {
    assert!(is_ignored(".git"));
    assert!(is_ignored(".git/HEAD"));
    assert!(!is_ignored("src/main.rs"));
  }
}

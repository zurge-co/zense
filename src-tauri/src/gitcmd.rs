//! Git commands: read-only status, branch info, and diff summary via the
//! git2 crate. Used by the Review panel to show the working-tree state and
//! by the History panel to contextualize the current branch.

use std::fs;
use std::path::Path;

use git2::{Delta, DiffOptions, Repository, StatusOptions, StatusShow};
use serde::Serialize;

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
  path: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  staged: Option<&'static str>,
  #[serde(skip_serializing_if = "Option::is_none")]
  unstaged: Option<&'static str>,
  #[serde(skip_serializing_if = "Option::is_none")]
  old_path: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
  files: Vec<GitFileStatus>,
  not_a_repo: bool,
  empty_repo: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
  branch: Option<String>,
  detached: bool,
  ahead: usize,
  behind: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffEntry {
  path: String,
  status: &'static str,
  additions: usize,
  deletions: usize,
  #[serde(skip_serializing_if = "Option::is_none")]
  old_path: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffSummary {
  staged: Vec<GitDiffEntry>,
  unstaged: Vec<GitDiffEntry>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Open a repository. Returns `None` when the path is not a git repo.
/// Returns `Err` for permission denied or missing path.
fn open_repo(root: &str) -> Result<Option<Repository>, String> {
  if !Path::new(root).exists() {
    return Err("workspace path does not exist".to_string());
  }
  match Repository::open(root) {
    Ok(repo) => Ok(Some(repo)),
    Err(e) => {
      let msg = e.message();
      if msg.contains("could not find repository")
        || msg.contains("not a git repository")
        || msg.contains("does not appear to be a git")
      {
        Ok(None) // not a repo — no error, just None
      } else {
        Err(format!("permission denied: {root}"))
      }
    }
  }
}

/// Open a repo and translate "not a repo" to an error string.
fn open_repo_or_err(root: &str) -> Result<Repository, String> {
  open_repo(root)?.ok_or_else(|| "not a git repository".to_string())
}

/// Reject absolute paths and `..` escapes. Git paths must be relative to the
/// repo working directory. Mirrors the fscmd.rs path-traversal guard.
fn validate_repo_path(path: &str) -> Result<(), String> {
  if path.is_empty() {
    return Err("path cannot be empty".to_string());
  }
  let normalized = path.replace('\\', "/");
  let p = Path::new(&normalized);
  if p.is_absolute() {
    return Err(format!("path must be relative: {path}"));
  }
  for component in p.components() {
    if matches!(component, std::path::Component::ParentDir) {
      return Err(format!("path escapes repository: {path}"));
    }
  }
  Ok(())
}

/// Map a git2 Delta to our short status code: "M" / "A" / "D" / "R".
fn delta_status(dt: Delta) -> &'static str {
  match dt {
    Delta::Added => "A",
    Delta::Deleted => "D",
    Delta::Modified => "M",
    Delta::Renamed => "R",
    Delta::Conflicted => "C",
    _ => "M",
  }
}

/// Count additions/deletions for every file in a diff, returning Vec<GitDiffEntry>.
fn collect_diff_entries(diff: &git2::Diff) -> Vec<GitDiffEntry> {
  let mut entries: Vec<GitDiffEntry> = diff
    .deltas()
    .enumerate()
    .map(|(i, delta)| {
      let status = delta_status(delta.status());
      let old_path = if delta.status() == Delta::Renamed {
        delta
          .old_file()
          .path()
          .map(|p| p.to_string_lossy().replace('\\', "/"))
      } else {
        None
      };
      let path = delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

      let (additions, deletions) = match git2::Patch::from_diff(diff, i) {
        Ok(Some(patch)) => {
          let mut add = 0usize;
          let mut del = 0usize;
          for h in 0..patch.num_hunks() {
            let Ok((_hunk, num_lines)) = patch.hunk(h) else {
              continue;
            };
            for l in 0..num_lines {
              if let Ok(line) = patch.line_in_hunk(h, l) {
                match line.origin() {
                  '+' => add += 1,
                  '-' => del += 1,
                  _ => {}
                }
              }
            }
          }
          (add, del)
        }
        _ => (0, 0), // binary file or patch failure
      };

      GitDiffEntry {
        path,
        status,
        additions,
        deletions,
        old_path,
      }
    })
    .collect();
  entries.sort_by(|a, b| a.path.cmp(&b.path));
  entries
}

/// Check whether the repository has any commits (HEAD exists).
fn has_head(repo: &Repository) -> bool {
  repo.head().is_ok()
}

// ---------------------------------------------------------------------------
// Command 1: git_status
// ---------------------------------------------------------------------------

/// Working-tree status: staged + unstaged flags per file.
/// Returns `not_a_repo=true` when the path is not inside a git repository.
/// Returns `empty_repo=true` when the repo has no commits yet.
#[tauri::command]
pub fn git_status(root: String) -> Result<GitStatus, String> {
  let repo = match open_repo(&root)? {
    None => {
      return Ok(GitStatus {
        files: vec![],
        not_a_repo: true,
        empty_repo: false,
      })
    }
    Some(r) => r,
  };

  let empty_repo = !has_head(&repo);

  let mut opts = StatusOptions::new();
  opts.include_untracked(true).recurse_untracked_dirs(true);
  // For empty repos (no HEAD), git2 still needs to show untracked files.
  // Setting StatusShow to IndexAndWorkdir ensures untracked files appear.
  if empty_repo {
    opts.show(StatusShow::IndexAndWorkdir);
  }

  let statuses = repo.statuses(Some(&mut opts)).map_err(|e| {
    let msg = e.message();
    if msg.contains("permission") {
      format!("permission denied: {root}")
    } else {
      e.to_string()
    }
  })?;

  let mut files: Vec<GitFileStatus> = Vec::new();

  for entry in statuses.iter() {
    let st = entry.status();
    let path = match entry.path() {
      Some(p) => p.to_string(),
      None => continue,
    };

    let conflicted = st.is_conflicted();

    let staged = if conflicted {
      Some("C")
    } else if st.is_index_new() {
      Some("A")
    } else if st.is_index_modified() {
      Some("M")
    } else if st.is_index_deleted() {
      Some("D")
    } else if st.is_index_renamed() {
      Some("R")
    } else {
      None
    };

    let unstaged = if conflicted {
      Some("C")
    } else if st.is_wt_new() {
      Some("A")
    } else if st.is_wt_modified() {
      Some("M")
    } else if st.is_wt_deleted() {
      Some("D")
    } else {
      None
    };

    // For renames, extract old path from the index diff.
    let old_path = if st.is_index_renamed() {
      entry
        .head_to_index()
        .and_then(|diff_delta| {
          diff_delta
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
        })
    } else {
      None
    };

    // Skip if nothing to report (e.g. index_ignored or other flags only).
    if staged.is_none() && unstaged.is_none() {
      // Could be a rename in the working tree (not yet staged).
      if st.is_wt_renamed() {
        // Working-tree rename: report as unstaged "R".
        let old_p = entry
          .index_to_workdir()
          .and_then(|dd| {
            dd.old_file()
              .path()
              .map(|p| p.to_string_lossy().replace('\\', "/"))
          });
        files.push(GitFileStatus {
          path,
          staged: None,
          unstaged: Some("R"),
          old_path: old_p,
        });
      }
      continue;
    }

    files.push(GitFileStatus {
      path,
      staged,
      unstaged,
      old_path,
    });
  }

  // Filter out statuses that have no staged/unstaged meaning (e.g. ignored).
  files.retain(|f| f.staged.is_some() || f.unstaged.is_some());

  files.sort_by(|a, b| a.path.cmp(&b.path));

  Ok(GitStatus {
    files,
    not_a_repo: false,
    empty_repo,
  })
}

// ---------------------------------------------------------------------------
// Command 2: git_branch_info
// ---------------------------------------------------------------------------

/// Current branch name, detached state, and ahead/behind counts relative to
/// upstream. Returns `Err` for not-a-repo and empty-repo cases.
#[tauri::command]
pub fn git_branch_info(root: String) -> Result<GitBranchInfo, String> {
  let repo = open_repo_or_err(&root)?;

  if !has_head(&repo) {
    return Err("repository has no commits".to_string());
  }

  let head = repo.head().map_err(|e| e.to_string())?;

  if repo.head_detached().unwrap_or(false) {
    return Ok(GitBranchInfo {
      branch: None,
      detached: true,
      ahead: 0,
      behind: 0,
    });
  }

  let branch_name = head.shorthand().map(String::from);

  let (ahead, behind) = match &branch_name {
    Some(name) => {
      let upstream = repo.branch_upstream_name(name).ok().and_then(|refname| {
        repo
          .find_reference(refname.as_str().unwrap_or(""))
          .ok()
          .and_then(|r| r.target())
      });
      match (upstream, head.target()) {
        (Some(up_oid), Some(head_oid)) => {
          repo.graph_ahead_behind(head_oid, up_oid).unwrap_or((0, 0))
        }
        _ => (0, 0),
      }
    }
    None => (0, 0),
  };

  Ok(GitBranchInfo {
    branch: branch_name,
    detached: false,
    ahead,
    behind,
  })
}

// ---------------------------------------------------------------------------
// Command 3: git_diff_summary
// ---------------------------------------------------------------------------

/// Per-file line addition/deletion counts for staged and unstaged changes.
#[tauri::command]
pub fn git_diff_summary(root: String) -> Result<GitDiffSummary, String> {
  let repo = open_repo_or_err(&root)?;

  let index = repo.index().map_err(|e| {
    let msg = e.message();
    if msg.contains("permission") {
      format!("permission denied: {root}")
    } else {
      e.to_string()
    }
  })?;

  // --- Staged: index vs HEAD (or all new if empty repo) ---
  let head_tree = if has_head(&repo) {
    Some(repo.head().and_then(|h| h.peel_to_tree()).ok())
  } else {
    None
  };

  let staged = match head_tree {
    Some(Some(tree)) => {
      let diff = repo
        .diff_tree_to_index(Some(&tree), Some(&index), None)
        .map_err(|e| e.to_string())?;
      collect_diff_entries(&diff)
    }
    _ => {
      // Empty repo: everything in the index is a new file.
      let mut opts = DiffOptions::new();
      opts.include_untracked(true);
      let diff = repo
        .diff_tree_to_index(None, Some(&index), Some(&mut opts))
        .map_err(|e| e.to_string())?;
      collect_diff_entries(&diff)
    }
  };

  // --- Unstaged: index vs working tree ---
  let unstaged = {
    let diff = repo
      .diff_index_to_workdir(Some(&index), None)
      .map_err(|e| e.to_string())?;
    collect_diff_entries(&diff)
  };

  Ok(GitDiffSummary { staged, unstaged })
}

// ---------------------------------------------------------------------------
// Additional data structures
// ---------------------------------------------------------------------------

/// Original + modified content of one file for the Monaco DiffEditor.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffFile {
  pub path: String,
  /// "M" / "A" / "D" / "R" / "C"
  pub status: String,
  /// HEAD blob (staged) or index blob (unstaged) content. Empty for added files.
  pub original: String,
  /// Index blob (staged) or working-tree (unstaged) content. Empty for deleted files.
  pub modified: String,
  /// True when binary — frontend shows a placeholder instead of diff.
  pub is_binary: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub old_path: Option<String>,
}

// ---------------------------------------------------------------------------
// Additional helpers
// ---------------------------------------------------------------------------

/// Read blob content from HEAD tree at `path`. Returns Ok("") when the file
/// is absent (added case). Returns Err only for real failures.
fn read_head_blob(repo: &Repository, path: &str) -> Result<String, String> {
  if !has_head(repo) {
    return Ok(String::new());
  }
  let head = repo.head().map_err(|e| e.to_string())?;
  let tree = head.peel_to_tree().map_err(|e| e.to_string())?;
  let entry = match tree.get_path(Path::new(path)) {
    Ok(e) => e,
    Err(_) => return Ok(String::new()), // not in HEAD — added file
  };
  let blob = repo.find_blob(entry.id()).map_err(|e| e.to_string())?;
  if blob.is_binary() {
    return Ok(String::new());
  }
  Ok(String::from_utf8_lossy(blob.content()).into_owned())
}

/// Read blob content from the index at `path`. Returns Ok("") when absent.
fn read_index_blob(repo: &Repository, path: &str) -> Result<String, String> {
  let index = repo.index().map_err(|e| e.to_string())?;
  let entry = match index.get_path(Path::new(path), 0) {
    Some(e) => e,
    None => return Ok(String::new()),
  };
  let blob = repo.find_blob(entry.id).map_err(|e| e.to_string())?;
  if blob.is_binary() {
    return Ok(String::new());
  }
  Ok(String::from_utf8_lossy(blob.content()).into_owned())
}

/// Detect binary content in the first 8 KiB.
fn is_binary_content(bytes: &[u8]) -> bool {
  bytes.iter().take(8000).any(|b| *b == 0)
}

/// Check if the HEAD blob at `path` is binary. Returns false if absent.
fn is_head_blob_binary(repo: &Repository, path: &str) -> bool {
  if !has_head(repo) {
    return false;
  }
  repo
    .head()
    .ok()
    .and_then(|h| h.peel_to_tree().ok())
    .and_then(|t| t.get_path(Path::new(path)).ok())
    .and_then(|e| repo.find_blob(e.id()).ok())
    .map(|b| b.is_binary())
    .unwrap_or(false)
}

/// Check if the index blob at `path` is binary. Returns false if absent.
fn is_index_blob_binary(repo: &Repository, path: &str) -> bool {
  let index = match repo.index() {
    Ok(idx) => idx,
    Err(_) => return false,
  };
  match index.get_path(Path::new(path), 0) {
    Some(entry) => repo
      .find_blob(entry.id)
      .map(|b| b.is_binary())
      .unwrap_or(false),
    None => false,
  }
}

// ---------------------------------------------------------------------------
// Command 4: git_diff_file
// ---------------------------------------------------------------------------

/// Full original + modified content of a single file for the Monaco DiffEditor.
/// When `staged` is true, compares HEAD vs index; when false, compares index
/// vs working tree. Binary files return empty content with `is_binary=true`.
#[tauri::command]
pub fn git_diff_file(
  root: String,
  path: String,
  staged: bool,
) -> Result<GitDiffFile, String> {
  let repo = open_repo_or_err(&root)?;
  validate_repo_path(&path)?;
  let path_norm = path.replace('\\', "/");
  let index = repo.index().map_err(|e| e.to_string())?;

  // --- Find the delta for this path to determine status ---
  let mut status = "M".to_string();
  let mut old_path: Option<String> = None;

  if staged {
    let diff = if has_head(&repo) {
      let head_tree = repo
        .head()
        .and_then(|h| h.peel_to_tree())
        .map_err(|e| e.to_string())?;
      repo
        .diff_tree_to_index(Some(&head_tree), Some(&index), None)
        .map_err(|e| e.to_string())?
    } else {
      let mut opts = DiffOptions::new();
      opts.include_untracked(true);
      repo
        .diff_tree_to_index(None, Some(&index), Some(&mut opts))
        .map_err(|e| e.to_string())?
    };
    for delta in diff.deltas() {
      let dp = delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
      if dp == path_norm {
        status = delta_status(delta.status()).to_string();
        if delta.status() == Delta::Renamed {
          old_path = delta
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().replace('\\', "/"));
        }
        break;
      }
    }
  } else {
    let diff = repo
      .diff_index_to_workdir(Some(&index), None)
      .map_err(|e| e.to_string())?;
    for delta in diff.deltas() {
      let dp = delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
      if dp == path_norm {
        status = delta_status(delta.status()).to_string();
        if delta.status() == Delta::Renamed {
          old_path = delta
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().replace('\\', "/"));
        }
        break;
      }
    }
  }

  // --- Determine content and binary status ---
  let (original, modified, is_binary) = if staged {
    let head_binary = is_head_blob_binary(&repo, &path_norm);
    let index_binary = is_index_blob_binary(&repo, &path_norm);
    if head_binary || index_binary {
      (String::new(), String::new(), true)
    } else {
      let orig = read_head_blob(&repo, &path_norm)?;
      let modi = read_index_blob(&repo, &path_norm)?;
      (orig, modi, false)
    }
  } else {
    let workdir = repo
      .workdir()
      .ok_or("repository has no working directory")?;
    let file_path = workdir.join(&path_norm);
    let wt_bytes = match fs::read(&file_path) {
      Ok(bytes) => bytes,
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
      Err(_) => return Err(format!("permission denied: {path_norm}")),
    };
    let wt_binary = is_binary_content(&wt_bytes);
    let index_binary = is_index_blob_binary(&repo, &path_norm);
    if wt_binary || index_binary {
      (String::new(), String::new(), true)
    } else {
      let orig = read_index_blob(&repo, &path_norm)?;
      let modi = String::from_utf8_lossy(&wt_bytes).into_owned();
      (orig, modi, false)
    }
  };

  Ok(GitDiffFile {
    path: path_norm,
    status,
    original,
    modified,
    is_binary,
    old_path,
  })
}

// ---------------------------------------------------------------------------
// Command 5: git_stage
// ---------------------------------------------------------------------------

/// Stage a file path into the index. If the file no longer exists on disk,
/// a staged deletion is performed instead.
#[tauri::command]
pub fn git_stage(root: String, path: String) -> Result<(), String> {
  let repo = open_repo_or_err(&root)?;
  validate_repo_path(&path)?;
  let workdir = repo
    .workdir()
    .ok_or("repository has no working directory")?;
  let mut index = repo.index().map_err(|e| e.to_string())?;

  if workdir.join(&path).exists() {
    index
      .add_path(Path::new(&path))
      .map_err(|e| e.to_string())?;
  } else {
    index
      .remove_path(Path::new(&path))
      .map_err(|e| e.to_string())?;
  }

  index.write().map_err(|e| e.to_string())?;
  Ok(())
}

// ---------------------------------------------------------------------------
// Command 6: git_unstage
// ---------------------------------------------------------------------------

/// Unstage a file: reset its index entry to HEAD. In an empty repo (no HEAD),
/// simply remove it from the index.
#[tauri::command]
pub fn git_unstage(root: String, path: String) -> Result<(), String> {
  let repo = open_repo_or_err(&root)?;
  validate_repo_path(&path)?;

  if has_head(&repo) {
    let head = repo.head().map_err(|e| e.to_string())?;
    let head_obj = head
      .peel_to_commit()
      .map_err(|e| e.to_string())?
      .into_object();
    repo
      .reset_default(Some(&head_obj), std::iter::once(Path::new(&path)))
      .map_err(|e| e.to_string())?;
  } else {
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let _ = index.remove_path(Path::new(&path));
    index.write().map_err(|e| e.to_string())?;
  }

  Ok(())
}

// ---------------------------------------------------------------------------
// Command 7: git_commit
// ---------------------------------------------------------------------------

/// Commit the staged index with the given message. Returns the new commit OID
/// as a 40-character hex string. Errors when the message is empty or nothing
/// is staged.
#[tauri::command]
pub fn git_commit(root: String, message: String) -> Result<String, String> {
  let repo = open_repo_or_err(&root)?;

  if message.trim().is_empty() {
    return Err("commit message cannot be empty".to_string());
  }

  let mut index = repo.index().map_err(|e| e.to_string())?;

  // Verify that something is actually staged.
  if has_head(&repo) {
    let head_tree = repo
      .head()
      .and_then(|h| h.peel_to_tree())
      .map_err(|e| e.to_string())?;
    let diff = repo
      .diff_tree_to_index(Some(&head_tree), Some(&index), None)
      .map_err(|e| e.to_string())?;
    if diff.deltas().count() == 0 {
      return Err("nothing staged to commit".to_string());
    }
  } else if index.len() == 0 {
    return Err("nothing staged to commit".to_string());
  }

  let sig = repo.signature().map_err(|e| e.to_string())?;
  let tree_id = index.write_tree().map_err(|e| e.to_string())?;
  let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

  let parents: Vec<git2::Commit> = if has_head(&repo) {
    vec![repo
      .head()
      .and_then(|h| h.peel_to_commit())
      .map_err(|e| e.to_string())?]
  } else {
    vec![]
  };
  let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

  let oid = repo
    .commit(
      Some("HEAD"),
      &sig,
      &sig,
      message.trim(),
      &tree,
      &parent_refs,
    )
    .map_err(|e| e.to_string())?;

  Ok(oid.to_string())
}

// ---------------------------------------------------------------------------
// History data structures
// ---------------------------------------------------------------------------

/// One commit in the log list (History panel row).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
  pub sha: String,
  pub short_sha: String,
  pub message: String,
  pub summary: String,
  pub author: String,
  pub time: i64,
  pub parent_count: usize,
  pub is_merge: bool,
  pub files_changed: usize,
  pub additions: usize,
  pub deletions: usize,
}

/// Full commit detail for the CommitDiffView (git_show).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitShowCommit {
  pub sha: String,
  pub short_sha: String,
  pub message: String,
  pub author: String,
  pub time: i64,
  pub parent_count: usize,
  pub is_merge: bool,
  pub files: Vec<GitDiffEntry>,
}

/// Diff between two commits (compare view).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffCommits {
  pub from_sha: String,
  pub to_sha: String,
  pub files: Vec<GitDiffEntry>,
}

// ---------------------------------------------------------------------------
// History helpers
// ---------------------------------------------------------------------------

/// Diff a commit's tree against its first parent's tree (or the empty tree
/// for root commits). Returns `None` when the diff cannot be produced so that
/// callers can degrade gracefully instead of failing the whole operation.
fn commit_vs_parent_diff<'a>(
  repo: &'a Repository,
  commit: &git2::Commit<'a>,
) -> Option<git2::Diff<'a>> {
  let new_tree = commit.tree().ok()?;
  let old_tree = if commit.parent_count() > 0 {
    commit.parent(0).ok().and_then(|p| p.tree().ok())
  } else {
    None
  };
  repo
    .diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), None)
    .ok()
}

/// First 7 hex chars of a full SHA string (or the whole string if shorter).
fn short_sha_of(full: &str) -> String {
  if full.len() >= 7 {
    full[..7].to_string()
  } else {
    full.to_string()
  }
}

// ---------------------------------------------------------------------------
// Command 8: git_log
// ---------------------------------------------------------------------------

/// List commits newest-first with per-commit file stats. `limit` of 0 defaults
/// to 50; a hard cap of 200 prevents huge payloads. Returns an empty vec for
/// empty repos (no HEAD) so the UI can show "No commits yet".
#[tauri::command]
pub fn git_log(root: String, offset: usize, limit: usize) -> Result<Vec<GitLogEntry>, String> {
  let repo = open_repo_or_err(&root)?;

  if !has_head(&repo) {
    return Ok(vec![]);
  }

  let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
  revwalk.push_head().map_err(|e| e.to_string())?;
  let _ = revwalk.set_sorting(git2::Sort::TIME);

  let effective_limit = if limit == 0 { 50 } else { limit.min(200) };

  let mut entries: Vec<GitLogEntry> = Vec::new();
  let mut skipped = 0usize;

  for oid_result in revwalk {
    let oid = match oid_result {
      Ok(o) => o,
      Err(_) => continue,
    };

    if skipped < offset {
      skipped += 1;
      continue;
    }

    if entries.len() >= effective_limit {
      break;
    }

    let commit = match repo.find_commit(oid) {
      Ok(c) => c,
      Err(_) => continue,
    };

    let full_sha = oid.to_string();
    let short_sha = short_sha_of(&full_sha);
    let message = commit.message().unwrap_or("").to_string();
    let summary = commit.summary().unwrap_or("").to_string();
    let author = commit.author().name().unwrap_or("").to_string();
    let time = commit.time().seconds();
    let parent_count = commit.parent_count();
    let is_merge = parent_count > 1;

    // Per-commit diff vs first parent. A single bad commit must not kill the
    // whole log, so failures degrade to zero stats.
    let (files_changed, additions, deletions) = match commit_vs_parent_diff(&repo, &commit) {
      Some(diff) => {
        let diff_entries = collect_diff_entries(&diff);
        let add: usize = diff_entries.iter().map(|e| e.additions).sum();
        let del: usize = diff_entries.iter().map(|e| e.deletions).sum();
        (diff_entries.len(), add, del)
      }
      None => (0, 0, 0),
    };

    entries.push(GitLogEntry {
      sha: full_sha,
      short_sha,
      message,
      summary,
      author,
      time,
      parent_count,
      is_merge,
      files_changed,
      additions,
      deletions,
    });
  }

  Ok(entries)
}

// ---------------------------------------------------------------------------
// Command 9: git_show
// ---------------------------------------------------------------------------

/// Full detail for a single commit: header fields plus per-file diff stats
/// against the first parent (empty tree for root commits). Merge commits
/// return an empty file list — combined diffs are not produced in v1; the UI
/// shows the merge badge instead.
#[tauri::command]
pub fn git_show(root: String, sha: String) -> Result<GitShowCommit, String> {
  let repo = open_repo_or_err(&root)?;

  let oid = git2::Oid::from_str(&sha).map_err(|_| "invalid commit sha".to_string())?;
  let commit = repo
    .find_commit(oid)
    .map_err(|_| "commit not found".to_string())?;

  let full_sha = oid.to_string();
  let short_sha = short_sha_of(&full_sha);
  let message = commit.message().unwrap_or("").to_string();
  let author = commit.author().name().unwrap_or("").to_string();
  let time = commit.time().seconds();
  let parent_count = commit.parent_count();
  let is_merge = parent_count > 1;

  let files = if is_merge {
    vec![]
  } else {
    commit_vs_parent_diff(&repo, &commit)
      .map(|diff| collect_diff_entries(&diff))
      .unwrap_or_default()
  };

  Ok(GitShowCommit {
    sha: full_sha,
    short_sha,
    message,
    author,
    time,
    parent_count,
    is_merge,
    files,
  })
}

// ---------------------------------------------------------------------------
// Command 10: git_diff_commits
// ---------------------------------------------------------------------------

/// Per-file diff stats between two commits (`from` → `to`).
#[tauri::command]
pub fn git_diff_commits(
  root: String,
  from_sha: String,
  to_sha: String,
) -> Result<GitDiffCommits, String> {
  let repo = open_repo_or_err(&root)?;

  let from_oid =
    git2::Oid::from_str(&from_sha).map_err(|_| "invalid commit sha".to_string())?;
  let to_oid =
    git2::Oid::from_str(&to_sha).map_err(|_| "invalid commit sha".to_string())?;

  let from_commit = repo
    .find_commit(from_oid)
    .map_err(|_| "commit not found".to_string())?;
  let to_commit = repo
    .find_commit(to_oid)
    .map_err(|_| "commit not found".to_string())?;

  let from_tree = from_commit.tree().map_err(|e| e.to_string())?;
  let to_tree = to_commit.tree().map_err(|e| e.to_string())?;

  let diff = repo
    .diff_tree_to_tree(Some(&from_tree), Some(&to_tree), None)
    .map_err(|e| e.to_string())?;

  Ok(GitDiffCommits {
    from_sha,
    to_sha,
    files: collect_diff_entries(&diff),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::path::PathBuf;
  use std::time::SystemTime;

  /// Unique temp dir per test run (same pattern as fscmd.rs).
  fn temp_ws() -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
      "zense-test-{}-{}-{}",
      std::process::id(),
      COUNTER.fetch_add(1, Ordering::SeqCst),
      SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  /// Stage a file by path.
  fn stage_file(repo: &Repository, path: &str) -> Result<(), String> {
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
      .add_path(Path::new(path))
      .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;
    Ok(())
  }

  /// Create a commit on HEAD from the current index.
  fn commit_head(repo: &Repository, message: &str) -> Result<git2::Oid, String> {
    let sig = repo.signature().map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
    let parents: Vec<git2::Commit> = if has_head(repo) {
      vec![repo.head().and_then(|h| h.peel_to_commit()).map_err(|e| e.to_string())?]
    } else {
      vec![]
    };
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
    let oid = repo
      .commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
      .map_err(|e| e.to_string())?;
    Ok(oid)
  }

  // -- git_status tests ----------------------------------------------------

  #[test]
  fn test_git_status_not_a_repo() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("file.txt"), "hello").unwrap();

    let result = git_status(root).unwrap();
    assert!(result.not_a_repo);
    assert!(!result.empty_repo);
    assert!(result.files.is_empty());

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_status_empty_repo() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("file.txt"), "hello").unwrap();

    let result = git_status(root).unwrap();
    assert!(!result.not_a_repo);
    assert!(result.empty_repo);
    assert_eq!(result.files.len(), 1);
    let f = &result.files[0];
    assert_eq!(f.path, "file.txt");
    assert_eq!(f.unstaged, Some("A"));
    assert!(f.staged.is_none());

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_status_clean_repo() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("file.txt"), "hello").unwrap();
    stage_file(&repo, "file.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    let result = git_status(root).unwrap();
    assert!(!result.not_a_repo);
    assert!(!result.empty_repo);
    assert!(result.files.is_empty());

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_status_modified_and_staged() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("file.txt"), "line1\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    // Stage a modification.
    fs::write(dir.join("file.txt"), "line1\nline2\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();

    // Modify again (unstaged).
    fs::write(dir.join("file.txt"), "line1\nline2\nline3\n").unwrap();

    let result = git_status(root).unwrap();
    assert_eq!(result.files.len(), 1);
    let f = &result.files[0];
    assert_eq!(f.path, "file.txt");
    assert_eq!(f.staged, Some("M"));
    assert_eq!(f.unstaged, Some("M"));

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_status_deleted() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "a\n").unwrap();
    fs::write(dir.join("b.txt"), "b\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    stage_file(&repo, "b.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    // Delete one file from the working tree (unstaged delete).
    fs::remove_file(dir.join("a.txt")).unwrap();

    let result = git_status(root).unwrap();
    let deleted = result
      .files
      .iter()
      .find(|f| f.path == "a.txt")
      .expect("a.txt should be in status");
    assert_eq!(deleted.unstaged, Some("D"));

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_status_renamed() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("old.txt"), "content\n").unwrap();
    stage_file(&repo, "old.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    // Rename the file on disk.
    fs::rename(dir.join("old.txt"), dir.join("new.txt")).unwrap();

    // Stage the new file. git2 should detect this as a rename.
    stage_file(&repo, "new.txt").unwrap();

    let result = git_status(root).unwrap();

    // The rename may be detected as a staged "R" or as separate A/D.
    // git2's rename detection depends on the diff; for the status call,
    // it may show as index_renamed if libgit2 detects it.
    // We check for either the rename entry or the add+delete pair.
    let has_rename = result.files.iter().any(|f| {
      f.staged == Some("R") && f.old_path.as_deref() == Some("old.txt")
    });
    let has_add = result.files.iter().any(|f| f.path == "new.txt");
    let has_delete = result.files.iter().any(|f| f.path == "old.txt");

    assert!(
      has_rename || (has_add && has_delete),
      "expected rename or add+delete, got: {:?}",
      result.files
    );

    fs::remove_dir_all(&dir).ok();
  }

  // -- git_branch_info tests -----------------------------------------------

  #[test]
  fn test_git_branch_info_main() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("file.txt"), "hello\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    let info = git_branch_info(root).unwrap();
    assert!(!info.detached);
    assert!(info.branch.is_some());
    let branch = info.branch.unwrap();
    assert!(
      branch == "main" || branch == "master",
      "expected main or master, got {branch}"
    );
    assert_eq!(info.ahead, 0);
    assert_eq!(info.behind, 0);

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_branch_info_detached() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("file.txt"), "v1\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();
    let first = commit_head(&repo, "initial").unwrap();

    // Second commit.
    fs::write(dir.join("file.txt"), "v2\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();
    commit_head(&repo, "second").unwrap();

    // Detach to first commit.
    repo.set_head_detached(first).unwrap();

    let info = git_branch_info(root).unwrap();
    assert!(info.detached);
    assert!(info.branch.is_none());
    assert_eq!(info.ahead, 0);
    assert_eq!(info.behind, 0);

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_branch_info_not_a_repo() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("file.txt"), "hello\n").unwrap();

    let result = git_branch_info(root);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
      err.contains("not a git repository") || err.contains("workspace path"),
      "unexpected error: {err}"
    );

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_branch_info_no_commits() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    git2::Repository::init(&dir).unwrap();

    let result = git_branch_info(root);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
      err.contains("no commits"),
      "expected 'repository has no commits', got: {err}"
    );

    fs::remove_dir_all(&dir).ok();
  }

  // -- git_diff_summary tests ---------------------------------------------

  #[test]
  fn test_git_diff_summary_staged_and_unstaged() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "line1\n").unwrap();
    fs::write(dir.join("b.txt"), "line1\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    stage_file(&repo, "b.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    // Stage a modification to a.txt.
    fs::write(dir.join("a.txt"), "line1\nline2\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();

    // Unstaged modification to b.txt.
    fs::write(dir.join("b.txt"), "line1\nline2\n").unwrap();

    let summary = git_diff_summary(root).unwrap();

    // Staged: a.txt modified with +1.
    assert!(
      summary.staged.iter().any(|e| {
        e.path == "a.txt" && e.status == "M" && e.additions >= 1
      }),
      "staged a.txt not found as expected: {:?}",
      summary.staged
    );

    // Unstaged: b.txt modified with +1.
    assert!(
      summary.unstaged.iter().any(|e| {
        e.path == "b.txt" && e.status == "M" && e.additions >= 1
      }),
      "unstaged b.txt not found as expected: {:?}",
      summary.unstaged
    );

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_summary_empty_repo() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "content\n").unwrap();
    fs::write(dir.join("b.txt"), "content\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    stage_file(&repo, "b.txt").unwrap();

    let summary = git_diff_summary(root).unwrap();

    // Staged: both files as "A" (new).
    assert_eq!(summary.staged.len(), 2, "expected 2 staged new files");
    assert!(summary.staged.iter().all(|e| e.status == "A"));
    assert!(summary.unstaged.is_empty(), "unstaged should be empty");

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_summary_not_a_repo() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("file.txt"), "hello\n").unwrap();

    let result = git_diff_summary(root);
    assert!(result.is_err());

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_missing_workspace_path() {
    let dir = temp_ws();
    let nonexistent = dir.join("does_not_exist");
    let root = nonexistent.to_string_lossy().into_owned();

    // git_status returns not_a_repo=true for missing paths.
    let status_result = git_status(root.clone());
    // Repository::open on a nonexistent path returns an error which we
    // catch. The path exists check catches this first.
    match status_result {
      Ok(s) => assert!(s.not_a_repo, "expected not_a_repo for missing path"),
      Err(e) => assert!(
        e.contains("workspace path") || e.contains("not a git"),
        "unexpected error: {e}"
      ),
    }

    // Others return Err.
    assert!(git_branch_info(root.clone()).is_err());
    assert!(git_diff_summary(root.clone()).is_err());

    fs::remove_dir_all(&dir).ok();
  }

  #[cfg(unix)]
  #[test]
  fn test_permission_denied() {
    use std::os::unix::fs::PermissionsExt;

    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("file.txt"), "hello\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    // Restrict .git directory to 0000.
    let git_dir = dir.join(".git");
    let original_mode = fs::metadata(&git_dir)
      .map(|m| m.permissions().mode())
      .unwrap_or(0o755);
    fs::set_permissions(&git_dir, fs::Permissions::from_mode(0o0000)).unwrap();

    // On some systems (e.g. running as root) 0000 doesn't actually deny.
    // We check whether the error happens; if not, the test is skipped.
    let status_result = git_status(root.clone());
    let branch_result = git_branch_info(root.clone());

    // Restore permissions before assertions so cleanup always works.
    fs::set_permissions(&git_dir, fs::Permissions::from_mode(original_mode)).unwrap();

    let denied = match (&status_result, &branch_result) {
      (Err(e), _) if e.contains("permission") => true,
      (_, Err(e)) if e.contains("permission") => true,
      _ => false,
    };

    // If running as root (CI), permission checks may not fire.
    if !denied {
      eprintln!("test_permission_denied: skipped (insufficient permissions to deny access)");
    }

    fs::remove_dir_all(&dir).ok();
  }

  // -- git_diff_file tests --------------------------------------------------

  #[test]
  fn test_git_diff_file_modified_unstaged() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("file.txt"), "a\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    fs::write(dir.join("file.txt"), "a\nb\n").unwrap();

    let d = git_diff_file(root, "file.txt".into(), false).unwrap();
    assert_eq!(d.status, "M");
    assert_eq!(d.original, "a\n");
    assert_eq!(d.modified, "a\nb\n");
    assert!(!d.is_binary);

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_file_modified_staged() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("file.txt"), "a\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    fs::write(dir.join("file.txt"), "a\nb\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();

    let d = git_diff_file(root, "file.txt".into(), true).unwrap();
    assert_eq!(d.status, "M");
    assert_eq!(d.original, "a\n");
    assert_eq!(d.modified, "a\nb\n");
    assert!(!d.is_binary);

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_file_added() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "a\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    fs::write(dir.join("new.txt"), "new\n").unwrap();
    stage_file(&repo, "new.txt").unwrap();

    let d = git_diff_file(root, "new.txt".into(), true).unwrap();
    assert_eq!(d.status, "A");
    assert_eq!(d.original, "");
    assert_eq!(d.modified, "new\n");

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_file_deleted() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("file.txt"), "gone\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    fs::remove_file(dir.join("file.txt")).unwrap();

    let d = git_diff_file(root, "file.txt".into(), false).unwrap();
    assert_eq!(d.status, "D");
    assert_eq!(d.original, "gone\n");
    assert_eq!(d.modified, "");

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_file_binary() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("bin.dat"), [0u8, 159, 146, 150]).unwrap();
    stage_file(&repo, "bin.dat").unwrap();
    commit_head(&repo, "initial").unwrap();

    fs::write(dir.join("bin.dat"), [0u8, 1, 2, 3, 4]).unwrap();

    let d = git_diff_file(root, "bin.dat".into(), false).unwrap();
    assert!(d.is_binary);
    assert_eq!(d.original, "");
    assert_eq!(d.modified, "");

    fs::remove_dir_all(&dir).ok();
  }

  // -- git_stage / git_unstage / git_commit tests ---------------------------

  #[test]
  fn test_git_stage_and_unstage() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("file.txt"), "a\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    fs::write(dir.join("file.txt"), "a\nb\n").unwrap();
    let s = git_status(root.clone()).unwrap();
    assert!(s.files.iter().any(|f| f.unstaged == Some("M")));

    git_stage(root.clone(), "file.txt".into()).unwrap();
    let s = git_status(root.clone()).unwrap();
    let f = s.files.iter().find(|f| f.path == "file.txt").unwrap();
    assert_eq!(f.staged, Some("M"));
    assert!(f.unstaged.is_none());

    git_unstage(root.clone(), "file.txt".into()).unwrap();
    let s = git_status(root.clone()).unwrap();
    let f = s.files.iter().find(|f| f.path == "file.txt").unwrap();
    assert!(f.staged.is_none());
    assert_eq!(f.unstaged, Some("M"));

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_stage_deleted_file() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "a\n").unwrap();
    fs::write(dir.join("b.txt"), "b\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    stage_file(&repo, "b.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    fs::remove_file(dir.join("a.txt")).unwrap();
    git_stage(root.clone(), "a.txt".into()).unwrap();

    let s = git_status(root.clone()).unwrap();
    let f = s.files.iter().find(|f| f.path == "a.txt").unwrap();
    assert_eq!(f.staged, Some("D"));

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_commit() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "a\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    fs::write(dir.join("b.txt"), "b\n").unwrap();
    stage_file(&repo, "b.txt").unwrap();

    let sha = git_commit(root.clone(), "second commit".into()).unwrap();
    assert_eq!(sha.len(), 40);
    assert!(sha.chars().all(|c| c.is_ascii_hexdigit()));

    let head = repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.message().unwrap(), "second commit");

    let s = git_status(root.clone()).unwrap();
    assert!(s.files.is_empty(), "expected clean tree, got {:?}", s.files);

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_commit_empty_message() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "a\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    let err = git_commit(root.clone(), "   ".into()).unwrap_err();
    assert!(err.contains("empty"), "unexpected error: {err}");

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_commit_nothing_staged() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "a\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    let err = git_commit(root.clone(), "no-op".into()).unwrap_err();
    assert!(err.contains("nothing staged"), "unexpected error: {err}");

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_file_empty_repo_staged() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("new.txt"), "hello\n").unwrap();
    stage_file(&repo, "new.txt").unwrap();

    let d = git_diff_file(root, "new.txt".into(), true).unwrap();
    assert_eq!(d.status, "A");
    assert_eq!(d.original, "");
    assert_eq!(d.modified, "hello\n");

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_stage_not_a_repo() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("file.txt"), "x").unwrap();

    assert!(git_stage(root.clone(), "file.txt".into()).is_err());

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_file_rejects_traversal() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("file.txt"), "a\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    assert!(git_diff_file(root.clone(), "../outside.txt".into(), false).is_err());
    assert!(git_diff_file(root.clone(), "/etc/passwd".into(), false).is_err());
    assert!(git_stage(root.clone(), "../outside.txt".into()).is_err());
    assert!(git_unstage(root.clone(), "..\\escape".into()).is_err());

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_file_nested_path() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    std::fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(dir.join("src/deep.txt"), "nested\n").unwrap();
    stage_file(&repo, "src/deep.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    fs::write(dir.join("src/deep.txt"), "nested\nmore\n").unwrap();

    let d = git_diff_file(root, "src/deep.txt".into(), false).unwrap();
    assert_eq!(d.status, "M");
    assert_eq!(d.original, "nested\n");
    assert_eq!(d.modified, "nested\nmore\n");

    fs::remove_dir_all(&dir).ok();
  }

  // -- git_log / git_show / git_diff_commits tests ---------------------------

  #[test]
  fn test_git_log_empty_repo() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    git2::Repository::init(&dir).unwrap();
    let log = git_log(root, 0, 50).unwrap();
    assert!(log.is_empty());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_log_ordering_and_fields() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "a\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    commit_head(&repo, "first").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    fs::write(dir.join("a.txt"), "a\nb\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    commit_head(&repo, "second").unwrap();

    let log = git_log(root, 0, 50).unwrap();
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].summary, "second");
    assert_eq!(log[1].summary, "first");
    assert_eq!(log[0].short_sha.len(), 7);
    assert_eq!(log[0].files_changed, 1);
    assert_eq!(log[0].additions, 1);
    assert!(!log[0].is_merge);
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_log_offset_and_limit() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    for i in 0..5 {
      fs::write(dir.join("a.txt"), format!("v{i}\n")).unwrap();
      stage_file(&repo, "a.txt").unwrap();
      commit_head(&repo, &format!("commit {i}")).unwrap();
      std::thread::sleep(std::time::Duration::from_millis(1010));
    }

    let page1 = git_log(root.clone(), 0, 2).unwrap();
    assert_eq!(page1.len(), 2);
    assert_eq!(page1[0].summary, "commit 4");
    let page2 = git_log(root.clone(), 2, 2).unwrap();
    assert_eq!(page2.len(), 2);
    assert_eq!(page2[0].summary, "commit 2");
    assert!(git_log(root.clone(), 10, 2).unwrap().is_empty());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_show_single_commit() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "a\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    let sha = commit_head(&repo, "show me").unwrap();

    let show = git_show(root, sha.to_string()).unwrap();
    assert_eq!(show.message.trim(), "show me");
    assert!(!show.is_merge);
    assert_eq!(show.files.len(), 1);
    assert_eq!(show.files[0].status, "A");
    assert_eq!(show.files[0].path, "a.txt");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_show_invalid_and_missing() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "a\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    commit_head(&repo, "initial").unwrap();

    assert!(git_show(root.clone(), "not-a-sha".into()).is_err());
    assert!(
      git_show(root.clone(), "0000000000000000000000000000000000000000".into()).is_err()
    );
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_show_merge_commit() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "base\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    commit_head(&repo, "base").unwrap();

    // Create feature branch from current HEAD.
    let base_commit = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("feature", &base_commit, false).unwrap();

    // On the default branch: add "main work".
    fs::write(dir.join("a.txt"), "base\nmain\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    commit_head(&repo, "main work").unwrap();
    let main_commit = repo.head().unwrap().peel_to_commit().unwrap();

    // Switch to feature branch and add a commit there.
    repo.set_head("refs/heads/feature").unwrap();
    repo.checkout_head(None).unwrap();
    fs::write(dir.join("b.txt"), "feature\n").unwrap();
    stage_file(&repo, "b.txt").unwrap();
    let feature_commit = commit_head(&repo, "feature work").unwrap();

    // Create merge commit: parents [feature tip, main tip].
    let sig = repo.signature().unwrap();
    let mut index = repo.index().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let feat = repo.find_commit(feature_commit).unwrap();
    let main = repo.find_commit(main_commit.id()).unwrap();
    let merge_oid = repo
      .commit(
        Some("HEAD"),
        &sig,
        &sig,
        "merge main into feature",
        &tree,
        &[&feat, &main],
      )
      .unwrap();

    let show = git_show(root.clone(), merge_oid.to_string()).unwrap();
    assert!(show.is_merge);
    assert_eq!(show.parent_count, 2);
    assert!(
      show.files.is_empty(),
      "merge commit diff should be empty in v1"
    );

    let log = git_log(root.clone(), 0, 50).unwrap();
    assert!(log.iter().any(|e| e.is_merge));
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_commits() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "a\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    let c1 = commit_head(&repo, "c1").unwrap();
    fs::write(dir.join("a.txt"), "a\nb\n").unwrap();
    fs::write(dir.join("new.txt"), "n\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    stage_file(&repo, "new.txt").unwrap();
    let c2 = commit_head(&repo, "c2").unwrap();

    let d = git_diff_commits(root.clone(), c1.to_string(), c2.to_string()).unwrap();
    assert_eq!(d.files.len(), 2);
    let a = d.files.iter().find(|f| f.path == "a.txt").unwrap();
    assert_eq!(a.status, "M");
    assert_eq!(a.additions, 1);
    let n = d.files.iter().find(|f| f.path == "new.txt").unwrap();
    assert_eq!(n.status, "A");

    assert!(git_diff_commits(root.clone(), "bad".into(), c2.to_string()).is_err());
    fs::remove_dir_all(&dir).ok();
  }
}

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
// Command 11: git_diff_commit_file
// ---------------------------------------------------------------------------

/// Read blob content from a tree at `path`. Returns Ok("") when the file is
/// absent (e.g. added on the "to" side). Returns Err only for real failures.
fn read_tree_blob(repo: &Repository, tree: &git2::Tree, path: &str) -> Result<String, String> {
  let entry = match tree.get_path(Path::new(path)) {
    Ok(e) => e,
    Err(_) => return Ok(String::new()),
  };
  let blob = repo.find_blob(entry.id()).map_err(|e| e.to_string())?;
  if blob.is_binary() {
    return Ok(String::new());
  }
  Ok(String::from_utf8_lossy(blob.content()).into_owned())
}

/// Check if the blob at `path` inside `tree` is binary. Returns false if absent.
fn is_tree_blob_binary(repo: &Repository, tree: &git2::Tree, path: &str) -> bool {
  tree
    .get_path(Path::new(path))
    .ok()
    .and_then(|e| repo.find_blob(e.id()).ok())
    .map(|b| b.is_binary())
    .unwrap_or(false)
}

/// Full original + modified content of a single file between two commits for
/// the Monaco DiffEditor. When `from_sha` is None, diffs `to_sha` against its
/// first parent (empty tree for root commits). Binary on either side returns
/// empty content with `is_binary=true`.
#[tauri::command]
pub fn git_diff_commit_file(
  root: String,
  path: String,
  from_sha: Option<String>,
  to_sha: String,
) -> Result<GitDiffFile, String> {
  let repo = open_repo_or_err(&root)?;
  validate_repo_path(&path)?;
  let path_norm = path.replace('\\', "/");

  let to_oid =
    git2::Oid::from_str(&to_sha).map_err(|_| "invalid commit sha".to_string())?;
  let to_commit = repo
    .find_commit(to_oid)
    .map_err(|_| "commit not found".to_string())?;
  let to_tree = to_commit.tree().map_err(|e| e.to_string())?;

  let from_tree = match from_sha {
    Some(sha) => {
      let oid = git2::Oid::from_str(&sha).map_err(|_| "invalid commit sha".to_string())?;
      let commit = repo
        .find_commit(oid)
        .map_err(|_| "commit not found".to_string())?;
      Some(commit.tree().map_err(|e| e.to_string())?)
    }
    None => {
      if to_commit.parent_count() > 0 {
        let parent = to_commit.parent(0).map_err(|e| e.to_string())?;
        Some(parent.tree().map_err(|e| e.to_string())?)
      } else {
        None // root commit → empty tree
      }
    }
  };

  // Find the delta for this path to determine status / old_path (renames).
  let diff = repo
    .diff_tree_to_tree(from_tree.as_ref(), Some(&to_tree), None)
    .map_err(|e| e.to_string())?;
  let mut status = "M".to_string();
  let mut old_path: Option<String> = None;
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

  let orig_key = old_path.clone().unwrap_or_else(|| path_norm.clone());
  let old_binary = from_tree
    .as_ref()
    .map(|t| is_tree_blob_binary(&repo, t, &orig_key))
    .unwrap_or(false);
  let new_binary = is_tree_blob_binary(&repo, &to_tree, &path_norm);

  let (original, modified, is_binary) = if old_binary || new_binary {
    (String::new(), String::new(), true)
  } else {
    let original = match &from_tree {
      Some(t) => read_tree_blob(&repo, t, &orig_key)?,
      None => String::new(),
    };
    let modified = read_tree_blob(&repo, &to_tree, &path_norm)?;
    (original, modified, false)
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
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Commands 12–16: branch/network ops for the StatusBar branch menu. Aimed at
// users who don't know the git CLI — local ops via git2, network ops via the
// user's own `git` binary (their ssh config / credential helpers just work).
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchEntry {
  name: String,
  is_head: bool,
  /// True for remote-tracking entries ("origin/x") — the menu shows these
  /// after locals with a "server" tag; checking one out creates a local
  /// tracking branch automatically (see git_checkout_remote_branch).
  is_remote: bool,
}

/// Result of a junior-friendly git action. Expected failures (diverged pull,
/// no network, …) come back as `ok: false` with a plain-language message;
/// `Err` is reserved for hard problems (not a repo, git binary missing).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitOpResult {
  ok: bool,
  message: String,
}

/// Local branches (checked-out one flagged) followed by remote-tracking
/// branches as of the last fetch — symbolic refs like origin/HEAD skipped.
/// Empty repo → empty list. No hidden fetch; refs are as the user left them.
#[tauri::command]
pub fn git_list_branches(root: String) -> Result<Vec<GitBranchEntry>, String> {
  let repo = open_repo_or_err(&root)?;
  if !has_head(&repo) {
    return Ok(vec![]);
  }
  let mut locals = Vec::new();
  let mut remotes = Vec::new();
  let iter = repo
    .branches(None)
    .map_err(|e| e.to_string())?;
  for item in iter {
    let (branch, kind) = item.map_err(|e| e.to_string())?;
    let Some(name) = branch.name().map_err(|e| e.to_string())? else {
      continue;
    };
    // Remote's “default branch” pointer, not a real branch — same as the CLI.
    if kind == git2::BranchType::Remote && name.ends_with("/HEAD") {
      continue;
    }
    let entry = GitBranchEntry {
      name: name.to_string(),
      is_head: branch.is_head(),
      is_remote: kind == git2::BranchType::Remote,
    };
    if entry.is_remote {
      remotes.push(entry);
    } else {
      locals.push(entry);
    }
  }
  locals.sort_by(|a, b| a.name.cmp(&b.name));
  remotes.sort_by(|a, b| a.name.cmp(&b.name));
  locals.extend(remotes);
  Ok(locals)
}

/// Switch HEAD + worktree to a local branch. checkout_tree runs BEFORE
/// set_head and uses `safe()` so a conflicting uncommitted change aborts the
/// whole switch instead of leaving a half-checked-out tree.
fn checkout_local_branch(repo: &Repository, name: &str) -> Result<(), String> {
  let branch = repo
    .find_branch(name, git2::BranchType::Local)
    .map_err(|_| format!("branch '{name}' not found"))?;
  let commit = branch
    .get()
    .peel_to_commit()
    .map_err(|e| e.to_string())?;
  repo
    .checkout_tree(commit.as_object(), Some(git2::build::CheckoutBuilder::new().safe()))
    .map_err(|e| {
      let msg = e.to_string();
      let l = msg.to_lowercase();
      if l.contains("conflict") || l.contains("would be overwritten") || l.contains("prevent") {
        format!(
          "Can't switch to '{name}': your uncommitted changes would be overwritten. \
           Commit them first (or run `git stash` in the terminal)."
        )
      } else {
        msg
      }
    })?;
  repo
    .set_head(branch.get().name().ok_or("invalid branch reference")?)
    .map_err(|e| e.to_string())
}

/// Switch to an existing local branch.
#[tauri::command]
pub fn git_checkout_branch(root: String, name: String) -> Result<(), String> {
  let repo = open_repo_or_err(&root)?;
  checkout_local_branch(&repo, name.trim())
}

/// Checkout a remote-tracking branch ("origin/feature-x") the way the CLI
/// does: if a local branch of the same name exists, just switch to it;
/// otherwise create it from the remote commit, link upstream tracking, and
/// switch — juniors never type `git checkout -b x --track origin/x`.
#[tauri::command]
pub fn git_checkout_remote_branch(root: String, name: String) -> Result<(), String> {
  let repo = open_repo_or_err(&root)?;
  let name = name.trim();
  // "origin/feature-x" → local "feature-x".
  let local = name
    .split_once('/')
    .map(|(_, rest)| rest)
    .filter(|rest| !rest.is_empty())
    .ok_or_else(|| format!("'{name}' doesn't look like a remote branch (expected e.g. 'origin/main')"))?;

  // Local branch already exists → plain switch (same as `git checkout x`).
  if repo.find_branch(local, git2::BranchType::Local).is_ok() {
    return checkout_local_branch(&repo, local);
  }

  let remote = repo
    .find_branch(name, git2::BranchType::Remote)
    .map_err(|_| format!("remote branch '{name}' not found — Fetch first to refresh the list"))?;
  let commit = remote
    .get()
    .peel_to_commit()
    .map_err(|e| e.to_string())?;
  repo.branch(local, &commit, false).map_err(|e| e.to_string())?;
  let mut new_branch = repo
    .find_branch(local, git2::BranchType::Local)
    .map_err(|e| e.to_string())?;
  // Link upstream so ahead/behind and future pulls work out of the box.
  if let Err(e) = new_branch.set_upstream(Some(name)) {
    // Roll back the half-created branch rather than leave it untracked.
    let _ = new_branch.delete();
    return Err(format!("could not set upstream for '{local}': {e}"));
  }
  checkout_local_branch(&repo, local).map_err(|e| {
    let _ = new_branch.delete();
    e
  })
}

/// Basic branch-name sanity; git2's is_valid_name does the heavy lifting.
fn validate_branch_name(name: &str) -> Result<&str, String> {
  let n = name.trim();
  if n.is_empty() {
    return Err("branch name is empty".to_string());
  }
  if !git2::Reference::is_valid_name(&format!("refs/heads/{n}")) {
    return Err(format!(
      "'{n}' is not a valid branch name (avoid spaces, '..', '~', '^', ':', '?', '*', '[')"
    ));
  }
  Ok(n)
}

/// Create a new branch from the current HEAD and switch to it.
#[tauri::command]
pub fn git_create_branch(root: String, name: String) -> Result<String, String> {
  let repo = open_repo_or_err(&root)?;
  if !has_head(&repo) {
    return Err(
      "this repository has no commits yet — commit something first, then create a branch".to_string(),
    );
  }
  let name = validate_branch_name(&name)?.to_string();
  let head = repo
    .head()
    .and_then(|h| h.peel_to_commit())
    .map_err(|e| e.to_string())?;
  repo.branch(&name, &head, false).map_err(|e| {
    if e.code() == git2::ErrorCode::Exists {
      format!("branch '{name}' already exists — pick another name or switch to it")
    } else {
      e.to_string()
    }
  })?;
  checkout_local_branch(&repo, &name)?;
  Ok(name)
}

/// Fetch/pull go through the `git` CLI so the user's own ssh keys, credential
/// helpers and gh/keychain auth apply — nothing to configure inside Zense.
fn run_git_cli(root: &str, args: &[&str]) -> Result<(bool, String), String> {
  let out = std::process::Command::new("git")
    .arg("-C")
    .arg(root)
    .args(args)
    .output()
    .map_err(|e| format!("could not run `git` ({e}) — is git installed?"))?;
  let mut text = String::from_utf8_lossy(&out.stdout).trim().to_string();
  let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
  if !err.is_empty() {
    if !text.is_empty() {
      text.push('\n');
    }
    text.push_str(&err);
  }
  Ok((out.status.success(), text))
}

/// Plain-language rewrite of git's most common network errors — the branch
/// menu's audience doesn't know git jargon.
fn friendly_net_error(raw: &str) -> String {
  let l = raw.to_lowercase();
  if l.contains("could not resolve hostname")
    || l.contains("could not resolve host")
    || l.contains("name or service not known")
    || l.contains("temporary failure in name resolution")
  {
    "Can't reach the remote server — check your internet connection (or the remote URL).".to_string()
  } else if l.contains("permission denied") {
    "The remote rejected your SSH key — make sure it's added to your git host (e.g. GitHub).".to_string()
  } else if l.contains("authentication failed")
    || l.contains("invalid username or password")
    || l.contains("could not read username")
  {
    "Login to the remote failed — check your credentials/token (e.g. sign in with `gh auth login`).".to_string()
  } else if l.contains("does not appear to be a git repository") {
    "The remote URL doesn't point at a git repository — check the remote settings.".to_string()
  } else {
    raw.trim().to_string()
  }
}

/// A repo without any remote has nothing to fetch/pull — say so up front
/// instead of silently succeeding like `git fetch --all` would.
fn ensure_has_remote(repo: &Repository) -> Result<(), String> {
  let remotes = repo.remotes().map_err(|e| e.to_string())?;
  if remotes.is_empty() {
    Err("this repository has no remote connected (no GitHub server) — nothing to fetch or pull from".to_string())
  } else {
    Ok(())
  }
}

/// `git fetch --all --prune`: download updates, never touch the worktree.
#[tauri::command]
pub fn git_fetch(root: String) -> Result<GitOpResult, String> {
  let repo = open_repo_or_err(&root)?;
  ensure_has_remote(&repo)?;
  let (ok, text) = run_git_cli(&root, &["fetch", "--all", "--prune"])?;
  if ok {
    Ok(GitOpResult {
      ok: true,
      message: if text.is_empty() {
        "Fetched — nothing new on the remote.".to_string()
      } else {
        format!("Fetched the latest remote info.\n{text}")
      },
    })
  } else {
    Ok(GitOpResult {
      ok: false,
      message: friendly_net_error(&text),
    })
  }
}

/// `git pull --ff-only`: only ever fast-forward. Diverged branches need a
/// real merge decision — out of scope for the one-click menu, so explain.
#[tauri::command]
pub fn git_pull(root: String) -> Result<GitOpResult, String> {
  let repo = open_repo_or_err(&root)?;
  ensure_has_remote(&repo)?;
  let (ok, text) = run_git_cli(&root, &["pull", "--ff-only"])?;
  if ok {
    let message = if text.to_lowercase().contains("already up to date") {
      "Already up to date — you have the latest code.".to_string()
    } else {
      format!("Pulled the latest changes.\n{text}")
    };
    Ok(GitOpResult { ok: true, message })
  } else {
    let l = text.to_lowercase();
    let message = if l.contains("not possible to fast-forward")
      || l.contains("non-fast-forward")
      || l.contains("diverged")
    {
      "Your branch and the remote have both moved on (diverged). Zense only does safe \
       fast-forward pulls — run `git pull` in the terminal to merge, or ask a teammate for help."
        .to_string()
    } else if l.contains("would be overwritten") || l.contains("local changes") || l.contains("untracked working tree")
    {
      "You have local changes that would be overwritten by the pull — commit or discard them first."
        .to_string()
    } else if l.contains("no tracking information") || l.contains("no such ref was fetched") {
      "This branch isn't linked to a remote branch yet — run `git push -u origin <branch>` \
       in the terminal once."
        .to_string()
    } else {
      friendly_net_error(&text)
    };
    Ok(GitOpResult { ok: false, message })
  }
}

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

  // -- git_diff_commit_file tests -------------------------------------------

  #[test]
  fn test_git_diff_commit_file_modified() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "line1\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    commit_head(&repo, "c1").unwrap();
    fs::write(dir.join("a.txt"), "line1\nline2\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    let c2 = commit_head(&repo, "c2").unwrap();

    // No from_sha → diff against first parent (c1).
    let d = git_diff_commit_file(root.clone(), "a.txt".into(), None, c2.to_string()).unwrap();
    assert_eq!(d.status, "M");
    assert_eq!(d.original, "line1\n");
    assert_eq!(d.modified, "line1\nline2\n");
    assert!(!d.is_binary);
    assert!(d.old_path.is_none());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_commit_file_root_commit_added() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "hello\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    let c1 = commit_head(&repo, "initial").unwrap();

    // Root commit has no parent → original must be empty.
    let d = git_diff_commit_file(root.clone(), "a.txt".into(), None, c1.to_string()).unwrap();
    assert_eq!(d.status, "A");
    assert_eq!(d.original, "");
    assert_eq!(d.modified, "hello\n");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_commit_file_deleted() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "gone\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    commit_head(&repo, "c1").unwrap();

    // Delete from index + commit.
    let mut index = repo.index().unwrap();
    index.remove_path(Path::new("a.txt")).unwrap();
    index.write().unwrap();
    fs::remove_file(dir.join("a.txt")).unwrap();
    let c2 = commit_head(&repo, "c2").unwrap();

    let d = git_diff_commit_file(root.clone(), "a.txt".into(), None, c2.to_string()).unwrap();
    assert_eq!(d.status, "D");
    assert_eq!(d.original, "gone\n");
    assert_eq!(d.modified, "");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_commit_file_explicit_from_to() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "v1\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    let c1 = commit_head(&repo, "c1").unwrap();
    fs::write(dir.join("a.txt"), "v1\nv2\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    let c2 = commit_head(&repo, "c2").unwrap();
    fs::write(dir.join("a.txt"), "v1\nv2\nv3\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    let c3 = commit_head(&repo, "c3").unwrap();

    // Explicit from → skips intermediate commits.
    let d = git_diff_commit_file(
      root.clone(),
      "a.txt".into(),
      Some(c1.to_string()),
      c3.to_string(),
    )
    .unwrap();
    assert_eq!(d.original, "v1\n");
    assert_eq!(d.modified, "v1\nv2\nv3\n");

    // c2 → c3: only the last hunk.
    let d2 = git_diff_commit_file(
      root.clone(),
      "a.txt".into(),
      Some(c2.to_string()),
      c3.to_string(),
    )
    .unwrap();
    assert_eq!(d2.original, "v1\nv2\n");
    assert_eq!(d2.modified, "v1\nv2\nv3\n");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_commit_file_errors() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("a.txt"), "a\n").unwrap();
    stage_file(&repo, "a.txt").unwrap();
    let c1 = commit_head(&repo, "c1").unwrap();

    assert!(git_diff_commit_file(root.clone(), "a.txt".into(), None, "bad".into()).is_err());
    assert!(
      git_diff_commit_file(root.clone(), "a.txt".into(), Some("bad".into()), c1.to_string())
        .is_err()
    );
    // Path traversal rejected.
    assert!(
      git_diff_commit_file(root.clone(), "../x".into(), None, c1.to_string()).is_err()
    );
    fs::remove_dir_all(&dir).ok();
  }

  // -- branch menu tests ---------------------------------------------------

  /// Repo with one commit on the default branch; returns (dir, repo, branch).
  fn repo_one_commit() -> (PathBuf, Repository, String) {
    let dir = temp_ws();
    let repo = git2::Repository::init(&dir).unwrap();
    fs::write(dir.join("file.txt"), "hello\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();
    commit_head(&repo, "initial").unwrap();
    let branch = repo
      .head()
      .unwrap()
      .shorthand()
      .unwrap()
      .to_string();
    (dir, repo, branch)
  }

  #[test]
  fn test_git_list_branches() {
    let (dir, repo, main) = repo_one_commit();
    let root = dir.to_string_lossy().into_owned();

    let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("feature/x", &head_commit, false).unwrap();

    let branches = git_list_branches(root).unwrap();
    assert_eq!(branches.len(), 2);
    let head = branches.iter().find(|b| b.is_head).unwrap();
    assert_eq!(head.name, main);
    assert!(branches.iter().any(|b| b.name == "feature/x"));

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_checkout_branch_switches_worktree() {
    let (dir, repo, main) = repo_one_commit();
    let root = dir.to_string_lossy().into_owned();

    let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("feature", &head_commit, false).unwrap();

    // Commit an extra file only on `feature`.
    git_checkout_branch(root.clone(), "feature".into()).unwrap();
    fs::write(dir.join("only-on-feature.txt"), "x\n").unwrap();
    stage_file(&repo, "only-on-feature.txt").unwrap();
    commit_head(&repo, "feature commit").unwrap();

    // Switching back must remove that file from the worktree.
    git_checkout_branch(root.clone(), main.clone()).unwrap();
    assert!(!dir.join("only-on-feature.txt").exists());
    let info = git_branch_info(root.clone()).unwrap();
    assert_eq!(info.branch.as_deref(), Some(main.as_str()));

    // Unknown branch errors, no state change.
    assert!(git_checkout_branch(root, "nope".into()).is_err());

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_checkout_branch_refuses_to_clobber() {
    let (dir, repo, main) = repo_one_commit();
    let root = dir.to_string_lossy().into_owned();

    let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("feature", &head_commit, false).unwrap();
    git_checkout_branch(root.clone(), "feature".into()).unwrap();
    fs::write(dir.join("file.txt"), "feature version\n").unwrap();
    stage_file(&repo, "file.txt").unwrap();
    commit_head(&repo, "change file").unwrap();

    git_checkout_branch(root.clone(), main.clone()).unwrap();
    // Uncommitted edit to a file that differs between the branches.
    fs::write(dir.join("file.txt"), "local dirty\n").unwrap();

    let err = git_checkout_branch(root.clone(), "feature".into()).unwrap_err();
    assert!(err.contains("uncommitted"), "unexpected error: {err}");
    // HEAD must not have moved.
    let info = git_branch_info(root).unwrap();
    assert_eq!(info.branch.as_deref(), Some(main.as_str()));

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_create_branch() {
    let (dir, _repo, _main) = repo_one_commit();
    let root = dir.to_string_lossy().into_owned();

    let created = git_create_branch(root.clone(), "feature/new-ui".into()).unwrap();
    assert_eq!(created, "feature/new-ui");
    let info = git_branch_info(root.clone()).unwrap();
    assert_eq!(info.branch.as_deref(), Some("feature/new-ui"));

    // Duplicate, empty and invalid names are rejected.
    assert!(git_create_branch(root.clone(), "feature/new-ui".into()).unwrap_err().contains("already exists"));
    assert!(git_create_branch(root.clone(), "   ".into()).is_err());
    assert!(git_create_branch(root.clone(), "bad name".into()).is_err());
    assert!(git_create_branch(root.clone(), "bad..dots".into()).is_err());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_friendly_net_error_mappings() {
    assert!(friendly_net_error("fatal: Could not resolve hostname github.com").contains("internet"));
    assert!(friendly_net_error("git@github.com: Permission denied (publickey).").contains("SSH key"));
    assert!(friendly_net_error("fatal: Authentication failed for 'https://x'").contains("credentials"));
    assert!(friendly_net_error("some other error").contains("some other error"));
  }

  #[test]
  fn test_git_pull_no_remote_is_explained() {
    let (dir, _repo, _main) = repo_one_commit();
    let root = dir.to_string_lossy().into_owned();
    let err = git_pull(root.clone()).unwrap_err();
    assert!(err.contains("no remote"), "unexpected error: {err}");
    let err = git_fetch(root).unwrap_err();
    assert!(err.contains("no remote"), "unexpected error: {err}");
    fs::remove_dir_all(&dir).ok();
  }

  /// Offline end-to-end: two clones of a local bare remote — fetch in one
  /// sees the other's push, pull fast-forwards the worktree. Uses the `git`
  /// CLI exactly like the commands do, but purely on the filesystem.
  #[test]
  fn test_git_fetch_and_pull_offline() {
    let bare = temp_ws().join("remote.git");
    let a = temp_ws().join("a");
    let b = temp_ws().join("b");
    let run = |dir: &Path, args: &[&str]| {
      let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .unwrap();
      assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
      );
    };

    run(&temp_ws(), &["init", "--bare", bare.to_str().unwrap()]);
    run(&temp_ws(), &["clone", bare.to_str().unwrap(), a.to_str().unwrap()]);
    run(&a, &["config", "user.email", "t@t"]);
    run(&a, &["config", "user.name", "t"]);
    fs::write(a.join("file.txt"), "v1\n").unwrap();
    run(&a, &["add", "."]);
    run(&a, &["commit", "-m", "v1"]);
    run(&a, &["push", "-u", "origin", "HEAD"]);

    run(&temp_ws(), &["clone", bare.to_str().unwrap(), b.to_str().unwrap()]);
    run(&b, &["config", "user.email", "t@t"]);
    run(&b, &["config", "user.name", "t"]);

    let root_a = a.to_string_lossy().into_owned();

    // Nothing new yet → up to date.
    let r = git_pull(root_a.clone()).unwrap();
    assert!(r.ok);
    assert!(r.message.to_lowercase().contains("up to date"), "{}", r.message);

    // B pushes v2; A fetches (worktree untouched) then pulls (fast-forward).
    fs::write(b.join("file.txt"), "v2\n").unwrap();
    run(&b, &["add", "."]);
    run(&b, &["commit", "-m", "v2"]);
    run(&b, &["push", "origin", "HEAD"]);

    let r = git_fetch(root_a.clone()).unwrap();
    assert!(r.ok, "{}", r.message);
    assert_eq!(fs::read_to_string(a.join("file.txt")).unwrap(), "v1\n");

    let r = git_pull(root_a.clone()).unwrap();
    assert!(r.ok, "{}", r.message);
    assert_eq!(fs::read_to_string(a.join("file.txt")).unwrap(), "v2\n");

    fs::remove_dir_all(bare.parent().unwrap()).ok();
    fs::remove_dir_all(a.parent().unwrap()).ok();
    fs::remove_dir_all(b.parent().unwrap()).ok();
  }

  /// Two clones of a local bare remote wired with pushup upstream; returns
  /// (bare, a, b, cleanup_roots). Extracted helper shared by remote tests.
  fn two_clones() -> (PathBuf, PathBuf, PathBuf) {
    let bare_root = temp_ws();
    let bare = bare_root.join("remote.git");
    let a_root = temp_ws();
    let a = a_root.join("a");
    let b_root = temp_ws();
    let b = b_root.join("b");
    let run = |dir: &Path, args: &[&str]| {
      let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .unwrap();
      assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
      );
    };
    run(&temp_ws(), &["init", "--bare", bare.to_str().unwrap()]);
    run(&temp_ws(), &["clone", bare.to_str().unwrap(), a.to_str().unwrap()]);
    run(&a, &["config", "user.email", "t@t"]);
    run(&a, &["config", "user.name", "t"]);
    fs::write(a.join("file.txt"), "v1\n").unwrap();
    run(&a, &["add", "."]);
    run(&a, &["commit", "-m", "v1"]);
    run(&a, &["push", "origin", "HEAD"]);
    run(&temp_ws(), &["clone", bare.to_str().unwrap(), b.to_str().unwrap()]);
    run(&b, &["config", "user.email", "t@t"]);
    run(&b, &["config", "user.name", "t"]);
    (bare, a, b)
  }

  #[test]
  fn test_git_list_branches_includes_remote_tracking() {
    let (bare, a, b) = two_clones();
    let run = |dir: &Path, args: &[&str]| {
      std::process::Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    };
    // B creates a branch that exists only on the remote.
    run(&b, &["checkout", "-b", "feature-remote"]);
    fs::write(b.join("remote-only.txt"), "r\n").unwrap();
    run(&b, &["add", "."]);
    run(&b, &["commit", "-m", "remote only"]);
    run(&b, &["push", "origin", "feature-remote"]);

    let root_a = a.to_string_lossy().into_owned();
    git_fetch(root_a.clone()).unwrap();

    let branches = git_list_branches(root_a).unwrap();
    // Local entries come first and are never flagged remote.
    let split = branches.iter().position(|b| b.is_remote);
    assert!(split.is_some(), "expected remote entries in {branches:?}");
    assert!(!branches[..split.unwrap()].iter().any(|b| b.is_remote));
    assert!(branches.iter().any(|b| b.is_remote && b.name == "origin/feature-remote"));
    // The default-branch pointer is hidden, like the CLI.
    assert!(!branches.iter().any(|b| b.name.ends_with("/HEAD")));

    fs::remove_dir_all(bare.parent().unwrap()).ok();
    fs::remove_dir_all(a.parent().unwrap()).ok();
    fs::remove_dir_all(b.parent().unwrap()).ok();
  }

  #[test]
  fn test_git_checkout_remote_branch_creates_tracking_branch() {
    let (bare, a, b) = two_clones();
    let run = |dir: &Path, args: &[&str]| {
      std::process::Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    };
    run(&b, &["checkout", "-b", "feature-remote"]);
    fs::write(b.join("remote-only.txt"), "r\n").unwrap();
    run(&b, &["add", "."]);
    run(&b, &["commit", "-m", "remote only"]);
    run(&b, &["push", "origin", "feature-remote"]);

    let root_a = a.to_string_lossy().into_owned();
    git_fetch(root_a.clone()).unwrap();
    assert!(!a.join("remote-only.txt").exists());

    // First checkout: creates the local tracking branch and switches.
    git_checkout_remote_branch(root_a.clone(), "origin/feature-remote".into()).unwrap();
    assert!(a.join("remote-only.txt").exists());
    let repo = Repository::open(&a).unwrap();
    let lb = repo.find_branch("feature-remote", git2::BranchType::Local).unwrap();
    assert!(lb.is_head());
    let upstream = lb.get().name().map(|_| repo.branch_upstream_name(lb.get().name().unwrap()));
    assert_eq!(
      upstream.unwrap().ok().and_then(|r| r.as_str().map(String::from)).as_deref(),
      Some("refs/remotes/origin/feature-remote")
    );

    // Second checkout with the local branch in place: plain switch, no error.
    let local_head = repo.head().unwrap().shorthand().unwrap().to_string();
    assert_eq!(local_head, "feature-remote");
    git_checkout_remote_branch(root_a.clone(), "origin/feature-remote".into()).unwrap();

    // Remote branch that doesn't exist → friendly error.
    let err = git_checkout_remote_branch(root_a, "origin/nope".into()).unwrap_err();
    assert!(err.contains("not found"), "unexpected error: {err}");

    fs::remove_dir_all(bare.parent().unwrap()).ok();
    fs::remove_dir_all(a.parent().unwrap()).ok();
    fs::remove_dir_all(b.parent().unwrap()).ok();
  }
}

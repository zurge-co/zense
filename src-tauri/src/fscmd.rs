//! File-system commands: workspace file index/tree (for the explorer and the
//! composer @-mentions) and guarded file reads (editor content + snippets).

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use ignore::WalkBuilder;
use serde::Serialize;

/// Safety valve for pathological workspaces (e.g. no .gitignore).
const MAX_ENTRIES: usize = 20_000;
/// Refuse to load huge files into the editor.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsNode {
  name: String,
  path: String,
  #[serde(rename = "type")]
  kind: &'static str, // "file" | "folder"
  #[serde(skip_serializing_if = "Option::is_none")]
  children: Option<Vec<FsNode>>,
}

/// Resolve `path` under `root`, rejecting escapes (incl. via symlinks).
fn resolve_inside(root: &str, path: &str) -> Result<PathBuf, String> {
  let root = std::fs::canonicalize(PathBuf::from(root)).map_err(|e| e.to_string())?;
  let full = std::fs::canonicalize(root.join(path)).map_err(|e| e.to_string())?;
  if !full.starts_with(&root) {
    return Err(format!("path escapes workspace: {path}"));
  }
  Ok(full)
}

/// Walk a workspace: respects .gitignore (even outside git repos), shows
/// dotfiles, but always skips `.git` itself. Returns (relative path, is_dir).
fn walk_entries(root: &str) -> Result<Vec<(String, bool)>, String> {
  let root_path = std::fs::canonicalize(PathBuf::from(root)).map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  for entry in WalkBuilder::new(&root_path)
    .hidden(false)
    .require_git(false)
    .filter_entry(|e| e.file_name() != ".git")
    .build()
    .flatten()
  {
    if entry.path() == root_path {
      continue;
    }
    let Ok(rel) = entry.path().strip_prefix(&root_path) else {
      continue;
    };
    out.push((
      rel.to_string_lossy().replace('\\', "/"),
      entry.file_type().is_some_and(|t| t.is_dir()),
    ));
    if out.len() >= MAX_ENTRIES {
      break;
    }
  }
  Ok(out)
}

/// Flat index of all files (for @-mention autocomplete).
#[tauri::command]
pub fn list_files(root: String) -> Result<Vec<String>, String> {
  let mut files: Vec<String> = walk_entries(&root)?
    .into_iter()
    .filter(|(_, is_dir)| !is_dir)
    .map(|(p, _)| p)
    .collect();
  files.sort();
  Ok(files)
}

/// Nested file tree for the explorer (folders first, then files, A→Z).
#[tauri::command]
pub fn read_file_tree(root: String) -> Result<Vec<FsNode>, String> {
  #[derive(Default)]
  struct Builder {
    dirs: BTreeMap<String, Builder>,
    files: BTreeSet<String>,
  }

  fn insert(b: &mut Builder, segments: &[String], is_dir: bool) {
    match segments {
      [] => {}
      [name] => {
        if is_dir {
          b.dirs.entry(name.clone()).or_default();
        } else {
          b.files.insert(name.clone());
        }
      }
      [name, rest @ ..] => insert(b.dirs.entry(name.clone()).or_default(), rest, is_dir),
    }
  }

  fn build(b: Builder, prefix: &str) -> Vec<FsNode> {
    let dirs = b.dirs.into_iter().map(|(name, child)| {
      let path = format!("{prefix}/{name}");
      FsNode {
        name,
        children: Some(build(child, &path)),
        path,
        kind: "folder",
      }
    });
    let files = b.files.into_iter().map(|name| FsNode {
      path: format!("{prefix}/{name}"),
      name,
      kind: "file",
      children: None,
    });
    dirs.chain(files).collect()
  }

  let mut root_builder = Builder::default();
  for (rel, is_dir) in walk_entries(&root)? {
    let segments: Vec<String> = rel.split('/').map(String::from).collect();
    insert(&mut root_builder, &segments, is_dir);
  }
  Ok(build(root_builder, ""))
}

/// Read a whole workspace file (editor content). Rejects binaries/huge files.
#[tauri::command]
pub fn read_file(root: String, path: String) -> Result<String, String> {
  let full = resolve_inside(&root, &path)?;
  let meta = std::fs::metadata(&full).map_err(|e| e.to_string())?;
  if meta.len() > MAX_FILE_BYTES {
    return Err(format!("file too large ({} bytes)", meta.len()));
  }
  let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
  String::from_utf8(bytes).map_err(|_| format!("not a UTF-8 text file: {path}"))
}

/// Read a 1-based inclusive line range (composer snippets).
#[tauri::command]
pub fn read_file_range(
  root: String,
  path: String,
  start: u32,
  end: u32,
) -> Result<String, String> {
  let full = resolve_inside(&root, &path)?;
  let content = std::fs::read_to_string(&full).map_err(|e| e.to_string())?;
  let lines: Vec<&str> = content.lines().collect();
  let start = (start.max(1) as usize).min(lines.len().max(1));
  let end = (end as usize).min(lines.len());
  if start > end {
    return Ok(String::new());
  }
  Ok(lines[start - 1..end].join("\n"))
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::time::SystemTime;

  /// Unique temp dir per test run.
  fn temp_ws() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
      "zense-test-{}",
      SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn list_files_respects_gitignore_and_skips_dotgit() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join(".gitignore"), "ignored/\n").unwrap();
    fs::create_dir_all(dir.join("ignored")).unwrap();
    fs::write(dir.join("ignored/skip.ts"), "x").unwrap();
    fs::create_dir_all(dir.join(".git")).unwrap();
    fs::write(dir.join(".git/HEAD"), "x").unwrap();
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(dir.join("src/keep.ts"), "x").unwrap();

    let files = list_files(root.clone()).unwrap();
    assert_eq!(files, vec![".gitignore", "src/keep.ts"]);

    let tree = read_file_tree(root).unwrap();
    let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
    assert_eq!(names, vec!["src", ".gitignore"]); // folders first
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn read_file_guards() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("a.txt"), "l1\nl2\nl3\n").unwrap();

    assert_eq!(read_file(root.clone(), "a.txt".into()).unwrap(), "l1\nl2\nl3\n");
    assert_eq!(
      read_file_range(root.clone(), "a.txt".into(), 2, 3).unwrap(),
      "l2\nl3"
    );
    assert!(read_file(root.clone(), "../nope".into()).is_err());
    assert!(read_file_range(root, "../nope".into(), 1, 2).is_err());
    fs::remove_dir_all(&dir).ok();
  }
}

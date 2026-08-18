//! File-system commands: workspace file index/tree (for the explorer and the
//! composer @-mentions) and guarded file reads (editor content + snippets).

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

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

/// Resolve `path` under `root` for a WRITE operation. Unlike `resolve_inside`,
/// this does NOT canonicalize the target (which would fail for non-existent
/// paths). Instead it canonicalizes only the root, joins the relative path,
/// lexically normalizes the result, and verifies it stays within the root.
/// Note: does not resolve symlinks within the workspace — a symlink under the
/// workspace that points outside would NOT be caught here (unlike the read
/// path's canonicalize). This is an accepted limitation for the write use case.
fn resolve_for_write(root: &str, path: &str) -> Result<PathBuf, String> {
  let root = std::fs::canonicalize(PathBuf::from(root)).map_err(|e| e.to_string())?;
  let target = root.join(path);
  let normalized = normalize_path(&target);
  if !normalized.starts_with(&root) {
    return Err(format!("path escapes workspace: {path}"));
  }
  Ok(normalized)
}

/// Lexically normalize a path: resolve `.` and `..` components without disk access.
fn normalize_path(p: &std::path::Path) -> PathBuf {
  let mut out = PathBuf::new();
  for component in p.components() {
    use std::path::Component;
    match component {
      Component::CurDir => {}
      Component::ParentDir => {
        if !out.as_os_str().is_empty()
          && out
            .components()
            .next_back()
            .is_some_and(|c| matches!(c, Component::Normal(_)))
        {
          out.pop();
        } else {
          out.push("..");
        }
      }
      Component::RootDir => {
        out = PathBuf::from("/");
      }
      Component::Normal(seg) => {
        out.push(seg);
      }
      Component::Prefix(prefix) => {
        out.push(prefix.as_os_str());
      }
    }
  }
  out
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
      let path = if prefix.is_empty() {
        name.clone()
      } else {
        format!("{prefix}/{name}")
      };
      FsNode {
        name,
        children: Some(build(child, &path)),
        path,
        kind: "folder",
      }
    });
    let files = b.files.into_iter().map(|name| FsNode {
      path: if prefix.is_empty() {
        name.clone()
      } else {
        format!("{prefix}/{name}")
      },
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

/// Write content to a workspace file. Creates parent directories if missing.
/// Rejects path escapes. Note: uses `resolve_for_write` (lexical guard), not
/// `resolve_inside` (canonicalize), because the target may not yet exist.
#[tauri::command]
pub fn write_file(root: String, path: String, content: String) -> Result<(), String> {
  let full = resolve_for_write(&root, &path)?;
  if let Some(parent) = full.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  std::fs::write(&full, content).map_err(|e| e.to_string())?;
  Ok(())
}

/// Create a directory (including parents) inside the workspace. No-op if it
/// already exists. Rejects path escapes.
#[tauri::command]
pub fn create_dir(root: String, path: String) -> Result<(), String> {
  let full = resolve_for_write(&root, &path)?;
  std::fs::create_dir_all(&full).map_err(|e| e.to_string())?;
  Ok(())
}

/// Rename or move a file/directory within the workspace. Both `from` and `to`
/// must resolve inside the workspace root. Creates parent dirs of `to` if
/// missing. Errors if `to` already exists (no silent overwrite). Rejects path
/// escapes on either side.
#[tauri::command]
pub fn rename_file(root: String, from: String, to: String) -> Result<(), String> {
  let src = resolve_inside(&root, &from)?;
  let dst = resolve_for_write(&root, &to)?;
  if dst.exists() {
    return Err(format!("destination already exists: {to}"));
  }
  if let Some(parent) = dst.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  std::fs::rename(&src, &dst).map_err(|e| e.to_string())?;
  Ok(())
}

/// Delete a file or directory (recursively) inside the workspace. Rejects
/// path escapes and refuses to delete the workspace root itself.
#[tauri::command]
pub fn delete_file(root: String, path: String) -> Result<(), String> {
  if path.is_empty() || path == "." || path == "./" {
    return Err("cannot delete workspace root".to_string());
  }
  let full = resolve_inside(&root, &path)?;
  let root_canon = std::fs::canonicalize(PathBuf::from(&root)).map_err(|e| e.to_string())?;
  if full == root_canon {
    return Err("cannot delete workspace root".to_string());
  }
  let meta = std::fs::symlink_metadata(&full).map_err(|e| e.to_string())?;
  if meta.is_dir() {
    std::fs::remove_dir_all(&full).map_err(|e| e.to_string())?;
  } else {
    std::fs::remove_file(&full).map_err(|e| e.to_string())?;
  }
  Ok(())
}

// ---------------------------------------------------------------------------
// Copy / duplicate
// ---------------------------------------------------------------------------

/// Split a file name into `(stem, extension)` where extension includes the dot.
/// `file.ts` → `("file", ".ts")`, `Makefile` → `("Makefile", "")`.
fn split_name(name: &str) -> (String, String) {
  match name.rfind('.') {
    Some(pos) if pos > 0 => (name[..pos].to_string(), name[pos..].to_string()),
    _ => (name.to_string(), String::new()),
  }
}

/// Generate a unique path inside `dir` based on `original_name`, following
/// the VS Code naming convention: `file copy.ts`, `file copy 2.ts`, …
/// `folder` → `folder copy`, `folder copy 2`, …
fn unique_path_in_dir(dir: &std::path::Path, original_name: &str) -> PathBuf {
  let first_candidate = dir.join(original_name);
  if !first_candidate.exists() {
    return first_candidate;
  }
  let (stem, ext) = split_name(original_name);
  // First duplicate has no number: "file copy.ts"
  let no_num = if ext.is_empty() {
    format!("{stem} copy")
  } else {
    format!("{stem} copy{ext}")
  };
  let candidate = dir.join(&no_num);
  if !candidate.exists() {
    return candidate;
  }
  // Subsequent duplicates: "file copy 2.ts", "file copy 3.ts", …
  let mut counter = 2;
  loop {
    let candidate_name = if ext.is_empty() {
      format!("{stem} copy {counter}")
    } else {
      format!("{stem} copy {counter}{ext}")
    };
    let candidate = dir.join(&candidate_name);
    if !candidate.exists() {
      return candidate;
    }
    counter += 1;
  }
}

/// Recursively copy a directory tree. Creates `dst` if it does not exist.
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
  std::fs::create_dir_all(dst)?;
  for entry in std::fs::read_dir(src)? {
    let entry = entry?;
    let name = entry.file_name();
    let src_child = entry.path();
    let dst_child = dst.join(&name);
    let ft = entry.file_type()?;
    if ft.is_dir() {
      copy_dir_recursive(&src_child, &dst_child)?;
    } else if ft.is_symlink() {
      let target = std::fs::read_link(&src_child)?;
      #[cfg(unix)]
      std::os::unix::fs::symlink(&target, &dst_child)?;
    } else {
      std::fs::copy(&src_child, &dst_child)?;
    }
  }
  Ok(())
}

/// Copy (duplicate) a file or directory into `to_dir`. The destination name
/// is auto-generated to avoid collisions (`file copy.ts`, `folder copy 2`).
/// Refuses to copy a folder into itself or any of its descendants. Returns
/// the relative path of the newly created entry.
#[tauri::command]
pub fn copy_entry(root: String, from: String, to_dir: String) -> Result<String, String> {
  let src = resolve_inside(&root, &from)?;
  let dst_dir = if to_dir.is_empty() || to_dir == "." {
    std::fs::canonicalize(PathBuf::from(&root)).map_err(|e| e.to_string())?
  } else {
    resolve_inside(&root, &to_dir)?
  };

  // Destination directory must exist and be a directory.
  let dst_meta = std::fs::metadata(&dst_dir).map_err(|e| e.to_string())?;
  if !dst_meta.is_dir() {
    return Err(format!("destination is not a directory: {to_dir}"));
  }

  // Prevent copying a folder into itself or a descendant.
  let src_path = src.as_path();
  if src_path.is_dir() && dst_dir.starts_with(src_path) {
    return Err("cannot copy a folder into itself".to_string());
  }

  let original_name = src
    .file_name()
    .map(|n| n.to_string_lossy().into_owned())
    .ok_or_else(|| "cannot determine file name".to_string())?;

  let dst = unique_path_in_dir(&dst_dir, &original_name);

  let src_meta = std::fs::symlink_metadata(&src).map_err(|e| e.to_string())?;
  if src_meta.is_dir() {
    copy_dir_recursive(&src, &dst).map_err(|e| e.to_string())?;
  } else {
    std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
  }

  // Return the relative path of the destination.
  let root_canon = std::fs::canonicalize(PathBuf::from(&root)).map_err(|e| e.to_string())?;
  let rel = dst
    .strip_prefix(&root_canon)
    .map_err(|e| e.to_string())?
    .to_string_lossy()
    .replace('\\', "/");
  Ok(rel)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::time::SystemTime;

  /// Unique temp dir per test run.
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
  fn read_file_tree_paths_have_no_leading_slash() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("a.txt"), "x").unwrap();
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(dir.join("src/keep.ts"), "x").unwrap();

    let tree = read_file_tree(root).unwrap();

    // Flatten the tree, collecting every node path (folders + files).
    fn flatten(nodes: &[FsNode], out: &mut Vec<String>) {
      for node in nodes {
        out.push(node.path.clone());
        if let Some(children) = &node.children {
          flatten(children, out);
        }
      }
    }
    let mut all_paths = Vec::new();
    flatten(&tree, &mut all_paths);

    // No path may start with a leading slash.
    for path in &all_paths {
      assert!(
        !path.starts_with('/'),
        "path has leading slash: {path}"
      );
    }

    // Root-level file path must be "a.txt" (not "/a.txt").
    let root_file = all_paths
      .iter()
      .find(|p| p.as_str() == "a.txt" || p.as_str() == "/a.txt")
      .expect("a.txt not found in tree");
    assert_eq!(root_file, "a.txt");

    // Nested file path must be "src/keep.ts" (not "/src/keep.ts").
    let nested_file = all_paths
      .iter()
      .find(|p| p.as_str() == "src/keep.ts" || p.as_str() == "/src/keep.ts")
      .expect("src/keep.ts not found in tree");
    assert_eq!(nested_file, "src/keep.ts");

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

  #[test]
  fn write_file_creates_nested_and_content_roundtrips() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    write_file(
      root.clone(),
      "src/deep/nested.ts".into(),
      "hello\nworld\n".into(),
    )
    .unwrap();
    assert_eq!(
      read_file(root.clone(), "src/deep/nested.ts".into()).unwrap(),
      "hello\nworld\n"
    );
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn write_file_rejects_traversal() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    assert!(write_file(
      root.clone(),
      "../../etc/zense-test-traversal".into(),
      "x".into()
    )
    .is_err());
    assert!(!dir.parent().unwrap().join("etc/zense-test-traversal").exists());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn write_file_overwrites_existing() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("existing.txt"), "old content\n").unwrap();
    write_file(root.clone(), "existing.txt".into(), "new content\n".into()).unwrap();
    assert_eq!(
      read_file(root.clone(), "existing.txt".into()).unwrap(),
      "new content\n"
    );
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn create_dir_makes_nested_dirs() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    create_dir(root.clone(), "a/b/c".into()).unwrap();
    assert!(dir.join("a/b/c").is_dir());
    // idempotent
    create_dir(root, "a/b/c".into()).unwrap();
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn rename_file_moves_and_renames() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    write_file(root.clone(), "old.ts".into(), "x\n".into()).unwrap();
    rename_file(root.clone(), "old.ts".into(), "new.ts".into()).unwrap();
    assert!(!dir.join("old.ts").exists());
    assert_eq!(read_file(root, "new.ts".into()).unwrap(), "x\n");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn rename_file_into_nested_dir_creates_parents() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    write_file(root.clone(), "f.txt".into(), "hi\n".into()).unwrap();
    rename_file(root.clone(), "f.txt".into(), "deep/nested/f.txt".into()).unwrap();
    assert_eq!(read_file(root, "deep/nested/f.txt".into()).unwrap(), "hi\n");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn rename_file_refuses_overwrite() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    write_file(root.clone(), "a.txt".into(), "1\n".into()).unwrap();
    write_file(root.clone(), "b.txt".into(), "2\n".into()).unwrap();
    let err = rename_file(root, "a.txt".into(), "b.txt".into()).unwrap_err();
    assert!(err.contains("already exists"));
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn rename_file_rejects_traversal() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    write_file(root.clone(), "a.txt".into(), "x\n".into()).unwrap();
    assert!(rename_file(root.clone(), "a.txt".into(), "../escape.txt".into()).is_err());
    assert!(rename_file(root.clone(), "../a.txt".into(), "b.txt".into()).is_err());
    assert!(!dir.parent().unwrap().join("escape.txt").exists());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn delete_file_removes_file() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    write_file(root.clone(), "gone.txt".into(), "x\n".into()).unwrap();
    assert!(dir.join("gone.txt").exists());
    delete_file(root, "gone.txt".into()).unwrap();
    assert!(!dir.join("gone.txt").exists());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn delete_file_removes_dir_recursively() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    create_dir(root.clone(), "pkg/sub".into()).unwrap();
    write_file(root.clone(), "pkg/sub/f.txt".into(), "x\n".into()).unwrap();
    delete_file(root, "pkg".into()).unwrap();
    assert!(!dir.join("pkg").exists());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn delete_file_rejects_traversal_and_root() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    write_file(root.clone(), "a.txt".into(), "x\n".into()).unwrap();
    assert!(delete_file(root.clone(), "../a.txt".into()).is_err());
    assert!(delete_file(root.clone(), "".into()).is_err());
    assert!(delete_file(root.clone(), ".".into()).is_err());
    // a.txt should still exist
    assert!(dir.join("a.txt").exists());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn copy_entry_duplicates_file() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    write_file(root.clone(), "a.txt".into(), "hello\n".into()).unwrap();
    let result = copy_entry(root.clone(), "a.txt".into(), ".".into()).unwrap();
    assert_eq!(result, "a copy.txt");
    assert_eq!(
      std::fs::read_to_string(dir.join("a.txt")).unwrap(),
      "hello\n"
    );
    assert_eq!(
      std::fs::read_to_string(dir.join("a copy.txt")).unwrap(),
      "hello\n"
    );
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn copy_entry_auto_renames_multiple_copies() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    write_file(root.clone(), "f.ts".into(), "x\n".into()).unwrap();
    let r1 = copy_entry(root.clone(), "f.ts".into(), ".".into()).unwrap();
    let r2 = copy_entry(root.clone(), "f.ts".into(), ".".into()).unwrap();
    let r3 = copy_entry(root.clone(), "f.ts".into(), ".".into()).unwrap();
    assert_eq!(r1, "f copy.ts");
    assert_eq!(r2, "f copy 2.ts");
    assert_eq!(r3, "f copy 3.ts");
    assert!(dir.join("f.ts").exists());
    assert!(dir.join("f copy.ts").exists());
    assert!(dir.join("f copy 2.ts").exists());
    assert!(dir.join("f copy 3.ts").exists());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn copy_entry_duplicates_folder_recursively() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    create_dir(root.clone(), "pkg/sub".into()).unwrap();
    write_file(root.clone(), "pkg/a.txt".into(), "1\n".into()).unwrap();
    write_file(root.clone(), "pkg/sub/b.txt".into(), "2\n".into()).unwrap();

    let result = copy_entry(root.clone(), "pkg".into(), ".".into()).unwrap();
    assert_eq!(result, "pkg copy");

    assert!(dir.join("pkg copy").is_dir());
    assert!(dir.join("pkg copy/a.txt").is_file());
    assert!(dir.join("pkg copy/sub/b.txt").is_file());
    assert_eq!(
      std::fs::read_to_string(dir.join("pkg copy/sub/b.txt")).unwrap(),
      "2\n"
    );
    // original still intact
    assert!(dir.join("pkg/a.txt").exists());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn copy_entry_into_nested_dir() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    create_dir(root.clone(), "dest".into()).unwrap();
    write_file(root.clone(), "a.txt".into(), "hi\n".into()).unwrap();

    let result = copy_entry(root.clone(), "a.txt".into(), "dest".into()).unwrap();
    assert_eq!(result, "dest/a.txt");
    assert!(dir.join("dest/a.txt").exists());
    assert!(dir.join("a.txt").exists());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn copy_entry_refuses_folder_into_itself() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    create_dir(root.clone(), "pkg/inner".into()).unwrap();
    write_file(root.clone(), "pkg/f.txt".into(), "x\n".into()).unwrap();

    // Copying pkg into pkg/inner should fail.
    let err = copy_entry(root.clone(), "pkg".into(), "pkg/inner".into()).unwrap_err();
    assert!(err.contains("into itself"), "unexpected error: {err}");
    // Nothing should have been created inside pkg/inner.
    assert!(!dir.join("pkg/inner/pkg").exists());
    assert!(!dir.join("pkg/inner/pkg copy").exists());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn copy_entry_refuses_folder_into_descendant() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    create_dir(root.clone(), "pkg/a/b".into()).unwrap();
    write_file(root.clone(), "pkg/f.txt".into(), "x\n".into()).unwrap();

    // Copying pkg into pkg/a/b (a deeper descendant) should fail.
    let err = copy_entry(root.clone(), "pkg".into(), "pkg/a/b".into()).unwrap_err();
    assert!(err.contains("into itself"), "unexpected error: {err}");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn copy_entry_rejects_traversal() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    write_file(root.clone(), "a.txt".into(), "x\n".into()).unwrap();
    assert!(copy_entry(root.clone(), "../a.txt".into(), ".".into()).is_err());
    assert!(copy_entry(root.clone(), "a.txt".into(), "../".into()).is_err());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn copy_entry_no_extension_auto_rename() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    create_dir(root.clone(), "Makefile_dir".into()).unwrap();
    write_file(root.clone(), "Makefile".into(), "all:\n".into()).unwrap();
    let r1 = copy_entry(root.clone(), "Makefile".into(), ".".into()).unwrap();
    let r2 = copy_entry(root.clone(), "Makefile".into(), ".".into()).unwrap();
    assert_eq!(r1, "Makefile copy");
    assert_eq!(r2, "Makefile copy 2");
    assert!(dir.join("Makefile copy").exists());
    assert!(dir.join("Makefile copy 2").exists());
    fs::remove_dir_all(&dir).ok();
  }
}

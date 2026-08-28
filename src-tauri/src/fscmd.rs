//! File-system commands: workspace file index/tree (for the explorer and the
//! composer @-mentions) and guarded file reads (editor content + snippets).

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use ignore::overrides::{Override, OverrideBuilder};
use ignore::WalkBuilder;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

/// Safety valve for pathological workspaces (e.g. no .gitignore).
const MAX_ENTRIES: usize = 20_000;
/// Refuse to load huge files into the editor.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// Refuse to load huge binary files (images) into the preview.
const MAX_BINARY_FILE_BYTES: u64 = 10 * 1024 * 1024;
/// Skip files larger than this during workspace search (per-file cap).
const MAX_SEARCH_FILE_BYTES: u64 = 256 * 1024;
/// Cap total search matches returned to the UI.
const MAX_SEARCH_MATCHES: usize = 500;

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

//// True when any workspace-relative path segment is a dot entry.
fn has_dot_segment(rel: &str) -> bool {
  rel.split('/').any(|segment| segment.starts_with('.'))
}

/// Walk a workspace: respects .gitignore (even outside git repos), can opt in
/// or out of dotfiles/dotfolders, and always skips `.git` itself. Returns
/// (relative path, is_dir).
fn walk_entries(root: &str, include_hidden: bool) -> Result<Vec<(String, bool)>, String> {
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
    let rel = rel.to_string_lossy().replace('\\', "/");
    if !include_hidden && has_dot_segment(&rel) {
      continue;
    }
    out.push((rel, entry.file_type().is_some_and(|t| t.is_dir())));
    if out.len() >= MAX_ENTRIES {
      break;
    }
  }
  Ok(out)
}

/// Flat index of all files (for @-mention autocomplete).
#[tauri::command]
pub fn list_files(root: String, include_hidden: bool) -> Result<Vec<String>, String> {
  let mut files: Vec<String> = walk_entries(&root, include_hidden)?
    .into_iter()
    .filter(|(_, is_dir)| !is_dir)
    .map(|(p, _)| p)
    .collect();
  files.sort();
  Ok(files)
}

/// Nested file tree for the explorer (folders first, then files, A→Z).
#[tauri::command]
pub fn read_file_tree(root: String, include_hidden: bool) -> Result<Vec<FsNode>, String> {
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
  for (rel, is_dir) in walk_entries(&root, include_hidden)? {
    let segments: Vec<String> = rel.split('/').map(String::from).collect();
    insert(&mut root_builder, &segments, is_dir);
  }
  Ok(build(root_builder, ""))
}

// ---------------------------------------------------------------------------
// Workspace search & replace
// ---------------------------------------------------------------------------

/// A single search hit inside a workspace file.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
  /// Workspace-relative path.
  path: String,
  /// 1-based line number.
  line: u32,
  /// 1-based char column where the match starts.
  column: u32,
  /// Match length in chars (differs from query length for regex hits).
  length: u32,
  /// The full text of the matched line.
  line_text: String,
}

/// A match the UI wants to replace (line/column exactly as returned by search).
#[derive(Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceTarget {
  path: String,
  line: u32,
  column: u32,
}

/// Per-file replace summary returned to the UI.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceSummary {
  path: String,
  count: u32,
}

/// How to match the query: literal substring or regular expression.
enum Matcher {
  Literal { needle: Vec<char>, case_sensitive: bool },
  Regex { re: Regex },
}

impl Matcher {
  fn new(query: &str, case_sensitive: bool, is_regex: bool) -> Result<Matcher, String> {
    if is_regex {
      let re = RegexBuilder::new(query)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("invalid regex: {e}"))?;
      Ok(Matcher::Regex { re })
    } else {
      Ok(Matcher::Literal {
        needle: query.chars().collect(),
        case_sensitive,
      })
    }
  }

  /// All (byte start, byte len) matches within one line, non-overlapping.
  fn find_in_line(&self, line: &str) -> Vec<(usize, usize)> {
    match self {
      Matcher::Regex { re } => re
        .find_iter(line)
        .filter(|m| m.end() > m.start()) // skip zero-width hits
        .map(|m| (m.start(), m.end() - m.start()))
        .collect(),
      Matcher::Literal { needle, case_sensitive } => {
        if needle.is_empty() {
          return Vec::new();
        }
        let indexed: Vec<(usize, char)> = line.char_indices().collect();
        let n = needle.len();
        let mut out = Vec::new();
        let mut i = 0;
        while i + n <= indexed.len() {
          let is_match = needle.iter().enumerate().all(|(j, nc)| {
            let lc = indexed[i + j].1;
            if *case_sensitive {
              lc == *nc
            } else {
              lc.to_lowercase().eq(nc.to_lowercase())
            }
          });
          if is_match {
            let start = indexed[i].0;
            let end = if i + n < indexed.len() {
              indexed[i + n].0
            } else {
              line.len()
            };
            out.push((start, end - start));
            i += n;
          } else {
            i += 1;
          }
        }
        out
      }
    }
  }

  /// Replacement text for one matched segment. Regex mode expands `$1`,
/// `${name}`, … capture references; literal mode inserts verbatim.
  fn replacement_for(&self, matched_text: &str, replacement: &str) -> String {
    match self {
      Matcher::Regex { re } => re.replace(matched_text, replacement).into_owned(),
      Matcher::Literal { .. } => replacement.to_string(),
    }
  }
}

/// Split comma-separated pattern strings (VSCode style) into trimmed globs.
fn split_patterns(s: &str) -> Vec<String> {
  s.split(',')
    .map(|p| p.trim())
    .filter(|p| !p.is_empty())
    .map(String::from)
    .collect()
}

/// Build gitignore-style glob filters for "files to include/exclude".
/// Both use plain (whitelist) patterns: `is_whitelist()` ⇔ a glob matched.
fn build_glob_filters(
  root: &Path,
  include: &str,
  exclude: &str,
) -> Result<(Override, Override), String> {
  let mut inc = OverrideBuilder::new(root);
  for p in split_patterns(include) {
    inc.add(&p)
      .map_err(|e| format!("invalid include pattern '{p}': {e}"))?;
  }
  let mut exc = OverrideBuilder::new(root);
  for p in split_patterns(exclude) {
    exc.add(&p)
      .map_err(|e| format!("invalid exclude pattern '{p}': {e}"))?;
  }
  Ok((
    inc.build().map_err(|e| e.to_string())?,
    exc.build().map_err(|e| e.to_string())?,
  ))
}

/// True when `rel` passes the include/exclude glob filters.
fn globs_allow(rel: &str, inc: &Override, exc: &Override) -> bool {
  // Empty include override matches nothing as whitelist → Match::None.
  // With globs present, non-matching files come back as Ignore.
  if inc.matched(rel, false).is_ignore() {
    return false;
  }
  if exc.matched(rel, false).is_whitelist() {
    return false;
  }
  true
}

/// A hit plus its byte span within the containing line (for replacement).
struct LineHit {
  line: u32,
  column: u32,
  length_chars: u32,
  /// Byte offset / length within the line body (no line terminator).
  byte_start: usize,
  byte_len: usize,
  line_text: String,
}

/// Split content into (body, eol) pairs, preserving each line's terminator
/// ("" / "\n" / "\r\n") so replacements don't reformat file endings.
fn split_lines_keep_eol(content: &str) -> Vec<(&str, &str)> {
  let mut out = Vec::new();
  for seg in content.split_inclusive('\n') {
    match seg.strip_suffix('\n') {
      Some(rest) => match rest.strip_suffix('\r') {
        Some(body) => out.push((body, "\r\n")),
        None => out.push((rest, "\n")),
      },
      None => out.push((seg, "")),
    }
  }
  if out.is_empty() && content.is_empty() {
    return out;
  }
  out
}

/// Scan one file's content for hits (shared by search and replace).
fn scan_content(matcher: &Matcher, content: &str) -> Vec<LineHit> {
  let lines = split_lines_keep_eol(content);
  let mut hits = Vec::new();
  for (line_idx, (body, _)) in lines.iter().enumerate() {
    for (byte_start, byte_len) in matcher.find_in_line(body) {
      hits.push(LineHit {
        line: (line_idx + 1) as u32,
        column: (body[..byte_start].chars().count() + 1) as u32,
        length_chars: body[byte_start..byte_start + byte_len].chars().count() as u32,
        byte_start,
        byte_len,
        line_text: body.to_string(),
      });
    }
  }
  hits
}

/// Iterate candidate files: the same .gitignore-aware walk as the explorer,
/// filtered by include/exclude globs, size-capped, UTF-8 only. Yields
/// (relative path, full path, content).
fn scan_files(
  root: &str,
  root_path: &Path,
  inc: &Override,
  exc: &Override,
  include_hidden: bool,
  mut f: impl FnMut(&str, &Path, &str),
) -> Result<(), String> {
  for (rel, is_dir) in walk_entries(root, include_hidden)? {
    if is_dir || !globs_allow(&rel, inc, exc) {
      continue;
    }
    let full = root_path.join(&rel);
    let Ok(meta) = std::fs::metadata(&full) else {
      continue;
    };
    if meta.len() > MAX_SEARCH_FILE_BYTES {
      continue;
    }
    let Ok(bytes) = std::fs::read(&full) else {
      continue;
    };
    let Ok(content) = String::from_utf8(bytes) else {
      continue; // binary / non-UTF-8
    };
    f(&rel, &full, &content);
  }
  Ok(())
}

/// Find all occurrences of `query` in workspace files. Respects .gitignore
/// (via `walk_entries`), the include/exclude glob filters, skips files over
/// the size cap and non-UTF-8 files, and stops after MAX_SEARCH_MATCHES hits.
/// One `SearchMatch` per occurrence, sorted by path, then line.
#[tauri::command]
pub fn search_files(
  root: String,
  query: String,
  case_sensitive: bool,
  is_regex: bool,
  include: String,
  exclude: String,
  include_hidden: bool,
) -> Result<Vec<SearchMatch>, String> {
  if query.is_empty() {
    return Ok(Vec::new());
  }
  let matcher = Matcher::new(&query, case_sensitive, is_regex)?;
  let root_path = std::fs::canonicalize(PathBuf::from(&root)).map_err(|e| e.to_string())?;
  let (inc, exc) = build_glob_filters(&root_path, &include, &exclude)?;

  let mut matches = Vec::new();
  scan_files(&root, &root_path, &inc, &exc, include_hidden, |rel, _full, content| {
    if matches.len() >= MAX_SEARCH_MATCHES {
      return;
    }
    for h in scan_content(&matcher, content) {
      matches.push(SearchMatch {
        path: rel.to_string(),
        line: h.line,
        column: h.column,
        length: h.length_chars,
        line_text: h.line_text,
      });
      if matches.len() >= MAX_SEARCH_MATCHES {
        break;
      }
    }
  })?;
  Ok(matches)
}

/// Replace occurrences of `query` with `replacement` on disk and return a
/// per-file summary. When `targets` is provided, only those exact hits
/// (path + 1-based line + 1-based char column, as returned by `search_files`)
/// are replaced — powering single-match and per-file replace; `None` replaces
/// everything. Regex mode expands `$1` capture references in the replacement.
/// Each target is re-validated by re-scanning, so stale results are skipped
/// safely instead of corrupting files.
#[tauri::command]
pub fn replace_in_files(
  root: String,
  query: String,
  replacement: String,
  case_sensitive: bool,
  is_regex: bool,
  include: String,
  exclude: String,
  include_hidden: bool,
  targets: Option<Vec<ReplaceTarget>>,
) -> Result<Vec<ReplaceSummary>, String> {
  if query.is_empty() {
    return Ok(Vec::new());
  }
  let matcher = Matcher::new(&query, case_sensitive, is_regex)?;
  let root_path = std::fs::canonicalize(PathBuf::from(&root)).map_err(|e| e.to_string())?;
  let (inc, exc) = build_glob_filters(&root_path, &include, &exclude)?;

  let target_list = targets.as_ref().map(|v| v.as_slice());
  let mut summaries = Vec::new();
  scan_files(&root, &root_path, &inc, &exc, include_hidden, |rel, full, content| {
    let hits = scan_content(&matcher, content);
    if hits.is_empty() {
      return;
    }
    let selected: Vec<&LineHit> = match target_list {
      Some(list) => hits
        .iter()
        .filter(|h| {
          list.iter()
            .any(|t| t.path == rel && t.line == h.line && t.column == h.column)
        })
        .collect(),
      None => hits.iter().collect(),
    };
    if selected.is_empty() {
      return;
    }

    // Rebuild line-by-line, right-to-left within each line, keeping the
    // original line terminators untouched.
    let lines = split_lines_keep_eol(content);
    let mut rebuilt: Vec<String> = lines
      .iter()
      .map(|(body, eol)| format!("{body}{eol}"))
      .collect();
    // Apply right-to-left (byte offsets are line-local and earlier
    // replacements shift the offsets of later hits on the same line).
    for h in selected.iter().rev() {
      let idx = (h.line - 1) as usize;
      let Some(body) = rebuilt.get_mut(idx) else {
        continue;
      };
      let line = std::mem::take(body);
      let (pre, rest) = line.split_at(h.byte_start);
      let (matched, post) = rest.split_at(h.byte_len);
      *body = format!("{pre}{}{post}", matcher.replacement_for(matched, &replacement));
    }
    let new_content = rebuilt.concat();
    if new_content != content && std::fs::write(full, new_content).is_ok() {
      summaries.push(ReplaceSummary {
        path: rel.to_string(),
        count: selected.len() as u32,
      });
    }
  })?;
  Ok(summaries)
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

/// Encode bytes as base64 (RFC 4648, standard alphabet, with padding).
/// Hand-rolled to avoid adding a crate dependency just for image previews.
fn base64_encode(bytes: &[u8]) -> String {
  const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
  for chunk in bytes.chunks(3) {
    let n = ((chunk[0] as u32) << 16)
      | ((*chunk.get(1).unwrap_or(&0) as u32) << 8)
      | (*chunk.get(2).unwrap_or(&0) as u32);
    out.push(ALPHABET[((n >> 18) & 63) as usize] as char);
    out.push(ALPHABET[((n >> 12) & 63) as usize] as char);
    out.push(if chunk.len() > 1 {
      ALPHABET[((n >> 6) & 63) as usize] as char
    } else {
      '='
    });
    out.push(if chunk.len() > 2 {
      ALPHABET[(n & 63) as usize] as char
    } else {
      '='
    });
  }
  out
}

/// Read a workspace file as base64, for binary previews (images) that the
/// text-only `read_file` rejects. Same `resolve_inside` path guard, with its
/// own 10 MiB size cap.
#[tauri::command]
pub fn read_file_binary(root: String, path: String) -> Result<String, String> {
  let full = resolve_inside(&root, &path)?;
  let meta = std::fs::metadata(&full).map_err(|e| e.to_string())?;
  if meta.len() > MAX_BINARY_FILE_BYTES {
    return Err(format!("file too large ({} bytes)", meta.len()));
  }
  let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
  Ok(base64_encode(&bytes))
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

/// Append content to a workspace file, creating it and parent directories if
/// missing. Same write guard as `write_file`. Used by the focus journal
/// (.zense/focus.log/…) so appends don't round-trip the whole file.
#[tauri::command]
pub fn append_file(root: String, path: String, content: String) -> Result<(), String> {
  let full = resolve_for_write(&root, &path)?;
  if let Some(parent) = full.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  use std::io::Write;
  let mut file = std::fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(&full)
    .map_err(|e| e.to_string())?;
  file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
  Ok(())
}

/// Atomic write: write to a sibling temp file, then rename over the target.
/// `rename` replaces an existing destination on the same filesystem, so the
/// target is never observed half-written (a crash mid-write leaves only the
/// temp file). Same write guard as `write_file`. Used for the focus snapshot
/// (.zense/focus.json), the source of truth on load.
#[tauri::command]
pub fn write_file_atomic(root: String, path: String, content: String) -> Result<(), String> {
  let full = resolve_for_write(&root, &path)?;
  if let Some(parent) = full.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let mut tmp_name = full
    .file_name()
    .ok_or_else(|| format!("invalid path: {path}"))?
    .to_os_string();
  tmp_name.push(".tmp");
  let tmp = full.with_file_name(tmp_name);
  std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
  if let Err(e) = std::fs::rename(&tmp, &full) {
    std::fs::remove_file(&tmp).ok();
    return Err(e.to_string());
  }
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

/// Copy one OS-dropped file/folder/symlink into the destination.
fn copy_dropped_entry(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
  let meta = std::fs::symlink_metadata(src)?;
  if meta.file_type().is_symlink() {
    #[cfg(unix)]
    {
      let target = std::fs::read_link(src)?;
      return std::os::unix::fs::symlink(&target, dst);
    }
    #[cfg(not(unix))]
    {
      // Symlink creation often needs elevated privileges on Windows; importing
      // the pointed-at content keeps drag-and-drop useful there.
      let resolved = std::fs::metadata(src)?;
      return if resolved.is_dir() {
        copy_dir_recursive(src, dst)
      } else {
        std::fs::copy(src, dst).map(|_| ())
      };
    }
  }
  if meta.is_dir() {
    copy_dir_recursive(src, dst)
  } else if meta.is_file() {
    std::fs::copy(src, dst).map(|_| ())
  } else {
    Err(std::io::Error::new(
      std::io::ErrorKind::InvalidInput,
      "unsupported filesystem entry",
    ))
  }
}

/// Import one or more files/folders dropped from the OS file manager into a
/// workspace directory. Sources may live anywhere on the user's filesystem,
/// but the destination always resolves inside the workspace. Names that would
/// collide use the same " copy" convention as in-workspace duplication, so a
/// Finder drop is never destructive. Returns workspace-relative paths in the
/// same order as `sources`.
#[tauri::command]
pub fn import_entries(
  root: String,
  sources: Vec<String>,
  dest_dir: String,
) -> Result<Vec<String>, String> {
  if sources.is_empty() {
    return Ok(Vec::new());
  }

  let root_canon = std::fs::canonicalize(PathBuf::from(&root)).map_err(|e| e.to_string())?;
  let dst_dir = if dest_dir.is_empty() || dest_dir == "." {
    root_canon.clone()
  } else {
    resolve_inside(&root, &dest_dir)?
  };
  let dst_meta = std::fs::metadata(&dst_dir).map_err(|e| e.to_string())?;
  if !dst_meta.is_dir() {
    return Err(format!("destination is not a directory: {dest_dir}"));
  }

  // Validate every source before mutating the workspace so a missing/invalid
  // drop path does not leave a half-imported batch behind.
  let mut validated = Vec::with_capacity(sources.len());
  for raw in sources {
    let src = PathBuf::from(&raw);
    let meta = std::fs::symlink_metadata(&src).map_err(|e| format!("{raw}: {e}"))?;
    if !meta.is_file() && !meta.is_dir() && !meta.file_type().is_symlink() {
      return Err(format!("unsupported filesystem entry: {raw}"));
    }
    let src_canon = std::fs::canonicalize(&src).map_err(|e| format!("{raw}: {e}"))?;

    // This blocks copying a directory into itself/descendant, including the
    // case where the dragged parent directory contains the workspace itself.
    if src_canon.is_dir() && dst_dir.starts_with(&src_canon) {
      return Err("cannot import a folder into itself".to_string());
    }

    let original_name = src
      .file_name()
      .map(|n| n.to_string_lossy().into_owned())
      .ok_or_else(|| format!("cannot determine file name: {raw}"))?;
    validated.push((src, original_name));
  }

  let mut imported = Vec::with_capacity(validated.len());
  for (src, original_name) in validated {
    let dst = unique_path_in_dir(&dst_dir, &original_name);
    copy_dropped_entry(&src, &dst).map_err(|e| format!("{}: {e}", src.display()))?;
    let rel = dst
      .strip_prefix(&root_canon)
      .map_err(|e| e.to_string())?
      .to_string_lossy()
      .replace('\\', "/");
    imported.push(rel);
  }
  Ok(imported)
}

/// Move one or more workspace-relative files/folders into a workspace
/// directory. This powers internal drag-and-drop in the file explorer. All
/// sources are validated before the first rename, so invalid batches do not
/// partially move their entries. Existing destination names receive the same
/// collision-safe " copy" names as imports and duplicates.
#[tauri::command]
pub fn move_entries(
  root: String,
  sources: Vec<String>,
  dest_dir: String,
) -> Result<Vec<String>, String> {
  if sources.is_empty() {
    return Ok(Vec::new());
  }

  let root_canon = std::fs::canonicalize(PathBuf::from(&root)).map_err(|e| e.to_string())?;
  let dst_dir = if dest_dir.is_empty() || dest_dir == "." {
    root_canon.clone()
  } else {
    resolve_inside(&root, &dest_dir)?
  };
  let dst_meta = std::fs::metadata(&dst_dir).map_err(|e| e.to_string())?;
  if !dst_meta.is_dir() {
    return Err(format!("destination is not a directory: {dest_dir}"));
  }

  struct Candidate {
    rel_path: String,
    source: PathBuf,
    name: String,
    parent: PathBuf,
    is_dir: bool,
  }

  let mut validated = Vec::with_capacity(sources.len());
  for rel_path in sources {
    if rel_path.is_empty() || rel_path == "." || rel_path == "./" {
      return Err("cannot move the workspace root".to_string());
    }
    let source = resolve_inside(&root, &rel_path)?;
    if source == root_canon {
      return Err("cannot move the workspace root".to_string());
    }
    let meta = std::fs::metadata(&source).map_err(|e| e.to_string())?;
    if meta.is_dir() && dst_dir.starts_with(&source) {
      return Err("cannot move a folder into itself".to_string());
    }
    let name = source
      .file_name()
      .map(|n| n.to_string_lossy().into_owned())
      .ok_or_else(|| format!("cannot determine file name: {rel_path}"))?;
    let parent = source
      .parent()
      .map(PathBuf::from)
      .ok_or_else(|| format!("cannot determine parent directory: {rel_path}"))?;
    validated.push(Candidate {
      rel_path,
      source,
      name,
      parent,
      is_dir: meta.is_dir(),
    });
  }

  // Moving a selected folder plus a descendant in one batch is ambiguous and
  // would invalidate the descendant before its turn, so reject it up front.
  for candidate in &validated {
    if validated.iter().any(|other| {
      other.is_dir && other.source != candidate.source && candidate.source.starts_with(&other.source)
    }) {
      return Err("cannot move a folder and its descendant in the same batch".to_string());
    }
  }

  let mut moved = Vec::with_capacity(validated.len());
  for candidate in validated {
    // No-op when dragging within the same parent; report the existing path.
    if candidate.parent == dst_dir {
      moved.push(candidate.rel_path);
      continue;
    }

    let dst = unique_path_in_dir(&dst_dir, &candidate.name);
    std::fs::rename(&candidate.source, &dst).map_err(|e| {
      format!("{} -> {}: {e}", candidate.rel_path, dst.display())
    })?;
    let rel = dst
      .strip_prefix(&root_canon)
      .map_err(|e| e.to_string())?
      .to_string_lossy()
      .replace('\\', "/");
    moved.push(rel);
  }
  Ok(moved)
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

    let files = list_files(root.clone(), true).unwrap();
    assert_eq!(files, vec![".gitignore", "src/keep.ts"]);

    let tree = read_file_tree(root, true).unwrap();
    let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
    assert_eq!(names, vec!["src", ".gitignore"]); // folders first
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn hidden_entries_are_shown_by_default_and_can_be_filtered() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::create_dir_all(dir.join(".git")).unwrap();
    fs::write(dir.join(".git/HEAD"), "x").unwrap();
    fs::create_dir_all(dir.join(".github/workflows")).unwrap();
    fs::write(dir.join(".github/workflows/ci.yml"), "x").unwrap();
    fs::write(dir.join(".env"), "x").unwrap();
    fs::create_dir_all(dir.join("src/.cache")).unwrap();
    fs::write(dir.join("src/.cache/tmp.ts"), "x").unwrap();
    fs::create_dir_all(dir.join("src/lib")).unwrap();
    fs::write(dir.join("src/lib/visible.ts"), "x").unwrap();

    let shown = list_files(root.clone(), true).unwrap();
    assert!(shown.contains(&".env".to_string()));
    assert!(shown.contains(&".github/workflows/ci.yml".to_string()));
    assert!(shown.contains(&"src/.cache/tmp.ts".to_string()));
    assert!(shown.contains(&"src/lib/visible.ts".to_string()));
    assert!(!shown.iter().any(|p| p.starts_with(".git/")));

    let hidden = list_files(root.clone(), false).unwrap();
    assert_eq!(hidden, vec!["src/lib/visible.ts"]);

    let tree = read_file_tree(root, false).unwrap();
    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].path, "src");
    assert_eq!(tree[0].children.as_ref().unwrap()[0].path, "src/lib");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn hidden_entry_filter_applies_to_search_and_replace() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join(".env"), "needle\n").unwrap();
    fs::create_dir_all(dir.join(".private")).unwrap();
    fs::write(dir.join(".private/secret.txt"), "needle\n").unwrap();
    fs::create_dir_all(dir.join("src/.cache")).unwrap();
    fs::write(dir.join("src/.cache/generated.ts"), "needle\n").unwrap();
    fs::write(dir.join("normal.txt"), "needle\n").unwrap();

    let shown = search_files(
      root.clone(),
      "needle".into(),
      false,
      false,
      String::new(),
      String::new(),
      true,
    )
    .unwrap();
    assert_eq!(shown.len(), 4);

    let hidden = search_files(
      root.clone(),
      "needle".into(),
      false,
      false,
      String::new(),
      String::new(),
      false,
    )
    .unwrap();
    assert_eq!(hidden.len(), 1);
    assert_eq!(hidden[0].path, "normal.txt");

    let summary = replace_in_files(
      root,
      "needle".into(),
      "changed".into(),
      false,
      false,
      String::new(),
      String::new(),
      false,
      None,
    )
    .unwrap();
    assert_eq!(summary.len(), 1);
    assert_eq!(summary[0].path, "normal.txt");
    assert_eq!(summary[0].count, 1);
    assert_eq!(fs::read_to_string(dir.join("normal.txt")).unwrap(), "changed\n");
    assert_eq!(fs::read_to_string(dir.join(".env")).unwrap(), "needle\n");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn read_file_tree_paths_have_no_leading_slash() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("a.txt"), "x").unwrap();
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(dir.join("src/keep.ts"), "x").unwrap();

    let tree = read_file_tree(root, true).unwrap();

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

  /// Test helper: literal, case-insensitive search without glob filters.
  fn search(root: String, query: &str) -> Vec<SearchMatch> {
    search_files(
      root,
      query.into(),
      false,
      false,
      String::new(),
      String::new(),
      true,
    )
    .unwrap()
  }

  #[test]
  fn search_files_finds_matches_with_positions() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(dir.join("src/a.ts"), "hello world\nHELLO again hello\n").unwrap();
    fs::write(dir.join("b.txt"), "nothing here\n").unwrap();

    // Case-insensitive: 3 hits across both lines, one per occurrence.
    let hits = search(root.clone(), "hello");
    assert_eq!(hits.len(), 3);
    assert!(hits.iter().all(|h| h.path == "src/a.ts"));
    assert_eq!(hits[0].line, 1);
    assert_eq!(hits[0].column, 1);
    assert_eq!(hits[0].length, 5);
    assert_eq!(hits[1].line, 2);
    assert_eq!(hits[1].column, 1);
    assert_eq!(hits[2].line, 2);
    assert_eq!(hits[2].column, 13);
    assert_eq!(hits[0].line_text, "hello world");

    // Case-sensitive: only the lowercase ones.
    let hits = search_files(
      root.clone(),
      "hello".into(),
      true,
      false,
      String::new(),
      String::new(),
      true,
    )
    .unwrap();
    assert_eq!(hits.len(), 2);

    assert!(search(root.clone(), "nope").is_empty());
    assert!(search(root, "").is_empty());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn search_files_respects_gitignore_and_skips_binary() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join(".gitignore"), "ignored/\n").unwrap();
    fs::create_dir_all(dir.join("ignored")).unwrap();
    fs::write(dir.join("ignored/x.txt"), "needle\n").unwrap();
    fs::write(dir.join("bin.dat"), b"needle\x00\xff".to_vec()).unwrap();
    fs::write(dir.join("keep.txt"), "needle\n").unwrap();

    let hits = search(root, "needle");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].path, "keep.txt");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn search_files_regex_mode_reports_match_length() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("a.ts"), "foo bar foobar x9x x99x\n").unwrap();

    let hits = search_files(
      root.clone(),
      "x\\d+x".into(),
      true,
      true,
      String::new(),
      String::new(),
      true,
    )
    .unwrap();
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].column, 16);
    assert_eq!(hits[0].length, 3); // x9x
    assert_eq!(hits[1].length, 4); // x99x

    // Invalid regex surfaces a readable error.
    let err = search_files(
      root,
      "[".into(),
      true,
      true,
      String::new(),
      String::new(),
      true,
    )
    .unwrap_err();
    assert!(err.contains("invalid regex"), "unexpected error: {err}");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn search_files_include_exclude_globs() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(dir.join("src/a.ts"), "needle\n").unwrap();
    fs::write(dir.join("src/b.js"), "needle\n").unwrap();
    fs::write(dir.join("c.ts"), "needle\n").unwrap();

    let run = |inc: &str, exc: &str| {
      let mut paths: Vec<String> = search_files(
        root.clone(),
        "needle".into(),
        false,
        false,
        inc.into(),
        exc.into(),
        true,
      )
      .unwrap()
      .into_iter()
      .map(|h| h.path)
      .collect();
      paths.sort();
      paths
    };

    // Include only .ts files.
    assert_eq!(run("*.ts", ""), vec!["c.ts", "src/a.ts"]);

    // Include .ts but exclude c.ts.
    assert_eq!(run("*.ts", "c.ts"), vec!["src/a.ts"]);

    // Comma-separated include list.
    assert_eq!(run("*.ts, *.js", "c.ts"), vec!["src/a.ts", "src/b.js"]);

    // Dir-scoped include.
    assert_eq!(run("src/**", "*.js"), vec!["src/a.ts"]);

    // Invalid include pattern is an error.
    let err = search_files(
      root.clone(),
      "needle".into(),
      false,
      false,
      "[".into(),
      String::new(),
      true,
    )
    .unwrap_err();
    assert!(err.contains("invalid include pattern"), "unexpected: {err}");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn replace_in_files_replaces_all_occurrences() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(dir.join("src/a.ts"), "hello hello\nbye hello\n").unwrap();
    fs::write(dir.join("b.txt"), "hello\n").unwrap();

    let summary = replace_in_files(
      root.clone(),
      "hello".into(),
      "hi".into(),
      true,
      false,
      String::new(),
      String::new(),
      true,
      None,
    )
    .unwrap();
    assert_eq!(summary.len(), 2);
    let a = summary.iter().find(|s| s.path == "src/a.ts").unwrap();
    assert_eq!(a.count, 3);
    assert_eq!(fs::read_to_string(dir.join("src/a.ts")).unwrap(), "hi hi\nbye hi\n");
    assert_eq!(fs::read_to_string(dir.join("b.txt")).unwrap(), "hi\n");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn replace_in_files_regex_captures() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("a.ts"), "foo(bar)\nfoo(baz)\n").unwrap();

    let summary = replace_in_files(
      root.clone(),
      "foo\\((\\w+)\\)".into(),
      "qux[$1]".into(),
      true,
      true,
      String::new(),
      String::new(),
      true,
      None,
    )
    .unwrap();
    assert_eq!(summary[0].count, 2);
    assert_eq!(fs::read_to_string(dir.join("a.ts")).unwrap(), "qux[bar]\nqux[baz]\n");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn replace_in_files_honors_targets_and_literal_dollar() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("a.txt"), "one one one\ntwo one\n").unwrap();

    // Replace only the 2nd hit on line 1 (char column 5) and the hit on line 2.
    let targets = vec![
      ReplaceTarget { path: "a.txt".into(), line: 1, column: 5 },
      ReplaceTarget { path: "a.txt".into(), line: 2, column: 5 },
    ];
    let summary = replace_in_files(
      root.clone(),
      "one".into(),
      "$'$".into(),
      true,
      false,
      String::new(),
      String::new(),
      true,
      Some(targets),
    )
    .unwrap();
    assert_eq!(summary[0].count, 2);
    // Literal replacement: $ is NOT expanded outside regex mode.
    assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "one $'$ one\ntwo $'$\n");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn replace_in_files_preserves_crlf_and_respects_globs() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    std::fs::write(dir.join("win.txt"), "a needle\r\nb needle\r\n").unwrap();
    std::fs::write(dir.join("skip.md"), "needle\n").unwrap();

    replace_in_files(
      root.clone(),
      "needle".into(),
      "x".into(),
      true,
      false,
      "*.txt".into(),
      String::new(),
      true,
      None,
    )
    .unwrap();
    assert_eq!(fs::read_to_string(dir.join("win.txt")).unwrap(), "a x\r\nb x\r\n");
    assert_eq!(fs::read_to_string(dir.join("skip.md")).unwrap(), "needle\n");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn base64_encode_known_vectors() {
    assert_eq!(base64_encode(b""), "");
    assert_eq!(base64_encode(b"f"), "Zg==");
    assert_eq!(base64_encode(b"fo"), "Zm8=");
    assert_eq!(base64_encode(b"foo"), "Zm9v");
    assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
    // Non-UTF-8 bytes round-trip through the encoder.
    assert_eq!(base64_encode(&[0xff, 0xfe, 0xfd]), "//79");
    // PNG magic header.
    assert_eq!(
      base64_encode(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "iVBORw0KGgo="
    );
  }

  #[test]
  fn read_file_binary_reads_non_utf8_and_guards() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    fs::write(dir.join("pic.png"), [0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe].to_vec()).unwrap();

    // Binary content that read_file rejects comes back as base64 here.
    assert!(read_file(root.clone(), "pic.png".into()).is_err());
    assert_eq!(
      read_file_binary(root.clone(), "pic.png".into()).unwrap(),
      "iVBOR//+"
    );

    // Path escape is rejected.
    assert!(read_file_binary(root
      .clone(), "../nope.png".into())
    .is_err());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn read_file_binary_rejects_oversized_file() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    // Sparse file just over the cap — no need to write 10 MiB of data.
    let f = fs::File::create(dir.join("huge.png")).unwrap();
    f.set_len(MAX_BINARY_FILE_BYTES + 1).unwrap();

    let err = read_file_binary(root, "huge.png".into()).unwrap_err();
    assert!(err.contains("file too large"), "unexpected error: {err}");
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
  fn append_file_creates_and_appends() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    append_file(root.clone(), ".zense/focus.log/2026-08.jsonl".into(), "l1\n".into()).unwrap();
    append_file(root.clone(), ".zense/focus.log/2026-08.jsonl".into(), "l2\n".into()).unwrap();
    assert_eq!(
      read_file(root, ".zense/focus.log/2026-08.jsonl".into()).unwrap(),
      "l1\nl2\n"
    );
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn append_file_rejects_traversal() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    assert!(append_file(root, "../../etc/zense-test-append".into(), "x".into()).is_err());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn write_file_atomic_overwrites_and_cleans_tmp() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    write_file_atomic(root.clone(), ".zense/focus.json".into(), "{}\n".into()).unwrap();
    write_file_atomic(root.clone(), ".zense/focus.json".into(), "{\"v\":1}\n".into()).unwrap();
    assert_eq!(
      read_file(root, ".zense/focus.json".into()).unwrap(),
      "{\"v\":1}\n"
    );
    // temp file must be gone after a successful rename
    assert!(!dir.join(".zense/focus.json.tmp").exists());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn write_file_atomic_rejects_traversal() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    assert!(write_file_atomic(root, "../../etc/zense-test-atomic".into(), "x".into()).is_err());
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

  #[test]
  fn import_entries_copies_files_and_folders_recursively() {
    let workspace = temp_ws();
    let root = workspace.to_string_lossy().into_owned();
    let source = temp_ws();
    create_dir(root.clone(), "dest".into()).unwrap();
    fs::create_dir_all(source.join("bundle/nested")).unwrap();
    fs::write(source.join("bundle/nested/a.txt"), "from finder\n").unwrap();
    fs::write(source.join("notes.md"), "notes\n").unwrap();

    let imported = import_entries(
      root.clone(),
      vec![
        source.join("bundle").to_string_lossy().into_owned(),
        source.join("notes.md").to_string_lossy().into_owned(),
      ],
      "dest".into(),
    )
    .unwrap();

    assert_eq!(imported, vec!["dest/bundle", "dest/notes.md"]);
    assert_eq!(
      fs::read_to_string(workspace.join("dest/bundle/nested/a.txt")).unwrap(),
      "from finder\n"
    );
    assert_eq!(
      fs::read_to_string(workspace.join("dest/notes.md")).unwrap(),
      "notes\n"
    );
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&source).ok();
  }

  #[test]
  fn import_entries_auto_renames_collisions_without_overwriting() {
    let workspace = temp_ws();
    let root = workspace.to_string_lossy().into_owned();
    let source = temp_ws();
    create_dir(root.clone(), "dest".into()).unwrap();
    fs::write(workspace.join("dest/report.txt"), "original\n").unwrap();
    fs::write(source.join("report.txt"), "incoming\n").unwrap();

    let imported = import_entries(
      root.clone(),
      vec![source.join("report.txt").to_string_lossy().into_owned()],
      "dest".into(),
    )
    .unwrap();

    assert_eq!(imported, vec!["dest/report copy.txt"]);
    assert_eq!(
      fs::read_to_string(workspace.join("dest/report.txt")).unwrap(),
      "original\n"
    );
    assert_eq!(
      fs::read_to_string(workspace.join("dest/report copy.txt")).unwrap(),
      "incoming\n"
    );
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&source).ok();
  }

  #[test]
  fn import_entries_handles_duplicate_names_within_one_batch() {
    let workspace = temp_ws();
    let root = workspace.to_string_lossy().into_owned();
    let source_a = temp_ws();
    let source_b = temp_ws();
    create_dir(root.clone(), "dest".into()).unwrap();
    fs::write(source_a.join("same.txt"), "one\n").unwrap();
    fs::write(source_b.join("same.txt"), "two\n").unwrap();

    let imported = import_entries(
      root.clone(),
      vec![
        source_a.join("same.txt").to_string_lossy().into_owned(),
        source_b.join("same.txt").to_string_lossy().into_owned(),
      ],
      "dest".into(),
    )
    .unwrap();

    assert_eq!(imported, vec!["dest/same.txt", "dest/same copy.txt"]);
    assert_eq!(fs::read_to_string(workspace.join("dest/same.txt")).unwrap(), "one\n");
    assert_eq!(
      fs::read_to_string(workspace.join("dest/same copy.txt")).unwrap(),
      "two\n"
    );
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&source_a).ok();
    fs::remove_dir_all(&source_b).ok();
  }

  #[test]
  fn import_entries_rejects_destination_traversal() {
    let workspace = temp_ws();
    let root = workspace.to_string_lossy().into_owned();
    let source = temp_ws();
    let outside = workspace.parent().unwrap().join("zense-import-escape");
    fs::create_dir_all(&outside).unwrap();
    fs::write(source.join("a.txt"), "x\n").unwrap();

    let err = import_entries(
      root,
      vec![source.join("a.txt").to_string_lossy().into_owned()],
      "../zense-import-escape".into(),
    )
    .unwrap_err();

    assert!(err.contains("escapes workspace"), "unexpected error: {err}");
    assert!(!outside.join("a.txt").exists());
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&source).ok();
    fs::remove_dir_all(&outside).ok();
  }

  #[test]
  fn import_entries_rejects_folder_into_itself_or_parent_of_workspace() {
    let workspace = temp_ws();
    let root = workspace.to_string_lossy().into_owned();
    create_dir(root.clone(), "pkg/inner".into()).unwrap();
    write_file(root.clone(), "pkg/a.txt".into(), "x\n".into()).unwrap();

    let err = import_entries(
      root.clone(),
      vec![workspace.join("pkg").to_string_lossy().into_owned()],
      "pkg/inner".into(),
    )
    .unwrap_err();
    assert!(err.contains("into itself"), "unexpected error: {err}");
    assert!(!workspace.join("pkg/inner/pkg").exists());

    let parent = workspace.parent().unwrap().to_string_lossy().into_owned();
    let err = import_entries(root, vec![parent], ".".into()).unwrap_err();
    assert!(err.contains("into itself"), "unexpected error: {err}");
    fs::remove_dir_all(&workspace).ok();
  }

  #[test]
  fn import_entries_validates_batch_before_mutating_workspace() {
    let workspace = temp_ws();
    let root = workspace.to_string_lossy().into_owned();
    let source = temp_ws();
    create_dir(root.clone(), "dest".into()).unwrap();
    fs::write(source.join("good.txt"), "x\n").unwrap();

    let err = import_entries(
      root,
      vec![
        source.join("good.txt").to_string_lossy().into_owned(),
        source.join("missing.txt").to_string_lossy().into_owned(),
      ],
      "dest".into(),
    )
    .unwrap_err();

    assert!(err.contains("missing.txt"), "unexpected error: {err}");
    assert!(!workspace.join("dest/good.txt").exists());
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&source).ok();
  }

  #[test]
  fn move_entries_moves_multiple_files_and_folders() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    create_dir(root.clone(), "src/pkg".into()).unwrap();
    create_dir(root.clone(), "docs".into()).unwrap();
    create_dir(root.clone(), "target".into()).unwrap();
    write_file(root.clone(), "src/pkg/a.ts".into(), "a\n".into()).unwrap();
    write_file(root.clone(), "docs/readme.md".into(), "docs\n".into()).unwrap();

    let moved = move_entries(
      root,
      vec!["src".into(), "docs/readme.md".into()],
      "target".into(),
    )
    .unwrap();

    assert_eq!(moved, vec!["target/src", "target/readme.md"]);
    assert!(!dir.join("src").exists());
    assert!(!dir.join("docs/readme.md").exists());
    assert_eq!(fs::read_to_string(dir.join("target/src/pkg/a.ts")).unwrap(), "a\n");
    assert_eq!(fs::read_to_string(dir.join("target/readme.md")).unwrap(), "docs\n");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn move_entries_auto_renames_collisions_within_batch() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    create_dir(root.clone(), "one".into()).unwrap();
    create_dir(root.clone(), "two".into()).unwrap();
    create_dir(root.clone(), "dest".into()).unwrap();
    write_file(root.clone(), "dest/a.txt".into(), "original\n".into()).unwrap();
    write_file(root.clone(), "one/a.txt".into(), "one\n".into()).unwrap();
    write_file(root.clone(), "two/a.txt".into(), "two\n".into()).unwrap();

    let moved = move_entries(
      root,
      vec!["one/a.txt".into(), "two/a.txt".into()],
      "dest".into(),
    )
    .unwrap();

    assert_eq!(moved, vec!["dest/a copy.txt", "dest/a copy 2.txt"]);
    assert_eq!(fs::read_to_string(dir.join("dest/a.txt")).unwrap(), "original\n");
    assert_eq!(fs::read_to_string(dir.join("dest/a copy.txt")).unwrap(), "one\n");
    assert_eq!(fs::read_to_string(dir.join("dest/a copy 2.txt")).unwrap(), "two\n");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn move_entries_rejects_source_and_destination_traversal() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    write_file(root.clone(), "a.txt".into(), "x\n".into()).unwrap();

    assert!(move_entries(root.clone(), vec!["../a.txt".into()], ".".into()).is_err());
    assert!(move_entries(root.clone(), vec!["a.txt".into()], "../".into()).is_err());
    assert!(dir.join("a.txt").exists());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn move_entries_rejects_folder_into_itself_and_root_source() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    create_dir(root.clone(), "pkg/inner".into()).unwrap();
    write_file(root.clone(), "pkg/a.txt".into(), "x\n".into()).unwrap();

    let err = move_entries(root.clone(), vec!["pkg".into()], "pkg/inner".into()).unwrap_err();
    assert!(err.contains("into itself"), "unexpected error: {err}");
    assert!(dir.join("pkg/a.txt").exists());
    assert!(!dir.join("pkg/inner/pkg").exists());

    assert!(move_entries(root, vec![".".into()], ".".into()).is_err());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn move_entries_rejects_folder_and_descendant_in_same_batch_without_mutation() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    create_dir(root.clone(), "pkg/inner".into()).unwrap();
    create_dir(root.clone(), "dest".into()).unwrap();
    write_file(root.clone(), "pkg/inner/a.txt".into(), "x\n".into()).unwrap();

    let err = move_entries(
      root,
      vec!["pkg".into(), "pkg/inner/a.txt".into()],
      "dest".into(),
    )
    .unwrap_err();

    assert!(err.contains("descendant"), "unexpected error: {err}");
    assert!(dir.join("pkg/inner/a.txt").exists());
    assert!(!dir.join("dest/pkg").exists());
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn move_entries_validates_batch_before_mutation_and_rejects_file_destination() {
    let dir = temp_ws();
    let root = dir.to_string_lossy().into_owned();
    create_dir(root.clone(), "one".into()).unwrap();
    write_file(root.clone(), "one/a.txt".into(), "x\n".into()).unwrap();
    write_file(root.clone(), "target-file".into(), "not a dir\n".into()).unwrap();

    let err = move_entries(
      root.clone(),
      vec!["one/a.txt".into(), "missing.txt".into()],
      "one".into(),
    )
    .unwrap_err();
    assert!(err.contains("No such file"), "unexpected error: {err}");
    assert!(dir.join("one/a.txt").exists());

    let err = move_entries(root, vec!["one/a.txt".into()], "target-file".into()).unwrap_err();
    assert!(err.contains("not a directory"), "unexpected error: {err}");
    assert!(dir.join("one/a.txt").exists());
    fs::remove_dir_all(&dir).ok();
  }
}

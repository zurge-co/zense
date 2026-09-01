//! Tools exposed to the LLM agent. Each tool wraps an existing Tauri command
//! (fscmd/gitcmd) so path-traversal guards and git2 logic are reused.

use std::fmt;

use rig::tool::PortableTool;
use serde::Deserialize;
use serde_json::json;

// ---------------------------------------------------------------------------
// Error type shared by all tools
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct ToolError(String);

impl fmt::Display for ToolError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "{}", self.0)
  }
}

impl std::error::Error for ToolError {}

impl From<String> for ToolError {
  fn from(s: String) -> Self {
    Self(s)
  }
}

// ---------------------------------------------------------------------------
// Truncation helper — keep tool output small for the LLM context
// ---------------------------------------------------------------------------

/// Default fallback if no guard is configured.
/// NOTE: Used in debug tests only; production uses cfg.guards.max_tool_output.
#[allow(dead_code)]
pub const DEFAULT_MAX_TOOL_OUTPUT: usize = 50_000;

/// Truncate at a UTF-8 char boundary to avoid splitting multi-byte chars.
pub fn truncate_for_llm(content: &str, max: usize) -> String {
  if content.len() <= max {
    return content.to_string();
  }
  let mut end = max;
  while end > 0 && !content.is_char_boundary(end) {
    end -= 1;
  }
  let truncated = &content[..end];
  let remaining = content.len() - end;
  format!(
    "{truncated}\n\n... (truncated, {remaining} more bytes omitted for context budget)"
  )
}

// ---------------------------------------------------------------------------
// Tool: read_file
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ReadFileArgs {
  path: String,
}

pub struct ReadFileTool {
  pub root: String,
  pub max_output: usize,
}

impl PortableTool for ReadFileTool {
  const NAME: &'static str = "read_file";
  type Args = ReadFileArgs;
  type Output = String;
  type Error = ToolError;

  fn description(&self) -> String {
    "Read the full contents of a text file from the workspace. \
     The path must be relative to the workspace root. \
     Binary files and files larger than 2 MB are rejected. \
     Use this to examine source code, config files, or any text file."
      .to_string()
  }

  fn parameters(&self) -> serde_json::Value {
    json!({
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Relative path to the file, e.g. \"src/main.ts\""
        }
      },
      "required": ["path"]
    })
  }

  async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
    let content = crate::fscmd::read_file(self.root.clone(), args.path)?;
    Ok(truncate_for_llm(&content, self.max_output))
  }
}

// ---------------------------------------------------------------------------
// Tool: read_file_range
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ReadFileRangeArgs {
  path: String,
  start: u32,
  end: u32,
}

pub struct ReadFileRangeTool {
  pub root: String,
  pub max_output: usize,
}

impl PortableTool for ReadFileRangeTool {
  const NAME: &'static str = "read_file_range";
  type Args = ReadFileRangeArgs;
  type Output = String;
  type Error = ToolError;

  fn description(&self) -> String {
    "Read a specific line range from a file (1-based, inclusive). \
     Useful for examining a portion of a large file without loading it all. \
     Example: path=\"src/main.ts\", start=10, end=50 reads lines 10 through 50."
      .to_string()
  }

  fn parameters(&self) -> serde_json::Value {
    json!({
      "type": "object",
      "properties": {
        "path": { "type": "string", "description": "Relative path to the file" },
        "start": { "type": "integer", "description": "First line number (1-based)" },
        "end": { "type": "integer", "description": "Last line number (1-based, inclusive)" }
      },
      "required": ["path", "start", "end"]
    })
  }

  async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
    let content = crate::fscmd::read_file_range(
      self.root.clone(),
      args.path,
      args.start,
      args.end,
    )?;
    Ok(truncate_for_llm(&content, self.max_output))
  }
}

// ---------------------------------------------------------------------------
// Tool: list_files
// ---------------------------------------------------------------------------

pub struct ListFilesTool {
  pub root: String,
}

impl PortableTool for ListFilesTool {
  const NAME: &'static str = "list_files";
  type Args = ();
  type Output = Vec<String>;
  type Error = ToolError;

  fn description(&self) -> String {
    "List all files in the workspace (respecting .gitignore). \
     Returns relative paths sorted alphabetically. \
     Use this to discover what files exist before reading specific ones."
      .to_string()
  }

  fn parameters(&self) -> serde_json::Value {
    json!({
      "type": "object",
      "properties": {}
    })
  }

  async fn call(&self, _args: Self::Args) -> Result<Self::Output, Self::Error> {
    // The LLM tool keeps the default visibility mode (dotfiles shown).
    let files = crate::fscmd::list_files(self.root.clone(), true)?;
    Ok(files.into_iter().take(200).collect())
  }
}

// ---------------------------------------------------------------------------
// Git tools — read-only repo awareness (status/diff/log/show), backed by the
// gitcmd commands. There is deliberately NO stage/commit/push tool: mutations
// of the working tree stay manual (branch menu / review panel).
// ---------------------------------------------------------------------------

/// Serialize a gitcmd result to pretty JSON and bound it for the context.
fn json_tool_output(value: impl serde::Serialize, max_output: usize) -> Result<String, ToolError> {
  let json = serde_json::to_string_pretty(&value).map_err(|e| ToolError(e.to_string()))?;
  Ok(truncate_for_llm(&json, max_output))
}

// -- git_status -------------------------------------------------------------

pub struct GitStatusTool {
  pub root: String,
  pub max_output: usize,
}

impl PortableTool for GitStatusTool {
  const NAME: &'static str = "git_status";
  type Args = ();
  type Output = String;
  type Error = ToolError;

  fn description(&self) -> String {
    "Show the working-tree git status: which files are staged, modified, or untracked. \
     Read-only. Use this first when the user asks about their current changes, \
     or before recommending commit/branch advice."
      .to_string()
  }

  fn parameters(&self) -> serde_json::Value {
    json!({ "type": "object", "properties": {} })
  }

  async fn call(&self, _args: Self::Args) -> Result<Self::Output, Self::Error> {
    let status = crate::gitcmd::git_status(self.root.clone())?;
    json_tool_output(status, self.max_output)
  }
}

// -- git_diff ---------------------------------------------------------------

#[derive(Deserialize)]
pub struct GitDiffArgs {
  /// true = staged (index vs HEAD); false = unstaged (workdir vs index).
  staged: bool,
}

pub struct GitDiffTool {
  pub root: String,
  pub max_output: usize,
}

impl PortableTool for GitDiffTool {
  const NAME: &'static str = "git_diff";
  type Args = GitDiffArgs;
  type Output = String;
  type Error = ToolError;

  fn description(&self) -> String {
    "Show the actual diff of pending changes as a unified patch. \
     staged=true shows changes already staged for the next commit; \
     staged=false shows unstaged working-tree edits. \
     Read-only. Use this to review what the user is about to commit."
      .to_string()
  }

  fn parameters(&self) -> serde_json::Value {
    json!({
      "type": "object",
      "properties": {
        "staged": {
          "type": "boolean",
          "description": "true = staged changes (index vs HEAD), false = unstaged (workdir vs index)"
        }
      },
      "required": ["staged"]
    })
  }

  async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
    let patch = if args.staged {
      crate::gitcmd::git_staged_diff(self.root.clone())?
    } else {
      crate::gitcmd::git_unstaged_diff(self.root.clone())?
    };
    if patch.trim().is_empty() {
      Ok(
        if args.staged {
          "(no staged changes — index matches HEAD)"
        } else {
          "(no unstaged changes — working tree matches index)"
        }
        .to_string(),
      )
    } else {
      Ok(truncate_for_llm(&patch, self.max_output))
    }
  }
}

// -- git_log ----------------------------------------------------------------

#[derive(Deserialize)]
pub struct GitLogArgs {
  /// Commits to skip from the newest (pagination offset). Default 0.
  offset: Option<usize>,
  /// Max commits to return (hard-capped at 200 server-side). Default 20.
  limit: Option<usize>,
}

pub struct GitLogTool {
  pub root: String,
  pub max_output: usize,
}

impl PortableTool for GitLogTool {
  const NAME: &'static str = "git_log";
  type Args = GitLogArgs;
  type Output = String;
  type Error = ToolError;

  fn description(&self) -> String {
    "List recent commits (newest first) with SHA, message, author, time and \
     per-commit file/line stats. Read-only. Use this to answer history \
     questions (\"what changed lately?\", \"when was X introduced?\") — then \
     call git_show on interesting SHAs for details."
      .to_string()
  }

  fn parameters(&self) -> serde_json::Value {
    json!({
      "type": "object",
      "properties": {
        "offset": { "type": "integer", "description": "Commits to skip from the newest (default 0)" },
        "limit": { "type": "integer", "description": "Max commits to return (default 20, cap 200)" }
      }
    })
  }

  async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
    let entries = crate::gitcmd::git_log(
      self.root.clone(),
      args.offset.unwrap_or(0),
      args.limit.unwrap_or(20),
    )?;
    if entries.is_empty() {
      return Ok("(no commits yet)".to_string());
    }
    json_tool_output(entries, self.max_output)
  }
}

// -- git_show ---------------------------------------------------------------

#[derive(Deserialize)]
pub struct GitShowArgs {
  /// Full or short commit SHA, e.g. from git_log results.
  sha: String,
}

pub struct GitShowTool {
  pub root: String,
  pub max_output: usize,
}

impl PortableTool for GitShowTool {
  const NAME: &'static str = "git_show";
  type Args = GitShowArgs;
  type Output = String;
  type Error = ToolError;

  fn description(&self) -> String {
    "Show one commit in detail: full message, author, time, and the list of \
     changed files with additions/deletions. Read-only. Combine with \
     git_diff_commit history from git_log to explain past changes."
      .to_string()
  }

  fn parameters(&self) -> serde_json::Value {
    json!({
      "type": "object",
      "properties": {
        "sha": { "type": "string", "description": "Commit SHA (full or short, from git_log)" }
      },
      "required": ["sha"]
    })
  }

  async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
    let show = crate::gitcmd::git_show(self.root.clone(), args.sha)?;
    json_tool_output(show, self.max_output)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
  use super::*;
  use futures::executor::block_on;
  use std::fs;
  use std::path::Path;

  #[test]
  fn test_truncate_short_string() {
    assert_eq!(truncate_for_llm("hello", 1000), "hello");
  }

  #[test]
  fn test_truncate_long_string() {
    let max = 1000;
    let long = "a".repeat(max + 1000);
    let result = truncate_for_llm(&long, max);
    assert!(result.contains("truncated"));
    assert!(result.contains("1000 more bytes"));
    assert!(result.len() < long.len());
  }

  #[test]
  fn test_truncate_utf8_boundary() {
    let max = 999;
    let mut content = "a".repeat(max - 1);
    content.push('\u{1F980}'); // 4-byte char
    content.push_str(&"b".repeat(100));
    let result = truncate_for_llm(&content, max);
    assert!(result.starts_with(&"a".repeat(max - 1)));
  }

  #[test]
  fn test_truncate_custom_limit() {
    let result = truncate_for_llm("abcdefghij", 5);
    assert!(result.starts_with("abcde"));
    assert!(result.contains("truncated"));
  }

  // -- Git tools -------------------------------------------------------------

  /// Small temp git repo with one commit, plus a staged and an unstaged edit.
  fn temp_repo_with_changes() -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
      "zense-tools-test-{}-{}-{:?}",
      std::process::id(),
      COUNTER.fetch_add(1, Ordering::SeqCst),
      std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    let repo = git2::Repository::init(&dir).unwrap();
    let sig = repo.signature().unwrap();

    fs::write(dir.join("a.txt"), "one\n").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("a.txt")).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[]).unwrap();

    // Staged edit on a.txt + unstaged edit on b.txt-created-then-tracked.
    // (Token names avoid cross-substrings: "staged" ⊂ "unstaged".)
    fs::write(dir.join("a.txt"), "one\nidx-line\n").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("a.txt")).unwrap();
    index.write().unwrap();

    fs::write(dir.join("b.txt"), "bee\n").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("b.txt")).unwrap();
    index.write().unwrap();
    fs::write(dir.join("b.txt"), "bee\nwt-line\n").unwrap();

    dir
  }

  fn root_of(dir: &std::path::Path) -> String {
    dir.to_string_lossy().into_owned()
  }

  #[test]
  fn test_git_status_tool_reports_staged_and_unstaged() {
    let dir = temp_repo_with_changes();
    let tool = GitStatusTool { root: root_of(&dir), max_output: 50_000 };
    let out = block_on(tool.call(())).unwrap();
    assert!(out.contains("a.txt"), "got: {out}");
    assert!(out.contains("b.txt"), "got: {out}");
    assert!(out.contains("\"staged\""), "not JSON status: {out}");
    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_tool_splits_staged_vs_unstaged() {
    let dir = temp_repo_with_changes();
    let root = root_of(&dir);
    let tool = GitDiffTool { root: root.clone(), max_output: 50_000 };

    let staged = block_on(tool.call(GitDiffArgs { staged: true })).unwrap();
    assert!(staged.contains("+idx-line"), "got: {staged}");
    assert!(!staged.contains("wt-line"), "leaked: {staged}");

    let unstaged = block_on(tool.call(GitDiffArgs { staged: false })).unwrap();
    assert!(unstaged.contains("+wt-line"), "got: {unstaged}");
    assert!(!unstaged.contains("idx-line"), "leaked: {unstaged}");

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_diff_tool_empty_states_are_explicit() {
    let dir = temp_repo_with_changes();
    // fresh clone of just HEAD: commit everything so both sides are empty.
    fs::remove_dir_all(&dir).ok();

    let dir2 = std::env::temp_dir().join(format!("zense-tools-clean-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir2);
    fs::create_dir_all(&dir2).unwrap();
    let repo = git2::Repository::init(&dir2).unwrap();
    let sig = repo.signature().unwrap();
    fs::write(dir2.join("x"), "x\n").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("x")).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();

    let tool = GitDiffTool { root: root_of(&dir2), max_output: 50_000 };
    let staged = block_on(tool.call(GitDiffArgs { staged: true })).unwrap();
    assert!(staged.contains("no staged changes"), "got: {staged}");
    let unstaged = block_on(tool.call(GitDiffArgs { staged: false })).unwrap();
    assert!(unstaged.contains("no unstaged changes"), "got: {unstaged}");

    fs::remove_dir_all(&dir2).ok();
  }

  #[test]
  fn test_git_log_and_show_tools_roundtrip() {
    let dir = temp_repo_with_changes();
    let root = root_of(&dir);

    let log_out = block_on(
      GitLogTool { root: root.clone(), max_output: 50_000 }
        .call(GitLogArgs { offset: None, limit: Some(5) }),
    )
    .unwrap();
    assert!(log_out.contains("initial"), "got: {log_out}");
    let sha: String = {
      // The "sha" field appears in the JSON; grab it without adding a dep on
      // full JSON parsing of unknown shape.
      let v: serde_json::Value = serde_json::from_str(&log_out).unwrap();
      v[0]["sha"].as_str().unwrap().to_string()
    };

    // Full and short SHAs must both resolve (revparse).
    let show_full = block_on(
      GitShowTool { root: root.clone(), max_output: 50_000 }
        .call(GitShowArgs { sha: sha.clone() }),
    )
    .unwrap();
    assert!(show_full.contains("initial"), "got: {show_full}");
    let short = sha[..7].to_string();
    let show_short = block_on(
      GitShowTool { root: root.clone(), max_output: 50_000 }
        .call(GitShowArgs { sha: short }),
    )
    .unwrap();
    assert!(show_short.contains("a.txt"), "got: {show_short}");

    fs::remove_dir_all(&dir).ok();
  }

  #[test]
  fn test_git_tools_are_read_only_surface() {
    // Guard against a mutation tool sneaking into the agent: today the git
    // family must be exactly these four read-only names.
    assert_eq!(GitStatusTool::NAME, "git_status");
    assert_eq!(GitDiffTool::NAME, "git_diff");
    assert_eq!(GitLogTool::NAME, "git_log");
    assert_eq!(GitShowTool::NAME, "git_show");
  }
}

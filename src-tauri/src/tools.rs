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
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
  use super::*;

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
}

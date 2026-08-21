//! LLM configuration and provider client construction.
//! Uses rig for provider abstraction (OpenAI / Anthropic + custom base URLs).

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Config types (shared with frontend via Tauri IPC)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LlmApiFormat {
  OpenaiCompatible,
  AnthropicCompatible,
}

/// Which tools the AI agent is allowed to use. Toggles are persisted
/// in the LLM config so the user can disable tools they don't want
/// the agent to access.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnabledTools {
  pub read_file: bool,
  pub read_file_range: bool,
  pub list_files: bool,
}

impl Default for EnabledTools {
  fn default() -> Self {
    Self {
      read_file: true,
      read_file_range: true,
      list_files: true,
    }
  }
}

/// Safety guards for the agent loop. Prevents runaway tool chains
/// and excessive context consumption.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGuards {
  /// Maximum number of tool-calling turns before the loop aborts.
  /// Default: 20. Range: 1–100.
  pub max_turns: u32,
  /// Maximum bytes of a single tool's output sent to the LLM.
  /// Larger results are truncated. Default: 50000. Range: 1000–500000.
  pub max_tool_output: usize,
}

impl Default for AgentGuards {
  fn default() -> Self {
    Self {
      max_turns: 20,
      max_tool_output: 50_000,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
  pub api_format: LlmApiFormat,
  pub base_url: String,
  /// None or empty = no auth header (for local providers like Ollama).
  pub api_key: Option<String>,
  pub model: String,
  #[serde(default)]
  pub enabled_tools: EnabledTools,
  #[serde(default)]
  pub guards: AgentGuards,
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// Validate base_url (required, must be http(s)://) and model (required).
/// API key is optional — omitted for local providers like Ollama.
/// Also clamps guard values to sane ranges.
pub fn validate_config(cfg: &LlmConfig) -> Result<(), String> {
  if cfg.model.trim().is_empty() {
    return Err("model is required".to_string());
  }
  if cfg.base_url.trim().is_empty() {
    return Err("base URL is required".to_string());
  }
  let url = &cfg.base_url;
  if !url.starts_with("http://") && !url.starts_with("https://") {
    return Err("base URL must start with http:// or https://".to_string());
  }
  // Clamp guards to valid ranges.
  if cfg.guards.max_turns == 0 {
    return Err("max_turns must be at least 1".to_string());
  }
  if cfg.guards.max_turns > 100 {
    return Err("max_turns must not exceed 100".to_string());
  }
  if cfg.guards.max_tool_output < 1000 {
    return Err("max_tool_output must be at least 1000".to_string());
  }
  if cfg.guards.max_tool_output > 500_000 {
    return Err("max_tool_output must not exceed 500000".to_string());
  }
  Ok(())
}

// ---------------------------------------------------------------------------
// Stream events (emitted to frontend via Tauri Channel)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
  /// Incremental text from the assistant.
  TextDelta { text: String },
  /// The model started a tool call.
  ToolCallStart { id: String, name: String },
  /// A tool call finished (success or error).
  ToolCallEnd {
    id: String,
    success: bool,
    preview: String,
  },
  /// The whole run is done.
  Done,
  /// An error occurred.
  Error { message: String },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
  use super::*;

  fn test_cfg() -> LlmConfig {
    LlmConfig {
      api_format: LlmApiFormat::OpenaiCompatible,
      base_url: "https://api.openai.com".into(),
      api_key: Some("sk-test".into()),
      model: "gpt-4o".into(),
      enabled_tools: EnabledTools::default(),
      guards: AgentGuards::default(),
    }
  }

  #[test]
  fn test_validate_rejects_empty_model() {
    let mut cfg = test_cfg();
    cfg.model = "".into();
    assert!(validate_config(&cfg).unwrap_err().contains("model"));
  }

  #[test]
  fn test_validate_rejects_empty_base_url() {
    let mut cfg = test_cfg();
    cfg.base_url = "".into();
    assert!(validate_config(&cfg).unwrap_err().contains("base URL"));
  }

  #[test]
  fn test_validate_rejects_invalid_url() {
    let mut cfg = test_cfg();
    cfg.base_url = "ftp://bad".into();
    cfg.api_key = None;
    assert!(validate_config(&cfg).unwrap_err().contains("http"));
  }

  #[test]
  fn test_validate_accepts_ollama_no_key() {
    let mut cfg = test_cfg();
    cfg.base_url = "http://localhost:11434".into();
    cfg.api_key = None;
    cfg.model = "llama3".into();
    assert!(validate_config(&cfg).is_ok());
  }

  #[test]
  fn test_validate_accepts_anthropic_https() {
    let mut cfg = test_cfg();
    cfg.api_format = LlmApiFormat::AnthropicCompatible;
    cfg.base_url = "https://api.anthropic.com".into();
    cfg.api_key = Some("sk-ant-test".into());
    cfg.model = "claude-sonnet-4-20250514".into();
    assert!(validate_config(&cfg).is_ok());
  }

  #[test]
  fn test_validate_rejects_zero_max_turns() {
    let mut cfg = test_cfg();
    cfg.guards.max_turns = 0;
    assert!(validate_config(&cfg).unwrap_err().contains("max_turns"));
  }

  #[test]
  fn test_validate_rejects_excessive_max_turns() {
    let mut cfg = test_cfg();
    cfg.guards.max_turns = 101;
    assert!(validate_config(&cfg).unwrap_err().contains("max_turns"));
  }

  #[test]
  fn test_validate_rejects_tiny_max_tool_output() {
    let mut cfg = test_cfg();
    cfg.guards.max_tool_output = 500;
    assert!(validate_config(&cfg).unwrap_err().contains("max_tool_output"));
  }

  #[test]
  fn test_serde_defaults_for_old_config() {
    // Simulate an old config JSON that doesn't have enabled_tools or guards.
    let json = r#"{
      "apiFormat": "openaiCompatible",
      "baseUrl": "https://api.openai.com",
      "apiKey": "sk-test",
      "model": "gpt-4o"
    }"#;
    let cfg: LlmConfig = serde_json::from_str(json).unwrap();
    assert!(cfg.enabled_tools.read_file);
    assert!(cfg.enabled_tools.list_files);
    assert_eq!(cfg.guards.max_turns, 20);
    assert_eq!(cfg.guards.max_tool_output, 50_000);
  }
}

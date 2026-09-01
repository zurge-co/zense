//! Chat Tauri commands: chat_send (streaming with tool loop) and
//! llm_test_connection. Uses rig's agent + stream_prompt for the full loop.

use std::sync::Arc;

use futures::StreamExt;
use rig::agent::MultiTurnStreamItem;
use rig::client::AgentClientExt;
use rig::completion::Prompt;
use rig::providers::{anthropic, openai};
use rig::streaming::{StreamedAssistantContent, StreamingPrompt};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::llm::{self, LlmConfig, StreamEvent};
use crate::tools::{
  GitDiffTool, GitLogTool, GitShowTool, GitStatusTool, ListFilesTool, ReadFileRangeTool,
  ReadFileTool,
};

/// Typestate-safe conditional tool chaining. rig's agent builder changes
/// type at every `.tool()` call, so flags can't drive plain `if` rebindings.
/// This macro expands to nested `if/else` arms — one per flag — and every
/// arm ends in `.build()`, which unifies all branches to `Agent`.
macro_rules! apply_tools {
  ($b:expr;) => { $b.build() };
  ($b:expr; $flag:expr => $tool:expr, $($rest:tt)*) => {{
    if $flag {
      let b = $b.tool($tool);
      apply_tools!(b; $($rest)*)
    } else {
      apply_tools!($b; $($rest)*)
    }
  }};
}

/// The full optional-tool list for a freshly configured agent builder.
/// Order matters for the generated API surface but not behavior.
macro_rules! with_optional_tools {
  ($builder:expr, $et:expr, $root:expr, $max_out:expr) => {
    apply_tools!($builder;
      $et.read_file => ReadFileTool { root: $root.into(), max_output: $max_out },
      $et.read_file_range => ReadFileRangeTool { root: $root.into(), max_output: $max_out },
      $et.list_files => ListFilesTool { root: $root.into() },
      $et.git_tools => GitStatusTool { root: $root.into(), max_output: $max_out },
      $et.git_tools => GitDiffTool { root: $root.into(), max_output: $max_out },
      $et.git_tools => GitLogTool { root: $root.into(), max_output: $max_out },
      $et.git_tools => GitShowTool { root: $root.into(), max_output: $max_out },
    )
  };
}

// ---------------------------------------------------------------------------
// IPC message types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "lowercase")]
pub enum IpcMessage {
  User { content: String },
  Assistant { content: String },
}

// ---------------------------------------------------------------------------
// Build a rig agent from the user's LLM config
// ---------------------------------------------------------------------------

fn build_agent(
  cfg: &LlmConfig,
  system_prompt: &str,
  root: &str,
) -> Result<rig::agent::Agent, String> {
  llm::validate_config(cfg)?;

  let key = cfg.api_key.as_deref().unwrap_or("").to_string();
  let max_out = cfg.guards.max_tool_output;
  let max_turns = cfg.guards.max_turns as usize;
  let et = &cfg.enabled_tools;

  let max_tokens = 4096;

  let agent = match cfg.api_format {
    llm::LlmApiFormat::OpenaiCompatible => {
      // `.completions_api()`: keep using the classic /chat/completions endpoint.
      // rig 0.42's default OpenAI client targets the newer Responses API
      // (/responses), which most OpenAI-compatible providers (Ollama,
      // LM Studio, vLLM, OpenRouter, ...) don't implement.
      let client = openai::Client::builder()
        .api_key(key)
        .base_url(cfg.base_url.clone())
        .build()
        .map_err(|e| e.to_string())?
        .completions_api();
      let builder = client
        .agent(&cfg.model)
        .preamble(system_prompt)
        .max_tokens(max_tokens)
        .default_max_turns(max_turns);
      with_optional_tools!(builder, et, root, max_out)
    }
    llm::LlmApiFormat::AnthropicCompatible => {
      let client = anthropic::Client::builder()
        .api_key(key)
        .base_url(cfg.base_url.clone())
        .build()
        .map_err(|e| e.to_string())?;
      let builder = client
        .agent(&cfg.model)
        .preamble(system_prompt)
        .max_tokens(max_tokens)
        .default_max_turns(max_turns);
      with_optional_tools!(builder, et, root, max_out)
    }
  };

  Ok(agent)
}

// ---------------------------------------------------------------------------
// Tauri command: chat_send (streaming)
// ---------------------------------------------------------------------------

/// Send a chat message with streaming + tool loop. The agent automatically
/// calls tools (read_file, list_files, etc.) as needed, and streams text
/// deltas back via the Channel.
#[tauri::command]
pub async fn chat_send(
  config: LlmConfig,
  system_prompt: String,
  messages: Vec<IpcMessage>,
  root: String,
  on_event: Channel<StreamEvent>,
) -> Result<String, String> {
  let agent = build_agent(&config, &system_prompt, &root)?;

  // Last user message is the prompt; everything before it is chat history
  // so the agent keeps multi-turn context.
  let prompt_idx = messages
    .iter()
    .rposition(|m| matches!(m, IpcMessage::User { .. }))
    .ok_or_else(|| "no user message".to_string())?;
  let prompt = match &messages[prompt_idx] {
    IpcMessage::User { content } => content.clone(),
    _ => unreachable!(),
  };
  let history: Vec<rig::completion::Message> = messages[..prompt_idx]
    .iter()
    .map(|m| match m {
      IpcMessage::User { content } => rig::completion::Message::user(content.clone()),
      IpcMessage::Assistant { content } => {
        rig::completion::Message::assistant(content.clone())
      }
    })
    .collect();

  let mut stream = agent.stream_prompt(&prompt).history(history).await;
  let final_text = Arc::new(std::sync::Mutex::new(String::new()));

  while let Some(item) = stream.next().await {
    match item {
      Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(text))) => {
        let _ = on_event.send(StreamEvent::TextDelta {
          text: text.text.clone(),
        });
        final_text.lock().unwrap().push_str(&text.text);
      }
      Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::ToolCall {
        tool_call,
        ..
      })) => {
        let _ = on_event.send(StreamEvent::ToolCallStart {
          id: tool_call.id.to_string(),
          name: tool_call.function.name.clone(),
        });
        let _ = on_event.send(StreamEvent::ToolCallEnd {
          id: tool_call.id.to_string(),
          success: true,
          preview: String::new(),
        });
      }
      Ok(MultiTurnStreamItem::FinalResponse(response)) => {
        let text = final_text.lock().unwrap().clone();
        let result = if text.is_empty() {
          response.output.clone()
        } else {
          text
        };
        let _ = on_event.send(StreamEvent::Done);
        return Ok(result);
      }
      Ok(_) => {}
      Err(e) => {
        let msg = e.to_string();
        let safe = if msg.contains("api_key") || msg.contains("API key") {
          "LLM request failed (check your API key in Settings)".to_string()
        } else {
          msg
        };
        let _ = on_event.send(StreamEvent::Error {
          message: safe.clone(),
        });
        return Err(safe);
      }
    }
  }

  let text = final_text.lock().unwrap().clone();
  let _ = on_event.send(StreamEvent::Done);
  Ok(text)
}

// ---------------------------------------------------------------------------
// Tauri command: llm_test_connection
// ---------------------------------------------------------------------------

/// Send a minimal "Hi" prompt (no tools, no streaming) to verify the
/// configuration works. Returns the model's reply or an error.
#[tauri::command]
pub async fn llm_test_connection(config: LlmConfig) -> Result<String, String> {
  llm::validate_config(&config)?;
  let agent = build_agent(&config, "You are a test endpoint. Reply briefly.", ".")?;
  let reply = agent
    .prompt("Hi")
    .max_turns(1)
    .await
    .map_err(|e| {
      let msg = e.to_string();
      if msg.contains("api_key") || msg.contains("API key") {
        "Authentication failed (check your API key)".to_string()
      } else {
        msg
      }
    })?;
  Ok(reply)
}

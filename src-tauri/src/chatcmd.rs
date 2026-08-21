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
use crate::tools::{ListFilesTool, ReadFileRangeTool, ReadFileTool};

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
      let client = openai::Client::builder()
        .api_key(key)
        .base_url(cfg.base_url.clone())
        .build()
        .map_err(|e| e.to_string())?;

      // Chain tools conditionally. The first .tool() transitions the builder
      // typestate from NoToolConfig → WithBuilderTools; subsequent calls are
        // fine on WithBuilderTools. If no tools are enabled, build bare.
      if et.read_file {
        let b = client
          .agent(&cfg.model)
          .preamble(system_prompt)
          .max_tokens(max_tokens)
          .default_max_turns(max_turns)
          .tool(ReadFileTool { root: root.into(), max_output: max_out });
        let b = if et.read_file_range {
          b.tool(ReadFileRangeTool { root: root.into(), max_output: max_out })
        } else {
          b
        };
        let b = if et.list_files {
          b.tool(ListFilesTool { root: root.into() })
        } else {
          b
        };
        b.build()
      } else if et.read_file_range {
        let b = client
          .agent(&cfg.model)
          .preamble(system_prompt)
          .max_tokens(max_tokens)
          .default_max_turns(max_turns)
          .tool(ReadFileRangeTool { root: root.into(), max_output: max_out });
        let b = if et.list_files {
          b.tool(ListFilesTool { root: root.into() })
        } else {
          b
        };
        b.build()
      } else if et.list_files {
        client
          .agent(&cfg.model)
          .preamble(system_prompt)
          .max_tokens(max_tokens)
          .default_max_turns(max_turns)
          .tool(ListFilesTool { root: root.into() })
          .build()
      } else {
        client
          .agent(&cfg.model)
          .preamble(system_prompt)
          .max_tokens(max_tokens)
          .default_max_turns(max_turns)
          .build()
      }
    }
    llm::LlmApiFormat::AnthropicCompatible => {
      let client = anthropic::Client::builder()
        .api_key(key)
        .base_url(cfg.base_url.clone())
        .build()
        .map_err(|e| e.to_string())?;

      if et.read_file {
        let b = client
          .agent(&cfg.model)
          .preamble(system_prompt)
          .max_tokens(max_tokens)
          .default_max_turns(max_turns)
          .tool(ReadFileTool { root: root.into(), max_output: max_out });
        let b = if et.read_file_range {
          b.tool(ReadFileRangeTool { root: root.into(), max_output: max_out })
        } else {
          b
        };
        let b = if et.list_files {
          b.tool(ListFilesTool { root: root.into() })
        } else {
          b
        };
        b.build()
      } else if et.read_file_range {
        let b = client
          .agent(&cfg.model)
          .preamble(system_prompt)
          .max_tokens(max_tokens)
          .default_max_turns(max_turns)
          .tool(ReadFileRangeTool { root: root.into(), max_output: max_out });
        let b = if et.list_files {
          b.tool(ListFilesTool { root: root.into() })
        } else {
          b
        };
        b.build()
      } else if et.list_files {
        client
          .agent(&cfg.model)
          .preamble(system_prompt)
          .max_tokens(max_tokens)
          .default_max_turns(max_turns)
          .tool(ListFilesTool { root: root.into() })
          .build()
      } else {
        client
          .agent(&cfg.model)
          .preamble(system_prompt)
          .max_tokens(max_tokens)
          .default_max_turns(max_turns)
          .build()
      }
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

  let prompt = messages
    .iter()
    .rev()
    .find_map(|m| match m {
      IpcMessage::User { content } => Some(content.clone()),
      _ => None,
    })
    .ok_or_else(|| "no user message".to_string())?;

  let mut stream = agent.stream_prompt(&prompt).await;
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

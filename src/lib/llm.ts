import { invoke, Channel } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { isTauri } from "./workspace";

export interface EnabledTools {
  readFile: boolean;
  readFileRange: boolean;
  listFiles: boolean;
  /** Read-only git awareness: git_status / git_diff / git_log / git_show.
   *  Mutations (stage/commit/push) stay manual by design. */
  gitTools: boolean;
}

export interface AgentGuards {
  maxTurns: number;
  maxToolOutput: number;
}

export interface LlmConfig {
  apiFormat: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  model: string;
  enabledTools: EnabledTools;
  guards: AgentGuards;
}

export const DEFAULT_ENABLED_TOOLS: EnabledTools = {
  readFile: true,
  readFileRange: true,
  listFiles: true,
  gitTools: true,
};

export const DEFAULT_GUARDS: AgentGuards = {
  maxTurns: 20,
  maxToolOutput: 50_000,
};

export type StreamEvent =
  | { type: "textDelta"; text: string }
  | { type: "toolCallStart"; id: string; name: string }
  | { type: "toolCallEnd"; id: string; success: boolean; preview: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface IpcMessage {
  role: "user" | "assistant";
  content: string;
}

const STORE_FILE = "llm-config.json";
const STORE_KEY = "config";

/** Ensure a config loaded from the store has all fields (migrate old saves). */
function migrateConfig(cfg: Partial<LlmConfig>): LlmConfig {
  return {
    apiFormat: cfg.apiFormat ?? "openai",
    baseUrl: cfg.baseUrl ?? "",
    apiKey: cfg.apiKey ?? "",
    model: cfg.model ?? "",
    enabledTools: { ...DEFAULT_ENABLED_TOOLS, ...cfg.enabledTools },
    guards: { ...DEFAULT_GUARDS, ...cfg.guards },
  };
}

export async function loadLlmConfig(): Promise<LlmConfig | null> {
  if (!isTauri()) return null;
  try {
    const store = await Store.load(STORE_FILE);
    const raw = await store.get<Partial<LlmConfig>>(STORE_KEY);
    return raw ? migrateConfig(raw) : null;
  } catch {
    return null;
  }
}

export async function saveLlmConfig(config: LlmConfig): Promise<void> {
  if (!isTauri()) return;
  try {
    const store = await Store.load(STORE_FILE);
    await store.set(STORE_KEY, config);
    await store.save();
  } catch (err) {
    console.error("Failed to save LLM config:", err);
  }
}

/** Convert frontend config to the Rust backend's expected format. */
function toBackendConfig(config: LlmConfig) {
  return {
    apiFormat: config.apiFormat === "openai" ? "openaiCompatible" : "anthropicCompatible",
    baseUrl: config.baseUrl,
    apiKey: config.apiKey || null,
    model: config.model,
    enabledTools: {
      readFile: config.enabledTools.readFile,
      readFileRange: config.enabledTools.readFileRange,
      listFiles: config.enabledTools.listFiles,
      gitTools: config.enabledTools.gitTools,
    },
    guards: {
      maxTurns: config.guards.maxTurns,
      maxToolOutput: config.guards.maxToolOutput,
    },
  };
}

export async function chatSend(
  config: LlmConfig,
  systemPrompt: string,
  messages: IpcMessage[],
  root: string,
  onEvent: (e: StreamEvent) => void,
): Promise<string> {
  if (!isTauri()) {
    onEvent({ type: "textDelta", text: "AI chat is not available in browser dev mode." });
    onEvent({ type: "done" });
    return "AI chat is not available in browser dev mode.";
  }
  const channel = new Channel<StreamEvent>();
  channel.onmessage = (e) => onEvent(e);
  return invoke<string>("chat_send", {
    config: toBackendConfig(config),
    systemPrompt,
    messages,
    root,
    onEvent: channel,
  });
}

export async function llmTestConnection(config: LlmConfig): Promise<string> {
  if (!isTauri()) return "ok (browser dev)";
  return invoke<string>("llm_test_connection", {
    config: toBackendConfig(config),
  });
}

import { create } from "zustand";
import {
  chatSend,
  loadLlmConfig,
  saveLlmConfig,
  type LlmConfig,
  type IpcMessage,
  type StreamEvent,
} from "../lib/llm";
import { systemPrompt } from "../lib/systemPrompt";

export interface ToolCallIndicator {
  id: string;
  name: string;
  done: boolean;
  preview?: string;
}

interface ChatState {
  messages: IpcMessage[];
  streaming: boolean;
  streamingText: string;
  activeTools: ToolCallIndicator[];
  error: string | null;
  config: LlmConfig | null;
  configLoaded: boolean;

  loadConfig: () => Promise<void>;
  saveConfig: (config: LlmConfig) => Promise<void>;
  send: (text: string, workspaceRoot: string) => Promise<void>;
  clear: () => void;
  isConfigured: () => boolean;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  streaming: false,
  streamingText: "",
  activeTools: [],
  error: null,
  config: null,
  configLoaded: false,

  loadConfig: async () => {
    const cfg = await loadLlmConfig();
    set({ config: cfg, configLoaded: true });
  },

  saveConfig: async (config) => {
    await saveLlmConfig(config);
    set({ config });
  },

  send: async (text, workspaceRoot) => {
    const { config, streaming } = get();
    if (!config || streaming) return;

    set({
      streaming: true,
      error: null,
      streamingText: "",
      activeTools: [],
    });

    const userMsg: IpcMessage = { role: "user", content: text };
    const allMessages = [...get().messages, userMsg];
    set({ messages: allMessages });

    const sysPrompt = systemPrompt(workspaceRoot);

    try {
      const finalText = await chatSend(config, sysPrompt, allMessages, workspaceRoot, (e: StreamEvent) => {
        switch (e.type) {
          case "textDelta":
            set((s) => ({ streamingText: s.streamingText + e.text }));
            break;
          case "toolCallStart":
            set((s) => ({
              activeTools: [...s.activeTools, { id: e.id, name: e.name, done: false }],
            }));
            break;
          case "toolCallEnd":
            set((s) => ({
              activeTools: s.activeTools.map((t) =>
                t.id === e.id ? { ...t, done: true, preview: e.preview } : t,
              ),
            }));
            break;
          case "error":
            set({ error: e.message });
            break;
          case "done":
            break;
        }
      });

      const assistantMsg: IpcMessage = { role: "assistant", content: finalText };
      set((s) => ({
        messages: [...s.messages, assistantMsg],
        streaming: false,
        streamingText: "",
        activeTools: [],
      }));
    } catch (err) {
      set({
        streaming: false,
        streamingText: "",
        activeTools: [],
        error: String(err),
      });
    }
  },

  clear: () => set({ messages: [], error: null, streamingText: "" }),

  isConfigured: () => {
    const { config } = get();
    return !!config && !!config.model && !!config.baseUrl;
  },
}));

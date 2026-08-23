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
  /** Abort the in-flight stream (UI-level: ignores further events/resolution).
   *  The backend agent run continues until it finishes — rig streams have no
   *  cancel signal; partial text already streamed is kept as a message. */
  stop: () => void;
  clear: () => void;
  isConfigured: () => boolean;
}

/** Monotonic generation id; every send() bumps it and captures its value.
 *  Events/resolutions from stale generations are ignored. */
let nextGen = 0;

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

    const gen = ++nextGen;
    const stale = () => nextGen !== gen;

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
        if (stale()) return;
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

      if (!stale()) {
        const assistantMsg: IpcMessage = { role: "assistant", content: finalText };
        set((s) => ({
          messages: [...s.messages, assistantMsg],
          streaming: false,
          streamingText: "",
          activeTools: [],
        }));
      }
    } catch (err) {
      if (!stale()) {
        set({
          streaming: false,
          streamingText: "",
          activeTools: [],
          error: String(err),
        });
      }
    }
  },

  stop: () => {
    const { streaming, streamingText } = get();
    if (!streaming) return;
    // Invalidate the generation so late events are ignored, but keep whatever
    // partial text already streamed as an assistant message.
    nextGen++;
    set((s) => ({
      streaming: false,
      activeTools: [],
      streamingText: "",
      messages: streamingText
        ? [...s.messages, { role: "assistant", content: streamingText }]
        : s.messages,
    }));
  },

  clear: () => {
    // Also invalidate any in-flight generation so a late resolution can't
    // resurrect messages after the user cleared the conversation.
    nextGen++;
    set({ messages: [], error: null, streamingText: "", streaming: false, activeTools: [] });
  },

  isConfigured: () => {
    const { config } = get();
    return !!config && !!config.model && !!config.baseUrl;
  },
}));

/**
 * AI Review store — unlike chatStore's single conversation, every review
 * trigger (summarize change, review all, bug hunt, explain chunk) opens its
 * own thread so results stay separated and each thread supports follow-up
 * questions. Streaming/state machinery mirrors chatStore: per-thread
 * generation ids guard against stale stream events; stop() keeps the
 * partial streamed text as a message.
 */
import { create } from "zustand";
import { errMessage } from "../lib/errors";
import {
  chatSend,
  loadLlmConfig,
  type LlmConfig,
  type IpcMessage,
  type StreamEvent,
} from "../lib/llm";
import { systemPrompt } from "../lib/systemPrompt";
import { userBubbleLabel, type AiReviewKind } from "../lib/aiReviewPrompts";

export interface ReviewToolCall {
  id: string;
  name: string;
  done: boolean;
  preview?: string;
}

export interface AiReviewThread {
  id: string;
  kind: AiReviewKind;
  /** Short title shown on the thread chip. */
  title: string;
  /** Short user-facing bubble (the full prompt is message[0].content). */
  bubble: string;
  messages: IpcMessage[];
  streaming: boolean;
  streamingText: string;
  activeTools: ReviewToolCall[];
  error: string | null;
}

interface AiReviewState {
  threads: AiReviewThread[];
  activeThreadId: string | null;
  config: LlmConfig | null;
  configLoaded: boolean;

  loadConfig: () => Promise<void>;
  /** Create a thread, kick off the agent run, return the thread id. */
  startReview: (args: {
    kind: AiReviewKind;
    title: string;
    bubble?: string;
    prompt: string;
    root: string;
  }) => string;
  /** Follow-up question inside an existing thread. No-op while streaming. */
  followUp: (threadId: string, text: string, root: string) => void;
  /** Stop the in-flight run; partial text is kept as an assistant message. */
  stop: (threadId: string) => void;
  closeThread: (threadId: string) => void;
  isConfigured: () => boolean;
}

/** Monotonic generation id per thread; bump to invalidate in-flight runs. */
const gens = new Map<string, number>();
let nextThread = 0;

function bumpGen(threadId: string): number {
  const next = (gens.get(threadId) ?? 0) + 1;
  gens.set(threadId, next);
  return next;
}

export const useAiReviewStore = create<AiReviewState>((set, get) => {
  const patchThread = (id: string, patch: Partial<AiReviewThread>) =>
    set((s) => ({
      threads: s.threads.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));

  const patchThreadFn = (id: string, fn: (t: AiReviewThread) => Partial<AiReviewThread>) =>
    set((s) => ({
      threads: s.threads.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)),
    }));

  /** Shared agent run for the first prompt and for follow-ups. */
  const runAgent = async (threadId: string, root: string) => {
    const { config } = get();
    if (!config) return;

    const gen = bumpGen(threadId);
    const stale = () => gens.get(threadId) !== gen;

    patchThread(threadId, {
      streaming: true,
      error: null,
      streamingText: "",
      activeTools: [],
    });

    const onEvent = (e: StreamEvent) => {
      if (stale()) return;
      switch (e.type) {
        case "textDelta":
          patchThreadFn(threadId, (t) => ({ streamingText: t.streamingText + e.text }));
          break;
        case "toolCallStart":
          patchThreadFn(threadId, (t) => ({
            activeTools: [...t.activeTools, { id: e.id, name: e.name, done: false }],
          }));
          break;
        case "toolCallEnd":
          patchThreadFn(threadId, (t) => ({
            activeTools: t.activeTools.map((tool) =>
              tool.id === e.id ? { ...tool, done: true, preview: e.preview } : tool,
            ),
          }));
          break;
        case "error":
          patchThread(threadId, { error: e.message });
          break;
        case "done":
          break;
      }
    };

    try {
      const thread = get().threads.find((t) => t.id === threadId);
      if (!thread) return;
      const finalText = await chatSend(
        config,
        systemPrompt(root, config.preferredLanguage),
        thread.messages,
        root,
        onEvent,
      );
      if (stale()) return;
      patchThreadFn(threadId, (t) => ({
        messages: [...t.messages, { role: "assistant", content: finalText }],
        streaming: false,
        streamingText: "",
        activeTools: [],
      }));
    } catch (err) {
      if (stale()) return;
      patchThread(threadId, {
        streaming: false,
        streamingText: "",
        activeTools: [],
        error: errMessage(err),
      });
    }
  };

  return {
    threads: [],
    activeThreadId: null,
    config: null,
    configLoaded: false,

    loadConfig: async () => {
      const cfg = await loadLlmConfig();
      set({ config: cfg, configLoaded: true });
    },

    startReview: ({ kind, title, bubble, prompt, root }) => {
      const id = `review-${Date.now()}-${++nextThread}`;
      const thread: AiReviewThread = {
        id,
        kind,
        title,
        bubble: bubble ?? userBubbleLabel(kind),
        messages: [{ role: "user", content: prompt }],
        streaming: false,
        streamingText: "",
        activeTools: [],
        error: null,
      };
      set((s) => ({ threads: [thread, ...s.threads], activeThreadId: id }));
      void runAgent(id, root);
      return id;
    },

    followUp: (threadId, text, root) => {
      const thread = get().threads.find((t) => t.id === threadId);
      const { config } = get();
      if (!thread || thread.streaming || !config || !text.trim()) return;
      patchThreadFn(threadId, (t) => ({
        messages: [...t.messages, { role: "user", content: text.trim() }],
      }));
      void runAgent(threadId, root);
    },

    stop: (threadId) => {
      const thread = get().threads.find((t) => t.id === threadId);
      if (!thread || !thread.streaming) return;
      // Invalidate the generation so late events are ignored; keep whatever
      // partial text already streamed as an assistant message.
      bumpGen(threadId);
      patchThreadFn(threadId, (t) => ({
        streaming: false,
        activeTools: [],
        streamingText: "",
        messages: t.streamingText
          ? [...t.messages, { role: "assistant", content: t.streamingText }]
          : t.messages,
      }));
    },

    closeThread: (threadId) => {
      // Invalidate any in-flight run so its resolution can't resurrect the
      // thread's state after removal.
      bumpGen(threadId);
      set((s) => {
        const threads = s.threads.filter((t) => t.id !== threadId);
        return {
          threads,
          activeThreadId:
            s.activeThreadId === threadId
              ? (threads[0]?.id ?? null)
              : s.activeThreadId,
        };
      });
    },

    isConfigured: () => {
      const { config } = get();
      return !!config && !!config.model && !!config.baseUrl;
    },
  };
});

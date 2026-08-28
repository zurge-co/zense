import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../lib/workspace";
import {
  appendToFile,
  listFiles,
  readFileContent,
  writeFileAtomic,
} from "../lib/workspaceFs";
import {
  archiveOldTasks,
  applyEvent,
  encodeEvent,
  FOCUS_JOURNAL_DIR,
  FOCUS_SCHEMA_VERSION,
  FOCUS_SNAPSHOT_PATH,
  IDLE_THRESHOLD_MS,
  journalPathFor,
  newTaskId,
  parseJournal,
  parseSnapshot,
  rebuildFromEvents,
  serializeSnapshot,
  type FocusEvent,
  type FocusSnapshot,
  type FocusTask,
  type PauseReason,
} from "../lib/focus";

/** How often the idle checker runs. */
const IDLE_CHECK_INTERVAL_MS = 10_000;
/** Own writes suppress the fs-watcher reload for this window. */
const OWN_WRITE_SUPPRESS_MS = 500;
/** Debounce for external-change reloads (pi-zense / manual edits). */
const RELOAD_DEBOUNCE_MS = 300;

interface FocusState {
  loaded: boolean;
  /** Workspace root the state was loaded from. */
  root: string | null;
  tasks: FocusTask[];
  /** ms epoch, refreshed every second while a timer runs (drives elapsed re-render). */
  now: number;
  /** Last observed keyboard/mouse activity inside the app (app-level idle). */
  lastActivityAt: number;
  /** Task auto-paused by idle, waiting for the user to resume or finish it. */
  idlePendingTaskId: string | null;

  load: (root: string) => Promise<void>;
  unload: () => void;

  /** Create a task (paused). Returns the new id. */
  createTask: (title: string) => Promise<string>;
  /** Start (or switch to) a task — auto-pauses the running one (`auto-switch`). */
  startTask: (taskId: string) => Promise<void>;
  pauseTask: (taskId: string, reason?: PauseReason, at?: number) => Promise<void>;
  resumeTask: (taskId: string) => Promise<void>;
  doneTask: (taskId: string) => Promise<void>;
  /** Decide what to do with the idle-paused task. */
  resolveIdle: (action: "resume" | "done") => Promise<void>;

  /** Called by the global activity listeners. */
  noteActivity: () => void;
}

// ── Module-scope (not reactive) ──────────────────────────────────────────

let tickInterval: ReturnType<typeof setInterval> | null = null;
let idleInterval: ReturnType<typeof setInterval> | null = null;
let fsUnlisten: (() => void) | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let writeInFlight = 0;
let lastOwnWriteAt = 0;
let activityListenersAttached = false;

function snapshotOf(tasks: FocusTask[]): FocusSnapshot {
  return { v: FOCUS_SCHEMA_VERSION, tasks };
}

export const useFocusStore = create<FocusState>((set, get) => {
  /** Apply events → derive state (archiving old done tasks), then persist
   *  (journal append + atomic snapshot rewrite) without blocking the UI. */
  const mutate = (events: FocusEvent[]): void => {
    if (!get().root) return;
    set((s) => {
      let snap = archiveOldTasks(snapshotOf(s.tasks));
      for (const e of events) snap = applyEvent(snap, e);
      return { tasks: snap.tasks, now: Date.now() };
    });
    ensureTicking();
    void persist(events);
  };

  const persist = async (events: FocusEvent[]): Promise<void> => {
    const root = get().root;
    if (!root || !isTauri()) return;
    writeInFlight++;
    try {
      // Journal first (audit), one write per touched month file.
      const byPath = new Map<string, string[]>();
      for (const e of events) {
        const p = journalPathFor(e.ts);
        const lines = byPath.get(p) ?? [];
        lines.push(encodeEvent(e));
        byPath.set(p, lines);
      }
      for (const [path, lines] of byPath) {
        await appendToFile(root, path, lines.join("\n") + "\n");
      }
      await writeFileAtomic(root, FOCUS_SNAPSHOT_PATH, serializeSnapshot(snapshotOf(get().tasks)));
    } catch (err) {
      console.error("focus persist failed:", err);
    } finally {
      writeInFlight--;
      lastOwnWriteAt = Date.now();
    }
  };

  /** Re-read the snapshot from disk; rebuild from journals if corrupt. */
  const reload = async (root: string): Promise<void> => {
    if (!isTauri()) return;
    try {
      const text = await readFileContent(root, FOCUS_SNAPSHOT_PATH);
      const parsed = parseSnapshot(text);
      if (parsed) {
        const snap = archiveOldTasks(parsed);
        set({ tasks: snap.tasks });
        ensureTicking();
        return;
      }
      // Corrupt/wrong-version snapshot → replay the monthly journals.
      const all = (await listFiles(root, true)).filter(
        (p) => p.startsWith(`${FOCUS_JOURNAL_DIR}/`) && p.endsWith(".jsonl"),
      );
      const events = (await Promise.all(all.map((p) => readFileContent(root, p)))).flatMap(parseJournal);
      const snap = archiveOldTasks(rebuildFromEvents(events));
      set({ tasks: snap.tasks });
      await writeFileAtomic(root, FOCUS_SNAPSHOT_PATH, serializeSnapshot(snap));
      ensureTicking();
    } catch {
      // No .zense yet (or unreadable) → empty state; created lazily on first
      // mutation.
      set({ tasks: [] });
      ensureTicking();
    }
  };

  const scheduleExternalReload = (root: string): void => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (writeInFlight === 0) void reload(root);
    }, RELOAD_DEBOUNCE_MS);
  };

  /** 1s ticker — only while a timer actually runs. */
  const ensureTicking = (): void => {
    const running = get().tasks.some((t) => t.status === "active");
    if (running && !tickInterval) {
      tickInterval = setInterval(() => {
        if (get().tasks.some((t) => t.status === "active")) set({ now: Date.now() });
      }, 1000);
    } else if (!running && tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  };

  const startIdleChecker = (): void => {
    if (idleInterval) return;
    idleInterval = setInterval(() => {
      const s = get();
      const active = s.tasks.find((t) => t.status === "active");
      if (!active) return;
      if (Date.now() - s.lastActivityAt < IDLE_THRESHOLD_MS) return;
      // Retroactive pause AT lastActivity — idle time is not billed.
      set({ idlePendingTaskId: active.id });
      get().pauseTask(active.id, "idle", s.lastActivityAt);
    }, IDLE_CHECK_INTERVAL_MS);
  };

  const attachActivityListeners = (): void => {
    if (activityListenersAttached || typeof window === "undefined") return;
    activityListenersAttached = true;
    const note = () => get().noteActivity();
    for (const type of ["keydown", "mousedown", "wheel", "touchstart"]) {
      window.addEventListener(type, note, { capture: true, passive: true });
    }
  };

  return {
    loaded: false,
    root: null,
    tasks: [],
    now: Date.now(),
    lastActivityAt: Date.now(),
    idlePendingTaskId: null,

    load: async (root) => {
      get().unload();
      set({ root, lastActivityAt: Date.now(), idlePendingTaskId: null });
      attachActivityListeners();
      startIdleChecker();
      if (isTauri()) {
        fsUnlisten = await listen<string[]>("fs://changed", (e) => {
          // Also catches pi-zense / external edits of the focus files.
          if (!e.payload.some((p) => p.startsWith(".zense/focus"))) return;
          if (writeInFlight > 0 || Date.now() - lastOwnWriteAt < OWN_WRITE_SUPPRESS_MS) return;
          scheduleExternalReload(root);
        });
      }
      await reload(root);
      set({ loaded: true });
    },

    unload: () => {
      if (fsUnlisten) {
        fsUnlisten();
        fsUnlisten = null;
      }
      if (reloadTimer) {
        clearTimeout(reloadTimer);
        reloadTimer = null;
      }
      set({ loaded: false, root: null, tasks: [], idlePendingTaskId: null });
    },

    createTask: async (title) => {
      const ts = Date.now();
      const id = newTaskId(ts);
      mutate([{ v: FOCUS_SCHEMA_VERSION, ts, type: "task.create", taskId: id, title }]);
      return id;
    },

    startTask: async (taskId) => {
      const ts = Date.now();
      const active = get().tasks.find((t) => t.status === "active");
      if (active?.id === taskId) return;
      const events: FocusEvent[] = [];
      if (active) {
        events.push({ v: FOCUS_SCHEMA_VERSION, ts, type: "timer.pause", taskId: active.id, reason: "auto-switch" });
      }
      events.push({ v: FOCUS_SCHEMA_VERSION, ts, type: "timer.start", taskId });
      set({ idlePendingTaskId: null, lastActivityAt: ts });
      mutate(events);
    },

    pauseTask: async (taskId, reason = "manual", at) => {
      const task = get().tasks.find((t) => t.id === taskId);
      if (!task || task.status !== "active") return;
      const ts = at ?? Date.now();
      if (reason === "manual" && get().idlePendingTaskId === taskId) set({ idlePendingTaskId: null });
      mutate([{ v: FOCUS_SCHEMA_VERSION, ts, type: "timer.pause", taskId, reason }]);
    },

    resumeTask: async (taskId) => {
      const ts = Date.now();
      const active = get().tasks.find((t) => t.status === "active");
      const task = get().tasks.find((t) => t.id === taskId);
      if (!task || task.status === "done") return;
      if (active?.id === taskId) return;
      const events: FocusEvent[] = [];
      if (active) {
        events.push({ v: FOCUS_SCHEMA_VERSION, ts, type: "timer.pause", taskId: active.id, reason: "auto-switch" });
      }
      events.push({ v: FOCUS_SCHEMA_VERSION, ts, type: "timer.resume", taskId });
      set({ idlePendingTaskId: null, lastActivityAt: ts });
      mutate(events);
    },

    doneTask: async (taskId) => {
      const ts = Date.now();
      if (get().idlePendingTaskId === taskId) set({ idlePendingTaskId: null });
      mutate([{ v: FOCUS_SCHEMA_VERSION, ts, type: "task.done", taskId }]);
    },

    resolveIdle: async (action) => {
      const id = get().idlePendingTaskId;
      if (!id) return;
      set({ idlePendingTaskId: null });
      if (action === "resume") await get().resumeTask(id);
      else await get().doneTask(id);
    },

    noteActivity: () => {
      set({ lastActivityAt: Date.now() });
    },
  };
});

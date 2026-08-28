import { useState } from "react";
import { Hourglass, Play, Plus } from "lucide-react";
import { useFocusStore } from "../../store/focusStore";
import { totalMs, type TaskStatus } from "../../lib/focus";
import { TaskItem } from "./TaskItem";

const statusRank: Record<TaskStatus, number> = { active: 0, paused: 1, done: 2 };

export function FocusPanel() {
  const { tasks, now, idlePendingTaskId, createTask, startTask, resolveIdle } = useFocusStore();
  const [title, setTitle] = useState("");

  const idleTask = idlePendingTaskId ? tasks.find((t) => t.id === idlePendingTaskId) : null;
  const sorted = [...tasks].sort(
    (a, b) => statusRank[a.status] - statusRank[b.status] || b.createdAt - a.createdAt,
  );

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTitle("");
    const id = await createTask(trimmed);
    await startTask(id);
  };

  return (
    <div className="flex flex-col gap-2 p-2">
      {idleTask && (
        <div className="flex flex-col gap-1.5 rounded border border-yellow/40 bg-yellow/10 px-2 py-1.5">
          <span className="flex items-center gap-1.5 text-[12px] text-fg">
            <Hourglass size={12} className="shrink-0 text-yellow" />
            Paused “{idleTask.title}” — you went idle
          </span>
          <span className="text-[10.5px] text-fg-muted">
            The timer stopped at your last activity, so idle time was not counted.
            {totalMs(idleTask) > 0 ? ` Tracked so far: shown below.` : ""}
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={() => void resolveIdle("resume")}
              className="flex items-center gap-1 rounded bg-accent/20 px-2 py-0.5 text-[11px] text-fg hover:bg-accent/30"
            >
              <Play size={11} /> Resume
            </button>
            <button
              onClick={() => void resolveIdle("done")}
              className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-muted hover:bg-hover hover:text-fg"
            >
              Finish it
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="What are you working on?"
          className="min-w-0 flex-1 rounded border border-border bg-base px-2 py-1.5 text-[12.5px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
        />
        <button
          title="Create & start"
          onClick={() => void submit()}
          disabled={!title.trim()}
          className="flex shrink-0 items-center gap-1 rounded border border-border bg-base px-2 text-[12px] text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          <Plus size={13} />
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="px-1 text-[12.5px] text-fg-muted">
          No tasks yet. Type above and hit Enter to start your first timer.
        </div>
      ) : (
        sorted.map((t) => <TaskItem key={t.id} task={t} now={now} />)
      )}
    </div>
  );
}

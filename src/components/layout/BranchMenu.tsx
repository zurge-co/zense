import { useEffect, useRef, useState } from "react";
import { Check, Download, GitBranch, Loader2, Plus, RefreshCw, X } from "lucide-react";

import { useGitStore } from "../../store/gitStore";
import { useUIStore } from "../../store/uiStore";
import {
  gitCheckoutBranch,
  gitCheckoutRemoteBranch,
  gitCreateBranch,
  gitFetch,
  gitListBranches,
  gitPull,
  type GitBranchEntry,
} from "../../lib/git";

interface Feedback {
  ok: boolean;
  message: string;
}

/**
 * Branch popup in the StatusBar — git fetch / pull / checkout / new-branch
 * for people who don't know the git CLI yet. Every action states what it
 * will do in plain words, and failures come back as friendly messages from
 * gitcmd.rs (no "fatal: ..." jargon). Successful fetch/pull keep the menu
 * open so the result line is visible; switching branch closes it.
 */
export function BranchMenu({ onClose }: { onClose: () => void }) {
  const [branches, setBranches] = useState<GitBranchEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const root = useUIStore((s) => s.workspacePath);
  /** Re-read git state after any action that moved refs/files. */
  const refreshGit = () => {
    if (root) void useGitStore.getState().refresh(root);
  };

  useEffect(() => {
    if (!root) return;
    gitListBranches(root).then(setBranches, () => {});
  }, [root]);

  // Esc closes (or backs out of new-branch input first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (creating) {
        setCreating(false);
        setNewName("");
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creating, onClose]);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const run = async (label: string, fn: () => Promise<Feedback>) => {
    if (!root || busy) return;
    setBusy(label);
    setFeedback(null);
    try {
      setFeedback(await fn());
    } catch (err) {
      setFeedback({ ok: false, message: String(err) });
    } finally {
      setBusy(null);
    }
  };

  const doFetch = () =>
    void run("fetch", async () => {
      const r = await gitFetch(root!);
      refreshGit();
      return r;
    });

  const doPull = () =>
    void run("pull", async () => {
      const r = await gitPull(root!);
      refreshGit();
      return r;
    });

  const doCheckout = (b: GitBranchEntry) => {
    if (busy || !root) return;
    setBusy(`switch:${b.name}`);
    setFeedback(null);
    // Remote entries get the CLI dwim behavior: existing local → switch,
    // otherwise create a tracking branch from the server copy and switch.
    const op = b.isRemote ? gitCheckoutRemoteBranch(root, b.name) : gitCheckoutBranch(root, b.name);
    op.then(
      () => {
        refreshGit();
        onClose();
      },
      (err) => {
        setBusy(null);
        setFeedback({ ok: false, message: String(err) });
      },
    );
  };

  const doCreate = () => {
    const name = newName.trim();
    if (!name || busy || !root) return;
    setBusy("create");
    setFeedback(null);
    gitCreateBranch(root, name).then(
      () => {
        refreshGit();
        onClose();
      },
      (err) => {
        setBusy(null);
        setFeedback({ ok: false, message: String(err) });
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute bottom-7 left-3 w-72 overflow-hidden rounded-md border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            <GitBranch size={11} /> Git
          </span>
          <button onClick={onClose} className="rounded p-0.5 text-fg-muted transition-colors hover:text-fg">
            <X size={12} />
          </button>
        </div>

        {/* ── Result of the last action (plain words, no git jargon) ── */}
        {feedback && (
          <div
            className={`whitespace-pre-line border-b border-border px-3 py-2 text-[11.5px] leading-snug ${
              feedback.ok ? "text-accent" : "text-danger"
            }`}
          >
            {feedback.message}
          </div>
        )}

        {/* ── Remote actions ── */}
        <MenuRow
          icon={busy === "fetch" ? Loader2 : RefreshCw}
          spinning={busy === "fetch"}
          title="Fetch"
          hint="Check the server for updates — your files stay untouched"
          onClick={doFetch}
        />
        <MenuRow
          icon={busy === "pull" ? Loader2 : Download}
          spinning={busy === "pull"}
          title="Pull"
          hint="Download the newest code into your files"
          onClick={doPull}
        />

        {/* ── Local branches ── */}
        <div className="border-t border-border px-3 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-fg-muted">
          Switch branch
        </div>
        <div className="max-h-40 overflow-y-auto">
          {branches.length === 0 && (
            <div className="px-3 py-1.5 text-[12px] text-fg-muted">No branches yet</div>
          )}
          {branches.map((b) => (
            <button
              key={b.name}
              disabled={b.isHead || busy !== null}
              onClick={() => doCheckout(b)}
              title={
                b.isRemote
                  ? "Only exists on the server — clicking creates your own local copy and switches to it"
                  : undefined
              }
              className={`flex w-full items-center gap-2 px-3 py-1 text-left text-[12.5px] transition-colors ${
                b.isHead ? "cursor-default text-accent" : "text-fg hover:bg-hover disabled:opacity-50"
              }`}
            >
              <span className="flex w-3.5 shrink-0 justify-center">
                {b.isHead ? (
                  <Check size={11} />
                ) : busy === `switch:${b.name}` ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : null}
              </span>
              <span className="truncate">{b.name}</span>
              {b.isRemote && (
                <span className="ml-auto shrink-0 rounded border border-border px-1 text-[9px] uppercase tracking-wide text-fg-muted">
                  server
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── New branch ── */}
        {creating ? (
          <div className="border-t border-border px-3 py-2">
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doCreate();
              }}
              placeholder="new-branch-name"
              className="w-full rounded border border-border bg-base px-2 py-1 text-[12.5px] text-fg outline-none placeholder:text-fg-muted/60 focus:border-accent"
            />
            <div className="mt-1 text-[10.5px] text-fg-muted">
              Enter: create & switch · Esc: cancel — branches off your current branch
            </div>
          </div>
        ) : (
          <MenuRow
            icon={busy === "create" ? Loader2 : Plus}
            spinning={busy === "create"}
            title="New branch"
            hint="Start a separate line of work from here"
            onClick={() => {
              setFeedback(null);
              setCreating(true);
            }}
          />
        )}
      </div>
    </div>
  );
}

function MenuRow({
  icon: Icon,
  spinning,
  title,
  hint,
  onClick,
}: {
  icon: typeof RefreshCw;
  spinning?: boolean;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      disabled={spinning}
      onClick={onClick}
      className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-hover disabled:opacity-60"
    >
      <Icon size={13} className={`mt-0.5 shrink-0 text-fg-muted ${spinning ? "animate-spin" : ""}`} />
      <span className="min-w-0">
        <span className="block text-[12.5px] text-fg">{title}</span>
        <span className="block text-[10.5px] leading-snug text-fg-muted">{hint}</span>
      </span>
    </button>
  );
}

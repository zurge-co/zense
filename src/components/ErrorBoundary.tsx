import { Component, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { writeClipboardText } from "../lib/clipboard";

/**
 * Root error boundary (ADR: see spec v3). Proven necessary by the terminal
 * incident: a throw inside any component (e.g. xterm addon load) unmounted
 * the whole React tree — black screen, dead JS close guard, window only
 * quitable via ⌘Q. This boundary:
 *
 *  1. Catches render/lifecycle errors below it and shows a recovery screen
 *     instead of a blank window.
 *  2. Is mounted around *screen content only* (App.tsx keeps the
 *     close-request guard and conflict dialog outside it), so the native
 *     title-bar close button keeps working even after a crash.
 *
 * Recovery options: reload the webview (fresh start), try again in place
 * (state kept — useful for transient failures), or copy the error for a bug
 * report.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Survives in the webview console / devtools; also useful if the user
    // copies from the recovery screen.
    console.error("[ErrorBoundary] uncaught render error:", error, info.componentStack ?? "");
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <CrashScreen error={error} onRetry={() => this.setState({ error: null })} />;
  }
}

function CrashScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyError = async () => {
    const text = `${error.name}: ${error.message}\n\n${error.stack ?? "(no stack)"}`;
    await writeClipboardText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-base px-8 text-center">
      <div className="max-w-md">
        <h1 className="mb-2 text-[15px] font-semibold text-fg">Something went wrong</h1>
        <p className="mb-1 text-[12.5px] leading-relaxed text-fg-muted">
          A part of the interface crashed. Your files on disk are untouched — but
          unsaved editor buffers may be lost on reload.
        </p>
        <p className="font-mono text-[11px] text-danger">
          {error.name}: {error.message}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onRetry}
          className="rounded border border-border bg-base px-3 py-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          Try Again
        </button>
        <button
          onClick={() => void copyError().catch(() => {})}
          className="rounded border border-border bg-base px-3 py-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          {copied ? "Copied!" : "Copy Error"}
        </button>
        <button
          onClick={() => location.reload()}
          className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-[12px] text-white hover:brightness-110"
        >
          <RefreshCw size={12} />
          Reload Window
        </button>
      </div>

      <button
        onClick={() => setShowDetails((v) => !v)}
        className="text-[11px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
      >
        {showDetails ? "Hide details" : "Show details"}
      </button>
      {showDetails && (
        <pre className="max-h-48 w-full max-w-lg overflow-auto rounded border border-border bg-panel p-3 text-left font-mono text-[10.5px] leading-relaxed text-fg-muted">
          {error.stack ?? "(no stack trace)"}
        </pre>
      )}

      <p className="text-[11px] text-fg-muted">
        The window close button keeps working — you can also quit normally.
      </p>
    </div>
  );
}

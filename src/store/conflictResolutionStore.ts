import { create } from "zustand";
import type { ConflictKind, ProposalConfidence, TrivialKind } from "../lib/aiConflictPrompts";

/**
 * AI conflict resolution state (spec V1): one record per conflicted file.
 *
 * State machine: detected → analyzing → proposed → accepted |
 * review-requested → resolved. The proposal is IMMUTABLE once set — Ask
 * Zense is read-only Q&A and never rewrites it. Human edits are allowed,
 * but they live in `editDraft`, keeping the AI proposal intact for the
 * audit trail ("what did the AI propose" vs "what was applied").
 */

export type ResolutionStatus =
  | "detected"
  | "analyzing"
  | "proposed"
  | "accepted"
  | "review-requested"
  | "error";

/** A tool-derived fact (VERIFIED) — never model prose (see aiConflict.ts). */
export interface EvidenceFact {
  kind: "marker-free" | "test-file" | "references";
  /** Short human line, e.g. "No conflict markers left". */
  label: string;
  ok: boolean;
  /** Detail shown on hover / second line (matched path, files list). */
  detail?: string;
}

export interface QAExchange {
  question: string;
  answer: string;
}

export interface ResolutionRecord {
  path: string;
  kind: ConflictKind;
  status: ResolutionStatus;
  /** Set when both sides settle mechanically (whitespace / import-order)
   *  — the workspace pre-selects these for one-click batch accept. */
  trivial: TrivialKind | null;
  /** AI INTERPRETATION + result (undefined until proposed). */
  story?: string;
  /** Immutable after setProposal — see module doc. */
  proposal?: string;
  confidence?: ProposalConfidence;
  reasoningPoints?: string[];
  /** VERIFIED facts about the proposal (tool-generated only). */
  evidence: EvidenceFact[];
  /** Human edits on top of the AI proposal (the applied content wins). */
  editDraft: string | null;
  /** Who accepted (audit trail) — the configured commit-stamp name. */
  approvedBy?: string;
  error: string | null;
  qa: QAExchange[];
}

/** What the Accept action writes to disk: human edits win over the AI
 *  proposal; the original stays on the record for the audit. */
export const effectiveContent = (r: ResolutionRecord): string | undefined =>
  r.editDraft ?? r.proposal;

interface ConflictResolutionState {
  records: Record<string, ResolutionRecord>;
  /** Ensure a record exists for a conflicted path (idempotent). */
  ensure: (path: string, kind: ConflictKind) => void;
  beginAnalysis: (path: string) => void;
  /** The ONLY way a proposal lands — after this it is immutable. */
  setProposal: (
    path: string,
    p: {
      story: string;
      proposal: string;
      confidence: ProposalConfidence;
      reasoningPoints: string[];
      evidence: EvidenceFact[];
      trivial: TrivialKind | null;
    },
  ) => void;
  setError: (path: string, message: string) => void;
  setDraft: (path: string, draft: string | null) => void;
  appendQa: (path: string, qa: QAExchange) => void;
  markAccepted: (path: string, approvedBy: string) => void;
  markReviewRequested: (path: string) => void;
  /** Forget everything (merge finished / aborted / workspace switch). */
  reset: () => void;
}

const newRecord = (path: string, kind: ConflictKind): ResolutionRecord => ({
  path,
  kind,
  status: "detected",
  trivial: null,
  evidence: [],
  editDraft: null,
  error: null,
  qa: [],
});

export const useConflictResolutionStore = create<ConflictResolutionState>((set) => ({
  records: {},

  ensure: (path, kind) =>
    set((s) =>
      s.records[path] ? s : { records: { ...s.records, [path]: newRecord(path, kind) } },
    ),

  beginAnalysis: (path) =>
    set((s) => {
      const r = s.records[path];
      if (!r) return s;
      // Re-analysis starts detection over; a record that already reached
      // proposed/accepted keeps its state (no quiet regression).
      if (r.status !== "detected" && r.status !== "error") return s;
      return {
        records: { ...s.records, [path]: { ...r, status: "analyzing", error: null } },
      };
    }),

  setProposal: (path, p) =>
    set((s) => {
      const r = s.records[path];
      if (!r) return s;
      return {
        records: {
          ...s.records,
          [path]: {
            ...r,
            status: "proposed",
            story: p.story,
            proposal: p.proposal,
            confidence: p.confidence,
            reasoningPoints: p.reasoningPoints,
            evidence: p.evidence,
            trivial: p.trivial,
            error: null,
          },
        },
      };
    }),

  setError: (path, message) =>
    set((s) => {
      const r = s.records[path];
      if (!r) return s;
      return { records: { ...s.records, [path]: { ...r, status: "error", error: message } } };
    }),

  setDraft: (path, draft) =>
    set((s) => {
      const r = s.records[path];
      if (!r) return s;
      return { records: { ...s.records, [path]: { ...r, editDraft: draft } } };
    }),

  appendQa: (path, qa) =>
    set((s) => {
      const r = s.records[path];
      if (!r) return s;
      return { records: { ...s.records, [path]: { ...r, qa: [...r.qa, qa] } } };
    }),

  markAccepted: (path, approvedBy) =>
    set((s) => {
      const r = s.records[path];
      if (!r) return s;
      return {
        records: { ...s.records, [path]: { ...r, status: "accepted", approvedBy } },
      };
    }),

  markReviewRequested: (path) =>
    set((s) => {
      const r = s.records[path];
      if (!r) return s;
      return {
        records: { ...s.records, [path]: { ...r, status: "review-requested" } },
      };
    }),

  reset: () => set({ records: {} }),
}));

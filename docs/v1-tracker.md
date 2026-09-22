# Zense V1 — Execution Tracker

> **Source of truth for "where are we."** Updated at the end of every accepted chunk.
> Contract doc: [`docs/zense-v1.md`](./zense-v1.md) (SPEC-COMPLETE, invariants INV-01…18).
>
> **Rules:**
> 1. One chunk = one `compile_spec` = one session. Never batch two chunks.
> 2. Chunk specs cite the tracker + `zense-v1.md` sections instead of pasting spec text.
> 3. Every accepted chunk MUST update this file (status, ADR links, amendments). Updating this file is a spec criterion of the chunk itself.
> 4. Later phases are deliberately **not** decomposed yet (rolling-wave planning — spikes may amend invariants; specs written ahead of evidence die).
> 5. Conformance tests are named after their invariant: `inv_NN_<slug>`.

**Status legend:** `⬜ todo` · `◐ spec approved` · `▶ in progress` · `✅ accepted` · `✎ amended (see ADR)`

---

## Gate

```text
Phase 1 is LOCKED until PP-5 is ✅
(all 18 INVs have executable conformance tests AND are confirmed/amended by ADR)
```

---

## Pre-Phase — Trust & Architecture Spikes

| # | Status | Chunk | Prototype / Deliverable | INV coverage (proto) | Depends on |
|---|--------|-------|--------------------------|----------------------|------------|
| PP-0 | ⬜ | Invariant conformance harness skeleton | Test runner registering INV-01…18 as skipped placeholders, wired into `cargo test`; this tracker | all (placeholders) | — |
| PP-1 | ⬜ | Threat model | Written answers to zense-v1.md §10 Q1–10 + ADR(s) | — (informs PP-4) | — (parallel OK) |
| PP-2 | ⬜ | Signature & canonicalization spike | Rust prototype: canonical rep, sha256 digest, ed25519 sign/verify, versioned envelope, mutate→new revision→old execute rejected | INV-01, 02, 03, 04, 16 (+11 canonical-field marking) | PP-0 |
| PP-3 | ⬜ | Evidence & runner trust spike | Data-model prototype: ATTESTED/ASSERTED, producer identity, freshness/expiry (expired evidence blocks eligibility) | INV-12 | PP-0 |
| PP-4a | ⬜ | Enforcement boundary — decision | Research + **ADR (one-way door)** selecting runtime/sandbox; denyRules for extension modules | — | PP-1 |
| PP-4b | ⬜ | Enforcement boundary — proof | Escape-test prototype: malicious extension attempts `git push` / raw fs write / network call / MCP mutation / agent-vs-human PTY attribution — all unauthorized paths blocked | INV-08, 09 (proto) | PP-4a |
| PP-5 | ⬜ | INV gate rollup | Every INV confirmed or amended by ADR **in writing**; gate unlocked | INV-01…18 (confirmed) | PP-2, PP-3, PP-4b |

---

## Phase 1 — Zense Core (draft — refine after PP-5)

| # | Status | Chunk | INV coverage (Core) | Depends on |
|---|--------|-------|----------------------|------------|
| P1-1 | ⬜ | Core types: `Change` / `Revision` / state machine + transition validation; scope + adapter-namespaced conflict keys | INV-13, 14 | PP-5 |
| P1-2 | ⬜ | Port signature/canonicalization prototype into Core | INV-01, 11, 16 | P1-1 |
| P1-3 | ⬜ | Evidence store + provenance + freshness | INV-12 | P1-2 |
| P1-4 | ⬜ | Policy engine v0: env/target classification, ownership, policy-change-as-Change | INV-05, 06, 07 | P1-2 |
| P1-5 | ⬜ | Audit: append-only, hash-chained, tamper-evident store; provenance scope (Zense-mediated only) | INV-15, 18 | P1-2 |
| P1-6 | ⬜ | Identity & keys: keygen/sign/verify, lifecycle (active/rotated/revoked/compromised), audited revocation | INV-17 | P1-2 |
| P1-7 | ⬜ | Execution abstraction + eligibility chain (current revision → signed → valid → policy-version match → evidence fresh → scope conflict); rollback-as-Change; superseded rejection | INV-02, 03, 04, 10 | P1-3, P1-4, P1-5 |
| P1-8 | ⬜ | First adapter: `gitcmd` through Core + human/agent execution attribution (agent paths policy-wrapped) | INV-08, 09 | P1-4, P1-7 |

Phase 1 exit = Phase 1 criteria in `zense-v1.md` §18 + all Core-scope INVs green in the harness.

---

## Phase 2–6

⬜ **Not decomposed.** Decompose each phase when reached, after re-reading `zense-v1.md` §18 and any amending ADRs.

---

## INV Coverage Matrix

| INV | Invariant (short) | Spike proof | Core owner | Test name |
|-----|-------------------|-------------|------------|-----------|
| 01 | Canonical mutation → new revision | PP-2 | P1-2 | `inv_01_canonical_mutation_new_revision` |
| 02 | Superseded revision cannot execute; signature stays verifiable | PP-2 | P1-7 | `inv_02_superseded_cannot_execute` |
| 03 | Eligibility checked at execution time | PP-2 | P1-7 | `inv_03_eligibility_at_execution_time` |
| 04 | No execution without authorization on current revision | PP-2 | P1-7 | `inv_04_no_execution_without_current_auth` |
| 05 | Extensions cannot modify policy | — | P1-4 | `inv_05_extension_cannot_write_policy` |
| 06 | Policy changes are signed Changes | — | P1-4 | `inv_06_policy_change_requires_sign` |
| 07 | Impact classification by Core only | — | P1-4 | `inv_07_classification_core_only` |
| 08 | Agent-initiated execution policy-wrapped | PP-4b | P1-8 | `inv_08_agent_execution_policy_wrapped` |
| 09 | Human direct execution distinct from agent | PP-4b | P1-8 | `inv_09_human_vs_agent_attribution` |
| 10 | Rollback is a new Change | — | P1-7 | `inv_10_rollback_is_new_change` |
| 11 | Signer-visible fields canonical or marked advisory | PP-2 (canonical marking) | P1-2 (Core), Phase 3 (UI) | `inv_11_signer_fields_canonical_or_advisory` |
| 12 | Evidence provenance ATTESTED/ASSERTED | PP-3 | P1-3 | `inv_12_evidence_provenance_class` |
| 13 | Conflict keys namespaced by adapter | — | P1-1 | `inv_13_conflict_keys_namespaced` |
| 14 | Conflict detection not a security boundary | PP-4b (gate holds despite under-declared keys) | P1-1 (model) | `inv_14_conflict_not_security_boundary` |
| 15 | Audit append-only, hash-chained, tamper-evident | — | P1-5 | `inv_15_audit_hash_chain_tamper_evident` |
| 16 | Signature/digest formats declare versions | PP-2 | P1-2 | `inv_16_versioned_signature_envelope` |
| 17 | Key lifecycle incl. rotation/revocation, audited | — | P1-6 | `inv_17_key_lifecycle_revocation_audited` |
| 18 | Audit provenance: Zense-mediated only | — | P1-5 / P1-8 | `inv_18_audit_provenance_scope` |

---

## ADR Log

| # | Status | Title | Amends | Link |
|---|--------|-------|--------|------|
| — | — | *(none yet)* | — | — |

---

## Session Log

| Date | Chunk | Outcome |
|------|-------|---------|
| 2026-09-22 | — | Vision consolidated into `docs/zense-v1.md` (SPEC-COMPLETE); tracker created |

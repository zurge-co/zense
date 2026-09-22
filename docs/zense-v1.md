# Zense V1 — Final Vision, Architecture & Engineering Roadmap

**Status: SPEC-COMPLETE** — 2026-09-22

> Architecture gaps are closed and the trust model is locked as invariants (§4).
> Nothing in Phases 1–6 may violate an invariant in §4. An invariant that fails
> its Pre-Phase spike is amended by ADR *before* Phase 1 — never silently
> during implementation.
>
> The remaining risk is concentrated in the Pre-Phase by design: **no Core
> schema is final until every invariant has an executable conformance test.**
>
> This document supersedes all prior V1 vision drafts. It consolidates the
> revised roadmap plus the full design-review exchange (signature & revision
> semantics, evidence provenance, enforcement boundary, policy protection,
> runner trust, rollback, conflict keys, audit integrity, human-agent
> distinction).

---

# 1. Vision

**Zense is the human verification layer for AI-driven software development and execution.**

AI, developers, and extensions can create, analyze, and prepare changes. Zense ensures that changes with real-world impact are reviewed, understood, and explicitly authorized by a human before they are executed or shipped.

> **AI can create. Extensions can act. Humans decide what ships.**

Zense starts with AI-generated code, but its architecture is designed for any software change with real-world impact.

---

# 2. Core Model

Zense introduces a universal lifecycle:

```text
Intent
  ↓
Change
  ↓
Review
  ↓
Evidence
  ↓
Human Sign
  ↓
Execution
  ↓
Ship
```

The human does not need to control every step of the work. The human controls the moment where a proposed change becomes an **authorized action**.

> **Zense does not gate the work. Zense gates the change that has real impact.**

---

# 3. The Change Model

The **Change** is the central object of Zense V1.

```text
Change
├── Intent
├── Target / Environment
├── Scope
├── Revision(s)
├── Diff / Plan
├── Evidence
├── AI Review
├── Policy Results
├── Human Review
├── Authorization
├── Execution
└── Audit Trail
```

A Change may represent:

* Source code modifications
* Infrastructure changes
* Database migrations
* Configuration changes
* Deployments
* Automated operations
* AI-generated work
* Extension-generated actions

Rules:

* A Change has a **stable identity**.
* Authorization always binds to a specific **Change Revision**, which is an immutable canonical snapshot (§5).
* The canonical representation is **designed** so that data irrelevant to authorization is never part of it — this is a design-time exclusion, not a runtime exception.

---

# 4. Trust Invariants

These are architectural invariants, not features. They form the **contract between this vision and the implementation**:

```text
Pre-Phase
    ↓
Invariant
    ↓
ADR
    ↓
Conformance Test
    ↓
Phase implementation
    ↓
Test passes
```

Not:

```text
Vision → Developer interpretation → Implementation
```

| ID | Invariant |
|----|-----------|
| **INV-01** | Any mutation to the canonical Change representation creates a new Change Revision. |
| **INV-02** | A previous revision's signature remains historically verifiable forever, but a superseded revision cannot execute. |
| **INV-03** | Execution eligibility is checked at execution time, not at sign time. |
| **INV-04** | No execution may occur without valid authorization bound to the current authorized revision of the Change. |
| **INV-05** | Extensions cannot modify policy. |
| **INV-06** | Policy changes are themselves Changes requiring review and human authorization. |
| **INV-07** | Impact/environment classification is determined by Core policy evaluation — never supplied as an authoritative value by the proposing actor. |
| **INV-08** | Agent-initiated execution is policy-wrapped. |
| **INV-09** | Direct human execution is distinct from Zense-mediated execution. |
| **INV-10** | Rollback/compensation is a new Change requiring its own authorization. |
| **INV-11** | Fields shown to the signer that inform the authorization decision are either inside the canonical representation or explicitly marked non-binding/advisory in the signing UI. |
| **INV-12** | Evidence records carry explicit provenance: `ATTESTED` or `ASSERTED`. |
| **INV-13** | Conflict keys are namespaced by adapter (e.g. `terraform:aws/prod/vpc`). |
| **INV-14** | Conflict detection is an integrity/UX mechanism, **not** a security boundary. |
| **INV-15** | Audit events are append-only, hash-chained, and tamper-evident. |
| **INV-16** | Signature and digest formats declare their canonicalization/digest/signature versions. |
| **INV-17** | Signing keys have lifecycle states including rotation and revocation; revocations are recorded in the audit trail. |
| **INV-18** | Zense-mediated audit claims provenance only for actions executed through Zense; direct human actions outside the gate are not represented as Zense-authorized execution. |

> *(INV list finalized at 18 entries; the earlier draft's separate "only the current authorized revision may execute" rule was merged into INV-04.)*

---

# 5. Signature Binding & Change Revisions

## 5.1 Canonical Representation

A human signature binds to a canonical representation of the exact Change Revision being authorized:

```text
Canonical Change Revision
        ↓
Change Digest
        ↓
Human Signature
```

The digest covers, at minimum:

```text
Change identity + revision identity
Intent
Target / environment
Scope
Diff / plan digest
Evidence digests
Policy result + policy version
Relevant execution parameters
```

The canonical representation is **designed up front** so that presentation-only data never enters it:

```text
IN canonical:   intent, target, scope, diff/plan, evidence digests, policy version
OUT of canonical: description formatting, UI metadata, display ordering
```

**Signer-comprehension rule (INV-11):** the canonical boundary defines not just what is signed but what a signer can be fooled by. Any field displayed at sign time that informs the human's decision must be canonical, or marked advisory in the signing UI. This closes "signed the right bytes for the wrong reasons."

## 5.2 Crypto Agility (INV-16)

The signed envelope declares its construction:

```text
signature_version:        zense-sign-v1
canonicalization_version: canonicalization-v1
digest_algorithm:         sha256
signature_algorithm:      ed25519
```

Historical signatures remain interpretable after algorithm upgrades.

## 5.3 Revision Model (INV-01, INV-02)

A signed Change is an **immutable canonical snapshot**. Any mutation to the canonical representation creates a new Revision; it does not "edit" the signed one:

```text
Change A
 ├── Revision 1
 │    ├── SIGNED (Tuesday)               ← signature valid forever
 │    └── EXECUTION STATUS: SUPERSEDED   ← cannot execute
 └── Revision 2
      └── current, signable
```

Signatures are never deleted or retroactively invalidated — audit integrity requires every historical signature to remain verifiable. What changes is **execution eligibility**, a current-state property.

## 5.4 Three Separate Properties

These three concepts must never be collapsed into a single state:

| Property | Meaning | Class |
|---|---|---|
| **Signature validity** | Cryptographically valid? | Historical fact — immutable, audit property |
| **Revision validity** | Still the current authorized revision? | Per-Change current-state property |
| **Execution eligibility** | Allowed to execute *right now*? | Time-zero decision at execution time |

## 5.5 Execution Eligibility (INV-03, INV-04)

Checked **at execution time**, against the current world:

```text
Execution request
        ↓
Is this the current authorized revision of the Change?
        ↓
Is that revision signed?
        ↓
Is the signature cryptographically valid?
        ↓
Does current policy evaluation match the policy version
bound in the signature?      ← policy change invalidates the signed basis
        ↓                       → new revision required (never silent re-gating)
Are evidence freshness requirements satisfied?
        ↓                       ← expired evidence blocks eligibility,
                                  NOT signature validity
Does the scope conflict with an active Change? (§11)
        ↓
EXECUTE
```

Because eligibility is evaluated at execution time, a revision signed an hour ago but superseded or drifting since is rejected — this is the conformance test behind *"superseded Changes cannot be executed."*

## 5.6 Re-Authorization After Staleness

* **Cryptography: full re-sign** of the new revision. No incremental/delta authorization in V1.
* **UX: delta review.** The signer reviews *what changed since their last signature*, with full review always available:

```text
LAST REVIEWED
      ↓
    STALE
      ↓
┌───────────────────────────┐
│ What changed since sign?  │
│                           │
│  + src/payment.ts         │
│  + migration.sql          │
│  ~ Terraform target       │
│                           │
│  [Review Full Change]     │
│  [Review Changes Since]   │
│                           │
│        ZENSE SIGN         │
└───────────────────────────┘
```

## 5.7 Drift Detection

Because the working tree may change after a revision is frozen, Core continuously detects:

```text
current working state  ≠  latest signed revision
        ↓
drift indicator (first-class UI signal, before execution — not after)
```

---

# 6. Change State Model

The lifecycle supports reality, including backward trust transitions.

Revision-level states:

```text
DRAFT
  ↓
REVIEWING
  ↓
READY_FOR_SIGN
  ↓
SIGNED
  ↓
EXECUTING
  ├──→ EXECUTED
  └──→ EXECUTION_FAILED
```

Terminal / invalidation states:

```text
REJECTED
STALE
SUPERSEDED
CANCELLED
```

Examples:

* Canonic content mutated after signing → new revision; previous revision → `SUPERSEDED` (execution-wise)
* Signed basis no longer matches current state → `STALE`
* New Change replaces an older one → `SUPERSEDED`
* Reviewer rejects → `REJECTED`
* Execution fails → `EXECUTION_FAILED`
* User abandons the operation → `CANCELLED`

State transitions apply to Revisions; Change-level state derives from the current revision.

---

# 7. Evidence Provenance

Evidence is not automatically truth. Zense distinguishes (INV-12):

### Attested Evidence

Produced by a trusted execution path controlled by Zense or an explicitly trusted runner:

```text
Zense Core Runner / Trusted Runner
        ↓
Test / Plan / Scan
        ↓
Result bound to runner identity + change digest
        ↓
ATTESTED Evidence
```

### Asserted Evidence

Submitted by an extension or external system — recorded as a **claim**, not a fact:

```text
Extension
   ↓
"Tests passed"
   ↓
ASSERTED Evidence
```

Runner classes:

```text
Zense Core Runner      → attested by construction
Trusted Runner         → attested via runner trust model (§18, Pre-Phase/Phase 4)
Untrusted Runner       → cannot produce ATTESTED evidence
External Assertion     → ASSERTED by definition
```

UI and audit display provenance explicitly:

```text
✓ Tests passed                    ATTESTED · Zense Runner
✓ Terraform plan generated        ATTESTED · Lens Runner
✓ External security scan passed   ASSERTED · External Scanner
```

Every evidence record carries:

* Producer identity (runner / extension)
* Timestamp
* Input / change-revision digest
* Tool + version
* Result
* Provenance class
* Expiration / freshness policy

Evidence can go stale **independently** of the Change. Expired evidence blocks *execution eligibility* (§5.5); it never invalidates a signature retroactively.

---

# 8. Identity, Keys & Signatures

Identity is part of Core:

```text
Human Identity
      ↓
Authentication
      ↓
Signing Identity
      ↓
Cryptographic Key
      ↓
Signature
```

The trust model distinguishes **authenticated user** from **cryptographic signer**. Signatures must be independently verifiable against the signed revision digest.

## Key Lifecycle (INV-17)

```text
Signing Key
├── active
├── rotated
├── revoked
└── compromised
```

Revocation is an audited event: key, reason, timestamp, actor. V1 ships the **lifecycle semantic model**; full enterprise PKI / OCSP is out of scope.

## Multi-Signer

V1 supports **one authorized human** per signature. The signature field is an **array from day one** (one element in V1), so N-of-M / quorum / approval chains are not precluded later. Quorum semantics are explicitly **out of scope for V1**.

## Audit Anchoring (post-V1 option)

Hash-chained audit (INV-15) is tamper-evident, not immutable — an attacker who owns the store can rewrite the chain. Strong guarantees (WORM storage, external timestamping, transparency logs) are deferred. A cheap intermediate step — periodically signing the audit chain head with the signing key — is preserved as a post-V1 option and must not be precluded by the V1 schema.

---

# 9. Execution Boundary

The most important security boundary in Zense:

> **An extension must not be able to obtain an execution path that bypasses Zense authorization.**

```text
Capability ──→ Permission ──→ Authorization ──→ Execution
```

An extension holding `terminal.execute` must **not** thereby be able to `git push`, `terraform apply`, or call a deploy webhook without the policy layer seeing the operation.

Enforcement mechanism is an **architecture decision made before the extension ecosystem is locked in** (Pre-Phase). Candidate approaches: restricted JS runtime, WASM sandbox, process sandbox, OS-level restrictions, intercepted capability APIs, controlled runners, network/egress policy.

## Human Hands vs. Agent Hands (INV-08, INV-09)

Direct human operation is **out of the gate** by design — Zense does not police a human using their own tools:

```text
Human → Zense Terminal → git push      : direct human execution,
                                         normal OS/user permissions, not gated
```

Agent execution through Zense is **policy-wrapped** and distinguishable from human input:

```text
AI → ptycmd/Terminal Capability
        ↓
     Policy
        ↓
   Authorization
        ↓
     Execute
```

> Human-initiated terminal commands remain directly executable according to normal OS/user permissions; agent-initiated execution through Zense must be policy-wrapped and distinguishable from direct human interaction.

Honest corollary (INV-18): because humans can act outside the gate, **Zense audit cannot claim complete provenance of real-world state.** Audit covers Zense-mediated actions. Out-of-band human actions must never be represented as Zense-authorized execution.

---

# 10. Threat Model

Adversaries, at minimum:

```text
Malicious Extension
Compromised AI Provider
Compromised MCP Server
Forged Evidence
Tampered Change
Compromised Runner
Compromised Signing Key
Unauthorized Execution
Socially Engineered Signer
```

The architecture must give explicit, honest answers:

1. Can an extension bypass Sign? → **No.**
2. Can an extension forge evidence? → It can submit **asserted** claims; attested evidence requires the runner trust model.
3. Can a signed Change be modified without detection? → Any canonical mutation creates a new revision; the old revision cannot execute.
4. Can an AI provider alter the execution target? → Target is canonical; mutation → new revision.
5. Can an MCP tool execute an unauthorized mutation? → **No** (§12).
6. Can an extension under-declare conflict keys? → **Yes** — conflict detection is not a security boundary (INV-14); worst case is a loud execution-time collision, never silent gate bypass.
7. Can audit records be modified? → Modification is **detectable** (hash chain, INV-15); tamper-proof storage is post-V1.
8. Can a signer unknowingly authorize a different Change? → Signer-visible fields are canonical or marked advisory (INV-11); delta review exposes changes since last sign.
9. Can an extension influence policy or impact classification? → **No** (INV-05, INV-07).
10. What if a signing key is compromised? → Revocation is audited (INV-17); pre-revocation signatures remain historically verifiable.

The answers define the architecture — and are written before Extension Runtime work begins.

---

# 11. Policy, Impact & Scope Conflicts

Zense does not require the same ceremony for every action. The Change carries:

```text
Target
Environment
Impact
Policy
Required Authorization
```

Example policy tiers:

```text
Development  → automatic execution
Staging      → optional approval
Production   → mandatory Human Sign
```

> **Authorization requirements depend on the Change and its context, not merely on which command was called.**

## Policy Protection (INV-05, INV-06, INV-07)

* Policy is owned by the repository/organization.
* Extensions may **read** policy evaluation results; they may never modify policy.
* A change to policy is itself a **Change** — reviewed and signed before it applies.
* Impact/environment classification is produced by **Core policy evaluation**. A proposer's claim (`impact = LOW`) is never authoritative:

```text
Extension says:  impact = LOW        ← advisory, never trusted
Core computes:   target = production
                 scope = database
                 operation = DROP/ALTER
                      ↓
                 HIGH IMPACT
```

## Scope Conflicts via Domain Adapters (INV-13, INV-14)

Core must **not** grow domain-specific conflict logic. Domain adapters declare comparable conflict keys:

```text
Change
 └── Scope
      ├── scope type
      ├── scope identity
      └── conflict key(s)        ← declared by the domain adapter,
                                    namespaced: terraform:aws/prod/vpc
```

Core compares keys and applies policy — without knowing what Terraform is:

```text
same/conflicting conflict keys
        ↓
policy
        ↓
serialization / invalidation
```

V1 acceptance behavior (no global distributed locking required):

```text
A SIGNED                    Change A — current revision signed
B SIGNED                    Change B — current revision signed (overlapping keys)
A executes
B → STALE / SUPERSEDED
B cannot execute
```

Conflict keys are adapter-**asserted** data; a malicious adapter can under-declare them. That is acceptable in V1 precisely because conflict detection is *not* the security boundary — the signature gate is (threat-model answer #6).

---

# 12. MCP

MCP is a first-class security boundary. An MCP server is another actor capable of invoking tools:

```text
AI Agent
   ↓
MCP
   ↓
Tool Call
   ↓
Zense Capability Layer
   ↓
Policy
   ↓
Authorization
   ↓
Execute
```

Read-only:

```text
AI → MCP → Read
```

Mutation:

```text
AI → MCP → Proposed Mutation
                ↓
             Change
                ↓
             Review
                ↓
           Human Sign
                ↓
             Execute
```

MCP must not create a hidden execution channel around the Zense gate.

---

# 13. Extensions

> **Core = primitives. Extensions = domain capabilities.**

Extensions can: observe, analyze, generate, plan, propose Changes, provide evidence, execute authorized actions.

```text
Permission to execute
        ≠
Authorization for this Change
```

Both are enforced: what an extension is technically allowed to do, **and** what a human has authorized for the specific Change Revision.

---

# 14. First-Party Reference Extension — Lens

Lens is the reference implementation for a planned-mutation domain (Kubernetes, Terraform, AWS, infrastructure analysis):

```text
Lens
  ↓
Terraform Plan
  ↓
Create Change
  ↓
Evidence
  ├── Plan
  ├── Cost
  └── Policy
  ↓
AI Review
  ↓
Human Review
  ↓
ZENSE SIGN
  ↓
Terraform Apply
```

Lens proves that Zense is not merely a code-review application. For Lens evidence to be `ATTESTED`, its runner must earn trusted status through the runner trust model — which is why runner trust is Pre-Phase/Phase 4 scope, not a Phase 5 surprise.

---

# 15. Git

Git remains Core. Zense extends the Git lifecycle:

```text
Working Tree
     ↓
Change
     ↓
Review
     ↓
Evidence
     ↓
Human Sign
     ↓
Commit
     ↓
Push
```

A local commit is not inherently a real-world mutation; the protected boundary is determined by policy and target:

```text
Local Commit            → may be policy-allowed
Push                    → policy-dependent
Production Deployment   → Human Sign required
```

Change and commit are related but not one-to-one. A Change may span multiple commits, rebases, squashes, and partial work. The signature binds to the **canonical Change Revision**, not to a commit hash.

---

# 16. Execution Semantics

Execution is a Core abstraction, separate from authorization:

```text
Execution
├── Requested
├── Authorized
├── Started
├── Completed
├── Failed
├── Cancelled
└── Rolled Back / Compensated
```

A valid signature does not imply successful execution. Audit preserves the distinction between:

> **"The human authorized this."** ≠ **"This executed successfully."**

## Rollback Is a Change (INV-10)

```text
Change A
   ↓
Execute
   ↓
Production mutated
   ↓
Rollback requested
   ↓
Change B          ← full Change: review, sign, execute
```

There is no magic rollback path — rollback can have greater real-world impact than the original change.

---

# 17. Product Experience

Zense must not become another generic IDE. Editor, Git, Terminal, Conflict Resolver, MCP, and extensions **support** the core workflow.

### Primary experience

> **Work → Review → Sign → Ship**

### Product identity

```text
Changes · Review · Evidence · Sign · Policy · Audit
```

### Supporting capabilities

```text
Editor · Git · Terminal · MCP · Extensions
```

The home screen prioritizes **Changes awaiting human attention** — including stale revisions with a "what changed since your last review?" delta view, and drift indicators where working state no longer matches a signed revision.

---

# 18. Engineering Roadmap

```text
Pre-Phase        Trust & Architecture Spikes + Invariant Conformance Harness
   ↓
Phase 1          Zense Core (Change/Revision model, policy, audit, adapters)
   ↓
Phase 2          Git + AI Core
   ↓
Phase 3          Human Verification
   ↓
Phase 4          Extension Runtime (+ Runner Trust)
   ↓
Phase 5          First-Party Extensions (Lens, MCP, ...)
   ↓
Phase 6          Real-World Execution
   ↓
ZENSE V1
```

Implementation may overlap where dependencies allow, but **no phase may invalidate the trust invariants established earlier.**

---

## Pre-Phase — Trust & Architecture Spikes

### Goal

Resolve the decisions that could invalidate the entire V1 design, and prove the invariants before any Core schema is written.

### Work

**1. Signature & Canonicalization Spike**
* Canonical representation (design-time exclusion of non-authorization data)
* Revision semantics (freeze, mutation → new revision)
* Digest, signature scheme, key storage, verification
* Crypto agility envelope
* Stale / re-sign behavior; drift detection

**2. Evidence & Runner Trust Spike**
* Attested vs. asserted evidence
* Runner identity; how a runner becomes trusted
* Attestation binding (evidence ↔ runner identity ↔ change digest)
* Freshness / expiration

**3. Enforcement Boundary Spike**
* Extension sandbox / runtime choice
* Terminal, filesystem, network, process boundaries
* MCP enforcement
* Agent-vs-human execution distinction

**4. Threat Model**
* Adversaries, trust boundaries, attack surfaces, required guarantees
* Written answers to §10's questions

**5. Invariant Conformance Harness**
* One executable conformance test per INV-01 … INV-18
* Fails against unimplemented Core; Phase 1 makes them pass

### Prototype discipline

Each spike ships an **executable prototype that attempts to violate the invariants** — not merely an ADR, and not merely a happy-path demo:

```text
Signature spike:
  sign() → verify()
  mutate() → new revision
  old revision: verify() = historically valid, execute() = REJECTED

Sandbox spike (malicious extension attempts):
  git push · terraform apply · raw filesystem write ·
  network call · MCP mutation
  → every unauthorized path = blocked
```

### Exit Criteria

* Accepted ADRs/specifications answer: *What exactly is signed? What creates a new revision? What evidence can be trusted? Who may execute? Where is execution technically enforced? What can a malicious extension / MCP / AI provider do?*
* Every INV has an executable conformance test.
* **No Phase 1 Core schema is written until all INVs are covered.** An invariant that fails its spike is amended by ADR, in writing, before Phase 1 — never during it.

---

## Phase 1 — Zense Core

### Goal

Build the trust primitives underneath the existing application.

### Build

* Change model + **Revision model** + lifecycle/state machine
* Canonical representation + deterministic digest
* Signature abstraction (array-of-signatures schema from day one)
* Review model
* Evidence model + provenance + freshness
* Policy model/engine (ownership, evaluation, classification)
* Identity + key lifecycle semantics
* Execution abstraction (success/failure/cancel semantics)
* Audit: **append-only, hash-chained, tamper-evident** (INV-15)
* Invariant conformance harness passing for Core-scope INVs

### Migration Strategy

Do **not** rewrite the Tauri application first. Refactor the existing command layer underneath the current UI:

```text
Current UI
    ↓
Current Commands
    ↓
   [Refactor]
    ↓
Zense Core APIs
    ↓
Git / LLM / PTY / OS
```

Existing commands (`gitcmd`, `llm`, `chatcmd`, `ptycmd`, etc.) become adapters around Core capabilities. **Agent-driven execution paths (LLM tools, PTY) become policy-wrapped and distinguishable from direct human input during this refactor** (INV-08, INV-09).

### Exit Criteria

* Change created without UI-specific business logic; stable ID; canonical serialization; deterministic digest.
* Signature verifiable; canonical mutation → new revision; superseded revision cannot execute.
* Evidence carries provenance + freshness; expired evidence blocks eligibility.
* Policy determines required authorization; classification is Core-produced.
* Execution has explicit success/failure semantics; audit records state transitions and is tamper-evident.
* Existing V0 functionality operates through Core APIs.

### Milestone

> **Zense Core can represent and protect a real Change.**

---

## Phase 2 — Git & AI Core

### Goal

Connect real software workflows to the Change model.

### Build

**Git:** repository abstraction · status · diff · commit · history · branch · merge · push · Change ↔ Git mapping · conflict-key adapter for file/path scopes.

**AI:** provider abstraction · context · AI Review · agent execution (policy-wrapped) · evidence generation · intent extraction.

### Dependencies

Phase 1. Git and AI implement in parallel.

### Exit Criteria

```text
AI / Developer → Change → AI Review → Evidence → Human Review → Git Commit
```

* Multiple AI providers swap without Core changes; no provider logic leaks into Core.
* Git operations go through the repository abstraction; Git state associates with Changes/Revisions.
* AI output becomes structured review/evidence data.

### Milestone

> **AI-generated work can become a verifiable Git-backed Change.**

---

## Phase 3 — Human Verification

### Goal

Make ZENSE SIGN a real authorization primitive.

### Build

* Review UI · Evidence UI (with provenance display) · `READY_FOR_SIGN`
* Signature ceremony · identity binding · change/revision fingerprint · verification
* Revision/staleness detection · supersession · rejection · cancellation
* **Delta review UX** ("what changed since your last sign?") · **drift indicator**
* Execution state · audit trail UI

### Dependencies

Phase 1 (signature architecture, Change/Revision, identity, evidence) · Phase 2 (Git).

### Exit Criteria

A human can: inspect a specific Change · understand intent · inspect diff/plan · see evidence **with provenance** · see policy requirements · **sign the exact canonical revision** · verify the signature · detect subsequent invalidation/drift · view complete audit history. A superseded revision cannot be executed even with a valid historical signature.

### Milestone

> **Zense can prove exactly what a human authorized.**

---

## Phase 4 — Extension Runtime (+ Runner Trust)

### Goal

Allow external capabilities without creating an authorization bypass.

### Build

* Extension manifest · permission system · capability model · sandbox/runtime
* Command / Event / Storage / UI / Workspace / Git / AI / Change / Evidence / Execution / Sign APIs
* **Runner trust model:** runner identity · trust establishment · attestation · runner permissions · runner isolation
* Network policy · MCP boundary

### Dependencies

Phase 1 Core · Phase 3 authorization model · Pre-Phase sandbox ADR · threat model.

### Exit Criteria

A third-party extension can load safely, declare permissions, use permitted capabilities, create Changes, attach (asserted or runner-attested) evidence, request review, participate in Sign, and execute authorized actions — and security tests demonstrate it **cannot** bypass authorization via direct Git operations, raw process execution, terminal commands, filesystem access, network calls, or MCP tool calls.

### Milestone

> **Extensions can participate in Zense without becoming an authorization bypass.**

---

## Phase 5 — First-Party Extensions

### Goal

Prove the platform across domains.

### Initial targets

MCP · GitHub · GitLab · Kubernetes · Terraform · Database tooling · Cloud tooling.

### Reference Extension: Lens

For Lens to emit `ATTESTED` evidence, its runner must earn trusted status through the Phase 4 runner trust model.

### Exit Criteria

At least one planned-mutation extension works end-to-end (Plan → Change → Evidence → AI Review → Policy → Human Sign → Execute → Audit). MCP demonstrates that read **and** mutation tool calls respect the same capability/authorization model. No extension implements a parallel approval system.

### Milestone

> **Zense works as a trust layer outside traditional code editing.**

---

## Phase 6 — Real-World Execution

### Goal

Prove the same trust architecture across categories of real-world actions.

### Required scenarios

```text
Code:           AI → Change → Review → Sign → Commit / Push
Infrastructure: Lens → Plan → Change → Review → Sign → Apply
Database:       DB Ext → Migration → Review → Sign → Execute
Deployment:     Deploy Ext → Release → Review → Sign → Production
```

### Exit Criteria

* One code, one infrastructure, and one additional non-code workflow pass through the same Change → Review → Evidence → Human Sign → Execution → Audit architecture.
* **Full invariant conformance suite is green.**
* Extension and MCP bypass tests pass.
* Failed execution represented correctly; superseded revisions cannot execute; stale signatures cannot authorize execution.
* Rollback executes as an authorized Change, not a side channel.
* Production policy can require explicit human authorization.
* Audit reconstructs a Change's complete lifecycle.

### Milestone

> **The same Zense trust model governs different categories of real-world software changes.**

---

# 19. V1 Definition of Done

Zense V1 is complete when:

> **Any meaningful software change can be represented as a Change, reviewed with trustworthy evidence, explicitly authorized by a human, executed through an enforced capability boundary, and reconstructed through an auditable history.**

Guaranteed properties:

```text
Change Integrity
      +
Evidence Provenance
      +
Human Authorization
      +
Execution Enforcement
      +
Auditability
```

With the honest audit boundary (INV-18): provenance is claimed for Zense-mediated actions; direct human actions outside the gate are never represented as Zense-authorized execution.

```text
                 AI
                  │
             Developers
                  │
             Extensions
                  │
                  ▼
               CHANGE
                  │
          ┌───────┴───────┐
          │     ZENSE     │
          │   Review      │
          │   Evidence    │
          │   Policy      │
          │   Human Sign  │
          │   Audit       │
          └───────┬───────┘
                  │
           Enforced Boundary
                  │
                  ▼
            EXECUTE / SHIP
```

---

# 20. What V1 Is Not

Zense V1 is deliberately not:

* A VS Code replacement
* A Cursor competitor
* A generic AI coding agent
* A generic IDE
* A plugin marketplace
* A collection of unrelated developer tools
* A full PKI / secure-compute platform (runner trust and key lifecycle ship as semantic models, not full infrastructure)
* Multi-signer / quorum authorization (array-ready schema, single signer in V1)
* Tamper-**proof** audit storage (tamper-**evident** in V1; external immutability deferred)

The platform exists to support one fundamental workflow:

> **Work → Review → Sign → Ship**

---

# 21. Final Position

### V0

> **Zense is a tool for controlling AI-written code.**

### V1

> **Zense is the human verification layer for AI-driven software changes.**

```text
V0:                        V1:
AI → Code → Human → Git    AI / Developer / Extension
                                     ↓
                                   Change
                                     ↓
                             Review + Evidence
                                     ↓
                                Human Sign
                                     ↓
                              Execute / Ship
```

Zense evolves from a developer application into an architecture governing the transition from **AI and automation to real-world action**.

## Zense

**AI can create.**
**Extensions can act.**
**Humans decide what ships.**

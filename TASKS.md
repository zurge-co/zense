# Zense — Task Board

> Tracking file แทน Jira — อ่านง่ายทั้ง human และ AI
>
> **Legend:** `[x]` = done · `[ ]` = todo · `~` = mock/UI-only (รอ function จริง)
>
> **Phase ปัจจุบัน:** UI v2 — 3 panels (Review / History / Explorer) + real git2 source control + real file system
>
> **เปลี่ยนแปลงครั้งล่าสุด:** AI Chat เชื่อมครบ end-to-end แล้ว (ChatPanel จริง + rig backend streaming + tool loop + multi-turn history + stop/clear) — ตอนนี้ตั้งค่า LLM ใน Settings > LLM แล้วคุยกับ codebase ได้เลย

---

## 🏠 Welcome Screen

- [x] หน้าตา: logo, recent workspaces, quick actions
- [x] Open Folder → เลือก directory จริง (Tauri dialog) และเปิด workspace
- [x] Recent workspaces โหลด/บันทึกจริง (config file ผ่าน tauri-plugin-store)
- [x] ⌘O shortcut เปิด folder

## 📑 Layout (TitleBar / ActivityBar / StatusBar)

- [x] Custom titlebar + traffic lights overlay (macOS)
- [x] Activity bar: Review (default) → History → Explorer → Settings
- [x] Toggle sidebar: ⌘B
- [x] StatusBar: branch + dirty indicator + ahead/behind จาก git2 จริง
- [ ] StatusBar: errors/warnings count จริง (ตอนนี้ hardcoded)
- [ ] StatusBar: cursor position (Ln/Col) จริง (ตอนนี้ hardcoded)
- [ ] Session restore: จำ layout + open tabs ของแต่ละ workspace

## 🗂 Explorer (File Tree)

- [x] Tree UI: เปิด/พับ folder, ไอคอน, hover favorite
- [x] Outline section (mock symbols)
- [x] อ่าน file tree จริงจาก disk (`read_file_tree` — respect .gitignore, ข้าม .git, cap 20k entries)
- [x] เปิดไฟล์จริง → โหลด content เข้า editor (lazy load + error state + guard binary/ไฟล์ใหญ่)
- [x] File operations: new/rename/delete (context menu + ConfirmDialog สำหรับ delete) — backend `write_file` / `rename_file` / `delete_file` + path-traversal guard
- [ ] Favorites จริง (persist)
- [ ] Recent files section
- [ ] Outline จริงจาก Tree-sitter symbols
- [ ] File watcher: refresh เมื่อไฟล์เปลี่ยน

## 🌿 Review — Source Control (default panel)

- [x] Review panel UI: branch, commit box, changes list พร้อม +/− stats
- [x] คลิกไฟล์ → เปิด diff view
- [x] Status จริงจาก git2 (`git_status` — staged/unstaged, M/A/D/R/C, empty repo, not-a-repo)
- [x] Diff summary จริง (`git_diff_summary` — per-file additions/deletions staged + unstaged)
- [x] Diff file จริง (`git_diff_file` — HEAD vs index / index vs workdir, binary detection)
- [x] Stage/unstage รายไฟล์จริง (`git_stage` / `git_unstage` — รวม deleted file)
- [x] Stage All
- [x] Commit จริง (`git_commit` — guard empty message + nothing-staged)
- [x] Branch info จริง (`git_branch_info` — name, detached, ahead/behind)
- [ ] Branch: switch/create/list (dropdown ที่ branch name)
- [ ] Blame view ใน editor gutter
- [ ] AI commit message → ส่ง diff เข้า agent (LLM พร้อมแล้ว — เหลือ wiring Review panel)
- [ ] Stage/unstage ระดับ hunk จาก diff view
- [ ] AI Summary (diff) (LLM พร้อมแล้ว — เหลือ wiring)

## 📜 History

- [x] Backend: `git_log` (newest-first, offset/limit, per-commit stats) + `git_show` (commit detail) + `git_diff_commits` (compare 2 commits) + `git_diff_commit_file` (per-file diff commit↔parent หรือ from→to)
- [x] History panel UI: commit list (infinite scroll via IntersectionObserver, relative time, +/− stats, merge badge, refresh + error/empty states, context menu: Open / Copy SHA / Select for Compare)
- [x] Commit detail view (tab `{kind:"commit"}` — header message/author/time/sha + file list w/ stats; คลิกไฟล์ → diff vs parent)
- [x] Compare commits (Select for Compare → Compare with Selected → tab `{kind:"compare"}` รายการไฟล์ +/− totals; คลิกไฟล์ → diff from→to)

## 📝 Editor (Monaco)

- [x] Monaco read-only + zense-dark theme (bundle local, ไม่ใช้ CDN)
- [x] Tabs: เปิด/ปิด/สลับ + context menu (Close / Close Others / Close All + unsaved confirm)
- [x] Breadcrumb
- [x] Editable mode + save (⌘S)
- [x] Untitled tab (Ctrl+T in editor mode): เปิด tab ใหม่พิมพ์ได้เลยโดยไม่ต้องตั้งชื่อ — buffer อยู่ใน memory (pseudo-path untitled:N), dirty-dot + close confirm ทำงานเหมือน file tab; ⌘S เปิด save-as dialog ตั้งชื่อแล้ว promote เป็น file tab จริง (Monaco ⌘T rebind ใน monacoKeybindings)
- [x] เปิดไฟล์จริง + language detection จาก extension
- [ ] Split editor (ปุ่มมีแล้ว, ยังไม่ทำงาน)
- [ ] Diagnostics จริง (LSP หรือ tree-sitter)
- [ ] คลิก symbol ใน outline → jump ไปบรรทัดจริง
- [ ] กด cmd+delete เพื่อไม่ต้อง prompt confirm
## ↔️ Diff View

- [x] Monaco DiffEditor: side-by-side (default) / inline toggle
- [x] Change navigator (◀ ▶ + counter จาก getLineChanges จริง)
- [x] HEAD ⟷ Working Tree + stats +x −y
- [x] รองรับไฟล์ M / A / D + binary placeholder
- [x] Diff จริงจาก git2 (`git_diff_file` — HEAD blob vs index / index vs workdir)
- [x] Compare commits (tab `{kind:"compare"}` + `{kind:"commitDiff"}` reuse Monaco DiffView)
- [ ] Compare branches (ยังไม่มี branch picker)

## ⏱ Focus Timer (time tracking per task)

- [x] Data model: snapshot `.zense/focus.json` (schema v:1, atomic write) + journal `.zense/focus.log/YYYY-MM.jsonl` รายเดือน — ใช้ร่วมกับ pi-zense (agent อ่านตอบ “งาน A ใช้เวลาเท่าไหร่” ได้)
- [x] focusStore: create / start / pause / resume / done + persist ทุก mutation (journal append O(1) + snapshot rewrite แบบไม่บล็อก UI)
- [x] Invariant: active timer ≤1 — start งานใหม่ auto-pause งานเดิม (reason `auto-switch`)
- [x] Idle auto-pause (app-level: keyboard/mouse activity, threshold 5 นาที) — pause ย้อนที่ lastActivity ไม่นับเวลา idle + banner Resume/Finish
- [x] Focus panel ใน sidebar (ActivityBar ⏱) + StatusBar แสดง elapsed ขณะ timer วิ่ง
- [x] Survive restart (timer วิ่งต่อจาก timestamp) + reload เมื่อไฟล์ถูกแก้จากภายนอก (fs watcher) + corrupt snapshot rebuild จาก journal
- [x] Rust: `append_file` + `write_file_atomic` commands (path-guarded) พร้อม tests
- [ ] Idle threshold ปรับได้ใน Settings
- [ ] auto-link branch ตอน start + เวลาต่อ commit
- [ ] Report รายวัน/สัปดาห์ (อ่านจาก journal)
- [ ] pi-zense จับเวลาแต่ละ phase ของ spec run อัตโนมัติ

## ⚙️ Settings

- [x] Modal + sections: General / Appearance / Shortcuts (read-only reference)
- [x] Persist settings ผ่าน tauri-plugin-store
- [ ] Theme จริง (dark/light + custom tokens)
- [ ] Keybinding rebinding (Shortcuts page แก้ไขได้)
- [ ] Workspace-level settings override

## 🖥 Terminal (integrated, multi-session)

- [x] Integrated terminal: xterm.js + real PTY (portable-pty) as ActivityBar main view (⌘`)
- [x] Thai cursor: unicode graphemes addon (combining marks share one cell)
- [x] Shell survives activity swaps (panel kept mounted, CSS-concealed — ADR-004)
- [x] Multi-session tabs (ADR-006): หลาย session พร้อมกััน — backend `PtyManager` HashMap keyed by session id, events `pty://output`/`pty://exit` พัก id
- [x] เปิด tab/session ใหม้: ปุ่่ม + บน tab bar หรื่้่อ ⌘N / Ctrl+N (context-sensitive — ใน terminal view เปิ่่ม new terminal session, นอกนั้่นเปิ่่ม New File)
- [x] ปิ่่ม tab/session: ปุ่่ม X บนแต่ละ tab (`pty_kill` ราย session; `pty_kill_all` ตอน unmount / สลับ workspace)
- [x] Shell ใน tab ที่ไม่ active รันตอในเบื้องหลัง (xterm instance ถููก mount ถอดส, inactive display:none)
- [x] Restart shell ราย tab (rotate ปุ่่ม) — kill + respawn ใน tab เดิม, title คงเดิม
- [x] Tab title จาก command แรก (Ctrl+T / + เปิ่ด session init เป็น "Terminal N"): พิมพ์ command แรก + Enter → title เปลื่่ยนเป็น command นัน้ (truncate 24 ตัวอักษร, lib/terminalTitle.ts — input-side heuristic, backspace/Ctrl+C/escape-aware), command ถัดไปไม่ rename อิก
- [ ] Persist open terminal sessions / restore หนับ restart app

## 💬 AI Chat (LLM)

- [x] Chat panel จริง (`ChatPanel.tsx` แทน stub `ComposerPanel`) — message list, streaming text, tool-call indicators, error banner
- [x] Backend `chat_send` (rig agent + `stream_prompt` streaming ผ่าน Tauri Channel) + `llm_test_connection`
- [x] Multi-turn: backend ส่ง chat history เข้า agent ทุกครั้ง (ไม่ drop context)
- [x] Stop button (UI-level abort ผ่าน generation guard — เก็บ partial text; หมายเหตุ: rig stream ไม่มี cancel token, backend run ต่อจนจบเบื้องหลัง)
- [x] Clear conversation (ปุ่ม Eraser บน header)
- [x] Settings > LLM: provider (OpenAI/Anthropic compatible), base URL, API key (optional สำหรับ Ollama), model, Test Connection, tool toggles (read_file / read_file_range / list_files), guards (max_turns 1–100, max_tool_output 1000–500000) + persist ผ่าน tauri-plugin-store (migrate config เก่า)
- [x] Path-traversal guard + output cap ใน tools
- [ ] เก็บ tool result preview ใน UI (ตอนนี้ ToolCallEnd ส่ง preview ว่าง)
- [ ] แสดง markdown/code block ใน message จริง (ตอนนี้ plain text)
- [ ] Token usage display (rig `extended_details`)
- [ ] Backend cancel token จริง (rig stream ยังไม่มี cancellation signal)
- [ ] @-mention context injection เข้า prompt

## 🧠 AI Context Engine (future)

- [x] File index (walk + gitignore) สำหรับ @-mention — `list_files` command
- [ ] Tree-sitter symbol extraction
- [ ] Auto-gather: imports, related files, call hierarchy, git history
- [ ] Token counting / budget สำหรับ snippet ที่แนบ

## 🦀 Backend / Infra

- [x] Tauri v2 scaffold + cargo check ผ่าน
- [x] Tauri commands: fs (`list_files`, `read_file_tree`, `read_file`, `read_file_range`, `write_file`, `rename_file`, `delete_file` — กัน path traversal, มี unit test)
- [x] Tauri commands: git (`git_status`, `git_branch_info`, `git_diff_summary`, `git_diff_file`, `git_stage`, `git_unstage`, `git_commit`, `git_log`, `git_show`, `git_diff_commits` — git2, มี unit test)
- [x] Branch menu ใน StatusBar (junior-friendly): fetch / pull / switch branch / new branch — `git_list_branches`, `git_checkout_branch`, `git_create_branch` (git2, safe checkout) + `git_fetch`, `git_pull` (git CLI, friendly errors) + `BranchMenu.tsx` (รวม remote-tracking branch checkout: `git_checkout_remote_branch` — เลือก origin/x แล้วสร้าง local tracking branch ให้อัตโนมัติ)
- [x] UI components กลาง: `ContextMenu` + `ConfirmDialog` (reusable)
- [ ] จำขนาดหน้าจอล่าสุดก่อนจะปิด (persist window size/position ผ่าน plugin-store หรือ tauri-plugin-window-state)
- [ ] CLI entry: `zense .`, `zense --profile backend` (ตาม README)
- [ ] CI: build + typecheck + lint

## 🌳 Git Experience (backlog — ทำทีละ chunk)

> เป้าหมาย: คนใช้ CLI ไม่เป็นทำงานครบ loop ใน app ได้ (commit, sync, merge, fix conflict, undo)
> แต่ละ chunk ออกแบบให้ทำจบใน 1 ชิ้นงาน — ไม่ผูกกัน เรียงทำตาม priority
> Backend: git2 (pure Rust) ก่อนเสมอ, fallback git CLI เฉพาะ network/auth ops (ตาม pattern `git_fetch`/`git_pull` เดิม)

### Chunk 1 — Refactor: git conflict primitives (backend พื้นฐาน) ✅ (eval PASS, commit c480371)
- [x] `git_merge_in_progress(root)` — ตรวจ `repo.state()` (Merge/Rebase/CherryPick/Revert) + อ่าน `MERGE_HEAD` / branch ที่กำลังรวม (หมายเหตุ: libgit2 ไม่เขียน `MERGE_MSG` → fallback หา local branch ที่ชี้ `MERGE_HEAD`)
- [x] `git_conflicts(root)` — list ไฟล์ที่ conflict จาก `index.conflicts()` (base/ours/theirs OIDs + path + conflict type — ตอนนี้ derivable แค่ `content` / `modify-delete`; `binary` / `rename-rename` ต้อง tree compare เพิ่ม → follow-up task)
- [x] `git_read_conflict_file(root, path, stage)` — อ่านเนื้อหา base/ours/theirs แยกกัน สำหรับ merge UI
- [x] `git_resolve_file(root, path, content)` — เขียนผลลัพธ์ลง workdir + add เข้า index (mark resolved)
- [x] `git_merge_continue(root, message)` — สร้าง merge commit เมื่อ resolve ครบ (guard: index ยังมี conflict ห้าม commit)
- [x] `git_merge_abort(root)` — `merge --abort` equivalent (รองรับเฉพาะ Merge state; rebase/cherry-pick abort แจ้งให้ใช้ terminal ไปก่อน)
- [x] Unit tests ทุก command (temp repo fixture ตาม pattern เดิม — 82 gitcmd tests ผ่านหมด)

### Chunk 2 — Conflict Resolution Mode UI (P0) ✅
- [x] Detect conflict state → เปิด Conflict Mode อัตโนมัติ (banner ทุกหน้า + lock actions ที่เสี่ยงชน state) — `ConflictBanner.tsx` mount ใต้ TitleBar; `gitStore.refresh` ดึง `git_merge_in_progress` + `git_conflicts` ทุกครั้ง; lock branch switch/create + ปุ่ม Commit ระหว่าง Conflict Mode
- [x] Conflict overview panel: รายชื่อไฟล์, progress "แก้แล้ว x/y", คลิกข้ามไฟล์ได้ (เปิดใน editor), mark ✅ ต่อไฟล์ที่ resolved — section บนสุดของ `ReviewPanel`; ไฟล์ที่หลุดจาก index conflict list = resolved (stage = mark resolved), resolve โดยแก้ไฟล์แล้วกด Stage
- [x] Header อธิบายภาษาคน: กำลัง merge/rebase/cherry-pick อะไรเข้าอะไร — `headline()` ใน ConflictBanner ใช้ operation + sourceBranch/sourceSummary
- [x] ปุ่ม Abort (ใหญ่ + confirm) — safety net — `git_merge_abort` ผ่าน ConfirmDialog danger; rebase/cherry-pick/revert แสดง terminal-hint error จาก backend verbatim
- [x] Guard Pull/Merge ที่มี conflict แสดง dialog เข้า Conflict Mode (ดักจาก `git_pull` error / merge command) — `conflictGuard()` ใน BranchMenu re-check `git_merge_in_progress` หลัง pull/checkout; ทดสอบใน `tests/conflict-mode.test.ts`

### Chunk 3 — Inline accept UI บน Monaco (P0)
- [ ] Conflict block view แบบ VS Code: highlight สองฝั่ง + ปุ่ม Accept Current / Accept Incoming / Accept Both / Compare (CodeLens หรือ ViewZone)
- [ ] Next/prev conflict navigator (ลูกศร + counter "2/5")
- [ ] Quick actions ระดับไฟล์: เอาของเราทั้งไฟล์ / ของเขาทั้งไฟล์
- [ ] Save → `git_resolve_file` → refresh overview progress

### Chunk 4 — Safety checks ก่อน Continue (P0)
- [ ] Scan conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) คงค้างทั้ง repo ก่อน continue — block + พา jump ไปจุดที่เจอ
- [ ] แสดง diff ของ resolution ก่อน commit รอบสุดท้าย (review step)
- [ ] แนะรัน build/test ใน integrated terminal ก่อน continue (optional, 1-click run)

### Chunk 5 — Sync button + publish (P1, ใช้ทุกวัน)
- [ ] ปุ่ม Sync บน StatusBar: fetch → pull → push ทีเดียว + แสดง ahead/behind ก่อนกด
- [ ] Publish branch: branch ที่ยังไม่มี upstream → push + set-upstream อัตโนมัติ
- [ ] Pull options dialog เมื่อ diverged: merge / rebase พร้อมคำอธิบายภาษาคน
- [ ] Error handling ภาษาคน (auth fail, non-fast-forward, no network)
- [ ] Merge branch ผ่าน GUI (เลือก branch → merge เข้า current; conflict → เข้า Chunk 2 flow)

### Chunk 6 — Stash manager (P1)
- [ ] `git_stash_list` / `git_stash_save` (message) / `git_stash_apply` / `git_stash_pop` / `git_stash_drop` (git2)
- [ ] Stash panel: list + ดู diff ของ stash + apply/pop/drop ผ่าน context menu
- [ ] Stash pop ที่ conflict → เข้า Conflict Mode (Chunk 2)
- [ ] "Stash & switch branch" flow สำหรับคนมีงานค้างแล้วอยากสลับ branch

### Chunk 7 — Undo & amend (P1)
- [ ] `git_reflog(root, limit)` — อ่าน reflog ของ HEAD
- [ ] Undo panel/proposal: "ย้อนกลับ 1 ขั้น" → reset ไป reflog entry ก่อนหน้า (soft/mixed พร้อมคำอธิบาย)
- [ ] Amend last commit (UI บน commit box: checkbox "Amend") + amend message-only (ไม่แตะ staged changes)

### Chunk 8 — Commit graph (P1, visual จุดขาย)
- [ ] `git_log_graph(root, limit)` — commits + parent relations + refs (branch/tag/HEAD) สำหรับ render
- [ ] Graph column ใน History panel: lane สี + merge curves (pure SVG/canvas, no lib หนัก)
- [ ] Click commit → เปิด commit detail ที่มีอยู่แล้ว; right-click → checkout / create-branch-from / cherry-pick (เชื่อม Chunk ที่เหลือ)

### Chunk 9 — Blame & file history (P2, เชื่อม vision "understanding code")
- [ ] `git_blame(root, path)` — per-line commit/author/time (git2 `blame_file`)
- [ ] Blame gutter ใน Monaco editor (hover = commit summary; คลิก → เปิด commit)
- [ ] `git_file_history(root, path)` — log เฉพาะไฟล์ + rename detection (`--follow` equivalent)
- [ ] Context menu ใน Explorer: "View File History"

### Chunk 10 — AI conflict assist (P2, moat ของ zense)
- [ ] ปุ่ม "อธิบาย conflict นี้" บนแต่ละก้อน — ส่ง diff สองฝั่ง + blame context เข้า LLM agent เดิม (per-conflict)
- [ ] Blame ทั้งสองฝั่งบน conflict view (ใครแก้, commit ไหน, เมื่อไหร่)
- [ ] AI "ช่วย resolve" → proposal diff ให้ human Accept/Edit/Reject เท่านั้น (ห้าม auto-apply) + confidence indicator
- [ ] AI post-resolve check: เตือน import/compile risks จาก codebase context

### Chunk 11 — Cherry-pick / revert / tags (P2)
- [ ] Cherry-pick commit จาก History context menu (conflict → Chunk 2 flow)
- [ ] Revert commit (สร้าง revert commit อัตโนมัติ + message สำเร็จรูป)
- [ ] Tag manager: list/create/delete/push tags + show tags บน graph (Chunk 8)
- [ ] Compare branches: branch picker + reuse compare view (`git_diff_commits` มีแล้ว)

### Chunk 12 — GitHub integration (P3)
- [ ] Clone repo ผ่าน GUI (welcome screen quick action)
- [ ] Create PR จาก current branch (เปิด gh CLI / API)
- [ ] แสดง PR/checks status บน branch (optional)

---

### วิธีใช้ไฟล์นี้
- เพิ่ม task ใหม่ใต้ section ที่เกี่ยวข้อง แล้ว commit พร้อมโค้ด
- ปิด task โดยเปลี่ยน `[ ]` → `[x]` (+ ใส่ commit ref ถ้าสำคัญ)
- AI agents: อ่านไฟล์นี้ก่อนเริ่มงานเพื่อดูว่าอะไรเสร็จแล้ว/ยังไม่ทำ

### หมายเหตุ — สิ่งที่ถูกตัดออกใน UI v2
- Terminal / PTY (ลบ `pty.rs`, `pty.ts`, `terminalStore.ts`)
- Agent Composer / Sent Log (ลบ `agentPipe.ts`, `sentLog.ts`, `ComposerPanel.tsx`)
- Search panel (ลบ `SearchPanel.tsx`)
- Code Graph (ลบ `GraphView.tsx`)
- Prompt Library (ลบ `PromptPanel.tsx`)
- Bottom Panel (ลบ `BottomPanel.tsx`)
- GitPanel เก่า (แทนด้วย `ReviewPanel.tsx` ที่ใช้ git2 จริง)

อาจกลับมาในอนาคตเป็น plugin (ตาม README Plugin System)

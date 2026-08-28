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
- [x] เปิดไฟล์จริง + language detection จาก extension
- [ ] Split editor (ปุ่มมีแล้ว, ยังไม่ทำงาน)
- [ ] Diagnostics จริง (LSP หรือ tree-sitter)
- [ ] คลิก symbol ใน outline → jump ไปบรรทัดจริง

## ↔️ Diff View

- [x] Monaco DiffEditor: side-by-side (default) / inline toggle
- [x] Change navigator (◀ ▶ + counter จาก getLineChanges จริง)
- [x] HEAD ⟷ Working Tree + stats +x −y
- [x] รองรับไฟล์ M / A / D + binary placeholder
- [x] Diff จริงจาก git2 (`git_diff_file` — HEAD blob vs index / index vs workdir)
- [x] Compare commits (tab `{kind:"compare"}` + `{kind:"commitDiff"}` reuse Monaco DiffView)
- [ ] Compare branches (ยังไม่มี branch picker)

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
- [x] Restart shell ราย tab (rotate ปุ่่ม) — kill + respawn ใน tab เดิม, title "Terminal N" ไม่เปลื่่ยน
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

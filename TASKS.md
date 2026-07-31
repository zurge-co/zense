# Zense — Task Board

> Tracking file แทน Jira — อ่านง่ายทั้ง human และ AI
>
> **Legend:** `[x]` = done · `[ ]` = todo · `~` = mock/UI-only (รอ function จริง)
>
> **Phase ปัจจุบัน:** UI v1 เสร็จแล้ว (commit `0f13a16`) — ทุกอย่างเป็น mock data
> **Phase ถัดไป:** เติม function จริง (Tauri commands, PTY, git2, file system)

---

## 🏠 Welcome Screen

- [x] หน้าตา: logo, recent workspaces, quick actions
- [ ] Open Folder → เลือก directory จริง (Tauri dialog) และเปิด workspace
- [ ] Recent workspaces โหลด/บันทึกจริง (SQLite หรือ config file)
- [ ] ⌘O shortcut เปิด folder
- [ ] "Open with Agent" / "Open with Terminal" → เปิด workspace พร้อม focus panel นั้น

## 📑 Layout (TitleBar / ActivityBar / StatusBar)

- [x] Custom titlebar + traffic lights overlay (macOS)
- [x] Activity bar: git (default) → explorer → search → graph → prompts
- [x] Toggle panels: ⌘B sidebar, ⌘J terminal, ⌘⇧C composer
- [ ] ลาก resize panels (sidebar/composer/terminal ตอนนี้ fix ขนาด)
- [ ] StatusBar: branch/errors/cursor position จากข้อมูลจริง
- [ ] Session restore: จำ layout + open tabs ของแต่ละ workspace
- [ ] Zen mode / ซ่อน panels ทั้งหมด

## 🗂 Explorer (File Tree)

- [x] Tree UI: เปิด/พับ folder, ไอคอน, hover favorite
- [x] Outline section (mock symbols)
- [ ] อ่าน file tree จริงจาก disk (Tauri fs command, respect .gitignore)
- [ ] เปิดไฟล์จริง → โหลด content เข้า editor
- [ ] Favorites จริง (persist)
- [ ] Recent files section
- [ ] File operations: new/rename/delete (context menu)
- [ ] Outline จริงจาก Tree-sitter symbols
- [ ] File watcher: refresh เมื่อไฟล์เปลี่ยน

## 🔍 Search

- [x] Search UI: query box, replace box, match case/regex toggles, results grouped by file
- [x] ปุ่ม "Ask AI instead" → เชื่อม composer
- [ ] Search จริง (ripgrep-style ใน Rust backend)
- [ ] Replace จริง + preview
- [ ] Keyboard: ⌘⇧F focus search
- [ ] คลิก result → เปิดไฟล์ที่บรรทัดนั้นจริง (ตอนนี้เปิดแค่ไฟล์)

## 🌿 Source Control (default panel)

- [x] Git panel UI: branch, commit box, changes list พร้อม +/− stats
- [x] คลิกไฟล์ → เปิด diff view
- [ ] Status จริงจาก git2 (changes, staged/unstaged, ahead/behind)
- [ ] Commit จริง + stage/unstage รายไฟล์
- [ ] Branch: switch/create/list (dropdown ที่ branch name)
- [ ] Blame view ใน editor gutter
- [ ] AI commit message → ส่ง diff เข้า agent composer เป็นคำสั่ง "write commit message"
- [ ] Compare commits/branches (diff view 2 commits)

## 📝 Editor (Monaco)

- [x] Monaco read-only + zense-dark theme (bundle local, ไม่ใช้ CDN)
- [x] Tabs: เปิด/ปิด/สลับ
- [x] Breadcrumb
- [x] ⌘L / right-click → add selection to agent
- [ ] Editable mode + save (⌘S)
- [ ] เปิดไฟล์จริง + language detection จาก extension
- [ ] Split editor (ปุ่มมีแล้ว, ยังไม่ทำงาน)
- [ ] Diagnostics จริง (LSP หรือ tree-sitter)
- [ ] คลิก symbol ใน outline → jump ไปบรรทัดจริง
- [ ] Breadcrumb symbol dropdown

## ↔️ Diff View

- [x] Monaco DiffEditor: side-by-side (default) / inline toggle
- [x] Change navigator (◀ ▶ + counter จาก getLineChanges จริง)
- [x] HEAD ⟷ Working Tree + stats +x −y
- [x] รองรับไฟล์ M / A / D
- [ ] Diff จริงจาก git2 (HEAD blob vs working tree)
- [ ] Stage/unstage ระดับ hunk จาก diff view
- [ ] AI Summary → ส่ง diff เข้า agent composer
- [ ] Compare commits/branches (ต่อยอดจาก tab model `{kind:"diff"}`)

## 🕸 Code Graph (full-screen)

- [x] Full-screen view (แทน editor), 4 ประเภท: Calls/Modules/Packages/Refs
- [x] Node popover → file:line → เปิดไฟล์ได้
- [x] Zoom controls (UI), legend, stats bar
- [ ] Graph จริงจาก Tree-sitter call analysis
- [ ] Zoom/pan จริง (transform canvas)
- [ ] ค้นหา node จริง + focus
- [ ] Layout algorithm (dagre/elk) แทนการวางมือ
- [ ] กรองตาม depth / module
- [ ] Export เป็นรูป/mermaid

## ⚡ Agent Composer

- [x] Composer UI: draft + @mention autocomplete + chips (file/#L range)
- [x] Sent log (เวลา + chips ที่แนบ)
- [x] Prompt Library → ใส่ข้อความลง composer
- [x] Settings: agent command, attach snippets toggle, reveal terminal toggle
- [ ] เปิด terminal tab + spawn agent CLI จริง (PTY) ถ้ายังไม่รัน
- [ ] Pipe prompt เข้า stdin ของ agent พร้อม snippet จริงจาก `getSnippet()`
- [ ] @mention: autocomplete จาก file index จริง + `#` mention symbols
- [ ] Mention selection ที่มีอยู่ → อัปเดต chip เมื่อไฟล์เปลี่ยน
- [ ] หลาย agent sessions (เลือก terminal tab ปลายทาง)
- [ ] Sent log persist ต่อ workspace

## 💻 Terminal

- [x] Terminal panel (mock output + agent session section)
- [x] เหลือ terminal ล้วน (เอา Problems ออกแล้ว)
- [ ] PTY จริง (portable-pty / tauri-plugin-pty) + xterm.js renderer
- [ ] Multiple terminals + tabs + rename
- [ ] Shell profiles (zsh/bash/fish/PowerShell + custom)
- [ ] รับ agent session จริงจาก composer
- [ ] ⌘` new terminal, ⌘W close tab

## ⚙️ Settings

- [x] Modal + sections: General / Appearance / Agent CLI / Shortcuts / Terminal
- [x] Shortcuts page (read-only reference)
- [ ] Persist settings (JSON/SQLite ใน app data dir)
- [ ] Theme จริง (dark/light + custom tokens)
- [ ] Keybinding rebinding (Shortcuts page แก้ไขได้)
- [ ] Workspace-level settings override

## 🧠 AI Context Engine (future)

- [ ] File index (walk + gitignore) สำหรับ @mention
- [ ] Tree-sitter symbol extraction
- [ ] Auto-gather: imports, related files, call hierarchy, git history
- [ ] Token counting / budget สำหรับ snippet ที่แนบ

## 🦀 Backend / Infra

- [x] Tauri v2 scaffold + cargo check ผ่าน
- [ ] Tauri commands: fs (read/tree), git (status/diff/commit), pty (spawn/write/resize)
- [ ] SQLite local metadata (workspaces, recents, sent log)
- [ ] CLI entry: `zense .`, `zense --profile backend` (ตาม README)
- [ ] CI: build + typecheck + lint

---

### วิธีใช้ไฟล์นี้
- เพิ่ม task ใหม่ใต้ section ที่เกี่ยวข้อง แล้ว commit พร้อมโค้ด
- ปิด task โดยเปลี่ยน `[ ]` → `[x]` (+ ใส่ commit ref ถ้าสำคัญ)
- AI agents: อ่านไฟล์นี้ก่อนเริ่มงานเพื่อดูว่าอะไรเสร็จแล้ว/ยังไม่ทำ

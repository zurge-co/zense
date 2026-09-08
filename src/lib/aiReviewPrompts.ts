/**
 * Prompt builders + patch helpers for the AI Review feature. Pure functions
 * so tests can exercise them without a workspace, git, or LLM.
 *
 * The four review kinds map to the user's four review questions:
 * - file-summary  — คลิกขวาที่ change → สรุปการเปลี่ยนแปลงของไฟล์นั้น
 * - review-all    — ปุ่ม AI ใน Review panel → สรุปทั้งหมด + จุดที่คนต้อง review
 * - bug-hunt      — หา bug / ความผิดพลาด / edge case จาก changes
 * - explain       — คลิกขวาที่ code/chunk → อธิบายว่าคืออะไร เสี่ยงอะไร ตรวจยังไง
 *
 * Prompts are written in Thai so the model answers in Thai (the product's
 * language); the global system prompt still governs formatting/citations.
 */

export type AiReviewKind = "file-summary" | "review-all" | "bug-hunt" | "explain";

export const KIND_LABEL: Record<AiReviewKind, string> = {
  "file-summary": "สรุปไฟล์",
  "review-all": "Review ทั้งหมด",
  "bug-hunt": "หาบั๊ก",
  explain: "อธิบายโค้ด",
};

/** Short thread title for the AI Review panel. */
export function threadTitle(kind: AiReviewKind, target?: string): string {
  const label = KIND_LABEL[kind];
  return target ? `${label} · ${target}` : label;
}

/**
 * Extract the per-file section of a unified patch. A patch is a series of
 * `diff --git a/<old> b/<new>` sections; a file matches when either side of
 * its header equals `path` (rename: old or new path). Returns "" when the
 * file is not in the patch (e.g. untracked files never appear in the
 * workdir-vs-index patch).
 */
export function filterPatchForPath(patch: string, path: string): string {
  if (!patch.trim()) return "";
  const header = `diff --git a/${path} b/${path}`;
  const sections = patch.split(/(?=^diff --git )/m);
  const hit = sections.find((s) => {
    const firstLine = s.split("\n", 1)[0];
    if (firstLine === header) return true;
    // Renames / quoted paths: fall back to a token match on a/<path> or b/<path>.
    return (
      firstLine.startsWith("diff --git ") &&
      (firstLine.includes(` a/${path} `) ||
        firstLine.endsWith(` a/${path}`) ||
        firstLine.includes(` b/${path} `) ||
        firstLine.endsWith(` b/${path}`))
    );
  });
  return hit ? hit.trim() : "";
}

/** Cap an inline snippet so a fat selection can't blow up the request. */
const MAX_SNIPPET = 4000;
function clip(text: string): string {
  return text.length > MAX_SNIPPET
    ? `${text.slice(0, MAX_SNIPPET)}\n… (ตัดมาเฉพาะส่วนต้น — ใช้ read_file tool อ่านเพิ่มได้) …`
    : text;
}

const THAI_FOOTER =
  "ตอบเป็นภาษาไทย กระชับ ใช้ Markdown และอ้างอิง file:line เสมอ";

/**
 * สรุปการเปลี่ยนแปลงของไฟล์เดียว (คลิกขวาที่ change ใน Review panel).
 * When `patch` is empty the file may be untracked — fall back to tools.
 */
export function buildFileSummaryPrompt(path: string, patch: string, staged: boolean): string {
  const scope = staged ? "staged (เทียบกับ HEAD)" : "unstaged (เทียบกับ index)";
  const context = patch.trim()
    ? `Unified diff ของไฟล์นั้น (${scope}):\n\n\`\`\`diff\n${clip(patch)}\n\`\`\``
    : `ไม่มี diff ของไฟล์นี้ใน patch (${scope}) — อาจเป็นไฟล์ใหม่ที่ยัง untracked หรือ diff ถูกตัด ให้ใช้ git_status / read_file tools อ่านไฟล์ปัจจุบันแล้วสรุปจากเนื้อหาจริง`;
  return `ช่วยสรุปการเปลี่ยนแปลงของไฟล์ \`${path}\` ให้หน่อย

${context}

รูปแบบคำตอบ:
1. **สรุปภาพรวม** 1–2 ประโยค — แก้อะไร เพื่ออะไร
2. **รายละเอียดสำคัญ** เป็น bullet (อ้าง file:line)
3. **จุดที่คน review ต้องดูเป็นพิเศษ** (ถ้าไม่มีให้บอกว่าไม่มี)

${THAI_FOOTER}`;
}

/** สรุป changes ทั้งหมด + จุดที่มนุษย์ต้อง review (ปุ่ม AI ใน Review panel). */
export function buildReviewAllPrompt(stagedPatch: string, unstagedPatch: string): string {
  const staged = stagedPatch.trim() ? clip(stagedPatch) : "(ไม่มี staged changes)";
  const unstaged = unstagedPatch.trim() ? clip(unstagedPatch) : "(ไม่มี unstaged changes)";
  return `ช่วย review changes ทั้งหมดที่ยังไม่ได้ commit ใน workspace นี้

Staged diff (เทียบกับ HEAD):
\`\`\`diff
${staged}
\`\`\`

Unstaged diff (เทียบกับ index):
\`\`\`diff
${unstaged}
\`\`\`

รูปแบบคำตอบ:
1. **สรุปภาพรวม** — changes ชุดนี้ทำอะไร เพื่ออะไร
2. **แยกตามไฟล์/กลุ่ม** — แต่ละไฟล์เปลี่ยนอะไรแบบสั้น ๆ
3. **⭐ จุดที่มนุษย์ต้อง review เอง** — checklist ของจุดที่ AI ตัดสินแทนไม่ได้ เช่น logic ที่เปลี่ยนพฤติกรรม, business rule, ค่าคงที่, migration, ความเข้ากันได้กับส่วนอื่น
4. **ความเสี่ยงโดยรวม** — สิ่งที่ควรทดสอบก่อน commit

ใช้ git_diff / read_file tools ตรวจรายละเอียดเพิ่มได้ถ้า patch ไม่พอ
${THAI_FOOTER}`;
}

/**
 * สรุปการเปลี่ยนแปลงของไฟล์ระหว่างสอง commit (commitDiff tabs จาก
 * History/CompareView). ไม่มี commit-patch tool ฝั่ง backend (git_show ให้
 * เฉพาะ line stats) จึง embed content ทั้งสองเวอร์ชัน inline (clipped).
 */
export function buildCommitFileSummaryPrompt(
  path: string,
  fromLabel: string,
  toLabel: string,
  original: string,
  modified: string,
): string {
  return `ช่วยสรุปการเปลี่ยนแปลงของไฟล์ \`${path}\` ระหว่าง commit \`${fromLabel}\` → \`${toLabel}\`

โค้ดเดิม (ที่ \`${fromLabel}\`):
\`\`\`
${clip(original)}
\`\`\`

โค้ดใหม่ (ที่ \`${toLabel}\`):
\`\`\`
${clip(modified)}
\`\`\`

(ถ้าเนื้อหาถูกตัดให้สรุปเท่าที่เห็นและระบุไว้ด้วย)
รูปแบบคำตอบ:
1. **สรุปภาพรวม** 1–2 ประโยค — แก้อะไร เพื่ออะไร (ดู commit message ผ่าน git_show ประกอบได้)
2. **รายละเอียดสำคัญ** เป็น bullet (อ้าง file:line)
3. **จุดที่คน review ต้องดูเป็นพิเศษ** (ถ้าไม่มีให้บอกว่าไม่มี)

${THAI_FOOTER}`;
}

/** หา bug / ความผิดพลาด / edge case จาก changes (scope = path หรือ "changes ทั้งหมด"). */
export function buildBugHuntPrompt(scope: string, patch: string): string {
  const context = patch.trim()
    ? `Unified diff ที่ต้องวิเคราะห์:\n\n\`\`\`diff\n${clip(patch)}\n\`\`\``
    : `ไม่มี diff inline — ใช้ git_diff / read_file tools ดึง changes ของ ${scope} มาวิเคราะห์เอง`;
  return `ช่วยหา bug / ความผิดพลาด / edge case ที่อาจเกิดจาก ${scope}

${context}

วิเคราะห์เชิงลึก: logic ผิด, off-by-one, null/undefined, error handling ที่หายไป, race condition, ผลข้างเคียงกับ caller, เคสที่เคยทำงานแล้วจะพัง
ตอบเป็น findings ตาม format code review ของระบบ ([severity] category — file:line) เรียง critical ก่อน
ถ้าไม่พบปัญหา ให้บอกชัดเจนและเสนอสิ่งที่ควรทดสอบเพิ่ม 1–2 ข้อ

${THAI_FOOTER}`;
}

export interface ExplainInput {
  path: string;
  /** 1-based inclusive line range on the working-tree side. */
  startLine: number;
  endLine: number;
  /** Selected code (editor) or added lines (diff chunk). */
  snippet: string;
  /** Diff chunk only: lines that were removed. */
  removed?: string;
}

/** อธิบาย code/chunk — คืออะไร ทำไมต้องแก้ เกี่ยวกับอะไร ตรวจยังไง เสี่ยงอะไร. */
export function buildExplainPrompt(input: ExplainInput): string {
  const ref =
    input.startLine === input.endLine
      ? `${input.path}:${input.startLine}`
      : `${input.path}:${input.startLine}-${input.endLine}`;
  const context =
    input.removed !== undefined
      ? `Change chunk ในไฟล์ \`${input.path}\` (ด้านใหม่เริ่มบรรทัด ${input.startLine}):

โค้ดเดิมที่ถูกลบ/แทนที่:
\`\`\`
${clip(input.removed) || "(ไม่มี — เป็นการเพิ่มบรรทัดใหม่ล้วน)"}
\`\`\`

โค้ดใหม่:
\`\`\`
${clip(input.snippet) || "(ไม่มี — เป็นการลบบรรทัดล้วน)"}
\`\`\``
      : `Selection \`${ref}\`:

\`\`\`
${clip(input.snippet)}
\`\`\``;
  return `ช่วยอธิบายโค้ดส่วนนี้ให้หน่อย

${context}

ตอบครบ 5 ประเด็น:
1. **คืออะไร** — สรุป 1 ประโยคว่าโค้ด/chunk นี้ทำอะไร
2. **ทำไปเพื่ออะไร** — จุดประสงค์/ปัญหาที่แก้ (ถ้าเป็น chunk ใน diff ให้เทียบกับโค้ดเดิม)
3. **เกี่ยวข้องกับอะไร** — ใช้ read_file / read_file_range tools ตามไปดู caller, import, หรือไฟล์ที่เกี่ยวข้อง แล้วบอกว่าการเปลี่ยนตรงนี้กระทบที่ไหน
4. **ต้องตรวจสอบยังไง** — วิธี verify ว่าถูกต้อง (test ที่ควรรัน / เคสที่ต้องลอง)
5. **ความเสี่ยง** — สิ่งที่อาจพังถ้าส่วนนี้ผิด

${THAI_FOOTER}`;
}

/** หัวข้อ bubble ฝั่ง user ใน thread — สั้น ไม่ใช่ prompt เต็ม. */
export function userBubbleLabel(kind: AiReviewKind, target?: string): string {
  switch (kind) {
    case "file-summary":
      return `สรุปการเปลี่ยนแปลงของ \`${target}\``;
    case "review-all":
      return "สรุป changes ทั้งหมด + จุดที่ต้อง review";
    case "bug-hunt":
      return target ? `หาบั๊กใน \`${target}\`` : "หาบั๊กใน changes ทั้งหมด";
    case "explain":
      return `อธิบาย \`${target}\``;
  }
}

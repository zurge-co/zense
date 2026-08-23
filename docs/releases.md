# Releases & Auto-Update (Cloudflare R2 + Workers)

Zense ปล่อย binary ฟรีแต่ไม่เปิดซอร์ส — เลยไม่ใช้ GitHub Releases (repo เป็น
private โหลด anonymous ไม่ได้) ระบบ update ทั้งหมดอยู่บน Cloudflare แทน:

```
scripts/publish-update.mjs         Cloudflare
┌───────────────────────────┐      ┌──────────────────────────────────┐
│ 1. bun tauri build (+sign)│      │ R2 bucket "zense-releases":      │
│ 2. generate latest.json   │ ───▶ │  ├─ latest.json                  │
│ 3. wrangler r2 object put │      │  ├─ zense_<ver>_<arch>.app.tar.gz│
└───────────────────────────┘      │  ├─ ….app.tar.gz.sig            │
                                   │  ├─ zense_<ver>_<arch>.dmg       │
                                   │  └─ install.sh                   │
                                   │ Worker "zense-dl" (public):      │
                                   │  ├─ GET /latest.json             │
                                   │  ├─ GET /download/<file>         │
                                   │  └─ GET /install.sh              │
                                   └──────────────────────────────────┘
```

## ครั้งแรกครั้งเดียว — setup

### 1. Signing key (สร้างแล้วเก็บให้ดี ห้าม commit)

```bash
bun tauri signer generate -w ~/.tauri/zense.key
```

- **private key** อยู่นอก repo (`~/.tauri/zense.key`) — ถ้าหาย = ออกอัปเดตต่อไม่ได้
- **public key** ถูกใส่ใน `src-tauri/tauri.conf.json → plugins.updater.pubkey` แล้ว

### 2. Deploy Cloudflare

```bash
cd cloudflare
bunx wrangler login
bunx wrangler r2 bucket create zense-releases
bunx wrangler deploy          # deploy worker.ts
```

จด URL ที่ได้ เช่น `https://zense-dl.<subdomain>.workers.dev`
(ถ้าจะใช้ custom domain: `bunx wrangler domains add dl.example.com` ในโฟลเดอร์นี้)

### 3. ผูก domain เข้ากับแอป

แก้ `src-tauri/tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "endpoints": ["https://zense-dl.<subdomain>.workers.dev/latest.json"]
  }
}
```

จากนั้น build/publish ครั้งถัดไปแอปจะรู้จัก endpoint นี้

## ออก release ใหม่

```bash
# 1) อัปเดต version ใน src-tauri/tauri.conf.json
# 2) publish
export ZENSE_DOWNLOAD_URL="https://zense-dl.<subdomain>.workers.dev"
bun run publish            # เต็ม: build + sign + latest.json + upload
bun run publish -- --dry-run     # ดูก่อนว่าจะอัปโหลดอะไรบ้าง
bun run publish -- --skip-build  # ใช้ bundle ที่ build ไว้แล้ว
```

สคริปต์จะอัปโหลด: `latest.json`, `*.app.tar.gz(.sig)` (rename เป็น
`zense_<ver>_<arch>.app.tar.gz`), `*.dmg`, และ `install.sh` (แปะ origin จริงให้แล้ว)

> หมายเหตุ: `NOTES="..."` env ใส่ release notes ที่จะไปโผล่ใน latest.json ได้

## ผู้ใช้ติดตั้งครั้งแรก (macOS)

```bash
curl -fsSL https://zense-dl.<subdomain>.workers.dev/install.sh | bash
```

สคริปต์จะโหลด dmg ล่าสุด → mount → copy ลง `/Applications` →
`xattr -dr com.apple.quarantine` (แทน Apple notarization ที่เราไม่มี) → เปิดแอป

## อัปเดตรอบต่อไป = อัตโนมัติ

- แอปเช็ค `latest.json` ตอนเปิด (`src/components/UpdateDialog.tsx` + `src/lib/updater.ts`)
- ถ้ามีเวอร์ชันใหม่ → modal ถามผู้ใช้ → โหลด + ตรวจ minisign signature →
  install → relaunch
- ไฟล์ที่ updater เขียนเองไม่ถูกติด quarantine จึงไม่โดน Gatekeeper ขวางซ้ำ
- เช็คไม่ได้ (offline / endpoint ล่ม) = เงียบ ๆ ข้ามไป แอปไม่ค้าง

## Troubleshooting

| อาการ | สาเหตุที่เจอบ่อย |
|---|---|
| แอปบอก update failed / signature invalid | build ไม่ได้ sign (ลืมตั้ง key) หรือ pubkey ใน config ไม่ตรงกับ key ที่ sign |
| macOS บล็อกตอนเปิดแอปที่เพิ่งติดตั้ง | install script ไม่ได้รัน / โหลด dmg เองด้วยมือ → รัน `xattr -dr com.apple.quarantine /Applications/zense.app` |
| `wrangler r2 object put` 401 | `bunx wrangler login` ใหม่ หรือ token หมดอายุ |
| อัปเดตแล้ว version ไม่เปลี่ยน | ลืม bump version ใน `tauri.conf.json` ก่อน publish (updater เทียบ semver กับของเดิม) |

## ข้อจำกัดตอนนี้

- รองรับ **macOS เท่านั้น** (aarch64/x64) — Windows/Linux ยังไม่ได้ทำ
- minisign private key มีชุดเดียว ทุกเครื่องที่ publish ต้องใช้ key เดียวกัน

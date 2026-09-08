# Release Notes

<!--
  แก้ไฟล์นี้ก่อน release ทุกครั้ง — scripts/release.mjs อ่านเนื้อหาในไฟล์นี้
  (ตัด HTML comment ออก) ไปใส่ latest.json → แสดงใน UpdateDialog ของแอป
  และอยู่ในข้อความของ git tag ด้วย ถ้าไฟล์ว่างหรือมีแต่หัวข้อ release จะ fail
-->

## v0.13.0

- ✨ เพิ่มการตั้งค่า **Preferred language** ใน Settings > LLM — เลือกให้ AI ตอบเป็นไทยหรืออังกฤษได้
- AI จะตอบเป็นภาษาที่เลือกเสมอ กระชับและใช้คำง่าย ๆ (prompt ภายในทั้งหมดปรับเป็นภาษาอังกฤษ)

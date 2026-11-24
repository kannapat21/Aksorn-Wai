'use strict';
/*
 * คัดลอกไลบรารีฝั่งเบราว์เซอร์ (โหมด serverless) ไปไว้ใน public/vendor/ ให้เว็บเสิร์ฟจากโดเมนร้านเอง
 *   - @ffmpeg/ffmpeg (ตัวคุม ffmpeg.wasm ไม่กี่ KB · ตัวเข้ารหัสจริง ~32 MB โหลดจาก jsDelivr ตอนใช้ครั้งแรก)
 *   - mediabunny (อ่าน/เขียนวิดีโอด้วย WebCodecs)
 * รันเองอัตโนมัติหลัง npm install และตอน build บน Netlify
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'vendor');

// หา package.json ตรงๆ (บางแพ็กเกจปิด require ไฟล์นี้ผ่าน "exports")
function find(pkgFile) {
  const f = path.join(ROOT, 'node_modules', pkgFile);
  return fs.existsSync(f) ? f : null;
}

const ff = find('@ffmpeg/ffmpeg/package.json');
const mb = find('mediabunny/package.json');
if (!ff || !mb) {
  console.log('[vendor] ข้าม: ยังไม่ได้ติดตั้ง @ffmpeg/ffmpeg / mediabunny (ใช้เฉพาะโหมดเบราว์เซอร์)');
  process.exit(0);
}
fs.mkdirSync(path.join(OUT, 'ffmpeg'), { recursive: true });
const ffDir = path.join(path.dirname(ff), 'dist', 'esm');
for (const f of fs.readdirSync(ffDir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(ffDir, f), path.join(OUT, 'ffmpeg', f));
fs.copyFileSync(path.join(path.dirname(mb), 'dist', 'bundles', 'mediabunny.min.mjs'), path.join(OUT, 'mediabunny.min.mjs'));
console.log('[vendor] คัดลอกไลบรารีเบราว์เซอร์ไว้ที่ public/vendor/ แล้ว');

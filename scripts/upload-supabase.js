#!/usr/bin/env node
// อัปไฟล์สินค้าทุกชิ้น (storage/products/<slug>/) ขึ้น Supabase Storage แบบ private
// ใช้: SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_KEY=... npm run upload:supabase
//      เพิ่ม --force เพื่ออัปทับไฟล์ที่มีอยู่แล้ว
// ไฟล์ใหญ่เกิน 48MB (เกินขีด 50MB ต่อไฟล์ของ Supabase ฟรี) จะถูกบีบเป็น .zip ก่อนอัป
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { loadConfig } = require('../src/config');
const { createStorage, productKey } = require('../src/storage');

const MAX_FILE = 50 * 1024 * 1024;
const TYPES = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', png: 'image/png', zip: 'application/zip', txt: 'text/plain' };

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// zip ไฟล์เดียว (deflate) เปิดได้ทุกเครื่องโดยไม่ต้องลงโปรแกรม
function zipOne(name, data) {
  const nameBuf = Buffer.from(name, 'utf8');
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(0, 42);
  const localLen = local.length + nameBuf.length + comp.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBuf.length, 12); end.writeUInt32LE(localLen, 16);
  return Buffer.concat([local, nameBuf, comp, central, nameBuf, end]);
}

async function main() {
  const force = process.argv.includes('--force');
  const cfg = loadConfig({ ...process.env, NODE_ENV: 'development', STORAGE_DRIVER: 'supabase' });
  if (!cfg.storage.supabaseUrl || !cfg.storage.supabaseKey) {
    console.error('ต้องตั้ง SUPABASE_URL และ SUPABASE_SERVICE_KEY ก่อน (ดู docs/ย้ายขึ้น-Netlify.md)');
    process.exit(1);
  }
  const storage = createStorage(cfg);
  const slugs = fs.readdirSync(cfg.storageDir).filter((s) => fs.existsSync(path.join(cfg.storageDir, s, 'manifest.json')));
  let sent = 0, skipped = 0, bytes = 0;
  for (const slug of slugs) {
    const manifest = JSON.parse(fs.readFileSync(path.join(cfg.storageDir, slug, 'manifest.json'), 'utf8'));
    for (const file of manifest.files) {
      const k = productKey(slug, file);
      if (!force && await storage.exists(k.key)) { skipped++; continue; }
      let buf = fs.readFileSync(path.join(cfg.storageDir, slug, path.basename(file.file)));
      if (k.zipped) buf = zipOne(file.file, buf);
      if (buf.length > MAX_FILE) throw new Error(`${k.key} ใหญ่ ${(buf.length / 1048576).toFixed(1)}MB เกิน 50MB ของ Supabase ฟรี`);
      process.stdout.write(`อัป ${k.key} (${(buf.length / 1048576).toFixed(1)}MB)… `);
      await storage.put(k.key, buf, TYPES[path.extname(k.name).slice(1)] || 'application/octet-stream');
      console.log('เสร็จ');
      sent++; bytes += buf.length;
    }
  }
  console.log(`\nเรียบร้อย: อัปใหม่ ${sent} ไฟล์ (${(bytes / 1048576).toFixed(0)}MB) · ข้ามไฟล์ที่มีแล้ว ${skipped} ไฟล์`);
}

if (require.main === module) main().catch((e) => { console.error('\nอัปไม่สำเร็จ:', e.message); process.exit(1); });
module.exports = { zipOne, crc32 };

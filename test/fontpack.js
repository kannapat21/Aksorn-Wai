'use strict';
/* ตัวช่วยในเทสต์: แปลงไฟล์ TTF เป็น WOFF / WOFF2 (แบบไม่แปลงรูป glyf) เพื่อทดสอบตัวตรวจฟอนต์ */
const zlib = require('zlib');

function readTables(ttf) {
  const n = ttf.readUInt16BE(4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = 12 + i * 16;
    out.push({ tag: ttf.toString('latin1', p, p + 4), checksum: ttf.readUInt32BE(p + 4), data: ttf.subarray(ttf.readUInt32BE(p + 8), ttf.readUInt32BE(p + 8) + ttf.readUInt32BE(p + 12)) });
  }
  return out;
}

const pad4 = (n) => (n + 3) & ~3;

function toWoff(ttf) {
  const tables = readTables(ttf);
  const parts = tables.map((t) => {
    const z = zlib.deflateSync(t.data);
    return { ...t, comp: z.length < t.data.length ? z : t.data };
  });
  const headLen = 44 + tables.length * 20;
  let off = headLen;
  const dir = Buffer.alloc(tables.length * 20);
  parts.forEach((t, i) => {
    dir.write(t.tag, i * 20, 'latin1');
    dir.writeUInt32BE(off, i * 20 + 4);
    dir.writeUInt32BE(t.comp.length, i * 20 + 8);
    dir.writeUInt32BE(t.data.length, i * 20 + 12);
    dir.writeUInt32BE(t.checksum, i * 20 + 16);
    t.off = off;
    off += pad4(t.comp.length);
  });
  const out = Buffer.alloc(off);
  out.write('wOFF', 0, 'latin1');
  ttf.copy(out, 4, 0, 4);
  out.writeUInt32BE(off, 8);
  out.writeUInt16BE(tables.length, 12);
  out.writeUInt32BE(ttf.length, 16);
  dir.copy(out, 44);
  parts.forEach((t) => t.comp.copy(out, t.off));
  return out;
}

const WOFF2_TAGS = require('../src/fontcheck').WOFF2_TAGS;

function base128(n) {
  const bytes = [];
  do { bytes.unshift(n & 0x7f); n >>>= 7; } while (n);
  return bytes.map((b, i) => (i < bytes.length - 1 ? b | 0x80 : b));
}

function toWoff2(ttf) {
  const tables = readTables(ttf);
  const dir = [];
  for (const t of tables) {
    const idx = WOFF2_TAGS.indexOf(t.tag);
    const nullT = t.tag === 'glyf' || t.tag === 'loca' ? 3 : 0; // ไม่แปลงรูป
    if (idx >= 0) dir.push((nullT << 6) | idx); else { dir.push((nullT << 6) | 63); dir.push(...Buffer.from(t.tag, 'latin1')); }
    dir.push(...base128(t.data.length));
  }
  const stream = Buffer.concat(tables.map((t) => t.data));
  const comp = zlib.brotliCompressSync(stream);
  const header = Buffer.alloc(48);
  header.write('wOF2', 0, 'latin1');
  ttf.copy(header, 4, 0, 4);
  const total = pad4(48 + dir.length + comp.length); // ไฟล์ WOFF2 ต้องยาวเป็นทวีคูณของ 4
  header.writeUInt32BE(total, 8);
  header.writeUInt16BE(tables.length, 12);
  header.writeUInt32BE(ttf.length, 16);
  header.writeUInt32BE(comp.length, 20);
  const body = Buffer.concat([header, Buffer.from(dir), comp]);
  return Buffer.concat([body, Buffer.alloc(total - body.length)]);
}

module.exports = { toWoff, toWoff2 };

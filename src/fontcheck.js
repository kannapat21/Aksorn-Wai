'use strict';
/*
 * ตรวจไฟล์ฟอนต์ที่ลูกค้าอัปโหลด โดยอ่านโครงสร้างไฟล์จริง (ไม่เชื่อนามสกุล)
 *   รองรับ TrueType (.ttf), OpenType (.otf), WOFF, WOFF2
 *   - ตรวจหัวไฟล์ ตารางที่จำเป็น และขอบเขตทุกตาราง
 *   - อ่าน cmap ว่ามีตัวอักษรไหนบ้าง (โดยเฉพาะอักษรไทย)
 *   - อ่านชื่อฟอนต์จากตาราง name
 * ไม่มีการรันโค้ดในไฟล์ฟอนต์ และเบราว์เซอร์ (Chrome) ยังตรวจซ้ำด้วย OTS ตอนโหลดฟอนต์อีกชั้น
 */
const zlib = require('zlib');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DECODED = 30 * 1024 * 1024;

class FontError extends Error {
  constructor(msg) { super(msg); this.name = 'FontError'; }
}

const WOFF2_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC',
  'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar',
  'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

const tagAt = (b, o) => b.toString('latin1', o, o + 4);
function need(cond, msg) { if (!cond) throw new FontError(msg || 'ไฟล์ฟอนต์เสียหรือไม่ใช่ฟอนต์'); }

// ---------- อ่านตารางจากแต่ละรูปแบบไฟล์ → { tag: Buffer } ----------
function sfntTables(b) {
  need(b.length >= 12);
  const n = b.readUInt16BE(4);
  need(n > 0 && n < 200 && 12 + n * 16 <= b.length);
  const tables = {};
  for (let i = 0; i < n; i++) {
    const p = 12 + i * 16;
    const off = b.readUInt32BE(p + 8), len = b.readUInt32BE(p + 12);
    need(off + len <= b.length, 'ตารางในไฟล์ฟอนต์ชี้ออกนอกไฟล์');
    tables[tagAt(b, p)] = b.subarray(off, off + len);
  }
  return tables;
}

function woffTables(b) {
  need(b.length >= 44);
  const n = b.readUInt16BE(12);
  need(n > 0 && n < 200 && 44 + n * 20 <= b.length);
  const tables = {};
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p = 44 + i * 20;
    const off = b.readUInt32BE(p + 4), comp = b.readUInt32BE(p + 8), orig = b.readUInt32BE(p + 12);
    need(off + comp <= b.length && comp <= orig, 'ตารางในไฟล์ฟอนต์ชี้ออกนอกไฟล์');
    total += orig;
    need(total <= MAX_DECODED, 'ไฟล์ฟอนต์ใหญ่เกินไปหลังคลายบีบอัด');
    const raw = b.subarray(off, off + comp);
    const data = comp < orig ? zlib.inflateSync(raw, { maxOutputLength: orig }) : raw;
    need(data.length === orig);
    tables[tagAt(b, p)] = data;
  }
  return tables;
}

function readBase128(b, st) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    need(st.p < b.length);
    const x = b[st.p++];
    need(!(i === 0 && x === 0x80));
    need((v & 0xFE000000) === 0);
    v = (v << 7) | (x & 0x7f);
    if (!(x & 0x80)) return v >>> 0;
  }
  throw new FontError();
}

function woff2Tables(b) {
  need(b.length >= 48);
  need(tagAt(b, 4) !== 'ttcf', 'ยังไม่รองรับไฟล์รวมหลายฟอนต์ (font collection)');
  const n = b.readUInt16BE(12);
  const compressed = b.readUInt32BE(20);
  need(n > 0 && n < 200);
  const st = { p: 48 };
  const dir = [];
  for (let i = 0; i < n; i++) {
    need(st.p < b.length);
    const flags = b[st.p++];
    const idx = flags & 0x3f;
    const version = flags >> 6;
    let tag;
    if (idx === 63) { need(st.p + 4 <= b.length); tag = tagAt(b, st.p); st.p += 4; } else { tag = WOFF2_TAGS[idx]; need(tag); }
    const orig = readBase128(b, st);
    const isGlyfLoca = tag === 'glyf' || tag === 'loca';
    const transformed = isGlyfLoca ? version !== 3 : version !== 0;
    const len = transformed ? readBase128(b, st) : orig;
    dir.push({ tag, len, transformed });
  }
  need(st.p + compressed <= b.length, 'ไฟล์ WOFF2 ไม่ครบ');
  const total = dir.reduce((s, d) => s + d.len, 0);
  need(total <= MAX_DECODED, 'ไฟล์ฟอนต์ใหญ่เกินไปหลังคลายบีบอัด');
  let data;
  try {
    data = zlib.brotliDecompressSync(b.subarray(st.p, st.p + compressed), { maxOutputLength: MAX_DECODED });
  } catch { throw new FontError('ไฟล์ WOFF2 เสีย (คลายบีบอัดไม่ได้)'); }
  need(data.length >= total, 'ไฟล์ WOFF2 ไม่ครบ');
  const tables = {};
  let off = 0;
  for (const d of dir) {
    // glyf/loca/hmtx ที่ถูกแปลงรูปไม่ต้องใช้ในการตรวจ แค่รู้ว่ามี
    tables[d.tag] = d.transformed ? Buffer.alloc(0) : data.subarray(off, off + d.len);
    off += d.len;
  }
  return tables;
}

// ---------- cmap: ตัวอักษรที่ฟอนต์มี ----------
function cmapLookup(cmap) {
  need(cmap && cmap.length >= 4, 'ไม่มีตาราง cmap');
  const n = cmap.readUInt16BE(2);
  need(4 + n * 8 <= cmap.length);
  const subs = [];
  for (let i = 0; i < n; i++) {
    const p = 4 + i * 8;
    const platform = cmap.readUInt16BE(p), encoding = cmap.readUInt16BE(p + 2), off = cmap.readUInt32BE(p + 4);
    need(off + 4 <= cmap.length);
    subs.push({ platform, encoding, off, format: cmap.readUInt16BE(off) });
  }
  const unicode = (s) => s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10));
  const sub = subs.find((s) => unicode(s) && s.format === 12) || subs.find((s) => unicode(s) && s.format === 4);
  need(sub, 'ฟอนต์นี้ไม่มีตารางตัวอักษร Unicode');
  const o = sub.off;
  if (sub.format === 4) {
    need(o + 14 <= cmap.length);
    const segX2 = cmap.readUInt16BE(o + 6);
    const end = o + 14, start = end + segX2 + 2, delta = start + segX2, range = delta + segX2;
    need(range + segX2 <= cmap.length);
    return (cp) => {
      if (cp > 0xffff) return false;
      for (let i = 0; i < segX2; i += 2) {
        const e = cmap.readUInt16BE(end + i);
        if (cp > e) continue;
        const s = cmap.readUInt16BE(start + i);
        if (cp < s) return false;
        const ro = cmap.readUInt16BE(range + i);
        if (ro === 0) return ((cp + cmap.readInt16BE(delta + i)) & 0xffff) !== 0;
        const gp = range + i + ro + (cp - s) * 2;
        if (gp + 2 > cmap.length) return false;
        const g = cmap.readUInt16BE(gp);
        return g !== 0 && ((g + cmap.readInt16BE(delta + i)) & 0xffff) !== 0;
      }
      return false;
    };
  }
  need(o + 16 <= cmap.length);
  const groups = cmap.readUInt32BE(o + 12);
  need(o + 16 + groups * 12 <= cmap.length);
  return (cp) => {
    for (let i = 0; i < groups; i++) {
      const p = o + 16 + i * 12;
      if (cp >= cmap.readUInt32BE(p) && cp <= cmap.readUInt32BE(p + 4)) return cmap.readUInt32BE(p + 8) + (cp - cmap.readUInt32BE(p)) !== 0;
    }
    return false;
  };
}

// ---------- name: ชื่อฟอนต์ ----------
function fontName(name) {
  if (!name || name.length < 6) return '';
  const count = name.readUInt16BE(2), strOff = name.readUInt16BE(4);
  const recs = [];
  for (let i = 0; i < count && 6 + i * 12 + 12 <= name.length; i++) {
    const p = 6 + i * 12;
    recs.push({ platform: name.readUInt16BE(p), id: name.readUInt16BE(p + 6), len: name.readUInt16BE(p + 8), off: name.readUInt16BE(p + 10) });
  }
  for (const id of [4, 1]) {
    for (const r of recs.filter((x) => x.id === id).sort((a, b) => b.platform - a.platform)) {
      const s = strOff + r.off;
      if (s + r.len > name.length) continue;
      const raw = name.subarray(s, s + r.len);
      const text = r.platform === 3 || r.platform === 0 ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('latin1');
      const clean = text.replace(/[^\p{L}\p{N} ._'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (clean) return clean;
    }
  }
  return '';
}

// ตัวอักษรที่ตรวจว่าฟอนต์มีไหม (ตรงกับที่หน้าปรับแต่งยอมให้พิมพ์)
const CHECK_CHARS = (() => {
  const out = [];
  for (let c = 0x21; c <= 0x7e; c++) out.push(c);
  for (let c = 0x0e01; c <= 0x0e3a; c++) out.push(c);
  for (let c = 0x0e3f; c <= 0x0e5b; c++) out.push(c);
  for (const ch of '‘’“”…–—•·×÷°') out.push(ch.codePointAt(0));
  return out;
})();
const THAI_CONSONANTS = Array.from({ length: 0x0e2e - 0x0e01 + 1 }, (_, i) => 0x0e01 + i);

/*
 * ตรวจไฟล์ฟอนต์ → { format, ext, mime, name, chars (สตริงของตัวอักษรที่มี), thai: 'full'|'partial'|'none' }
 * ผิดรูปแบบ → throw FontError (ข้อความภาษาไทย)
 */
function inspectFont(buf) {
  try {
    return inspect(buf);
  } catch (e) {
    if (e instanceof FontError) throw e;
    throw new FontError('ไฟล์ฟอนต์เสียหรือไม่ใช่ฟอนต์'); // อ่านเกินขอบ / คลายบีบอัดไม่ได้ ฯลฯ
  }
}

function inspect(buf) {
  need(Buffer.isBuffer(buf) && buf.length > 0, 'ไม่ได้เลือกไฟล์');
  need(buf.length <= MAX_BYTES, 'ไฟล์ฟอนต์ใหญ่เกิน 5 MB');
  need(buf.length >= 12, 'ไฟล์นี้ไม่ใช่ฟอนต์');
  const sig = buf.readUInt32BE(0);
  let format, tables;
  if (sig === 0x00010000 || tagAt(buf, 0) === 'true') { format = 'ttf'; tables = sfntTables(buf); }
  else if (tagAt(buf, 0) === 'OTTO') { format = 'otf'; tables = sfntTables(buf); }
  else if (tagAt(buf, 0) === 'wOFF') { format = 'woff'; tables = woffTables(buf); }
  else if (tagAt(buf, 0) === 'wOF2') { format = 'woff2'; tables = woff2Tables(buf); }
  else throw new FontError('ไฟล์นี้ไม่ใช่ฟอนต์ (รองรับ .ttf .otf .woff .woff2)');

  need(tables.head && tables.maxp, 'ไฟล์ฟอนต์ไม่ครบ (ไม่มีตาราง head/maxp)');
  need(tables.glyf || tables['CFF '] || tables.CFF2, 'ไฟล์ฟอนต์ไม่มีรูปตัวอักษร');
  if (tables.head.length >= 16) need(tables.head.readUInt32BE(12) === 0x5f0f3cf5, 'ไฟล์ฟอนต์เสีย (head ไม่ถูกต้อง)');
  const has = cmapLookup(tables.cmap);
  const chars = CHECK_CHARS.filter(has).map((c) => String.fromCodePoint(c)).join('');
  const thaiCount = THAI_CONSONANTS.filter(has).length;
  const thai = thaiCount === THAI_CONSONANTS.length ? 'full' : thaiCount > 0 ? 'partial' : 'none';
  const mime = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' }[format];
  return { format, ext: format, mime, name: fontName(tables.name), chars, thai };
}

module.exports = { inspectFont, FontError, MAX_BYTES, WOFF2_TAGS };

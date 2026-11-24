'use strict';
/*
 * ที่เก็บไฟล์สินค้า (ไฟล์ที่ลูกค้าซื้อ) และฟอนต์ที่ลูกค้าอัปโหลด
 *   local    : โฟลเดอร์ในเครื่อง (storage/products, storage/user-fonts) ร้านส่งไฟล์เอง
 *   supabase : Supabase Storage บักเก็ตแบบ private (ไม่มีใครโหลดตรงได้)
 *              ร้านตรวจสิทธิ์ก่อน แล้วส่งลูกค้าไปโหลดด้วยลิงก์ที่เซ็นแล้ว อายุสั้น (ไฟล์ไม่ผ่านเซิร์ฟเวอร์ร้าน แรมไม่ขึ้น)
 * โครงชื่อไฟล์ในบักเก็ต:  products/<slug>/<ไฟล์>  ·  user-fonts/<user>/<id>.<ext>
 */
const fs = require('fs');
const path = require('path');

function createStorage(cfg, opts = {}) {
  const S = cfg.storage || { driver: 'local' };
  if (S.driver !== 'supabase') return { driver: 'local' };
  const fetchImpl = opts.fetch || globalThis.fetch;
  const base = `${S.supabaseUrl}/storage/v1`;
  const headers = { Authorization: `Bearer ${S.supabaseKey}`, apikey: S.supabaseKey };
  const enc = (key) => key.split('/').map(encodeURIComponent).join('/');

  async function call(method, url, body, extra = {}) {
    const r = await fetchImpl(url, { method, headers: { ...headers, ...extra }, body });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      const e = new Error(`Supabase Storage ${method} ${r.status}: ${t.slice(0, 300)}`);
      e.status = r.status;
      throw e;
    }
    return r;
  }

  return {
    driver: 'supabase',
    origin: new URL(S.supabaseUrl).origin,
    // ลิงก์โหลดชั่วคราว (วินาที) · downloadName = ชื่อไฟล์ที่ลูกค้าเห็นตอนบันทึก
    async signedUrl(key, { expiresIn = 600, downloadName } = {}) {
      const r = await call('POST', `${base}/object/sign/${S.bucket}/${enc(key)}`, JSON.stringify({ expiresIn }), { 'Content-Type': 'application/json' });
      const j = await r.json();
      const u = new URL(`${base}${j.signedURL || j.signedUrl}`);
      if (downloadName !== undefined) u.searchParams.set('download', downloadName);
      return u.toString();
    },
    async put(key, buf, contentType = 'application/octet-stream') {
      await call('POST', `${base}/object/${S.bucket}/${enc(key)}`, buf, { 'Content-Type': contentType, 'x-upsert': 'true', 'cache-control': '3600' });
    },
    async get(key) {
      const r = await call('GET', `${base}/object/authenticated/${S.bucket}/${enc(key)}`);
      return Buffer.from(await r.arrayBuffer());
    },
    async remove(key) {
      await call('DELETE', `${base}/object/${S.bucket}`, JSON.stringify({ prefixes: [key] }), { 'Content-Type': 'application/json' });
    },
    async exists(key) {
      const r = await fetchImpl(`${base}/object/info/authenticated/${S.bucket}/${enc(key)}`, { headers });
      return r.ok;
    },
  };
}

// Supabase ฟรีรับไฟล์ละไม่เกิน 50 MB → ไฟล์ที่ใหญ่กว่านี้อัปเป็น .zip (ProRes บีบได้ราว 25%) ลูกค้าแตกไฟล์แล้วใช้ได้เลย
const ZIP_OVER = 48 * 1000 * 1000;
function productKey(slug, file) {
  const zipped = Number(file.bytes) > ZIP_OVER;
  const name = zipped ? `${file.file}.zip` : file.file;
  return { key: `products/${slug}/${name}`, name, zipped };
}

// ไฟล์ทั้งหมดของสินค้าในเครื่อง (ใช้ตอนอัปขึ้น Supabase) ยกเว้น manifest
function productFiles(storageDir, slug) {
  const dir = path.join(storageDir, slug);
  return fs.readdirSync(dir).filter((f) => f !== 'manifest.json' && !f.startsWith('.')).map((f) => ({ key: `products/${slug}/${f}`, file: path.join(dir, f) }));
}

module.exports = { createStorage, productFiles, productKey, ZIP_OVER };

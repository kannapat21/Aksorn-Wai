'use strict';
/*
 * เข้าสู่ระบบด้วย Clerk (รวม "เข้าสู่ระบบด้วย Google")
 *  - หน้าเว็บโหลดกล่องล็อกอินของ Clerk → ลูกค้าล็อกอิน → เบราว์เซอร์ได้ session token (JWT อายุสั้น) จาก Clerk
 *  - เบราว์เซอร์ส่ง token มาที่ POST /auth/clerk → ร้านตรวจลายเซ็นกับกุญแจสาธารณะของ Clerk (JWKS)
 *    แล้วถาม Clerk ว่าอีเมลหลักของคนนี้คืออะไร และยืนยันแล้วหรือยัง
 *  - จับคู่กับบัญชีเดิมของร้านด้วยอีเมล (ไม่มี = สร้างใหม่) แล้วเปิดเซสชันของร้านเองเหมือนเดิม
 *    ออเดอร์ คลัง และสิทธิ์แอดมินเดิมจึงใช้ได้ทั้งหมด
 * ไม่ใช้ไลบรารีเพิ่ม (ใช้ fetch + crypto ของ Node)
 */
const crypto = require('crypto');

const API = 'https://api.clerk.com/v1';
const SKEW_SEC = 10;

// pk_test_<base64("xxx.clerk.accounts.dev$")> → "xxx.clerk.accounts.dev"
function frontendApiFromKey(pk) {
  const m = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(String(pk || '').trim());
  if (!m) return '';
  let host = '';
  try { host = Buffer.from(m[2], 'base64').toString('utf8'); } catch { return ''; }
  host = host.replace(/\$$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) ? host.toLowerCase() : '';
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

function createClerk(cfg, { fetch: fetchFn = globalThis.fetch, now = () => Date.now() } = {}) {
  const c = cfg.clerk;
  const issuer = `https://${c.frontendApi}`;
  const origin = (() => { try { return new URL(cfg.baseUrl).origin; } catch { return ''; } })();
  let keys = new Map();
  let keysAt = 0;

  async function api(p) {
    const r = await fetchFn(`${API}${p}`, { headers: { Authorization: `Bearer ${c.secretKey}`, Accept: 'application/json' } });
    if (!r.ok) throw Object.assign(new Error(`Clerk API ${r.status}`), { status: r.status });
    return r.json();
  }

  async function keyFor(kid) {
    const fresh = now() - keysAt < 60 * 60 * 1000;
    // ไม่รู้จัก kid → โหลดกุญแจใหม่ (Clerk หมุนกุญแจ) แต่ไม่ถี่กว่า 1 ครั้ง/30 วินาที กันคนยิง kid มั่วให้ร้านถาม Clerk รัวๆ
    if (!fresh || (!keys.has(kid) && now() - keysAt > 30 * 1000)) {
      const body = await api('/jwks');
      keys = new Map((body.keys || []).filter((k) => k.kty === 'RSA').map((k) => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })]));
      keysAt = now();
    }
    return keys.get(kid) || null;
  }

  // ตรวจ session token จาก Clerk · ผ่าน → { userId, sessionId } · ไม่ผ่าน → โยน error
  async function verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts.some((x) => !/^[A-Za-z0-9_-]+$/.test(x))) throw new Error('token รูปแบบไม่ถูกต้อง');
    let header, claims;
    try { header = b64json(parts[0]); claims = b64json(parts[1]); } catch { throw new Error('token อ่านไม่ได้'); }
    if (header.alg !== 'RS256' || !header.kid) throw new Error('token ใช้อัลกอริทึมที่ไม่รับ');
    const key = await keyFor(String(header.kid));
    if (!key) throw new Error('ไม่รู้จักกุญแจของ token');
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new Error('ลายเซ็น token ไม่ถูกต้อง');
    const t = Math.floor(now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp + SKEW_SEC < t) throw new Error('token หมดอายุ');
    if (typeof claims.nbf === 'number' && claims.nbf - SKEW_SEC > t) throw new Error('token ยังไม่ถึงเวลาใช้');
    if (claims.iss !== issuer) throw new Error('token ไม่ได้มาจาก Clerk ของร้านนี้');
    // azp = เว็บที่ขอ token · ต้องเป็นเว็บร้านเท่านั้น (กันเอา token จากเว็บอื่นที่ใช้ Clerk เดียวกันมาใช้)
    if (claims.azp && claims.azp !== origin) throw new Error('token มาจากเว็บอื่น');
    if (!claims.sub || !/^user_[A-Za-z0-9]+$/.test(claims.sub)) throw new Error('token ไม่มีผู้ใช้');
    return { userId: claims.sub, sessionId: claims.sid || '' };
  }

  // อีเมลหลักที่ "ยืนยันแล้ว" ของผู้ใช้ใน Clerk (Google ยืนยันให้อัตโนมัติ) · ยังไม่ยืนยัน → null
  async function verifiedProfile(userId) {
    const u = await api(`/users/${encodeURIComponent(userId)}`);
    const list = Array.isArray(u.email_addresses) ? u.email_addresses : [];
    const primary = list.find((e) => e.id === u.primary_email_address_id) || null;
    if (!primary || !primary.verification || primary.verification.status !== 'verified') return null;
    const email = String(primary.email_address || '').trim().toLowerCase();
    if (!email) return null;
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim().slice(0, 80);
    return { email, name, clerkId: u.id };
  }

  return { verifyToken, verifiedProfile, issuer };
}

// ส่วนหัว CSP ของหน้าที่โหลดกล่องล็อกอิน Clerk (อนุญาตเฉพาะโดเมน Clerk ของร้าน + Cloudflare Turnstile กันบอต)
function clerkCsp(frontendApi) {
  const f = `https://${frontendApi}`;
  return [
    "default-src 'self'",
    `script-src 'self' ${f} https://challenges.cloudflare.com`,
    `connect-src 'self' ${f} https://clerk-telemetry.com`,
    `img-src 'self' data: https://img.clerk.com`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    'frame-src https://challenges.cloudflare.com',
    "object-src 'none'", "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'",
  ].join('; ');
}

module.exports = { createClerk, frontendApiFromKey, clerkCsp };

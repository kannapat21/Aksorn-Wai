'use strict';
/*
 * รหัสผ่านและเซสชัน
 *  - รหัสผ่านเก็บเป็น scrypt (มี salt สุ่มต่อผู้ใช้) รูปแบบ  scrypt$N$r$p$<salt>$<hash>
 *  - เซสชัน: คุกกี้เก็บ token สุ่ม 32 ไบต์ ฐานข้อมูลเก็บแค่ SHA-256 ของ token (ฐานข้อมูลหลุดก็เอาไปล็อกอินไม่ได้)
 */
const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function scrypt(password, salt, { N, r, p, keylen }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password).normalize('NFKC'), salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

// hash หลอกไว้ใช้ตอนไม่พบอีเมล เพื่อให้เวลาตอบเท่ากัน (เดาไม่ได้ว่าอีเมลไหนมีบัญชี)
let dummyHash = null;
async function verifyPassword(password, stored) {
  if (!stored) {
    dummyHash = dummyHash || await hashPassword(crypto.randomBytes(12).toString('hex'));
    stored = dummyHash;
    await verifyPassword(password, stored);
    return false;
  }
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(salt, 'base64url'), { N: Number(N), r: Number(r), p: Number(p), keylen: expected.length });
  return crypto.timingSafeEqual(key, expected);
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const tokenId = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = ''; }
  }
  return out;
}

function cookie(name, value, { maxAgeSec, secure, sameSite = 'Lax', httpOnly = true } = {}) {
  return [
    `${name}=${encodeURIComponent(value)}`, 'Path=/', `SameSite=${sameSite}`,
    httpOnly ? 'HttpOnly' : '', secure ? 'Secure' : '',
    maxAgeSec !== undefined ? `Max-Age=${maxAgeSec}` : '',
  ].filter(Boolean).join('; ');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

// รับเฉพาะ path ภายในเว็บ กัน open redirect (//evil.com, /\evil.com, http://...)
function safeNext(v, fallback = '/library') {
  const s = String(v || '');
  return /^\/(?![\/\\])[^\s]*$/.test(s) ? s : fallback;
}

module.exports = { hashPassword, verifyPassword, newToken, tokenId, parseCookies, cookie, safeEqual, safeNext };

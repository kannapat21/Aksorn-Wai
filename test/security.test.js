'use strict';
/*
 * ระบบป้องกันเว็บ
 *  - อยู่หลังพร็อกซีของ Render: IP ลูกค้าแต่ละคนแยกกัน (ตัวจำกัดไม่นับรวมทั้งเว็บ) · https → คุกกี้ Secure + HSTS
 *  - ฟอร์มจากเว็บอื่นยิง POST เข้ามาไม่ได้ (Sec-Fetch-Site / Origin) แม้จะมี CSRF token
 *  - ส่วนหัวความปลอดภัยครบทุกหน้า
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { proxyMode, clientIp } = require('../src/proxy');

const env = (extra = {}) => ({
  NODE_ENV: 'test', DATABASE_FILE: ':memory:', BASE_URL: 'https://shop.test',
  DOWNLOAD_LINK_SECRET: crypto.randomBytes(32).toString('hex'), PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex'),
  ADMIN_EMAIL: 'admin@shop.test', ADMIN_PASSWORD: 'test-admin-password-123', PAYMENT_PROVIDER: 'mock', MAIL_MODE: 'console',
  SUBTITLE_ENGINE: 'off', ...extra,
});

async function start(extra, opts = {}) {
  const logs = [];
  const ctx = createApp(loadConfig(env(extra)), { log: (x) => logs.push(String(x)), renderTools: { ok: true }, ...opts });
  const server = await new Promise((r) => { const s = ctx.app.listen(0, '127.0.0.1', () => r(s)); });
  return { ctx, server, logs, base: `http://127.0.0.1:${server.address().port}` };
}

let render, local;
before(async () => {
  render = await start({ RENDER: 'true', RATE_GLOBAL_PER_MIN: '5' });
  local = await start({ RATE_GLOBAL_PER_MIN: '0', BASE_URL: 'http://shop.test' });
});
after(() => { render.server.close(); local.server.close(); });

test('โหมดพร็อกซี: Render เปิดให้เอง · TRUST_PROXY ปิด/เลือกได้', () => {
  assert.equal(proxyMode({ RENDER: 'true' }), 'render');
  assert.equal(proxyMode({ RENDER: 'true', TRUST_PROXY: 'off' }), '');
  assert.equal(proxyMode({ TRUST_PROXY: 'cloudflare' }), 'cloudflare');
  assert.equal(proxyMode({}), '');
});

test('IP ลูกค้า: เชื่อ CF-Connecting-IP ก่อน X-Forwarded-For ที่ปลอมได้ · ค่าไม่ใช่ IP ไม่รับ', () => {
  assert.deepEqual(clientIp({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1, 10.0.0.1' }), { ip: '203.0.113.9', from: 'cf-connecting-ip' });
  assert.deepEqual(clientIp({ 'true-client-ip': '2001:db8::1' }), { ip: '2001:db8::1', from: 'true-client-ip' });
  assert.deepEqual(clientIp({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }), { ip: '198.51.100.7', from: 'x-forwarded-for' });
  assert.equal(clientIp({ 'cf-connecting-ip': '<script>' }), null);
  assert.equal(clientIp({}), null);
});

test('บน Render: ลูกค้าแต่ละ IP นับแยกกัน คนหนึ่งยิงถี่ไม่ทำให้คนอื่นใช้เว็บไม่ได้', async () => {
  const hit = (ip) => fetch(`${render.base}/license`, { headers: { 'cf-connecting-ip': ip, 'x-forwarded-proto': 'https' } });
  for (let i = 0; i < 5; i++) assert.equal((await hit('203.0.113.1')).status, 200);
  assert.equal((await hit('203.0.113.1')).status, 429);
  assert.equal((await hit('203.0.113.2')).status, 200, 'อีก IP ต้องยังเข้าได้');
  assert.ok(render.logs.some((l) => l.includes('cf-connecting-ip')), 'บอกใน log ว่าใช้ IP จาก header ไหน');
  assert.ok(!render.logs.some((l) => l.includes('203.0.113.')), 'ไม่พิมพ์ IP ลูกค้าลง log');
});

test('บน Render ผ่าน https: คุกกี้ติด Secure + HttpOnly และมี HSTS', async () => {
  const r = await fetch(`${render.base}/terms`, { headers: { 'cf-connecting-ip': '203.0.113.50', 'x-forwarded-proto': 'https' } });
  assert.equal(r.status, 200);
  const csrf = r.headers.getSetCookie().find((c) => c.startsWith('csrf='));
  assert.match(csrf, /; Secure/);
  assert.match(csrf, /SameSite=Strict/);
  assert.match(r.headers.get('strict-transport-security') || '', /max-age=31536000/);
});

test('ส่วนหัวความปลอดภัยครบ (CSP, กันฝังใน iframe, nosniff, ไม่บอกว่าใช้ Express)', async () => {
  const r = await fetch(`${local.base}/`);
  const h = (k) => r.headers.get(k) || '';
  assert.match(h('content-security-policy'), /default-src 'self'/);
  assert.match(h('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(h('content-security-policy'), /object-src 'none'/);
  assert.equal(h('x-frame-options'), 'DENY');
  assert.equal(h('x-content-type-options'), 'nosniff');
  assert.equal(h('referrer-policy'), 'same-origin');
  assert.equal(r.headers.get('x-powered-by'), null);
});

// ได้คุกกี้ csrf + token จริงก่อน เพื่อพิสูจน์ว่าถึงมี token ถูก ก็ยังโดนกันถ้ามาจากเว็บอื่น
async function csrfOf(base) {
  const r = await fetch(`${base}/login?classic=1`);
  const c = r.headers.getSetCookie().find((x) => x.startsWith('csrf=')).split(';')[0];
  return { cookie: c, token: decodeURIComponent(c.slice(5)) };
}

test('ฟอร์มจากเว็บอื่น (cross-site) ยิง POST ไม่ได้ แม้มี CSRF token ถูก', async () => {
  const { cookie, token } = await csrfOf(local.base);
  const post = (headers) => fetch(`${local.base}/logout`, {
    method: 'POST', redirect: 'manual', body: new URLSearchParams({ csrf: token }),
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...headers },
  });
  assert.equal((await post({ 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post({ origin: 'https://evil.example' })).status, 403);
  // จากหน้าเว็บร้านเอง ผ่านได้ตามปกติ
  assert.equal((await post({ 'sec-fetch-site': 'same-origin', origin: 'http://shop.test' })).status, 303);
  assert.equal((await post({})).status, 303, 'ไม่มี header (โปรแกรม/เบราว์เซอร์เก่า) ยังใช้ CSRF token ตามเดิม');
  // JSON ตอบเป็น JSON
  const j = await fetch(`${local.base}/subtitles/new`, { method: 'POST', headers: { cookie, 'x-csrf-token': token, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{}' });
  assert.equal(j.status, 403);
  assert.ok((await j.json()).error);
});

test('webhook จ่ายเงินไม่โดนกันเรื่องที่มา (ตรวจด้วยลายเซ็นแทน)', async () => {
  const r = await fetch(`${local.base}/webhooks/payment`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{}' });
  assert.notEqual(r.status, 403);
});

test('POST ไม่มี CSRF token ถูกปฏิเสธ · ลิงก์ next ไปเว็บอื่นไม่ได้ (open redirect)', async () => {
  const { cookie } = await csrfOf(local.base);
  const r = await fetch(`${local.base}/logout`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'csrf=wrong' });
  assert.equal(r.status, 403);
  const auth = require('../src/auth');
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)']) assert.equal(auth.safeNext(bad), '/library');
});

test('หลังบ้าน: ไม่ได้ล็อกอิน → ไปหน้าเข้าสู่ระบบ · ไม่มีหน้า error ที่เผยรายละเอียดระบบ', async () => {
  const r = await fetch(`${local.base}/admin`, { redirect: 'manual' });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location'), /^\/login/);
  const nf = await fetch(`${local.base}/../../etc/passwd`);
  assert.equal(nf.status, 404);
  assert.ok(!/root:|Error:|at .*\.js/.test(await nf.text()));
});

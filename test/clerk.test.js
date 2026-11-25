'use strict';
/*
 * เทสต์เข้าสู่ระบบด้วย Clerk (ปุ่ม Google)
 *   - Clerk จำลองในเครื่อง: กุญแจ RSA ของเราเอง + fetch ปลอม (ไม่ออกเน็ต)
 *   - token ถูกต้อง → จับคู่บัญชีเดิมด้วยอีเมล / สร้างบัญชีใหม่ / แอดมินยังเป็นแอดมิน
 *   - token ปลอม หมดอายุ มาจากเว็บอื่น หรืออีเมลยังไม่ยืนยัน → เข้าไม่ได้
 *   - ฟอร์มรหัสผ่านแบบเดิมยังใช้ได้ที่ /login?classic=1
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { frontendApiFromKey, clerkCsp } = require('../src/clerk');

const FAPI = 'test-shop-12.clerk.accounts.dev';
const PK = `pk_test_${Buffer.from(`${FAPI}$`).toString('base64')}`;
const SK = 'sk_test_abcDEF1234567890';
const BASE = 'https://shop.test';
const ADMIN = 'admin@aksornwai.local';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'ins_testkey1';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

// ผู้ใช้ใน Clerk จำลอง
const clerkUsers = new Map();
function addClerkUser(id, email, { verified = true, first = '', last = '' } = {}) {
  clerkUsers.set(id, {
    id, first_name: first, last_name: last, primary_email_address_id: `idn_${id}`,
    email_addresses: [{ id: `idn_${id}`, email_address: email, verification: { status: verified ? 'verified' : 'unverified' } }],
  });
}
const apiCalls = [];
async function fakeFetch(url, init) {
  apiCalls.push({ url, auth: init && init.headers && init.headers.Authorization });
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  if (init.headers.Authorization !== `Bearer ${SK}`) return json(401, {});
  if (url === 'https://api.clerk.com/v1/jwks') return json(200, { keys: [jwk] });
  const m = /^https:\/\/api\.clerk\.com\/v1\/users\/(.+)$/.exec(url);
  if (m && clerkUsers.has(decodeURIComponent(m[1]))) return json(200, clerkUsers.get(decodeURIComponent(m[1])));
  return json(404, {});
}

let clock = Date.now();
function sign(claims, { key = privateKey, kid = KID, alg = 'RS256' } = {}) {
  const t = Math.floor(clock / 1000);
  const h = Buffer.from(JSON.stringify({ alg, kid, typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iss: `https://${FAPI}`, azp: BASE, iat: t, nbf: t - 5, exp: t + 60, sid: 'sess_1', ...claims })).toString('base64url');
  const s = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url');
  return `${h}.${p}.${s}`;
}

let server, base, ctx, cfg;
const logs = [];
before(async () => {
  cfg = loadConfig({
    NODE_ENV: 'test',
    DATABASE_FILE: ':memory:',
    DOWNLOAD_LINK_SECRET: crypto.randomBytes(32).toString('hex'),
    PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex'),
    ADMIN_EMAIL: ADMIN,
    ADMIN_PASSWORD: 'test-admin-password-123',
    PAYMENT_PROVIDER: 'mock',
    MAIL_MODE: 'console',
    BASE_URL: BASE,
    RATE_GLOBAL_PER_MIN: '0',
    RATE_SIGNUP_PER_HOUR: '1000',
    CUSTOM_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'shop-custom-')),
    USER_FONT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'shop-fonts-')),
    CLERK_PUBLISHABLE_KEY: PK,
    CLERK_SECRET_KEY: SK,
  });
  ctx = createApp(cfg, { now: () => clock, log: (x) => logs.push(String(x)), clerkFetch: fakeFetch, renderTools: { ok: true, browser: { ok: true, how: 'เทสต์' }, ffmpeg: { ok: true, missing: [] } } });
  ctx.mailer.send = async () => {};
  await new Promise((r) => { server = ctx.app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

function client() {
  const jar = {};
  const c = {
    jar,
    async req(p, { method = 'GET', form, json, headers = {} } = {}) {
      const h = { ...headers };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.cookie = cookie;
      let body;
      if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form); }
      if (json) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
      const r = await fetch(base + p, { method, headers: h, body, redirect: 'manual' });
      for (const sc of r.headers.getSetCookie()) {
        const [kv, ...attrs] = sc.split(';');
        const i = kv.indexOf('=');
        const k = kv.slice(0, i).trim();
        const v = kv.slice(i + 1).trim();
        if (attrs.some((a) => /max-age=0/i.test(a)) || v === '') delete jar[k]; else jar[k] = v;
      }
      return r;
    },
    async csrf() { if (!jar.csrf) await c.req('/'); return decodeURIComponent(jar.csrf); },
    async clerk(token, next = '/library') { return c.req('/auth/clerk', { method: 'POST', json: { token, csrf: await c.csrf(), next } }); },
    async me() { const r = await c.req('/library'); return r.status === 200 ? await r.text() : null; },
  };
  return c;
}
const db = () => ctx.db;
const userRow = (email) => db().prepare('SELECT * FROM users WHERE email = ?').get(email);

test('อ่านโดเมน Clerk จาก publishable key และตั้ง CSP เฉพาะโดเมนนั้น', () => {
  assert.equal(frontendApiFromKey(PK), FAPI);
  assert.equal(frontendApiFromKey('pk_test_!!!'), '');
  assert.equal(frontendApiFromKey('sk_test_xx'), '');
  assert.equal(cfg.clerk.enabled, true);
  const csp = clerkCsp(FAPI);
  assert.match(csp, new RegExp(`script-src 'self' https://${FAPI.replace(/\./g, '\\.')} https://challenges\\.cloudflare\\.com`));
  assert.ok(!/unsafe-eval/.test(csp));
});

test('ตั้งค่าผิด: มีแค่คีย์เดียว / คีย์ผิดรูป / test คู่ live → ร้านไม่ยอมเปิด', () => {
  const env = (extra) => ({ NODE_ENV: 'test', DATABASE_FILE: ':memory:', DOWNLOAD_LINK_SECRET: 'x'.repeat(64), PAYMENT_WEBHOOK_SECRET: 'y'.repeat(64), PAYMENT_PROVIDER: 'mock', ...extra });
  assert.throws(() => loadConfig(env({ CLERK_PUBLISHABLE_KEY: PK })), /CLERK_SECRET_KEY/);
  assert.throws(() => loadConfig(env({ CLERK_SECRET_KEY: SK })), /CLERK_PUBLISHABLE_KEY/);
  assert.throws(() => loadConfig(env({ CLERK_PUBLISHABLE_KEY: 'pk_test_###', CLERK_SECRET_KEY: SK })), /CLERK_PUBLISHABLE_KEY ไม่ถูกต้อง/);
  assert.throws(() => loadConfig(env({ CLERK_PUBLISHABLE_KEY: PK, CLERK_SECRET_KEY: 'sk_live_abc123' })), /โหมดเดียวกัน/);
  assert.equal(loadConfig(env({})).clerk.enabled, false);
});

test('หน้า /login และ /signup ใช้กล่อง Clerk + CSP ที่อนุญาตโดเมน Clerk · ฟอร์มเดิมยังอยู่ที่ ?classic=1', async () => {
  const c = client();
  const r = await c.req('/login?next=/library');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /data-clerk-auth/);
  assert.match(html, new RegExp(`src="https://${FAPI.replace(/\./g, '\\.')}/npm/@clerk/clerk-js@5/dist/clerk\\.browser\\.js"`));
  assert.match(html, /data-clerk-publishable-key="pk_test_/);
  assert.ok(!html.includes(SK), 'ห้ามส่ง secret key ไปหน้าเว็บ');
  assert.match(r.headers.get('content-security-policy'), new RegExp(FAPI.replace(/\./g, '\\.')));
  assert.match(html, /\/login\?classic=1/);

  const s = await c.req('/signup');
  assert.match(await s.text(), /data-mode="signup"/);

  const old = await c.req('/login?classic=1');
  const oldHtml = await old.text();
  assert.match(oldHtml, /action="\/login"/);
  assert.match(oldHtml, /name="password"/);
  assert.match(oldHtml, /กลับไปใช้ปุ่ม Google/);
  assert.ok(!/clerk\.accounts\.dev/.test(old.headers.get('content-security-policy')), 'หน้าเดิมไม่ต้องเปิด CSP ให้ Clerk');

  // หน้าอื่นไม่โหลด Clerk
  const home = await c.req('/');
  assert.ok(!/clerk\.accounts\.dev/.test(home.headers.get('content-security-policy')));
});

test('Google ครั้งแรก → สร้างบัญชีใหม่ (ยืนยันอีเมลแล้ว ไม่มีรหัสผ่านของร้าน) แล้วเข้าคลังได้', async () => {
  addClerkUser('user_new1', 'New.Person@Gmail.com', { first: 'สมชาย', last: 'ใจดี' });
  const c = client();
  const r = await c.clerk(sign({ sub: 'user_new1' }), '/library?x=1');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, next: '/library?x=1' });
  assert.ok(c.jar.sid);
  const u = userRow('new.person@gmail.com');
  assert.equal(u.name, 'สมชาย ใจดี');
  assert.ok(u.email_verified_at);
  assert.equal(u.role, 'customer');
  assert.equal(u.password_hash, 'clerk$');
  assert.ok(await c.me());
  // ล็อกอินซ้ำได้บัญชีเดิม ไม่สร้างซ้ำ
  const c2 = client();
  assert.equal((await c2.clerk(sign({ sub: 'user_new1' }))).status, 200);
  assert.equal(db().prepare('SELECT COUNT(*) n FROM users WHERE email = ?').get('new.person@gmail.com').n, 1);
  // บัญชีที่ไม่มีรหัสผ่าน เข้าทางฟอร์มรหัสผ่านไม่ได้
  const c3 = client();
  const bad = await c3.req('/login', { method: 'POST', form: { csrf: await c3.csrf(), email: 'new.person@gmail.com', password: 'clerk$', next: '/library' } });
  assert.equal(bad.status, 401);
});

test('บัญชีเดิม (ยืนยันอีเมลแล้ว) → ได้บัญชีเดิมพร้อมออเดอร์เดิม และรหัสผ่านเดิมยังใช้ได้', async () => {
  const c = client();
  const s = await c.req('/signup', { method: 'POST', form: { csrf: await c.csrf(), email: 'old@buyer.co', password: 'oldpassword1', password2: 'oldpassword1', next: '/library' } });
  assert.equal(s.status, 303);
  const before = userRow('old@buyer.co');
  db().prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(clock, before.id);
  addClerkUser('user_old1', 'OLD@buyer.co');
  const g = client();
  assert.equal((await g.clerk(sign({ sub: 'user_old1' }))).status, 200);
  const sess = db().prepare('SELECT user_id FROM sessions ORDER BY created_at DESC, rowid DESC LIMIT 1').get();
  assert.equal(sess.user_id, before.id);
  assert.equal(userRow('old@buyer.co').password_hash, before.password_hash);
  const p = client();
  const ok = await p.req('/login', { method: 'POST', form: { csrf: await p.csrf(), email: 'old@buyer.co', password: 'oldpassword1', next: '/library' } });
  assert.equal(ok.status, 303);
});

test('บัญชีที่ยังไม่ยืนยันอีเมล: เจ้าของอีเมลตัวจริงมาทาง Google → ลบรหัสที่คนอื่นตั้งดักไว้ และเตะเซสชันเก่าออก', async () => {
  const squatter = client();
  await squatter.req('/signup', { method: 'POST', form: { csrf: await squatter.csrf(), email: 'victim@gmail.com', password: 'squatpass1', password2: 'squatpass1', next: '/library' } });
  assert.ok(await squatter.me());
  const id = userRow('victim@gmail.com').id;
  addClerkUser('user_victim', 'victim@gmail.com');
  const owner = client();
  assert.equal((await owner.clerk(sign({ sub: 'user_victim' }))).status, 200);
  const u = userRow('victim@gmail.com');
  assert.equal(u.id, id);
  assert.equal(u.password_hash, 'clerk$');
  assert.ok(u.email_verified_at);
  assert.equal(await squatter.me(), null, 'เซสชันของคนที่สมัครดักไว้ต้องหลุด');
  assert.ok(await owner.me());
  const again = client();
  const r = await again.req('/login', { method: 'POST', form: { csrf: await again.csrf(), email: 'victim@gmail.com', password: 'squatpass1', next: '/library' } });
  assert.equal(r.status, 401);
});

test('อีเมลแอดมิน (ADMIN_EMAIL) ล็อกอินด้วย Google → ยังเป็นแอดมิน เปิดหลังบ้านได้', async () => {
  addClerkUser('user_admin', 'Admin@AksornWai.local');
  const c = client();
  assert.equal((await c.clerk(sign({ sub: 'user_admin' }))).status, 200);
  assert.equal(userRow(ADMIN).role, 'admin');
  const r = await c.req('/admin');
  assert.equal(r.status, 200);
  // รหัสผ่านแอดมินจาก .env ยังใช้ได้ (ทางสำรอง)
  const p = client();
  const ok = await p.req('/login', { method: 'POST', form: { csrf: await p.csrf(), email: ADMIN, password: 'test-admin-password-123', next: '/admin' } });
  assert.equal(ok.status, 303);
});

test('token ใช้ไม่ได้ → 401 และไม่เปิดเซสชัน (ปลอม/หมดอายุ/ผิดผู้ออก/มาจากเว็บอื่น/อัลกอริทึมอื่น)', async () => {
  addClerkUser('user_x', 'x@x.co');
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const bads = [
    'not-a-jwt',
    sign({ sub: 'user_x' }, { key: other }),
    sign({ sub: 'user_x', exp: Math.floor(clock / 1000) - 120 }),
    sign({ sub: 'user_x', iss: 'https://evil.clerk.accounts.dev' }),
    sign({ sub: 'user_x', azp: 'https://evil.example' }),
    sign({ sub: 'user_x' }, { alg: 'HS256' }),
    sign({ sub: 'user_x' }, { kid: 'ins_unknown' }),
    sign({ sub: 'not_a_user' }),
  ];
  for (const t of bads) {
    const c = client();
    const r = await c.clerk(t);
    assert.equal(r.status, 401, t.slice(0, 40));
    assert.equal(c.jar.sid, undefined);
  }
  assert.equal(userRow('x@x.co'), undefined);
});

test('ไม่มี csrf → 403 · อีเมลยังไม่ยืนยันใน Clerk → 403 · Clerk ล่ม → 502', async () => {
  addClerkUser('user_unv', 'unverified@x.co', { verified: false });
  const c = client();
  await c.csrf();
  const noCsrf = await c.req('/auth/clerk', { method: 'POST', json: { token: sign({ sub: 'user_unv' }) } });
  assert.equal(noCsrf.status, 403);
  const unv = await c.clerk(sign({ sub: 'user_unv' }));
  assert.equal(unv.status, 403);
  assert.equal(userRow('unverified@x.co'), undefined);
  const gone = await c.clerk(sign({ sub: 'user_missing' }));
  assert.equal(gone.status, 502);
});

test('next ไปเว็บอื่นไม่ได้ (กัน open redirect)', async () => {
  addClerkUser('user_nx', 'nx@x.co');
  const c = client();
  const r = await c.clerk(sign({ sub: 'user_nx' }), '//evil.com');
  assert.equal((await r.json()).next, '/library');
});

test('ออกจากระบบ → ไปหน้าออกจาก Clerk ด้วย (กันเข้าให้อัตโนมัติ) และเซสชันร้านหมด', async () => {
  addClerkUser('user_out', 'out@x.co');
  const c = client();
  await c.clerk(sign({ sub: 'user_out' }));
  assert.ok(await c.me());
  const r = await c.req('/logout', { method: 'POST', form: { csrf: await c.csrf() } });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/auth/clerk/signed-out');
  const page = await c.req('/auth/clerk/signed-out');
  assert.match(await page.text(), /data-clerk-signout/);
  assert.equal(await c.me(), null);
});

test('กุญแจของ Clerk ถูกเก็บไว้ ไม่ถาม Clerk ทุกครั้ง', async () => {
  addClerkUser('user_cache', 'cache@x.co');
  const before = apiCalls.filter((x) => x.url.endsWith('/jwks')).length;
  for (let i = 0; i < 3; i++) await client().clerk(sign({ sub: 'user_cache' }));
  assert.equal(apiCalls.filter((x) => x.url.endsWith('/jwks')).length, before);
  assert.ok(apiCalls.every((x) => x.auth === `Bearer ${SK}`));
});

'use strict';
/*
 * เทสต์เข้าสู่ระบบด้วย Clerk (ปุ่ม Google)
 *   - Clerk จำลองในเครื่อง: กุญแจ RSA ของเราเอง + fetch ปลอม (ไม่ออกเน็ต)
 *   - token ถูกต้อง → จับคู่บัญชีเดิมด้วยอีเมล / สร้างบัญชีใหม่ / แอดมินยังเป็นแอดมิน
 *   - token ปลอม หมดอายุ มาจากเว็บอื่น หรืออีเมลยังไม่ยืนยัน → เข้าไม่ได้
 *   - ใช้ Clerk อย่างเดียว: ทางรหัสผ่านเดิม (ล็อกอิน/สมัคร/ลืมรหัส) ปิดหมด
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

test('หน้า /login และ /signup ใช้กล่อง Clerk + CSP ที่อนุญาตโดเมน Clerk · ไม่มีฟอร์มรหัสผ่านแล้ว', async () => {
  const c = client();
  const r = await c.req('/login?next=/library');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /data-clerk-auth/);
  assert.match(html, new RegExp(`src="https://${FAPI.replace(/\./g, '\\.')}/npm/@clerk/clerk-js@5/dist/clerk\\.browser\\.js"`));
  assert.match(html, /data-clerk-publishable-key="pk_test_/);
  assert.ok(!html.includes(SK), 'ห้ามส่ง secret key ไปหน้าเว็บ');
  assert.match(r.headers.get('content-security-policy'), new RegExp(FAPI.replace(/\./g, '\\.')));
  assert.ok(!/name="password"|classic=1|ลืมรหัสผ่าน/.test(html), 'ไม่มีฟอร์ม/ลิงก์รหัสผ่านแล้ว');
  assert.match(html, /class="ca-tabs"[^>]*>[\s\S]*aria-current="page">เข้าสู่ระบบ/);

  const s = await c.req('/signup');
  const sh = await s.text();
  assert.match(sh, /data-mode="signup"/);
  assert.match(sh, /aria-current="page">สมัครสมาชิก/);

  // ?classic=1 ไม่เปิดฟอร์มเดิมแล้ว
  const old = await c.req('/login?classic=1');
  assert.ok(!/name="password"/.test(await old.text()));

  // หน้าอื่นไม่โหลด Clerk · หน้าแรกบอกว่าใช้ปุ่ม Google
  const home = await c.req('/');
  assert.ok(!/clerk\.accounts\.dev/.test(home.headers.get('content-security-policy')));
  assert.match(await home.text(), /กดปุ่ม Google ปุ่มเดียว/);
});

test('ทางรหัสผ่านเดิมปิดหมด: POST /login /signup, ลืมรหัส, ตั้งรหัสใหม่, ยืนยันอีเมล → พาไปหน้า Clerk และไม่เปิดเซสชัน', async () => {
  const c = client();
  const csrf = await c.csrf();
  const cases = [
    ['POST', '/login', { csrf, email: ADMIN, password: 'test-admin-password-123' }, '/login'],
    ['POST', '/signup', { csrf, email: 'n@x.co', password: 'password123', password2: 'password123' }, '/signup'],
    ['GET', '/forgot', null, '/login'],
    ['POST', '/forgot', { csrf, email: ADMIN }, '/login'],
    ['GET', '/reset?t=abc', null, '/login'],
    ['POST', '/reset', { csrf, t: 'abc', password: 'x'.repeat(10), password2: 'x'.repeat(10) }, '/login'],
    ['GET', '/verify-email?t=abc', null, '/login'],
  ];
  for (const [method, p, form, to] of cases) {
    const r = await c.req(p, { method, form: form || undefined });
    assert.equal(r.status, 303, `${method} ${p}`);
    assert.equal(r.headers.get('location'), to, `${method} ${p}`);
  }
  assert.equal(c.jar.sid, undefined);
  assert.equal(userRow('n@x.co'), undefined);
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
});

// บัญชีที่สมัครด้วยรหัสผ่านไว้ก่อนเปลี่ยนมาใช้ Clerk (ใส่ตรงลงฐานข้อมูล เพราะฟอร์มเดิมปิดแล้ว)
function legacyUser(email, { verified }) {
  const id = crypto.randomBytes(16).toString('hex');
  db().prepare('INSERT INTO users (id, email, name, password_hash, created_at, email_verified_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, email, '', 'scrypt$16384$8$1$c2FsdA$aGFzaA', clock, verified ? clock : null);
  return id;
}
function legacySession(c, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db().prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(crypto.createHash('sha256').update(token).digest('hex'), userId, clock, clock + 30 * 86400000);
  c.jar.sid = token;
}

test('บัญชีเดิม (ยืนยันอีเมลแล้ว) → Google ด้วยอีเมลเดิมได้บัญชีเดิม (ออเดอร์/คลังเดิม)', async () => {
  const id = legacyUser('old@buyer.co', { verified: true });
  addClerkUser('user_old1', 'OLD@buyer.co');
  const g = client();
  assert.equal((await g.clerk(sign({ sub: 'user_old1' }))).status, 200);
  const sess = db().prepare('SELECT user_id FROM sessions ORDER BY created_at DESC, rowid DESC LIMIT 1').get();
  assert.equal(sess.user_id, id);
  assert.equal(db().prepare('SELECT COUNT(*) n FROM users WHERE email = ?').get('old@buyer.co').n, 1);
});

test('บัญชีที่ยังไม่ยืนยันอีเมล: เจ้าของอีเมลตัวจริงมาทาง Google → ลบรหัสที่คนอื่นตั้งดักไว้ และเตะเซสชันเก่าออก', async () => {
  const id = legacyUser('victim@gmail.com', { verified: false });
  const squatter = client();
  legacySession(squatter, id);
  assert.ok(await squatter.me());
  addClerkUser('user_victim', 'victim@gmail.com');
  const owner = client();
  assert.equal((await owner.clerk(sign({ sub: 'user_victim' }))).status, 200);
  const u = userRow('victim@gmail.com');
  assert.equal(u.id, id);
  assert.equal(u.password_hash, 'clerk$');
  assert.ok(u.email_verified_at);
  assert.equal(await squatter.me(), null, 'เซสชันของคนที่สมัครดักไว้ต้องหลุด');
  assert.ok(await owner.me());
});

test('อีเมลแอดมิน (ADMIN_EMAIL) ล็อกอินด้วย Google → ยังเป็นแอดมิน เปิดหลังบ้านได้ · ลูกค้าทั่วไปเปิดไม่ได้', async () => {
  addClerkUser('user_admin', 'Admin@AksornWai.local');
  const c = client();
  assert.equal((await c.clerk(sign({ sub: 'user_admin' }))).status, 200);
  assert.equal(userRow(ADMIN).role, 'admin');
  assert.equal((await c.req('/admin')).status, 200);
  addClerkUser('user_cust', 'cust@x.co');
  const k = client();
  await k.clerk(sign({ sub: 'user_cust' }));
  assert.equal((await k.req('/admin')).status, 404);
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

test('ขายจริง (production) ต้องตั้ง Clerk · ใช้ Clerk แล้วไม่ต้องมี ADMIN_PASSWORD', () => {
  const prod = (extra) => ({
    NODE_ENV: 'production', DATABASE_FILE: ':memory:', BASE_URL: 'https://shop.example.com', ADMIN_EMAIL: 'a@b.co', MAIL_MODE: 'off',
    DOWNLOAD_LINK_SECRET: 'x'.repeat(64), PAYMENT_WEBHOOK_SECRET: 'y'.repeat(64),
    PAYMENT_PROVIDER: 'manual', PROMPTPAY_ID: '0812345678', PROMPTPAY_NAME: 'ร้าน', LEGAL_NAME: 'ร้าน', CONTACT_EMAIL: 'c@d.co', ...extra,
  });
  assert.throws(() => loadConfig(prod({ ADMIN_PASSWORD: 'z'.repeat(14) })), /CLERK_PUBLISHABLE_KEY/);
  const live = `pk_live_${Buffer.from('clerk.shop.example.com$').toString('base64')}`;
  const ok = loadConfig(prod({ CLERK_PUBLISHABLE_KEY: live, CLERK_SECRET_KEY: 'sk_live_abc123' }));
  assert.equal(ok.clerk.enabled, true);
});

'use strict';
/*
 * เทสต์อัตโนมัติ
 *   สมัคร/เข้าสู่ระบบ → ซื้อ (ผูกกับบัญชี) → webhook → อยู่ในคลัง → โหลดไฟล์ตามโปรแกรมผ่านลิงก์ที่เซ็นแล้ว
 *   คนอื่นเข้าคลัง/โหลดไฟล์ของเราไม่ได้ · ลิงก์ถูกแก้/หมดอายุใช้ไม่ได้ · จำกัดต่อวัน · webhook ซ้ำไม่สร้างซ้ำ
 * รัน: npm test
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
const mock = require('../src/payments/mock');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
let clock = Date.now();
let server, base, ctx, cfg;
const custom = require('../src/customizer');

// เทสต์ไม่ได้เรนเดอร์จริง (ไม่ต้องมี ffmpeg): ตัวเรนเดอร์จำลองเขียนไฟล์เล็กๆ ตามฟอร์แมตของโปรแกรมที่เลือก
const renderTools = { ok: true, browser: { ok: true, how: 'เทสต์' }, ffmpeg: { ok: true, missing: [] } };
let gate = null; // ถ้าตั้งไว้ งานเรนเดอร์จะรอจนกว่าจะเปิด
const rendered = [];
let fakeBytes = 20; // ขนาดไฟล์จำลอง (ใช้ทดสอบโควตาพื้นที่)
// ทำเหมือนตัวเรนเดอร์จริง: ได้ไฟล์เดียวตามโปรแกรม (single หรือ alt) แนว และความยาวที่เลือก
async function fakeRenderer(job, { outDir, onProgress, font }) {
  rendered.push({ ...job, fontInfo: font });
  onProgress(10, 'กำลังวาดตัวอักษร');
  if (gate) await gate.promise;
  fs.mkdirSync(outDir, { recursive: true });
  const ed = cfg.editorsConfig.editors[job.editor];
  const codec = job.filetype === 'alt' ? ed.alt : ed.single;
  const ext = codec === 'prores4444' ? 'mov' : 'mp4';
  const file = `${job.id}.${ext}`;
  const body = fakeBytes > 100 ? crypto.randomBytes(fakeBytes) : `${job.text}|${codec}|${job.size}|${job.seconds}`;
  fs.writeFileSync(path.join(outDir, file), body);
  onProgress(90, 'กำลังเข้ารหัสวิดีโอ');
  return [{ format: 'single', codec, size: job.size, seconds: job.seconds, file, bytes: Buffer.byteLength(body), mime: ext === 'mov' ? 'video/quicktime' : 'video/mp4' }];
}
function openGate() { const g = {}; g.promise = new Promise((r) => { g.open = r; }); gate = g; return g; }

before(async () => {
  cfg = loadConfig({
    NODE_ENV: 'test',
    DATABASE_FILE: ':memory:',
    DOWNLOAD_LINK_SECRET: crypto.randomBytes(32).toString('hex'),
    PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex'),
    ADMIN_PASSWORD: 'test-admin-password-123',
    PAYMENT_PROVIDER: 'mock',
    MAIL_MODE: 'console',
    BASE_URL: 'http://shop.test',
    DOWNLOAD_LINK_MINUTES: '10',
    DOWNLOAD_DAILY_LIMIT: '60',
    CUSTOM_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'shop-custom-')),
    CUSTOM_STORAGE_MB: '1',
    USER_FONT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'shop-fonts-')),
  });
  ctx = createApp(cfg, { now: () => clock, log: () => {}, renderer: fakeRenderer, renderTools });
  ctx.mailer.send = async (m) => { ctx.mailer.sent.push(m); }; // เก็บอีเมลไว้ตรวจ ไม่พิมพ์ลงจอ
  await new Promise((r) => { server = ctx.app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  ctx.app.locals.internalUrl = base;
});

after(() => server && server.close());

// ---------- ผู้ใช้จำลอง (เก็บคุกกี้เหมือนเบราว์เซอร์) ----------
function client() {
  const jar = {};
  const c = {
    jar,
    async req(p, { method = 'GET', form, headers = {} } = {}) {
      const h = { ...headers };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.cookie = cookie;
      let body;
      if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form); }
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
    async csrf() { if (!jar.csrf) await c.req('/login'); return decodeURIComponent(jar.csrf); },
    async post(p, form = {}) { return c.req(p, { method: 'POST', form: { csrf: await c.csrf(), ...form } }); },
    async signup(email, password = 'correct-horse-9', name = '') { return c.post('/signup', { email, password, name, next: '/library' }); },
    async login(email, password = 'correct-horse-9') { return c.post('/login', { email, password, next: '/library' }); },
  };
  return c;
}

async function newUser(email) {
  const c = client();
  const r = await c.signup(email);
  assert.equal(r.status, 303, `สมัคร ${email}`);
  return c;
}

function order(id) { return ctx.db.prepare('SELECT * FROM orders WHERE id = ?').get(id); }
function count(sql, ...a) { return ctx.db.prepare(sql).get(...a).n; }
const user = (email) => ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(email);

async function sendWebhook(eventObj, { secret = cfg.webhookSecret, t } = {}) {
  const body = JSON.stringify(eventObj);
  return fetch(`${base}/webhooks/payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mock-signature': mock.signPayload(secret, body, t) },
    body,
  });
}

async function checkout(c, product = 'order-now') {
  const r = await c.post('/checkout', { product });
  assert.equal(r.status, 303);
  const loc = r.headers.get('location');
  return { location: loc, orderId: loc.split('/').pop() };
}

async function buy(c) {
  const { orderId } = await checkout(c);
  const r = await sendWebhook(mock.buildEvent(order(orderId)));
  assert.equal((await r.json()).result, 'paid');
  return orderId;
}

const manifest = () => cfg.products[0].manifest;
const fileOf = (format, size = 'vertical', part) => manifest().files.find((f) => f.format === format && f.size === size && (!part || f.part === part)).file;
const getUrl = (orderId, file, editor) => `/library/${orderId}/get/${encodeURIComponent(file)}${editor ? `?editor=${editor}` : ''}`;

// ---------- บัญชี ----------

test('สมัครสมาชิก: เก็บรหัสผ่านเป็น scrypt, เข้าสู่ระบบให้เลย, ตรวจอีเมล/รหัสผ่าน/ซ้ำ/CSRF', async () => {
  const c = client();
  const r = await c.signup('New@Example.com', 'correct-horse-9', 'ทดสอบ');
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/library');
  const u = user('new@example.com');
  assert.ok(u, 'อีเมลเก็บเป็นตัวเล็ก');
  assert.match(u.password_hash, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!u.password_hash.includes('correct-horse-9'));
  assert.ok(c.jar.sid, 'ได้คุกกี้เซสชัน');
  // ฐานข้อมูลเก็บแค่ hash ของ token
  assert.equal(count('SELECT COUNT(*) n FROM sessions WHERE id = ?', c.jar.sid), 0);
  assert.equal((await c.req('/library')).status, 200);

  const d = client();
  assert.equal((await d.signup('new@example.com')).status, 400); // อีเมลซ้ำ
  assert.equal((await d.signup('bad-email')).status, 400);
  assert.equal((await d.signup('short@example.com', '1234567')).status, 400); // สั้นเกิน
  // ไม่มี / ผิด CSRF
  const noCsrf = await fetch(`${base}/signup`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ email: 'x@example.com', password: 'abcdefgh1' }) });
  assert.equal(noCsrf.status, 403);
  assert.equal((await d.req('/signup', { method: 'POST', form: { csrf: 'x'.repeat(43), email: 'y@example.com', password: 'abcdefgh1' } })).status, 403);
  assert.equal(user('x@example.com'), undefined);
});

test('เข้าสู่ระบบ/ออกจากระบบ และจำกัดการลองรหัสผ่าน', async () => {
  await newUser('login@example.com');
  const c = client();
  const bad = await c.login('login@example.com', 'wrong-password');
  assert.equal(bad.status, 401);
  assert.match(await bad.text(), /อีเมลหรือรหัสผ่านไม่ถูกต้อง/);
  assert.equal((await c.login('nobody@example.com')).status, 401); // ข้อความเดียวกัน
  const ok = await c.login('LOGIN@example.com');
  assert.equal(ok.status, 303);
  assert.equal((await c.req('/library')).status, 200);

  // ออกจากระบบต้องมี CSRF และลบเซสชันจริง
  const sid = c.jar.sid;
  assert.equal((await c.req('/logout', { method: 'POST', form: {} })).status, 403);
  assert.equal((await c.post('/logout')).status, 303);
  assert.equal((await c.req('/library')).status, 303);
  const replay = await fetch(`${base}/library`, { redirect: 'manual', headers: { cookie: `sid=${sid}` } });
  assert.equal(replay.status, 303, 'คุกกี้เก่าใช้ไม่ได้แล้ว');

  // ผิด 5 ครั้งติดกัน → ล็อก 15 นาที แม้รหัสถูก
  await newUser('brute@example.com');
  const b = client();
  for (let i = 0; i < 5; i++) assert.equal((await b.login('brute@example.com', `nope-${i}`)).status, 401);
  assert.equal((await b.login('brute@example.com')).status, 429);
  const saved = clock;
  try {
    clock = saved + 16 * MIN;
    assert.equal((await b.login('brute@example.com')).status, 303);
  } finally { clock = saved; }
});

test('next หลังเข้าสู่ระบบ รับเฉพาะ path ในเว็บ (กัน open redirect)', async () => {
  await newUser('next@example.com');
  for (const [next, expected] of [['/p/order-now', '/p/order-now'], ['//evil.com', '/library'], ['https://evil.com', '/library'], ['/\\evil.com', '/library']]) {
    const c = client();
    const r = await c.post('/login', { email: 'next@example.com', password: 'correct-horse-9', next });
    assert.equal(r.headers.get('location'), expected, next);
  }
});

// ---------- ซื้อ ----------

test('ซื้อต้องเข้าสู่ระบบ: ไม่ล็อกอิน → พาไปหน้าเข้าสู่ระบบ ไม่สร้างคำสั่งซื้อ', async () => {
  const anon = client();
  const n = count('SELECT COUNT(*) n FROM orders');
  const r = await anon.post('/checkout', { product: 'order-now' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/login?next=%2Fp%2Forder-now');
  assert.equal(count('SELECT COUNT(*) n FROM orders'), n);
  const page = await (await anon.req('/p/order-now')).text();
  assert.match(page, /เข้าสู่ระบบเพื่อซื้อ/);
});

test('ซื้อ: คำสั่งซื้อผูกกับบัญชี ใช้อีเมลบัญชี ราคาจากเซิร์ฟเวอร์ และต้องมี CSRF', async () => {
  const c = await newUser('buyer@example.com');
  const noCsrf = await c.req('/checkout', { method: 'POST', form: { product: 'order-now' } });
  assert.equal(noCsrf.status, 403);
  const { orderId, location } = await checkout(c);
  assert.match(location, /^\/pay\/mock\//);
  const o = order(orderId);
  assert.equal(o.status, 'pending');
  assert.equal(o.user_id, user('buyer@example.com').id);
  assert.equal(o.email, 'buyer@example.com');
  assert.equal(o.amount, cfg.products[0].price);
  // ยังไม่จ่าย → ไม่อยู่ในคลัง
  assert.doesNotMatch(await (await c.req('/library')).text(), new RegExp(`/library/${orderId}`));
  assert.equal((await c.req(`/library/${orderId}`)).status, 404);
  assert.equal((await c.req(getUrl(orderId, fileOf('mp4_green')))).status, 404);
});

test('จ่ายเงิน (ปุ่มจำลอง) → อยู่ในคลัง + อีเมลยืนยันไม่มีลิงก์ดาวน์โหลด', async () => {
  const c = await newUser('sim@example.com');
  const { orderId } = await checkout(c);
  assert.equal((await c.req(`/pay/mock/${orderId}/simulate`, { method: 'POST', form: {} })).status, 403); // ไม่มี CSRF
  const r = await c.post(`/pay/mock/${orderId}/simulate`);
  assert.equal(r.status, 303);
  assert.equal(order(orderId).status, 'paid');
  const done = await (await c.req(`/order/${orderId}`)).text();
  assert.match(done, new RegExp(`/library/${orderId}`));
  await new Promise((res) => setTimeout(res, 20));
  const mail = ctx.mailer.sent.filter((m) => m.to === 'sim@example.com').at(-1);
  assert.ok(mail);
  assert.match(mail.text, /http:\/\/shop\.test\/library\//);
  assert.doesNotMatch(mail.text, /\/d\//);
  const lib = await (await c.req('/library')).text();
  assert.match(lib, new RegExp(`/library/${orderId}`));
  // ซื้อซ้ำ → พาไปคลัง ไม่สร้างคำสั่งซื้อใหม่
  const n = count('SELECT COUNT(*) n FROM orders');
  const again = await c.post('/checkout', { product: 'order-now' });
  assert.equal(again.headers.get('location'), `/library/${orderId}`);
  assert.equal(count('SELECT COUNT(*) n FROM orders'), n);
  assert.match(await (await c.req('/p/order-now')).text(), /อยู่ในคลังแล้ว|มีแอนิเมชันนี้ในคลังแล้ว/);
});

// ---------- webhook ----------

test('webhook: ลายเซ็นผิด / ไม่มีลายเซ็น / ลายเซ็นเก่า ถูกปฏิเสธ และไม่เปลี่ยนสถานะ', async () => {
  const c = await newUser('wh@example.com');
  const { orderId } = await checkout(c);
  const ev = mock.buildEvent(order(orderId));
  assert.equal((await sendWebhook(ev, { secret: 'x'.repeat(64) })).status, 400);
  assert.equal((await sendWebhook(ev, { t: Math.floor(Date.now() / 1000) - 3600 })).status, 400);
  const r = await fetch(`${base}/webhooks/payment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ev) });
  assert.equal(r.status, 400);
  assert.equal(order(orderId).status, 'pending');
});

test('webhook: ยอดเงินไม่ตรงกับคำสั่งซื้อ → ไม่ถือว่าจ่ายแล้ว', async () => {
  const c = await newUser('amt@example.com');
  const { orderId } = await checkout(c);
  const ev = mock.buildEvent(order(orderId));
  ev.data.amount = 100;
  assert.equal((await (await sendWebhook(ev)).json()).result, 'amount_mismatch');
  assert.equal(order(orderId).status, 'pending');
});

test('webhook ซ้ำ (event เดิม และ event ใหม่ของคำสั่งซื้อเดิม) ไม่ทำซ้ำ ไม่ส่งอีเมลซ้ำ', async () => {
  const c = await newUser('dup@example.com');
  const { orderId } = await checkout(c);
  const ev = mock.buildEvent(order(orderId), { eventId: 'evt_dup_test_1' });
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => sendWebhook(ev).then((r) => r.json())));
  assert.equal(results.filter((r) => r.result === 'paid').length, 1);
  assert.equal(results.filter((r) => r.result === 'duplicate').length, 4);
  assert.equal((await (await sendWebhook(mock.buildEvent(order(orderId), { eventId: 'evt_dup_test_2' }))).json()).result, 'already_paid');
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(ctx.mailer.sent.filter((m) => m.to === 'dup@example.com').length, 1);
});

// ---------- คลัง ----------

test('คลัง: ปุ่มไฟล์ตามโปรแกรมที่เลือก (CapCut = MP4 พื้นเขียว, Premiere = ProRes โปร่งใส) และจำโปรแกรมไว้', async () => {
  const c = await newUser('lib@example.com');
  const orderId = await buy(c);

  const cap = await (await c.req(`/library/${orderId}?editor=capcut_mobile`)).text();
  assert.match(cap, /MP4 พื้นเขียว · 1\d\d KB/);
  assert.doesNotMatch(cap, /ProRes ·/);
  assert.match(cap, /ใช้ได้ตลอด/);
  const pr = await (await c.req(`/library/${orderId}?editor=premiere`)).text();
  assert.match(pr, /MOV โปร่งใส \(ProRes\) · 14\.\d MB/);
  assert.equal(user('lib@example.com').editor, 'premiere');
  // ครั้งหน้าไม่ระบุโปรแกรม → ใช้ที่เลือกล่าสุด
  assert.match(await (await c.req(`/library/${orderId}`)).text(), /MOV โปร่งใส \(ProRes\) ·/);
});

test('คลัง: กดดาวน์โหลด → ลิงก์ที่เซ็นแล้วอายุสั้น → ได้ไฟล์ตรงต้นฉบับ', async () => {
  const c = await newUser('dl@example.com');
  const orderId = await buy(c);
  const r = await c.req(getUrl(orderId, fileOf('still_png', 'horizontal'), 'capcut_pc'));
  assert.equal(r.status, 303);
  const signed = r.headers.get('location');
  assert.match(signed, /^\/d\/[\w-]+\/f\/order-now_still_1920x1080\.png\?e=\d+&s=[\w-]+$/);
  // ลิงก์ที่เซ็นแล้วใช้ได้โดยไม่ต้องมีคุกกี้ (โปรแกรมช่วยโหลด)
  const f = await fetch(base + signed);
  assert.equal(f.status, 200);
  assert.match(f.headers.get('content-disposition'), /attachment/);
  const orig = fs.readFileSync(path.join(cfg.storageDir, 'order-now', fileOf('still_png', 'horizontal')));
  assert.ok(Buffer.from(await f.arrayBuffer()).equals(orig));
  // หมดอายุหลัง 10 นาที → กดจากคลังใหม่ได้ลิงก์ใหม่
  const saved = clock;
  try {
    clock = saved + 11 * MIN;
    assert.equal((await fetch(base + signed)).status, 410);
    const again = await c.req(getUrl(orderId, fileOf('still_png', 'horizontal'), 'capcut_pc'));
    assert.notEqual(again.headers.get('location'), signed);
    assert.equal((await fetch(base + again.headers.get('location'))).status, 200);
  } finally { clock = saved; }
  // ไฟล์ที่ไม่ใช่ของโปรแกรมที่เลือก / ไม่มีในสินค้า / path traversal
  assert.equal((await c.req(getUrl(orderId, fileOf('prores4444'), 'capcut_pc'))).status, 404);
  for (const bad of ['manifest.json', '../../.env', '..%2F..%2F.env', 'Kanit-OFL.txt', 'nope.mp4']) {
    const st = (await c.req(`/library/${orderId}/get/${bad}?editor=other`)).status;
    assert.ok(st === 404 || st === 403, `${bad} → ${st}`);
  }
});

test('คนอื่นเข้าคลัง / โหลดไฟล์ / ดูคำสั่งซื้อของเราไม่ได้', async () => {
  const owner = await newUser('owner@example.com');
  const orderId = await buy(owner);
  const other = await newUser('other@example.com');
  assert.equal((await other.req(`/library/${orderId}`)).status, 404);
  assert.equal((await other.req(getUrl(orderId, fileOf('mp4_green')))).status, 404);
  assert.equal((await other.req(`/order/${orderId}`)).status, 404);
  assert.equal((await other.req(`/order/${orderId}/status`)).status, 404);
  assert.equal((await other.req(`/pay/mock/${orderId}`)).status, 404);
  assert.doesNotMatch(await (await other.req('/library')).text(), new RegExp(orderId));
  assert.equal(count('SELECT COUNT(*) n FROM download_log WHERE order_id = ?', orderId), 0);
  // ไม่ได้ล็อกอิน → พาไปหน้าเข้าสู่ระบบ
  const anon = client();
  const r = await anon.req(`/library/${orderId}`);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `/login?next=${encodeURIComponent(`/library/${orderId}`)}`);
  assert.equal((await anon.req(getUrl(orderId, fileOf('mp4_green')))).status, 303);
});

test('ลิงก์ที่เซ็นแล้วถูกแก้ (ลายเซ็น/วันหมดอายุ/grant) ใช้ไม่ได้', async () => {
  const c = await newUser('tamper@example.com');
  const orderId = await buy(c);
  const signed = (await c.req(getUrl(orderId, fileOf('mp4_green')))).headers.get('location');
  const u = new URL(base + signed);
  const e = Number(u.searchParams.get('e'));
  const s = u.searchParams.get('s');
  const p = u.pathname;
  const g = p.split('/')[2];
  assert.equal((await fetch(`${base}${p}?e=${e + 86400}&s=${s}`)).status, 403); // ยืดอายุเอง
  assert.equal((await fetch(`${base}${p}?e=${e}&s=${s.slice(0, -2)}AA`)).status, 403); // ลายเซ็นผิด
  assert.equal((await fetch(`${base}${p.replace(g, `AAAA${g.slice(4)}`)}?e=${e}&s=${s}`)).status, 403); // grant อื่น
  assert.equal((await fetch(`${base}${p}`)).status, 403); // ไม่มีลายเซ็น
  assert.equal((await fetch(`${base}${p.replace(/\/f\/.*/, '/f/manifest.json')}?e=${e}&s=${s}`)).status, 404);
});

test('จำกัดการโหลดต่อบัญชี 60 ไฟล์ต่อ 24 ชั่วโมง (กันแชร์บัญชี) แล้วโหลดได้อีกวันถัดไป', async () => {
  const c = await newUser('limit@example.com');
  const orderId = await buy(c);
  const url = getUrl(orderId, fileOf('mp4_green', 'horizontal'));
  for (let i = 1; i <= 60; i++) assert.equal((await c.req(url)).status, 303, `ครั้งที่ ${i}`);
  const blocked = await c.req(url);
  assert.equal(blocked.status, 429);
  assert.match(await blocked.text(), /ไฟล์ยังอยู่ในคลังของคุณ/);
  const saved = clock;
  try {
    clock = saved + DAY + MIN;
    assert.equal((await c.req(url)).status, 303);
  } finally { clock = saved; }
});

// ---------- อื่นๆ ----------

test('ชุด 3 ส่วน: manifest มีครบทุกขนาด และทุกโปรแกรมได้ชุด 3 ส่วน', () => {
  for (const size of ['vertical', 'horizontal']) {
    for (const [format, part] of [['parts_green', 'intro'], ['parts_green', 'outro'], ['parts_prores', 'intro'], ['parts_prores', 'outro'], ['still_png', 'hold']]) {
      const f = manifest().files.find((x) => x.format === format && x.size === size && x.part === part);
      assert.ok(f, `ไม่มี ${format} ${part} ${size}`);
      assert.equal(fs.statSync(path.join(cfg.storageDir, 'order-now', f.file)).size, f.bytes);
    }
  }
  for (const [id, ed] of Object.entries(cfg.editorsConfig.editors)) {
    assert.ok(ed.formats.includes('still_png'), `${id} ไม่มีภาพนิ่ง`);
    assert.ok(ed.formats.some((x) => x.startsWith('parts_')), `${id} ไม่มีส่วนเข้า/ออก`);
    assert.ok(Array.isArray(ed.kitGuide) && ed.kitGuide.length >= 2, `${id} ไม่มีคู่มือยืดภาพนิ่ง`);
  }
});

test('หน้าสาธารณะ: /license, สัญญาฟอนต์, โลโก้ และไม่มีหน้าขอลิงก์ทางอีเมลแล้ว', async () => {
  const lic = await fetch(`${base}/license`);
  assert.equal(lic.status, 200);
  assert.match(await lic.text(), /ใช้ได้ตลอด/);
  assert.equal((await fetch(`${base}/license/kanit-ofl.txt`)).status, 200);
  const logo = await fetch(`${base}/logo.svg`);
  assert.equal(logo.status, 200);
  assert.match(await logo.text(), /<svg/);
  const home = await (await fetch(`${base}/`)).text();
  assert.match(home, /favicon\.svg/);
  assert.match(home, new RegExp(cfg.shopName));
  assert.equal((await fetch(`${base}/orders/lookup`)).status, 404);
});

test('หลังบ้าน: ต้องใช้รหัสผ่าน แสดงคำสั่งซื้อและจำนวนสมาชิก', async () => {
  assert.equal((await fetch(`${base}/admin`)).status, 401);
  const bad = 'Basic ' + Buffer.from('admin:wrong').toString('base64');
  assert.equal((await fetch(`${base}/admin`, { headers: { authorization: bad } })).status, 401);
  const auth = 'Basic ' + Buffer.from(`admin:${cfg.adminPassword}`).toString('base64');
  const page = await fetch(`${base}/admin`, { headers: { authorization: auth } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /สมาชิก/);
  assert.match(html, /owner@example\.com/);
  assert.match(html, /Premiere Pro/); // สถิติโปรแกรมจากประวัติการโหลด
});

test('ไฟล์สินค้าไม่อยู่ในโฟลเดอร์ public', async () => {
  assert.equal((await fetch(`${base}/${fileOf('mp4_green')}`)).status, 404);
  assert.equal((await fetch(`${base}/storage/products/order-now/${fileOf('mp4_green')}`)).status, 404);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.ok(!fs.readdirSync(path.join(cfg.root, 'public'), { recursive: true }).some((f) => /prores|mp4_green|webm_alpha|still_/.test(f)));
});

test('ฐานข้อมูลรุ่นเก่า ย้ายข้อมูลได้โดยไม่หาย (grant หลายอันต่อคำสั่งซื้อ + คอลัมน์ user_id)', () => {
  const Database = require('better-sqlite3');
  const { openDb } = require('../src/db');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shop-db-')), 'old.db');
  const old = new Database(file);
  old.exec(`
    CREATE TABLE orders (id TEXT PRIMARY KEY, product_slug TEXT NOT NULL, editor TEXT NOT NULL, email TEXT NOT NULL, amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'THB', status TEXT NOT NULL DEFAULT 'pending', provider TEXT NOT NULL, payment_ref TEXT,
      created_at INTEGER NOT NULL, paid_at INTEGER, last_email_at INTEGER);
    CREATE TABLE download_grants (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE download_counts (grant_id TEXT NOT NULL REFERENCES download_grants(id), file TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (grant_id, file));
    INSERT INTO orders VALUES ('o1','order-now','davinci','x@example.com',4900,'THB','paid','mock',NULL,1,2,NULL);
    INSERT INTO download_grants VALUES ('g1','o1',999,1);
    INSERT INTO download_counts VALUES ('g1','a.mov',3);
  `);
  old.close();
  const db = openDb(file);
  assert.doesNotMatch(db.prepare("SELECT sql FROM sqlite_master WHERE name='download_grants'").get().sql, /UNIQUE/);
  assert.equal(db.prepare('SELECT reason FROM download_grants WHERE id = ?').get('g1').reason, 'purchase');
  assert.equal(db.prepare('SELECT count FROM download_counts WHERE grant_id = ?').get('g1').count, 3);
  assert.ok(db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'user_id'));
  assert.equal(db.prepare('SELECT user_id FROM orders WHERE id = ?').get('o1').user_id, null);
  db.prepare("INSERT INTO download_grants (id, order_id, expires_at, created_at, reason) VALUES ('g2','o1',999,5,'library')").run();
  assert.equal(db.pragma('foreign_key_check').length, 0);
  db.close();
});

// ---------- ปรับแต่งแอนิเมชัน ----------

test('ปรับแต่ง: ตรวจข้อความ/ฟอนต์/สี (ความยาว, HTML, อีโมจิ, อักขระควบคุม)', () => {
  const ctxv = { fonts: cfg.fonts, editors: cfg.editorsConfig.editors };
  const ok = { text: 'ลดราคา 50%', font: 'kanit', fill: '#FFD400', stroke: '#111111', outline: 'medium', editor: 'capcut_pc' };
  assert.equal(custom.validateRequest(ok, ctxv).error, undefined);
  assert.equal(custom.validateRequest(ok, ctxv).value.fill, '#ffd400');
  assert.equal(custom.cleanText('  สวัสดี\u0000\u200b\nครับ  '), 'สวัสดี ครับ');
  const bad = (patch) => custom.validateRequest({ ...ok, ...patch }, ctxv).error;
  assert.ok(bad({ text: '' }));
  assert.ok(bad({ text: 'ก'.repeat(41) }));
  assert.equal(bad({ text: 'ก'.repeat(40) }), undefined);
  assert.equal(bad({ text: 'น้ำใจ'.repeat(10) }), undefined, 'สระ/วรรณยุกต์นับรวมกับพยัญชนะ');
  assert.ok(bad({ text: '<script>alert(1)</script>' }));
  assert.ok(bad({ text: 'ขายดี 🔥' }));
  assert.ok(bad({ font: 'comic-sans' }));
  assert.ok(bad({ fill: 'red' }));
  assert.ok(bad({ fill: '#12345' }));
  assert.ok(bad({ stroke: 'url(x)' }));
  assert.equal(bad({ outline: 'none', stroke: '' }), undefined, 'ไม่มีขอบ ไม่ต้องมีสีขอบ');
  assert.ok(bad({ outline: 'huge' }));
  assert.ok(bad({ editor: 'photoshop' }));
  assert.ok(bad({ size: 'square' }));
  assert.ok(bad({ seconds: '7' }));
  assert.ok(bad({ seconds: '600' }));
  assert.equal(bad({ size: 'horizontal', seconds: '30' }), undefined);
  assert.equal(custom.validateRequest(ok, ctxv).value.size, 'vertical', 'ค่าเริ่มต้นแนวตั้ง');
  assert.equal(custom.validateRequest(ok, ctxv).value.seconds, 5, 'ค่าเริ่มต้น 5 วินาที');
  // ฟอนต์ทุกตัวมีไฟล์สัญญา OFL
  assert.ok(cfg.fonts.length >= 10);
  for (const f of cfg.fonts) assert.match(fs.readFileSync(f.licensePath, 'utf8'), /SIL OPEN FONT LICENSE/i, f.id);
});

test('ปรับแต่ง: สั่งเรนเดอร์ → คิว + ความคืบหน้า → เสร็จ → อยู่ในเวอร์ชันของฉัน โหลดผ่านลิงก์ที่เซ็นแล้ว', async () => {
  const c = await newUser('custom@example.com');
  const orderId = await buy(c);
  const page = await (await c.req(`/library/${orderId}/customize`)).text();
  assert.match(page, /สร้างไฟล์ของฉัน/);
  assert.match(page, /tt-mali/);
  assert.equal((await c.req(`/library/${orderId}/customize`, { method: 'POST', form: { text: 'x' } })).status, 403); // ไม่มี CSRF
  assert.equal((await c.post(`/library/${orderId}/customize`, { text: '<b>hi</b>', font: 'kanit', fill: '#ffffff', stroke: '#000000', outline: 'thin', editor: 'premiere' })).status, 400);

  const g = openGate();
  const r = await c.post(`/library/${orderId}/customize`, { text: 'โปรเด็ด วันนี้', font: 'mali', fill: '#ff3b30', stroke: '#ffffff', outline: 'thick', shadow: '1', editor: 'premiere', size: 'horizontal', seconds: '10' });
  assert.equal(r.status, 303);
  const jobUrl = r.headers.get('location');
  const jobId = jobUrl.split('/').pop();
  await new Promise((res) => setTimeout(res, 30));
  const st = await (await c.req(`${jobUrl}/status`)).json();
  assert.equal(st.status, 'rendering');
  assert.equal(st.progress, 10);
  // มีงานค้างอยู่ → สั่งงานใหม่ไม่ได้
  assert.equal((await c.post(`/library/${orderId}/customize`, { text: 'อีกอัน', font: 'kanit', fill: '#ffffff', stroke: '#000000', outline: 'medium', editor: 'premiere' })).status, 429);
  g.open(); gate = null;
  await ctx.customizer.idle();

  const done = await (await c.req(jobUrl)).text();
  assert.match(done, /โปรเด็ด วันนี้/);
  assert.match(done, /พร้อมดาวน์โหลด/);
  // ปุ่มดาวน์โหลดเดียว ไฟล์เดียว บอกชนิด แนว ความยาว + วิธีใช้อยู่บนหน้า
  assert.equal((done.match(/\/download"/g) || []).length, 1);
  assert.doesNotMatch(done, /\/get\/|\.zip/);
  assert.match(done, /MOV โปร่งใส \(ProRes\) · แนวนอน 16:9 · 10 วินาที/);
  assert.match(done, /วิธีใช้ใน Premiere Pro/);
  assert.match(done, /SIL Open Font License/);
  assert.deepEqual(fs.readdirSync(ctx.customizer.outDir(jobId)), [`${jobId}.mov`]);
  assert.equal(rendered.at(-1).size, 'horizontal');
  assert.equal(rendered.at(-1).seconds, 10);
  assert.match(await (await c.req('/library')).text(), /เวอร์ชันของฉัน[\s\S]*โปรเด็ด วันนี้/);
  assert.equal(user('custom@example.com').editor, 'premiere');
  assert.equal(rendered.at(-1).font, 'mali');
  assert.equal(rendered.at(-1).shadow, 1);

  const g2 = await c.req(`/library/custom/${jobId}/download`);
  assert.equal(g2.status, 303);
  const signed = g2.headers.get('location');
  assert.match(signed, new RegExp(`^/c/${jobId}/f/${jobId}\\.mov\\?e=`));
  const dl = await fetch(base + signed);
  assert.equal(dl.status, 200);
  assert.match(decodeURIComponent(dl.headers.get('content-disposition')), /โปรเด็ด วันนี้ - Premiere Pro - แนวนอน 10วิ\.mov/);
  assert.equal(dl.headers.get('content-length'), String(Buffer.byteLength('โปรเด็ด วันนี้|prores4444|horizontal|10')));
  assert.equal(await dl.text(), 'โปรเด็ด วันนี้|prores4444|horizontal|10');
  // ลายเซ็นของไฟล์ปรับแต่งใช้กับ /d (ไฟล์สินค้า) ไม่ได้ และกลับกัน
  const u = new URL(base + signed);
  assert.equal((await fetch(`${base}/d/${jobId}/f/${fileOf('mp4_green')}${u.search}`)).status, 403);
  assert.equal((await fetch(`${base}/c/${jobId}/f/manifest.json${u.search}`)).status, 404);
  assert.equal((await fetch(`${base}/c/${jobId}/f/..%2F..%2F.env${u.search}`)).status, 404);
  // "ทำอีกแบบจากเวอร์ชันนี้" เริ่มจากค่าเดิม
  const again = await (await c.req(`/library/${orderId}/customize?from=${jobId}`)).text();
  assert.match(again, /value="โปรเด็ด วันนี้"/);
  assert.match(again, /value="mali"[^>]*checked/);
  assert.match(again, /value="premiere"[^>]*checked/);
  assert.match(again, /name="size" value="horizontal" checked/);
  assert.match(again, /name="seconds" value="10" checked/);
  const saved = clock;
  try { clock = saved + 11 * MIN; assert.equal((await fetch(base + signed)).status, 410); } finally { clock = saved; }
});

test('ปรับแต่ง: คนอื่นดู/โหลด/ลบเวอร์ชันของเราไม่ได้ และปรับแต่งสินค้าที่ไม่ได้ซื้อไม่ได้', async () => {
  const owner = await newUser('cz-owner@example.com');
  const orderId = await buy(owner);
  const r = await owner.post(`/library/${orderId}/customize`, { text: 'ของฉันคนเดียว', font: 'prompt', fill: '#ffffff', stroke: '#111111', outline: 'medium', editor: 'capcut_mobile' });
  const jobId = r.headers.get('location').split('/').pop();
  await ctx.customizer.idle();
  const other = await newUser('cz-other@example.com');
  assert.equal((await other.req(`/library/custom/${jobId}`)).status, 404);
  assert.equal((await other.req(`/library/custom/${jobId}/status`)).status, 404);
  assert.equal((await other.req(`/library/custom/${jobId}/download`)).status, 404);
  assert.match(await (await other.req(`/library/${orderId}/customize?from=${jobId}`)).text().catch(() => ''), /ไม่พบ|^$/);
  assert.equal((await other.post(`/library/custom/${jobId}/delete`)).status, 404);
  assert.doesNotMatch(await (await other.req('/library')).text(), /ของฉันคนเดียว/);
  assert.equal((await other.req(`/library/${orderId}/customize`)).status, 404);
  assert.equal((await other.post(`/library/${orderId}/customize`, { text: 'แอบ', font: 'kanit', fill: '#ffffff', stroke: '#111111', outline: 'medium', editor: 'other' })).status, 404);
  // ลิงก์ปลอม (ลายเซ็นของงานอื่น)
  const signed = (await owner.req(`/library/custom/${jobId}/download`)).headers.get('location');
  const u = new URL(base + signed);
  assert.equal((await fetch(`${base}/c/${'0'.repeat(24)}/f/${jobId}.mp4${u.search}`)).status, 403);
  // ใช้ค่าของเวอร์ชันคนอื่นเป็นจุดเริ่มต้นไม่ได้
  const otherOrder = await buy(other);
  assert.doesNotMatch(await (await other.req(`/library/${otherOrder}/customize?from=${jobId}`)).text(), /ของฉันคนเดียว/);
  // ไม่ได้ล็อกอิน
  assert.equal((await client().req(`/library/custom/${jobId}`)).status, 303);
  // เจ้าของลบได้ แล้วไฟล์หายจริง
  assert.equal((await owner.post(`/library/custom/${jobId}/delete`)).status, 303);
  assert.equal((await owner.req(`/library/custom/${jobId}`)).status, 404);
  assert.ok(!fs.existsSync(ctx.customizer.outDir(jobId)));
});

test('ปรับแต่ง: ไม่จำกัดจำนวนครั้ง (ทีละงาน) แต่มีโควตาพื้นที่ และปิดปุ่มเมื่อเครื่องยังเรนเดอร์ไม่ได้', async () => {
  const c = await newUser('cz-limit@example.com');
  const orderId = await buy(c);
  const body = (i) => ({ text: `ครั้งที่ ${i}`, font: 'kanit', fill: '#ffffff', stroke: '#111111', outline: 'medium', editor: 'other' });
  for (let i = 1; i <= 12; i++) {
    assert.equal((await c.post(`/library/${orderId}/customize`, body(i))).status, 303, `ครั้งที่ ${i}`);
    await ctx.customizer.idle();
  }
  // โควตา 1 MB: ทำให้ไฟล์ของงานถัดไปใหญ่จนเต็ม
  fakeBytes = 1100 * 1024;
  assert.equal((await c.post(`/library/${orderId}/customize`, body(13))).status, 303);
  await ctx.customizer.idle();
  fakeBytes = 20;
  const full = await c.post(`/library/${orderId}/customize`, body(14));
  assert.equal(full.status, 429);
  assert.match(await full.text(), /พื้นที่เก็บเวอร์ชันของคุณเต็มแล้ว/);
  // ลบเวอร์ชันใหญ่ → สร้างต่อได้
  const big = ctx.customizer.byUser(user('cz-limit@example.com').id).find((j) => j.text === 'ครั้งที่ 13');
  assert.equal((await c.post(`/library/custom/${big.id}/delete`)).status, 303);
  assert.equal((await c.post(`/library/${orderId}/customize`, body(15))).status, 303);
  await ctx.customizer.idle();
  renderTools.ok = false;
  try {
    assert.equal((await c.post(`/library/${orderId}/customize`, body(16))).status, 503);
    assert.match(await (await c.req(`/library/${orderId}/customize`)).text(), /ระบบสร้างไฟล์ยังไม่พร้อม/);
    const admin = await (await fetch(`${base}/admin`, { headers: { authorization: 'Basic ' + Buffer.from(`admin:${cfg.adminPassword}`).toString('base64') } })).text();
    assert.match(admin, /ยังไม่พร้อม/);
  } finally { renderTools.ok = true; }
});

// ---------- สไตล์ของฉัน ----------

async function styleReq(c, p, { json, csrf } = {}) {
  const h = { accept: 'application/json', 'x-csrf-token': csrf || await c.csrf(), cookie: Object.entries(c.jar).map(([k, v]) => `${k}=${v}`).join('; ') };
  if (json) h['content-type'] = 'application/json';
  const r = await fetch(base + p, { method: 'POST', headers: h, body: json ? JSON.stringify(json) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

test('สไตล์ของฉัน: บันทึกแค่ตั้งชื่อ (ไม่โหลดหน้าใหม่) กดใช้กับแอนิเมชันไหนก็ได้ ข้อความไม่เปลี่ยน และมี "ล่าสุด" อัตโนมัติ', async () => {
  const c = await newUser('style@example.com');
  const orderId = await buy(c);
  const first = await (await c.req(`/library/${orderId}/customize`)).text();
  assert.match(first, /บันทึกสไตล์นี้/);
  assert.match(first, /ครั้งแรก: เลือกฟอนต์และสีที่ชอบ/);
  assert.doesNotMatch(first, /data-style-chip[^>]*class="style-chip last/); // ยังไม่มี "ล่าสุด"

  const look = { font: 'prompt', fill: '#0EA5E9', stroke: '#ffffff', outline: 'thick', shadow: true };
  const saved = await styleReq(c, '/library/styles', { json: { ...look, name: 'ฟ้าขอบขาว' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.name, 'ฟ้าขอบขาว');
  assert.deepEqual(saved.json.style, { font: 'prompt', fill: '#0ea5e9', stroke: '#ffffff', outline: 'thick', shadow: true });
  const id = saved.json.id;
  // ไม่ตั้งชื่อ → ตั้งให้อัตโนมัติ · ไม่สั่งสร้างไฟล์
  assert.equal((await styleReq(c, '/library/styles', { json: { ...look, fill: '#ff3b30' } })).json.name, 'สไตล์ 2');
  assert.equal(count('SELECT COUNT(*) n FROM custom_renders WHERE user_id = ?', user('style@example.com').id), 0);
  // ค่าไม่ถูกต้อง / ไม่มี CSRF
  assert.equal((await styleReq(c, '/library/styles', { json: { ...look, fill: 'red' } })).status, 400);
  assert.equal((await styleReq(c, '/library/styles', { json: { ...look, font: 'nope' } })).status, 400);
  assert.equal((await styleReq(c, '/library/styles', { json: look, csrf: 'x'.repeat(43) })).status, 403);

  // หน้าปรับแต่งมีปุ่มสไตล์ (ชื่อ + ข้อมูลหน้าตา) กดทีเดียวใช้ได้ในหน้าเดิม
  const page = await (await c.req(`/library/${orderId}/customize`)).text();
  assert.match(page, /ฟ้าขอบขาว/);
  assert.match(page, new RegExp(`data-style-id="${id}"`));
  assert.match(page, /&quot;font&quot;:&quot;prompt&quot;/);
  // ลิงก์ "ใช้กับ…" จากหน้าจัดการ: ใช้หน้าตาของสไตล์ แต่ข้อความยังเป็นของเดิม
  const viaLink = await (await c.req(`/library/${orderId}/customize?style=${id}`)).text();
  assert.match(viaLink, /value="prompt"[^>]*checked/);
  assert.match(viaLink, /value="สั่งซื้อเลย"/);
  assert.match(await (await c.req('/library/styles')).text(), /ฟ้าขอบขาว/);
  assert.equal((await c.req('/library/presets')).status, 301);

  // สร้างไฟล์ครั้งหนึ่ง → มีปุ่ม "ล่าสุด" ให้กดใช้ซ้ำ
  assert.equal((await c.post(`/library/${orderId}/customize`, { text: 'ล่าสุด', font: 'mali', fill: '#ffffff', stroke: '#111111', outline: 'medium', editor: 'capcut_pc' })).status, 303);
  await ctx.customizer.idle();
  const after = await (await c.req(`/library/${orderId}/customize`)).text();
  assert.match(after, /class="style-chip last"[^>]*data-style="[^"]*mali/);
  assert.match(after, /value="ล่าสุด"/);

  // เปลี่ยนชื่อ / ลบ (แบบไม่โหลดหน้า)
  assert.equal((await c.post(`/library/styles/${id}/rename`, { name: 'ฟ้าสด' })).status, 303);
  assert.equal(ctx.db.prepare('SELECT name FROM custom_presets WHERE id = ?').get(id).name, 'ฟ้าสด');
  // คนอื่นใช้/แก้/ลบสไตล์ของเราไม่ได้
  const other = await newUser('style-other@example.com');
  const otherOrder = await buy(other);
  assert.doesNotMatch(await (await other.req(`/library/${otherOrder}/customize?style=${id}`)).text(), /ฟ้าสด|value="prompt"[^>]*checked/);
  assert.equal((await other.post(`/library/styles/${id}/rename`, { name: 'แฮ็ก' })).status, 404);
  assert.equal((await styleReq(other, `/library/styles/${id}/delete`)).status, 404);
  assert.doesNotMatch(await (await other.req('/library/styles')).text(), /ฟ้าสด/);
  assert.equal((await styleReq(c, `/library/styles/${id}/delete`)).status, 200);
  assert.equal(count('SELECT COUNT(*) n FROM custom_presets WHERE id = ?', id), 0);
});

// ---------- ฟอนต์ของลูกค้า ----------

const { toWoff, toWoff2 } = require('./fontpack');
const { inspectFont } = require('../src/fontcheck');

async function uploadFont(c, buf, { rights = 'yes', csrf } = {}) {
  const h = { 'content-type': 'application/octet-stream', 'x-font-rights': rights, 'x-csrf-token': csrf || await c.csrf(), cookie: Object.entries(c.jar).map(([k, v]) => `${k}=${v}`).join('; ') };
  const r = await fetch(`${base}/library/fonts`, { method: 'POST', headers: h, body: buf });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

test('ตัวตรวจฟอนต์: อ่านไฟล์จริง TTF/WOFF/WOFF2 ได้ และปฏิเสธไฟล์ปลอม', () => {
  const ttf = fs.readFileSync(path.join(cfg.root, 'public/fonts/thai/mali/Mali-Bold.ttf'));
  for (const [buf, fmt] of [[ttf, 'ttf'], [toWoff(ttf), 'woff'], [toWoff2(ttf), 'woff2']]) {
    const r = inspectFont(buf);
    assert.equal(r.format, fmt);
    assert.equal(r.thai, 'full');
    assert.match(r.name, /Mali/);
    assert.ok(r.chars.includes('ก') && r.chars.includes('ำ') && r.chars.includes('A'));
  }
  const bad = (b) => assert.throws(() => inspectFont(b), (e) => e.name === 'FontError');
  bad(Buffer.from('<script>alert(1)</script>'));
  bad(Buffer.concat([Buffer.from('OTTO'), crypto.randomBytes(200)]));
  bad(Buffer.concat([ttf.subarray(0, 12), crypto.randomBytes(300)])); // หัวไฟล์จริง แต่ตารางชี้มั่ว
  const cut = toWoff2(ttf); cut.writeUInt32BE(10, 20); bad(cut);
  bad(Buffer.alloc(6 * 1024 * 1024, 1));
  // ฟอนต์ที่ไม่มีอักษรไทย (ถ้าเครื่องมี Arial)
  const arial = '/System/Library/Fonts/Supplemental/Arial.ttf';
  if (fs.existsSync(arial)) assert.equal(inspectFont(fs.readFileSync(arial)).thai, 'none');
});

test('ฟอนต์ของฉัน: อัปโหลด ใช้ในตัวอย่างและตอนสร้างไฟล์ แนบบันทึกว่าร้านไม่ได้ให้สิทธิ์ฟอนต์นี้', async () => {
  const c = await newUser('font@example.com');
  const orderId = await buy(c);
  const ttf = fs.readFileSync(path.join(cfg.root, 'public/fonts/thai/sriracha/Sriracha-Regular.ttf'));
  // ต้องยืนยันสิทธิ์ + CSRF + เป็นฟอนต์จริง
  assert.equal((await uploadFont(c, ttf, { rights: 'no' })).status, 400);
  assert.equal((await uploadFont(c, ttf, { csrf: 'x'.repeat(43) })).status, 403);
  const junk = await uploadFont(c, Buffer.from('MZ this is an exe not a font'));
  assert.equal(junk.status, 400);
  assert.match(junk.json.error, /ไม่ใช่ฟอนต์/);
  assert.equal((await uploadFont(client(), ttf)).status, 401);
  const up = await uploadFont(c, toWoff2(ttf));
  assert.equal(up.status, 200);
  assert.equal(up.json.thai, 'full');
  assert.equal(up.json.format, 'woff2');
  const fontId = up.json.id;
  // ไฟล์อยู่นอก public และเจ้าของโหลดไปแสดงตัวอย่างได้
  assert.ok(!fs.readdirSync(path.join(cfg.root, 'public'), { recursive: true }).some((f) => f.includes(fontId)));
  const fr = await c.req(`/library/fonts/${fontId}/file`);
  assert.equal(fr.status, 200);
  assert.equal(fr.headers.get('content-type'), 'font/woff2');
  assert.match(fr.headers.get('cache-control'), /private/);
  const page = await (await c.req(`/library/${orderId}/customize`)).text();
  assert.match(page, new RegExp(`tt-u-${fontId}`));
  assert.match(await (await c.req('/library/fonts')).text(), /มีสิทธิ์ใช้ฟอนต์นี้ในงานเชิงพาณิชย์เอง/);

  // สร้างไฟล์ด้วยฟอนต์ของตัวเอง
  const r = await c.post(`/library/${orderId}/customize`, { text: 'ลายมือฉันเอง', font: `u-${fontId}`, fill: '#ffffff', stroke: '#111111', outline: 'medium', editor: 'other' });
  assert.equal(r.status, 303);
  await ctx.customizer.idle();
  const job = rendered.at(-1);
  assert.equal(job.fontInfo.user, true);
  assert.ok(job.fontInfo.file.endsWith(`${fontId}.woff2`));
  assert.equal(job.fontInfo.mime, 'font/woff2');
  // หน้าผลลัพธ์บอกว่าร้านไม่ได้ให้สิทธิ์ฟอนต์ที่อัปโหลด (ไม่ใส่ไฟล์เอกสารเพิ่มในไฟล์ดาวน์โหลด)
  const jobPage = await (await c.req(r.headers.get('location'))).text();
  assert.match(jobPage, /เป็นฟอนต์ที่คุณอัปโหลดเอง ร้านไม่ได้ให้สิทธิ์ใช้งานฟอนต์นี้/);
  assert.doesNotMatch(jobPage, /ใช้สัญญา SIL Open Font License ใช้เชิงพาณิชย์ได้/);
  // ตัวเรนเดอร์จริงส่งฟอนต์ของลูกค้าเข้า renderSingle (จำลอง renderSingle ไม่ต้องรัน ffmpeg)
  const render = require('../render/render');
  const orig = render.renderSingle;
  let got = null;
  render.renderSingle = async (o) => { got = o; fs.writeFileSync(o.outFile, 'x'); return { file: path.basename(o.outFile), bytes: 1, ms: 1, mime: 'video/mp4' }; };
  try {
    const realRenderer = custom.createRenderer(cfg);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'single-'));
    const files = await realRenderer({ ...job, editor: 'other', size: 'horizontal', seconds: 15, filetype: 'main' }, { outDir: out, onProgress: () => {}, font: job.fontInfo });
    assert.equal(files.length, 1);
    assert.equal(files[0].format, 'single');
    assert.equal(files[0].codec, 'mp4_green');
    assert.equal(got.font.mime, 'font/woff2');
    assert.equal(got.size, 'horizontal');
    assert.equal(got.seconds, 15);
    const files2 = await realRenderer({ ...job, editor: 'premiere', size: 'vertical', seconds: 3, filetype: 'alt' }, { outDir: out, onProgress: () => {}, font: job.fontInfo });
    assert.equal(files2[0].codec, 'mp4_green', 'Premiere เลือกไฟล์ทางเลือก = MP4 พื้นเขียว');
  } finally { render.renderSingle = orig; }
});

test('ฟอนต์ของฉัน: ไม่มีตัวอักษรที่พิมพ์ → ไม่ให้สร้างไฟล์ และคนอื่นใช้/โหลด/ลบฟอนต์ของเราไม่ได้', async () => {
  const owner = await newUser('font-owner@example.com');
  const orderId = await buy(owner);
  const ttf = fs.readFileSync(path.join(cfg.root, 'public/fonts/thai/itim/Itim-Regular.ttf'));
  const { json } = await uploadFont(owner, toWoff(ttf));
  const fontId = json.id;
  // จำลองฟอนต์ที่ไม่มีอักษรไทย: แก้ชุดตัวอักษรในฐานข้อมูลให้มีแค่ละติน
  ctx.db.prepare("UPDATE user_fonts SET chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!', thai = 'none' WHERE id = ?").run(fontId);
  const r = await owner.post(`/library/${orderId}/customize`, { text: 'สวัสดี Hi', font: `u-${fontId}`, fill: '#ffffff', stroke: '#111111', outline: 'medium', editor: 'other' });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /ไม่มีตัวอักษร: ส ว ั ด ี/);
  assert.equal((await owner.post(`/library/${orderId}/customize`, { text: 'Hi', font: `u-${fontId}`, fill: '#ffffff', stroke: '#111111', outline: 'medium', editor: 'other' })).status, 303);
  await ctx.customizer.idle();

  const other = await newUser('font-other@example.com');
  const otherOrder = await buy(other);
  assert.equal((await other.req(`/library/fonts/${fontId}/file`)).status, 404);
  assert.equal((await client().req(`/library/fonts/${fontId}/file`)).status, 303);
  assert.doesNotMatch(await (await other.req('/library/fonts')).text(), new RegExp(fontId));
  assert.doesNotMatch(await (await other.req(`/library/${otherOrder}/customize`)).text(), new RegExp(fontId));
  const steal = await other.post(`/library/${otherOrder}/customize`, { text: 'Hi', font: `u-${fontId}`, fill: '#ffffff', stroke: '#111111', outline: 'medium', editor: 'other' });
  assert.equal(steal.status, 400, 'ใช้ฟอนต์ของคนอื่นไม่ได้');
  assert.equal((await other.post(`/library/fonts/${fontId}/delete`)).status, 404);
  // ต่อให้งานในฐานข้อมูลอ้างฟอนต์คนอื่น ตัวหาไฟล์ฟอนต์ก็ไม่ยอม
  assert.throws(() => ctx.customizer.resolveFont({ font: `u-${fontId}`, user_id: user('font-other@example.com').id }), /ไม่พบฟอนต์/);
  // เจ้าของลบได้ ไฟล์หายจริง
  const row = ctx.db.prepare('SELECT * FROM user_fonts WHERE id = ?').get(fontId);
  const file = ctx.customizer.userFonts.path(row);
  assert.ok(fs.existsSync(file));
  assert.equal((await owner.post(`/library/fonts/${fontId}/delete`)).status, 303);
  assert.ok(!fs.existsSync(file));
});

test('ไฟล์สาธารณะที่หน้าปรับแต่งใช้: ท่าเคลื่อนไหว และฟอนต์ OFL', async () => {
  assert.equal((await fetch(`${base}/motion.js`)).status, 200);
  assert.equal((await fetch(`${base}/customize.js`)).status, 200);
  for (const f of cfg.fonts) assert.equal((await fetch(base + f.url)).status, 200, f.id);
});

test('คลัง: แบบต้นฉบับโหลดเป็นไฟล์วิดีโอไฟล์เดียว ตามโปรแกรมและแนวที่เลือก', async () => {
  const c = await newUser('pkg@example.com');
  const orderId = await buy(c);
  const page = await (await c.req(`/library/${orderId}?editor=capcut_mobile&size=horizontal`)).text();
  assert.match(page, new RegExp(`/library/${orderId}/download\\?editor=capcut_mobile&(amp;)?size=horizontal"`));
  assert.match(page, /วิธีใช้ใน CapCut มือถือ/);
  assert.doesNotMatch(page, /\.zip|ต้องการโหลดทีละไฟล์/);
  const r = await c.req(`/library/${orderId}/download?editor=capcut_mobile&size=horizontal`);
  assert.equal(r.status, 303);
  const signed = r.headers.get('location');
  assert.match(signed, /^\/d\/[\w-]+\/f\/order-now_mp4_green_1920x1080\.mp4\?e=/);
  const dl = await fetch(base + signed);
  assert.equal(dl.status, 200);
  assert.ok(Buffer.from(await dl.arrayBuffer()).equals(fs.readFileSync(path.join(cfg.storageDir, 'order-now', 'order-now_mp4_green_1920x1080.mp4'))));
  // Premiere แนวตั้ง = ProRes · ทางเลือก = MP4 พื้นเขียว
  assert.match((await c.req(`/library/${orderId}/download?editor=premiere&size=vertical`)).headers.get('location'), /prores4444_1080x1920\.mov/);
  assert.match((await c.req(`/library/${orderId}/download?editor=premiere&size=vertical&filetype=alt`)).headers.get('location'), /mp4_green_1080x1920\.mp4/);
  // คนอื่นโหลดไม่ได้
  const other = await newUser('pkg-other@example.com');
  assert.equal((await other.req(`/library/${orderId}/download?editor=capcut_mobile`)).status, 404);
});

test('ใช้ง่าย: อัปโหลดฟอนต์แล้วได้ลิงก์ไปหน้าปรับแต่งที่เลือกฟอนต์ให้แล้ว', async () => {
  const c = await newUser('easy@example.com');
  const orderId = await buy(c);
  const ttf = fs.readFileSync(path.join(cfg.root, 'public/fonts/thai/athiti/Athiti-Bold.ttf'));
  const { status, json } = await uploadFont(c, ttf);
  assert.equal(status, 200);
  assert.equal(json.customizeUrl, `/library/${orderId}/customize?font=u-${json.id}`);
  assert.ok(json.chars.includes('ก'));
  const page = await (await c.req(json.customizeUrl)).text();
  assert.match(page, new RegExp(`value="u-${json.id}"[^>]*checked`));
  // ใส่ฟอนต์ที่ไม่ใช่ของตัวเองใน ?font= → ไม่ถูกเลือก (กลับไปใช้ฟอนต์ของร้าน)
  const other = await newUser('easy-other@example.com');
  const otherOrder = await buy(other);
  assert.doesNotMatch(await (await other.req(`/library/${otherOrder}/customize?font=u-${json.id}`)).text(), new RegExp(json.id));
});

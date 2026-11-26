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

// สินค้าในเทสต์: ใช้ config จริง แต่ให้ "สั่งซื้อเลย" มีราคา ฿49 และอยู่อันดับแรก ไว้ทดสอบขั้นตอนจ่ายเงิน
// (ร้านจริงตั้ง "สั่งซื้อเลย" กับ "กดติดตามเลย" เป็นของฟรี ดูเทสต์ของฟรีด้านล่าง ใช้ "กดติดตามเลย")
const REAL_PRODUCTS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'products.json'), 'utf8'));
function testProducts() {
  const list = JSON.parse(JSON.stringify(REAL_PRODUCTS));
  const on = list.find((p) => p.slug === 'order-now');
  on.price = 4900;
  return [on, ...list.filter((p) => p !== on)];
}

before(async () => {
  cfg = loadConfig({
    NODE_ENV: 'test',
    DATABASE_FILE: ':memory:',
    DOWNLOAD_LINK_SECRET: crypto.randomBytes(32).toString('hex'),
    PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex'),
    ADMIN_EMAIL: 'Admin@Aksornwai.Local',
    ADMIN_PASSWORD: 'test-admin-password-123',
    PAYMENT_PROVIDER: 'mock',
    MAIL_MODE: 'console',
    BASE_URL: 'http://shop.test',
    DOWNLOAD_LINK_MINUTES: '10',
    DOWNLOAD_DAILY_LIMIT: '60',
    CUSTOM_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'shop-custom-')),
    CUSTOM_STORAGE_MB: '1',
    RATE_GLOBAL_PER_MIN: '0', // เทสต์ยิงคำขอเยอะจาก IP เดียว (มีเทสต์ตัวจำกัดแยกด้านล่าง)
    RATE_SIGNUP_PER_HOUR: '1000',
    LEGAL_NAME: 'ร้านทดสอบ จำกัด',
    USER_FONT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'shop-fonts-')),
    products: testProducts(),
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
    async post(p, form = {}) { return c.req(p, { method: 'POST', form: { csrf: await c.csrf(), ...(p === '/signup' && form.password !== undefined && form.password2 === undefined ? { password2: form.password } : {}), ...form } }); },
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

// ซื้อแพ็กพรีเมียม (order-now ในเทสต์ตั้งราคาไว้ = พรีเมียม) แล้วคืนรายการ order-now ในคลัง
async function buy(c) {
  const { orderId } = await checkout(c);
  const r = await sendWebhook(mock.buildEvent(order(orderId)));
  assert.equal((await r.json()).result, 'paid');
  const o = order(orderId);
  return ctx.db.prepare("SELECT id FROM orders WHERE user_id = ? AND product_slug = 'order-now' AND status = 'paid'").get(o.user_id).id;
}

const manifest = () => cfg.products[0].manifest;
const fileOf = (format, size = 'vertical', part) => manifest().files.find((f) => f.format === format && f.size === size && (!part || f.part === part)).file;
const getUrl = (orderId, file, editor) => `/library/${orderId}/get/${encodeURIComponent(file)}${editor ? `?editor=${editor}` : ''}`;

// ---------- บัญชี ----------

test('/healthz ตอบ ok สั้นๆ ไม่ตั้งคุกกี้ ไม่แคช (ใช้ปลุกเว็บบน Render)', async () => {
  const r = await fetch(base + '/healthz');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'ok');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(r.headers.getSetCookie(), []);
});

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
  assert.match(page, /ปลดล็อกพรีเมียม/); // ตัวพรีเมียมขายเป็นแพ็กเดียว
  assert.match(page, /href="\/login\?next=%2Fpremium"/);
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
  assert.equal(o.product_slug, 'premium-pack'); // ตัวพรีเมียมซื้อแยกไม่ได้ → ซื้อเป็นแพ็ก
  assert.equal(o.amount, cfg.premiumPack.price);
  assert.equal(o.amount, 15000);
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
  assert.match(done, /href="\/library\?pack=1"/);
  assert.match(done, /แอนิเมชันพรีเมียมทุกแบบเข้าคลังของคุณแล้ว/);
  const child = ctx.db.prepare("SELECT * FROM orders WHERE user_id = ? AND product_slug = 'order-now' AND status = 'paid'").get(order(orderId).user_id);
  assert.equal(child.provider, 'pack');
  assert.equal(child.amount, 0);
  await new Promise((res) => setTimeout(res, 20));
  const mail = ctx.mailer.sent.filter((m) => m.to === 'sim@example.com').at(-1);
  assert.ok(mail);
  assert.match(mail.text, /http:\/\/shop\.test\/library\n/);
  assert.match(mail.text, /แพ็กพรีเมียม/);
  assert.doesNotMatch(mail.text, /\/d\//);
  const lib = await (await c.req('/library')).text();
  assert.match(lib, new RegExp(`/library/${child.id}`));
  assert.doesNotMatch(lib, new RegExp(`/library/${orderId}`)); // แพ็กเองไม่ใช่รายการในคลัง
  // ซื้อซ้ำ → พาไปคลัง ไม่สร้างคำสั่งซื้อใหม่
  const n = count('SELECT COUNT(*) n FROM orders');
  const again = await c.post('/checkout', { product: 'order-now' });
  assert.equal(again.headers.get('location'), `/library/${child.id}`);
  assert.equal((await c.post('/checkout', { product: 'premium-pack' })).headers.get('location'), '/library?pack=1');
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
  assert.equal(ctx.mailer.sent.filter((m) => m.to === 'dup@example.com' && /ยืนยันการสั่งซื้อ/.test(m.subject)).length, 1);
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
  assert.match(pr, /MOV โปร่งใส \(ProRes\) · \d+\.\d MB/);
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
  // หน้าติดต่อร้าน + ลิงก์ท้ายเว็บ
  const contact = await fetch(`${base}/contact`);
  assert.equal(contact.status, 200);
  assert.match(await contact.text(), /ติดต่อร้าน/);
  assert.match(home, /href="\/contact"/);
  // หน้าสิทธิ์ลิสต์ฟอนต์ของร้านทุกตัว พร้อมลิงก์สัญญา OFL ที่เปิดได้จริง
  const licHtml = await (await fetch(`${base}/license`)).text();
  for (const f of cfg.fonts) {
    assert.ok(licHtml.includes(`/fonts/thai/${f.id}/OFL.txt`), `ไม่มีลิงก์สัญญาฟอนต์ ${f.id}`);
    assert.equal((await fetch(`${base}/fonts/thai/${f.id}/OFL.txt`)).status, 200);
  }
});

async function adminClient() {
  const c = client();
  const r = await c.login(cfg.adminEmail, cfg.adminPassword);
  assert.equal(r.status, 303);
  return c;
}

test('หลังบ้าน: แอดมินเข้าสู่ระบบที่หน้าปกติ (อีเมล+รหัสจาก .env) ลูกค้าเข้าไม่ได้ ไม่มีกล่องถามรหัสแยกแล้ว', async () => {
  // บัญชีแอดมินถูกสร้างจาก .env: ยืนยันอีเมลแล้ว รหัสเก็บเป็น scrypt
  const a = user(cfg.adminEmail);
  assert.equal(a.role, 'admin');
  assert.ok(a.email_verified_at);
  assert.match(a.password_hash, /^scrypt\$/);
  assert.ok(!a.password_hash.includes(cfg.adminPassword));
  assert.equal(count("SELECT COUNT(*) n FROM users WHERE role = 'admin'"), 1);

  // ยังไม่ล็อกอิน → พาไปหน้าเข้าสู่ระบบ (ไม่มี Basic auth) · Basic auth ใช้ไม่ได้อีก
  const anon = client();
  const r0 = await anon.req('/admin');
  assert.equal(r0.status, 303);
  assert.equal(r0.headers.get('location'), '/login?next=%2Fadmin');
  assert.equal(r0.headers.get('www-authenticate'), null);
  const basic = 'Basic ' + Buffer.from(`admin:${cfg.adminPassword}`).toString('base64');
  assert.equal((await fetch(`${base}/admin`, { redirect: 'manual', headers: { authorization: basic } })).status, 303);

  // ลูกค้าทั่วไปเข้าไม่ได้ (ตอบเหมือนไม่มีหน้านี้) และไม่เห็นลิงก์หลังบ้าน
  const cust = await newUser('not-admin@example.com');
  assert.equal((await cust.req('/admin')).status, 404);
  assert.doesNotMatch(await (await cust.req('/library')).text(), /href="\/admin"/);
  assert.equal(user('not-admin@example.com').role, 'customer');
  // สมัครด้วยอีเมลแอดมินไม่ได้ และรหัสผิดเข้าไม่ได้
  assert.equal((await client().signup(cfg.adminEmail)).status, 400);
  assert.equal((await client().login(cfg.adminEmail, 'wrong-password-1')).status, 401);

  // แอดมินล็อกอินปกติ: เห็นลิงก์หลังบ้านในเมนู เข้า /admin ได้
  const adm = await adminClient();
  const lib = await (await adm.req('/library')).text();
  assert.match(lib, /href="\/admin"/);
  assert.doesNotMatch(lib, /class="verify-bar"/, 'อีเมลแอดมินยืนยันแล้ว');
  const page = await adm.req('/admin');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.match(html, /สมาชิก/);
  assert.match(html, /owner@example\.com/);
  assert.match(html, /Premiere Pro/); // สถิติโปรแกรมจากประวัติการโหลด
  // จำนวนสมาชิกไม่นับแอดมิน
  assert.equal(Number(/สมาชิก<\/span><b>(\d+)/.exec(html)[1]), count("SELECT COUNT(*) n FROM users WHERE role != 'admin'"));
  // ออกจากระบบแล้วเข้าไม่ได้อีก
  assert.equal((await adm.post('/logout')).status, 303);
  assert.equal((await adm.req('/admin')).status, 303);
});

test('หลังบ้าน: ลืมรหัสผ่านของแอดมินไม่ส่งลิงก์ และเปลี่ยนรหัสใน .env แล้วเปิดร้านใหม่ รหัสใหม่ใช้ได้ รหัสเก่าใช้ไม่ได้', async () => {
  const n = ctx.mailer.sent.length;
  const r = await client().post('/forgot', { email: cfg.adminEmail });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /ถ้าอีเมลนี้มีบัญชีอยู่/);
  assert.equal(ctx.mailer.sent.length, n, 'ไม่ส่งลิงก์ตั้งรหัสของแอดมิน');
  // จำลองเปิดร้านใหม่ด้วยรหัสแอดมินใหม่ (ฐานข้อมูลเดียวกัน)
  const cfg2 = { ...cfg, adminPassword: 'brand-new-admin-pass-77' };
  const ctx2 = createApp(cfg2, { db: ctx.db, now: () => clock, log: () => {}, renderer: fakeRenderer, renderTools });
  const s2 = await new Promise((res) => { const sv = ctx2.app.listen(0, '127.0.0.1', () => res(sv)); });
  try {
    const b2 = `http://127.0.0.1:${s2.address().port}`;
    const login = (pw) => fetch(`${b2}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'csrf=' + 'c'.repeat(43) }, body: new URLSearchParams({ csrf: 'c'.repeat(43), email: cfg.adminEmail, password: pw }) });
    assert.equal((await login('brand-new-admin-pass-77')).status, 303);
    assert.equal((await login(cfg.adminPassword)).status, 401);
  } finally { s2.close(); }
  // คืนรหัสเดิมให้เทสต์อื่น
  createApp(cfg, { db: ctx.db, now: () => clock, log: () => {}, renderer: fakeRenderer, renderTools });
  assert.equal((await client().login(cfg.adminEmail, cfg.adminPassword)).status, 303);
});

test('ไฟล์สินค้าไม่อยู่ในโฟลเดอร์ public', async () => {
  assert.equal((await fetch(`${base}/${fileOf('mp4_green')}`)).status, 404);
  assert.equal((await fetch(`${base}/storage/products/order-now/${fileOf('mp4_green')}`)).status, 404);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.ok(!fs.readdirSync(path.join(cfg.root, 'public'), { recursive: true }).some((f) => /prores|mp4_green|webm_alpha|still_/.test(f)));
});

test('ฐานข้อมูลรุ่นเก่า ย้ายข้อมูลได้โดยไม่หาย (grant หลายอันต่อคำสั่งซื้อ + คอลัมน์ user_id)', () => {
  const { Database } = require('../src/sqlite');
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
  // มือถือ: ฟอร์มแบ่งเป็น 5 ขั้น มีแถบปุ่มล่างและสคริปต์ทีละขั้น · ท่าเคลื่อนไหวของสินค้าส่งถึงพรีวิวสด
  assert.equal((page.match(/class="cz-step" data-step=/g) || []).length, 5);
  assert.match(page, /data-wiz-bar/); assert.match(page, /\/wizard\.js/); assert.match(page, /data-motion="(pop|drop)"/);
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
    const admin = await (await (await adminClient()).req('/admin')).text();
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

// ---------- อีเมลยืนยัน / ลืมรหัสผ่าน / กันสแปม / นโยบาย ----------

const lastMailTo = (email) => [...ctx.mailer.sent].reverse().find((m) => m.to === email);
const linkIn = (m, p) => new RegExp(`http://shop\\.test(${p}\\?t=[\\w-]+)`).exec(m.text)[1];

test('ยืนยันอีเมล: สมัครแล้วได้อีเมลลิงก์ ใช้ได้ครั้งเดียว และมีแถบเตือนจนกว่าจะยืนยัน', async () => {
  const c = await newUser('verify@example.com');
  await new Promise((r) => setTimeout(r, 20));
  const m = lastMailTo('verify@example.com');
  assert.ok(m, 'ส่งอีเมลยืนยัน');
  assert.match(m.subject, /ยืนยันอีเมล/);
  assert.match((await (await c.req('/library')).text()), /class="verify-bar"/);
  const link = linkIn(m, '/verify-email');
  // ฐานข้อมูลไม่เก็บโทเคนตรงๆ
  assert.equal(count('SELECT COUNT(*) n FROM email_tokens WHERE id = ?', new URL('http://x' + link).searchParams.get('t')), 0);
  assert.equal((await fetch(base + link.replace(/t=.{4}/, 't=AAAA'))).status, 400);
  assert.equal((await fetch(base + link)).status, 200);
  assert.ok(user('verify@example.com').email_verified_at);
  assert.equal((await fetch(base + link)).status, 400, 'ใช้ซ้ำไม่ได้');
  assert.doesNotMatch((await (await c.req('/library')).text()), /class="verify-bar"/);
  // ส่งใหม่ต้องมี CSRF
  const d = await newUser('verify2@example.com');
  assert.equal((await d.req('/verify-email/resend', { method: 'POST', form: {} })).status, 403);
  assert.equal((await d.post('/verify-email/resend')).status, 200);
  // ลิงก์ใหม่ทำให้ลิงก์เก่าใช้ไม่ได้
  const all = ctx.mailer.sent.filter((x) => x.to === 'verify2@example.com');
  assert.equal(all.length, 2);
  assert.equal((await fetch(base + linkIn(all[0], '/verify-email'))).status, 400);
  assert.equal((await fetch(base + linkIn(all[1], '/verify-email'))).status, 200);
});

test('ลืมรหัสผ่าน: ไม่บอกว่าอีเมลไหนมีบัญชี ลิงก์ใช้ครั้งเดียว หมดอายุ 30 นาที และออกจากระบบทุกเครื่อง', async () => {
  const c = await newUser('reset@example.com');
  const sidBefore = c.jar.sid;
  const anon = client();
  const n = ctx.mailer.sent.length;
  const unknown = await anon.post('/forgot', { email: 'nobody-here@example.com' });
  const known = await anon.post('/forgot', { email: 'RESET@example.com' });
  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  const msg = /ถ้าอีเมลนี้มีบัญชีอยู่[^<]*/;
  assert.equal(msg.exec(await unknown.text())[0], msg.exec(await known.text())[0], 'ข้อความเหมือนกัน');
  assert.equal(ctx.mailer.sent.length, n + 1, 'ส่งเฉพาะอีเมลที่มีบัญชี');
  const link = linkIn(lastMailTo('reset@example.com'), '/reset');
  // กดขอซ้ำทันที → ไม่ส่งเพิ่ม (กันกดรัว)
  await anon.post('/forgot', { email: 'reset@example.com' });
  assert.equal(ctx.mailer.sent.length, n + 1);
  assert.equal((await anon.req(link)).status, 200);
  const token = new URL('http://x' + link).searchParams.get('t');
  assert.equal((await anon.post('/reset', { t: token, password: 'short', password2: 'short' })).status, 400);
  assert.equal((await anon.req('/reset', { method: 'POST', form: { t: token, password: 'new-password-123', password2: 'new-password-123' } })).status, 403); // ไม่มี CSRF
  const ok = await anon.post('/reset', { t: token, password: 'new-password-123', password2: 'new-password-123' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/login?reset=1');
  assert.equal((await anon.post('/reset', { t: token, password: 'another-pass-456', password2: 'another-pass-456' })).status, 400, 'ใช้ซ้ำไม่ได้');
  // เซสชันเดิมใช้ไม่ได้ รหัสเก่าใช้ไม่ได้ รหัสใหม่ใช้ได้
  assert.equal((await fetch(`${base}/library`, { redirect: 'manual', headers: { cookie: `sid=${sidBefore}` } })).status, 303);
  assert.equal((await client().login('reset@example.com')).status, 401);
  assert.equal((await client().login('reset@example.com', 'new-password-123')).status, 303);
  assert.ok(user('reset@example.com').email_verified_at, 'รับอีเมลได้ = ยืนยันแล้ว');
  // ลิงก์หมดอายุหลัง 30 นาที
  const saved = clock;
  try {
    clock = saved + 5 * MIN;
    await anon.post('/forgot', { email: 'reset@example.com' });
    const link2 = linkIn(lastMailTo('reset@example.com'), '/reset');
    clock += 31 * MIN;
    assert.equal((await anon.req(link2)).status, 400);
  } finally { clock = saved; }
});

test('รหัสผ่านสองช่องไม่ตรง → สมัคร/ตั้งใหม่ไม่ได้ และส่งอีเมลล้มเหลวก็ตอบเหมือนเดิม (ไม่เปิดเผยว่ามีบัญชี)', async () => {
  const d = client();
  assert.equal((await d.post('/signup', { email: 'mm@example.com', password: 'correct-horse-9', password2: 'correct-horse-8', next: '/library' })).status, 400);
  assert.equal(user('mm@example.com'), undefined);
  assert.equal((await d.post('/signup', { email: 'mm@example.com', password: 'correct-horse-9', next: '/library' })).status, 303);
  const anon = client();
  const origSend = ctx.mailer.send;
  const savedClock = clock;
  clock = savedClock + 6 * 60 * MIN; // เริ่มช่วงนับลิมิตใหม่
  ctx.mailer.send = async () => { throw new Error('Brevo down'); };
  try {
    const known = await anon.post('/forgot', { email: 'mm@example.com' });
    const unknown = await anon.post('/forgot', { email: 'nobody-here@example.com' });
    assert.equal(known.status, unknown.status);
    assert.equal(known.status, 200);
  } finally { ctx.mailer.send = origSend; clock = savedClock; }
});

test('กันสแปม: ขอลิงก์ลืมรหัสผ่านถี่เกินไป → 429 และมีส่วนหัวความปลอดภัย', async () => {
  const saved = clock;
  try {
    clock = saved + 3 * 60 * MIN; // เริ่มช่วงนับใหม่
    const anon = client();
    let last;
    for (let i = 0; i < 6; i++) last = await anon.post('/forgot', { email: `spam${i}@example.com` });
    assert.equal(last.status, 429);
    assert.ok(last.headers.get('retry-after'));
  } finally { clock = saved; }
  const r = await fetch(`${base}/`);
  assert.match(r.headers.get('content-security-policy'), /object-src 'none'/);
  assert.match(r.headers.get('permissions-policy'), /camera=\(\)/);
  assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

test('หน้านโยบาย: เงื่อนไข / คืนเงิน / ความเป็นส่วนตัว มีลิงก์ท้ายเว็บและตอนซื้อ ช่องที่ยังไม่กรอกถูกทำเครื่องหมาย', async () => {
  for (const [p, h] of [['/terms', 'เงื่อนไขการใช้งาน'], ['/refund', 'นโยบายคืนเงิน'], ['/privacy', 'PDPA']]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    const html = await r.text();
    assert.match(html, new RegExp(h));
    assert.match(html, /ร้านทดสอบ จำกัด/);
    assert.match(html, /class="fill-me">\[กรอก อีเมลติดต่อ\]/);
  }
  const home = await (await fetch(`${base}/`)).text();
  assert.match(home, /href="\/terms"/);
  assert.match(home, /href="\/privacy"/);
  const c = await newUser('legal@example.com');
  assert.match(await (await c.req('/premium')).text(), /การกดซื้อถือว่ายอมรับ <a href="\/terms">/);
});

// ---------- แอปบนมือถือ (PWA) ----------

test('แอป (PWA): manifest ไอคอน service worker หน้าออฟไลน์ และไม่เก็บหน้าส่วนตัว/ไฟล์ดาวน์โหลด', async () => {
  const m = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(m.status, 200);
  assert.match(m.headers.get('content-type'), /manifest\+json/);
  const man = await m.json();
  assert.equal(man.display, 'standalone');
  assert.equal(man.short_name, 'อักษรไหว');
  assert.ok(man.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of man.icons) assert.equal((await fetch(base + i.src)).status, 200, i.src);
  assert.equal((await fetch(`${base}/icons/apple-touch-icon.png`)).status, 200);
  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get('cache-control'), 'no-cache');
  const code = await sw.text();
  assert.doesNotMatch(code, /__VERSION__/);
  // แคชได้เฉพาะไฟล์หน้าตาร้าน (ไม่มีคลัง หลังบ้าน ลิงก์ดาวน์โหลด ฟอนต์ของลูกค้า)
  const STATIC = new Function(`return (${/const STATIC = (.*);/.exec(code)[1]});`)();
  for (const p of ['/style.css', '/app.js', '/fonts/Kanit-Bold.ttf', '/icons/icon-192.png', '/offline.html']) assert.ok(STATIC.test(p), p);
  for (const p of ['/library', '/library/abc/download', '/admin', '/d/x/f/y.mp4', '/c/x/f/y.mov', '/library/fonts/abc/file', '/account', '/previews/order-now_horizontal.mp4']) assert.ok(!STATIC.test(p), p);
  assert.match(code, /req\.mode === 'navigate'[\s\S]*offline\.html/);
  assert.equal((await fetch(`${base}/offline.html`)).status, 200);
  assert.equal((await fetch(`${base}/sw.template.js`)).status, 404);
  // หัวหน้าเว็บมีลิงก์ manifest และแถบเมนูล่าง
  const home = await (await fetch(`${base}/`)).text();
  assert.match(home, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(home, /class="tabbar"/);
});

test('แท็บบัญชี: ยังไม่ล็อกอินเห็นปุ่มเข้าสู่ระบบ ล็อกอินแล้วเห็นอีเมล คลัง สไตล์ ฟอนต์ และออกจากระบบ', async () => {
  const guest = await (await client().req('/account')).text();
  assert.match(guest, /href="\/login\?next=%2Faccount"/);
  const c = await newUser('acct@example.com');
  await buy(c);
  const page = await c.req('/account');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.match(html, /acct@example\.com/);
  assert.match(html, new RegExp(`คลังของฉัน[\\s\\S]*${cfg.products.filter((p) => p.premium).length} รายการ`)); // แพ็กพรีเมียม = ทุกตัวพรีเมียม
  assert.match(html, /href="\/library\/styles"/);
  assert.match(html, /action="\/logout"/);
  assert.doesNotMatch(html, /href="\/admin"/);
});

// ---------- ปุ่มจำลองจ่าย: คนภายนอก (ผ่านลิงก์สาธารณะ) กดไม่ได้ ----------

test('โหมด mock: คนที่เข้าผ่านลิงก์สาธารณะกดจำลองจ่ายไม่ได้ (แอดมินกดได้)', async () => {
  const c = await newUser('public-mock@example.com');
  const { orderId } = await checkout(c);
  const viaTunnel = { 'x-forwarded-for': '203.0.113.7' };
  const page = await (await c.req(`/pay/mock/${orderId}`, { headers: viaTunnel })).text();
  assert.match(page, /ปุ่มจำลองจ่ายใช้ได้เฉพาะเจ้าของร้าน/);
  const r = await c.req(`/pay/mock/${orderId}/simulate`, { method: 'POST', form: { csrf: await c.csrf() }, headers: viaTunnel });
  assert.equal(r.status, 403);
  assert.equal(order(orderId).status, 'pending');
});

// ---------- Omise (เซิร์ฟเวอร์ Omise จำลอง) ----------

const omiseMod = require('../src/payments/omise');
const express = require('express');

test('Omise: ตั้งค่าคีย์ผิดหรือใช้คีย์จริงนอก production ไม่ยอมเปิดร้าน', () => {
  const baseEnv = { OMISE_PUBLIC_KEY: '', OMISE_SECRET_KEY: '', OMISE_WEBHOOK_SECRET: '', NODE_ENV: 'test', DATABASE_FILE: ':memory:', DOWNLOAD_LINK_SECRET: 'x'.repeat(40), PAYMENT_WEBHOOK_SECRET: 'y'.repeat(40) };
  assert.throws(() => loadConfig({ ...baseEnv, PAYMENT_PROVIDER: 'omise' }), /OMISE_PUBLIC_KEY/);
  assert.throws(() => loadConfig({ ...baseEnv, PAYMENT_PROVIDER: 'omise', OMISE_PUBLIC_KEY: 'pkey_5abc', OMISE_SECRET_KEY: 'skey_5abc', OMISE_WEBHOOK_SECRET: 'c2VjcmV0' }), /คีย์จริง/);
  assert.throws(() => loadConfig({ ...baseEnv, PAYMENT_PROVIDER: 'mock', OMISE_SECRET_KEY: 'skey_5live' }), /ห้ามใช้ PAYMENT_PROVIDER=mock/);
  assert.doesNotThrow(() => loadConfig({ ...baseEnv, PAYMENT_PROVIDER: 'omise', OMISE_PUBLIC_KEY: 'pkey_test_1', OMISE_SECRET_KEY: 'skey_test_1', OMISE_WEBHOOK_SECRET: 'c2VjcmV0' }));
});

test('Omise: ตรวจลายเซ็น webhook ตามคู่มือ (HMAC-SHA256 ของ timestamp.body ด้วย secret ที่ถอด base64 รองรับ 2 ลายเซ็น)', () => {
  const secret = Buffer.from('my-webhook-secret').toString('base64');
  const body = '{"object":"event","id":"evnt_test_1"}';
  const h = omiseMod.signPayload(secret, body);
  assert.doesNotThrow(() => omiseMod.verifySignature({ rawBody: body, headers: h, secret }));
  assert.doesNotThrow(() => omiseMod.verifySignature({ rawBody: body, headers: { ...h, 'omise-signature': `deadbeef,${h['omise-signature']}` }, secret }));
  assert.throws(() => omiseMod.verifySignature({ rawBody: body + ' ', headers: h, secret }), /ไม่ถูกต้อง/);
  assert.throws(() => omiseMod.verifySignature({ rawBody: body, headers: { ...h, 'omise-signature-timestamp': String(Math.floor(Date.now() / 1000) - 3600) }, secret }), /หมดอายุ/);
  assert.throws(() => omiseMod.verifySignature({ rawBody: body, headers: {}, secret }), /ไม่มีลายเซ็น/);
});

test('Omise: PromptPay QR → webhook ที่เซ็นแล้ว + ดึง charge จริง → เข้าคลัง · บัตร (สำเร็จ / ไม่สำเร็จ / 3DS) · หมดอายุ · คืนเงิน', async () => {
  // ----- เซิร์ฟเวอร์ Omise จำลอง -----
  const SKEY = 'skey_test_5xyz';
  const charges = new Map();
  let seq = 0;
  const fake = express();
  fake.use(express.urlencoded({ extended: true }));
  fake.use((req, res, next) => {
    const ok = req.headers.authorization === 'Basic ' + Buffer.from(`${SKEY}:`).toString('base64');
    if (!ok) return res.status(401).json({ object: 'error', code: 'authentication_failure', message: 'bad key' });
    next();
  });
  let fakeBase;
  fake.post('/charges', (req, res) => {
    const id = `chrg_test_${(++seq).toString(36)}x`;
    const b = req.body;
    const ch = { object: 'charge', id, livemode: false, amount: Number(b.amount), currency: String(b.currency).toLowerCase(), status: 'pending', paid: false,
      refunded_amount: 0, metadata: b.metadata || {}, failure_code: null, failure_message: null, authorize_uri: null, expires_at: b.expires_at || null, source: null };
    if (b.source && b.source.type === 'promptpay') {
      ch.source = { object: 'source', type: 'promptpay', scannable_code: { object: 'barcode', type: 'qr', image: { object: 'document', download_uri: `${fakeBase}/charges/${id}/documents/docu_test_1/downloads/qr` } } };
    } else if (b.card === 'tokn_test_ok') { ch.status = 'successful'; ch.paid = true; }
    else if (b.card === 'tokn_test_fail') { ch.status = 'failed'; ch.failure_code = 'insufficient_fund'; ch.failure_message = 'insufficient funds in the account'; }
    else if (b.card === 'tokn_test_3ds') { ch.authorize_uri = `https://api.omise.co/payments/paym_test_${id}/authorize`; ch.return_uri = b.return_uri; }
    else return res.status(400).json({ object: 'error', code: 'invalid_card', message: 'invalid card token' });
    charges.set(id, ch);
    res.json(ch);
  });
  fake.get('/charges/:id', (req, res) => (charges.has(req.params.id) ? res.json(charges.get(req.params.id)) : res.status(404).json({ object: 'error', code: 'not_found', message: 'no charge' })));
  fake.get('/charges/:id/documents/:doc/downloads/qr', (req, res) => res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9"/></svg>'));
  const fakeServer = await new Promise((r) => { const s = fake.listen(0, '127.0.0.1', () => r(s)); });
  fakeBase = `http://127.0.0.1:${fakeServer.address().port}`;

  // ----- ร้านที่ใช้ Omise -----
  const whSecret = Buffer.from('omise-test-webhook-secret').toString('base64');
  const ocfg = loadConfig({
    NODE_ENV: 'test', DATABASE_FILE: ':memory:', DOWNLOAD_LINK_SECRET: crypto.randomBytes(32).toString('hex'), PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex'),
    PAYMENT_PROVIDER: 'omise', OMISE_PUBLIC_KEY: 'pkey_test_5xyz', OMISE_SECRET_KEY: SKEY, OMISE_WEBHOOK_SECRET: whSecret, OMISE_API_BASE: fakeBase,
    MAIL_MODE: 'console', BASE_URL: 'http://shop.test', RATE_GLOBAL_PER_MIN: '0', RATE_SIGNUP_PER_HOUR: '1000', LEGAL_NAME: 'ร้านทดสอบ',
    CUSTOM_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'omise-custom-')), USER_FONT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'omise-fonts-')),
    products: testProducts(),
  });
  const octx = createApp(ocfg, { log: () => {}, renderer: fakeRenderer, renderTools });
  octx.mailer.send = async (m) => { octx.mailer.sent.push(m); };
  const shop = await new Promise((r) => { const s = octx.app.listen(0, '127.0.0.1', () => r(s)); });
  const obase = `http://127.0.0.1:${shop.address().port}`;
  const ord = (id) => octx.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);

  // ลูกค้าบนร้าน Omise
  const mk = () => {
    const jar = {};
    const req = async (p, { method = 'GET', form, headers = {} } = {}) => {
      const h = { ...headers, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
      let body;
      if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form); }
      const r = await fetch(obase + p, { method, headers: h, body, redirect: 'manual' });
      for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar[kv.slice(0, i)] = v; else delete jar[kv.slice(0, i)]; }
      return r;
    };
    const csrf = async () => { if (!jar.csrf) await req('/login'); return decodeURIComponent(jar.csrf); };
    const post = async (p, f = {}) => req(p, { method: 'POST', form: { csrf: await csrf(), ...(p === '/signup' && f.password !== undefined && f.password2 === undefined ? { password2: f.password } : {}), ...f } });
    return { req, post };
  };
  const webhook = (event, secret = whSecret) => {
    const body = JSON.stringify(event);
    return fetch(`${obase}/webhooks/payment`, { method: 'POST', headers: { 'content-type': 'application/json', ...omiseMod.signPayload(secret, body) }, body });
  };
  const newOrder = async (c) => {
    const r = await c.post('/checkout', { product: 'order-now' });
    assert.equal(r.status, 303);
    assert.match(r.headers.get('location'), /^\/pay\/omise\/[0-9a-f]+$/);
    return r.headers.get('location').split('/').pop();
  };

  try {
    const c = mk();
    assert.equal((await c.post('/signup', { email: 'omise@example.com', password: 'correct-horse-9', next: '/library' })).status, 303);

    // หน้าจ่ายเงิน: โหลด Omise.js ได้ ช่องบัตรไม่มี name (ไม่ถูกส่งมาที่ร้าน)
    const id1 = await newOrder(c);
    const pay = await c.req(`/pay/omise/${id1}`);
    assert.equal(pay.status, 200);
    assert.match(pay.headers.get('content-security-policy'), /script-src 'self' https:\/\/cdn\.omise\.co/);
    const html = await pay.text();
    assert.match(html, /<script src="https:\/\/cdn\.omise\.co\/omise\.js">/);
    assert.match(html, /data-pkey="pkey_test_5xyz"/);
    assert.doesNotMatch(html, /skey_/);
    assert.doesNotMatch(html, /<input[^>]*data-card="number"[^>]*name=/);
    assert.match(html, /name="omiseToken"/);
    assert.equal((await mk().req(`/pay/omise/${id1}`)).status, 303, 'ต้องล็อกอิน');

    // ----- PromptPay -----
    const pp = await c.post(`/pay/omise/${id1}/promptpay`);
    assert.equal(pp.status, 303);
    const chId = ord(id1).payment_ref;
    assert.match(chId, /^chrg_test_/);
    assert.equal(charges.get(chId).amount, ord(id1).amount);
    assert.equal(charges.get(chId).metadata.order_id, id1);
    assert.match(await (await c.req(`/pay/omise/${id1}?method=promptpay`)).text(), /src="\/pay\/omise\/[0-9a-f]+\/qr"/);
    const qr = await c.req(`/pay/omise/${id1}/qr`);
    assert.equal(qr.status, 200);
    assert.match(qr.headers.get('content-type'), /svg/);
    // ยังไม่จ่าย: ถามสถานะยังรอจ่าย
    assert.equal((await (await c.req(`/order/${id1}/status`)).json()).status, 'pending');
    // webhook ปลอม (ลายเซ็นผิด) → ปฏิเสธ
    assert.equal((await webhook({ object: 'event', id: 'evnt_test_bad', key: 'charge.complete', data: { id: chId } }, Buffer.from('wrong').toString('base64'))).status, 400);
    // webhook ลายเซ็นถูก แต่ข้อมูลใน event อ้างว่าจ่ายแล้วทั้งที่ charge จริงยังรอจ่าย → ไม่เชื่อ (ดึง charge จริง)
    const lie = await webhook({ object: 'event', id: 'evnt_test_lie', key: 'charge.complete', data: { id: chId, status: 'successful', paid: true } });
    assert.equal(lie.status, 200);
    assert.equal(ord(id1).status, 'pending');
    // ลูกค้าจ่ายจริง (Omise เปลี่ยนสถานะ) → webhook → จ่ายแล้ว + อีเมล + เข้าคลัง
    Object.assign(charges.get(chId), { status: 'successful', paid: true });
    const ok = await webhook({ object: 'event', id: 'evnt_test_ok1', key: 'charge.complete', data: { id: chId } });
    assert.equal((await ok.json()).result, 'paid');
    assert.equal(ord(id1).status, 'paid');
    // ส่งซ้ำ → ไม่ทำซ้ำ
    assert.equal((await (await webhook({ object: 'event', id: 'evnt_test_ok1', key: 'charge.complete', data: { id: chId } })).json()).result, 'duplicate');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(octx.mailer.sent.filter((m) => /ยืนยันการสั่งซื้อ/.test(m.subject)).length, 1);
    const kid1 = octx.db.prepare("SELECT id FROM orders WHERE user_id = ? AND product_slug = 'order-now' AND provider = 'pack' AND status = 'paid'").get(ord(id1).user_id).id;
    assert.match(await (await c.req('/library')).text(), new RegExp(`/library/${kid1}`));

    // ----- บัตร: ไม่สำเร็จ แล้วลองใหม่สำเร็จ -----
    const c2 = mk();
    await c2.post('/signup', { email: 'card@example.com', password: 'correct-horse-9', next: '/library' });
    const id2 = await newOrder(c2);
    const fail = await c2.post(`/pay/omise/${id2}/card`, { omiseToken: 'tokn_test_fail' });
    assert.equal(fail.status, 303);
    assert.match(decodeURIComponent(fail.headers.get('location')), /จ่ายด้วยบัตรไม่สำเร็จ/);
    assert.equal(ord(id2).status, 'failed');
    assert.equal((await c2.post(`/pay/omise/${id2}/card`, { omiseToken: '4242424242424242' })).status, 303); // ไม่ใช่โทเคน → ไม่ส่งไป Omise
    assert.equal(ord(id2).status, 'pending', 'ลองใหม่ได้');
    const good = await c2.post(`/pay/omise/${id2}/card`, { omiseToken: 'tokn_test_ok' });
    assert.equal(good.headers.get('location'), `/order/${id2}`);
    assert.equal(ord(id2).status, 'paid');

    // ----- บัตร 3DS: ไปหน้าธนาคาร แล้วกลับมา ร้านดึงสถานะจริงเอง -----
    const c3 = mk();
    await c3.post('/signup', { email: '3ds@example.com', password: 'correct-horse-9', next: '/library' });
    const id3 = await newOrder(c3);
    const tds = await c3.post(`/pay/omise/${id3}/card`, { omiseToken: 'tokn_test_3ds' });
    assert.match(tds.headers.get('location'), /^https:\/\/api\.omise\.co\/payments\//);
    assert.equal((await c3.req(`/pay/omise/${id3}/return`)).headers.get('location'), `/order/${id3}`);
    assert.equal(ord(id3).status, 'pending', 'กลับมาเฉยๆ ยังไม่ถือว่าจ่าย');
    Object.assign(charges.get(ord(id3).payment_ref), { status: 'successful', paid: true });
    await c3.req(`/pay/omise/${id3}/return`);
    assert.equal(ord(id3).status, 'paid');

    // ----- PromptPay หมดอายุ (ไม่มี webhook ก็รู้จากการถามสถานะ) -----
    const c4 = mk();
    await c4.post('/signup', { email: 'expire@example.com', password: 'correct-horse-9', next: '/library' });
    const id4 = await newOrder(c4);
    await c4.post(`/pay/omise/${id4}/promptpay`);
    Object.assign(charges.get(ord(id4).payment_ref), { status: 'expired' });
    assert.equal((await (await c4.req(`/order/${id4}/status`)).json()).status, 'expired');
    assert.match(await (await c4.req(`/order/${id4}`)).text(), /QR หมดอายุ/);
    assert.equal((await c4.req(`/library/${id4}`)).status, 404);

    // ----- คืนเงิน: refund.create → เอาออกจากคลัง -----
    const ch2 = charges.get(ord(id2).payment_ref);
    ch2.refunded_amount = ch2.amount;
    const rf = await webhook({ object: 'event', id: 'evnt_test_rf1', key: 'refund.create', data: { object: 'refund', id: 'rfnd_test_1', charge: ch2.id, amount: ch2.amount } });
    assert.equal((await rf.json()).result, 'refunded');
    assert.equal(ord(id2).status, 'refunded');
    assert.equal((await c2.req(`/library/${id2}`)).status, 404);
    // คืนเงินแพ็ก → ทุกตัวในแพ็กออกจากคลังด้วย
    assert.equal(octx.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND provider = 'pack' AND status = 'paid'").get(ord(id2).user_id).n, 0);
    assert.doesNotMatch(await (await c2.req('/library')).text(), /ได้จากแพ็กพรีเมียม/);

    // คนอื่นดูหน้า/QR ของคำสั่งซื้อเราไม่ได้ และปุ่มจำลองจ่ายไม่มีในโหมด Omise
    assert.equal((await c2.req(`/pay/omise/${id1}`)).status, 404);
    assert.equal((await c2.req(`/pay/omise/${id1}/qr`)).status, 404);
    assert.equal((await c.post(`/pay/mock/${id1}/simulate`)).status, 404);
  } finally {
    shop.close();
    fakeServer.close();
  }
});

// เรนเดอร์จริง 1 ไฟล์: ต้องเป็น 1080p 60fps ตรงตามแนวที่เลือก ความยาวตรง และ pix_fmt ที่เล่นได้ทั่วไป
test('ไฟล์ที่ปรับแต่งออกมาเป็น 1080p 60fps (เรนเดอร์จริง)', async (t) => {
  const tools = require('../render/tools');
  const chk = tools.checkRenderTools ? await tools.checkRenderTools() : null;
  if (chk && !chk.ok) return t.skip('ไม่มีเครื่องมือเรนเดอร์ในเครื่องนี้');
  const { spawnSync } = require('child_process');
  const { renderSingle, SINGLE_FPS } = require('../render/render');
  assert.equal(SINGLE_FPS, 60);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fps-'));
  try {
    for (const [size, w, h] of [['horizontal', 1920, 1080], ['vertical', 1080, 1920]]) {
      const out = path.join(dir, `${size}.mp4`);
      await renderSingle({ text: 'ผู้ใหญ่ก็ซื้อ', fill: '#ffffff', stroke: '#e11d48', format: 'mp4_green', size, seconds: 3, outFile: out });
      const p = spawnSync(tools.ffprobePath(), ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,pix_fmt,nb_read_frames,duration', '-of', 'json', out], { encoding: 'utf8' });
      const s = JSON.parse(p.stdout).streams[0];
      assert.equal(s.width, w); assert.equal(s.height, h);
      assert.equal(s.r_frame_rate, '60/1');
      assert.equal(s.pix_fmt, 'yuv420p');
      assert.equal(Number(s.nb_read_frames), 180);
      assert.ok(Math.abs(Number(s.duration) - 3) < 0.02);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- โอนเงินแล้วกดยืนยัน (manual) ----------
const promptpay = require('../src/promptpay');

test('PromptPay QR: โครงสร้าง EMVCo และ CRC ถูกต้อง · ตรวจรูปแบบเบอร์/เลข 13 หลัก', () => {
  const x = promptpay.payload('081-234-5678', 4937);
  assert.match(x, /^000201010212/);
  assert.ok(x.includes('0016A000000677010111') && x.includes('01130066812345678') && x.includes('5802TH') && x.includes('5303764') && x.includes('540549.37'));
  assert.equal(promptpay.crc16(x.slice(0, -4)), x.slice(-4));
  assert.ok(promptpay.payload('1234567890123', 100).includes('02131234567890123'));
  assert.throws(() => promptpay.payload('12345', 100));
  assert.equal(promptpay.normalizeId('0812345'), null);
});

test('manual: ตั้งค่า .env ผิด/ไม่ครบ ไม่ยอมเปิดร้าน', () => {
  const base = { NODE_ENV: 'test', DATABASE_FILE: ':memory:', DOWNLOAD_LINK_SECRET: 'x'.repeat(40), PAYMENT_WEBHOOK_SECRET: 'y'.repeat(40), OMISE_PUBLIC_KEY: '', OMISE_SECRET_KEY: '', OMISE_WEBHOOK_SECRET: '',
    ADMIN_EMAIL: 'a@x.test', ADMIN_PASSWORD: 'long-enough-admin-pass', PAYMENT_PROVIDER: 'manual', PROMPTPAY_ID: '', BANK_NAME: '', BANK_ACCOUNT_NO: '', BANK_ACCOUNT_NAME: '' };
  assert.throws(() => loadConfig(base), /PROMPTPAY_ID/);
  assert.throws(() => loadConfig({ ...base, PROMPTPAY_ID: '12345' }), /PROMPTPAY_ID/);
  assert.throws(() => loadConfig({ ...base, PROMPTPAY_ID: '0812345678', ADMIN_PASSWORD: '' }), /แอดมิน/);
  assert.doesNotThrow(() => loadConfig({ ...base, PROMPTPAY_ID: '0812345678' }));
  assert.doesNotThrow(() => loadConfig({ ...base, BANK_NAME: 'กสิกรไทย', BANK_ACCOUNT_NO: '123-4-56789-0', BANK_ACCOUNT_NAME: 'ร้านทดสอบ' }));
});

test('manual: ลูกค้ากดยืนยันโอน → รอตรวจสอบ (ไม่ได้สินค้า) · แอดมินอนุมัติครั้งเดียวจึงเข้าคลัง · อนุมัติซ้ำไม่ได้ · คนนอก/ลูกค้าเข้าคิวไม่ได้', async () => {
  let t = Date.now();
  const mcfg = loadConfig({
    NODE_ENV: 'test', DATABASE_FILE: ':memory:', DOWNLOAD_LINK_SECRET: crypto.randomBytes(32).toString('hex'), PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex'),
    PAYMENT_PROVIDER: 'manual', PROMPTPAY_ID: '0812345678', PROMPTPAY_NAME: 'ร้านทดสอบ', BANK_NAME: 'ธนาคารทดสอบ', BANK_ACCOUNT_NO: '123-4-56789-0', BANK_ACCOUNT_NAME: 'ร้านทดสอบ', MANUAL_EXPIRE_HOURS: '24',
    MANUAL_UNIQUE_SATANG: '1',
    ADMIN_EMAIL: 'boss@shop.test', ADMIN_PASSWORD: 'boss-password-12345', MAIL_MODE: 'console', BASE_URL: 'http://shop.test', RATE_GLOBAL_PER_MIN: '0', RATE_SIGNUP_PER_HOUR: '1000', LEGAL_NAME: 'ร้านทดสอบ',
    OMISE_PUBLIC_KEY: '', OMISE_SECRET_KEY: '', OMISE_WEBHOOK_SECRET: '',
    CUSTOM_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'man-custom-')), USER_FONT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'man-fonts-')),
    products: testProducts(),
  });
  const mctx = createApp(mcfg, { now: () => t, log: () => {}, renderer: fakeRenderer, renderTools });
  mctx.mailer.send = async (m) => { mctx.mailer.sent.push(m); };
  const srv = await new Promise((r) => { const s = mctx.app.listen(0, '127.0.0.1', () => r(s)); });
  const mbase = `http://127.0.0.1:${srv.address().port}`;
  const ord = (id) => mctx.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  const mk = () => {
    const jar = {};
    const req = async (p, { method = 'GET', form, headers = {} } = {}) => {
      const h = { ...headers, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
      let body;
      if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form); }
      const r = await fetch(mbase + p, { method, headers: h, body, redirect: 'manual' });
      for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar[kv.slice(0, i)] = v; else delete jar[kv.slice(0, i)]; }
      return r;
    };
    const csrf = async () => { if (!jar.csrf) await req('/login'); return decodeURIComponent(jar.csrf); };
    const post = async (p, f = {}) => req(p, { method: 'POST', form: { csrf: await csrf(), ...(p === '/signup' && f.password !== undefined && f.password2 === undefined ? { password2: f.password } : {}), ...f } });
    return { req, post };
  };
  try {
    const alice = mk(); const bob = mk(); const boss = mk();
    await alice.post('/signup', { email: 'alice@example.com', password: 'correct-horse-9', next: '/library' });
    await bob.post('/signup', { email: 'bob@example.com', password: 'correct-horse-9', next: '/library' });
    assert.equal((await boss.post('/login', { email: 'boss@shop.test', password: 'boss-password-12345', next: '/admin' })).status, 303);

    // สั่งซื้อ → หน้าโอนเงิน มียอดไม่ซ้ำ รหัสอ้างอิง QR และเลขบัญชี (ข้อมูลรับเงินมาจาก config)
    const co = await alice.post('/checkout', { product: 'order-now' });
    assert.match(co.headers.get('location'), /^\/pay\/transfer\/[0-9a-f]{32}$/);
    const id = co.headers.get('location').split('/').pop();
    const o1 = ord(id);
    assert.equal(o1.status, 'pending');
    assert.ok(o1.transfer_amount > o1.amount && o1.transfer_amount < o1.amount + 100, 'ยอดโอน = ราคา + 1–99 สตางค์');
    assert.match(o1.pay_ref, /^AW-[A-Z2-9]{6}$/);
    const page = await (await alice.req(co.headers.get('location'))).text();
    assert.match(page, new RegExp(`฿${(o1.transfer_amount / 100).toFixed(2).replace('.', '\\.')}`));
    assert.ok(page.includes(o1.pay_ref) && page.includes('123-4-56789-0') && page.includes('ยืนยันการโอนเงิน') && page.includes(`/pay/transfer/${id}/qr`));
    assert.ok(!/type="file"/.test(page), 'ไม่มีการแนบสลิป');
    const qr = await alice.req(`/pay/transfer/${id}/qr`);
    assert.equal(qr.status, 200); assert.match(qr.headers.get('content-type'), /svg/); assert.match(await qr.text(), /<svg/);
    // คนอื่นดูหน้า/QR/สถานะของเราไม่ได้
    assert.equal((await bob.req(`/pay/transfer/${id}`)).status, 404);
    assert.equal((await bob.req(`/pay/transfer/${id}/qr`)).status, 404);
    // ปุ่มบันทึกรูป QR (PNG) สำหรับจ่ายจากมือถือเครื่องเดียวกัน · คนอื่นโหลดไม่ได้
    assert.ok(page.includes(`/pay/transfer/${id}/qr.png`) && page.includes('บันทึกรูป QR'));
    const png = await alice.req(`/pay/transfer/${id}/qr.png`);
    assert.equal(png.status, 200); assert.equal(png.headers.get('content-type'), 'image/png');
    assert.match(png.headers.get('content-disposition'), /attachment; filename="QR-/);
    assert.equal(Buffer.from(await png.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
    assert.equal((await bob.req(`/pay/transfer/${id}/qr.png`)).status, 404);
    assert.equal((await bob.post(`/pay/transfer/${id}/confirm`, { sure: '1' })).status, 404);
    // สั่งซ้ำสินค้าเดิม = ใช้ออเดอร์เดิม (ค้างได้ 1 ออเดอร์ต่อสินค้าต่อบัญชี)
    assert.equal((await alice.post('/checkout', { product: 'order-now' })).headers.get('location'), `/pay/transfer/${id}`);
    assert.equal(mctx.db.prepare("SELECT COUNT(*) n FROM orders WHERE user_id = ?").get(o1.user_id).n, 1);
    // หน้าชำระเงินมีแค่ QR + ปุ่มยืนยัน ไม่มีช่องให้กรอก/ติ๊ก (ถามยืนยันด้วยกล่องเด้งก่อนส่ง)
    assert.ok(!/name="transfer_time"/.test(page) && !/name="sure"/.test(page), 'ไม่มีช่องเวลา/ช่องติ๊ก');
    assert.match(page, /data-confirm-title="โอนเงินแล้วใช่ไหม\?"/);

    // ยอดโอนของสองบัญชีไม่ซ้ำกัน
    const co2 = await bob.post('/checkout', { product: 'order-now' });
    const o2 = ord(co2.headers.get('location').split('/').pop());
    assert.notEqual(o2.transfer_amount, o1.transfer_amount);

    // ลูกค้ากดยืนยันโอน → รอตรวจสอบ แต่ "ไม่ได้สินค้า"
    t += 60000;
    const cf = await alice.post(`/pay/transfer/${id}/confirm`);
    assert.equal(cf.headers.get('location'), `/order/${id}`);
    const o1r = ord(id);
    assert.equal(o1r.status, 'review'); assert.ok(!o1r.transfer_time); assert.equal(o1r.paid_at, null);
    // ร้านได้อีเมลแจ้ง: สินค้า ยอด รหัสอ้างอิง เลขออเดอร์ อีเมลลูกค้า ลิงก์หลังบ้าน
    await new Promise((r) => setImmediate(r));
    const shopMail = mctx.mailer.sent.filter((m) => m.to === 'boss@shop.test').at(-1);
    assert.ok(shopMail, 'ส่งอีเมลแจ้งร้าน');
    assert.match(shopMail.subject, /^\[แจ้งโอน\]/); assert.ok(shopMail.subject.includes(o1.pay_ref));
    for (const x of [o1.pay_ref, id, 'alice@example.com', 'http://shop.test/admin/transfers', `฿${(o1.transfer_amount / 100).toFixed(2)}`]) assert.ok(shopMail.text.includes(x), x);
    assert.equal((await alice.req(`/library/${id}`)).status, 404, 'ยังไม่อนุมัติ = ยังไม่มีในคลัง');
    assert.match(await (await alice.req(`/order/${id}`)).text(), /รอร้านตรวจสอบ/);
    // คลังแสดงคำสั่งซื้อที่ยังไม่เสร็จ พร้อมลิงก์กลับไปทำต่อ (ของใครของมัน)
    const aliceLib = await (await alice.req('/library')).text();
    assert.ok(aliceLib.includes('คำสั่งซื้อที่ยังไม่เสร็จ') && aliceLib.includes(`href="/order/${id}"`) && aliceLib.includes('รอร้านตรวจสอบ'));
    const bobLib = await (await bob.req('/library')).text();
    assert.ok(bobLib.includes(`href="/pay/transfer/${o2.id}"`) && bobLib.includes('รอโอนเงิน') && !bobLib.includes(id));
    // เงื่อนไขการใช้งานบอกขั้นตอนโอน + ร้านอนุมัติ (ไม่ใช่ "เข้าคลังทันที")
    const pd = await (await alice.req('/p/order-now')).text();
    assert.ok(!pd.includes('ได้ไฟล์ทันทีหลังชำระเงิน') && pd.includes('ร้านยืนยันยอด'), 'หน้าสินค้าไม่สัญญาว่าได้ทันทีในโหมดโอนเอง');
    const terms = await (await alice.req('/terms')).text();
    assert.match(terms, /PromptPay/); assert.match(terms, /เมื่อร้านอนุมัติ/);
    assert.equal((await (await alice.req(`/order/${id}/status`)).json()).status, 'review');
    assert.ok(mctx.mailer.sent.some((m) => m.to === 'alice@example.com' && /รอตรวจสอบ/.test(m.subject)), 'แจ้งลูกค้าว่ารับแจ้งแล้ว');
    assert.ok(mctx.mailer.sent.some((m) => m.to === 'boss@shop.test' && m.text.includes(o1r.pay_ref)), 'แจ้งแอดมิน');
    // ลูกค้าอนุมัติเอง/ปลอม webhook/ใช้ปุ่ม mock ไม่ได้
    assert.equal((await alice.post(`/admin/transfers/${id}/approve`)).status, 404);
    assert.equal((await alice.req('/admin/transfers')).status, 404);
    assert.equal((await alice.post(`/pay/mock/${id}/simulate`)).status, 404);
    assert.equal((await fetch(`${mbase}/webhooks/payment`, { method: 'POST', body: JSON.stringify({ type: 'payment.succeeded', orderId: id }) })).status, 400);
    assert.equal((await alice.post(`/pay/transfer/${id}/confirm`, { sure: '1' })).headers.get('location'), `/order/${id}`); // กดซ้ำไม่เปลี่ยนอะไร
    assert.equal(ord(id).confirm_count, 1);
    assert.equal(ord(id).status, 'review');
    // คนไม่ได้ล็อกอินเข้าคิวไม่ได้ (พาไปล็อกอิน) · อนุมัติโดยไม่มี CSRF ไม่ได้
    assert.equal((await mk().req('/admin/transfers')).status, 303);
    assert.equal((await boss.req(`/admin/transfers/${id}/approve`, { method: 'POST', form: {} })).status, 403);
    assert.equal(ord(id).status, 'review');

    // แอดมินเห็นคิว: ยอด รหัส เวลา ลูกค้า
    const q1 = await (await boss.req('/admin/transfers')).text();
    assert.ok(q1.includes(o1r.pay_ref) && q1.includes(`฿${(o1r.transfer_amount / 100).toFixed(2)}`) && q1.includes('alice@example.com') && q1.includes('กดยืนยันโอนเมื่อ'));
    assert.ok(!q1.includes(o2.pay_ref), 'ออเดอร์ที่ยังไม่แจ้งโอนไม่อยู่ในคิว');

    // ปฏิเสธ (ต้องมีเหตุผล) → ลูกค้าเห็นเหตุผลและแจ้งใหม่ได้
    assert.match((await boss.post(`/admin/transfers/${id}/reject`, { reason: 'x' })).headers.get('location'), /problem=reason/);
    assert.match((await boss.post(`/admin/transfers/${id}/reject`, { reason: 'ไม่พบรายการโอนยอดนี้' })).headers.get('location'), /done=rejected/);
    assert.equal(ord(id).status, 'rejected');
    assert.match(await (await alice.req(`/order/${id}`)).text(), /ไม่พบรายการโอนยอดนี้/);
    assert.match(await (await alice.req(`/pay/transfer/${id}`)).text(), /ไม่พบรายการโอนยอดนี้/);
    assert.ok(mctx.mailer.sent.some((m) => m.to === 'alice@example.com' && /ยังไม่พบรายการโอน/.test(m.subject)));
    assert.equal((await alice.req(`/library/${id}`)).status, 404);
    // ปฏิเสธไปแล้ว อนุมัติ/ปฏิเสธซ้ำไม่ได้จนกว่าลูกค้าจะแจ้งใหม่
    assert.match((await boss.post(`/admin/transfers/${id}/approve`)).headers.get('location'), /problem=handled/);

    // แจ้งใหม่ → อนุมัติ → เข้าคลังครั้งเดียว
    t += 60000;
    await alice.post(`/pay/transfer/${id}/confirm`, { sure: '1' });
    assert.equal(ord(id).status, 'review'); assert.equal(ord(id).confirm_count, 2);
    const sentBefore = mctx.mailer.sent.length;
    assert.match((await boss.post(`/admin/transfers/${id}/approve`)).headers.get('location'), /done=approved/);
    const done = ord(id);
    assert.equal(done.status, 'paid'); assert.ok(done.paid_at); assert.ok(done.reviewed_by);
    const kid = mctx.db.prepare("SELECT id FROM orders WHERE user_id = ? AND product_slug = 'order-now' AND provider = 'pack' AND status = 'paid'").get(done.user_id).id;
    assert.equal((await alice.req(`/library/${kid}`)).status, 200, 'อนุมัติแล้ว ทุกตัวในแพ็กเข้าคลัง');
    assert.equal((await alice.req(`/library/${id}`)).status, 404, 'แพ็กเองไม่ใช่รายการในคลัง');
    assert.match(await (await alice.req(`/order/${id}`)).text(), /ชำระเงินสำเร็จ/);
    assert.ok(mctx.mailer.sent.slice(sentBefore).some((m) => m.to === 'alice@example.com' && /ยืนยันการสั่งซื้อ/.test(m.subject)), 'ส่งใบยืนยันตอนอนุมัติ');
    // อนุมัติซ้ำ (กดสองครั้ง/สองแท็บ) ไม่ทำอะไรเพิ่ม ไม่ส่งอีเมลซ้ำ
    const sentAfter = mctx.mailer.sent.length;
    assert.match((await boss.post(`/admin/transfers/${id}/approve`)).headers.get('location'), /problem=handled/);
    assert.equal(mctx.mailer.sent.length, sentAfter);
    assert.equal(ord(id).paid_at, done.paid_at);
    // ซื้อสินค้าที่มีแล้ว → ไปที่คลังเลย
    assert.equal((await alice.post('/checkout', { product: 'order-now' })).headers.get('location'), `/library/${kid}`);
    // ลูกค้าอื่นเข้าคลังของเราไม่ได้
    assert.equal((await bob.req(`/library/${kid}`)).status, 404);

    // audit log: ใครทำอะไรเมื่อไหร่
    const log = mctx.db.prepare('SELECT action, actor_email FROM payment_audit WHERE order_id = ? ORDER BY id').all(id).map((r) => `${r.action}:${r.actor_email}`);
    assert.deepEqual(log, ['customer_confirm:alice@example.com', 'reject:boss@shop.test', 'customer_confirm:alice@example.com', 'approve:boss@shop.test']);
    assert.match(await (await boss.req('/admin/transfers')).text(), /audit log/);

    // กดยืนยันถี่เกิน/ครบจำนวนครั้ง → ถูกจำกัด (ออเดอร์ของ bob)
    const o2id = o2.id;
    // ระบบอีเมลล่ม (โยน error ทันที / ส่งไม่สำเร็จทีหลัง) ลูกค้ายังกดยืนยันโอนได้ตามปกติ
    const goodSend = mctx.mailer.send;
    let fails = 0;
    mctx.mailer.send = () => { if (fails++ % 2) throw new Error('mail down'); return Promise.reject(new Error('mail down')); };
    for (let i = 0; i < 5; i++) {
      assert.equal((await bob.post(`/pay/transfer/${o2id}/confirm`, { sure: '1' })).status, 303);
      if (i < 4) { await boss.post(`/admin/transfers/${o2id}/reject`, { reason: 'ไม่พบรายการ' }); t += 1000; }
    }
    assert.ok(fails >= 5);
    mctx.mailer.send = goodSend;
    await boss.post(`/admin/transfers/${o2id}/reject`, { reason: 'ไม่พบรายการ' });
    const over = await bob.post(`/pay/transfer/${o2id}/confirm`, { sure: '1' });
    assert.ok([400, 429].includes(over.status), 'แจ้งเกินจำนวนครั้งต่อออเดอร์/ต่อชั่วโมงไม่ได้');
    assert.equal(ord(o2id).status, 'rejected');

    // หมดอายุ: ไม่โอน/ถูกปฏิเสธแล้วเงียบ เกิน 24 ชม. → expired และยอดโอนว่างให้ออเดอร์ใหม่
    t += 25 * 60 * 60 * 1000;
    assert.match(await (await bob.req(`/order/${o2id}`)).text(), /ออเดอร์หมดอายุ/);
    assert.equal(ord(o2id).status, 'expired');
    assert.equal((await bob.post(`/pay/transfer/${o2id}/confirm`, { sure: '1' })).status, 400);
    const co3 = await bob.post('/checkout', { product: 'order-now' });
    assert.notEqual(co3.headers.get('location').split('/').pop(), o2id, 'หมดอายุแล้วสั่งใหม่ได้ ได้ออเดอร์ใหม่');
    assert.ok(mctx.db.prepare("SELECT 1 FROM payment_audit WHERE order_id = ? AND action = 'expire'").get(o2id));
  } finally { srv.close(); }
});

test('manual: ร้านโหมดอื่นไม่มีหน้าโอนเงิน/คิวอนุมัติ', async () => {
  const c = await newUser('notmanual@example.com');
  assert.equal((await c.req('/pay/transfer/abc')).status, 404);
  assert.equal((await c.req('/admin/transfers')).status, 404);
});

// ถอดรหัส QR จากรูป SVG จริง (ไม่ใช่แค่ดูข้อความ) แล้วตรวจฟิลด์ยอดเงินและ CRC
function decodeQrSvg(svg) {
  const jsQR = require('jsqr');
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/); const n = Number(vb[1]);
  const dark = new Set();
  const d = svg.match(/<path stroke="#000000" d="([^"]+)"/)[1];
  let x = 0, y = 0;
  for (const m of d.matchAll(/([Mmh])\s*([-\d.]+)(?:[\s,]+([-\d.]+))?/g)) {
    if (m[1] === 'M') { x = Number(m[2]); y = Number(m[3]); } else if (m[1] === 'm') { x += Number(m[2]); y += Number(m[3] || 0); } else { for (let i = 0; i < Number(m[2]); i++) dark.add(`${Math.floor(x + i)},${Math.floor(y)}`); x += Number(m[2]); }
  }
  const S = 6, W = n * S, px = new Uint8ClampedArray(W * W * 4).fill(255);
  for (const k of dark) { const [cx, cy] = k.split(',').map(Number); for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) { const o = ((cy * S + b) * W + cx * S + a) * 4; px[o] = px[o + 1] = px[o + 2] = 0; } }
  const r = jsQR(px, W, W);
  return r && r.data;
}
function tlvParse(str) { const o = {}; for (let i = 0; i < str.length;) { const id = str.slice(i, i + 2); const len = Number(str.slice(i + 2, i + 4)); o[id] = str.slice(i + 4, i + 4 + len); i += 4 + len; } return o; }

test('QR PromptPay: ถอดรหัสจากรูปจริงแล้วยอดตรงราคา (50.00) มี CRC ถูก และเบอร์ผู้รับตรงกับที่ตั้ง', async () => {
  for (const [amountSatang, expect] of [[5000, '50.00'], [4900, '49.00'], [12345, '123.45']]) {
    const decoded = decodeQrSvg(await promptpay.svg('081-234-5678', amountSatang));
    assert.equal(decoded, promptpay.payload('0812345678', amountSatang));
    const f = tlvParse(decoded);
    assert.equal(f['54'], expect, 'ฟิลด์ยอดเงิน');
    assert.equal(f['53'], '764'); assert.equal(f['58'], 'TH'); assert.equal(f['01'], '12', 'QR แบบกำหนดยอด (dynamic)');
    assert.equal(promptpay.crc16(decoded.slice(0, -4)), f['63'], 'CRC');
    assert.equal(tlvParse(f['29'])['01'], '0066812345678');
  }
});

test('manual (ค่าเริ่มต้น ไม่บวกสตางค์): ยอดโอน = ราคาเป๊ะ · ต้องกรอกเวลาโอน · แอดมินเห็นเตือนออเดอร์ยอดเท่ากัน · QR ที่ลูกค้าสแกนยอดตรงราคา', async () => {
  let t = Date.now();
  const mcfg = loadConfig({
    NODE_ENV: 'test', DATABASE_FILE: ':memory:', DOWNLOAD_LINK_SECRET: crypto.randomBytes(32).toString('hex'), PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex'),
    PAYMENT_PROVIDER: 'manual', PROMPTPAY_ID: '0812345678', MANUAL_UNIQUE_SATANG: '',
    ADMIN_EMAIL: 'boss@shop.test', ADMIN_PASSWORD: 'boss-password-12345', MAIL_MODE: 'console', BASE_URL: 'http://shop.test', RATE_GLOBAL_PER_MIN: '0', RATE_SIGNUP_PER_HOUR: '1000', LEGAL_NAME: 'ร้านทดสอบ',
    OMISE_PUBLIC_KEY: '', OMISE_SECRET_KEY: '', OMISE_WEBHOOK_SECRET: '',
    CUSTOM_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'man2-custom-')), USER_FONT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'man2-fonts-')),
    products: testProducts(),
  });
  assert.equal(mcfg.transfer.uniqueSatang, false);
  const mctx = createApp(mcfg, { now: () => t, log: () => {}, renderer: fakeRenderer, renderTools });
  mctx.mailer.send = async (m) => { mctx.mailer.sent.push(m); };
  const srv = await new Promise((r) => { const s = mctx.app.listen(0, '127.0.0.1', () => r(s)); });
  const mbase = `http://127.0.0.1:${srv.address().port}`;
  const ord = (id) => mctx.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  const mk = () => {
    const jar = {};
    const req = async (p, { method = 'GET', form } = {}) => {
      const h = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
      let body; if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form); }
      const r = await fetch(mbase + p, { method, headers: h, body, redirect: 'manual' });
      for (const sc of r.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar[kv.slice(0, i)] = v; else delete jar[kv.slice(0, i)]; }
      return r;
    };
    const post = async (p, f = {}) => { if (!jar.csrf) await req('/login'); return req(p, { method: 'POST', form: { csrf: decodeURIComponent(jar.csrf), ...(p === '/signup' && f.password !== undefined && f.password2 === undefined ? { password2: f.password } : {}), ...f } }); };
    return { req, post };
  };
  try {
    const a = mk(); const b = mk(); const boss = mk();
    await a.post('/signup', { email: 'a@example.com', password: 'correct-horse-9', next: '/library' });
    await b.post('/signup', { email: 'b@example.com', password: 'correct-horse-9', next: '/library' });
    await boss.post('/login', { email: 'boss@shop.test', password: 'boss-password-12345', next: '/admin' });
    const ida = (await a.post('/checkout', { product: 'order-now' })).headers.get('location').split('/').pop();
    const idb = (await b.post('/checkout', { product: 'order-now' })).headers.get('location').split('/').pop();
    assert.equal(ord(ida).transfer_amount, 15000); assert.equal(ord(idb).transfer_amount, 15000); // แพ็กพรีเมียม ฿150
    assert.notEqual(ord(ida).pay_ref, ord(idb).pay_ref);
    const page = await (await a.req(`/pay/transfer/${ida}`)).text();
    assert.match(page, /฿150\.00/); assert.ok(!/name="transfer_time"/.test(page), 'ไม่ต้องกรอกเวลาโอน');
    // QR ที่ลูกค้าสแกน: ถอดรหัสจากรูปแล้วยอดต้องเป็น 150.00 (ราคาแพ็ก)
    const qr = await (await a.req(`/pay/transfer/${ida}/qr`)).text();
    assert.equal(tlvParse(decodeQrSvg(qr))['54'], '150.00');
    // กดปุ่มยืนยันอย่างเดียว (ไม่กรอกเวลา) → รอตรวจสอบ
    t += 60000; assert.equal((await a.post(`/pay/transfer/${ida}/confirm`)).headers.get('location'), `/order/${ida}`);
    assert.equal(ord(ida).status, 'review');
    // ระหว่างที่ b ยังไม่แจ้ง แอดมินเห็นเตือนว่ามีออเดอร์ยอดเท่ากันรออยู่
    let qpage = await (await boss.req('/admin/transfers')).text();
    assert.match(qpage, /มีออเดอร์ยอดเท่ากันอีก 1 รายการ/); assert.ok(qpage.includes('b@example.com') && qpage.includes('ยังไม่แจ้งโอน'));
    t += 60000; await b.post(`/pay/transfer/${idb}/confirm`);
    qpage = await (await boss.req('/admin/transfers')).text();
    assert.equal((qpage.match(/<b>ระวัง: มีออเดอร์ยอดเท่ากันอีก 1 รายการ<\/b>/g) || []).length, 2, 'ทั้งสองใบเห็นเตือนซึ่งกันและกัน');
    assert.match(qpage, /เทียบกับเวลาที่ลูกค้ากดยืนยัน/); // แยกออเดอร์ยอดเท่ากันด้วยเวลาที่กดยืนยัน
    assert.ok(qpage.indexOf(ord(ida).pay_ref) < qpage.indexOf(`<span class="xfer-code">${ord(idb).pay_ref}`), 'ใบที่กดยืนยันก่อนอยู่บนสุด');
    // อนุมัติทีละใบ ไม่ปนกัน
    await boss.post(`/admin/transfers/${ida}/approve`);
    assert.equal(ord(ida).status, 'paid'); assert.equal(ord(idb).status, 'review');
  } finally { srv.close(); }
});

test('BASE_URL เป็น https แต่เปิดผ่าน http://localhost: คุกกี้ไม่ติด Secure (เข้าสู่ระบบได้) · ผ่านอุโมงค์ https ติด Secure', async () => {
  const hcfg = loadConfig({
    NODE_ENV: 'test', DATABASE_FILE: ':memory:', DOWNLOAD_LINK_SECRET: 'x'.repeat(40), PAYMENT_WEBHOOK_SECRET: 'y'.repeat(40),
    OMISE_PUBLIC_KEY: '', OMISE_SECRET_KEY: '', OMISE_WEBHOOK_SECRET: '', MAIL_MODE: 'console', BASE_URL: 'https://shop.example', RATE_GLOBAL_PER_MIN: '0',
    CUSTOM_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sec-custom-')), USER_FONT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sec-fonts-')),
  });
  const hctx = createApp(hcfg, { log: () => {}, renderer: fakeRenderer, renderTools });
  const srv = await new Promise((r) => { const s = hctx.app.listen(0, '127.0.0.1', () => r(s)); });
  const hb = `http://127.0.0.1:${srv.address().port}`;
  try {
    const plain = await fetch(`${hb}/login`);
    const pc = plain.headers.getSetCookie().find((c) => c.startsWith('csrf='));
    assert.ok(pc && !/;\s*Secure/i.test(pc), 'http ตรงๆ ไม่ติด Secure');
    assert.equal(plain.headers.get('strict-transport-security'), null);
    const viaTunnel = await fetch(`${hb}/login`, { headers: { 'x-forwarded-proto': 'https' } });
    assert.match(viaTunnel.headers.getSetCookie().find((c) => c.startsWith('csrf=')), /;\s*Secure/i);
    assert.ok(viaTunnel.headers.get('strict-transport-security'));
    // สมัครแล้วใช้คุกกี้ต่อผ่าน http ได้จริง
    const csrf = decodeURIComponent(pc.split(';')[0].split('=')[1]);
    const su = await fetch(`${hb}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `csrf=${csrf}` }, body: new URLSearchParams({ csrf, email: 'sec@example.com', password: 'correct-horse-9', password2: 'correct-horse-9', next: '/library' }) });
    const sid = su.headers.getSetCookie().find((c) => c.startsWith('sid='));
    assert.ok(sid && !/;\s*Secure/i.test(sid));
    assert.equal((await fetch(`${hb}/library`, { redirect: 'manual', headers: { cookie: sid.split(';')[0] } })).status, 200);
  } finally { srv.close(); }
});


// ---------------- ของฟรี และ แอนิเมชันพรีเมียม ----------------
test('ร้านจริง: "สั่งซื้อเลย" กับ "กดติดตามเลย" ฟรี ส่วนแบบพรีเมียมมีราคาและใช้ท่าพรีเมียม', () => {
  const by = Object.fromEntries(REAL_PRODUCTS.map((p) => [p.slug, p]));
  assert.equal(by['order-now'].price, 0);
  assert.equal(by['follow-now'].price, 0);
  require('../public/motion.js');
  const premium = REAL_PRODUCTS.filter((p) => p.price > 0);
  assert.ok(premium.length >= 2);
  for (const p of premium) {
    assert.ok(globalThis.TTMotion.meta(p.motion).premium, `${p.slug} ต้องใช้ท่าพรีเมียม`);
    assert.ok(p.price >= 4900 && p.price <= 9900, `${p.slug} ราคา ${p.price}`);
    // ไฟล์ครบทุกฟอร์แมต ทั้งสองขนาด
    const mf = JSON.parse(fs.readFileSync(path.join(cfg.storageDir, p.slug, 'manifest.json'), 'utf8'));
    assert.equal(mf.motion, p.motion);
    assert.equal(mf.fps, 60);
    for (const size of ['vertical', 'horizontal']) {
      // แบบที่เรนเดอร์ด้วย --no-prores ไม่มี ProRes สำเร็จรูป (ลูกค้าได้ ProRes จากหน้าปรับแต่ง) · แบบเดิม 3 แบบต้องมีครบ
      const light = !mf.files.some((x) => x.format === 'prores4444');
      assert.ok(!light || !['cinema-title', 'neon-sign', 'word-pop'].includes(p.slug), `${p.slug} ต้องมี ProRes`);
      for (const fmt of ['mp4_green', 'mp4_black', 'prores4444', 'webm_alpha', 'still_png'].filter((x) => !light || x !== 'prores4444')) {
        const f = mf.files.find((x) => x.format === fmt && x.size === size);
        assert.ok(f && fs.statSync(path.join(cfg.storageDir, p.slug, f.file)).size === f.bytes, `${p.slug} ${fmt} ${size}`);
      }
    }
    for (const v of ['vertical', 'horizontal']) for (const ext of ['jpg', 'mp4']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'previews', `${p.slug}_${v}.${ext}`)));
  }
});

test('ของฟรี: กดรับ → เข้าคลังทันที ไม่มีหน้าจ่ายเงิน ไม่มีอีเมลใบเสร็จ กดซ้ำได้รายการเดิม', async () => {
  const anon = client();
  const pd = await (await anon.req('/p/follow-now')).text();
  assert.match(pd, /ฟรี/);
  assert.match(pd, /เข้าสู่ระบบเพื่อรับฟรี/);
  const home = await (await anon.req('/')).text();
  assert.match(home, /class="badge-free">ฟรี</);
  assert.match(home, /class="badge-premium">/);
  // หน้าแรกแบบแอป: ใส่ซับเป็นปุ่มหลัก มีในแถบบน แถบล่างมือถือ และแถบแพ็กพรีเมียม
  assert.match(home, /<a href="\/subtitles" class="nav-sub">/);
  assert.match(home, /<a href="\/subtitles" data-tab="subs"/);
  assert.match(home, /class="tool tool-main" href="\/subtitles"/);
  assert.match(home, /class="pack-banner" href="\/premium"[\s\S]*?แพ็กพรีเมียม ฿150/);
  // หน้าแรก: กรองฟรี/พรีเมียมได้ การ์ดมีราคาและปุ่มชัด
  assert.match(home, /data-cat-btn="free">ฟรี</);
  assert.match(home, /data-cat-btn="premium">พรีเมียม</);
  assert.match(home, /<span class="card-cta">รับฟรี ›<\/span>/);
  assert.match(home, /<span class="card-cta">ดูตัวอย่าง ›<\/span>/);
  assert.match(home, /<span class="price">แพ็ก ฿150<\/span>/);
  assert.doesNotMatch(home, /class="marquee"|data-type-rotate|class="hero-bg"/, 'ไม่มีแถบวิ่ง ตัวพิมพ์ หรือพื้นหลังเบลอ');

  const c = await newUser('free@example.com');
  const page = await (await c.req('/p/follow-now')).text();
  assert.match(page, /รับฟรีเข้าคลัง/);
  assert.doesNotMatch(page, /นโยบายคืนเงิน<\/a><\/p>/);
  const sent = ctx.mailer.sent.length;
  const r = await c.post('/checkout', { product: 'follow-now' });
  assert.equal(r.status, 303);
  const loc = r.headers.get('location');
  assert.match(loc, /^\/library\/[0-9a-f]{32}\?claimed=1$/);
  const id = loc.split('/').pop().split('?')[0];
  const o = order(id);
  assert.equal(o.status, 'paid');
  assert.equal(o.amount, 0);
  assert.equal(o.provider, 'free');
  assert.equal(ctx.mailer.sent.length, sent, 'ของฟรีไม่ส่งอีเมลใบเสร็จ');
  const lib = await (await c.req(loc)).text();
  assert.match(lib, /ได้รับแล้ว ฟรี!/);
  assert.match(lib, /รับฟรีเมื่อ/);
  // กดซ้ำ: ไม่สร้างรายการใหม่
  const again = await c.post('/checkout', { product: 'follow-now' });
  assert.equal(again.headers.get('location'), `/library/${id}`);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE product_slug = 'follow-now' AND email = 'free@example.com'").get().n, 1);
  // ยังต้องมี CSRF
  const noCsrf = await c.req('/checkout', { method: 'POST', form: { product: 'follow-now' } });
  assert.equal(noCsrf.status, 403);
  // ไม่ต้องล็อกอิน = ไม่ได้รับ
  assert.match((await anon.post('/checkout', { product: 'follow-now' })).headers.get('location'), /^\/login\?next=/);
});

test('ราคาใน config: ติดลบหรือไม่ใช่จำนวนเต็มไม่ได้ · 0 = ฟรี', () => {
  const env = { NODE_ENV: 'test', DATABASE_FILE: ':memory:', PAYMENT_PROVIDER: 'mock', MAIL_MODE: 'console', BASE_URL: 'http://x.test',
    DOWNLOAD_LINK_SECRET: 'a'.repeat(64), PAYMENT_WEBHOOK_SECRET: 'b'.repeat(64) };
  const one = (price) => [{ ...REAL_PRODUCTS.find((p) => p.slug === 'order-now'), price }];
  assert.throws(() => loadConfig({ ...env, products: one(-100) }), /price/);
  assert.throws(() => loadConfig({ ...env, products: one(49.5) }), /price/);
  assert.throws(() => loadConfig({ ...env, products: one(500) }), /ราคาต่ำสุด/);
  assert.equal(loadConfig({ ...env, products: one(0) }).products[0].free, true);
});

test('แพ็กพรีเมียม: แท็ก "พรีเมียม" = อยู่ในแพ็ก · ราคาแพ็กตั้งได้ (ค่าเริ่มต้น ฿150)', () => {
  const env = { NODE_ENV: 'test', DATABASE_FILE: ':memory:', PAYMENT_PROVIDER: 'mock', MAIL_MODE: 'console', BASE_URL: 'http://x.test',
    DOWNLOAD_LINK_SECRET: 'a'.repeat(64), PAYMENT_WEBHOOK_SECRET: 'b'.repeat(64) };
  const base = REAL_PRODUCTS.find((p) => p.slug === 'order-now');
  const list = [{ ...base, price: 0, tags: ['พรีเมียม'] }, { ...base, slug: 'follow-now', price: 0, tags: [] }];
  const c1 = loadConfig({ ...env, products: JSON.parse(JSON.stringify(list)) });
  assert.equal(c1.products[0].premium, true); assert.equal(c1.products[0].free, false);
  assert.equal(c1.products[1].premium, false); assert.equal(c1.products[1].free, true);
  assert.equal(c1.premiumPack.price, 15000);
  assert.equal(loadConfig({ ...env, PREMIUM_PACK_PRICE: '199', products: JSON.parse(JSON.stringify(list)) }).premiumPack.price, 19900);
  assert.throws(() => loadConfig({ ...env, PREMIUM_PACK_PRICE: '5', products: JSON.parse(JSON.stringify(list)) }), /PREMIUM_PACK_PRICE/);
  // ร้านจริง: ตัวที่มีแท็กพรีเมียมทั้งหมดอยู่ในแพ็ก ตัวที่ไม่มีแท็กเป็นของฟรี
  for (const p of REAL_PRODUCTS) assert.equal((p.tags || []).includes('พรีเมียม'), p.price > 0, `${p.slug}: แท็กพรีเมียมต้องตรงกับราคา`);
});

test('แพ็กพรีเมียม: ซื้อครั้งเดียวได้ทุกตัวพรีเมียม รวมตัวที่ร้านเพิ่มทีหลัง · ของฟรียังกดรับได้ · หน้า /premium', async () => {
  const anon = await (await client().req('/premium')).text();
  assert.match(anon, /แพ็กพรีเมียม/);
  assert.match(anon, /฿150/);
  for (const p of cfg.products.filter((x) => x.premium)) assert.match(anon, new RegExp(`/p/${p.slug}"`));
  for (const p of cfg.products.filter((x) => x.free)) assert.doesNotMatch(anon, new RegExp(`/p/${p.slug}"`));
  const c = await newUser('pack@example.com');
  const kid = await buy(c);
  const uid = user('pack@example.com').id;
  const kids = () => ctx.db.prepare("SELECT product_slug FROM orders WHERE user_id = ? AND provider = 'pack' AND status = 'paid'").all(uid).map((r) => r.product_slug).sort();
  const premium = cfg.products.filter((p) => p.premium).map((p) => p.slug).sort();
  assert.deepEqual(kids(), premium);
  // ร้านเพิ่มแบบพรีเมียมใหม่ (จำลอง: ลูกค้ายังไม่มีตัวนี้) → เปิดคลัง/หน้าแรกแล้วได้อัตโนมัติ
  ctx.db.prepare("DELETE FROM orders WHERE user_id = ? AND product_slug = 'cinema-title'").run(uid);
  assert.ok(!kids().includes('cinema-title'));
  const lib = await (await c.req('/library')).text();
  assert.ok(kids().includes('cinema-title'), 'ตัวใหม่เข้าคลังอัตโนมัติ');
  assert.match(lib, /ได้จากแพ็กพรีเมียม/);
  assert.doesNotMatch(lib, /ปลดล็อกพรีเมียมทั้งหมด/);
  assert.match(await (await c.req('/premium')).text(), /คุณมีแพ็กพรีเมียมแล้ว/);
  assert.match(await (await c.req('/p/neon-sign')).text(), /มีแอนิเมชันนี้ในคลังแล้ว/);
  assert.match(await (await c.req('/')).text(), /คุณมีแพ็กพรีเมียมแล้ว/);
  // เปิดหลายครั้งไม่สร้างซ้ำ
  await c.req('/library'); await c.req('/');
  assert.equal(kids().length, premium.length);
  assert.ok(kid);
  // ของฟรียังกดรับได้ตามปกติ
  const r = await c.post('/checkout', { product: 'follow-now' });
  assert.match(r.headers.get('location'), /\?claimed=1$/);
  // ไม่มีแพ็ก: หน้าสินค้าพรีเมียมชวนซื้อแพ็ก คลังมีแถบแพ็ก
  const d = await newUser('nopack@example.com');
  assert.match(await (await d.req('/p/neon-sign')).text(), /ปลดล็อกพรีเมียม ฿150/);
  assert.match(await (await d.req('/library')).text(), /ปลดล็อกพรีเมียมทั้งหมด ฿150/);
});

test('ท่าพรีเมียม: เวลาเข้า/ค้าง/ออก และช่วงท้ายของรอบค้างนิ่ง (ต่อเข้าท่าออกได้เนียนทุกความยาว)', () => {
  require('../public/motion.js');
  const M = globalThis.TTMotion;
  for (const name of ['cinema', 'neon', 'kinetic']) {
    const m = M.meta(name);
    assert.ok(m.premium && m.loop > 0);
    for (const sec of [3, 5, 10, 15, 30]) {
      const t = M.timingFor(name, sec, 60);
      assert.equal(t.settle, m.intro);
      assert.ok(t.fadeStart - t.settle >= 0.9, `${name} ${sec}s ต้องมีช่วงค้าง`);
      assert.ok(Number.isInteger(Math.round(m.intro * 60)) && Math.abs(m.intro * 60 - Math.round(m.intro * 60)) < 1e-9);
    }
  }
  // ท่าฟรีใช้เวลาเดิม
  assert.deepEqual(M.timingFor('pop', 3, 60), { popUp: 0.3, settle: 0.5, fadeStart: 2.5, fadeEnd: 3 - 1 / 60, loop: 0 });
});

test('ไม่มีป๊อปอัปของเบราว์เซอร์ (confirm/alert/prompt) ในสคริปต์หน้าเว็บ ใช้กล่องของร้านแทน', () => {
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'public')).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    assert.ok(!/(^|[^.\w])(window\.)?(confirm|alert|prompt)\s*\(/m.test(src), `${f} ยังเรียกป๊อปอัปของเบราว์เซอร์`);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), /AW\.confirm = function/);
});

test('SHOP_NOTIFY_EMAIL: หลายอีเมลคั่นด้วย , · ไม่ตั้งใช้ ADMIN_EMAIL · อีเมลผิดรูปแบบถูกข้าม', () => {
  const base = { NODE_ENV: 'test', DATABASE_FILE: ':memory:', products: testProducts() };
  assert.deepEqual(loadConfig({ ...base, ADMIN_EMAIL: 'Boss@Shop.test' }).mail.notify, ['boss@shop.test']);
  assert.deepEqual(loadConfig({ ...base, ADMIN_EMAIL: 'boss@shop.test', SHOP_NOTIFY_EMAIL: ' a@x.test, nope ,B@y.test' }).mail.notify, ['a@x.test', 'b@y.test']);
  assert.deepEqual(loadConfig({ ...base, ADMIN_EMAIL: '' }).mail.notify, []);
});

test('หลังบ้าน: ปุ่มส่งเมลทดสอบ บอกสถานะเมลและสาเหตุที่ส่งไม่ได้ · ลูกค้ากดไม่ได้', async () => {
  const a = await adminClient();
  const page = await (await a.req('/admin')).text();
  assert.match(page, /action="\/admin\/mail-test"/);
  assert.match(page, /โหมดทดสอบ: เมลพิมพ์ลง log/);
  const n = ctx.mailer.sent.length;
  const r = await a.post('/admin/mail-test');
  assert.equal(r.status, 502, 'โหมด console ไม่ได้ส่งจริง ต้องไม่บอกว่าสำเร็จ');
  assert.match(await r.text(), /MAIL_MODE=brevo/);
  assert.equal(ctx.mailer.sent.length, n + 1);
  assert.equal(ctx.mailer.sent.at(-1).to, cfg.adminEmail);
  // ส่งจริงไม่สำเร็จ → บอกข้อความ error
  const keep = ctx.mailer.send;
  ctx.mailer.send = async () => { throw new Error('Brevo ตอบ 401 → Brevo บล็อก IP'); };
  try { assert.match(await (await a.post('/admin/mail-test')).text(), /บล็อก IP/); } finally { ctx.mailer.send = keep; }
  const c = await newUser('notadmin-mail@example.com');
  assert.notEqual((await c.post('/admin/mail-test')).status, 200);
});

test('แบบที่ไม่มี ProRes สำเร็จรูป: คลังของ Premiere ให้ MP4 และพาไปสร้าง MOV โปร่งใสที่หน้าปรับแต่ง', async () => {
  const c = await newUser('noprores@example.com');
  const loc = (await c.post('/checkout', { product: 'type-on' })).headers.get('location');
  const id = loc.match(/\/library\/([^/?]+)/)[1];
  const page = await (await c.req(`/library/${id}?editor=premiere&size=vertical`)).text();
  assert.match(page, new RegExp(`href="/library/${id}/customize">ต้องการ MOV โปร่งใส \\(ProRes\\)\\?`));
  assert.match(page, /filetype=alt/, 'ยังมีปุ่ม MP4 พื้นเขียว');
  const capcut = await (await c.req(`/library/${id}?editor=capcut_mobile&size=vertical`)).text();
  assert.doesNotMatch(capcut, /ต้องการ MP4/);
});

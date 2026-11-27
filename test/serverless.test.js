'use strict';
/*
 * เทสต์โหมด serverless (Netlify): RENDER_MODE=browser + Supabase Storage + Groq
 *   - ร้านไม่เรนเดอร์เอง: ส่ง "สูตร" ให้เบราว์เซอร์ลูกค้า แล้วรับแค่ผลว่าเสร็จ (ไม่มีไฟล์ขึ้นเซิร์ฟเวอร์)
 *   - ซับ: คลิปไม่ถูกอัปโหลด เบราว์เซอร์ส่งเสียง WAV ทีละท่อน → Groq ถอด → บรรทัดซับ (เวลาต่อกันถูกท่อน)
 *   - ไฟล์สินค้า: ร้านตรวจสิทธิ์แล้วส่งไปโหลดจาก Supabase ด้วยลิงก์เซ็นชั่วคราว (ไฟล์ > 48 MB เป็น .zip)
 *   - ฟอนต์ลูกค้าเก็บบน Supabase
 * Groq และ Supabase เป็นเซิร์ฟเวอร์จำลองในเครื่อง (ไม่ออกเน็ต)
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { wavHeader, splitWav, withSpaces } = require('../src/transcribe');
const { productKey } = require('../src/storage');

let server, base, ctx, cfg, mock, mockBase;
const groqCalls = [];
const stored = new Map();
let groqStatus = 200;

// WAV 16 kHz โมโน ยาว sec วินาที (เงียบ)
const wav = (sec) => { const pcm = Buffer.alloc(Math.round(16000 * sec) * 2); return Buffer.concat([wavHeader(pcm.length, { rate: 16000, channels: 1, bits: 16 }), pcm]); };

before(async () => {
  // ---- Groq + Supabase จำลอง ----
  mock = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/openai/v1/audio/transcriptions') {
        const text = body.toString('latin1');
        groqCalls.push({ auth: req.headers.authorization, model: /name="model"\r\n\r\n([^\r]+)/.exec(text)[1], lang: /name="language"\r\n\r\n([^\r]+)/.exec(text)[1], gran: (text.match(/timestamp_granularities/g) || []).length, bytes: body.length });
        if (groqStatus !== 200) { res.writeHead(groqStatus, { 'content-type': 'application/json', 'retry-after': '0' }); return res.end('{"error":{"message":"rate"}}'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        const n = groqCalls.length;
        return res.end(JSON.stringify({
          text: `สวัสดีครับ ท่อน${n}`,
          segments: [{ start: 0, end: 2, text: `สวัสดีครับ ท่อน${n}` }],
          words: [{ word: 'สวัสดี', start: 0.1, end: 0.6 }, { word: 'ครับ', start: 0.6, end: 1 }, { word: `ท่อน${n}`, start: 1.2, end: 1.9 }],
        }));
      }
      const m = /^\/storage\/v1\/object\/(sign|authenticated|info\/authenticated)?\/?([^/]+)\/(.+)$/.exec(u.pathname);
      if (req.headers.authorization !== 'Bearer service-key') { res.writeHead(401); return res.end('no'); }
      if (m && m[1] === 'sign') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ signedURL: `/object/sign/${m[2]}/${m[3]}?token=tok123` })); }
      if (m && req.method === 'POST' && !m[1]) { stored.set(decodeURIComponent(m[3]), body); res.writeHead(200); return res.end('{}'); }
      if (m && m[1] === 'authenticated' && req.method === 'GET') {
        const b = stored.get(decodeURIComponent(m[3]));
        res.writeHead(b ? 200 : 404); return res.end(b || '');
      }
      if (req.method === 'DELETE' && /^\/storage\/v1\/object\/[^/]+$/.test(u.pathname)) {
        for (const k of JSON.parse(body.toString()).prefixes) stored.delete(k);
        res.writeHead(200); return res.end('[]');
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  mockBase = `http://127.0.0.1:${mock.address().port}`;

  cfg = loadConfig({
    NODE_ENV: 'test',
    DATABASE_FILE: ':memory:',
    DOWNLOAD_LINK_SECRET: crypto.randomBytes(32).toString('hex'),
    PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex'),
    ADMIN_EMAIL: 'admin@aksornwai.local',
    ADMIN_PASSWORD: 'test-admin-password-123',
    PAYMENT_PROVIDER: 'mock',
    MAIL_MODE: 'console',
    BASE_URL: 'http://shop.test',
    RATE_GLOBAL_PER_MIN: '0',
    RATE_SIGNUP_PER_HOUR: '1000',
    RENDER_MODE: 'browser',
    GROQ_API_KEY: 'gsk_test',
    GROQ_API_BASE: `${mockBase}/openai/v1`,
    SUPABASE_URL: mockBase,
    SUPABASE_SERVICE_KEY: 'service-key',
    CUSTOM_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sl-custom-')),
    USER_FONT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sl-fonts-')),
    SUBTITLE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sl-subs-')),
    SUBTITLE_MAX_SECONDS: '180',
  });
  ctx = createApp(cfg, { log: () => {} });
  ctx.mailer.send = async () => {};
  await new Promise((r) => { server = ctx.app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { if (server) server.close(); if (mock) mock.close(); });

function client() {
  const jar = {};
  const c = {
    async req(p, { method = 'GET', form, headers = {}, body } = {}) {
      const h = { ...headers };
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) h.cookie = cookie;
      if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form); }
      const r = await fetch(base + p, { method, headers: h, body, redirect: 'manual' });
      for (const sc of r.headers.getSetCookie()) {
        const [kv] = sc.split(';');
        const i = kv.indexOf('=');
        jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
      }
      return r;
    },
    async csrf() { if (!jar.csrf) await c.req('/login'); return decodeURIComponent(jar.csrf); },
    async post(p, form = {}) { return c.req(p, { method: 'POST', form: { csrf: await c.csrf(), ...(p === '/signup' && form.password !== undefined && form.password2 === undefined ? { password2: form.password } : {}), ...form } }); },
    async json(p, obj) { return c.req(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': await c.csrf() }, body: JSON.stringify(obj) }); },
    async raw(p, buf, type = 'audio/wav') { return c.req(p, { method: 'POST', headers: { 'content-type': type, 'x-csrf-token': await c.csrf() }, body: buf }); },
  };
  return c;
}
let n = 0;
async function newUser() {
  const c = client();
  const r = await c.post('/signup', { email: `sl${++n}@example.com`, password: 'correct-horse-9', name: '', next: '/library' });
  assert.equal(r.status, 303);
  return c;
}
async function claim(c, slug = 'follow-now') {
  const r = await c.post('/checkout', { product: slug });
  assert.equal(r.status, 303);
  return ctx.db.prepare("SELECT id FROM orders WHERE product_slug = ? AND status = 'paid' ORDER BY created_at DESC").get(slug).id;
}

test('โหมดเบราว์เซอร์: CSP อนุญาต WebAssembly และตัวเข้ารหัสจาก jsDelivr · หน้าเว็บโหลดสคริปต์เรนเดอร์', async () => {
  const r = await fetch(`${base}/`);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /'wasm-unsafe-eval'/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.match(csp, /connect-src 'self' blob: data: https:\/\/cdn\.jsdelivr\.net/);
  for (const f of ['/render-engine.js', '/render-ui.js', '/subplan.js']) assert.equal((await fetch(base + f)).status, 200, f);
});

test('ปรับแต่งในเบราว์เซอร์: ร้านส่งสูตร → เบราว์เซอร์สร้างเอง → แจ้งเสร็จ · ดาวน์โหลดซ้ำ = สร้างใหม่ (นับโควตา) · คนอื่นเข้าไม่ได้', async () => {
  const c = await newUser();
  const order = await claim(c, 'order-now');
  const r = await c.post(`/library/${order}/customize`, { text: 'ลดราคา 50%', font: 'kanit', fill: '#ffd400', stroke: '#111111', outline: 'thick', shadow: '1', editor: 'premiere', size: 'horizontal', seconds: '5', filetype: 'main' });
  assert.equal(r.status, 303);
  const id = r.headers.get('location').split('/').pop();
  const page = await (await c.req(`/library/custom/${id}`)).text();
  assert.match(page, /data-browser-job/);
  assert.match(page, /data-auto/);
  assert.match(page, /render-ui\.js/);
  // ยังไม่มีคิวบนเซิร์ฟเวอร์
  assert.equal(ctx.customizer.get(id).status, 'queued');

  const spec = await (await c.req(`/library/custom/${id}/spec`)).json();
  assert.equal(spec.format, 'prores4444');
  assert.equal(spec.ext, 'mov');
  assert.deepEqual(spec.size, { w: 1920, h: 1080 });
  assert.equal(spec.seconds, 5);
  assert.equal(spec.strokeRatio, 0.08);
  assert.equal(spec.font.url, '/fonts/thai/kanit/Kanit-Bold.ttf');
  assert.equal(spec.motion, 'pop');
  assert.match(spec.fileName, /ลดราคา 50% - Premiere Pro - แนวนอน 5วิ\.mov/);
  assert.equal(ctx.customizer.get(id).status, 'rendering');

  // คนอื่นขอสูตร/แจ้งเสร็จไม่ได้
  const other = await newUser();
  assert.equal((await other.req(`/library/custom/${id}/spec`)).status, 404);
  assert.equal((await other.json(`/library/custom/${id}/finished`, { bytes: 1 })).status, 404);
  // ต้องมี CSRF
  assert.equal((await c.req(`/library/custom/${id}/finished`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);

  assert.equal((await c.json(`/library/custom/${id}/finished`, { bytes: 1234567, ms: 9000 })).status, 200);
  const job = ctx.customizer.get(id);
  assert.equal(job.status, 'done');
  const file = JSON.parse(job.files_json)[0];
  assert.equal(file.browser, true);
  assert.equal(file.bytes, 1234567);
  assert.equal(ctx.customizer.limits(job.user_id).usedBytes, 0, 'ไฟล์อยู่ในเครื่องลูกค้า ไม่กินพื้นที่ร้าน');
  // ทำซ้ำไม่ได้แล้ว แต่ดาวน์โหลดซ้ำได้ (สร้างใหม่ในเบราว์เซอร์)
  assert.equal((await c.req(`/library/custom/${id}/spec`)).status, 409);
  const dl = await c.req(`/library/custom/${id}/download`);
  assert.equal(dl.status, 303);
  assert.equal(dl.headers.get('location'), `/library/custom/${id}?save=1`);
  const before = ctx.db.prepare('SELECT COUNT(*) AS n FROM download_log WHERE user_id = ?').get(job.user_id).n;
  assert.equal((await c.req(`/library/custom/${id}/spec?download=1`)).status, 200);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM download_log WHERE user_id = ?').get(job.user_id).n, before + 1);
  assert.match(await (await c.req(`/library/custom/${id}?save=1`)).text(), /data-mode="download" data-csrf="[^"]+" data-auto/);
});

test('ปรับแต่งในเบราว์เซอร์: ปิดหน้าไปกลางทางไม่บล็อกงานใหม่เกิน 10 นาที · แจ้งล้มเหลวแล้วลองใหม่ได้', async () => {
  const c = await newUser();
  const order = await claim(c, 'order-now');
  const form = { text: 'สวัสดี', font: 'kanit', fill: '#ffffff', stroke: '#111111', outline: 'medium', editor: 'capcut_mobile', size: 'vertical', seconds: '3', filetype: 'main' };
  const r1 = await c.post(`/library/${order}/customize`, form);
  const id = r1.headers.get('location').split('/').pop();
  assert.equal((await c.post(`/library/${order}/customize`, form)).status, 429, 'งานแรกยังไม่เสร็จ');
  ctx.db.prepare('UPDATE custom_renders SET created_at = created_at - 11 * 60 * 1000 WHERE id = ?').run(id);
  const r2 = await c.post(`/library/${order}/customize`, form);
  assert.equal(r2.status, 303);
  const id2 = r2.headers.get('location').split('/').pop();
  assert.equal((await c.json(`/library/custom/${id2}/failed`, { error: 'OOM' })).status, 200);
  assert.equal(ctx.customizer.get(id2).status, 'failed');
  const spec = await (await c.req(`/library/custom/${id2}/spec`)).json();
  assert.equal(spec.format, 'mp4_green');
  assert.equal((await c.json(`/library/custom/${id2}/finished`, { bytes: 10 })).status, 200);
  assert.equal(ctx.customizer.get(id2).status, 'done');
});

test('Groq: แบ่ง WAV ยาวเป็นท่อน < 20 MB เวลาเริ่มถูกต้อง · ใส่ช่องว่างกลับจากข้อความท่อน', () => {
  const parts = splitWav(wav(15 * 60)); // 15 นาที ≈ 28.8 MB
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.buf.length <= 20 * 1024 * 1024));
  assert.equal(parts[0].start, 0);
  assert.ok(Math.abs(parts[1].start - (20 * 1024 * 1024 - 44) / 32000) < 0.01);
  const w = withSpaces([{ word: 'สวัสดี', start: 0, end: 1 }, { word: 'ครับ', start: 1, end: 1.5 }, { word: 'วันนี้', start: 2, end: 3 }], [{ text: ' สวัสดีครับ วันนี้' }]);
  assert.deepEqual(w.map((x) => x.text), [' สวัสดี', 'ครับ', ' วันนี้']);
});

test('ซับในเบราว์เซอร์: คลิปไม่ขึ้นร้าน · เสียงทีละท่อน → Groq → บรรทัดซับเวลาต่อกัน → แก้คำ → สูตรเบิร์นซับ → เสร็จ', async () => {
  const c = await newUser();
  const order = await claim(c, 'follow-now');
  const home = await (await c.req('/subtitles')).text();
  assert.match(home, /data-sub-new data-browser/);
  assert.match(home, /ไม่ถูกอัปโหลด/);
  // ตรวจข้อมูลคลิป
  const bad = async (o, re) => { const r = await c.json('/subtitles/new', { order, name: 'a.mp4', bytes: 1000, width: 1080, height: 1920, duration: 30, audio: true, ...o }); assert.equal(r.status, 400); assert.match((await r.json()).error, re); };
  await bad({ audio: false }, /ไม่มีเสียง/);
  await bad({ duration: 999 }, /เกินที่รับได้/);
  await bad({ width: 100, height: 100 }, /ต่ำเกินไป/);
  await bad({ order: 'nope' }, /เลือกแบบ/);
  const r = await c.json('/subtitles/new', { order, name: 'คลิปของฉัน.mov', bytes: 50e6, width: 1080, height: 1920, duration: 130, audio: true });
  const j = await r.json();
  assert.equal(r.status, 200, j.error);
  const id = j.id;
  assert.equal(ctx.subtitles.get(id).status, 'transcribing');
  assert.equal(fs.readdirSync(cfg.subtitles.dir).filter((x) => x === id).length, 0, 'ไม่มีไฟล์คลิปบนเซิร์ฟเวอร์');
  // ระหว่างฟังเสียง เริ่มคลิปใหม่ไม่ได้
  assert.equal((await c.json('/subtitles/new', { order, name: 'b.mp4', bytes: 1, width: 1080, height: 1920, duration: 10, audio: true })).status, 409);
  // ไม่ใช่ WAV
  assert.equal((await c.raw(`/subtitles/${id}/audio?i=0&n=2&start=0`, Buffer.from('nope'))).status, 400);
  // ท่อน 1 (0–110 วิ) + ท่อน 2 (110–130 วิ)
  const callsBefore = groqCalls.length;
  const a1 = await c.raw(`/subtitles/${id}/audio?i=0&n=2&start=0`, wav(2));
  assert.equal(a1.status, 200);
  assert.equal((await a1.json()).done, false);
  assert.equal(ctx.subtitles.get(id).progress, 48);
  const a2 = await c.raw(`/subtitles/${id}/audio?i=1&n=2&start=110`, wav(2));
  assert.equal((await a2.json()).done, true);
  const call = groqCalls[callsBefore];
  assert.deepEqual([call.auth, call.model, call.lang, call.gran], ['Bearer gsk_test', 'whisper-large-v3', 'th', 2]);
  const job = ctx.subtitles.get(id);
  assert.equal(job.status, 'review');
  assert.equal(job.engine, 'groq');
  const cues = JSON.parse(job.cues_json);
  assert.ok(cues.length >= 2);
  assert.ok(cues[0].start < 1 && cues[cues.length - 1].start >= 110, 'ท่อนที่ 2 เลื่อนเวลาไป 110 วินาที');
  assert.match(cues.map((x) => x.text).join(' '), /สวัสดีครับ/);
  // หน้าแก้ซับ: ไม่มีลิงก์คลิปบนเซิร์ฟเวอร์ ใช้คลิปในเครื่อง
  const page = await (await c.req(`/subtitles/${id}`)).text();
  assert.doesNotMatch(page, /\/source"/);
  assert.match(page, new RegExp(`data-local-clip="${id}"`));
  assert.equal((await c.req(`/subtitles/${id}/source`)).status, 404);
  // กดสร้างคลิป → ได้สูตร
  const sv = await c.json(`/subtitles/${id}/save?render=1`, { cues: cues.map((x) => ({ id: x.id, start: x.start, end: x.end, text: x.text })) });
  const sj = await sv.json();
  assert.equal(sv.status, 200, sj.error);
  assert.equal(sj.spec.fps, 30);
  assert.deepEqual(sj.spec.out, { w: 1080, h: 1920 });
  assert.ok(sj.spec.layout.band > 0 && sj.spec.layout.y > 0);
  assert.equal(sj.spec.fileName, 'คลิปของฉัน-ซับ.mp4');
  assert.ok(sj.spec.cues.every((x) => x.m === 'drop' && x.pos === 'bottom'), 'แต่ละบรรทัดมีท่าและตำแหน่งของตัวเอง (แบบเดียว = แบบหลักทุกบรรทัด)');
  assert.equal(ctx.subtitles.get(id).status, 'review', 'ไม่เข้าคิวเครื่องร้าน');
  assert.equal((await c.json(`/subtitles/${id}/rendered`, { bytes: 9999 })).status, 200);
  assert.equal(ctx.subtitles.get(id).status, 'done');
  assert.equal(ctx.subtitles.get(id).out_bytes, 9999);
  const dl = await c.req(`/subtitles/${id}/download`);
  assert.equal(dl.headers.get('location'), `/subtitles/${id}?save=1`);
  assert.match(await (await c.req(`/subtitles/${id}?save=1`)).text(), /data-burn-again="[^"]+" data-csrf="[^"]+" data-auto/);
  assert.equal((await c.req(`/subtitles/${id}/spec?download=1`)).status, 200);
  assert.equal((await c.req(`/subtitles/${id}/srt`)).status, 200);
  const other = await newUser();
  assert.equal((await other.req(`/subtitles/${id}/spec`)).status, 404);
  assert.equal((await other.raw(`/subtitles/${id}/audio?i=0&n=1&start=0`, wav(1))).status, 404);
});

test('ซับในเบราว์เซอร์: Groq เต็มโควตา → แจ้งลูกค้าชัดเจน · ส่งเสียงท่อนแรกใหม่ = ลองใหม่ได้', async () => {
  const c = await newUser();
  const order = await claim(c, 'follow-now');
  const id = (await (await c.json('/subtitles/new', { order, name: 'x.mp4', bytes: 1, width: 1920, height: 1080, duration: 20, audio: true })).json()).id;
  groqStatus = 429;
  try {
    const r = await c.raw(`/subtitles/${id}/audio?i=0&n=1&start=0`, wav(1));
    assert.equal(r.status, 429);
    assert.match((await r.json()).error, /โควตาฟรี/);
  } finally { groqStatus = 200; }
  assert.equal(ctx.subtitles.get(id).status, 'failed');
  assert.match(await (await c.req(`/subtitles/${id}`)).text(), /data-sub-resume/);
  const r2 = await c.raw(`/subtitles/${id}/audio?i=0&n=1&start=0`, wav(1));
  assert.equal(r2.status, 200);
  assert.equal(ctx.subtitles.get(id).status, 'review');
});

test('ซับในเบราว์เซอร์: ท่อนเสียงมาไม่เรียง/ส่งซ้ำได้ · ท่อนหนึ่งล้ม ท่อนอื่นที่เสร็จไม่หาย', async () => {
  const c = await newUser();
  const order = await claim(c, 'follow-now');
  const id = (await (await c.json('/subtitles/new', { order, name: 'x.mp4', bytes: 1, width: 1920, height: 1080, duration: 80, audio: true })).json()).id;
  assert.equal((await (await c.raw(`/subtitles/${id}/audio?i=2&n=3&start=56`, wav(2))).json()).done, false);
  groqStatus = 503;
  try { assert.equal((await c.raw(`/subtitles/${id}/audio?i=0&n=3&start=0`, wav(2))).status, 502); } finally { groqStatus = 200; }
  assert.equal(ctx.subtitles.get(id).status, 'failed');
  // ท่อนที่ 2 มาถึงหลังท่อนแรกล้ม: เก็บไว้ ไม่ปฏิเสธ
  assert.equal((await (await c.raw(`/subtitles/${id}/audio?i=1&n=3&start=28`, wav(2))).json()).done, false);
  // ส่งท่อนแรกใหม่ = ครบ
  const last = await (await c.raw(`/subtitles/${id}/audio?i=0&n=3&start=0`, wav(2))).json();
  assert.equal(last.done, true);
  const cues = JSON.parse(ctx.subtitles.get(id).cues_json);
  const starts = cues.map((x) => x.start);
  assert.deepEqual(starts, starts.slice().sort((a, b) => a - b), 'เรียงตามเวลา');
  assert.ok(cues.some((x) => x.start < 1) && cues.some((x) => x.start >= 28 && x.start < 56) && cues.some((x) => x.start >= 56));
  // ส่งซ้ำหลังเสร็จ = ตอบสำเร็จ (ไม่ใช่ข้อผิดพลาด)
  const again = await c.raw(`/subtitles/${id}/audio?i=2&n=3&start=56`, wav(2));
  assert.equal(again.status, 200);
  assert.equal((await again.json()).done, true);
});

test('ไฟล์สินค้าบน Supabase: ตรวจสิทธิ์แล้วส่งไปลิงก์เซ็นอายุสั้น · ไฟล์ใหญ่เกิน 48 MB เป็น .zip', async () => {
  const c = await newUser();
  const order = await claim(c, 'follow-now');
  const r = await c.req(`/library/${order}/download?editor=capcut_mobile&size=vertical`);
  assert.equal(r.status, 303);
  const signed = await c.req(r.headers.get('location'));
  assert.equal(signed.status, 302);
  const u = new URL(signed.headers.get('location'));
  assert.equal(u.origin, mockBase);
  assert.match(u.pathname, /^\/storage\/v1\/object\/sign\/shop-files\/products\/follow-now\/follow-now_mp4_green_1080x1920\.mp4$/);
  assert.equal(u.searchParams.get('token'), 'tok123');
  assert.equal(u.searchParams.get('download'), 'follow-now_mp4_green_1080x1920.mp4');
  const big = productKey('neon-sign', { file: 'neon-sign_prores4444_1920x1080.mov', bytes: 64145609 });
  assert.deepEqual(big, { key: 'products/neon-sign/neon-sign_prores4444_1920x1080.mov.zip', name: 'neon-sign_prores4444_1920x1080.mov.zip', zipped: true });
  assert.equal(productKey('x', { file: 'a.mov', bytes: 47220211 }).zipped, false);
});

test('ฟอนต์ลูกค้าเก็บบน Supabase (ดิสก์ Netlify หายได้) · ลบแล้วลบบน Supabase ด้วย', async () => {
  const c = await newUser();
  await claim(c, 'follow-now');
  const font = fs.readFileSync(path.join(cfg.root, 'fonts', 'Kanit-Regular.ttf'));
  const r = await c.req('/library/fonts', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': await c.csrf(), 'x-font-rights': 'yes' }, body: font });
  const j = await r.json();
  assert.equal(r.status, 200, j.error);
  const key = [...stored.keys()].find((k) => k.startsWith('user-fonts/') && k.endsWith(`${j.id}.ttf`));
  assert.ok(key, 'อัปขึ้น Supabase แล้ว');
  assert.equal(stored.get(key).length, font.length);
  // ไฟล์ในดิสก์ชั่วคราวหายไป (ฟังก์ชันเริ่มใหม่) ยังโหลดได้จาก Supabase
  fs.rmSync(path.join(cfg.userFontDir), { recursive: true, force: true });
  const f = await c.req(`/library/fonts/${j.id}/file`);
  assert.equal(f.status, 200);
  assert.equal(Buffer.from(await f.arrayBuffer()).length, font.length);
  assert.equal((await c.post(`/library/fonts/${j.id}/delete`)).status, 303);
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(stored.has(key), false);
});

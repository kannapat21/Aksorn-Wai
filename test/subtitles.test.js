'use strict';
/*
 * เทสต์ซับอัตโนมัติ
 *   แบ่งบรรทัดซับไทยจากผล Whisper จริง · ตรวจซับที่ลูกค้าแก้ · .srt
 *   ต้องมีแบบในคลัง → อัปคลิป (CSRF/ขนาด/ความยาว/ไม่มีเสียง) → ถอดเสียง → แก้คำ/เลือกแบบ → สร้างคลิป → โหลด MP4/.srt
 *   คนอื่นเข้าไม่ได้ · ลบเอง · ลบอัตโนมัติเมื่อครบเวลา · จำกัดต่อวัน/ทีละงาน
 *   เรนเดอร์จริง (Chrome + ffmpeg) ถ้าเครื่องมีเครื่องมือครบ
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
const subcues = require('../src/subcues');

const HOUR = 60 * 60 * 1000;
let clock = Date.now();
let server, base, ctx, cfg;
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'whisper-th-sample.json'), 'utf8'));
const SUBDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-subs-'));

// ไฟล์ "คลิป" จำลอง: ข้อมูลคลิปอยู่ในไฟล์เป็น JSON (ตัวตรวจคลิปจำลองอ่านจากไฟล์) ไม่ต้องมี ffmpeg
const fakeClip = (o = {}) => Buffer.from(JSON.stringify({ ok: true, width: 1080, height: 1920, duration: 16.5, audio: true, hdr: false, ...o }));
let asrGate = null;
let asrFail = null;
let lastAsrTimeout = 0;
const transcribed = [];
const rendered = [];
const transcriber = {
  check: async () => ({ ok: true, engine: 'เทสต์' }),
  transcribe: async (wav, { onProgress, outFile, timeoutMs }) => {
    transcribed.push(wav);
    lastAsrTimeout = timeoutMs;
    onProgress(50);
    if (asrFail) { const e = asrFail; asrFail = null; throw e; }
    if (asrGate) await asrGate.promise;
    fs.writeFileSync(outFile, '{}');
    return { engine: 'เทสต์', words: FIX.words };
  },
};
const subtitleRenderer = {
  probe: async (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { ok: false }; } },
  extractAudio: async (src, out) => { fs.writeFileSync(out, 'wav'); },
  render: async (o) => {
    rendered.push(o);
    o.onProgress(50, 'กำลังวาดซับ');
    fs.writeFileSync(o.outFile, `MP4|${o.motion}|${o.cues.length}`);
    return { bytes: fs.statSync(o.outFile).size, ms: 5 };
  },
};

before(async () => {
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
    CUSTOM_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'shop-custom-')),
    USER_FONT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'shop-fonts-')),
    SUBTITLE_DIR: SUBDIR,
    SUBTITLE_MAX_MB: '5',
    SUBTITLE_MAX_SECONDS: '60',
    SUBTITLE_DAILY_LIMIT: '4',
  });
  ctx = createApp(cfg, {
    now: () => clock, log: () => {}, transcriber, subtitleRenderer,
    renderTools: { ok: true, browser: { ok: true, how: 'เทสต์' }, ffmpeg: { ok: true, missing: [] } },
    renderer: async () => [],
  });
  ctx.mailer.send = async () => {};
  await new Promise((r) => { server = ctx.app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

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
    async post(p, form = {}) { return c.req(p, { method: 'POST', form: { csrf: await c.csrf(), ...form } }); },
    async json(p, obj) { return c.req(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': await c.csrf() }, body: JSON.stringify(obj) }); },
    async upload(buf, { style, name = 'คลิปของฉัน.mp4', csrf = true } = {}) {
      return c.req('/subtitles/upload', {
        method: 'POST', body: buf,
        headers: { 'content-type': 'application/octet-stream', 'x-style': style || '', 'x-filename': encodeURIComponent(name), ...(csrf ? { 'x-csrf-token': await c.csrf() } : {}) },
      });
    },
  };
  return c;
}

async function newUser(email) {
  const c = client();
  const r = await c.post('/signup', { email, password: 'correct-horse-9', name: '', next: '/library' });
  assert.equal(r.status, 303);
  return c;
}
async function claim(c, slug = 'follow-now') {
  const r = await c.post('/checkout', { product: slug });
  assert.equal(r.status, 303);
  return ctx.db.prepare("SELECT id FROM orders WHERE product_slug = ? AND status = 'paid' ORDER BY created_at DESC").get(slug).id;
}
const jobOf = (id) => ctx.db.prepare('SELECT * FROM subtitle_jobs WHERE id = ?').get(id);
async function uploadOk(c, style, o) {
  const r = await c.upload(fakeClip(o), { style });
  const j = await r.json();
  assert.equal(r.status, 200, j.error);
  return j.url.split('/').pop();
}

// ---------- แบ่งบรรทัดซับ ----------
test('แบ่งบรรทัดซับไทยจากผล Whisper จริง (ชิ้นย่อยกว่าตัวอักษร): ข้อความครบ ไม่ทับกัน ไม่ยาวเกิน ตัดที่ช่วงหยุด', () => {
  const words = FIX.words;
  const full = words.map((w) => w.text).join('').replace(/\s+/g, '');
  for (const maxChars of [18, 24, 32]) {
    const cues = subcues.buildCues(words, { maxChars, duration: 16.5 });
    assert.equal(cues.map((c) => c.text).join('').replace(/\s+/g, ''), full, 'ข้อความต้องครบไม่หาย');
    cues.forEach((c, i) => {
      assert.ok(c.end > c.start);
      if (i) assert.ok(c.start >= cues[i - 1].end - 1e-9, 'ไม่ทับกัน');
      assert.ok(subcues.graphemes(c.text).length <= Math.round(maxChars * 1.35), `ยาวเกิน: ${c.text}`);
      assert.equal(c.w.map((x) => x[0]).join(''), c.text, 'คำในบรรทัดต่อกันได้ข้อความเดิม');
      const at = c.w.filter((x) => x[1] !== null).map((x) => x[1]);
      assert.deepEqual(at, [...at].sort((a, b) => a - b), 'เวลาคำเรียงตามลำดับ');
      assert.ok(!/^[ัิ-ฺ็-๎]/.test(c.text), `บรรทัดขึ้นต้นด้วยสระ/วรรณยุกต์: ${c.text}`);
    });
  }
  const cues = subcues.buildCues(words, { maxChars: 18, duration: 16.5 });
  assert.equal(cues[0].text, 'สวัสดีครับทุกคน');
  assert.equal(cues[0].start, 0);
  assert.equal(cues[1].text.startsWith('วันนี้'), true, 'ตัดบรรทัดตรงช่วงเงียบ');
  assert.ok(cues.length >= 6 && cues.length <= 10);
  assert.equal(subcues.maxCharsFor(1080, 1920), 18);
  assert.equal(subcues.maxCharsFor(1920, 1080), 32);
});

test('ตรวจซับที่ลูกค้าแก้: ตัดอักขระอันตราย ปฏิเสธอีโมจิ/ยาวเกิน/เวลาเพี้ยน รักษาจังหวะคำเดิมถ้าไม่ได้แก้คำ', () => {
  const prev = subcues.buildCues(FIX.words, { maxChars: 18, duration: 16.5 });
  const send = prev.map((c) => ({ id: c.id, start: c.start, end: c.end, text: c.text }));
  const ok = subcues.validateCues(send, { duration: 16.5, prev });
  assert.ok(ok.cues);
  assert.deepEqual(ok.cues[0].w, prev[0].w, 'ไม่ได้แก้คำ ใช้จังหวะคำจากการถอดเสียง');
  const edited = subcues.validateCues([{ ...send[0], text: 'สวัสดีค่ะ <b>ทุกคน</b>' }], { duration: 16.5, prev });
  assert.equal(edited.cues[0].text, 'สวัสดีค่ะ bทุกคน/b', 'ตัด < > ออก (ใส่ด้วย textContent อยู่แล้ว)');
  assert.notDeepEqual(edited.cues[0].w, prev[0].w);
  assert.equal(edited.cues[0].w.map((x) => x[0]).join(''), edited.cues[0].text);
  assert.match(subcues.validateCues([{ start: 0, end: 1, text: 'สวัสดี 😀' }], { duration: 5 }).error, /อีโมจิ/);
  assert.match(subcues.validateCues([{ start: 0, end: 1, text: 'ก'.repeat(61) }], { duration: 5 }).error, /ยาวเกิน/);
  assert.match(subcues.validateCues([{ start: 0, end: 0.1, text: 'สั้น' }], { duration: 5 }).error, /สั้นเกินไป/);
  assert.match(subcues.validateCues([{ start: 'x', end: 1, text: 'ก' }], { duration: 5 }).error, /เวลาไม่ถูกต้อง/);
  assert.match(subcues.validateCues([{ start: 9, end: 10, text: 'ก' }], { duration: 5 }).error, /หลังคลิปจบ/);
  assert.match(subcues.validateCues('nope', { duration: 5 }).error, /ไม่ถูกต้อง/);
  // ทับกันนิดหน่อย → ตัดท้ายบรรทัดก่อน · บรรทัดว่าง = ลบ · เรียงตามเวลา
  const fixed = subcues.validateCues([{ start: 2, end: 3, text: 'สอง' }, { start: 0, end: 2.5, text: 'หนึ่ง' }, { start: 4, end: 5, text: '  ' }], { duration: 5 });
  assert.deepEqual(fixed.cues.map((c) => [c.text, c.start, c.end]), [['หนึ่ง', 0, 2], ['สอง', 2, 3]]);
  // .srt
  const srt = subcues.toSrt(fixed.cues);
  assert.equal(srt, '1\r\n00:00:00,000 --> 00:00:02,000\r\nหนึ่ง\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nสอง\r\n');
  assert.equal(subcues.srtTime(3725.5), '01:02:05,500');
});

test('ท่าเคลื่อนไหวโหมดซับ: ช่วงค้างนิ่ง (วาดเฟรมเดียว) คำเด้งตามเวลาพูด และท่าเดิมของสินค้าไม่เปลี่ยน', () => {
  require('../public/motion.js');
  const TT = globalThis.TTMotion;
  const tm = TT.subtitleTiming('kinetic', 2, 30, [0, 0.5, 1.2]);
  assert.ok(tm.still && tm.wordAt.length === 3);
  assert.ok(tm.settle <= 0.8 && tm.fadeStart >= 1.7);
  assert.equal(TT.subtitleMoving('kinetic', 0.55, tm), true, 'คำที่สองกำลังเด้ง');
  assert.equal(TT.subtitleMoving('kinetic', 1.0, tm), false, 'ระหว่างคำ ภาพนิ่ง');
  assert.equal(TT.subtitleMoving('kinetic', 1.3, tm), true);
  const pop = TT.subtitleTiming('pop', 1, 30);
  assert.ok(pop.settle <= 0.4 && pop.fadeStart >= 0.75 && !pop.wordAt);
  assert.equal(TT.subtitleMoving('pop', 0.6, pop), false);
  const R = require('../render/subtitles');
  const plan = R.planFrames([{ start: 0.5, end: 2.5, text: 'ทดสอบ', w: [['ทดสอบ', 0]] }], { duration: 4, motion: 'pop' });
  assert.equal(plan.total, 120);
  assert.equal(plan.frames[0], null);
  assert.equal(plan.frames[119], null);
  assert.ok(plan.shots.length < 40, 'ช่วงค้างใช้ภาพเดียว');
  assert.equal(new Set(plan.frames.slice(40, 60)).size, 1);
  // ขนาด/ตำแหน่ง: คลิป 4K ย่อเหลือด้านยาว 1920 · แถบซับอยู่ในภาพ
  assert.deepEqual(R.outSize(2160, 3840), { w: 1080, h: 1920 });
  assert.deepEqual(R.outSize(1081, 721), { w: 1082, h: 722 });
  for (const pos of ['top', 'middle', 'bottom']) {
    const L = R.layoutFor(1080, 1920, { size: 'lg', position: pos });
    assert.ok(L.y >= 0 && L.y + L.band <= 1920);
  }
  // ท่าเดิมของสินค้า (เวลาเต็ม) ใช้ค่าเดิม
  const full = TT.timingFor('cinema', 3, 60);
  assert.equal(full.settle, 1.2);
  assert.equal(full.still, undefined);
});

// ---------- ขั้นตอนลูกค้า ----------
test('ต้องมีแบบในคลังก่อน: ยังไม่มี → หน้าแนะนำให้รับแบบฟรี อัปคลิปไม่ได้ · ไม่ล็อกอิน → ไปหน้าเข้าสู่ระบบ', async () => {
  const anon = client();
  const r0 = await anon.req('/subtitles');
  assert.equal(r0.status, 303);
  assert.match(r0.headers.get('location'), /^\/login/);
  const c = await newUser('nosub@example.com');
  const page = await (await c.req('/subtitles')).text();
  assert.match(page, /ต้องมีแบบตัวอักษรในคลังก่อน/);
  const r = await c.upload(fakeClip(), { style: 'whatever' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /เลือกแบบตัวอักษร/);
  const inc = path.join(SUBDIR, '.incoming');
  assert.equal(fs.existsSync(inc) ? fs.readdirSync(inc).length : 0, 0);
});

test('อัปคลิป → ถอดเสียง → แก้คำ/เปลี่ยนแบบ → สร้างคลิป → โหลด MP4 และ .srt', async () => {
  const c = await newUser('subs@example.com');
  const free = await claim(c, 'follow-now');
  const lib = await (await c.req('/library')).text();
  assert.match(lib, /href="\/subtitles"/, 'คลังมีทางเข้าใส่ซับ');
  const home = await (await c.req('/subtitles')).text();
  assert.match(home, /data-sub-new/);
  assert.match(home, new RegExp(`value="${free}"`), 'เลือกแบบจากคลังได้');
  assert.match(home, /src="\/subtitles\.js\?v=/);

  asrGate = {}; asrGate.promise = new Promise((r) => { asrGate.open = r; });
  const id = await uploadOk(c, free);
  const job0 = jobOf(id);
  assert.equal(job0.src_name, 'คลิปของฉัน.mp4');
  assert.equal(job0.product_slug, 'follow-now');
  assert.ok(fs.existsSync(path.join(SUBDIR, id, 'source.mp4')));
  assert.equal(fs.statSync(path.join(SUBDIR, id)).mode & 0o077, 0, 'โฟลเดอร์คลิปลูกค้าอ่านได้เฉพาะร้าน');
  // ระหว่างถอดเสียง: หน้ารอ + สถานะ JSON · อัปคลิปที่สองไม่ได้ (ทีละงาน)
  await new Promise((r) => setTimeout(r, 30));
  const wait = await (await c.req(`/subtitles/${id}`)).text();
  assert.match(wait, /กำลังฟังเสียงพูด/);
  const st = await (await c.req(`/subtitles/${id}/status`)).json();
  assert.equal(st.status, 'transcribing');
  assert.ok(st.progress > 1);
  const second = await c.upload(fakeClip(), { style: free });
  assert.equal(second.status, 409);
  asrGate.open(); asrGate = null;
  await ctx.subtitles.idle();
  assert.equal(jobOf(id).status, 'review');
  assert.ok(!fs.existsSync(path.join(SUBDIR, id, 'audio.wav')), 'ลบไฟล์เสียงชั่วคราวแล้ว');

  // หน้าแก้ซับ: ข้อมูลซับฝังเป็น JSON (ไม่รันเป็นสคริปต์) + เครื่องเล่นคลิปต้นฉบับ
  const ed = await (await c.req(`/subtitles/${id}`)).text();
  assert.match(ed, /<script type="application\/json" id="sub-data">/);
  assert.match(ed, /สวัสดีครับทุกคน/);
  assert.match(ed, /src="\/subtitles\/[a-f0-9]+\/source"/);
  assert.doesNotMatch(ed.split('id="sub-data">')[1].split('</script>')[0], /</, 'JSON ไม่มี < ดิบ');
  const src = await c.req(`/subtitles/${id}/source`, { headers: { range: 'bytes=0-9' } });
  assert.equal(src.status, 206, 'เลื่อนเวลาในคลิปได้ (Range)');
  assert.equal(src.headers.get('cache-control'), 'private, no-store');

  // แก้คำ + เปลี่ยนแบบเป็นแบบที่เป็นเจ้าของ
  const cues = JSON.parse(jobOf(id).cues_json);
  const send = cues.map((x) => ({ id: x.id, start: x.start, end: x.end, text: x.text }));
  send[1].text = 'วันนี้เราจะมาลองทำซับไตเติ้ล';
  const order2 = await claim(c, 'order-now');
  const style = { order: order2, font: 'kanit', fill: '#ffd400', stroke: '#111111', outline: 'thick', shadow: true, size: 'lg', position: 'middle' };
  const sv = await c.json(`/subtitles/${id}/save`, { cues: send, style });
  const svj = await sv.json();
  assert.equal(sv.status, 200, svj.error);
  assert.equal(svj.cues[1].text, 'วันนี้เราจะมาลองทำซับไตเติ้ล');
  assert.equal(svj.cues[1].id, cues[1].id);
  assert.equal(jobOf(id).product_slug, 'order-now');
  assert.equal(jobOf(id).size, 'lg');
  // แบบที่ไม่ได้เป็นเจ้าของ / ไม่มี CSRF / ข้อความผิด
  const notMine = await c.json(`/subtitles/${id}/save`, { style: { ...style, order: 'someone-else' } });
  assert.equal(notMine.status, 400);
  const noCsrf = await c.req(`/subtitles/${id}/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cues: send }) });
  assert.equal(noCsrf.status, 403);
  const bad = await c.json(`/subtitles/${id}/save`, { cues: [{ start: 0, end: 1, text: '🔥🔥' }] });
  assert.equal(bad.status, 400);
  assert.equal(JSON.parse(jobOf(id).cues_json)[1].text, 'วันนี้เราจะมาลองทำซับไตเติ้ล', 'ข้อมูลผิดไม่ทับของเดิม');

  // .srt ใช้ได้ตั้งแต่ตอนแก้คำ
  const srt = await c.req(`/subtitles/${id}/srt`);
  assert.equal(srt.status, 200);
  assert.match(srt.headers.get('content-disposition'), /attachment/);
  const srtText = await srt.text();
  assert.match(srtText, /^﻿?1\r\n00:00:00,000 --> /);
  assert.match(srtText, /วันนี้เราจะมาลองทำซับไตเติ้ล/);

  // สร้างคลิป
  const go = await c.json(`/subtitles/${id}/save?render=1`, { cues: send, style });
  assert.equal(go.status, 200);
  await ctx.subtitles.idle();
  const done = jobOf(id);
  assert.equal(done.status, 'done');
  const last = rendered[rendered.length - 1];
  assert.equal(last.motion, 'pop', 'ใช้ท่าของแบบที่เลือก');
  assert.equal(last.fill, '#ffd400');
  assert.equal(last.position, 'middle');
  assert.equal(last.cues[1].text, 'วันนี้เราจะมาลองทำซับไตเติ้ล');
  const page = await (await c.req(`/subtitles/${id}`)).text();
  assert.match(page, /คลิปพร้อมซับเสร็จแล้ว/);
  const dl = await c.req(`/subtitles/${id}/download`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="subtitled\.mp4"/);
  assert.equal(await dl.text(), `MP4|pop|${send.length}`);
  // กำลังสร้าง/เสร็จแล้ว แก้ผ่าน API ไม่ได้ ต้องกด "แก้แล้วสร้างใหม่"
  assert.equal((await c.json(`/subtitles/${id}/save`, { cues: send })).status, 409);
  const reopen = await c.post(`/subtitles/${id}/edit`);
  assert.equal(reopen.status, 303);
  assert.equal(jobOf(id).status, 'review');
  assert.equal((await c.json(`/subtitles/${id}/save`, { cues: send })).status, 200);
  // รายการคลิปของฉัน
  assert.match(await (await c.req('/subtitles')).text(), /คลิปของฉัน\.mp4/);

  // คนอื่นเข้าไม่ได้ทุกทาง
  const other = await newUser('other-subs@example.com');
  for (const p of [`/subtitles/${id}`, `/subtitles/${id}/source`, `/subtitles/${id}/srt`, `/subtitles/${id}/download`]) {
    assert.equal((await other.req(p)).status, 404, p);
  }
  assert.equal((await other.req(`/subtitles/${id}/status`)).status, 404);
  assert.equal((await other.json(`/subtitles/${id}/save`, { cues: [] })).status, 404);
  assert.equal((await other.post(`/subtitles/${id}/delete`)).status, 404);
  assert.equal(jobOf(id).status, 'review');

  // ลบเอง: ไฟล์และข้อความซับหายทันที
  const del = await c.post(`/subtitles/${id}/delete`);
  assert.equal(del.status, 303);
  assert.ok(!fs.existsSync(path.join(SUBDIR, id)));
  assert.equal(jobOf(id).cues_json, null);
  assert.equal((await c.req(`/subtitles/${id}`)).status, 404);
});

test('ตรวจคลิปตอนอัป: ไม่ใช่วิดีโอ / ไม่มีเสียง / ยาวเกิน / ใหญ่เกิน / ไม่มี CSRF ถูกปฏิเสธ พร้อมข้อความไทย', async () => {
  const c = await newUser('check@example.com');
  const free = await claim(c);
  const cases = [
    [Buffer.from('not a video'), /เปิดไฟล์นี้ไม่ได้/],
    [fakeClip({ audio: false }), /ไม่มีเสียง/],
    [fakeClip({ duration: 75 }), /ยาว 1 นาที 15 วินาที เกินที่รับได้ \(1 นาที\)/],
    [fakeClip({ width: 160, height: 120 }), /ความละเอียดต่ำ/],
  ];
  for (const [buf, re] of cases) {
    const r = await c.upload(buf, { style: free });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, re);
  }
  const big = await c.upload(Buffer.alloc(6 * 1024 * 1024), { style: free });
  assert.equal(big.status, 413);
  assert.match((await big.json()).error, /ใหญ่เกิน 5 MB/);
  const noCsrf = await c.upload(fakeClip(), { style: free, csrf: false });
  assert.equal(noCsrf.status, 403);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM subtitle_jobs WHERE user_id = (SELECT id FROM users WHERE email = 'check@example.com')").get().n, 0);
  assert.equal(fs.readdirSync(path.join(SUBDIR, '.incoming')).length, 0, 'ไม่มีไฟล์ค้าง');
});

test('จำกัดต่อวัน และลบอัตโนมัติเมื่อครบเวลาเก็บ (คลิป ข้อความซับ ไฟล์ที่ได้)', async () => {
  const c = await newUser('limit@example.com');
  const free = await claim(c);
  const ids = [];
  for (let i = 0; i < 4; i++) { ids.push(await uploadOk(c, free)); await ctx.subtitles.idle(); }
  const r = await c.upload(fakeClip(), { style: free });
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /วันนี้อัปครบ 4 คลิป/);
  assert.match(await (await c.req('/subtitles')).text(), /วันนี้อัปครบ 4 คลิปแล้ว/);
  // ผ่านไป 25 ชั่วโมง: ลบทั้งหมด และอัปได้อีก
  clock += 25 * HOUR;
  ctx.subtitles.sweep();
  for (const id of ids) {
    assert.equal(jobOf(id).status, 'expired');
    assert.equal(jobOf(id).cues_json, null);
    assert.equal(jobOf(id).src_name, '');
    assert.ok(!fs.existsSync(path.join(SUBDIR, id)));
    assert.equal((await c.req(`/subtitles/${id}`)).status, 404);
  }
  assert.doesNotMatch(await (await c.req('/subtitles')).text(), /คลิปของฉัน\.mp4/);
  await uploadOk(c, free);
  await ctx.subtitles.idle();
  // แถวสรุปที่หมดอายุเกิน 30 วันถูกลบจากฐานข้อมูล
  clock += 31 * 24 * HOUR;
  ctx.subtitles.sweep();
  assert.equal(jobOf(ids[0]), undefined);
});

test('ถอดเสียงนานเกินกำหนด → แจ้งลูกค้าเป็นภาษาไทย กดลองใหม่ได้ · หลอดบอกเวลาที่ผ่านไป', async () => {
  const c = await newUser('slow@example.com');
  const free = await claim(c);
  asrGate = {}; asrGate.promise = new Promise((r) => { asrGate.open = r; });
  const id = await uploadOk(c, free);
  await new Promise((r) => setTimeout(r, 30));
  clock += 65 * 1000;
  const st = await (await c.req(`/subtitles/${id}/status`)).json();
  assert.equal(st.status, 'transcribing');
  assert.equal(st.elapsed, 65 * 1000, 'บอกเวลาที่ผ่านไปตั้งแต่เริ่มฟัง');
  assert.match(await (await c.req(`/subtitles/${id}`)).text(), /data-job-time/);
  asrGate.open(); asrGate = null;
  await ctx.subtitles.idle();
  assert.ok(lastAsrTimeout >= 5 * 60e3 && lastAsrTimeout <= cfg.subtitles.asrTimeoutMin * 60e3, `จำกัดเวลาตามความยาวคลิป (${lastAsrTimeout})`);

  // รอบที่สอง: ตัวถอดเสียงถูกตัดเพราะเกินเวลา
  asrFail = Object.assign(new Error('python จบด้วย SIGKILL'), {});
  const id2 = await uploadOk(c, free);
  await ctx.subtitles.idle();
  assert.equal(jobOf(id2).status, 'failed');
  const page = await (await c.req(`/subtitles/${id2}`)).text();
  assert.match(page, /ถอดเสียงนานเกินกำหนด/);
  assert.match(page, new RegExp(`action="/subtitles/${id2}/retry"`));
  assert.doesNotMatch(page, /data-sub-editor/, 'ไม่เปิดหน้าแก้ซับเปล่าๆ');
  const csrf = await c.csrf();
  const rr = await c.req(`/subtitles/${id2}/retry`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `csrf=${encodeURIComponent(csrf)}`, redirect: 'manual' });
  assert.equal(rr.status, 303);
  await ctx.subtitles.idle();
  assert.equal(jobOf(id2).status, 'review', 'ลองใหม่แล้วถอดเสียงสำเร็จ');
});

test('งานค้างตอนปิดร้านกลับเข้าคิว และระบบถอดเสียงไม่พร้อม → ปิดปุ่มอัป พร้อมข้อความบอกลูกค้า', async () => {
  const { createSubtitles } = require('../src/subtitles');
  const t = Date.now();
  ctx.db.prepare(`INSERT INTO subtitle_jobs (id, user_id, order_id, product_slug, font, fill, stroke, outline, status, created_at, queued_at, updated_at, expires_at, width, height, duration)
    VALUES ('stuck1', (SELECT id FROM users LIMIT 1), 'x', 'follow-now', 'kanit', '#ffffff', '#111111', 'medium', 'rendering', ?, ?, ?, ?, 1080, 1920, 5)`).run(t, t, t, clock + HOUR);
  createSubtitles({ db: ctx.db, cfg, log: () => {}, now: () => clock, transcriber, renderer: subtitleRenderer, toolsOk: () => false, resolveFont: () => ({}) });
  assert.equal(jobOf('stuck1').status, 'queued_render');
  ctx.db.prepare("DELETE FROM subtitle_jobs WHERE id = 'stuck1'").run();

  const off = createApp(cfg, {
    now: () => clock, log: () => {}, subtitleRenderer, transcriber: { check: async () => ({ ok: false }), transcribe: async () => ({}) },
    renderTools: { ok: false, browser: { ok: false }, ffmpeg: { ok: false, missing: ['ffmpeg'] } }, renderer: async () => [],
  });
  const srv = await new Promise((r) => { const s = off.app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const b = `http://127.0.0.1:${srv.address().port}`;
    const oldBase = base; base = b;
    const c = await newUser('off@example.com');
    await claim(c);
    const page = await (await c.req('/subtitles')).text();
    assert.match(page, /ยังไม่เปิดให้ใช้ชั่วคราว/);
    assert.match(page, /data-off/);
    const r = await c.upload(fakeClip(), { style: 'x' });
    assert.equal(r.status, 503);
    base = oldBase;
  } finally { srv.close(); }
});

test('หน้าซับ: ไม่มีป๊อปอัปเบราว์เซอร์ ลบใช้กล่องยืนยันของร้าน และสไตล์รองรับลดการเคลื่อนไหว', async () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'subtitles.js'), 'utf8');
  assert.ok(!/(^|[^.\w])(window\.)?(confirm|alert|prompt)\s*\(/m.test(js));
  assert.ok(!/beforeunload/.test(js), 'ไม่ใช้กล่องเตือนออกจากหน้าของเบราว์เซอร์');
  assert.match(js, /prefers-reduced-motion/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /\.calm \.sub-wave i \{ animation: none/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'views-subtitles.js'), 'utf8'), /data-confirm-ok="ลบเลย" data-confirm-danger/);
  const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(gi, /^storage\/subtitles\/$/m, 'คลิปลูกค้าไม่เข้า git');
  assert.match(gi, /^\.venv-stt\/$/m);
});

// ---------- เรนเดอร์จริง (ข้ามถ้าเครื่องไม่มี ffmpeg/Chrome) ----------
test('เรนเดอร์จริง: เบิร์นซับท่าคำเด้งลงคลิป ได้ขนาด/ความยาว/เสียงเดิม', async (t) => {
  const tools = require('../render/tools');
  const R = require('../render/subtitles');
  if (!tools.checkRenderTools().ok) return t.skip('ไม่มี ffmpeg หรือ Chrome');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subs-real-'));
  try {
    const src = path.join(dir, 'in.mp4');
    require('child_process').execFileSync(tools.ffmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x334455:s=720x1280:r=30:d=3',
      '-f', 'lavfi', '-i', 'sine=f=300:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
    const info = await R.probe(src);
    assert.deepEqual([info.width, info.height, info.audio], [720, 1280, true]);
    const cues = subcues.buildCues(FIX.words.filter((w) => w.end < 2.9), { maxChars: 18, duration: info.duration });
    const steps = [];
    const r = await R.renderSubtitled({
      src, outFile: path.join(dir, 'out.mp4'), cues, motion: 'kinetic', fill: '#ffffff', stroke: '#111111', strokeRatio: 0.05, shadow: true,
      font: { file: path.join(__dirname, '..', 'fonts', 'Kanit-Bold.ttf'), weight: 700 }, info, onProgress: (p) => steps.push(p),
    });
    const out = await R.probe(path.join(dir, 'out.mp4'));
    assert.deepEqual([out.width, out.height, out.audio], [720, 1280, true]);
    assert.ok(Math.abs(out.duration - info.duration) < 0.15);
    assert.ok(r.shots > 10 && r.shots < 90, `วาดเฉพาะเฟรมที่ขยับ (${r.shots})`);
    assert.ok(steps.length > 3 && steps[steps.length - 1] >= 99);
    // เฟรมกลางบรรทัดแรกมีตัวอักษรสีขาว ตรงแถบซับด้านล่าง
    const L = R.layoutFor(720, 1280);
    const raw = require('child_process').execFileSync(tools.ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-ss', '1.6', '-i', path.join(dir, 'out.mp4'), '-frames:v', '1',
      '-vf', `crop=720:${L.band}:0:${L.y},format=gray`, '-f', 'rawvideo', '-']);
    const bright = raw.filter((x) => x > 200).length;
    assert.ok(bright > 500, `มีตัวอักษรในแถบซับ (${bright} จุด)`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('transcribe.py: บรรทัด PROGRESS ส่งออกได้ระหว่างที่ tqdm ถูกดักไว้ (หลอดต้องขยับ)', (t) => {
  const { spawnSync } = require('child_process');
  const code = [
    'import sys, importlib.util',
    `spec = importlib.util.spec_from_file_location("t", ${JSON.stringify(path.join(__dirname, '..', 'scripts', 'transcribe.py'))})`,
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'real = sys.stderr; sys.stderr = m.TqdmToProgress(real)',
    'sys.stderr.write(" 40%|####\\r"); m.progress(50)',
    'sys.stderr = real',
  ].join('\n');
  const r = spawnSync('python3', ['-I', '-c', code], { encoding: 'utf8' });
  if (r.error) return t.skip('ไม่มี python3');
  assert.match(r.stderr, /PROGRESS 43\n/);
  assert.match(r.stderr, /PROGRESS 50\n/);
});

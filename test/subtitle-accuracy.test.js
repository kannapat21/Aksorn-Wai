'use strict';
// ความแม่นของซับอัตโนมัติ: ตัดคำเติม (เอ่อ/อืม/อ่า) ตัดประโยคที่ Whisper แต่งเอง แบ่งบรรทัดตามช่วงหยุดพูด
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCues } = require('../src/subcues');
const { groqTranscribe, cleanSegments, THAI_PROMPT } = require('../src/transcribe');

const words = (arr, step = 0.32) => { let t = 0; return arr.map((x) => { const w = { text: x, start: t, end: t + 0.3 }; t += step; return w; }); };
const texts = (ws) => buildCues(ws).map((c) => c.text);

test('ตัดคำเติม เอ่อ/เอ๋อ/อืม/อ่า/เอิ่ม/um ออกจากซับ แต่เก็บคำจริงอย่าง "น้ำเอ่อล้น"', () => {
  assert.deepEqual(texts(words([' เอ่อ', ' วันนี้', 'เรา', 'จะ', 'มา'])), ['วันนี้เราจะมา']);
  assert.deepEqual(texts(words([' อ่าาา', ' คือ', 'ว่า'])), ['คือว่า']);
  assert.deepEqual(texts(words([' อืมม', ' ก็', 'ดี', 'นะ'])), ['ก็ดีนะ']);
  assert.deepEqual(texts(words([' เอ๋อ', ' ผม', 'ว่า'])), ['ผมว่า']);
  assert.deepEqual(texts(words([' เอิ่ม', ' ครับ', 'ผม'])), ['ครับผม']);
  assert.deepEqual(texts(words([' แบบ', 'ว่า', 'อ่า', ' มัน', 'ก็'])), ['แบบว่า มันก็']);
  assert.deepEqual(texts(words([' um', ' hello'])), ['hello']);
  assert.deepEqual(texts(words([' น้ำ', 'เอ่อ', 'ล้น', 'ตลิ่ง'])), ['น้ำเอ่อล้นตลิ่ง']);
  assert.deepEqual(texts(words([' อ่าน', 'หนังสือ'])), ['อ่านหนังสือ']);
  // คำเติมล้วน = ไม่มีบรรทัด
  assert.deepEqual(texts(words([' เอ่อ', ' อืม'])), []);
});

test('แบ่งบรรทัดตรงช่วงหยุดพูด (เวลาจบของคำไม่ลากยาวถึงคำถัดไป) และรวมบรรทัดจิ๋วเข้ากับบรรทัดข้างๆ', () => {
  const w = [{ text: ' สวัสดี', start: 0, end: 0.5 }, { text: 'ครับ', start: 0.5, end: 0.8 },
    { text: ' วันนี้', start: 2.5, end: 3 }, { text: 'อากาศ', start: 3, end: 3.4 }, { text: 'ดี', start: 3.4, end: 3.6 }, { text: ' นะ', start: 3.9, end: 4 }];
  const cues = buildCues(w, { maxChars: 18 });
  assert.deepEqual(cues.map((c) => c.text), ['สวัสดีครับ', 'วันนี้อากาศดี นะ']);
  assert.ok(cues[0].end < 1.2, `บรรทัดแรกต้องจบหลังพูดจบไม่นาน (ได้ ${cues[0].end})`);
  assert.equal(cues[1].start, 2.5);
});

test('ตัดท่อนที่ Whisper แต่งเอง: ช่วงเงียบ ข้อความวนซ้ำ "ขอบคุณที่รับชม" และท่อนซ้ำติดกัน', () => {
  const segs = cleanSegments([
    { text: ' สวัสดีครับ', start: 0, end: 1, no_speech_prob: 0.01, avg_logprob: -0.2, compression_ratio: 1.1 },
    { text: ' ลาลาลา', start: 1, end: 2, no_speech_prob: 0.8, avg_logprob: -1.3, compression_ratio: 1.2 },
    { text: ' ไปไปไปไปไปไปไปไปไปไปไปไป', start: 2, end: 3, no_speech_prob: 0.1, avg_logprob: -0.4, compression_ratio: 3.1 },
    { text: ' วันนี้อากาศดี', start: 3, end: 4, no_speech_prob: 0.02, avg_logprob: -0.3, compression_ratio: 1.2 },
    { text: ' วันนี้อากาศดี', start: 4, end: 5, no_speech_prob: 0.3, avg_logprob: -0.5, compression_ratio: 1.2 },
    { text: ' ขอบคุณที่รับชมครับ', start: 5, end: 6, no_speech_prob: 0.5, avg_logprob: -0.8, compression_ratio: 1.0 },
  ]);
  assert.deepEqual(segs.map((s) => s.bad), [false, true, true, false, true, true]);
  // พูด "ขอบคุณครับ" ชัดๆ จริง (มั่นใจสูง) ต้องเก็บไว้
  assert.equal(cleanSegments([{ text: ' ขอบคุณครับ', no_speech_prob: 0.01, avg_logprob: -0.1, compression_ratio: 1 }])[0].bad, false);
});

test('Groq: ส่งบริบทภาษาไทย และคำในท่อนที่ตัดทิ้งไม่ขึ้นซับ', async () => {
  let sent = null;
  const fetchImpl = async (url, opts) => {
    sent = opts.body;
    return new Response(JSON.stringify({
      text: 'สวัสดีครับ ขอบคุณที่รับชม',
      segments: [
        { start: 0, end: 1, text: ' สวัสดีครับ', no_speech_prob: 0.01, avg_logprob: -0.2, compression_ratio: 1 },
        { start: 1, end: 3, text: ' ขอบคุณที่รับชม', no_speech_prob: 0.7, avg_logprob: -1.2, compression_ratio: 1 },
      ],
      words: [{ word: 'สวัสดี', start: 0, end: 0.5 }, { word: 'ครับ', start: 0.5, end: 0.9 }, { word: 'ขอบคุณ', start: 1.2, end: 1.8 }, { word: 'ที่รับชม', start: 1.8, end: 2.6 }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const cfg = { groq: { apiBase: 'http://groq.test', apiKey: 'k', model: 'whisper-large-v3' } };
  const r = await groqTranscribe(cfg, Buffer.alloc(100), { offset: 10, fetchImpl });
  assert.equal(sent.get('prompt'), THAI_PROMPT);
  assert.equal(sent.get('language'), 'th');
  assert.equal(sent.get('temperature'), '0');
  assert.deepEqual(r.words.map((w) => w.text.trim()), ['สวัสดี', 'ครับ']);
  assert.equal(r.words[0].start, 10);
  assert.equal(r.segments.length, 1);
});

test('ขีดจำกัดซับอัตโนมัติ: ค่าเริ่มต้นไม่จำกัดจำนวนคลิปต่อวัน · โหมดเบราว์เซอร์รับคลิปยาว 10 นาที 2 GB · ตั้งค่าเองได้', () => {
  const crypto = require('crypto');
  const { loadConfig } = require('../src/config');
  const base = { NODE_ENV: 'test', DATABASE_FILE: ':memory:', DOWNLOAD_LINK_SECRET: crypto.randomBytes(32).toString('hex'), PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex'), PAYMENT_PROVIDER: 'mock', MAIL_MODE: 'console' };
  const empty = { SUBTITLE_MAX_MB: '', SUBTITLE_MAX_SECONDS: '', SUBTITLE_DAILY_LIMIT: '' };
  const b = loadConfig({ ...base, ...empty, RENDER_MODE: 'browser', GROQ_API_KEY: 'gsk_test' }).subtitles;
  assert.equal(b.dailyLimit, 0);
  assert.equal(b.maxSeconds, 600);
  assert.equal(b.maxMb, 2000);
  const s = loadConfig({ ...base, ...empty, RENDER_MODE: 'server' }).subtitles;
  assert.equal(s.maxSeconds, 180);
  assert.equal(s.maxMb, 300);
  assert.equal(loadConfig({ ...base, RENDER_MODE: 'server', SUBTITLE_DAILY_LIMIT: '10' }).subtitles.dailyLimit, 10);
});

test('หน้าแก้ซับไม่มีลิงก์ "ภาพไม่ขึ้น? แปลงคลิป" และไม่แปลงคลิปที่เล่นได้อยู่แล้ว', () => {
  const fs = require('fs');
  const ui = fs.readFileSync(require.resolve('../public/render-ui.js'), 'utf8');
  assert.doesNotMatch(ui, /data-fix-go|ภาพไม่ขึ้น|frameDark/);
  const eng = fs.readFileSync(require.resolve('../public/render-engine.js'), 'utf8');
  assert.match(eng, /return !info\.canDecode \|\| !info\.playable;/);
});

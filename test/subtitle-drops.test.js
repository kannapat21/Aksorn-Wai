'use strict';
// ซับไม่ดรอปทั้งคลิป: คิวกันโควตา Groq เต็ม · ลองใหม่แบบรอนานขึ้น · ถอดช่วงที่ขาดซ้ำในครั้งเดียว · รอยต่อท่อนไม่ทิ้งคำ
// · ข้อความ error ไม่กลายเป็นซับ · จำลองคลิปยาวที่มีเสียงเกมดังตลอด
const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/transcribe');
const { buildCues } = require('../src/subcues');
const sim = require('./fixtures/asr-sim');

const cfg = { groq: { apiBase: 'http://groq.test', apiKey: 'k', model: 'whisper-large-v3', backoffMs: [5, 5, 5] } };
const fastGate = () => T.createGate({ rpm: 1000, wait: async () => {} });
const ok = (j) => new Response(JSON.stringify(j), { status: 200 });

test('คิว Groq: ส่งไม่เกิน rpm ครั้งต่อนาที · รอนานเกินที่รับได้ = 429 ชั่วคราวพร้อมเวลาที่ควรรอ', async () => {
  let t = 0;
  const waited = [];
  const g = T.createGate({ rpm: 3, now: () => t, wait: async (ms) => { waited.push(ms); } });
  await g.take(); await g.take(); await g.take();
  assert.deepEqual(waited, []);
  await g.take(); // ครั้งที่ 4 ต้องรอให้ครั้งแรกพ้น 60 วินาที
  assert.deepEqual(waited, [60000]);
  await assert.rejects(g.take(1000), (e) => e.status === 429 && e.transient && e.retryAfter >= 59);
  t = 200000;
  g.pause(5000); // Groq บอกให้รอ = ทั้งคิวรอ
  await g.take();
  assert.equal(waited.at(-1), 5000);
});

test('Groq ตอบ 429/503 ชั่วคราว: ลองใหม่เองจนได้ · ยังไม่ได้ภายในเวลา = error ชั่วคราว (ไม่ใช่งานล้ม)', async () => {
  const wav = sim.wavOf(new Int16Array(16000).fill(500));
  let n = 0;
  const flaky = async () => (++n === 1 ? new Response('x', { status: 429, headers: { 'retry-after': '0' } }) : n === 2 ? new Response('x', { status: 503 }) : ok({ segments: [{ start: 0, end: 1, text: ' สวัสดี' }], words: [{ word: ' สวัสดี', start: 0, end: 1 }] }));
  const r = await T.groqTranscribe(cfg, wav, { fetchImpl: flaky, gate: fastGate() });
  assert.equal(n, 3);
  assert.equal(r.words[0].text.trim(), 'สวัสดี');
  const full = async () => new Response('x', { status: 429, headers: { 'retry-after': '120' } });
  await assert.rejects(T.groqTranscribe(cfg, wav, { fetchImpl: full, gate: fastGate(), deadline: Date.now() + 30000 }), (e) => e.transient && e.status === 429 && e.retryAfter === 120);
  const bad = async () => new Response('x', { status: 401 });
  await assert.rejects(T.groqTranscribe(cfg, wav, { fetchImpl: bad, gate: fastGate() }), (e) => !e.transient && /คีย์ Groq/.test(e.userMessage));
});

test('ท่อนที่ถอดเป็นข้อความได้ แต่รายการคำขาด → ใช้ข้อความของท่อนแทน (ซับไม่หาย)', () => {
  const words = [{ text: ' หนึ่ง', start: 0, end: 0.5 }];
  const segs = [{ start: 0, end: 1, text: ' หนึ่ง' }, { start: 2, end: 5, text: ' แล้วก็ไปต่อกันเลย ทุกคน' }];
  const r = T.fillFromSegments(words, segs);
  assert.equal(r.filled, 1);
  assert.deepEqual(r.words.map((w) => w.text), [' หนึ่ง', ' แล้วก็ไปต่อกันเลย', ' ทุกคน']);
  assert.ok(r.words[1].start === 2 && r.words[2].end === 5);
});

// เสียงดังตลอด 28 วินาที (มีคนพูด) แต่ Whisper ให้คำแค่บางช่วง
function speechWav(sec = 28) {
  const pcm = new Int16Array(sec * 16000);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(3000 * Math.sin(i / 3)) || 1;
  return sim.wavOf(pcm);
}

test('ช่วงที่ Whisper ข้ามหลายช่วง → ต่อกันแล้วถอดซ้ำครั้งเดียว · คำกลับไปอยู่เวลาจริง', async () => {
  const calls = [];
  const fetchImpl = async (url, { body }) => {
    calls.push(1);
    if (calls.length === 1) return ok({ segments: [], words: [{ word: ' ก', start: 0.2, end: 3 }, { word: ' ข', start: 10, end: 12 }, { word: ' ค', start: 20, end: 27.5 }] });
    // ไฟล์ที่ต่อกัน: ช่วง 3–10 (เผื่อ 0.6) แล้วเงียบ 1 วิ แล้วช่วง 12–20
    return ok({ segments: [], words: [{ word: ' กลาง1', start: 2, end: 5 }, { word: ' กลาง2', start: 11, end: 15 }] });
  };
  const r = await T.transcribeCovered(cfg, speechWav(), { offset: 100, fetchImpl, gate: fastGate() });
  assert.equal(calls.length, 2, 'ถอดซ้ำครั้งเดียวสำหรับทุกช่วงที่ขาด');
  assert.equal(r.gaps, 2);
  assert.equal(r.recovered, 2);
  assert.deepEqual(r.missed, []);
  assert.deepEqual(r.words.map((w) => w.text.trim()), ['ก', 'กลาง1', 'ข', 'กลาง2', 'ค']);
  assert.ok(r.words[1].start > 103 && r.words[1].end < 110, JSON.stringify(r.words[1]));
  assert.ok(r.words[3].start > 112 && r.words[3].end < 120, JSON.stringify(r.words[3]));
});

test('ถอดช่วงที่ขาดซ้ำไม่สำเร็จ (คิวเต็ม) → ไม่ทิ้งทั้งท่อน · บอกว่าขาดช่วงไหน', async () => {
  let n = 0;
  const fetchImpl = async () => (++n === 1 ? ok({ segments: [], words: [{ word: ' ก', start: 0.2, end: 3 }, { word: ' ค', start: 20, end: 27.5 }] }) : new Response('x', { status: 429, headers: { 'retry-after': '300' } }));
  const r = await T.transcribeCovered(cfg, speechWav(), { offset: 10, fetchImpl, gate: fastGate(), deadline: Date.now() + 60000 });
  assert.equal(r.words.length, 2);
  assert.equal(r.missed.length, 1);
  assert.ok(r.missed[0].a <= 13.2 && r.missed[0].b >= 29.8, JSON.stringify(r.missed));
  assert.match(r.gapError, /คิวเต็ม/);
});

test('รอยต่อท่อน: เก็บเฉพาะคำของช่วงตัวเอง · คำเดียวกันจากสองท่อนเหลือคำเดียว', async () => {
  const fetchImpl = async () => ok({ segments: [], words: [{ word: ' หัว', start: 0.1, end: 0.6 }, { word: ' กลาง', start: 5, end: 6 }, { word: ' ท้าย', start: 27.3, end: 27.9 }] });
  const r = await T.transcribeCovered(cfg, speechWav(), { offset: 50, keep: { a: 50.8, b: 77.2 }, fetchImpl, gate: fastGate(), retryGaps: false });
  assert.deepEqual(r.words.map((w) => w.text.trim()), ['กลาง']);
  const merged = T.dedupeWords([{ text: ' ไป', start: 10, end: 10.4 }, { text: 'ไป', start: 10.02, end: 10.41 }, { text: ' ไป', start: 10.5, end: 10.9 }]);
  assert.equal(merged.length, 2, 'คำซ้ำที่เวลาทับกันตัดออก · พูดซ้ำจริง (คนละเวลา) เก็บไว้');
});

test('ข้อความ error/ระบบ ไม่กลายเป็นบรรทัดซับ', () => {
  const w = (text, start) => ({ text, start, end: start + 0.8 });
  const cues = buildCues([w(' สวัสดีครับ', 0), w(' Error 429: Too Many Requests', 3), w(' undefined', 6), w(' ไปต่อกันเลย', 9)]);
  assert.deepEqual(cues.map((c) => c.text), ['สวัสดีครับ', 'ไปต่อกันเลย']);
});

test('แบ่งท่อนแบบเผื่อหัวท้าย: ช่วงของแต่ละท่อนต่อกันพอดี ไม่มีรูรั่ว · เสียงที่ส่งยาวกว่าช่วงละ 0.8 วิ', async () => {
  const { planParts } = await import('../public/speechcut.mjs');
  const clip = sim.makeClip(120, 3);
  const parts = planParts(clip.pcm, sim.RATE);
  assert.ok(parts.length >= 5);
  assert.equal(parts[0].keepA, 0);
  for (let i = 1; i < parts.length; i++) assert.equal(parts[i].keepA, parts[i - 1].keepB);
  assert.ok(Math.abs(parts.at(-1).keepB - 120) < 0.05);
  assert.ok(parts.every((p) => p.end - p.start <= 28 + 1.6 + 0.01));
  assert.ok(Math.abs(parts[1].keepA - parts[1].start - 0.8) < 0.001);
});

test('คลิปเกมยาว 3 นาที (เสียงเกมดังตลอด พูดยาวรวดเดียว Whisper ข้ามบางช่วง Groq จำกัดครั้งต่อนาที) → ได้ทุกคำ ไม่ซ้ำ ไม่โดน 429', async () => {
  const { planParts, wavBytes } = await import('../public/speechcut.mjs');
  const clip = sim.makeClip(180, 11);
  const WIN = 1500;
  const g = sim.fakeGroq(clip, { windowMs: WIN, limit: 6 });
  const gate = T.createGate({ rpm: 5, windowMs: WIN });
  const parts = planParts(clip.pcm, sim.RATE);
  let words = [], next = 0;
  const worker = async () => {
    while (next < parts.length) {
      const p = parts[next++];
      const r = await T.transcribeCovered(cfg, Buffer.from(wavBytes(clip.pcm.subarray(p.a, p.b), sim.RATE)), { offset: p.start, keep: { a: p.keepA, b: p.keepB }, fetchImpl: g.fetchImpl, gate, deadline: Date.now() + 100000 });
      assert.deepEqual(r.missed, []);
      words.push(...r.words);
    }
  };
  await Promise.all([worker(), worker()]);
  words = T.dedupeWords(words.sort((a, b) => a.start - b.start));
  const c = sim.coverage(clip, words);
  assert.equal(c.pct, 100, JSON.stringify(c));
  assert.equal(c.dup, 0);
  assert.equal(g.stats.limited, 0, 'คิวในร้านกันไม่ให้ Groq ตอบ 429');
});

test('แปลงคลิปมือถือ (HEVC/VFR) เก็บเวลาเฟรมเดิม ไม่เติม/ทิ้งเฟรมจนภาพกระตุก', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'render-engine.js'), 'utf8');
  const exec = /ff\.exec\(\[[^\]]*\]/.exec(src.slice(src.indexOf('export async function playableClip')));
  assert.ok(exec, 'หา ff.exec ไม่เจอ');
  assert.match(exec[0], /'-fps_mode', 'passthrough'/);
});

test('ประโยคที่ Whisper แต่งจากเสียงเกม (ไม่มั่นใจ) ถูกตัด · เสียงพูดจริงที่ความมั่นใจต่ำแต่ยาว ยังเก็บไว้', () => {
  const s = T.cleanSegments([
    { text: ' แล้วก็ขอบคุณทุกคนที่ยังจำช่องนี้ได้นะคะ', no_speech_prob: 0.15, avg_logprob: -1.8, compression_ratio: 2.6 },
    { text: ' เท่ารักทีควัฒนิยังเฉยของดูเข้า', no_speech_prob: 0.5, avg_logprob: -1.3, compression_ratio: 1.1 },
    { text: ' อะไร สั้นไม่เม df', no_speech_prob: 0.1, avg_logprob: -1.7, compression_ratio: 1 },
    { text: ' ริงๆ ผมสักครั้งเล่นทั้ง 2', no_speech_prob: 0.05, avg_logprob: -0.4, compression_ratio: 1.1 },
  ]);
  assert.deepEqual(s.map((x) => x.bad), [false, true, true, false]);
  // ถอดซ้ำช่วงที่ขาด: เก็บเฉพาะที่มั่นใจ
  const g = T.cleanSegments([{ text: ' ไปต่อกันเลย', no_speech_prob: 0.1, avg_logprob: -0.9 }, { text: ' ไปต่อกันเลยนะ', no_speech_prob: 0.05, avg_logprob: -0.3 }], { strict: true });
  assert.deepEqual(g.map((x) => x.bad), [true, false]);
});

test('เศษอักษรอังกฤษที่หลุดกลางประโยคไทย (df) ถูกตัด · คำเกมสั้นๆ (gg) เก็บไว้', () => {
  const w = (text, start) => ({ text, start, end: start + 0.5 });
  const cues = buildCues([w(' อะไร', 0), w(' สั้นไม่เม', 0.5), w(' df', 1), w(' gg', 1.5), w(' ครับ', 2)], { maxChars: 32 });
  assert.equal(cues.map((c) => c.text).join(' '), 'อะไร สั้นไม่เม gg ครับ');
});

test('กรองเสียงก่อนส่งถอด: ลดเสียงเบส/ระเบิด (50 Hz) เทียบกับย่านเสียงพูด (1 kHz) และดังพอดีไม่แตก', async () => {
  const { voiceFilter } = await import('../public/speechcut.mjs');
  const r = 16000, n = r * 2, p = new Int16Array(n);
  for (let i = 0; i < n; i++) p[i] = Math.round(3000 * Math.sin((2 * Math.PI * 50 * i) / r) + 1000 * Math.sin((2 * Math.PI * 1000 * i) / r));
  const o = voiceFilter(p, r);
  const amp = (a, f) => { let re = 0, im = 0; for (let i = r; i < n; i++) { re += a[i] * Math.cos((2 * Math.PI * f * i) / r); im += a[i] * Math.sin((2 * Math.PI * f * i) / r); } return Math.hypot(re, im) / (r / 2); };
  assert.ok(amp(o, 50) / amp(o, 1000) < (amp(p, 50) / amp(p, 1000)) / 4, 'เบสลดลงมากกว่า 12 dB เมื่อเทียบเสียงพูด');
  assert.ok(Math.max(...o.slice(r)) <= 32767 && Math.max(...o.slice(r)) > 8000);
});

'use strict';
// ซับครบทุกช่วงที่พูด: แบ่งท่อนตรงช่วงเงียบ · ไม่ทิ้งเสียงพูดที่ความมั่นใจต่ำ (คลิปเกม/มีเพลง) · ช่วงที่ Whisper ข้าม ถอดซ้ำ
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { missedSpeech, transcribeCovered, cleanSegments, wavHeader } = require('../src/transcribe');

const RATE = 16000;
// เสียงจำลอง: [วินาทีเริ่ม, วินาทีจบ, ความดัง] ช่วงอื่นเงียบ
function pcmOf(sec, loud) {
  const pcm = new Int16Array(Math.round(sec * RATE));
  for (const [a, b, amp] of loud) for (let i = Math.round(a * RATE); i < Math.round(b * RATE); i++) pcm[i] = Math.round(amp * Math.sin(i / 3));
  return pcm;
}
const wavOf = (pcm) => Buffer.concat([wavHeader(pcm.length * 2, { rate: RATE, channels: 1, bits: 16 }), Buffer.from(pcm.buffer)]);

test('หาช่วงที่ยังมีเสียงพูดแต่ไม่ได้คำ (ช่วงเงียบจริงไม่นับ)', () => {
  const pcm = pcmOf(20, [[0, 4, 3000], [6, 12, 3000], [15, 20, 3000]]);
  const words = [{ start: 0.2, end: 3.8 }, { start: 15.1, end: 19.8 }];
  // 4–6 เงียบ, 6–12 ดังแต่ไม่มีคำ, 12–15 เงียบ
  const gaps = missedSpeech(words, pcm, RATE);
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0].a <= 6 && gaps[0].b >= 12, JSON.stringify(gaps));
  assert.deepEqual(missedSpeech([{ start: 0, end: 4 }, { start: 6, end: 12 }, { start: 15, end: 20 }], pcm, RATE), []);
});

test('ช่วงที่ Whisper ข้ามไป ถอดซ้ำเฉพาะช่วงนั้นแล้วรวมคำกลับตามเวลา', async () => {
  const pcm = pcmOf(20, [[0, 20, 3000]]);
  const calls = [];
  const fetchImpl = async (url, { body }) => {
    const bytes = (await body.get('file').arrayBuffer()).byteLength;
    calls.push(bytes);
    const first = calls.length === 1;
    const j = first
      ? { segments: [{ start: 0, end: 5, text: ' ก่อน' }, { start: 14, end: 20, text: ' หลัง' }], words: [{ word: 'ก่อน', start: 0.5, end: 4.5 }, { word: ' หลัง', start: 14.5, end: 19.5 }] }
      : { segments: [{ start: 0, end: 9, text: ' ตรงกลาง' }], words: [{ word: ' ตรงกลาง', start: 1, end: 8 }] };
    return new Response(JSON.stringify(j), { status: 200 });
  };
  const cfg = { groq: { apiBase: 'http://groq.test', apiKey: 'k', model: 'whisper-large-v3' } };
  const r = await transcribeCovered(cfg, wavOf(pcm), { offset: 100, fetchImpl });
  assert.equal(calls.length, 2, 'ถอดซ้ำ 1 ช่วง');
  assert.ok(calls[1] < calls[0] / 1.5, 'ส่งแค่ช่วงที่ขาด');
  assert.deepEqual(r.words.map((w) => w.text.trim()), ['ก่อน', 'ตรงกลาง', 'หลัง']);
  assert.ok(r.words[1].start > 104 && r.words[1].end < 114.5, JSON.stringify(r.words[1]));
});

test('เสียงพูดจริงที่ความมั่นใจต่ำ (มีเสียงเกม/เพลง) ไม่ถูกทิ้ง · ข้อความจาก prompt ที่หลุดมาตอนไม่ค่อยมีเสียงพูด ถูกทิ้ง', () => {
  const s = cleanSegments([
    { text: ' แล้วก็ขอบคุณทุกคนที่ยังจำช่องนี้ได้นะคะ', no_speech_prob: 0.15, avg_logprob: -1.8, compression_ratio: 2.6 },
    { text: ' นะคะ', no_speech_prob: 0.45, avg_logprob: -0.9, compression_ratio: 0.8 },
    { text: ' นะคะ', no_speech_prob: 0.01, avg_logprob: -0.2, compression_ratio: 0.8 },
  ]);
  assert.deepEqual(s.map((x) => x.bad), [false, true, false]);
});

test('แบ่งเสียงเป็นท่อนไม่เกิน 28 วินาที ตัดตรงช่วงเงียบ · ท่อนเงียบสนิทถูกทำเครื่องหมาย', async () => {
  const { cutSpeech, wavBytes } = await import('../public/speechcut.mjs');
  // พูดยาว 70 วินาที เว้นหายใจ (เงียบ 0.4 วิ) ทุกๆ ~7 วิ แล้วเงียบ 30 วิท้ายคลิป
  const loud = [];
  for (let t = 0; t < 70; t += 7) loud.push([t, t + 6.6, 2500]);
  const pcm = pcmOf(100, loud);
  const parts = cutSpeech(pcm, RATE);
  for (const p of parts) assert.ok(p.end - p.start <= 28.01, `ท่อนยาว ${p.end - p.start}`);
  // ทุกจุดตัด (ยกเว้นท้าย) อยู่ในช่วงเงียบ
  for (const p of parts.slice(0, -1)) {
    const inGap = loud.every(([a, b]) => p.end <= a || p.end >= b);
    assert.ok(inGap, `ตัดกลางคำที่ ${p.end}`);
  }
  assert.equal(parts[parts.length - 1].silent, true);
  assert.equal(parts.filter((p) => p.silent).length, 1);
  assert.equal(parts[0].start, 0);
  assert.equal(parts[parts.length - 1].end, 100);
  const w = wavBytes(pcm.subarray(0, 16000), RATE);
  assert.equal(w.length, 44 + 32000);
});

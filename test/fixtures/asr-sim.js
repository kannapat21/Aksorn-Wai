'use strict';
/*
 * จำลองคลิปยาวที่มีเสียงเกมดังตลอด + Groq ปลอมที่ทำตัวแบบ Whisper จริง เพื่อวัดว่าซับครบทั้งคลิปไหม
 *   - เสียง: เสียงเกม/เพลงดังตลอด (ไม่มีช่วงเงียบสนิท) + ช่วงพูด บางช่วงพูดยาวรวดเดียว 30+ วินาที (ไม่มีที่ตัด)
 *   - คำจริง (ความจริง): คำละ ~0.45 วินาทีตลอดช่วงพูด
 *   - Groq ปลอม: ทิ้งคำที่อยู่ชิดขอบไฟล์ (โดนตัดครึ่ง), ข้ามช่วงพูด 4 วินาทีในท่อนยาว (แบบ Whisper ข้าม),
 *     รับได้ไม่เกิน limit ครั้งต่อ windowMs เกินแล้วตอบ 429
 */
const { wavHeader, parseWav } = require('../../src/transcribe');

const RATE = 16000;

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

// → { pcm, words: [{ id, text, start, end }], speech: [[a,b]] }
function makeClip(sec, seed = 7) {
  const r = rng(seed);
  const pcm = new Int16Array(Math.round(sec * RATE));
  // เสียงเกม: สุ่มไม่ซ้ำทุก sample (ใช้หาตำแหน่งท่อนในคลิปได้) ไม่มีค่า 0
  for (let i = 0; i < pcm.length; i++) { const v = Math.round((r() * 2 - 1) * 1100); pcm[i] = v === 0 ? 1 : v; }
  const speech = [];
  let t = 1.5, k = 0;
  while (t < sec - 2) {
    const long = k % 5 === 2; // ทุกๆ 5 ช่วง มีพูดยาวรวดเดียว 32 วินาที
    const len = long ? 32 : 3 + r() * 6;
    const b = Math.min(sec - 1, t + len);
    speech.push([t, b]);
    t = b + 0.35 + r() * 1.2;
    k++;
  }
  const words = [];
  let n = 0;
  for (const [a, b] of speech) {
    for (let i = Math.round(a * RATE); i < Math.round(b * RATE); i++) pcm[i] = Math.max(-32767, Math.min(32767, pcm[i] + Math.round(3200 * Math.sin(i / 3.1))));
    for (let s = a; s + 0.4 <= b; s += 0.45) words.push({ id: n, text: ` w${n++}`, start: s, end: s + 0.4 });
  }
  return { pcm, words, speech, sec };
}

const wavOf = (pcm) => Buffer.concat([wavHeader(pcm.length * 2, { rate: RATE, channels: 1, bits: 16 }), Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length * 2)]);

// หาว่าไฟล์ที่ส่งมาคือช่วงไหนของคลิป (ไฟล์ที่ต่อหลายช่วงคั่นด้วยความเงียบ 0 ล้วน)
function locate(clip, filePcm) {
  const runs = [];
  let i = 0;
  while (i < filePcm.length) {
    while (i < filePcm.length && filePcm[i] === 0) i++;
    if (i >= filePcm.length) break;
    let j = i;
    while (j < filePcm.length) {
      if (filePcm[j] === 0) { let z = j; while (z < filePcm.length && filePcm[z] === 0) z++; if (z - j > 400 || z >= filePcm.length) break; j = z; } else j++;
    }
    const head = filePcm.subarray(i, i + 8);
    let at = -1;
    outer: for (let p = 0; p + 8 <= clip.pcm.length; p++) {
      for (let q = 0; q < 8; q++) if (clip.pcm[p + q] !== head[q]) continue outer;
      at = p; break;
    }
    if (at >= 0) runs.push({ fa: i / RATE, fb: j / RATE, ca: at / RATE });
    i = j;
  }
  return runs;
}

function fakeGroq(clip, { limit = 20, windowMs = 60000, edge = 0.35, skip = 4, retryAfter = 1 } = {}) {
  const sent = [];
  const stats = { calls: 0, limited: 0 };
  const fetchImpl = async (url, { body }) => {
    const now = Date.now();
    while (sent.length && sent[0] <= now - windowMs) sent.shift();
    if (sent.length >= limit) { stats.limited++; return new Response('{"error":{"message":"rate limit"}}', { status: 429, headers: { 'retry-after': String(retryAfter) } }); }
    sent.push(now);
    stats.calls++;
    const buf = Buffer.from(await body.get('file').arrayBuffer());
    const w = parseWav(buf);
    const pcm = new Int16Array(w.data.buffer.slice(w.data.byteOffset, w.data.byteOffset + w.data.length));
    const runs = locate(clip, pcm);
    const out = [];
    for (const r of runs) {
      const len = r.fb - r.fa;
      // Whisper ข้ามช่วงพูดกลางท่อนยาว (หลังเสียงเกมดังๆ)
      const sa = len > 10 ? r.fa + len * 0.4 : Infinity;
      for (const x of clip.words) {
        const fs = x.start - r.ca + r.fa, fe = x.end - r.ca + r.fa;
        if (fs < r.fa + edge || fe > r.fb - edge) continue; // คำที่ชิดขอบไฟล์ (ถูกตัดครึ่ง) หาย
        if (fs >= sa && fs < sa + skip) continue;
        out.push({ word: x.text, start: Math.round(fs * 100) / 100, end: Math.round(fe * 100) / 100 });
      }
    }
    out.sort((a, b) => a.start - b.start);
    const segments = out.length ? [{ start: out[0].start, end: out[out.length - 1].end, text: out.map((x) => x.word).join(''), avg_logprob: -0.3, no_speech_prob: 0.05, compression_ratio: 1.2 }] : [];
    return new Response(JSON.stringify({ text: segments.map((s) => s.text).join(''), segments, words: out }), { status: 200 });
  };
  return { fetchImpl, stats };
}

// คำที่ได้ (มีข้อความ w123) → ครอบคลุมคำจริงกี่ % · ซ้ำกี่คำ · ช่วงที่หายยาวสุด
function coverage(clip, got) {
  const seen = new Map();
  for (const w of got) { const m = /w(\d+)/.exec(w.text); if (m) seen.set(Number(m[1]), (seen.get(Number(m[1])) || 0) + 1); }
  const lost = clip.words.filter((w) => !seen.has(w.id));
  let worst = 0, run = 0, prev = -2;
  for (const w of lost) { run = w.id === prev + 1 ? run + 0.45 : 0.45; prev = w.id; worst = Math.max(worst, run); }
  return { total: clip.words.length, got: clip.words.length - lost.length, pct: Math.round(((clip.words.length - lost.length) / clip.words.length) * 1000) / 10, dup: [...seen.values()].filter((v) => v > 1).length, worstGapSec: Math.round(worst * 10) / 10 };
}

module.exports = { RATE, makeClip, fakeGroq, coverage, wavOf, locate };

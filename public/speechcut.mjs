/*
 * แบ่งเสียงพูดเป็นท่อนสั้นๆ ตรง "ช่วงเงียบ" ก่อนส่งให้ Whisper ถอด
 *
 *  - ท่อนละไม่เกิน ~30 วินาที = หน้าต่างเดียวของ Whisper พอดี (ท่อนยาวกว่านี้ Whisper ต้องเลื่อนหน้าต่างเอง
 *    แล้วมักข้ามประโยค/แต่งคำเองตรงรอยต่อ)
 *  - ตัดตรงจุดที่เงียบที่สุดในช่วงท้ายท่อน ไม่ตัดกลางคำ
 *  - ท่อนที่เงียบสนิททั้งท่อนไม่ต้องส่ง (Whisper ชอบแต่งประโยคขึ้นเองตอนเงียบ)
 *
 * ใช้ได้ทั้งในเบราว์เซอร์ (render-engine.js) และในเทสต์ (Node)
 */
export const FRAME_SEC = 0.02;

// ความดังเฉลี่ย (RMS) ทุก 20 มิลลิวินาที
export function energy(pcm, rate) {
  const per = Math.max(1, Math.round(rate * FRAME_SEC));
  const n = Math.ceil(pcm.length / per);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    const a = f * per, b = Math.min(pcm.length, a + per);
    for (let i = a; i < b; i++) s += pcm[i] * pcm[i];
    out[f] = Math.sqrt(s / Math.max(1, b - a));
  }
  return out;
}

/*
 * pcm: Int16Array (โมโน) → [{ start, end (วินาที), a, b (ตำแหน่ง sample), silent }]
 *   maxSec: ท่อนยาวสุด · minSec: หาที่ตัดตั้งแต่วินาทีนี้ของท่อน · silentRms: เบากว่านี้ทั้งท่อน = เงียบ (~-52 dBFS)
 */
export function cutSpeech(pcm, rate, { maxSec = 28, minSec = 14, silentRms = 80 } = {}) {
  const e = energy(pcm, rate);
  const per = Math.max(1, Math.round(rate * FRAME_SEC));
  const total = e.length;
  const maxF = Math.round(maxSec / FRAME_SEC), minF = Math.round(minSec / FRAME_SEC);
  const win = 10; // ความเงียบเฉลี่ย 0.2 วินาทีรอบจุดตัด
  const cuts = [0];
  let s = 0;
  while (total - s > maxF) {
    let best = s + maxF, bestV = Infinity;
    for (let f = s + minF; f <= s + maxF; f++) {
      let v = 0;
      for (let k = f - win / 2; k < f + win / 2; k++) v += e[Math.max(0, Math.min(total - 1, k))];
      // เท่ากันให้เลือกจุดที่ไกลกว่า (ท่อนยาวขึ้น ส่งน้อยครั้งลง)
      if (v <= bestV) { bestV = v; best = f; }
    }
    cuts.push(best);
    s = best;
  }
  cuts.push(total);
  const parts = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const fa = cuts[i], fb = cuts[i + 1];
    let peak = 0;
    for (let f = fa; f < fb; f++) if (e[f] > peak) peak = e[f];
    const a = fa * per, b = Math.min(pcm.length, fb * per);
    if (b <= a) continue;
    parts.push({ start: a / rate, end: b / rate, a, b, silent: peak < silentRms });
  }
  return parts;
}

/*
 * ท่อนที่จะส่งให้ร้านถอด: ตัดตรงช่วงเงียบ ข้ามท่อนเงียบสนิท แล้วเผื่อหัว/ท้ายท่อนละ pad วินาที
 *   คลิปเกม/มีเพลงไม่มีช่วงเงียบให้ตัด จุดตัดจึงอาจตกกลางคำ และ Whisper มักทิ้งคำที่ถูกตัดครึ่งตรงขอบไฟล์
 *   ร้านถอดทั้งส่วนเผื่อ แล้วเก็บเฉพาะคำที่กึ่งกลางอยู่ในช่วง keepA–keepB ของท่อน → คำตรงรอยต่อไม่ขาดและไม่ซ้ำ
 * → [{ a, b (sample ที่ส่งจริง), start, end (วินาทีที่ส่งจริง), keepA, keepB (วินาที ช่วงของท่อนนี้) }]
 */
export function planParts(pcm, rate, { pad = 0.8, ...opt } = {}) {
  const all = cutSpeech(pcm, rate, opt);
  const loud = all.filter((p) => !p.silent);
  const P = Math.round(rate * pad);
  return (loud.length ? loud : all).map((p) => {
    const a = Math.max(0, p.a - P), b = Math.min(pcm.length, p.b + P);
    return { a, b, start: a / rate, end: b / rate, keepA: p.start, keepB: p.end };
  });
}

/*
 * เน้นเสียงพูดก่อนส่งถอด: คลิปเกมมีเสียงระเบิด/เบสหนัก และเสียงแหลมของเอฟเฟกต์ปนกับเสียงคน
 *   - ตัดความถี่ต่ำกว่า ~120 Hz (เสียงตูม/เบส ไม่มีข้อมูลคำพูด) และสูงกว่า ~6.5 kHz
 *   - ปรับความดังทั้งคลิปให้เสียงพูดดังพอดี (คลิปที่อัดเบาๆ Whisper มักฟังผิด) ไม่ให้แตก
 * ใช้เฉพาะเสียงที่ส่งให้ Whisper (การหาจุดตัด/ช่วงเงียบใช้เสียงเดิม)
 */
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function coeffs(type, f, rate, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * f) / rate, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const k = type === 'hp' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2];
  return [k[0] / a0, k[1] / a0, k[2] / a0, (-2 * c) / a0, (1 - al) / a0];
}
export function voiceFilter(pcm, rate, { low = 120, high = 6500 } = {}) {
  let y = biquad(pcm, ...coeffs('hp', low, rate));
  if (high < rate / 2 - 100) y = biquad(y, ...coeffs('lp', high, rate));
  // ความดัง: ให้ช่วงที่ดังที่สุด 1% (มักเป็นเสียงพูด/เสียงเกมดังสุด) อยู่ราว -3 dBFS · ขยายไม่เกิน 8 เท่า
  const abs = new Float32Array(Math.ceil(y.length / 64));
  for (let i = 0, k = 0; i < y.length; i += 64, k++) abs[k] = Math.abs(y[i]);
  const ref = abs.slice().sort()[Math.floor(abs.length * 0.99)] || 1;
  const gain = Math.min(8, Math.max(0.5, 23000 / ref));
  const out = new Int16Array(y.length);
  for (let i = 0; i < y.length; i++) {
    let v = y[i] * gain;
    if (v > 30000 || v < -30000) v = Math.sign(v) * (30000 + 2767 * Math.tanh((Math.abs(v) - 30000) / 2767)); // ไม่ให้แตก
    out[i] = Math.round(v);
  }
  return out;
}

// WAV 16-bit โมโน (หัว 44 ไบต์)
export function wavBytes(pcm, rate) {
  const head = new DataView(new ArrayBuffer(44));
  const put = (o, s) => { for (let k = 0; k < 4; k++) head.setUint8(o + k, s.charCodeAt(k)); };
  const n = pcm.length * 2;
  put(0, 'RIFF'); head.setUint32(4, 36 + n, true); put(8, 'WAVE');
  put(12, 'fmt '); head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 1, true);
  head.setUint32(24, rate, true); head.setUint32(28, rate * 2, true); head.setUint16(32, 2, true); head.setUint16(34, 16, true);
  put(36, 'data'); head.setUint32(40, n, true);
  const out = new Uint8Array(44 + n);
  out.set(new Uint8Array(head.buffer), 0);
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, n), 44);
  return out;
}

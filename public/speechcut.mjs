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

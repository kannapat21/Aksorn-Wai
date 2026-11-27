'use strict';
/*
 * ตัวถอดเสียง
 *   - ในเครื่อง: เรียก scripts/transcribe.py (mlx-whisper บน Mac ชิป Apple / faster-whisper) ไม่ส่งเสียงออกนอกเครื่อง
 *   - groq: ส่งเสียง (WAV 16 kHz โมโน) ให้ Whisper large-v3 บน Groq ถอด ฟรีตามโควตา ไม่กินแรมเครื่องร้าน
 *           ไฟล์ละไม่เกิน 25 MB (ฟรี) จึงแบ่งเสียงยาวเป็นท่อนละ ~10 นาทีก่อนส่ง
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'transcribe.py');

function run(cmd, args, { onLine, timeoutMs = 0, env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: env || process.env });
    let out = '', err = '', buf = '';
    let timer = null;
    if (timeoutMs) timer = setTimeout(() => { p.kill('SIGKILL'); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; if (out.length > 1e6) out = out.slice(-1e6); });
    p.stderr.on('data', (d) => {
      err += d; if (err.length > 2e5) err = err.slice(-2e5);
      if (!onLine) return;
      buf += d;
      let i;
      while ((i = buf.search(/[\r\n]/)) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line) onLine(line); }
    });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code, sig) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else { const e = new Error(`${path.basename(cmd)} จบด้วย ${code ?? sig}\n${err.slice(-1500)}`); e.code = code; e.stdout = out; reject(e); }
    });
  });
}

// ---------- Groq ----------
const GROQ_MAX_BYTES = 20 * 1024 * 1024; // ต่ำกว่าเพดาน 25 MB ของแพ็กฟรี เผื่อหัวไฟล์/multipart

// แยกหัว WAV (PCM) → { rate, channels, bits, data }
function parseWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('ไม่ใช่ไฟล์ WAV');
  let off = 12, fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') {
      if (!fmt) throw new Error('WAV ไม่มีส่วน fmt');
      return { ...fmt, data: buf.subarray(off + 8, Math.min(buf.length, off + 8 + size)) };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('WAV ไม่มีข้อมูลเสียง');
}

function wavHeader(dataBytes, { rate, channels, bits }) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE((rate * channels * bits) / 8, 28); h.writeUInt16LE((channels * bits) / 8, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(dataBytes, 40);
  return h;
}

// แบ่ง WAV เป็นท่อนละไม่เกิน maxBytes → [{ start (วินาที), buf }]
function splitWav(buf, maxBytes = GROQ_MAX_BYTES) {
  const w = parseWav(buf);
  const frame = (w.channels * w.bits) / 8;
  const per = Math.floor((maxBytes - 44) / frame) * frame;
  const out = [];
  for (let i = 0; i < w.data.length; i += per) {
    const part = w.data.subarray(i, i + per);
    out.push({ start: i / frame / w.rate, buf: Buffer.concat([wavHeader(part.length, w), part]) });
  }
  return out;
}

// Groq ส่งคำมาโดยตัดช่องว่างออก → ดูจากข้อความของท่อน (segment) ว่าหน้าคำไหนมีเว้นวรรค แล้วใส่กลับ (ใช้ตัดบรรทัดซับ)
function withSpaces(words, segments) {
  const full = (segments || []).map((x) => String(x.text || '')).join(' ');
  let cur = 0;
  return words.map((w) => {
    const t = String(w.word ?? w.text ?? '').trim();
    const at = t ? full.indexOf(t, cur) : -1;
    let lead = /^\s/.test(String(w.word ?? ''));
    if (at >= 0) {
      if (at > 0 && /\s/.test(full[at - 1])) lead = true;
      cur = at + t.length;
    }
    return { text: (lead ? ' ' : '') + t, start: Number(w.start), end: Number(w.end) };
  });
}

// บริบทตั้งต้นให้ Whisper: ประโยคไทยสะอาด ไม่มีคำเติม (เอ่อ/อืม) เพื่อให้ถอดออกมาเป็นภาษาเขียนสั้นกระชับ
// ร้านไม่ส่งข้อความจากท่อนก่อนแล้ว (asrPrompt ยังรับได้) เพราะถ้าท่อนก่อนถอดผิด/วนซ้ำ ความผิดจะลามไปท่อนถัดไป
const BASE_PROMPT = 'สวัสดีครับ วันนี้เราจะมาเล่าเรื่องนี้ให้ฟังกันนะคะ ใช้ภาษาไทยเป็นหลัก มีคำภาษาอังกฤษปนบ้าง เช่น TikTok, YouTube, Facebook, เกม ROV, Mobile Legends, Free Fire';

// ประโยคที่ Whisper ชอบแต่งขึ้นเองตอนเงียบ/มีแต่เพลง
const HALLUCINATION_RE = /^(ขอบคุณ(ที่|สำหรับการ)?รับชม.*|ขอบคุณครับ|ขอบคุณค่ะ|ฝากกด(ไลค์|ติดตาม|subscribe).*|กด(ไลค์|ติดตาม|subscribe|กระดิ่ง).*|(ซับ|คำบรรยาย)(ไตเติ้ล)?(ภาษาไทย)?(โดย|by).*|subtitles? by.*|thank(s| you) for watching.*|\.+|…+)$/iu;

/*
 * ตัดท่อนที่น่าจะไม่ใช่เสียงพูดจริง
 *   - no_speech_prob สูง และความมั่นใจต่ำ = ช่วงเงียบ/เพลงที่ถูกแต่งเป็นคำ (เกณฑ์เดียวกับ Whisper ต้นฉบับ)
 *   - ข้อความวนซ้ำ (ไปไปไปไป…) · ภาษาไทยบีบอัดได้ดีกว่าอังกฤษ compression_ratio จึงสูงเป็นปกติ ต้องเห็นการวนซ้ำจริงด้วย
 *   - ประโยคแต่งเองยอดฮิต ("ขอบคุณที่รับชม") หรือข้อความจากบริบทตั้งต้น (prompt) ที่หลุดออกมา ในช่วงที่ไม่ค่อยมีเสียงพูด
 *   - ท่อนที่ซ้ำกับท่อนก่อนหน้าแบบเป๊ะๆ ติดกัน
 * ไม่ตัดท่อนเพียงเพราะความมั่นใจต่ำ: คลิปเกม/มีเพลงประกอบ เสียงพูดจริงมักได้ความมั่นใจต่ำ ถ้าตัดทิ้งซับจะหายเป็นช่วงๆ
 */
const squash = (t) => String(t || '').replace(/[\s.,!?…"'“”]/g, '');
const PROMPT_FLAT = squash(BASE_PROMPT);
const loops = (t) => /(.{1,6}?)\1{3,}/u.test(squash(t));
/*
 * strict: ใช้กับการถอดซ้ำช่วงที่ Whisper ข้าม (ช่วงสั้น มักมีแต่เสียงเกม/เอฟเฟกต์) → เก็บเฉพาะท่อนที่มั่นใจจริง
 *   ไม่งั้น Whisper แต่งคำไทยที่ไม่มีความหมายขึ้นมาเติมช่องว่าง (เช่น "เท่ารักทีควัฒนิยังเฉย…")
 */
function cleanSegments(raw, { strict = false } = {}) {
  const keep = [];
  let last = '';
  for (const x of raw || []) {
    const text = String(x.text || '').trim();
    const ns = Number(x.no_speech_prob) || 0;
    const lp = Number.isFinite(Number(x.avg_logprob)) ? Number(x.avg_logprob) : 0;
    const cr = Number(x.compression_ratio) || 0;
    const norm = squash(text);
    let bad = !norm || (ns > 0.6 && lp < -1) || (cr > 2.4 && loops(text)) || lp < -2.5;
    // ไม่ค่อยมั่นใจว่าเป็นเสียงพูด และถอดได้ไม่มั่นใจ = มักเป็นคำที่แต่งจากเสียงเกม/เพลง
    if (!bad && ns > 0.35 && lp < -1.1) bad = true;
    // ท่อนสั้นๆ ที่ความมั่นใจต่ำมาก (เศษคำมั่วๆ แทรกระหว่างเสียงเกม)
    if (!bad && lp < -1.5 && norm.length <= 16) bad = true;
    if (!bad && strict && (lp < -0.7 || ns > 0.35)) bad = true;
    const unsure = ns > 0.2 || lp < -0.7;
    if (!bad && unsure && HALLUCINATION_RE.test(text.replace(/\s+/g, ''))) bad = true;
    if (!bad && unsure && norm.length >= 2 && PROMPT_FLAT.includes(norm)) bad = true;
    if (!bad && norm && norm === last) bad = true;
    if (norm && !bad) last = norm;
    keep.push({ ...x, bad });
  }
  return keep;
}
const THAI_PROMPT = BASE_PROMPT;
const asrPrompt = (prev = '') => (prev ? `${BASE_PROMPT} ${String(prev).replace(/\s+/g, ' ').trim().slice(-120)}` : BASE_PROMPT);

// ---------- คิวส่งเสียงให้ Groq ----------
/*
 * แพ็กฟรีของ Groq รับถอดเสียงได้ราว 20 ครั้งต่อนาที ส่งเกิน = ตอบ 429 แล้วท่อนนั้นล้ม/ช่วงที่ถอดซ้ำหายเงียบๆ
 * (คลิป 10 นาที = ~22 ท่อน + ถอดซ้ำช่วงที่ขาด ส่ง 2 ท่อนพร้อมกัน เกินเพดานได้ง่าย)
 * จึงต่อคิวในร้านเอง: ไม่เกิน rpm ครั้งในทุก 60 วินาที (รวมทุกลูกค้า) · Groq บอกให้รอ = หยุดทั้งคิวตามนั้น
 */
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
function busyError(sec) {
  const e = new Error(`Groq คิวเต็ม รออีก ${sec} วินาที`);
  e.status = 429;
  e.transient = true;
  e.retryAfter = Math.max(1, Math.ceil(sec));
  e.userMessage = 'ระบบถอดเสียงมีคิวยาวชั่วคราว กำลังรอคิวแล้วลองใหม่ให้อัตโนมัติ';
  return e;
}
function createGate({ rpm = 18, windowMs = 60000, now = () => Date.now(), wait = sleep } = {}) {
  const slots = []; // เวลาที่จองส่งไว้ (เรียงจากน้อยไปมาก)
  let pausedUntil = 0;
  return {
    // จองคิวหนึ่งครั้ง · ต้องรอนานกว่า maxWaitMs = ไม่จอง แล้วโยน 429 (ให้เบราว์เซอร์รอแล้วส่งท่อนนี้ใหม่เอง)
    async take(maxWaitMs = Infinity) {
      const t = now();
      while (slots.length && slots[0] <= t - windowMs) slots.shift();
      let at = Math.max(t, pausedUntil);
      for (;;) {
        const inWin = slots.filter((x) => x > at - windowMs && x <= at);
        if (inWin.length < rpm) break;
        at = inWin[inWin.length - rpm] + windowMs;
      }
      if (at - t > maxWaitMs) throw busyError((at - t) / 1000);
      slots.push(at);
      slots.sort((x, y) => x - y);
      if (at > t) await wait(at - t);
    },
    pause(ms) { pausedUntil = Math.max(pausedUntil, now() + ms); },
  };
}
const gates = new Map();
function gateFor(cfg) {
  const key = (cfg.groq && cfg.groq.apiKey) || '';
  if (!gates.has(key)) gates.set(key, createGate({ rpm: Math.max(1, Number(cfg.groq && cfg.groq.rpm) || 18) }));
  return gates.get(key);
}

/*
 * ท่อน (segment) ที่ Whisper ถอดเป็นข้อความได้ แต่รายการคำ (words) ขาดหายไปบางส่วน (เกิดกับภาษาไทยบ่อย)
 * → ใช้ข้อความของท่อนนั้นแทน แบ่งเวลาตามจำนวนตัวอักษร ไม่ให้ซับหายทั้งที่ถอดได้แล้ว
 * words / segments: เวลาในท่อนเสียง (ยังไม่บวก offset)
 */
function fillFromSegments(words, segments) {
  let out = words.slice();
  let filled = 0;
  for (const s of segments || []) {
    const text = String(s.text || '').replace(/\s+/g, ' ').trim();
    const a = Number(s.start), b = Number(s.end);
    const need = squash(text).length;
    if (need < 4 || !(b > a)) continue;
    const mid = (w) => (w.start + w.end) / 2;
    const inSeg = out.filter((w) => mid(w) >= a - 0.05 && mid(w) <= b + 0.05);
    const got = inSeg.reduce((n, w) => n + squash(w.text).length, 0);
    if (got >= need * 0.5) continue;
    out = out.filter((w) => !inSeg.includes(w));
    const pieces = text.split(' ').filter(Boolean);
    const total = pieces.reduce((n, p) => n + [...p].length, 0) || 1;
    let acc = 0;
    pieces.forEach((p, k) => {
      const st = a + ((b - a) * acc) / total;
      acc += [...p].length;
      out.push({ text: (k || /^\s/.test(String(s.text)) ? ' ' : '') + p, start: st, end: a + ((b - a) * acc) / total });
    });
    filled++;
  }
  if (filled) out.sort((x, y) => x.start - y.start);
  return { words: out, filled };
}

// ถอดเสียงท่อนเดียว (WAV ไม่เกิน 25 MB) → { words: [{text,start,end}], segments }
//   deadline: เวลา (ms) ที่ต้องตอบเบราว์เซอร์ให้ทัน (ไม่ให้เบราว์เซอร์ตัดสายแล้วส่งซ้ำ ซ้อนงานกันจนโควตาเต็ม)
//   ข้อผิดพลาดชั่วคราว (คิวเต็ม/Groq ล่ม/ช้า) มี e.transient = true → ร้านไม่ทำให้งานล้ม เบราว์เซอร์รอแล้วลองใหม่
async function groqTranscribe(cfg, wavBuf, { offset = 0, fetchImpl = globalThis.fetch, prompt = '', timeoutMs = 45000, deadline = Infinity, gate = gateFor(cfg), strict = false } = {}) {
  const G = cfg.groq;
  const form = () => {
    const fd = new FormData();
    fd.append('file', new Blob([wavBuf], { type: 'audio/wav' }), 'audio.wav');
    fd.append('model', G.model);
    fd.append('language', 'th');
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'word');
    fd.append('timestamp_granularities[]', 'segment');
    fd.append('temperature', '0');
    fd.append('prompt', asrPrompt(prompt));
    return fd;
  };
  const left = () => deadline - Date.now();
  const slow = (msg) => {
    const e = new Error(msg);
    e.status = 504;
    e.transient = true;
    e.userMessage = 'ระบบถอดเสียงตอบช้าผิดปกติ กำลังลองใหม่ให้อัตโนมัติ';
    return e;
  };
  const backoff = G.backoffMs || [1000, 3000, 8000];
  let r;
  for (let attempt = 0; ; attempt++) {
    await gate.take(Math.max(0, left() - 8000));
    let err = null;
    try {
      r = await fetchImpl(`${G.apiBase}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${G.apiKey}` }, body: form(), signal: AbortSignal.timeout(Math.max(1000, Math.min(timeoutMs, left()))) });
    } catch (e) { err = e; r = null; }
    if (r && r.ok) break;
    const pause = backoff[Math.min(attempt, backoff.length - 1)] + Math.round(Math.random() * 500);
    if (!r) {
      if (attempt >= 3 || left() < pause + 8000) throw slow(`Groq ไม่ตอบ: ${err && err.message}`);
      await sleep(pause);
      continue;
    }
    if (r.status === 429) {
      const ra = Number(r.headers.get('retry-after'));
      const waitMs = ra > 0 ? ra * 1000 : G.backoffMs ? backoff[Math.min(attempt, backoff.length - 1)] : 2 ** attempt * 2000;
      gate.pause(waitMs); // ทุกคำขอในร้านรอตาม Groq บอก ไม่ยิงซ้ำให้โดน 429 ต่อ
      await r.text().catch(() => '');
      if (attempt >= 3 || waitMs > left() - 8000) throw busyError(waitMs / 1000);
      continue; // gate.take รอให้เอง
    }
    if (r.status >= 500) {
      await r.text().catch(() => '');
      if (attempt >= 3 || left() < pause + 8000) { const e = slow(`Groq ${r.status}`); e.status = 502; throw e; }
      await sleep(pause);
      continue;
    }
    break; // 4xx อื่น ลองซ้ำไม่ช่วย
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const e = new Error(`Groq ${r.status}: ${t.slice(0, 300)}`);
    e.status = r.status;
    if (r.status === 401 || r.status === 403) e.userMessage = 'ระบบถอดเสียงยังตั้งค่าไม่ถูกต้อง (คีย์ Groq) กรุณาแจ้งร้าน';
    else if (r.status === 413) e.userMessage = 'ท่อนเสียงใหญ่เกินไป ลองใหม่อีกครั้ง';
    throw e;
  }
  let j;
  try { j = await r.json(); } catch { throw slow('Groq ตอบกลับไม่ครบ'); }
  const all = cleanSegments(j.segments, { strict });
  const good = all.filter((x) => !x.bad);
  const dropped = all.filter((x) => x.bad).map((x) => [Number(x.start), Number(x.end)]);
  const segments = good.map((x) => ({ start: Number(x.start) + offset, end: Number(x.end) + offset, text: String(x.text || '') }));
  let words = withSpaces(j.words || [], j.segments);
  // คำที่อยู่ในท่อนที่ตัดทิ้ง (กึ่งกลางคำอยู่ในช่วงนั้น) ตัดทิ้งด้วย
  if (dropped.length) words = words.filter((w) => { const m = (w.start + w.end) / 2; return !dropped.some(([a, b]) => m >= a && m <= b); });
  words = words.filter((w) => w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end));
  // ท่อนที่ได้ข้อความแต่ไม่มีเวลาของคำ (หรือมีไม่ครบ): ใช้ข้อความของท่อนแทน (ซับยังตรงระดับประโยค)
  const fill = fillFromSegments(words, good.map((x) => ({ start: Number(x.start), end: Number(x.end), text: String(x.text || '') })));
  words = fill.words.map((w) => ({ ...w, start: w.start + offset, end: w.end + offset }));
  return { words, segments, text: String(j.text || ''), filled: fill.filled, dropped: dropped.length, total: all.length };
}

/*
 * ช่วงที่ "ยังมีเสียงดังอยู่แต่ไม่มีคำ" (Whisper ข้ามไป) → [{ a, b }] วินาทีในท่อน
 *   words: เวลาในท่อน (เริ่ม 0) · pcm: Int16 โมโน
 *   ดังพอ = เฟรม 20 ms ที่ดังกว่าครึ่งหนึ่งของความดังตอนมีคำพูด เกินครึ่งของช่วง
 */
function missedSpeech(words, pcm, rate, { minGap = 2, maxGaps = 2 } = {}) {
  const per = Math.max(1, Math.round(rate * 0.02));
  const nF = Math.floor(pcm.length / per);
  if (!nF) return [];
  const rms = new Float32Array(nF);
  for (let f = 0; f < nF; f++) {
    let s = 0;
    for (let i = f * per; i < (f + 1) * per; i++) s += pcm[i] * pcm[i];
    rms[f] = Math.sqrt(s / per);
  }
  const dur = nF * 0.02;
  const ws = words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end)).sort((x, y) => x.start - y.start);
  // ความดังตอนพูด (ค่ากลางของเฟรมที่มีคำ) · ไม่มีคำเลยใช้ค่ากลางทั้งท่อน
  const voiced = [];
  for (const w of ws) for (let f = Math.max(0, Math.floor(w.start / 0.02)); f < Math.min(nF, Math.ceil(w.end / 0.02)); f++) voiced.push(rms[f]);
  const ref = (voiced.length ? voiced : Array.from(rms)).sort((x, y) => x - y)[Math.floor((voiced.length || nF) / 2)] || 0;
  const loud = Math.max(150, ref * 0.5);
  const spans = [];
  let cur = 0;
  for (const w of ws.concat([{ start: dur, end: dur }])) {
    if (w.start - cur >= minGap) spans.push({ a: cur, b: w.start });
    cur = Math.max(cur, w.end);
  }
  const out = [];
  for (const g of spans) {
    let n = 0, hit = 0;
    for (let f = Math.floor(g.a / 0.02); f < Math.min(nF, Math.ceil(g.b / 0.02)); f++) { n++; if (rms[f] >= loud) hit++; }
    if (n && hit / n >= 0.5) out.push({ ...g, score: hit * (g.b - g.a) });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, maxGaps).sort((x, y) => x.a - y.a).map(({ a, b }) => ({ a, b }));
}

/*
 * ถอดเสียงท่อนเดียวให้ครบ
 *   1) ถอดทั้งท่อน
 *   2) ช่วงที่ยังมีเสียงพูดแต่ไม่ได้คำ (Whisper ข้าม) ตัดมาต่อกันคั่นด้วยความเงียบ แล้วถอดซ้ำ "ครั้งเดียว"
 *      (เดิมถอดซ้ำทีละช่วง = ยิง Groq ถี่จนโควตาต่อนาทีเต็ม แล้วช่วงที่ถอดซ้ำไม่ได้ถูกข้ามเงียบๆ = ซับหาย)
 *   3) keep { a, b } (วินาทีจริงในคลิป): เบราว์เซอร์ส่งเสียงเผื่อหัวท้ายท่อน ไม่ให้คำตรงรอยต่อขาด
 *      เก็บเฉพาะคำที่กึ่งกลางคำอยู่ในช่วงของท่อนนี้ (คำตรงรอยต่อจึงไม่หายและไม่ซ้ำ)
 * → { words, segments, gaps (ช่วงที่ขาด), recovered (ถอดซ้ำได้), missed: [{a,b}] ช่วงที่ยังถอดไม่ได้ }
 */
async function transcribeCovered(cfg, wavBuf, { offset = 0, fetchImpl, retryGaps = true, keep = null, deadline = Infinity, gate = gateFor(cfg), maxGaps = 6 } = {}) {
  const r = await groqTranscribe(cfg, wavBuf, { offset, fetchImpl, deadline, gate });
  const inKeep = (w) => { if (!keep) return true; const m = (w.start + w.end) / 2; return m >= keep.a && m < keep.b; };
  const done = (words, extra = {}) => ({ ...r, words: words.filter(inKeep), gaps: 0, recovered: 0, missed: [], ...extra });
  if (!retryGaps) return done(r.words);
  let w;
  try { w = parseWav(wavBuf); } catch { return done(r.words); }
  if (w.bits !== 16 || w.channels !== 1) return done(r.words);
  const pcm = new Int16Array(w.data.buffer.slice(w.data.byteOffset, w.data.byteOffset + (w.data.length & ~1)));
  const dur = pcm.length / w.rate;
  let gaps = missedSpeech(r.words.map((x) => ({ start: x.start - offset, end: x.end - offset })), pcm, w.rate, { maxGaps });
  // สนใจเฉพาะช่วงที่อยู่ในส่วนของท่อนนี้ (ไม่ใช่ส่วนเผื่อที่ท่อนข้างเคียงถอดอยู่แล้ว)
  if (keep) gaps = gaps.map((g) => ({ a: Math.max(g.a, keep.a - offset), b: Math.min(g.b, keep.b - offset) })).filter((g) => g.b - g.a >= 1.5);
  if (!gaps.length) return done(r.words);
  const abs = (g) => ({ a: Math.round((offset + g.a) * 100) / 100, b: Math.round((offset + g.b) * 100) / 100 });
  // ต่อช่วงที่ขาดเป็นไฟล์เดียว คั่นด้วยความเงียบ 1 วินาที (ไม่เกิน ~28 วินาที = หน้าต่างเดียวของ Whisper)
  const SEP = Math.round(w.rate * 1);
  const pieces = [];
  let at = 0;
  for (const g of gaps) {
    const a = Math.max(0, g.a - 0.6), b = Math.min(dur, g.b + 0.6);
    if (pieces.length && at + (b - a) > 28) break;
    pieces.push({ g, a, ca: at, cb: at + (b - a) });
    at += b - a + SEP / w.rate;
  }
  const len = pieces.reduce((n, p) => n + Math.round((p.cb - p.ca) * w.rate) + SEP, 0);
  const joined = new Int16Array(len);
  let pos = 0;
  for (const p of pieces) {
    const part = pcm.subarray(Math.floor(p.a * w.rate), Math.floor(p.a * w.rate) + Math.round((p.cb - p.ca) * w.rate));
    joined.set(part, pos);
    pos += Math.round((p.cb - p.ca) * w.rate) + SEP;
  }
  // เวลาน้อยเกินจะถอดซ้ำทัน: ส่งผลที่ได้ไปก่อน (บันทึกว่ายังขาดช่วงไหน)
  if (deadline - Date.now() < 20000) return done(r.words, { gaps: gaps.length, missed: gaps.map(abs) });
  const buf = Buffer.concat([wavHeader(joined.length * 2, w), Buffer.from(joined.buffer, joined.byteOffset, joined.length * 2)]);
  let r2;
  try {
    r2 = await groqTranscribe(cfg, buf, { offset: 0, fetchImpl, deadline, gate, strict: true });
  } catch (e) {
    if (!e.transient) throw e;
    return done(r.words, { gaps: gaps.length, missed: gaps.map(abs), gapError: String(e.message).split('\n')[0] });
  }
  // เวลาในไฟล์ที่ต่อกัน → เวลาจริง · เก็บเฉพาะคำที่ตกอยู่ในช่วงที่ขาดจริง (ไม่ซ้ำกับคำที่มีอยู่แล้ว)
  const words = r.words.slice();
  const hit = new Set();
  for (const x of r2.words) {
    const m = (x.start + x.end) / 2;
    const p = pieces.find((q) => m >= q.ca && m < q.cb);
    if (!p) continue;
    const shift = p.a - p.ca;
    const s = Math.max(p.a, x.start + shift), e = Math.min(p.a + (p.cb - p.ca), x.end + shift);
    const mid = (s + e) / 2;
    if (mid < p.g.a - 0.15 || mid > p.g.b + 0.15) continue;
    // คำที่ทับคำเดิมเกินครึ่ง = คำเดิมที่ได้มาแล้ว (ตรงขอบช่วง) ไม่ใส่ซ้ำ
    const S = s + offset, E = Math.max(s, e) + offset;
    if (r.words.some((o) => Math.min(E, o.end) - Math.max(S, o.start) > Math.max(0.05, (E - S) * 0.5))) continue;
    words.push({ ...x, start: s + offset, end: Math.max(s, e) + offset });
    hit.add(p.g);
  }
  words.sort((x, y) => x.start - y.start);
  return done(words, { gaps: gaps.length, recovered: hit.size, missed: gaps.filter((g) => !hit.has(g)).map(abs) });
}

/*
 * รวมคำจากทุกท่อน: คำเดียวกันที่ได้มาจากสองท่อน (ตรงรอยต่อ เวลาของ Whisper คลาดกันนิดหน่อย) เก็บไว้คำเดียว
 * words ต้องเรียงตามเวลาเริ่มแล้ว
 */
function dedupeWords(words) {
  const out = [];
  for (const w of words) {
    const t = squash(w.text);
    const dup = t && out.slice(-6).some((o) => squash(o.text) === t && Math.min(w.end, o.end) - Math.max(w.start, o.start) > Math.max(0.02, Math.min(w.end - w.start, o.end - o.start) * 0.5));
    if (!dup) out.push(w);
  }
  return out;
}

function createTranscriber(cfg) {
  const S = cfg.subtitles;
  if (S.engine === 'groq') {
    return {
      check: async () => (cfg.groq.apiKey ? { ok: true, engine: 'groq' } : { ok: false, reason: 'ยังไม่ได้ตั้ง GROQ_API_KEY' }),
      // ไฟล์ WAV ในเครื่อง (โหมดเครื่องร้าน): แบ่งท่อนแล้วส่งทีละท่อน
      async transcribe(audioFile, { onProgress = () => {} } = {}) {
        const parts = splitWav(fs.readFileSync(audioFile));
        const words = [], segments = [];
        for (let i = 0; i < parts.length; i++) {
          const r = await transcribeCovered(cfg, parts[i].buf, { offset: parts[i].start });
          words.push(...r.words); segments.push(...r.segments);
          onProgress(Math.round(((i + 1) / parts.length) * 100));
        }
        return { engine: 'groq', language: 'th', words, segments };
      },
      // ท่อนเสียงที่เบราว์เซอร์ลูกค้าส่งมา (โหมด serverless)
      chunk: (wavBuf, offset, opts = {}) => transcribeCovered(cfg, wavBuf, { offset, ...opts }),
    };
  }
  let checked = null;
  let checkedAt = 0;
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_TELEMETRY: '1', TOKENIZERS_PARALLELISM: 'false' };
  // ให้ Whisper เจอ ffmpeg ตัวเดียวกับร้าน (เครื่องที่ไม่มี ffmpeg ในระบบ ใช้ ffmpeg-static ได้)
  try {
    const ff = require('../render/tools').ffmpegPath();
    if (ff && path.isAbsolute(ff)) env.PATH = `${path.dirname(ff)}${path.delimiter}${env.PATH || ''}`;
  } catch { /* ข้าม */ }

  // ตรวจว่าติดตั้งตัวถอดเสียงแล้วหรือยัง (จำผล 1 นาทีถ้ายังไม่พร้อม เผื่อเพิ่งติดตั้ง)
  let inflight = null;
  async function check() {
    if (S.engine === 'off') return { ok: false, reason: 'ปิดระบบซับอัตโนมัติอยู่ (SUBTITLE_ENGINE=off)' };
    if (checked && (checked.ok || Date.now() - checkedAt < 60 * 1000)) return checked;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        if (S.python.includes(path.sep) && !fs.existsSync(S.python)) throw new Error(`ไม่พบ ${S.python}`);
        // โหลด mlx/โมเดลครั้งแรกบนเครื่องที่เพิ่งตื่นอาจช้า จึงให้เวลา 3 นาที
        const r = await run(S.python, [SCRIPT, '--check', '--engine', S.engine], { timeoutMs: 3 * 60 * 1000, env });
        const j = JSON.parse(r.out.trim().split('\n').pop());
        checked = { ok: true, engine: j.engine };
      } catch (e) {
        const slow = /SIGKILL/.test(String(e.message));
        checked = {
          ok: false,
          reason: slow ? 'ตัวถอดเสียงตอบช้าเกินไป (เครื่องอาจหลับหรือทำงานหนัก)' : 'ยังไม่ได้ติดตั้งตัวถอดเสียง (Whisper)',
          detail: String(e.message).slice(0, 300),
        };
      }
      checkedAt = Date.now();
      inflight = null;
      return checked;
    })();
    return inflight;
  }

  async function transcribe(audioFile, { onProgress = () => {}, outFile, timeoutMs }) {
    const args = [SCRIPT, audioFile, '--out', outFile, '--engine', S.engine, '--language', 'th'];
    if (S.model) args.push('--model', S.model);
    args.push('--prompt', BASE_PROMPT);
    await run(S.python, args, {
      env,
      timeoutMs: timeoutMs || S.asrTimeoutMin * 60 * 1000,
      onLine: (line) => { const m = /^PROGRESS (\d+)/.exec(line); if (m) onProgress(Number(m[1])); },
    });
    return JSON.parse(fs.readFileSync(outFile, 'utf8'));
  }

  return { check, transcribe };
}

module.exports = { dedupeWords, createGate, gateFor, fillFromSegments, missedSpeech, transcribeCovered, BASE_PROMPT, THAI_PROMPT, asrPrompt, createTranscriber, run, groqTranscribe, cleanSegments, splitWav, parseWav, wavHeader, withSpaces };

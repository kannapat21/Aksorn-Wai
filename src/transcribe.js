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
const BASE_PROMPT = 'สวัสดีครับ วันนี้เราจะมาเล่าเรื่องนี้ให้ฟังกันนะคะ ใช้ภาษาไทยเป็นหลัก มีคำภาษาอังกฤษปนบ้าง เช่น TikTok, YouTube, Facebook';

// ประโยคที่ Whisper ชอบแต่งขึ้นเองตอนเงียบ/มีแต่เพลง
const HALLUCINATION_RE = /^(ขอบคุณ(ที่|สำหรับการ)?รับชม.*|ขอบคุณครับ|ขอบคุณค่ะ|ฝากกด(ไลค์|ติดตาม|subscribe).*|กด(ไลค์|ติดตาม|subscribe|กระดิ่ง).*|(ซับ|คำบรรยาย)(ไตเติ้ล)?(ภาษาไทย)?(โดย|by).*|subtitles? by.*|thank(s| you) for watching.*|\.+|…+)$/iu;

/*
 * ตัดท่อนที่น่าจะไม่ใช่เสียงพูดจริง (เกณฑ์เดียวกับ Whisper ต้นฉบับ)
 *   - no_speech_prob สูง และความมั่นใจต่ำ = ช่วงเงียบ/เพลงที่ถูกแต่งเป็นคำ
 *   - compression_ratio สูง = ข้อความวนซ้ำ
 *   - ประโยคแต่งเองยอดฮิต ("ขอบคุณที่รับชม") ในช่วงที่ไม่ค่อยมีเสียงพูด
 *   - ท่อนที่ซ้ำกับท่อนก่อนหน้าแบบเป๊ะๆ ติดกัน 2 ครั้งขึ้นไป
 */
function cleanSegments(raw) {
  const keep = [];
  let last = '', rep = 0;
  for (const x of raw || []) {
    const text = String(x.text || '').trim();
    const ns = Number(x.no_speech_prob) || 0;
    const lp = Number.isFinite(Number(x.avg_logprob)) ? Number(x.avg_logprob) : 0;
    const cr = Number(x.compression_ratio) || 0;
    let bad = !text || (ns > 0.6 && lp < -1) || cr > 2.4 || lp < -1.6;
    if (!bad && HALLUCINATION_RE.test(text.replace(/\s+/g, '')) && (ns > 0.2 || lp < -0.7)) bad = true;
    const norm = text.replace(/[\s.,!?…]/g, '');
    if (!bad && norm && norm === last) { rep++; if (rep >= 1) bad = true; } else if (norm) { rep = 0; }
    if (norm) last = norm;
    keep.push({ ...x, bad });
  }
  return keep;
}
const THAI_PROMPT = BASE_PROMPT;
const asrPrompt = (prev = '') => (prev ? `${BASE_PROMPT} ${String(prev).replace(/\s+/g, ' ').trim().slice(-120)}` : BASE_PROMPT);

// ถอดเสียงท่อนเดียว (WAV ไม่เกิน 25 MB) → { words: [{text,start,end}], segments }
async function groqTranscribe(cfg, wavBuf, { offset = 0, fetchImpl = globalThis.fetch, prompt = '' } = {}) {
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
  let r;
  // ลองซ้ำ 1 ครั้งถ้า Groq ยุ่ง (รอไม่เกิน 3 วินาที ฟังก์ชันบน Netlify มีเวลาจำกัด)
  for (let attempt = 0; attempt < 2; attempt++) {
    r = await fetchImpl(`${G.apiBase}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${G.apiKey}` }, body: form() });
    if ((r.status !== 429 && r.status < 500) || attempt === 1) break;
    const ra = r.headers.get('retry-after');
    const wait = Math.min(3, ra !== null && ra !== '' ? Number(ra) || 0 : 1);
    await new Promise((ok) => setTimeout(ok, wait * 1000));
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const e = new Error(`Groq ${r.status}: ${t.slice(0, 300)}`);
    e.status = r.status;
    if (r.status === 429) e.userMessage = 'วันนี้ระบบถอดเสียงถูกใช้เยอะจนเต็มโควตาฟรี ลองใหม่อีกครั้งในอีกสักพัก';
    if (r.status === 401) e.userMessage = 'ระบบถอดเสียงยังตั้งค่าไม่ถูกต้อง (คีย์ Groq) กรุณาแจ้งร้าน';
    throw e;
  }
  const j = await r.json();
  const all = cleanSegments(j.segments);
  const good = all.filter((x) => !x.bad);
  const dropped = all.filter((x) => x.bad).map((x) => [Number(x.start), Number(x.end)]);
  const segments = good.map((x) => ({ start: Number(x.start) + offset, end: Number(x.end) + offset, text: String(x.text || '') }));
  let words = withSpaces(j.words || [], j.segments);
  // คำที่อยู่ในท่อนที่ตัดทิ้ง (กึ่งกลางคำอยู่ในช่วงนั้น) ตัดทิ้งด้วย
  if (dropped.length) words = words.filter((w) => { const m = (w.start + w.end) / 2; return !dropped.some(([a, b]) => m >= a && m <= b); });
  // บางครั้งไม่มีเวลาของคำ: ใช้เวลาของท่อนแทน (ซับยังตรงระดับประโยค)
  if (!words.length && !(j.words || []).length) words = segments.map((x) => ({ text: ` ${x.text.trim()}`, start: x.start - offset, end: x.end - offset }));
  words = words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end)).map((w) => ({ ...w, start: w.start + offset, end: w.end + offset }));
  return { words, segments, text: String(j.text || '') };
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
          const r = await groqTranscribe(cfg, parts[i].buf, { offset: parts[i].start });
          words.push(...r.words); segments.push(...r.segments);
          onProgress(Math.round(((i + 1) / parts.length) * 100));
        }
        return { engine: 'groq', language: 'th', words, segments };
      },
      // ท่อนเสียงที่เบราว์เซอร์ลูกค้าส่งมา (โหมด serverless)
      chunk: (wavBuf, offset) => groqTranscribe(cfg, wavBuf, { offset }),
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

module.exports = { BASE_PROMPT, THAI_PROMPT, asrPrompt, createTranscriber, run, groqTranscribe, cleanSegments, splitWav, parseWav, wavHeader, withSpaces };

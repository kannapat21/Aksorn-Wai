/*
 * เครื่องเรนเดอร์ในเบราว์เซอร์ลูกค้า (โหมด serverless: เซิร์ฟเวอร์ร้านไม่มี Chrome/ffmpeg ใช้แรมแทบไม่มี)
 *
 *  วาดเฟรม : เอา DOM ชุดเดียวกับ render/template.html + public/motion.js มาวาดลงภาพผ่าน SVG foreignObject
 *            (ทดสอบแล้วได้พิกเซลตรงกับภาพที่ Chrome ของเครื่องร้านแคปทุกท่า)
 *  แอนิเมชัน: ffmpeg.wasm เข้ารหัสด้วยคำสั่งเดียวกับเครื่องร้าน (H.264 / ProRes 4444 / WebM โปร่งใส)
 *            ตัวเข้ารหัส (~32 MB) โหลดจาก cdn.jsdelivr.net ครั้งแรกครั้งเดียว แล้วเก็บไว้ในเครื่อง
 *  ซับ     : Mediabunny + WebCodecs (ฮาร์ดแวร์ของเครื่องลูกค้า) อ่านคลิป → วางแถบซับทีละเฟรม → MP4 H.264 + เสียงเดิม
 *  เสียง   : แยกเสียงเป็น WAV 16 kHz โมโน ส่งให้ร้านทีละท่อน (ร้านส่งต่อให้ Groq ถอดเสียง) คลิปไม่ถูกอัปโหลด
 */
const TT = window.TTMotion;
const PLAN = window.TTSubPlan;
const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/';
const CACHE = 'aw-encoder-v1';

let uid = 0;

// ---------- ตัวช่วย ----------
function toDataUrl(blob) {
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => bad(r.error); r.readAsDataURL(blob); });
}

async function readWithProgress(resp, onBytes) {
  const total = Number(resp.headers.get('content-length')) || 0;
  if (!resp.body || !onBytes) return new Uint8Array(await resp.arrayBuffer());
  const reader = resp.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    onBytes(got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// โหลดไฟล์จาก CDN ครั้งแรกแล้วเก็บใน Cache Storage (ครั้งต่อไปไม่ต้องโหลดใหม่)
async function cachedBlobUrl(url, type, onBytes) {
  let resp = null;
  let cache = null;
  try { cache = await caches.open(CACHE); resp = await cache.match(url); } catch (e) { cache = null; }
  if (!resp) {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw new Error(`โหลดตัวเข้ารหัสไม่สำเร็จ (${r.status})`);
    if (cache) { try { await cache.put(url, r.clone()); } catch (e) { /* พื้นที่เต็ม ใช้แบบไม่เก็บ */ } }
    resp = r;
  }
  const bytes = await readWithProgress(resp, onBytes);
  return URL.createObjectURL(new Blob([bytes], { type }));
}

let ffmpegP = null;
async function getFFmpeg(onStage) {
  if (!ffmpegP) {
    ffmpegP = (async () => {
      const { FFmpeg } = await import('/vendor/ffmpeg/index.js');
      const ff = new FFmpeg();
      onStage('กำลังเตรียมตัวเข้ารหัส (ครั้งแรกโหลดราว 32 MB)', 0);
      const coreURL = await cachedBlobUrl(`${CORE_BASE}ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await cachedBlobUrl(`${CORE_BASE}ffmpeg-core.wasm`, 'application/wasm', (got, total) => {
        if (total) onStage(`กำลังเตรียมตัวเข้ารหัส ${Math.round(got / 1048576)}/${Math.round(total / 1048576)} MB (ครั้งแรกเท่านั้น)`, got / total);
      });
      await ff.load({ coreURL, wasmURL });
      return ff;
    })();
    ffmpegP.catch(() => { ffmpegP = null; });
  }
  return ffmpegP;
}

let mbP = null;
const mediabunny = () => (mbP = mbP || import('/vendor/mediabunny.min.mjs'));

// ---------- วาดเฟรมด้วย DOM ชุดเดียวกับเครื่องร้าน ----------
class Painter {
  static async create(w, h, font) {
    const r = await fetch(font.url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('โหลดฟอนต์ไม่สำเร็จ');
    const buf = await r.arrayBuffer();
    const dataUrl = await toDataUrl(new Blob([buf], { type: font.mime || 'font/ttf' }));
    const family = `AWRender${++uid}`;
    const face = new FontFace(family, buf, { weight: '100 900' });
    await face.load();
    document.fonts.add(face);
    return new Painter(w, h, family, dataUrl, font.weight || 700, face);
  }

  constructor(w, h, family, dataUrl, weight, face) {
    this.w = w; this.h = h; this.family = family; this.weight = weight; this.face = face;
    this.filterId = `awf${uid}`;
    this.css = `.rf-stage{position:absolute;left:0;top:0;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;}`
      + `.rf-text{display:grid;font-family:"${family}",sans-serif;font-synthesis:none;white-space:nowrap;line-height:1.6;padding:0.3em 0.4em;transform-origin:50% 50%;}`
      + '.rf-text .fill{color:var(--fill);}';
    this.fontCss = `@font-face{font-family:"${family}";src:url("${dataUrl}");font-weight:100 900;}`;
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:fixed;left:-${w + 5000}px;top:0;width:${w}px;height:${h}px;overflow:hidden;pointer-events:none;contain:strict;`;
    host.innerHTML = `<style>${this.css}</style><div class="rf-filters"></div><div class="rf-stage"><div class="rf-text"><span class="fill"></span></div></div>`;
    host.querySelector('.rf-filters').innerHTML = TT.filterMarkup(this.filterId);
    document.body.appendChild(host);
    this.host = host;
    this.text = host.querySelector('.rf-text');
    this.canvas = new OffscreenCanvas(w, h);
    this.ctx = this.canvas.getContext('2d');
  }

  async ready(sample) {
    await document.fonts.load(`${this.weight} 100px "${this.family}"`, sample || 'ก');
  }

  setup(opts) {
    return TT.setup(this.text, Object.assign({ fontFamily: this.family, width: this.w, height: this.h, filterId: this.filterId, weight: this.weight }, opts));
  }

  setTime(t, timing, motion) { TT.setTime(this.text, t, timing, motion); }

  // ภาพของเฟรมปัจจุบัน (พื้นโปร่งใส) → HTMLImageElement
  async image() {
    const ser = new XMLSerializer();
    const kids = Array.from(this.host.children).filter((n) => n.tagName !== 'STYLE').map((n) => ser.serializeToString(n)).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}"><foreignObject x="0" y="0" width="${this.w}" height="${this.h}">`
      + `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${this.w}px;height:${this.h}px;margin:0;overflow:hidden"><style>${this.fontCss}${this.css}</style>`
      + `${kids.replace(/ xmlns="http:\/\/www.w3.org\/1999\/xhtml"/g, '')}</div></foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    return img;
  }

  async png() {
    const img = await this.image();
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.ctx.drawImage(img, 0, 0);
    const blob = await this.canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }

  // วาดลงผืนผ้าใบของตัวเอง (ภาพ SVG ส่งเข้า WebCodecs ตรงๆ ไม่ได้ ต้องผ่าน canvas ก่อน) · ใช้ได้จนกว่าจะวาดเฟรมถัดไป
  async canvasFrame() {
    const img = await this.image();
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.ctx.drawImage(img, 0, 0);
    return this.canvas;
  }

  dispose() {
    this.host.remove();
    try { document.fonts.delete(this.face); } catch (e) { /* ข้าม */ }
  }
}

// ---------- แอนิเมชันไฟล์เดียว (เหมือน renderSingle ของเครื่องร้าน) ----------
const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];

// คืน [อินพุตเพิ่ม, ตัวเลือกเอาต์พุต] (อินพุตแรกคือลำดับเฟรม PNG)
function encodeArgs(format, { w, h, fps, total, out }) {
  const cfr = ['-fps_mode', 'cfr', '-r', String(fps), '-frames:v', String(total)];
  if (format === 'mp4_green' || format === 'mp4_black') {
    const color = format === 'mp4_green' ? '0x00FF00' : '0x000000';
    return [['-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}:r=${fps}`], [
      '-filter_complex', '[0:v]fps=' + fps + '[fg];[1:v][fg]overlay=shortest=1:format=auto,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]',
      '-map', '[v]', ...cfr,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-profile:v', 'high', '-tune', 'animation', ...BT709, '-movflags', '+faststart', out]];
  }
  if (format === 'prores4444') {
    return [[], ['-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuva444p10le', ...cfr,
      '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-qscale:v', '6', '-vendor', 'apl0', ...BT709, out]];
  }
  // WebM โปร่งใส: VP8 + alpha (VP9 ใน ffmpeg.wasm ใช้หน่วยความจำเกินจนแท็บล่ม) เปิดได้ใน OBS / เบราว์เซอร์ / โปรแกรมตัดต่อที่รองรับ WebM
  return [[], ['-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuva420p', ...cfr,
    '-c:v', 'libvpx', '-pix_fmt', 'yuva420p', '-b:v', '6M', '-crf', '10', '-deadline', 'realtime', '-cpu-used', '8', '-auto-alt-ref', '0', ...BT709, out]];
}

export async function renderAnimation(spec, onProgress = () => {}) {
  const t0 = performance.now();
  const { w, h } = spec.size;
  const FPS = spec.fps || 60;
  const mm = TT.meta(spec.motion);
  const seconds = Math.max(1.5, mm.intro + mm.outro + 0.2, Math.min(60, Number(spec.seconds) || 3));
  const total = Math.round(seconds * FPS);
  const inN = Math.round(mm.intro * FPS);
  const outN = Math.round(mm.outro * FPS);
  const loopN = mm.loop ? Math.max(1, Math.min(Math.round(mm.loop * FPS), total - inN - outN)) : 1;
  const timing = TT.timingFor(spec.motion, seconds, FPS);

  const ff = await getFFmpeg((stage, k) => onProgress(Math.round(2 + 18 * k), stage));
  const painter = await Painter.create(w, h, spec.font);
  const written = [];
  try {
    await painter.ready(spec.text);
    painter.setup({ text: spec.text, fill: spec.fill, stroke: spec.stroke, strokeRatio: spec.strokeRatio, shadow: spec.shadow, motion: spec.motion });
    // 1) วาดเฉพาะเฟรมที่ไม่ซ้ำ
    const unique = [];
    for (let i = 0; i < inN; i++) unique.push({ name: `in${i}.png`, t: i / FPS });
    for (let k = 0; k < loopN; k++) unique.push({ name: `hold${k}.png`, t: timing.settle + k / FPS });
    for (let k = 0; k < outN; k++) unique.push({ name: `out${k}.png`, t: timing.fadeStart + k / FPS });
    for (let i = 0; i < unique.length; i++) {
      painter.setTime(unique[i].t, timing, spec.motion);
      await ff.writeFile(unique[i].name, await painter.png());
      written.push(unique[i].name);
      if (i % 3 === 0 || i === unique.length - 1) onProgress(Math.round(20 + 40 * ((i + 1) / unique.length)), 'กำลังวาดตัวอักษร');
    }
    // 2) ลำดับเฟรมเต็มความยาว (อ้างไฟล์เดิมซ้ำ ไม่คัดลอก)
    const seq = [];
    for (let i = 0; i < total; i++) seq.push(i < inN ? `in${i}.png` : i >= total - outN ? `out${i - (total - outN)}.png` : `hold${(i - inN) % loopN}.png`);
    const dur = (1 / FPS).toFixed(6);
    const list = `ffconcat version 1.0\n${seq.map((f) => `file '${f}'\nduration ${dur}`).join('\n')}\nfile '${seq[seq.length - 1]}'\n`;
    await ff.writeFile('list.txt', new TextEncoder().encode(list));
    written.push('list.txt');
    // 3) เข้ารหัส
    const out = `out.${spec.ext}`;
    const onFF = ({ progress }) => onProgress(Math.round(60 + 38 * Math.max(0, Math.min(1, progress))), 'กำลังเข้ารหัสวิดีโอ');
    const logs = [];
    const onLog = ({ message }) => { logs.push(message); if (logs.length > 20) logs.shift(); };
    ff.on('progress', onFF);
    ff.on('log', onLog);
    let rc;
    try {
      const [extraIn, outArgs] = encodeArgs(spec.format, { w, h, fps: FPS, total, out });
      rc = await ff.exec(['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', ...extraIn, ...outArgs]);
    } finally {
      ff.off('progress', onFF);
      ff.off('log', onLog);
    }
    if (rc !== 0) throw new Error(`เข้ารหัสไม่สำเร็จ (${rc}) ${logs.slice(-3).join(' | ')}`.trim());
    const data = await ff.readFile(out);
    written.push(out);
    onProgress(100, 'เสร็จแล้ว');
    return { blob: new Blob([data.buffer], { type: spec.mime }), ms: Math.round(performance.now() - t0), frames: total };
  } finally {
    painter.dispose();
    for (const f of written) { try { await ff.deleteFile(f); } catch (e) { /* ข้าม */ } }
  }
}

// ---------- คลิป: อ่านข้อมูล / แยกเสียง ----------
// คลิปที่เบราว์เซอร์นี้เปิดภาพไม่ได้ (เช่น HEVC/H.265 จาก iPhone หรือ Android, HDR 10-bit)
// → แปลงเป็น MP4 H.264 ในเครื่องลูกค้าด้วย ffmpeg.wasm ครั้งเดียว แล้วใช้ไฟล์ที่แปลงทั้งตัวอย่างและตอนสร้างคลิป
export async function playableClip(file, onProgress = () => {}) {
  const info = await probeClip(file);
  if (!info.ok) throw new Error('เปิดไฟล์นี้ไม่ได้ ไฟล์อาจเสียหรือไม่ใช่วิดีโอ ลองส่งออกจากแอปตัดต่อเป็น MP4 แล้วเลือกใหม่');
  if (info.canDecode) return { file, info, converted: false };
  const ff = await getFFmpeg((stage, k) => onProgress(Math.round(2 + 13 * k), stage));
  const dir = `/in${++uid}`;
  const out = `conv${uid}.mp4`;
  const tail = [];
  const onLog = ({ message }) => { tail.push(message); if (tail.length > 12) tail.shift(); };
  const label = 'กำลังแปลงคลิปให้เบราว์เซอร์นี้เปิดได้ (ทำครั้งเดียว ใช้เวลาราว 1–3 เท่าของความยาวคลิป)';
  const onProg = ({ progress }) => { if (progress >= 0 && progress <= 1) onProgress(Math.round(15 + 84 * progress), label); };
  ff.on('log', onLog); ff.on('progress', onProg);
  onProgress(15, label);
  try {
    await ff.createDir(dir);
    await ff.mount('WORKERFS', { files: [file] }, dir);
    const code = await ff.exec(['-i', `${dir}/${file.name}`, '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "scale='min(iw,1920)':'min(ih,1920)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '17', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
    if (code !== 0) throw new Error('แปลงคลิปไม่สำเร็จ: ' + (tail.filter((l) => /error|invalid|not/i.test(l)).pop() || `รหัส ${code}`));
    const data = await ff.readFile(out);
    const conv = new File([data], file.name.replace(/\.[^.]+$/, '') + '.mp4', { type: 'video/mp4' });
    const info2 = await probeClip(conv);
    if (!info2.ok || !info2.canDecode) throw new Error('แปลงคลิปแล้วแต่ยังเปิดไม่ได้ ลองส่งออกคลิปเป็น MP4 (H.264) จากแอปกล้องหรือแอปตัดต่อ แล้วเลือกใหม่');
    onProgress(100, 'แปลงคลิปเสร็จแล้ว');
    return { file: conv, info: info2, converted: true };
  } finally {
    ff.off('log', onLog); ff.off('progress', onProg);
    try { await ff.unmount(dir); } catch (e) { /* ข้าม */ }
    try { await ff.deleteDir(dir); } catch (e) { /* ข้าม */ }
    try { await ff.deleteFile(out); } catch (e) { /* ข้าม */ }
  }
}

export async function probeClip(file) {
  const M = await mediabunny();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  try {
    const v = await input.getPrimaryVideoTrack();
    const a = await input.getPrimaryAudioTrack();
    if (!v) return { ok: false };
    const duration = await input.computeDuration();
    return { ok: true, width: v.displayWidth, height: v.displayHeight, duration, audio: Boolean(a), canDecode: await v.canDecode() };
  } finally {
    if (input.dispose) input.dispose();
  }
}

// เสียง WAV 16 kHz โมโน (16-bit) → แบ่งท่อนละไม่เกิน ~3.5 MB (ประมาณ 110 วินาที) ให้ส่งผ่าน Netlify ได้
async function toWav(file, sampleRate, onProgress = () => {}) {
  const M = await mediabunny();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  const output = new M.Output({ format: new M.WavOutputFormat(), target: new M.BufferTarget() });
  const conv = await M.Conversion.init({ input, output, video: { discard: true }, audio: { numberOfChannels: 1, sampleRate, codec: 'pcm-s16' } });
  if (!conv.isValid) throw new Error('อ่านเสียงในคลิปนี้ไม่ได้');
  conv.onProgress = (p) => onProgress(p);
  await conv.execute();
  return new Uint8Array(output.target.buffer);
}

export async function extractSpeech(file, onProgress = () => {}) {
  return splitWav(await toWav(file, 16000, onProgress));
}

// คลื่นเสียงสำหรับไทม์ไลน์ (รูปแบบเดียวกับ render/subtitles.js peaks ของเซิร์ฟเวอร์)
export async function wavePeaks(file, perSec = 50) {
  const rate = 8000, per = Math.round(rate / perSec);
  const [part] = splitWav(await toWav(file, rate), Infinity);
  const buf = await part.blob.arrayBuffer();
  const pcm = new Int16Array(buf, 44, (buf.byteLength - 44) >> 1);
  const out = [];
  for (let i = 0; i < pcm.length; i += per) {
    let m = 0;
    for (let k = i; k < i + per && k < pcm.length; k++) { const v = Math.abs(pcm[k]); if (v > m) m = v; }
    out.push(m);
  }
  const sorted = out.slice().sort((a, b) => a - b);
  const ref = Math.max(500, sorted[Math.floor(sorted.length * 0.99)] || 0);
  return { perSec, data: out.map((v) => Math.min(255, Math.round(Math.sqrt(v / ref) * 255))) };
}

export function splitWav(bytes, maxBytes = 3.5 * 1024 * 1024) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  let off = 12, fmt = null, data = null;
  while (off + 8 <= bytes.length) {
    const id = str(off), size = dv.getUint32(off + 4, true);
    if (id === 'fmt ') fmt = { channels: dv.getUint16(off + 10, true), rate: dv.getUint32(off + 12, true), bits: dv.getUint16(off + 22, true) };
    if (id === 'data') { data = bytes.subarray(off + 8, Math.min(bytes.length, off + 8 + (size || bytes.length))); break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('แยกเสียงไม่สำเร็จ');
  const frame = (fmt.channels * fmt.bits) / 8;
  const per = Math.floor((maxBytes - 44) / frame) * frame;
  const parts = [];
  for (let i = 0; i < data.length; i += per) {
    const pcm = data.subarray(i, i + per);
    const head = new DataView(new ArrayBuffer(44));
    const put = (o, s) => { for (let k = 0; k < 4; k++) head.setUint8(o + k, s.charCodeAt(k)); };
    put(0, 'RIFF'); head.setUint32(4, 36 + pcm.length, true); put(8, 'WAVE');
    put(12, 'fmt '); head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, fmt.channels, true);
    head.setUint32(24, fmt.rate, true); head.setUint32(28, fmt.rate * frame, true); head.setUint16(32, frame, true); head.setUint16(34, fmt.bits, true);
    put(36, 'data'); head.setUint32(40, pcm.length, true);
    parts.push({ start: i / frame / fmt.rate, blob: new Blob([head.buffer, pcm], { type: 'audio/wav' }) });
  }
  return parts;
}

// ---------- เบิร์นซับลงคลิป ----------
// บิตเรตผลลัพธ์: ไม่ต่ำกว่าต้นฉบับ (ภาพไม่แตก) และพอสำหรับเฟรมเรตจริง (คลิป 60 fps ต้องใช้มากกว่า 30 fps)
async function videoPlan(file, w, h) {
  const M = await mediabunny();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  try {
    const v = await input.getPrimaryVideoTrack();
    if (!v) throw new Error('ไม่พบภาพในคลิปนี้');
    if (!(await v.canDecode())) throw new Error('เบราว์เซอร์นี้เปิดภาพในคลิปนี้ไม่ได้ (มักเป็นไฟล์ HEVC/H.265 จากมือถือ) เลือกคลิปเดิมอีกครั้ง ระบบจะแปลงไฟล์ให้ก่อน');
    let fps = 30, srcBps = 0;
    try { const st = await v.computePacketStats(240); fps = st.averagePacketRate || 30; srcBps = st.averageBitrate || 0; } catch (e) { /* ใช้ค่าเริ่มต้น */ }
    fps = Math.min(120, Math.max(15, fps));
    const need = w * h * fps * 0.11; // ราว 6.8 Mbps ที่ 1080p30 · 13.7 Mbps ที่ 1080p60
    const bitrate = Math.round(Math.min(40e6, Math.max(need, srcBps * 1.1, 4e6)));
    return { fps, bitrate };
  } finally {
    if (input.dispose) input.dispose();
  }
}

export async function burnSubtitles(file, spec, onProgress = () => {}) {
  const t0 = performance.now();
  const M = await mediabunny();
  let { w, h } = spec.out;
  let L = spec.layout;
  let vp = await videoPlan(file, w, h);
  // 4K ที่เครื่องนี้เข้ารหัสไม่ไหว → ย่อเหลือด้านยาว 1920 (คำนวณตำแหน่งซับใหม่ให้ตรง)
  if (!(await M.canEncodeVideo('avc', { width: w, height: h, bitrate: vp.bitrate })) && Math.max(w, h) > PLAN.MAX_SIDE) {
    ({ w, h } = PLAN.outSize(w, h, PLAN.MAX_SIDE));
    L = PLAN.layoutFor(w, h, { size: spec.size, position: spec.position });
    vp = await videoPlan(file, w, h);
  }
  if (!(await M.canEncodeVideo('avc', { width: w, height: h, bitrate: vp.bitrate }))) throw new Error('เบราว์เซอร์นี้สร้างวิดีโอ MP4 ไม่ได้ ลองเปิดด้วย Chrome หรือ Safari รุ่นใหม่');
  const plan = PLAN.planFrames(spec.cues, { duration: spec.duration, motion: spec.motion, TT });
  const painter = plan.shots.length ? await Painter.create(w, L.band, spec.font) : null;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  let cur = -1;
  let cache = { idx: -1, cv: null };
  async function band(idx) {
    if (cache.idx === idx) return cache.cv;
    const s = plan.shots[idx];
    if (s.cue !== cur) {
      cur = s.cue;
      const c = spec.cues[cur];
      const words = spec.motion === 'kinetic' ? (c.w || []).map((x) => x[0]) : null;
      const wordAt = s.timing.wordAt;
      if (words && wordAt && words.filter((x) => !/^\s+$/.test(x)).length !== wordAt.length) delete s.timing.wordAt;
      painter.setup({
        text: c.text, words: words && words.join('') === c.text ? words : null,
        fill: spec.fill, stroke: spec.stroke, strokeRatio: spec.strokeRatio || 0, shadow: Boolean(spec.shadow),
        motion: spec.motion, fixedSize: L.fontPx, maxW: 0.92, maxH: 0.92,
      });
    }
    painter.setTime(s.t, s.timing, spec.motion);
    cache = { idx, cv: await painter.canvasFrame() };
    return cache.cv;
  }
  try {
    if (painter) await painter.ready(spec.cues.map((c) => c.text).join(' ').slice(0, 2000));
    const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
    const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
    const conv = await M.Conversion.init({
      input, output,
      video: {
        width: w, height: h, fit: 'fill', allowTransformationMetadata: false, codec: 'avc', bitrate: vp.bitrate, forceTranscode: true,
        processedWidth: w, processedHeight: h,
        process: async (sample) => {
          ctx.drawImage(sample.toCanvasImageSource(), 0, 0, w, h);
          const f = Math.min(plan.total - 1, Math.max(0, Math.round(sample.timestamp * PLAN.FPS)));
          const idx = plan.frames[f];
          if (idx !== null && painter) ctx.drawImage(await band(idx), 0, L.y);
          return canvas;
        },
      },
    });
    if (!conv.isValid) throw new Error('เบราว์เซอร์นี้อ่านหรือสร้างคลิปนี้ไม่ได้ ลองส่งออกคลิปเป็น MP4 (H.264) แล้วลองใหม่');
    conv.onProgress = (p) => onProgress(Math.round(2 + 96 * p), 'กำลังสร้างคลิปพร้อมซับ');
    await conv.execute();
    onProgress(100, 'เสร็จแล้ว');
    return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }), ms: Math.round(performance.now() - t0) };
  } finally {
    if (painter) painter.dispose();
  }
}

// ---------- บันทึกไฟล์ลงเครื่อง ----------
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120 * 1000);
  return url;
}

// ---------- เก็บคลิปต้นฉบับไว้ในเครื่อง (IndexedDB) ให้เปิดหน้าแก้ซับใหม่ได้โดยไม่ต้องเลือกไฟล์อีก ----------
function idb() {
  return new Promise((ok, bad) => {
    const r = indexedDB.open('aw-clips', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('clips');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
}
export async function keepClip(id, file) {
  try {
    const db = await idb();
    await new Promise((ok, bad) => { const tx = db.transaction('clips', 'readwrite'); tx.objectStore('clips').put({ file, at: Date.now() }, id); tx.oncomplete = ok; tx.onerror = () => bad(tx.error); });
    db.close();
  } catch (e) { /* เบราว์เซอร์ไม่ให้เก็บ: ลูกค้าเลือกไฟล์เองอีกครั้งตอนเปิดหน้าใหม่ */ }
}
export async function loadClip(id) {
  try {
    const db = await idb();
    const v = await new Promise((ok, bad) => { const tx = db.transaction('clips'); const g = tx.objectStore('clips').get(id); g.onsuccess = () => ok(g.result); g.onerror = () => bad(g.error); });
    db.close();
    return v && v.file ? v.file : null;
  } catch (e) { return null; }
}
export async function dropOldClips(maxAgeMs = 24 * 3600 * 1000) {
  try {
    const db = await idb();
    await new Promise((ok) => {
      const tx = db.transaction('clips', 'readwrite');
      const st = tx.objectStore('clips');
      const c = st.openCursor();
      c.onsuccess = () => { const cur = c.result; if (!cur) return; if (!cur.value || Date.now() - cur.value.at > maxAgeMs) cur.delete(); cur.continue(); };
      tx.oncomplete = ok; tx.onerror = ok;
    });
    db.close();
  } catch (e) { /* ข้าม */ }
}

export function supportInfo() {
  return {
    wasm: typeof WebAssembly === 'object',
    offscreen: typeof OffscreenCanvas === 'function',
    webcodecs: typeof VideoEncoder === 'function' && typeof VideoDecoder === 'function',
  };
}

#!/usr/bin/env node
/*
 * ตรวจไฟล์ที่เรนเดอร์แล้วด้วย ffprobe + ดึงเฟรมกลางคลิปมาวิเคราะห์
 *   node render/verify.js order-now
 *
 * ตรวจ:
 *  - codec, pix_fmt, ขนาด, fps, ความยาว 3.0 วินาที (90 เฟรม)
 *  - ไฟล์โปร่งใส (ProRes/WebM): มี alpha จริง (มีทั้งพิกเซลโปร่งใสสนิทและทึบ), เฟรมสุดท้ายโปร่งใส
 *  - ขอบตัวอักษรไม่มีเงาเขียว: วางเฟรมกลางบนพื้นขาวแล้วนับพิกเซลที่ "ออกเขียว" (G สูงกว่า R และ B ชัดเจน)
 *  - บันทึกภาพเฟรมกลางไว้ที่ storage/verify/<slug>/ ให้คนเปิดดูว่าสระ/วรรณยุกต์ครบ
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const EXPECT = {
  mp4_green: { codec: 'h264', pix: 'yuv420p', alpha: false, bg: [0, 255, 0] },
  mp4_black: { codec: 'h264', pix: 'yuv420p', alpha: false, bg: [0, 0, 0] },
  prores4444: { codec: 'prores', pix: ['yuva444p10le', 'yuva444p12le'], alpha: true, profile: '4444' },
  webm_alpha: { codec: 'vp9', pix: 'yuva420p', alpha: true },
  parts_green: { codec: 'h264', pix: 'yuv420p', alpha: false, bg: [0, 255, 0], ref: 'parts_prores' },
  parts_prores: { codec: 'prores', pix: ['yuva444p10le', 'yuva444p12le'], alpha: true, profile: '4444' },
  still_png: { codec: 'png', pix: 'rgba', alpha: true, still: true },
};

const tools = require('./tools');
const FFMPEG = tools.ffmpegPath();
const FFPROBE = tools.ffprobePath();

function sh(cmd, args, opts = {}) {
  if (cmd === 'ffmpeg') cmd = FFMPEG;
  if (cmd === 'ffprobe') cmd = FFPROBE;
  const r = spawnSync(cmd, args, { maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${String(r.stderr).slice(-2000)}`);
  return r.stdout;
}

function probe(file, decoder) {
  const args = ['-v', 'error'];
  args.push('-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_read_frames,duration:format=duration:stream_tags=alpha_mode',
    '-of', 'json', file);
  const j = JSON.parse(sh('ffprobe', args).toString());
  if (decoder) {
    // ffprobe ใช้ตัวถอด VP9 ในตัวที่ไม่อ่าน alpha (รายงาน yuv420p + alpha_mode=1)
    // จึงถอดด้วย libvpx-vp9 อีกรอบเพื่อยืนยัน pix_fmt จริง
    const r = spawnSync(FFMPEG, ['-hide_banner', '-c:v', decoder, '-i', file, '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = /Video: vp9[^,]*, (yuva?\d+p\w*)/.exec(r.stderr);
    j.streams[0].container_pix_fmt = j.streams[0].pix_fmt;
    if (m) j.streams[0].pix_fmt = m[1];
  }
  return j;
}

function frameRGBA(file, t, decoder, w, h) {
  const args = ['-v', 'error'];
  if (decoder) args.push('-c:v', decoder);
  args.push('-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-');
  const buf = sh('ffmpeg', args);
  if (buf.length !== w * h * 4) throw new Error(`ขนาดเฟรมไม่ตรง ${buf.length}`);
  return buf;
}

function savePng(file, t, decoder, out, bgColor) {
  const args = ['-y', '-v', 'error'];
  if (decoder) args.push('-c:v', decoder);
  args.push('-ss', String(t), '-i', file);
  if (bgColor) {
    // วางบนพื้นสีที่กำหนด (ใช้ดูขอบหลังลบพื้นหลัง)
    args.push('-filter_complex', `color=c=${bgColor}:s=16x16[bg];[bg][0:v]scale2ref[bg2][v];[bg2][v]overlay=format=auto`);
  }
  args.push('-frames:v', '1', out);
  sh('ffmpeg', args);
}

function analyzeAlpha(buf) {
  let transparent = 0, opaque = 0, partial = 0, greenish = 0, textPx = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2], a = buf[i + 3];
    if (a === 0) transparent++;
    else if (a === 255) opaque++;
    else partial++;
    if (a > 0) {
      textPx++;
      // ผสมบนพื้นขาว แล้วดูว่าออกเขียวไหม
      const k = a / 255;
      const R = r * k + 255 * (1 - k), G = g * k + 255 * (1 - k), B = b * k + 255 * (1 - k);
      if (G - R > 40 && G - B > 40) greenish++;
    }
  }
  return { transparent, opaque, partial, textPx, greenish };
}

function analyzeOpaque(buf, bg, w, h, refRGBA) {
  // นับพิกเซลตัวอักษร (ไม่ใช่สีพื้น)
  let textPx = 0;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    const d = Math.abs(buf[i] - bg[0]) + Math.abs(buf[i + 1] - bg[1]) + Math.abs(buf[i + 2] - bg[2]);
    if (d > 60) textPx++;
  }
  // หาสีเขียวรั่วเข้าเนื้อตัวอักษร: ใช้ alpha จากไฟล์โปร่งใส (ProRes) ขนาดเดียวกันเป็นตัวอ้างอิง
  // ตรวจเฉพาะพิกเซลที่ทึบ 100% และห่างจากขอบอย่างน้อย R พิกเซล
  // (ขอบ anti-alias 1-2 พิกเซล และรูเล็กๆ ในตัวอักษรที่เห็นพื้นเขียว เป็นเรื่องปกติของไฟล์ chroma key)
  let greenishInside = 0;
  if (refRGBA) {
    const R = 2;
    for (let y = R; y < h - R; y++) {
      for (let x = R; x < w - R; x++) {
        const p = y * w + x;
        const i = p * 4;
        if (!(buf[i + 1] - buf[i] > 60 && buf[i + 1] - buf[i + 2] > 60)) continue;
        let inside = true;
        for (let dy = -R; dy <= R && inside; dy++) for (let dx = -R; dx <= R; dx++) if (refRGBA[(p + dy * w + dx) * 4 + 3] !== 255) { inside = false; break; }
        if (inside) greenishInside++;
      }
    }
  }
  return { textPx, greenishInside };
}

function main() {
  const slug = process.argv[2] || 'order-now';
  const dir = path.join(ROOT, 'storage', 'products', slug);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const outDir = path.join(ROOT, 'storage', 'verify', slug);
  fs.mkdirSync(outDir, { recursive: true });
  const fullFrames = manifest.fps * manifest.duration;
  const parts = manifest.parts || { introSeconds: 0.8, outroSeconds: 0.5 };

  let fail = 0;
  const rows = [];
  for (const f of manifest.files) {
    const file = path.join(dir, f.file);
    const exp = EXPECT[f.format];
    const part = f.part || 'full';
    const expectFrames = exp.still ? 1 : Math.round((part === 'intro' ? parts.introSeconds : part === 'outro' ? parts.outroSeconds : manifest.duration) * manifest.fps);
    const expectDur = expectFrames / manifest.fps;
    // เฟรมที่ใช้ตรวจ: คลิปเต็ม = กลางคลิป, ส่วนเข้า = เฟรมสุดท้าย (ท่านิ่ง), ส่วนออก = เฟรมแรก
    const mid = exp.still ? 0 : part === 'intro' ? (expectFrames - 1) / manifest.fps : part === 'outro' ? 0 : manifest.duration / 2;
    const tag = part === 'full' ? `${f.format}_${f.size}` : `${f.format}_${part}_${f.size}`;
    const decoder = f.format === 'webm_alpha' ? 'libvpx-vp9' : undefined;
    const p = probe(file, decoder);
    const s = p.streams[0];
    const dur = parseFloat(p.format.duration);
    const problems = [];
    if (s.codec_name !== exp.codec) problems.push(`codec=${s.codec_name}`);
    if (![].concat(exp.pix).includes(s.pix_fmt)) problems.push(`pix_fmt=${s.pix_fmt}`);
    if (exp.profile && !String(s.profile).includes(exp.profile)) problems.push(`profile=${s.profile}`);
    if (s.width !== f.width || s.height !== f.height) problems.push(`size=${s.width}x${s.height}`);
    if (!exp.still) {
      if (s.r_frame_rate !== `${manifest.fps}/1`) problems.push(`fps=${s.r_frame_rate}`);
      if (Number(s.nb_read_frames) !== expectFrames) problems.push(`frames=${s.nb_read_frames}`);
      if (Math.abs(dur - expectDur) > 0.05) problems.push(`duration=${dur}`);
    }
    const buf = frameRGBA(file, mid, decoder, f.width, f.height);
    let detail;
    if (exp.alpha) {
      const a = analyzeAlpha(buf);
      detail = `alpha: โปร่ง ${a.transparent} / ทึบ ${a.opaque} / ขอบ ${a.partial}, ขอบออกเขียว ${a.greenish}`;
      if (a.transparent === 0 || a.opaque === 0) problems.push('ไม่มี alpha จริง');
      if (a.greenish > 0) problems.push(`มีเงาเขียว ${a.greenish} px`);
      // คลิปเต็มและส่วนออก: เฟรมสุดท้ายต้องโปร่งใสทั้งหมด
      if (part === 'full' || part === 'outro') {
        const last = frameRGBA(file, (expectFrames - 1) / manifest.fps, decoder, f.width, f.height);
        const la = analyzeAlpha(last);
        if (la.textPx > 0) problems.push(`เฟรมสุดท้ายยังเห็น ${la.textPx} px`);
      }
      savePng(file, mid, decoder, path.join(outDir, `${tag}_on_white.png`), 'white');
      savePng(file, mid, decoder, path.join(outDir, `${tag}_on_magenta.png`), 'magenta');
    } else {
      const ref = manifest.files.find((x) => x.format === (exp.ref || 'prores4444') && x.size === f.size && (x.part || 'full') === part);
      const refBuf = ref ? frameRGBA(path.join(dir, ref.file), mid, undefined, f.width, f.height) : null;
      const a = analyzeOpaque(buf, exp.bg, f.width, f.height, refBuf);
      detail = `พิกเซลตัวอักษร ${a.textPx}, เนื้อตัวอักษรออกเขียว ${a.greenishInside}`;
      if (a.textPx < 1000) problems.push('แทบไม่เห็นตัวอักษรในเฟรมกลาง');
      if (a.greenishInside > 0) problems.push(`ตัวอักษรออกเขียว ${a.greenishInside} px`);
      savePng(file, mid, undefined, path.join(outDir, `${tag}_mid.png`));
    }
    const ok = problems.length === 0;
    if (!ok) fail++;
    rows.push(`${ok ? 'ผ่าน' : 'ไม่ผ่าน'}  ${f.file}\n      ${s.codec_name} ${s.profile || ''} ${s.pix_fmt} ${s.width}x${s.height} ${s.r_frame_rate}fps ${s.nb_read_frames} เฟรม ${dur.toFixed(3)}s\n      ${detail}${ok ? '' : '\n      ปัญหา: ' + problems.join(', ')}`);
  }
  // ชุด 3 ส่วนต้องต่อกันเนียน: เฟรมท้ายส่วนเข้า ≈ ภาพนิ่ง ≈ เฟรมแรกส่วนออก (เทียบค่า alpha เฉลี่ย)
  for (const size of [...new Set(manifest.files.map((f) => f.size))]) {
    const get = (format, part) => manifest.files.find((f) => f.format === format && f.size === size && f.part === part);
    const still = get('still_png', 'hold'), intro = get('parts_prores', 'intro'), outro = get('parts_prores', 'outro');
    if (!still || !intro || !outro) continue;
    const { width: w, height: h } = still;
    const A = frameRGBA(path.join(dir, still.file), 0, undefined, w, h);
    const diff = (B) => { let d = 0; for (let i = 3; i < A.length; i += 4) d += Math.abs(A[i] - B[i]); return d / (w * h); };
    const dIn = diff(frameRGBA(path.join(dir, intro.file), (Math.round(parts.introSeconds * manifest.fps) - 1) / manifest.fps, undefined, w, h));
    const dOut = diff(frameRGBA(path.join(dir, outro.file), 0, undefined, w, h));
    const ok = dIn < 1 && dOut < 1;
    if (!ok) fail++;
    rows.push(`${ok ? 'ผ่าน' : 'ไม่ผ่าน'}  รอยต่อชุด 3 ส่วน ${size}: ส่วนเข้า→ภาพนิ่ง ต่าง ${dIn.toFixed(3)}, ภาพนิ่ง→ส่วนออก ต่าง ${dOut.toFixed(3)} (ต้องน้อยกว่า 1)`);
  }
  console.log(rows.join('\n'));
  console.log(`\nภาพเฟรมกลางสำหรับตรวจด้วยตา: ${path.relative(ROOT, outDir)}/`);
  if (fail) { console.error(`\nไม่ผ่าน ${fail} ไฟล์`); process.exit(1); }
  console.log(`\nผ่านทั้งหมด ${rows.length} ไฟล์`);
}

main();

'use strict';
/*
 * เบิร์นซับลงคลิปลูกค้า ด้วยท่าเคลื่อนไหวเดียวกับแอนิเมชันในร้าน (public/motion.js)
 *
 *  1) Chrome วาดแถบซับโปร่งใส (กว้างเท่าคลิป สูงประมาณ 3.6 เท่าขนาดตัวอักษร) ทีละเฟรม 30 fps
 *     วาดเฉพาะเฟรมที่ภาพขยับ (เข้า/ออก/คำเด้ง) ช่วงค้างวาดครั้งเดียวแล้วใช้ซ้ำด้วย hard link
 *  2) ffmpeg วางแถบซับทับคลิปเดิมตามเวลา เข้ารหัส H.264 + เสียงเดิม (AAC)
 *
 * ทั้งหมดรันแบบ async (ไม่บล็อกร้านระหว่างเข้ารหัสคลิปยาว)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const tools = require('./tools');
const { run } = require('../src/transcribe');

require('../public/motion.js');
const TT = globalThis.TTMotion;
const MOTION_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'motion.js'), 'utf8');

const PLAN = require('../public/subplan');
const { FPS, MAX_SIDE, SIZE_K, POS_Y, outSize, layoutFor } = PLAN;
const HDR_TRC = ['smpte2084', 'arib-std-b67'];

// อ่านข้อมูลคลิป: ขนาดที่แสดงจริง (หมุนแล้ว), ความยาว, มีเสียงไหม
async function probe(file) {
  const r = await run(tools.ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 60 * 1000 });
  const j = JSON.parse(r.out);
  const v = (j.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  if (!v) return { ok: false };
  let rot = 0;
  for (const sd of v.side_data_list || []) if (sd.rotation !== undefined) rot = Number(sd.rotation);
  if (v.tags && v.tags.rotate) rot = Number(v.tags.rotate);
  const turned = Math.abs(rot) % 180 === 90;
  const width = turned ? v.height : v.width;
  const height = turned ? v.width : v.height;
  const duration = Number(j.format && j.format.duration) || Number(v.duration) || 0;
  return {
    ok: Boolean(width && height && duration),
    width, height, duration, audio: Boolean(a), codec: v.codec_name,
    hdr: HDR_TRC.includes(v.color_transfer), fps: v.avg_frame_rate,
  };
}

const planFrames = (cues, o) => PLAN.planFrames(cues, { ...o, TT });

/*
 * opts: { browser?, src, outFile, cues, motion, fill, stroke, strokeRatio, shadow, font: { file, weight, mime },
 *         size: 'sm'|'md'|'lg', position: 'bottom'|'middle'|'top', info (จาก probe), onProgress(p, stage) }
 */
async function renderSubtitled(opts) {
  const { src, outFile, cues, motion = 'pop', font, info } = opts;
  const onProgress = opts.onProgress || (() => {});
  const { w, h } = outSize(info.width, info.height);
  const L = layoutFor(w, h, opts);
  const plan = planFrames(cues, { duration: info.duration, motion });
  const work = fs.mkdtempSync(path.join(opts.tmpDir || os.tmpdir(), 'subs-'));
  const ownBrowser = !opts.browser;
  const t0 = Date.now();
  let browser = null;
  try {
    // 1) วาดแถบซับ
    const shotsDir = path.join(work, 'shots');
    const seq = path.join(work, 'seq');
    fs.mkdirSync(shotsDir);
    fs.mkdirSync(seq);
    const blank = path.join(work, 'blank.png');
    if (plan.shots.length) {
      browser = opts.browser || await tools.launchBrowser();
      const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
      const fontB64 = fs.readFileSync(font.file).toString('base64');
      const html = template.replace('__FONT_URL__', () => `data:${font.mime || 'font/ttf'};base64,${fontB64}`).replace('__MOTION_JS__', () => MOTION_JS);
      const page = await browser.newPage({ viewport: { width: w, height: L.band }, deviceScaleFactor: 1 });
      try {
        await page.setContent(html, { waitUntil: 'load' });
        const allText = cues.map((c) => c.text).join(' ');
        const ok = await page.evaluate(async ([t, wt]) => {
          await document.fonts.load(`${wt} 100px "RenderFont"`, t);
          await document.fonts.ready;
          return document.fonts.check(`${wt} 100px "RenderFont"`, t);
        }, [allText.slice(0, 2000), font.weight || 700]);
        if (!ok) throw new Error('โหลดฟอนต์ไม่สำเร็จ');
        await page.evaluate(() => { document.body.style.background = 'transparent'; });
        await page.screenshot({ path: blank, omitBackground: true, type: 'png' }); // ยังไม่ setup = ว่าง
        let cur = -1;
        for (let i = 0; i < plan.shots.length; i++) {
          const s = plan.shots[i];
          if (s.cue !== cur) {
            cur = s.cue;
            const c = cues[cur];
            const words = motion === 'kinetic' ? (c.w || []).map((x) => x[0]) : null;
            const wordAt = s.timing.wordAt;
            // จำนวนคำต้องตรงกับเวลา ไม่งั้นใช้ท่าเด้งตามลำดับปกติ
            if (words && wordAt && words.filter((x) => !/^\s+$/.test(x)).length !== wordAt.length) delete s.timing.wordAt;
            await page.evaluate((o) => window.setup(o), {
              text: c.text, words: words && words.join('') === c.text ? words : null,
              fill: opts.fill, stroke: opts.stroke, strokeRatio: opts.strokeRatio || 0, shadow: Boolean(opts.shadow),
              weight: font.weight || 700, motion, fixedSize: L.fontPx, maxW: 0.92, maxH: 0.92,
            });
          }
          await page.evaluate(([tt, tm, mo]) => window.setTime(tt, tm, mo), [s.t, s.timing, motion]);
          await page.screenshot({ path: path.join(shotsDir, `s${i}.png`), omitBackground: true, type: 'png' });
          if (i % 5 === 0 || i === plan.shots.length - 1) onProgress(2 + 58 * ((i + 1) / plan.shots.length), 'กำลังวาดซับ');
        }
      } finally {
        await page.close();
      }
    } else {
      // ไม่มีซับเลย: แถบว่าง (PNG โปร่งใส 2x2 ขยายด้วย ffmpeg ไม่ได้ จึงสร้างด้วย ffmpeg ตรงๆ)
      await run(tools.ffmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black@0.0:s=${w}x${L.band},format=rgba`, '-frames:v', '1', blank]);
    }
    // 2) ลำดับเฟรมเต็มความยาวคลิป ด้วย hard link
    for (let f = 0; f < plan.total; f++) {
      const srcPng = plan.frames[f] === null ? blank : path.join(shotsDir, `s${plan.frames[f]}.png`);
      fs.linkSync(srcPng, path.join(seq, `f${String(f).padStart(6, '0')}.png`));
    }
    onProgress(61, 'กำลังรวมซับกับคลิป');
    // 3) วางซับทับคลิป แล้วเข้ารหัส
    const hdr = info.hdr && hasFilter('zscale');
    const base = hdr
      ? `[0:v]zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,scale=${w}:${h}:flags=lanczos,setsar=1[b]`
      : `[0:v]scale=${w}:${h}:flags=lanczos,setsar=1[b]`;
    const fc = `${base};[b][1:v]overlay=0:${L.y}:eof_action=pass:format=auto,format=yuv420p[v]`;
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:2',
      '-i', src, '-framerate', String(FPS), '-i', path.join(seq, 'f%06d.png'),
      '-filter_complex', fc, '-map', '[v]', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', String(info.duration), outFile];
    await run(tools.ffmpegPath(), args, {
      timeoutMs: Math.max(10, info.duration) * 20 * 1000,
      onLine: (line) => {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m) onProgress(61 + 38 * Math.min(1, Number(m[1]) / 1e6 / info.duration), 'กำลังเข้ารหัสวิดีโอ');
      },
    });
    onProgress(99, 'เกือบเสร็จ');
    return { file: path.basename(outFile), bytes: fs.statSync(outFile).size, ms: Date.now() - t0, width: w, height: h, shots: plan.shots.length };
  } finally {
    if (ownBrowser && browser) await browser.close().catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const filterCache = new Map();
function hasFilter(name) {
  if (!filterCache.has(name)) {
    const r = require('child_process').spawnSync(tools.ffmpegPath(), ['-hide_banner', '-filters'], { encoding: 'utf8' });
    filterCache.set(name, r.status === 0 && new RegExp(`\\s${name}\\s`).test(r.stdout));
  }
  return filterCache.get(name);
}

// แยกเสียงเป็น WAV 16 kHz โมโน สำหรับ Whisper
async function extractAudio(src, out) {
  await run(tools.ffmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out], { timeoutMs: 5 * 60 * 1000 });
}

// ภาพหน้าปก (เฟรมที่ 1 วินาที) ใช้แสดงในรายการงาน
async function poster(src, out, info) {
  const t = Math.min(1, Math.max(0, info.duration / 3));
  const { w, h } = outSize(info.width, info.height);
  const k = 480 / Math.max(w, h);
  await run(tools.ffmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', src, '-frames:v', '1',
    '-vf', `scale=${Math.round((w * k) / 2) * 2}:${Math.round((h * k) / 2) * 2}`, '-q:v', '4', out], { timeoutMs: 60 * 1000 });
}

module.exports = { probe, outSize, layoutFor, planFrames, renderSubtitled, extractAudio, poster, FPS, MAX_SIDE, SIZE_K, POS_Y };

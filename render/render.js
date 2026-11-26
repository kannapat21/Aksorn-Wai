#!/usr/bin/env node
/*
 * สคริปต์เรนเดอร์แอนิเมชันข้อความไทย
 *
 * ใช้ headless Chrome (Playwright) วาดข้อความด้วย HTML/CSS แล้วจับภาพทีละเฟรมเป็น PNG พื้นโปร่งใส
 * จากนั้นใช้ ffmpeg รวมเฟรมเป็นไฟล์ 4 ฟอร์แมต x 2 ขนาด (ไม่ใช้ drawtext ของ ffmpeg เพราะสระ/วรรณยุกต์ไทยวางผิด)
 *
 * นอกจากคลิปเต็ม 3 วินาที ยังทำ "ชุด 3 ส่วน" ให้ลูกค้ายืดความยาวเองได้:
 *   1) ส่วนเข้า (intro)  : เด้งเข้าจนนิ่ง 0–0.8 วินาที
 *   2) ภาพนิ่ง PNG โปร่งใส : ท่าค้าง วางแล้วลากยาวเท่าไรก็ได้
 *   3) ส่วนออก (outro)   : จางออก 0.5 วินาที
 * เฟรมสุดท้ายของส่วนเข้า = ภาพนิ่ง = เฟรมแรกของส่วนออก จึงต่อกันได้เนียน
 *
 * ตั้ง FFMPEG_PATH ได้ถ้า ffmpeg ไม่อยู่ใน PATH
 * ถ้าไม่ได้ติดตั้ง Chromium ของ Playwright สคริปต์จะลองใช้ Google Chrome ในเครื่องแทน
 *
 * ตัวอย่าง:
 *   node render/render.js --text "สั่งซื้อเลย" --slug order-now
 *   node render/render.js --text "กดติดตาม" --slug follow --fill "#FFFFFF" --stroke "#E11D48"
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// ----- ค่าตั้งต้น -----
const FPS = 60; // ทุกชุดเรนเดอร์ 60 fps (ท่าเคลื่อนไหวคำนวณจากเวลา)
const DURATION = 3; // วินาที
const TIMING = {
  popUp: 0.30, // 0 → 1.1
  settle: 0.50, // 1.1 → 1
  fadeStart: 2.50, // เริ่มจาง
  fadeEnd: DURATION - 1 / FPS, // เฟรมสุดท้ายโปร่งใสสนิท
};

// ชุด 3 ส่วน (นับเป็นเฟรม)
const PARTS = {
  introFrames: Math.round(0.8 * FPS), // เฟรม 0..23 (จบที่ท่านิ่ง)
  holdFrame: Math.round(1.0 * FPS), // เฟรมที่ใช้ทำภาพนิ่ง
  outroStart: Math.round(TIMING.fadeStart * FPS), // เฟรม 75..89
};

const tools = require('./tools');
// ท่าเคลื่อนไหวชุดเดียวกับในเบราว์เซอร์ (ใช้หาเวลาเข้า/ค้าง/ออกของแต่ละท่า)
require('../public/motion.js');
const TT = globalThis.TTMotion;

// เวลาและชุด 3 ส่วนของคลิปเต็ม 3 วินาที ตามท่า
function timingOf(motion) {
  if (!TT.meta(motion).timed) return TIMING; // ท่าฟรีรุ่นแรก (pop/drop) ใช้ค่าเดิมทุกอย่าง
  return TT.timingFor(motion, DURATION, FPS);
}
function partsOf(motion) {
  const m = TT.meta(motion);
  if (!m.timed) return PARTS;
  // ท่าอื่นๆ: ส่วนเข้าจบตรงจุดที่ตัวอักษรนิ่ง · ภาพนิ่ง = เฟรมนั้น (ยังไม่มีแสงวิ่ง) · ส่วนออกเริ่มตอนเริ่มจาง
  const introFrames = Math.round(m.intro * FPS);
  return { introFrames, holdFrame: introFrames, outroStart: Math.round((DURATION - m.outro) * FPS) };
}
const FFMPEG = tools.ffmpegPath();
const MOTION_JS = fs.readFileSync(path.join(ROOT, 'public', 'motion.js'), 'utf8');
const DEFAULT_FONT = { file: path.join(ROOT, 'fonts', 'Kanit-Bold.ttf'), weight: 700 };

const SIZES = [
  { id: 'vertical', w: 1080, h: 1920, label: 'แนวตั้ง 1080x1920' },
  { id: 'horizontal', w: 1920, h: 1080, label: 'แนวนอน 1920x1080' },
];

// ฟอร์แมตไฟล์ที่ส่งให้ลูกค้า (key ต้องตรงกับ config/editors.json)
const FORMATS = {
  mp4_green: { ext: 'mp4', label: 'MP4 พื้นเขียว (Chroma Key)' },
  mp4_black: { ext: 'mp4', label: 'MP4 พื้นดำ (Screen/Add)' },
  prores4444: { ext: 'mov', label: 'MOV ProRes 4444 โปร่งใส' },
  webm_alpha: { ext: 'webm', label: 'WebM VP9 โปร่งใส' },
  // ชุด 3 ส่วน
  parts_green: { ext: 'mp4', label: 'ส่วนเข้า/ออก MP4 พื้นเขียว' },
  parts_prores: { ext: 'mov', label: 'ส่วนเข้า/ออก MOV ProRes 4444 โปร่งใส' },
  still_png: { ext: 'png', label: 'ภาพนิ่ง PNG โปร่งใส (ยืดได้)' },
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    }
  }
  return out;
}

function run(cmd, args) {
  if (cmd === 'ffmpeg') cmd = FFMPEG;
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`${cmd} ล้มเหลว (exit ${r.status})\n${r.stderr.slice(-3000)}`);
  }
  return r.stdout;
}

const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];

async function renderFrames(browser, { text, fill, stroke, strokeRatio = 0.05, shadow = false, font = DEFAULT_FONT, motion = 'pop', w, h, dir, onFrame }) {
  const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
  const fontB64 = fs.readFileSync(font.file).toString('base64');
  // ใช้ฟังก์ชันแทนที่ กันอักขระ $ ในโค้ดถูกตีความเป็นรูปแบบพิเศษ
  const html = template.replace('__FONT_URL__', () => `data:${font.mime || "font/ttf"};base64,${fontB64}`).replace('__MOTION_JS__', () => MOTION_JS);

  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  const fontOk = await page.evaluate(async ([t, wt]) => {
    await document.fonts.load(`${wt} 100px "RenderFont"`, t);
    await document.fonts.ready;
    return document.fonts.check(`${wt} 100px "RenderFont"`, t);
  }, [text, font.weight || 700]);
  if (!fontOk) throw new Error('โหลดฟอนต์ไม่สำเร็จ (จะไม่เรนเดอร์ด้วยฟอนต์สำรอง)');

  // ข้อความส่งเป็นข้อมูลให้ setup() ใส่ด้วย textContent ไม่ได้ต่อเป็น HTML
  const info = await page.evaluate((o) => window.setup(o), { text, fill, stroke, strokeRatio, shadow, weight: font.weight || 700, motion });

  const total = Math.round(FPS * DURATION);
  const timing = timingOf(motion);
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await page.evaluate(([tt, tm, mo]) => window.setTime(tt, tm, mo), [t, timing, motion]);
    await page.screenshot({
      path: path.join(dir, `f${String(i).padStart(4, '0')}.png`),
      omitBackground: true, // PNG พื้นโปร่งใส
      type: 'png',
    });
    if (onFrame) onFrame(i + 1, total);
  }
  await page.close();
  return { frames: total, fontSize: info.fontSize };
}

async function renderWatermark(browser, { w, h, file }) {
  const fontB64 = fs.readFileSync(path.join(ROOT, 'fonts', 'Kanit-Bold.ttf')).toString('base64');
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const cells = Array.from({ length: 60 }, () => '<span>ตัวอย่าง · PREVIEW</span>').join('');
  await page.setContent(`<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
    @font-face{font-family:K;src:url(data:font/ttf;base64,${fontB64});font-weight:700}
    html,body{margin:0;background:transparent;overflow:hidden;width:${w}px;height:${h}px}
    .wrap{position:absolute;left:-50%;top:-50%;width:200%;height:200%;transform:rotate(-24deg);
      display:flex;flex-wrap:wrap;align-content:center;justify-content:center;gap:60px 90px}
    span{font:700 ${Math.round(h / 16)}px K;color:rgba(255,255,255,.28);
      -webkit-text-stroke:1px rgba(0,0,0,.25);white-space:nowrap}
  </style></head><body><div class="wrap">${cells}</div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: true });
  await page.close();
}

function encodeAll({ framesDir, w, h, outDir, base, sizeId, want = null, motion = 'pop' }) {
  const need = (fmt) => !want || want.includes(fmt);
  const input = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(framesDir, 'f%04d.png')];
  const files = {};
  const name = (fmt) => `${base}_${fmt}_${w}x${h}.${FORMATS[fmt].ext}`;

  // 1) MP4 พื้นเขียว #00FF00
  // 2) MP4 พื้นดำ
  for (const [fmt, color] of [['mp4_green', '0x00FF00'], ['mp4_black', '0x000000']]) {
    if (!need(fmt)) continue;
    const out = path.join(outDir, name(fmt));
    run('ffmpeg', [
      ...input,
      '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}:r=${FPS}`,
      '-filter_complex', '[1:v][0:v]overlay=shortest=1:format=auto,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]',
      '-map', '[v]', '-frames:v', String(FPS * DURATION),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-profile:v', 'high', '-tune', 'animation',
      ...BT709, '-movflags', '+faststart', out,
    ]);
    files[fmt] = out;
  }

  // 3) MOV ProRes 4444 โปร่งใสจริง
  if (need('prores4444')) {
    const out = path.join(outDir, name('prores4444'));
    run('ffmpeg', [
      ...input,
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuva444p10le',
      '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16',
      // qscale 6 เหมือนไฟล์เดียว: ขอบยังคม แต่ท่าที่มีแสงฟุ้ง/เบลอไม่บวมเกิน 100MB
      '-qscale:v', '6', '-vendor', 'apl0', ...BT709, out,
    ]);
    files.prores4444 = out;
  }

  // 4) WebM VP9 พร้อม alpha
  if (need('webm_alpha')) {
    const out = path.join(outDir, name('webm_alpha'));
    run('ffmpeg', [
      ...input,
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuva420p',
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24',
      '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-auto-alt-ref', '0',
      // เฟรมสุดท้ายเป็นคีย์เฟรม: ค่า alpha เล็กๆ ที่ค้างจากเฟรมก่อน (ท่าที่มีเบลอ/แสงฟุ้ง) จะไม่ติดมา ใสสนิทจริง
      '-force_key_frames', `expr:gte(n,${FPS * DURATION - 1})`,
      ...BT709, out,
    ]);
    files.webm_alpha = out;
  }

  const full = Object.entries(files).map(([format, file]) => ({
    format,
    part: 'full',
    size: sizeId,
    width: w,
    height: h,
    file: path.basename(file),
    bytes: fs.statSync(file).size,
  }));
  return [...full, ...encodeParts({ framesDir, w, h, outDir, base, sizeId, want, motion })];
}

// ชุด 3 ส่วน: ส่วนเข้า / ภาพนิ่ง / ส่วนออก
function encodeParts({ framesDir, w, h, outDir, base, sizeId, want = null, motion = 'pop' }) {
  const PARTS = partsOf(motion);
  const need = (fmt) => !want || want.includes(fmt);
  const out = [];
  const add = (format, part, file) => out.push({
    format, part, size: sizeId, width: w, height: h, file: path.basename(file), bytes: fs.statSync(file).size,
  });
  const ranges = {
    intro: { start: 0, count: PARTS.introFrames },
    outro: { start: PARTS.outroStart, count: FPS * DURATION - PARTS.outroStart },
  };
  for (const [part, r] of Object.entries(ranges)) {
    const input = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(FPS),
      '-start_number', String(r.start), '-i', path.join(framesDir, 'f%04d.png')];

    if (need('parts_green')) {
    const green = path.join(outDir, `${base}_parts_green_${part}_${w}x${h}.mp4`);
    run('ffmpeg', [
      ...input,
      '-f', 'lavfi', '-i', `color=c=0x00FF00:s=${w}x${h}:r=${FPS}`,
      '-filter_complex', '[1:v][0:v]overlay=shortest=1:format=auto,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]',
      '-map', '[v]', '-frames:v', String(r.count),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-profile:v', 'high', '-tune', 'animation',
      ...BT709, '-movflags', '+faststart', green,
    ]);
    add('parts_green', part, green);
    }

    if (need('parts_prores')) {
    const prores = path.join(outDir, `${base}_parts_prores_${part}_${w}x${h}.mov`);
    run('ffmpeg', [
      ...input, '-frames:v', String(r.count),
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuva444p10le',
      '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16',
      '-qscale:v', '6', '-vendor', 'apl0', ...BT709, prores,
    ]);
    add('parts_prores', part, prores);
    }
  }
  // ภาพนิ่ง = เฟรม PNG โปร่งใสจาก Chrome ตรงๆ (ไม่ผ่านการบีบอัด)
  if (!need('still_png')) return out;
  const still = path.join(outDir, `${base}_still_${w}x${h}.png`);
  fs.copyFileSync(path.join(framesDir, `f${String(PARTS.holdFrame).padStart(4, '0')}.png`), still);
  add('still_png', 'hold', still);
  return out;
}

function makePreview({ framesDir, watermark, out, poster, w, h }) {
  // พรีวิวบนพื้นลายตารางหมากรุก (สื่อว่าโปร่งใส) + ลายน้ำ ย่อเหลือ 540px ด้านยาวน้อยลง
  const pw = w > h ? 960 : 540;
  const ph = w > h ? 540 : 960;
  const checker = `color=c=0x2a2f3a:s=${w}x${h}:r=${FPS},geq=lum='if(mod(floor(X/40)+floor(Y/40),2),60,45)':cb=128:cr=128`;
  const common = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', checker,
    '-framerate', String(FPS), '-i', path.join(framesDir, 'f%04d.png'), '-i', watermark];
  const fc = `[0:v][1:v]overlay=shortest=1[a];[a][2:v]overlay,scale=${pw}:${ph}:flags=lanczos,format=yuv420p[v]`;
  run('ffmpeg', [...common, '-filter_complex', fc, '-map', '[v]', '-frames:v', String(FPS * DURATION),
    '-c:v', 'libx264', '-crf', '26', '-preset', 'medium', '-movflags', '+faststart', out]);
  // โปสเตอร์ = เฟรมที่ 1.5 วินาที
  run('ffmpeg', [...common, '-filter_complex', fc.replace('[v]', `,select=eq(n\\,${FPS * 1.5})[v]`),
    '-map', '[v]', '-frames:v', '1', '-q:v', '3', poster]);
}

/*
 * เรนเดอร์แบบเรียกจากโค้ด (ใช้ตอนลูกค้าปรับแต่งในคลัง)
 * opts: { text, fill, stroke, strokeRatio, shadow, font: { file, weight, licenseFile }, outDir, base,
 *         formats: ['parts_green', ...] หรือ null = ทุกฟอร์แมต, onProgress(0..100, ข้อความ) }
 * คืนค่า: รายการไฟล์แบบเดียวกับ manifest.files
 */
async function renderCustom(opts) {
  const { text, fill, stroke, strokeRatio = 0.05, shadow = false, font = DEFAULT_FONT, outDir, base, formats = null, motion = 'pop' } = opts;
  const onProgress = opts.onProgress || (() => {});
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await tools.launchBrowser();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `render-${base}-`));
  const files = [];
  try {
    for (let si = 0; si < SIZES.length; si++) {
      const s = SIZES[si];
      const framesDir = path.join(work, s.id);
      fs.mkdirSync(framesDir);
      const span = 100 / SIZES.length;
      const start = si * span;
      await renderFrames(browser, {
        text, fill, stroke, strokeRatio, shadow, font, motion, w: s.w, h: s.h, dir: framesDir,
        onFrame: (i, n) => { if (i % 6 === 0) onProgress(Math.round(start + span * 0.6 * (i / n)), `กำลังวาดเฟรม ${s.label}`); },
      });
      onProgress(Math.round(start + span * 0.65), `กำลังเข้ารหัสไฟล์ ${s.label}`);
      files.push(...encodeAll({ framesDir, w: s.w, h: s.h, outDir, base, sizeId: s.id, want: formats, motion }));
      onProgress(Math.round(start + span), `เสร็จ ${s.label}`);
    }
  } finally {
    await browser.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
  return files;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = args.text;
  const slug = args.slug;
  if (!text || !slug || !/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) {
    console.error('วิธีใช้: node render/render.js --text "ข้อความ" --slug ชื่อภาษาอังกฤษ-ไม่มีช่องว่าง [--fill "#FFD400"] [--stroke "#111111"]');
    process.exit(1);
  }
  const fill = args.fill || '#FFD400';
  const stroke = args.stroke || '#111111';
  const motion = args.motion || 'pop';
  if (!TT.MOTIONS.includes(motion)) { console.error(`--motion ต้องเป็น ${TT.MOTIONS.join(' / ')}`); process.exit(1); }
  const outDir = path.resolve(args['out-dir'] || path.join(ROOT, 'storage', 'products', slug));
  // --no-prores: ไม่ทำไฟล์ ProRes สำเร็จรูป (ไฟล์ละ 10–60 MB ทำให้ repo บวม) ลูกค้าที่ใช้ Premiere/DaVinci/Final Cut
  // กด "ปรับแต่ง" แล้วได้ MOV ProRes โปร่งใสตามความยาวที่เลือกแทน
  const want = args['no-prores'] ? Object.keys(FORMATS).filter((f) => f !== 'prores4444' && f !== 'parts_prores') : null;
  const previewDir = path.resolve(args['preview-dir'] || path.join(ROOT, 'public', 'previews'));
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(previewDir, { recursive: true });

  const browser = await tools.launchBrowser();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `render-${slug}-`));
  const allFiles = [];
  try {
    for (const s of SIZES) {
      const framesDir = path.join(work, s.id);
      fs.mkdirSync(framesDir);
      const t0 = Date.now();
      const r = await renderFrames(browser, { text, fill, stroke, motion, w: s.w, h: s.h, dir: framesDir });
      console.log(`[${s.id}] เรนเดอร์ ${r.frames} เฟรม (ฟอนต์ ${r.fontSize}px) ใน ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      allFiles.push(...encodeAll({ framesDir, w: s.w, h: s.h, outDir, base: slug, sizeId: s.id, motion, want }));
      console.log(`[${s.id}] เข้ารหัสครบ 4 ฟอร์แมต + ชุด 3 ส่วน`);

      if (s.id === 'horizontal' || s.id === 'vertical') {
        const wm = path.join(work, `wm-${s.id}.png`);
        await renderWatermark(browser, { w: s.w, h: s.h, file: wm });
        makePreview({
          framesDir, watermark: wm, w: s.w, h: s.h,
          out: path.join(previewDir, `${slug}_${s.id}.mp4`),
          poster: path.join(previewDir, `${slug}_${s.id}.jpg`),
        });
      }
    }
  } finally {
    await browser.close();
    if (!args['keep-frames']) fs.rmSync(work, { recursive: true, force: true });
    else console.log('เก็บเฟรมไว้ที่', work);
  }

  // สัญญาอนุญาตฟอนต์ต้องติดไปกับไฟล์ที่ส่งให้ลูกค้า
  fs.copyFileSync(path.join(ROOT, 'fonts', 'OFL.txt'), path.join(outDir, 'Kanit-OFL.txt'));

  const manifest = {
    slug, text, fill, stroke, motion, fps: FPS, duration: DURATION, timing: timingOf(motion),
    parts: { introSeconds: partsOf(motion).introFrames / FPS, outroSeconds: (FPS * DURATION - partsOf(motion).outroStart) / FPS, holdFrame: partsOf(motion).holdFrame },
    renderedAt: new Date().toISOString(),
    formats: FORMATS,
    files: allFiles,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nเสร็จ: ${allFiles.length} ไฟล์ใน ${path.relative(ROOT, outDir)}`);
  console.log(`พรีวิว: ${path.relative(ROOT, previewDir)}/${slug}_*.mp4`);
  console.log(`\nเพิ่มสินค้านี้ในร้านโดยใส่ใน config/products.json เช่น:\n${JSON.stringify({
    slug, title: text, price: 4900, description: '...', faq: [],
  }, null, 2)}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}

/*
 * ไฟล์เดียวสำหรับลูกค้า (ใช้ตอนปรับแต่งในคลัง): เลือกแนว (ตั้ง/นอน) และความยาวรวมได้
 *   ท่าเดิม: เด้งเข้า 0.5 วินาที → ค้าง → จางออก 0.5 วินาทีสุดท้าย
 *   วาดเฉพาะเฟรมที่ไม่ซ้ำ (เข้า 15 + ค้าง 1 + ออก 15 = 31 เฟรม) ไม่ว่าคลิปจะยาวแค่ไหน
 *   แล้วต่อเป็นลำดับเฟรมด้วย hard link (ไม่คัดลอกไฟล์) ก่อนเข้ารหัสครั้งเดียว
 * format: mp4_green | mp4_black | prores4444 | webm_alpha
 */
const SINGLE_FPS = FPS;
const SINGLE = {
  mp4_green: { ext: 'mp4', mime: 'video/mp4' },
  mp4_black: { ext: 'mp4', mime: 'video/mp4' },
  prores4444: { ext: 'mov', mime: 'video/quicktime' },
  webm_alpha: { ext: 'webm', mime: 'video/webm' },
};

async function renderSingle(opts) {
  const { text, fill, stroke, strokeRatio = 0.05, shadow = false, font = DEFAULT_FONT, format, outFile } = opts;
  const motion = opts.motion || 'pop';
  const size = SIZES.find((x) => x.id === opts.size) || SIZES[0];
  const motion0 = TT.meta(opts.motion || 'pop');
  // สั้นสุดต้องพอให้ท่าเข้าและออกเล่นครบ
  const seconds = Math.max(1.5, motion0.intro + motion0.outro + 0.2, Math.min(60, Number(opts.seconds) || 3));
  const onProgress = opts.onProgress || (() => {});
  if (!SINGLE[format]) throw new Error(`ไม่รู้จักฟอร์แมต ${format}`);
  const FPS = Number(opts.fps) || SINGLE_FPS; // 60 fps (ท่าเคลื่อนไหวคำนวณจากเวลา จึงลื่นขึ้นโดยไม่เปลี่ยนความยาว)
  const total = Math.round(seconds * FPS);
  const mm = TT.meta(motion);
  const inN = Math.round(mm.intro * FPS); // เฟรมช่วงเข้า
  const outN = Math.round(mm.outro * FPS); // เฟรมช่วงออก
  // ช่วงค้าง: นิ่ง 1 เฟรม หรือวนหนึ่งรอบ (ไม่เกินความยาวช่วงค้างจริง)
  const loopN = mm.loop ? Math.max(1, Math.min(Math.round(mm.loop * FPS), total - inN - outN)) : 1;
  const timing = TT.timingFor(motion, seconds, FPS);
  const ownBrowser = !opts.browser;
  const browser = opts.browser || await tools.launchBrowser();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'single-'));
  const t0 = Date.now();
  try {
    // 1) วาดเฟรมที่ไม่ซ้ำ
    const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
    const fontB64 = fs.readFileSync(font.file).toString('base64');
    const html = template.replace('__FONT_URL__', () => `data:${font.mime || 'font/ttf'};base64,${fontB64}`).replace('__MOTION_JS__', () => MOTION_JS);
    const page = await browser.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const ok = await page.evaluate(async ([t, wt]) => {
        await document.fonts.load(`${wt} 100px "RenderFont"`, t);
        await document.fonts.ready;
        return document.fonts.check(`${wt} 100px "RenderFont"`, t);
      }, [text, font.weight || 700]);
      if (!ok) throw new Error('โหลดฟอนต์ไม่สำเร็จ');
      await page.evaluate((o) => window.setup(o), { text, fill, stroke, strokeRatio, shadow, weight: font.weight || 700, motion });
      const unique = [];
      for (let i = 0; i < inN; i++) unique.push({ name: `in${i}`, t: i / FPS });
      for (let k = 0; k < loopN; k++) unique.push({ name: `hold${k}`, t: timing.settle + (timing.holdOff || 0) + k / FPS });
      for (let k = 0; k < outN; k++) unique.push({ name: `out${k}`, t: timing.fadeStart + k / FPS });
      for (let i = 0; i < unique.length; i++) {
        await page.evaluate(([tt, tm, mo]) => window.setTime(tt, tm, mo), [unique[i].t, timing, motion]);
        await page.screenshot({ path: path.join(work, `${unique[i].name}.png`), omitBackground: true, type: 'png' });
        onProgress(Math.round(5 + 55 * ((i + 1) / unique.length)), 'กำลังวาดตัวอักษร');
      }
    } finally {
      await page.close();
    }
    // 2) ลำดับเฟรมเต็มความยาว ด้วย hard link
    const seq = path.join(work, 'seq');
    fs.mkdirSync(seq);
    for (let i = 0; i < total; i++) {
      const src = i < inN ? `in${i}` : i >= total - outN ? `out${i - (total - outN)}` : `hold${TT.holdIndex(i - inN, total - inN - outN, loopN)}`;
      fs.linkSync(path.join(work, `${src}.png`), path.join(seq, `f${String(i).padStart(5, '0')}.png`));
    }
    onProgress(65, 'กำลังเข้ารหัสวิดีโอ');
    // 3) เข้ารหัสครั้งเดียว (ตั้งค่าให้เร็ว คุณภาพยังคมสำหรับกราฟิกตัวอักษร)
    const input = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(seq, 'f%05d.png')];
    const { w, h } = size;
    if (format === 'mp4_green' || format === 'mp4_black') {
      const color = format === 'mp4_green' ? '0x00FF00' : '0x000000';
      run('ffmpeg', [
        ...input, '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}:r=${FPS}`,
        '-filter_complex', `[1:v][0:v]overlay=shortest=1:format=auto,scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p[v]`,
        '-map', '[v]', '-frames:v', String(total),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-profile:v', 'high', '-tune', 'animation',
        ...BT709, '-movflags', '+faststart', outFile,
      ]);
    } else if (format === 'prores4444') {
      // qscale 6: ขอบตัวอักษรยังคม แต่ไฟล์เล็กกว่าค่าอัตโนมัติมาก (ProRes ไม่มีการบีบข้ามเฟรม ไฟล์จึงโตตามความยาว)
      run('ffmpeg', [
        ...input, '-vf', `scale=out_color_matrix=bt709:out_range=tv,format=yuva444p10le`,
        '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-qscale:v', '6',
        '-vendor', 'apl0', ...BT709, outFile,
      ]);
    } else {
      run('ffmpeg', [
        ...input, '-vf', `scale=out_color_matrix=bt709:out_range=tv,format=yuva420p`,
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '28',
        '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0',
        '-force_key_frames', `expr:gte(n,${total - 1})`, ...BT709, outFile,
      ]);
    }
    onProgress(99, 'เกือบเสร็จ');
    return { file: path.basename(outFile), bytes: fs.statSync(outFile).size, ms: Date.now() - t0, frames: total, ...SINGLE[format] };
  } finally {
    if (ownBrowser) await browser.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { FORMATS, SIZES, FPS, DURATION, PARTS, SINGLE, SINGLE_FPS, renderCustom, renderSingle };

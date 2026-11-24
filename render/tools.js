'use strict';
/*
 * หาเครื่องมือที่ใช้เรนเดอร์ และตรวจว่าพร้อมไหม
 *   ffmpeg: FFMPEG_PATH → แพ็กเกจ ffmpeg-static (ถ้าติดตั้งไว้) → ffmpeg ใน PATH
 *   ffprobe: FFPROBE_PATH → ffprobe-static → ffprobe ใน PATH
 *   เบราว์เซอร์: Chromium ของ Playwright → Google Chrome ในเครื่อง
 */
const fs = require('fs');
const { spawnSync } = require('child_process');

const PLAYWRIGHT = 'playwright';
function tryRequire(name) {
  try { return require(name); } catch { return null; }
}

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const s = tryRequire('ffmpeg-static');
  if (typeof s === 'string' && fs.existsSync(s)) return s;
  return 'ffmpeg';
}

function ffprobePath() {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const s = tryRequire('ffprobe-static');
  if (s && s.path && fs.existsSync(s.path)) return s.path;
  return 'ffprobe';
}

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
];

// เปิดเบราว์เซอร์สำหรับวาดเฟรม: ใช้ Chromium ของ Playwright ถ้ามี ไม่งั้นใช้ Google Chrome ในเครื่อง
async function launchBrowser() {
  const { chromium } = require(PLAYWRIGHT); // ชื่อในตัวแปร: ไม่ให้ตัวรวมไฟล์ของ Netlify ดึง Playwright เข้าไปในฟังก์ชัน
  try {
    return await chromium.launch();
  } catch (e) {
    return chromium.launch({ channel: 'chrome' });
  }
}

const NEED_ENCODERS = ['libx264', 'prores_ks', 'libvpx-vp9'];

// ตรวจความพร้อม (ไม่เปิดเบราว์เซอร์จริง เพื่อให้เร็ว)
function checkRenderTools() {
  const result = { ok: false, ffmpeg: { ok: false, path: ffmpegPath(), missing: [] }, browser: { ok: false, how: '' } };
  const r = spawnSync(result.ffmpeg.path, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (r.status === 0) {
    result.ffmpeg.missing = NEED_ENCODERS.filter((e) => !new RegExp(`\\s${e}\\s`).test(r.stdout));
    result.ffmpeg.ok = result.ffmpeg.missing.length === 0;
  } else {
    result.ffmpeg.missing = ['ffmpeg'];
  }
  const pw = tryRequire(PLAYWRIGHT);
  if (pw) {
    let exe = '';
    try { exe = pw.chromium.executablePath(); } catch { exe = ''; }
    if (exe && fs.existsSync(exe)) result.browser = { ok: true, how: 'Chromium ของ Playwright' };
    else if (CHROME_PATHS.some((p) => fs.existsSync(p))) result.browser = { ok: true, how: 'Google Chrome ในเครื่อง' };
  }
  result.ok = result.ffmpeg.ok && result.browser.ok;
  return result;
}

// ข้อความบอกวิธีติดตั้งสิ่งที่ขาด (ภาษาไทย)
function installHelp(t) {
  const lines = [];
  if (!t || t.ok) return lines; // โหมดเบราว์เซอร์ (ไม่มี ffmpeg/Chrome ในเซิร์ฟเวอร์) ถือว่าพร้อมอยู่แล้ว
  if (!t.ffmpeg.ok) {
    lines.push(t.ffmpeg.missing.includes('ffmpeg')
      ? 'ยังไม่มี ffmpeg: เปิด Terminal ในโฟลเดอร์ร้าน แล้วพิมพ์  npm install --save-dev ffmpeg-static ffprobe-static'
      : `ffmpeg ที่มีอยู่ขาดตัวเข้ารหัส ${t.ffmpeg.missing.join(', ')}: ติดตั้งใหม่ด้วย  npm install --save-dev ffmpeg-static ffprobe-static`);
  }
  if (!t.browser.ok) lines.push('ยังไม่มีเบราว์เซอร์สำหรับวาดเฟรม: ติดตั้ง Google Chrome หรือพิมพ์  npx playwright install chromium');
  return lines;
}

module.exports = { ffmpegPath, ffprobePath, launchBrowser, checkRenderTools, installHelp };

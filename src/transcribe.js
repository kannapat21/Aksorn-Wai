'use strict';
/*
 * ตัวถอดเสียง: เรียก scripts/transcribe.py (Whisper ในเครื่อง: mlx-whisper บน Mac ชิป Apple / faster-whisper)
 * ไม่ส่งเสียงลูกค้าออกนอกเครื่อง ไม่มีค่าใช้จ่ายรายครั้ง
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

function createTranscriber(cfg) {
  const S = cfg.subtitles;
  let checked = null;
  let checkedAt = 0;
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_TELEMETRY: '1', TOKENIZERS_PARALLELISM: 'false' };
  // ให้ Whisper เจอ ffmpeg ตัวเดียวกับร้าน (เครื่องที่ไม่มี ffmpeg ในระบบ ใช้ ffmpeg-static ได้)
  try {
    const ff = require('../render/tools').ffmpegPath();
    if (ff && path.isAbsolute(ff)) env.PATH = `${path.dirname(ff)}${path.delimiter}${env.PATH || ''}`;
  } catch { /* ข้าม */ }

  // ตรวจว่าติดตั้งตัวถอดเสียงแล้วหรือยัง (จำผล 1 นาทีถ้ายังไม่พร้อม เผื่อเพิ่งติดตั้ง)
  async function check() {
    if (S.engine === 'off') return { ok: false, reason: 'ปิดระบบซับอัตโนมัติอยู่ (SUBTITLE_ENGINE=off)' };
    if (checked && (checked.ok || Date.now() - checkedAt < 60 * 1000)) return checked;
    checkedAt = Date.now();
    try {
      if (S.python.includes(path.sep) && !fs.existsSync(S.python)) throw new Error(`ไม่พบ ${S.python}`);
      const r = await run(S.python, [SCRIPT, '--check', '--engine', S.engine], { timeoutMs: 60 * 1000, env });
      const j = JSON.parse(r.out.trim().split('\n').pop());
      checked = { ok: true, engine: j.engine };
    } catch (e) {
      checked = { ok: false, reason: 'ยังไม่ได้ติดตั้งตัวถอดเสียง (Whisper)', detail: String(e.message).slice(0, 300) };
    }
    return checked;
  }

  async function transcribe(audioFile, { onProgress = () => {}, outFile }) {
    const args = [SCRIPT, audioFile, '--out', outFile, '--engine', S.engine, '--language', 'th'];
    if (S.model) args.push('--model', S.model);
    await run(S.python, args, {
      env,
      timeoutMs: S.asrTimeoutMin * 60 * 1000,
      onLine: (line) => { const m = /^PROGRESS (\d+)/.exec(line); if (m) onProgress(Number(m[1])); },
    });
    return JSON.parse(fs.readFileSync(outFile, 'utf8'));
  }

  return { check, transcribe };
}

module.exports = { createTranscriber, run };

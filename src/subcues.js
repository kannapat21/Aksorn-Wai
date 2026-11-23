'use strict';
/*
 * ซับอัตโนมัติ: แปลงผลถอดเสียง (คำ + เวลา) เป็นบรรทัดซับ, ตรวจซับที่ลูกค้าแก้, ทำไฟล์ .srt
 *
 * บรรทัดซับ (cue) = { id, start, end, text, w }
 *   w: คำในบรรทัด [[ข้อความ, วินาทีจากต้นบรรทัด | null(ช่องว่าง)], ...] ใช้ให้ท่า "คำเด้ง" เด้งตรงจังหวะพูด
 * ภาษาไทยไม่เว้นวรรคระหว่างคำ จึงตัดคำด้วย Intl.Segmenter('th') แล้วแบ่งบรรทัดที่ช่องว่าง/ช่วงเงียบก่อน
 */
const crypto = require('crypto');

// อักษรไทย, ASCII ที่พิมพ์ได้ (ยกเว้น < > ` \), ช่องว่าง และเครื่องหมายที่ใช้บ่อย (ชุดเดียวกับหน้าปรับแต่ง)
const ALLOWED_RE = /^[ก-ฺ฿-๛ !"#$%&'()*+,\-./0-9:;=?@A-Z[\]^_a-z{|}~ ‘’“”…–—•·×÷°]*$/u;
const MAX_CUE_GRAPHEMES = 60;
const MAX_CUES = 600;
const MIN_CUE = 0.3; // บรรทัดสั้นสุด (วินาที)

const segG = () => new Intl.Segmenter('th', { granularity: 'grapheme' });
const segW = () => new Intl.Segmenter('th', { granularity: 'word' });
const graphemes = (s) => Array.from(segG().segment(s), (x) => x.segment);
const glen = (s) => graphemes(s).length;
const round2 = (x) => Math.round(x * 100) / 100;
const newId = () => crypto.randomBytes(5).toString('hex');

function cleanText(raw) {
  return String(raw || '')
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ')
    .replace(/[<>`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// แบ่งบรรทัดยาวแค่ไหน (จำนวนตัวอักษรไทยที่วางได้หนึ่งบรรทัดตามแนวคลิป)
function maxCharsFor(width, height) {
  const a = width / Math.max(1, height);
  return a < 0.8 ? 18 : a < 1.3 ? 24 : 32;
}

/*
 * ผลถอดเสียง words: [{ text, start, end }] (ชิ้นคำจาก Whisper ภาษาไทยมักเป็นชิ้นย่อยไม่ตรงคำ)
 * → โทเคนคำไทยพร้อมเวลา: ให้เวลาทีละตัวอักษรแบบเฉลี่ยในชิ้น แล้วตัดคำใหม่ด้วย Intl.Segmenter
 */
function tokensFromWords(words) {
  let text = '';
  const times = []; // เวลาของแต่ละ code unit
  let prevEnd = 0;
  const bounds = new Set([0]); // จุดต่อระหว่างชิ้นของ Whisper (ตัดบรรทัดตรงนี้ได้สบายใจกว่ากลางชิ้น)
  for (const w of words || []) {
    let s = String(w.text ?? w.word ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '');
    let start = Number(w.start), end = Number(w.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end < start) end = start;
    if (start < prevEnd) start = prevEnd;
    if (end < start) end = start;
    const lead = /^\s/.test(s);
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    // ช่องว่างระหว่างชิ้น = ที่แบ่งบรรทัดได้ (Whisper ใส่ช่องว่างตามที่คนไทยเว้นวรรคจริง)
    if (text && lead && !text.endsWith(' ')) { text += ' '; times.push(start); }
    bounds.add(text.length);
    const g = graphemes(s);
    const per = (end - start) / g.length;
    g.forEach((ch, i) => { for (let k = 0; k < ch.length; k++) times.push(start + per * i); });
    text += s;
    prevEnd = end;
    times.lastEnd = end;
  }
  // ตัดคำ
  const out = [];
  for (const seg of segW().segment(text)) {
    const i = seg.index;
    const t0 = times[i];
    const t1 = i + seg.segment.length < times.length ? times[i + seg.segment.length] : (times.lastEnd ?? t0);
    if (/^\s+$/.test(seg.segment)) { out.push({ space: true, text: ' ', start: t0, end: t1 }); continue; }
    out.push({ text: seg.segment, start: t0, end: Math.max(t0, t1), inChunk: !bounds.has(i) });
  }
  // เวลาจบของคำ: ใช้เวลาเริ่มของตัวถัดไปถ้าอยู่ติดกัน (ชิ้นสุดท้ายของแต่ละช่วงพูดใช้ end ของชิ้นนั้น)
  return out;
}

const isBreakChar = (s) => /[.!?…。]$/.test(s);

/*
 * จัดโทเคนเป็นบรรทัดซับ
 *   - ตัดเมื่อเงียบเกิน gap วินาที, ยาวเกิน maxChars, นานเกิน maxDur
 *   - ถ้าบรรทัดยาวเกินครึ่งแล้วเจอช่องว่าง/จบประโยค ตัดตรงนั้น (อ่านง่ายกว่าตัดกลางวลี)
 */
function buildCues(words, { maxChars = 18, maxDur = 4.2, gap = 0.6, duration = Infinity } = {}) {
  const toks = tokensFromWords(words);
  const cues = [];
  const lenOf = (list) => list.reduce((a, t) => a + (t.sp ? 1 : 0) + glen(t.text), 0);
  const push = (list) => { if (list.length) cues.push({ toks: list, start: list[0].start, end: list[list.length - 1].end }); };
  // บรรทัดยาวเกิน: หาจุดตัดที่ดีที่สุด (ช่องว่าง > ช่วงหยุดหายใจ > ตัดให้บรรทัดแรกยาวที่สุด) ไม่ตัดหน้า/หลังชิ้นตัวเดียว (มักเป็นคำที่ตัดผิด)
  const bestSplit = (list) => {
    let best = list.length - 1, bestScore = -Infinity;
    for (let k = 1; k < list.length; k++) {
      const left = lenOf(list.slice(0, k));
      if (left > maxChars) break;
      const a = list[k - 1], b = list[k];
      let score = left / maxChars;
      if (b.sp) score += 3;
      if (isBreakChar(a.text)) score += 2;
      score += Math.min(1, Math.max(0, b.start - a.end)) * 4;
      if (glen(a.text) === 1 || glen(b.text) === 1 || b.inChunk) score -= 4;
      if (left < maxChars * 0.35) score -= 3;
      if (score > bestScore) { bestScore = score; best = k; }
    }
    return best;
  };
  let cur = [];
  let pendingSpace = false;
  for (const t of toks) {
    if (t.space) { pendingSpace = true; continue; }
    const tok = { ...t, sp: pendingSpace && cur.length > 0 };
    pendingSpace = false;
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const silent = t.start - prev.end > gap;
      const tooSlow = t.end - cur[0].start > maxDur;
      const niceBreak = (tok.sp || isBreakChar(prev.text)) && lenOf(cur) >= maxChars * 0.55;
      if (silent || tooSlow || niceBreak) { push(cur); cur = []; tok.sp = false; }
    }
    cur.push(tok);
    while (lenOf(cur) > maxChars && cur.length > 1) {
      const k = bestSplit(cur);
      push(cur.slice(0, k));
      cur = cur.slice(k);
      cur[0] = { ...cur[0], sp: false };
    }
  }
  push(cur);
  // เวลาเริ่ม/จบ: ค้างต่อหลังพูดจบนิดหน่อยให้อ่านทัน แต่ไม่ทับบรรทัดถัดไป
  return cues.map((c, i) => {
    const next = cues[i + 1];
    const limit = Math.min(next ? next.start : Infinity, duration);
    let end = Math.max(c.end + 0.25, c.start + 0.8);
    end = Math.min(end, limit);
    if (end - c.start < MIN_CUE) end = Math.min(c.start + MIN_CUE, duration);
    const start = round2(c.start);
    return {
      id: newId(),
      start,
      end: round2(Math.max(end, start + 0.1)),
      text: c.toks.map((t) => (t.sp ? ' ' : '') + t.text).join(''),
      w: c.toks.flatMap((t) => [...(t.sp ? [[' ', null]] : []), [t.text, round2(Math.max(0, t.start - c.start))]]),
    };
  });
}

// คำในบรรทัดเมื่อไม่รู้เวลาจริง (ลูกค้าพิมพ์ใหม่): แบ่งเวลาตามจำนวนตัวอักษร ให้คำสุดท้ายขึ้นก่อน 80% ของบรรทัด
function spreadWords(text, dur) {
  const parts = Array.from(segW().segment(text), (x) => x.segment);
  const total = parts.filter((p) => !/^\s+$/.test(p)).reduce((a, p) => a + glen(p), 0) || 1;
  const span = Math.max(0, dur * 0.8 - 0.2);
  let acc = 0;
  return parts.map((p) => {
    if (/^\s+$/.test(p)) return [' ', null];
    const at = round2((acc / total) * span);
    acc += glen(p);
    return [p, at];
  });
}

/*
 * ตรวจซับที่ลูกค้าส่งมา (JSON) → { cues } หรือ { error }
 *   prev: ซับเดิม (ใช้เวลาของคำจากการถอดเสียงต่อ ถ้าข้อความบรรทัดนั้นไม่ได้แก้)
 */
function validateCues(input, { duration, prev = [] }) {
  if (!Array.isArray(input)) return { error: 'ข้อมูลซับไม่ถูกต้อง' };
  if (input.length > MAX_CUES) return { error: `ซับมีได้ไม่เกิน ${MAX_CUES} บรรทัด` };
  const byId = new Map(prev.map((c) => [c.id, c]));
  const rows = [];
  for (let i = 0; i < input.length; i++) {
    const r = input[i] || {};
    const text = cleanText(r.text);
    if (!text) continue; // บรรทัดว่าง = ลบทิ้ง
    let start = Number(r.start), end = Number(r.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: `บรรทัดที่ ${i + 1}: เวลาไม่ถูกต้อง` };
    start = round2(Math.max(0, start));
    end = round2(Math.min(end, duration));
    if (glen(text) > MAX_CUE_GRAPHEMES) return { error: `บรรทัดที่ ${i + 1} ยาวเกิน ${MAX_CUE_GRAPHEMES} ตัวอักษร ลองแบ่งเป็น 2 บรรทัด` };
    if (!ALLOWED_RE.test(text)) return { error: `บรรทัดที่ ${i + 1}: ใช้ได้เฉพาะตัวอักษรไทย อังกฤษ ตัวเลข และเครื่องหมายทั่วไป (ไม่รองรับอีโมจิ)` };
    if (start >= duration) return { error: `บรรทัดที่ ${i + 1} เริ่มหลังคลิปจบแล้ว` };
    if (end - start < MIN_CUE - 0.001) return { error: `บรรทัดที่ ${i + 1} สั้นเกินไป (อย่างน้อย ${MIN_CUE} วินาที)` };
    const id = /^[a-f0-9]{10}$/.test(String(r.id || '')) ? String(r.id) : newId();
    rows.push({ id, start, end, text, n: i + 1 });
  }
  rows.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (a.end > b.start) {
      // ทับกันนิดหน่อย: ตัดท้ายบรรทัดก่อนให้จบตอนบรรทัดถัดไปเริ่ม
      if (b.start - a.start < MIN_CUE) return { error: `บรรทัด "${a.text.slice(0, 20)}" กับบรรทัดถัดไปเริ่มเวลาเดียวกัน ลองเลื่อนเวลาเริ่มหรือรวมเป็นบรรทัดเดียว` };
      a.end = b.start;
    }
  }
  const cues = rows.map(({ id, start, end, text }) => {
    const old = byId.get(id);
    let w;
    if (old && old.text === text && Array.isArray(old.w)) {
      // ข้อความเดิม: ใช้จังหวะคำเดิม เลื่อนตามเวลาเริ่มใหม่ และย่อ/ขยายตามความยาวใหม่
      const k = (end - start) / Math.max(0.01, old.end - old.start);
      w = old.w.map(([tx, at]) => [tx, at === null ? null : round2(Math.min(at * k, Math.max(0, end - start - 0.3)))]);
    } else {
      w = spreadWords(text, end - start);
    }
    return { id, start, end, text, w };
  });
  return { cues };
}

// เวลาแบบ SRT 00:00:01,234
function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  const p = (n, k = 2) => String(n).padStart(k, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\r\n${srtTime(c.start)} --> ${srtTime(c.end)}\r\n${c.text}\r\n`).join('\r\n');
}

module.exports = { buildCues, tokensFromWords, validateCues, spreadWords, toSrt, srtTime, maxCharsFor, cleanText, ALLOWED_RE, MAX_CUE_GRAPHEMES, MAX_CUES, graphemes };

'use strict';
/*
 * ซับอัตโนมัติ: แปลงผลถอดเสียง (คำ + เวลา) เป็นบรรทัดซับ, ตรวจซับที่ลูกค้าแก้, ทำไฟล์ .srt
 *
 * บรรทัดซับ (cue) = { id, start, end, text, w }
 *   w: คำในบรรทัด [[ข้อความ, วินาทีจากต้นบรรทัด | null(ช่องว่าง)], ...] ใช้ให้ท่า "คำเด้ง" เด้งตรงจังหวะพูด
 * ภาษาไทยไม่เว้นวรรคระหว่างคำ จึงตัดคำด้วย Intl.Segmenter('th') แล้วแบ่งบรรทัดที่ช่องว่าง/ช่วงเงียบก่อน
 */
const crypto = require('crypto');
const { cleanOriginal, isSfxOnly } = require('./subfix');

// อักษรไทย, ASCII ที่พิมพ์ได้ (ยกเว้น < > ` \), ช่องว่าง และเครื่องหมายที่ใช้บ่อย (ชุดเดียวกับหน้าปรับแต่ง)
const ALLOWED_RE = /^[ก-ฺ฿-๛ !"#$%&'()*+,\-./0-9:;=?@A-Z[\]^_a-z{|}~ ‘’“”…–—•·×÷°]*$/u;
const MAX_CUE_GRAPHEMES = 60;
const MAX_CUES = 600;
const MIN_CUE = 0.3; // บรรทัดสั้นสุด (วินาที)
const MAX_LOOKS = 8; // แบบ (แอนิเมชัน) ต่างกันได้สูงสุดกี่แบบในคลิปเดียว รวมแบบหลัก

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
 * คำเติมที่คนพูดแต่ไม่ควรขึ้นซับ: เอ่อ เอ๋อ เอ้อ อ่า อ้า อืม อึม เออ (รวมแบบลากเสียง เช่น เอ่ออออ อ่าาา)
 * ระวังคำจริงที่หน้าตาคล้ายกัน: อ่าน อ่าว อ่าง อ้าง อ้าว เออร์ → ดูตัวถัดไปก่อนตัด
 */
const FILLER_RE = /(?<![\u0E01-\u0E2E\u0E40-\u0E44])(?:เอ[่๋้]อ+(?!ล้น)|อ[่้]า+(?![\u0E31-\u0E3A\u0E47-\u0E4Eนวงยม])|อื+ม+(?![\u0E31-\u0E3A\u0E47-\u0E4E])|อึ+ม+(?![\u0E31-\u0E3A\u0E47-\u0E4E])|เออ+(?![ร\u0E31-\u0E3A\u0E47-\u0E4E]))(?:\s*ๆ)?|\b(?:u+h+|u+m+|e+r+m+|h+m+)\b[,.]?/giu;

function dropFillers(text, times, bounds, ends = [], src = null) {
  const kill = new Uint8Array(text.length);
  let any = false;
  for (const m of text.matchAll(FILLER_RE)) { any = true; for (let k = m.index; k < m.index + m[0].length; k++) kill[k] = 1; }
  if (!any) return { text, times, ends, src };
  let t = '';
  const tt = [], te = [], ts = src ? [] : null;
  const nb = new Set();
  for (let i = 0; i < text.length; i++) {
    if (bounds.has(i)) nb.add(t.length);
    if (kill[i]) continue;
    const ch = text[i];
    if (ch === ' ' && (!t || t.endsWith(' '))) continue; // ไม่ให้มีช่องว่างซ้อนตรงที่ตัดคำเติม
    t += ch; tt.push(times[i]); te.push(ends[i]); if (ts) ts.push(src[i]);
  }
  if (t.endsWith(' ')) { t = t.slice(0, -1); tt.pop(); te.pop(); if (ts) ts.pop(); }
  tt.lastEnd = times.lastEnd;
  bounds.clear(); nb.forEach((b) => bounds.add(b));
  return { text: t, times: tt, ends: te, src: ts };
}

/*
 * ผลถอดเสียง words: [{ text, start, end }] (ชิ้นคำจาก Whisper ภาษาไทยมักเป็นชิ้นย่อยไม่ตรงคำ)
 * → โทเคนคำไทยพร้อมเวลา: ให้เวลาทีละตัวอักษรแบบเฉลี่ยในชิ้น แล้วตัดคำใหม่ด้วย Intl.Segmenter
 */
function tokensFromWords(words) {
  let text = '';
  let times = []; // เวลาเริ่มของแต่ละ code unit
  let ends = []; // เวลาจบของแต่ละ code unit (ใช้หาเวลาจบของคำ ไม่ให้ช่วงเงียบหลังคำถูกนับเป็นเวลาพูด)
  let src = []; // ตำแหน่งในข้อความดิบก่อนแก้คำผิด (มาจาก subfix.fixWords · -1 = ไม่รู้)
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
    if (text && lead && !text.endsWith(' ')) { text += ' '; times.push(start); ends.push(start); src.push(-1); }
    bounds.add(text.length);
    const g = graphemes(s);
    const per = (end - start) / g.length;
    const ws = Array.isArray(w.src) && w.src.length === s.length ? w.src : null;
    let u = 0;
    g.forEach((ch, i) => { for (let k = 0; k < ch.length; k++) { times.push(start + per * i); ends.push(start + per * (i + 1)); src.push(ws ? ws[u] : -1); u++; } });
    text += s;
    prevEnd = end;
    times.lastEnd = end;
  }
  // ตัดคำเติม (เอ่อ อ่า อืม) ทิ้ง ทั้งตัวอักษรและเวลา ก่อนตัดคำ
  ({ text, times, ends, src } = dropFillers(text, times, bounds, ends, src));
  // ตัดคำ
  const out = [];
  for (const seg of segW().segment(text)) {
    const i = seg.index;
    const t0 = times[i];
    const t1 = ends[i + seg.segment.length - 1] ?? times.lastEnd ?? t0;
    if (/^\s+$/.test(seg.segment)) { out.push({ space: true, text: ' ', start: t0, end: t1 }); continue; }
    let lo = Infinity, hi = -1;
    for (let k = i; k < i + seg.segment.length; k++) { const v = src[k]; if (v >= 0) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    const tok = { text: seg.segment, start: t0, end: Math.max(t0, t1), inChunk: !bounds.has(i) };
    if (hi >= 0) { tok.lo = lo; tok.hi = hi; }
    out.push(tok);
  }
  // เวลาจบของคำ: ใช้เวลาเริ่มของตัวถัดไปถ้าอยู่ติดกัน (ชิ้นสุดท้ายของแต่ละช่วงพูดใช้ end ของชิ้นนั้น)
  return out;
}

/*
 * คำเติม/เสียงลังเล (เอ่อ อืม อ่า …) ไม่ต้องขึ้นซับ
 * ตัดเมื่อเป็นคำเดี่ยว: ทั้งสองข้างเป็นช่องว่าง เครื่องหมาย หรือต้น/ท้ายข้อความ
 * (คำจริงอย่าง "น้ำเอ่อล้น" ที่ติดกับคำอื่นทั้งสองข้างไม่โดนตัด)
 */
const FILLER_WORD_RE = /^(เอ่อ+|เอ๋อ+|เอ้อ+|เออะ|เอิ่ม+|เอิ้ม+|อ่า+|อ้า+|อืม+|อึม+|อื้ม+|อึ้ม+|ฮึ่ม+|ฮึม+|หืม+|uh+|um+|umm+|hmm+|erm+|ah+|eh+)$/iu;
const isFiller = (s) => FILLER_WORD_RE.test(String(s).replace(/[.,!?…~\-]+$/, ''));
const isPunct = (s) => /^[\s.,!?…~\-–—"“”'‘’()]+$/.test(s);
// รอบสอง (ระดับคำ): คำเติมที่หลุดรอบแรก เช่น เอิ่ม ฮึ่ม หืม
function dropFillerTokens(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.space && isFiller(t.text)) {
      const prev = toks[i - 1], next = toks[i + 1];
      const alone = (!prev || prev.space || isPunct(prev.text) || isFiller(prev.text)) && (!next || next.space || isPunct(next.text) || isFiller(next.text) || /^[าะ่้๊๋ม]+$/.test(next.text));
      if (alone) {
        // ลากเสียงต่อท้าย (อ่า|าา) และจุลภาคหลังคำเติมก็ตัดด้วย
        while (toks[i + 1] && !toks[i + 1].space && (/^[าะ่้๊๋ม]+$/.test(toks[i + 1].text) || /^[,.…~-]+$/.test(toks[i + 1].text))) i++;
        continue;
      }
    }
    out.push(t);
  }
  // ช่องว่างซ้อน/ช่องว่างหัวท้ายที่เหลือจากการตัด
  return out.filter((t, i) => !t.space || (i > 0 && i < out.length - 1 && !out[i - 1].space));
}

const SYSTEM_TEXT_RE = /^(?:error|undefined|null|nan|\[object|\{|groq\b|https?:|status\s*\d{3}|\d{3}\s*(?:error|too many)|too many requests|request failed|timeout|ถอดเสียงไม่สำเร็จ|ระบบถอดเสียง)/i;
const isSystemText = (s) => SYSTEM_TEXT_RE.test(String(s).replace(/\s+/g, ' ').trim());

const isBreakChar = (s) => /[.!?…。]$/.test(s);

/*
 * จัดโทเคนเป็นบรรทัดซับ
 *   - ตัดเมื่อเงียบเกิน gap วินาที, ยาวเกิน maxChars, นานเกิน maxDur
 *   - ถ้าบรรทัดยาวเกินครึ่งแล้วเจอช่องว่าง/จบประโยค ตัดตรงนั้น (อ่านง่ายกว่าตัดกลางวลี)
 */
function buildCues(words, { maxChars = 18, maxDur = 4.2, gap = 0.6, duration = Infinity, raw = '' } = {}) {
  const toks = dropFillerTokens(tokensFromWords(words));
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
  // บรรทัดที่มีแต่เสียงประกอบ (ปัง บึ้ม ฮ่าๆ) ไม่ต้องขึ้นซับ · บรรทัดที่มีคำพูดปนอยู่ด้วยเก็บไว้ทั้งบรรทัด
  for (let i = cues.length - 1; i >= 0; i--) if (isSfxOnly(cues[i].toks.map((t) => t.text).join(' '))) cues.splice(i, 1);
  // ข้อความระบบ/ข้อผิดพลาดที่อาจหลุดมากับผลถอดเสียง (Error, undefined, {"error"…) ต้องไม่ขึ้นเป็นซับ
  for (let i = cues.length - 1; i >= 0; i--) if (isSystemText(cues[i].toks.map((t, k) => (k && t.sp ? ' ' : '') + t.text).join(''))) cues.splice(i, 1);
  // บรรทัดจิ๋ว (1–3 ตัวอักษร เช่น "ครับ" "นะ" ที่หลุดมาเดี่ยวๆ) รวมเข้ากับบรรทัดข้างเคียงที่อยู่ใกล้กัน
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (lenOf(c.toks) > 3 || cues.length < 2) continue;
    const prev = cues[i - 1], next = cues[i + 1];
    const fit = (o) => o && lenOf(o.toks) + lenOf(c.toks) <= maxChars + 4;
    if (fit(prev) && c.start - prev.end < 0.8) {
      prev.toks = prev.toks.concat(c.toks); prev.end = c.end;
      cues.splice(i--, 1);
    } else if (fit(next) && next.start - c.end < 0.8) {
      next.toks = c.toks.concat(next.toks); next.start = c.start;
      cues.splice(i--, 1);
    }
  }
  // เวลาเริ่ม/จบ: ค้างต่อหลังพูดจบนิดหน่อยให้อ่านทัน แต่ไม่ทับบรรทัดถัดไป
  return cues.map((c, i) => {
    const next = cues[i + 1];
    const limit = Math.min(next ? next.start : Infinity, duration);
    let end = Math.max(c.end + 0.25, c.start + 0.8);
    end = Math.min(end, limit);
    if (end - c.start < MIN_CUE) end = Math.min(c.start + MIN_CUE, duration);
    const start = round2(c.start);
    const cue = {
      id: newId(),
      start,
      end: round2(Math.max(end, start + 0.1)),
      text: c.toks.map((t) => (t.sp ? ' ' : '') + t.text).join(''),
      w: c.toks.flatMap((t) => [...(t.sp ? [[' ', null]] : []), [t.text, round2(Math.max(0, t.start - c.start))]]),
    };
    // ข้อความเดิมก่อนแก้คำผิด (ให้กด ↺ ใช้คำเดิมได้) · เก็บเฉพาะบรรทัดที่ตัวอักษรเปลี่ยนจริง
    if (raw) {
      const lo = Math.min(...c.toks.map((t) => (t.hi >= 0 ? t.lo : Infinity)));
      let hi = Math.max(...c.toks.map((t) => (t.hi >= 0 ? t.hi : -1)));
      // ตัวอักษรดิบที่ถูกแก้หายไปท้ายบรรทัด (ติกตอ|ค → TikTok) นับเป็นของบรรทัดนี้ จนถึงช่องว่างหรือบรรทัดถัดไป
      const nextLo = next ? Math.min(...next.toks.map((t) => (t.hi >= 0 ? t.lo : Infinity))) : Infinity;
      while (hi >= lo && hi + 1 < raw.length && hi + 1 < nextLo && !/\s/.test(raw[hi + 1])) hi++;
      if (hi >= lo) {
        const o = cleanOriginal(raw.slice(lo, hi + 1), FILLER_RE);
        if (o && glen(o) <= MAX_CUE_GRAPHEMES && o.replace(/\s+/g, '') !== cue.text.replace(/\s+/g, '')) cue.o = o;
      }
    }
    return cue;
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
 *   styles: slug ของแบบที่ลูกค้ามีในคลัง (บรรทัดที่เลือกแบบเอง p = slug · ไม่มี p = ใช้แบบหลักของคลิป)
 *   main: slug ของแบบหลัก (นับรวมในจำนวนแบบสูงสุด)
 */
function validateCues(input, { duration, prev = [], styles = null, main = null }) {
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
    let p = r.p === undefined || r.p === null || r.p === '' ? null : String(r.p);
    if (p !== null && !(styles && styles.has(p))) return { error: `บรรทัดที่ ${i + 1}: แบบที่เลือกไม่มีในคลังของคุณ` };
    rows.push({ id, start, end, text, n: i + 1, p });
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
  const looks = new Set(rows.map((r) => r.p || main || '').filter(Boolean));
  if (looks.size > MAX_LOOKS) return { error: `ใช้แบบต่างกันได้ไม่เกิน ${MAX_LOOKS} แบบในคลิปเดียว` };
  const cues = rows.map(({ id, start, end, text, p }) => {
    const old = byId.get(id);
    let w;
    if (old && old.text === text && Array.isArray(old.w)) {
      // ข้อความเดิม: ใช้จังหวะคำเดิม เลื่อนตามเวลาเริ่มใหม่ และย่อ/ขยายตามความยาวใหม่
      const k = (end - start) / Math.max(0.01, old.end - old.start);
      w = old.w.map(([tx, at]) => [tx, at === null ? null : round2(Math.min(at * k, Math.max(0, end - start - 0.3)))]);
    } else {
      w = spreadWords(text, end - start);
    }
    const out = p ? { id, start, end, text, w, p } : { id, start, end, text, w };
    // ข้อความเดิมก่อนแก้คำผิด: เก็บต่อจากซับเดิม (ไม่เชื่อค่าจากเบราว์เซอร์) · ลูกค้าใช้คำเดิมแล้ว = ไม่ต้องเก็บ
    if (old && typeof old.o === 'string' && old.o && old.o !== text) out.o = old.o;
    return out;
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

module.exports = { isSystemText, MAX_LOOKS, dropFillers, dropFillerTokens, FILLER_RE, buildCues, tokensFromWords, validateCues, spreadWords, toSrt, srtTime, maxCharsFor, cleanText, ALLOWED_RE, MAX_CUE_GRAPHEMES, MAX_CUES, graphemes };

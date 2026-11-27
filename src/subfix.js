'use strict';
/*
 * แก้คำผิดในซับอัตโนมัติ (เหมือนแป้นพิมพ์มือถือแก้คำให้) โดยเวลาของคำไม่เพี้ยน
 *
 *   1) กฎในเครื่อง (ฟรี ทำทุกครั้ง): คำที่ถอดผิดบ่อย (config/subtitle-words.json), สระ/วรรณยุกต์ซ้ำ, ำ ที่แตกเป็น ํา,
 *      ตัวอักษรลากยาว (มากกกก), เว้นวรรคหลัง ๆ และระหว่างไทย–อังกฤษ, ตัดป้ายเสียงประกอบ [เสียงดนตรี] ♪ และเสียงหัวเราะ 555
 *   2) โมเดลภาษา (Groq แชต) เดาคำที่ฟังผิดจากบริบท · ถ้าช้า/ล้ม/ตอบแปลก → ใช้ผลจากข้อ 1 แทน (ซับไม่หาย)
 *      ทุกท่อนต้องผ่านด่าน: จำนวนท่อนเท่าเดิม แก้ได้ไม่เกิน ~40% ของตัวอักษร ห้ามลบทั้งท่อน ใช้ได้เฉพาะตัวอักษรที่ซับรองรับ
 *
 * เวลา: เทียบข้อความเดิมกับข้อความที่แก้ทีละตัวอักษร (edit distance) ตัวที่แก้/เพิ่มได้เวลาของคำเดิมตรงนั้น
 *   ผลเป็นรายการคำรูปแบบเดิม { text, start, end } + src (ตำแหน่งตัวอักษรในข้อความดิบ) ให้ subcues.buildCues
 *   ใช้เก็บ "ข้อความเดิม" (o) ของแต่ละบรรทัด ลูกค้ากด ↺ ใช้คำเดิมได้ในหน้าแก้ซับ
 */
const fs = require('fs');
const path = require('path');

const WORDS_FILE = path.join(__dirname, '..', 'config', 'subtitle-words.json');

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const segW = () => new Intl.Segmenter('th', { granularity: 'word' });

function loadWords(file = WORDS_FILE) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const fix = {};
    for (const [k, v] of Object.entries(j.fix || {})) {
      const a = String(k).normalize('NFC').trim(), b = String(v).normalize('NFC').trim();
      if (a && a !== b) fix[a] = b;
    }
    return { fix, names: (j.names || []).map(String).filter(Boolean) };
  } catch {
    return { fix: {}, names: [] };
  }
}

/*
 * ตัวแก้ตามพจนานุกรม
 *   คำผิดยาว ≥ 5 ตัว: แทนได้ทุกที่ (ไม่ชนคำอื่น) แต่ไม่แทนถ้าเป็นส่วนต้นของคำที่ถูกอยู่แล้ว (เปอร์เซ็น|ต์)
 *   คำผิดสั้น (คับ แอพ): แทนเฉพาะตอนเป็นคำเดี่ยวตามตัวตัดคำ ไม่ให้ "บังคับ" กลายเป็น "บังครับ"
 */
function dictFixer(fix) {
  const long = [], short = new Map();
  for (const [k, v] of Object.entries(fix)) {
    if ([...k].length >= 5 || /^[A-Za-z]/.test(v) && [...k].length >= 4) long.push([k, v]);
    else short.set(k, v);
  }
  long.sort((a, b) => b[0].length - a[0].length);
  const map = new Map(long);
  const re = long.length
    ? new RegExp(long.map(([k, v]) => escRe(k) + (v.startsWith(k) && v.length > k.length ? `(?!${escRe(v.slice(k.length))})` : '')).join('|'), 'gu')
    : null;
  // คำผิดสั้น: แทนได้เมื่อไม่ได้อยู่ "ข้างใน" คำจริงคำเดียว (ตัวตัดคำให้คำที่ยาวกว่าครอบคำผิดไว้ทั้งคำ = เป็นคำอื่น เช่น บังคับ คับแคบ ซัพพอร์ต)
  const shortRe = short.size ? new RegExp([...short.keys()].sort((a, b) => b.length - a.length).map(escRe).join('|'), 'gu') : null;
  return (text) => {
    let t = re ? text.replace(re, (m) => map.get(m) ?? m) : text;
    if (!shortRe) return t;
    const hits = [...t.matchAll(shortRe)];
    if (!hits.length) return t;
    const segs = Array.from(segW().segment(t), (x) => [x.index, x.index + x.segment.length]);
    for (let h = hits.length - 1; h >= 0; h--) {
      const a = hits[h].index, b = a + hits[h][0].length;
      const inside = segs.some(([s0, s1]) => s0 <= a && s1 >= b && s1 - s0 > b - a);
      if (!inside) t = t.slice(0, a) + short.get(hits[h][0]) + t.slice(b);
    }
    return t;
  };
}

// ---------- กฎตัวอักษร ----------
const TH = 'ก-๛';
// ป้ายเสียงประกอบที่ Whisper ใส่วงเล็บมา: [เสียงดนตรี] (หัวเราะ) *เสียงปืน* ♪ ... ♪
const TAG_RE = /[[(（【{<＜][^[\]()（）【】{}<>＜＞]{0,40}[\])）】}>＞]|\*[^*\n]{1,30}\*|♪[^♪]{0,60}♪|[♪♫♬🎵🎶]+/gu;
// เสียงหัวเราะ: 555+ (ไม่ใช่ตัวเลขจำนวน เช่น 555 บาท), ฮ่าฮ่า, ฮ่าๆ, หึหึ, คิกคิก
const LAUGH_RE = new RegExp(`(?<![0-9])5{3,}\\+*(?![0-9])(?!\\s*(?:บาท|คน|ปี|วัน|ล้าน|พัน|ร้อย|เมตร|กิโล|ครั้ง|ตัว|ชิ้น|รอบ))|(?:ฮ่า|ฮา่|ฮ้า|ฮะ){2,}(?:\\s*ๆ)*|ฮ่า+\\s*ๆ+|(?:หึ){2,}|(?:คิก){2,}`, 'gu');

function charRules(text) {
  let t = String(text || '').normalize('NFC');
  t = t.replace(TAG_RE, ' ').replace(LAUGH_RE, ' ');
  t = t
    .replace(/ํ([่-๋]?)า/g, '$1ำ') // ํ + า = ำ
    .replace(/เเ/g, 'แ')
    .replace(/([ัิ-ฺ็-๎])\1+/g, '$1') // สระบน/ล่าง วรรณยุกต์ ซ้ำ
    .replace(/([ะาำเแโใไ])\1+/g, '$1') // สระลากยาว อาาาา
    .replace(/ร{3,}/g, 'รร')
    .replace(/([ก-ฮ])\1{2,}/g, '$1') // ตัวอักษรลากยาว มากกกก
    .replace(/ๆ(?:\s*ๆ)+/g, 'ๆ')
    .replace(/\s+ๆ/g, 'ๆ')
    .replace(new RegExp(`ๆ(?=[${TH}A-Za-z0-9])`, 'gu'), 'ๆ ')
    .replace(new RegExp(`([${TH}])(?=[A-Za-z])`, 'gu'), '$1 ')
    .replace(new RegExp(`([A-Za-z])(?=[ก-ฮเ-ไ])`, 'gu'), '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

function createRules(words = loadWords()) {
  const dict = dictFixer(words.fix);
  return (text) => charRules(dict(charRules(text)));
}

// ---------- เทียบข้อความ: ระยะแก้ไข + เส้นทาง ----------
// คืน map: ตัวอักษรที่ j ของ b มาจากตัวอักษรที่เท่าไรของ a (-1 = เพิ่มใหม่) และระยะแก้ไข
function align(a, b) {
  const n = a.length, m = b.length;
  const W = m + 1;
  const d = new Uint32Array((n + 1) * W);
  for (let j = 0; j <= m; j++) d[j] = j;
  for (let i = 1; i <= n; i++) {
    d[i * W] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const sub = d[(i - 1) * W + j - 1] + (ai === b.charCodeAt(j - 1) ? 0 : 1);
      const del = d[(i - 1) * W + j] + 1, ins = d[i * W + j - 1] + 1;
      d[i * W + j] = sub < del ? (sub < ins ? sub : ins) : (del < ins ? del : ins);
    }
  }
  const from = new Int32Array(m).fill(-1);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const cur = d[i * W + j];
    if (cur === d[(i - 1) * W + j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1)) { from[j - 1] = i - 1; i--; j--; }
    else if (cur === d[(i - 1) * W + j] + 1) i--;
    else j--;
  }
  return { from, dist: d[n * W + m] };
}

const squash = (t) => String(t || '').replace(/\s+/g, '');
const ALLOWED_CH = /^[ก-ฺ฿-๛ !"#$%&'()*+,\-./0-9:;=?@A-Z[\]^_a-z{|}~ ‘’“”…–—•·×÷°]*$/u;

// ผลจากโมเดลใช้ได้ไหม (เทียบกับข้อความก่อนส่ง)
function acceptable(before, after) {
  if (typeof after !== 'string') return false;
  const a = squash(before), b = squash(after.normalize('NFC'));
  if (!b) return !a; // ห้ามลบทั้งท่อน
  if (!ALLOWED_CH.test(after)) return false;
  if (b.length > a.length * 1.5 + 6) return false; // ห้ามแต่งเพิ่ม
  const { dist } = align(a, b);
  return dist <= Math.max(3, Math.ceil(a.length * 0.4));
}

// ---------- โมเดลภาษา (Groq แชต) ----------
const SYSTEM_PROMPT = (names) => `You correct Thai speech-to-text subtitles, like a phone keyboard's autocorrect.
Input JSON: {"lines": [...]}. Each line is raw speech-recognition output of continuous speech.
Return JSON {"lines": [...]} with EXACTLY the same number of lines, in the same order.
For each line:
- Fix words the recognizer misheard or misspelled to the most likely intended word from context.
- Use correct Thai spelling (Royal Institute), correct tone marks, and correct particles (ครับ; ค่ะ in statements, คะ in questions, นะคะ).
- Write brand, app and game names the usual way in English letters: ${names.join(', ')}.
- Put a space between phrases or sentences where a Thai writer would, and between Thai and English words.
- Remove sound-effect descriptions such as [เสียงดนตรี] or (หัวเราะ).
Never paraphrase, translate, summarize, reorder, add new words, or remove spoken words. Keep slang, casual speech and the speaker's own word choice. Only change what is clearly wrong; if unsure, keep it. Never merge or split lines.
Example input: {"lines":["ผมเล่นเกมส์ฟีฟายมาสามปีแล้วคับ","เดียวเราไปดูกันเลยว่ามันจะออกมาเป็นยังงัย"]}
Example output: {"lines":["ผมเล่นเกม Free Fire มาสามปีแล้วครับ","เดี๋ยวเราไปดูกันเลย ว่ามันจะออกมาเป็นยังไง"]}`;

async function llmLines(cfg, lines, { fetchImpl = globalThis.fetch, timeoutMs = 20000, names = [] } = {}) {
  const F = cfg.subtitleFix || {};
  const G = cfg.groq || {};
  const body = {
    model: F.model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT(names) },
      { role: 'user', content: JSON.stringify({ lines }) },
    ],
  };
  if (/gpt-oss/i.test(F.model)) body.reasoning_effort = 'low';
  const r = await fetchImpl(`${G.apiBase}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${G.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`แก้คำผิด: Groq ${r.status}`);
  const j = await r.json();
  const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  const out = JSON.parse(String(content || '').replace(/^```(?:json)?\s*|\s*```$/g, ''));
  if (!out || !Array.isArray(out.lines) || out.lines.length !== lines.length) throw new Error('แก้คำผิด: จำนวนท่อนไม่ตรง');
  return out.lines;
}

/*
 * ตัวแก้คำผิด → { fixLines(lines) → lines, mode }
 *   mode: 'llm' (กฎ + โมเดล) | 'rules' (กฎอย่างเดียว) | 'off'
 */
function createFixer(cfg, { fetchImpl, log = () => {}, words } = {}) {
  const F = cfg.subtitleFix || { mode: 'rules' };
  const w = words || loadWords();
  const rules = createRules(w);
  const mode = F.mode === 'llm' && !(cfg.groq && cfg.groq.apiKey) ? 'rules' : F.mode || 'rules';
  async function fixLines(lines) {
    if (mode === 'off') return lines.slice();
    const base = lines.map((t) => rules(t));
    if (mode !== 'llm') return base;
    // แบ่งส่งก้อนละไม่เกิน ~2,500 ตัวอักษร ส่งพร้อมกันสูงสุด 3 ก้อน ก้อนไหนล้ม ใช้ผลจากกฎ
    const batches = [];
    let cur = [], size = 0;
    base.forEach((t, i) => {
      if (cur.length && size + t.length > 2500) { batches.push(cur); cur = []; size = 0; }
      cur.push(i); size += t.length;
    });
    if (cur.length) batches.push(cur);
    const out = base.slice();
    let next = 0, fixed = 0, kept = 0, failed = 0;
    const worker = async () => {
      while (next < batches.length) {
        const idx = batches[next++];
        const send = idx.map((i) => base[i]).filter((t) => t);
        const at = idx.filter((i) => base[i]);
        if (!send.length) continue;
        let got;
        try { got = await llmLines(cfg, send, { fetchImpl, timeoutMs: F.timeoutMs || 20000, names: w.names }); } catch (e) { failed++; log(`[subtitles] ${String(e.message).split('\n')[0]} (ใช้คำเดิม)`); continue; }
        got.forEach((t, k) => {
          const i = at[k];
          const s = typeof t === 'string' ? rules(t) : null;
          if (s !== null && acceptable(base[i], s)) { if (s !== base[i]) fixed++; out[i] = s; } else kept++;
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker));
    if (fixed || kept || failed) log(`[subtitles] แก้คำผิด: แก้ ${fixed} ท่อน · ไม่ใช้ผลโมเดล ${kept} ท่อน · ส่งไม่สำเร็จ ${failed} ก้อน`);
    return out;
  }
  return { fixLines, mode, rules };
}

/*
 * คำจาก Whisper → แก้คำผิดเป็นท่อน (ท่อน = ช่วงพูดต่อเนื่อง ตัดที่เงียบ > 1.2 วินาที หรือยาวเกิน ~300 ตัวอักษร)
 *   → คำใหม่พร้อมเวลา + src ตำแหน่งในข้อความดิบ (raw)
 * ล้มเหลวทุกกรณี → คืนคำเดิม (ซับไม่หาย)
 */
async function fixWords(words, fixer, { gap = 1.2, maxBlock = 300 } = {}) {
  const ws = [];
  for (const w of words || []) {
    const raw = String(w.text ?? w.word ?? '');
    const t = raw.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
    const start = Number(w.start), end = Number(w.end);
    if (!t || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    ws.push({ t, lead: /^\s/.test(raw), start, end: Math.max(start, end) });
  }
  if (!ws.length || !fixer || fixer.mode === 'off') return { words: words || [], raw: '' };
  // ท่อน
  const blocks = [];
  let cur = null;
  ws.forEach((w, i) => {
    if (!cur || w.start - ws[i - 1].end > gap || (cur.text.length > maxBlock && w.lead)) {
      cur = { text: '', owner: [], first: i };
      blocks.push(cur);
    } else if (w.lead) { cur.text += ' '; cur.owner.push(i); }
    for (let k = 0; k < w.t.length; k++) cur.owner.push(i);
    cur.text += w.t;
  });
  let rawAll = '';
  for (const b of blocks) { if (rawAll) rawAll += ' '; b.off = rawAll.length; rawAll += b.text; }
  let fixedTexts;
  try {
    fixedTexts = await fixer.fixLines(blocks.map((b) => b.text));
    if (!Array.isArray(fixedTexts) || fixedTexts.length !== blocks.length) throw new Error('bad');
  } catch {
    return { words, raw: '' };
  }
  const out = [];
  blocks.forEach((b, bi) => {
    const fixed = String(fixedTexts[bi] ?? b.text).normalize('NFC');
    const { from } = align(b.text, fixed);
    // แต่ละตัวอักษรใหม่เป็นของคำเดิมคำไหน (ตัวที่เพิ่มใหม่ = คำก่อนหน้า, ต้นท่อน = คำถัดไป)
    const owner = new Array(fixed.length), src = new Array(fixed.length);
    let lastO = -1, lastS = -1;
    for (let j = 0; j < fixed.length; j++) {
      if (from[j] >= 0) { lastO = b.owner[from[j]]; lastS = from[j]; }
      owner[j] = lastO; src[j] = lastS;
    }
    const firstO = owner.find((o) => o >= 0) ?? b.first;
    const firstS = src.find((s) => s >= 0) ?? 0;
    for (let j = 0; j < fixed.length && owner[j] < 0; j++) { owner[j] = firstO; src[j] = firstS; }
    // ชิ้นใหม่: ตัดที่ช่องว่าง และที่เปลี่ยนเจ้าของคำ
    const pieces = [];
    let p = null, lead = false;
    for (let j = 0; j < fixed.length; j++) {
      const ch = fixed[j];
      if (/\s/.test(ch)) { lead = true; p = null; continue; }
      if (!p || p.owner !== owner[j]) {
        p = { owner: owner[j], text: '', src: [], lead: lead || (pieces.length === 0 && ws[owner[j]].lead) };
        pieces.push(p); lead = false;
      }
      p.text += ch; p.src.push(b.off + src[j]);
    }
    // เวลา: ชิ้นของคำเดียวกันแบ่งเวลาของคำนั้นตามความยาว
    const byOwner = new Map();
    for (const x of pieces) { if (!byOwner.has(x.owner)) byOwner.set(x.owner, []); byOwner.get(x.owner).push(x); }
    for (const [o, list] of byOwner) {
      const w = ws[o];
      const total = list.reduce((a, x) => a + [...x.text].length, 0) || 1;
      let acc = 0;
      for (const x of list) {
        const len = [...x.text].length;
        x.start = w.start + ((w.end - w.start) * acc) / total;
        acc += len;
        x.end = w.start + ((w.end - w.start) * acc) / total;
      }
    }
    for (const x of pieces) out.push({ text: (x.lead ? ' ' : '') + x.text, start: x.start, end: x.end, src: x.src });
  });
  return { words: out, raw: rawAll };
}

// ข้อความเดิมของบรรทัด (ไว้ให้ลูกค้ากดใช้คำเดิม) · ตัดป้ายเสียง/คำเติม/ตัวอักษรที่ซับไม่รองรับออก
function cleanOriginal(s, fillerRe) {
  let t = String(s || '').normalize('NFC').replace(TAG_RE, ' ');
  if (fillerRe) t = t.replace(fillerRe, ' ');
  t = Array.from(t).filter((ch) => ALLOWED_CH.test(ch)).join('');
  return t.replace(/[<>`\\]/g, '').replace(/\s+/g, ' ').trim();
}

// ---------- เสียงประกอบ: บรรทัดที่มีแต่เสียงเอฟเฟกต์ (ปัง บึ้ม ฮ่าๆ) ไม่ต้องขึ้นซับ ----------
const SFX_WORD_RE = /^(?:ปัง|ปั้ง|บึ้ม|บึ้ม|บูม|ตูม|ตู้ม|เปรี้ยง|ฟิ้ว|วิ้ว|วื้ด|วืด|วู้ม|ตึง|ตึ้ง|ตุ้บ|ตุบ|โครม|แชะ|ปิ๊ง|ติ๊ง|ติ๊ด|ปี๊บ|ฟุ่บ|ปึ้ง|ปึง|แปะ|ฉึก|เคร้ง|แกร๊ก|กริ๊ง|บรื้น|บรึ้น|แว้น|ซู่|ซ่า|ฮ่า|ฮา|ฮะ|หึ|คิก|แฮ่|อ๊าก|อ๊ากก|โอ๊ย|ว้าก|กรี๊ด|ปุ้ง|ปุ๊|ตั้ม|ดึ๋ง|ตึ๋ง|เพล้ง|ฟึ่บ|ซวบ|ฉับ|ตั๊ก)+(?:ๆ)*$/u;
function isSfxOnly(text) {
  const parts = String(text || '').split(/[\s.,!?…~\-–—"“”'‘’()]+/).filter(Boolean);
  return parts.length > 0 && parts.every((p) => SFX_WORD_RE.test(p));
}

module.exports = { createFixer, createRules, charRules, dictFixer, loadWords, fixWords, align, acceptable, cleanOriginal, isSfxOnly, llmLines, TAG_RE, LAUGH_RE, SYSTEM_PROMPT };

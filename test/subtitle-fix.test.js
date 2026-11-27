'use strict';
// แก้คำผิดในซับอัตโนมัติ + ไม่ใส่ซับให้เสียงประกอบ · เวลาของคำต้องไม่เพี้ยน และล้มเมื่อไรใช้คำเดิม
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCues, validateCues } = require('../src/subcues');
const { createFixer, createRules, fixWords, acceptable, isSfxOnly } = require('../src/subfix');

const rules = createRules();
const rulesFixer = createFixer({ subtitleFix: { mode: 'rules' } });
const words = (arr, step = 0.32, t0 = 0) => { let t = t0; return arr.map((x) => { const w = { text: x, start: t, end: t + 0.3 }; t += step; return w; }); };

test('กฎตัวอักษร: ำ แตก, เเ, วรรณยุกต์ซ้ำ, ลากเสียง, ๆ, ไทย–อังกฤษ', () => {
  assert.equal(rules('น้ํา'), 'น้ำ');
  assert.equal(rules('ทํางาน'), 'ทำงาน');
  assert.equal(rules('เเมว'), 'แมว');
  assert.equal(rules('ไม่่่'), 'ไม่');
  assert.equal(rules('มากกกกก'), 'มาก');
  assert.equal(rules('กรรรรม'), 'กรรม');
  assert.equal(rules('อร่อยยยย'), 'อร่อย');
  assert.equal(rules('สวยๆไปลง'), 'สวยๆ ไปลง');
  assert.equal(rules('ดีๆๆๆ'), 'ดีๆ');
  assert.equal(rules('เปิดiPhoneแล้ว'), 'เปิด iPhone แล้ว');
  // คำที่ถูกอยู่แล้วไม่เปลี่ยน
  for (const ok of ['กรรม', 'บังคับ', 'เปอร์เซ็นต์', 'คอมเมนต์', 'ภาษาไทย', 'อัปโหลด', 'คนนั้น', 'ครับ', 'อันเดียวก่อน']) assert.equal(rules(ok), ok);
});

test('พจนานุกรมคำถอดผิดบ่อย: แก้คำเดี่ยว ไม่แก้กลางคำอื่น', () => {
  assert.equal(rules('ซับไตเติ้ลพาศาทายแบบอัตโนมัติแค่อับปะหลดคลิป'), 'ซับไตเติ้ลภาษาไทยแบบอัตโนมัติแค่อัปโหลดคลิป');
  assert.equal(rules('สวยๆไปลงติกตอคได้เลย'), 'สวยๆ ไปลง TikTok ได้เลย');
  assert.equal(rules('แค่อัปโหลดกลิปนี้'), 'แค่อัปโหลดคลิปนี้');
  assert.equal(rules('ลองทำซัพไตเติ้ล'), 'ลองทำซับไตเติ้ล');
  // คำสั้นที่อยู่ข้างในคำจริง ไม่แก้
  for (const ok of ['บังคับ', 'คับแคบ', 'ซัพพอร์ต', 'อึดอัดคับข้องใจ']) assert.equal(rules(ok), ok);
  assert.equal(rules('ดีไหมค่ะ'), 'ดีไหมคะ');
  assert.equal(rules('ไปนะค่ะ'), 'ไปนะคะ');
  assert.equal(rules('เล่นเกมส์กัน'), 'เล่นเกมกัน');
  assert.equal(rules('100 เปอร์เซ็น'), '100 เปอร์เซ็นต์');
});

test('เสียงประกอบ: ป้าย [เสียงดนตรี] ♪ และเสียงหัวเราะไม่ขึ้นซับ แต่คำพูดรอบๆ อยู่ครบ', () => {
  assert.equal(rules('[เสียงดนตรี]'), '');
  assert.equal(rules('(หัวเราะ) ตลกมาก'), 'ตลกมาก');
  assert.equal(rules('♪ ลาลา ♪'), '');
  assert.equal(rules('ตลกมาก555555'), 'ตลกมาก');
  assert.equal(rules('ฮ่าฮ่าฮ่า โอเค'), 'โอเค');
  assert.equal(rules('ราคา 555 บาท'), 'ราคา 555 บาท');
  assert.ok(isSfxOnly('ปังปังปัง'));
  assert.ok(isSfxOnly('บึ้ม! ตูม'));
  assert.ok(!isSfxOnly('ยิงเลย ปัง'));
  assert.ok(!isSfxOnly('ปังมากเลย'));
});

test('บรรทัดที่มีแต่เสียงเอฟเฟกต์ถูกตัด บรรทัดที่มีคนพูดปนอยู่เก็บไว้', async () => {
  const ws = [
    ...words([' ยิง', 'เลย', 'เพื่อน']),
    ...words([' ปัง', 'ปัง', 'ปัง'], 0.32, 3),
    ...words([' [เสียงปืน]'], 0.32, 6),
    ...words([' ชนะ', 'แล้ว', ' ปัง'], 0.32, 9),
  ];
  const f = await fixWords(ws, rulesFixer);
  const cues = buildCues(f.words, { raw: f.raw });
  assert.deepEqual(cues.map((c) => c.text), ['ยิงเลยเพื่อน', 'ชนะแล้ว ปัง']);
});

test('แก้คำแล้วเวลาไม่เพี้ยน: เวลาเรียงกัน อยู่ในช่วงเดิม และเก็บข้อความเดิมไว้กดใช้คืน', async () => {
  const ws = [
    { text: ' วันนี้', start: 2.0, end: 2.4 }, { text: 'เรา', start: 2.4, end: 2.6 }, { text: 'จะ', start: 2.6, end: 2.7 }, { text: 'มา', start: 2.7, end: 2.9 },
    { text: 'ลอง', start: 2.9, end: 3.2 }, { text: 'ทำ', start: 3.2, end: 3.4 }, { text: 'ซับ', start: 3.4, end: 3.7 }, { text: 'ไต', start: 3.7, end: 3.9 },
    { text: 'เติ้ล', start: 3.9, end: 4.2 }, { text: 'พา', start: 4.2, end: 4.4 }, { text: 'ศา', start: 4.4, end: 4.6 }, { text: 'ทาย', start: 4.6, end: 4.9 },
    { text: 'แบบ', start: 4.9, end: 5.3 }, { text: 'อัต', start: 5.3, end: 5.6 }, { text: 'โน', start: 5.6, end: 5.8 }, { text: 'มัติ', start: 5.8, end: 6.1 },
    { text: ' สวย', start: 13.98, end: 14.3 }, { text: 'ๆ', start: 14.3, end: 14.5 }, { text: 'ไป', start: 14.5, end: 14.7 }, { text: 'ลง', start: 14.7, end: 14.9 },
    { text: 'ติก', start: 14.9, end: 15.2 }, { text: 'ตอค', start: 15.2, end: 15.5 }, { text: 'ได้', start: 15.5, end: 15.8 }, { text: 'เลย', start: 15.8, end: 16.1 },
  ];
  const before = buildCues(ws, { maxChars: 24 });
  const f = await fixWords(ws, rulesFixer);
  for (let i = 1; i < f.words.length; i++) assert.ok(f.words[i].start >= f.words[i - 1].start - 1e-9, 'เวลาเรียงกัน');
  for (const w of f.words) assert.ok(w.start >= 2 && w.end <= 16.1 + 1e-9 && w.end >= w.start);
  const cues = buildCues(f.words, { maxChars: 24, raw: f.raw });
  const text = cues.map((c) => c.text).join(' | ');
  assert.match(text, /ภาษาไทย/);
  assert.match(text, /TikTok/);
  assert.doesNotMatch(text, /พาศาทาย|ติกตอค/);
  // จำนวนบรรทัดและเวลาใกล้เคียงของเดิม (ไม่มีบรรทัดหาย/ย้ายไปไกล)
  assert.equal(cues[0].start, before[0].start);
  assert.ok(Math.abs(cues.at(-1).end - before.at(-1).end) < 0.5);
  assert.ok(Math.abs(cues.length - before.length) <= 1, `${before.length} → ${cues.length}`);
  const withO = cues.filter((c) => c.o);
  assert.ok(withO.some((c) => /พาศาทาย/.test(c.o)), JSON.stringify(cues));
  assert.ok(withO.some((c) => /ติกตอค/.test(c.o)), JSON.stringify(cues));
  // ตัดบรรทัดตรงคำที่ถูกแล้ว (เดิม "…ซับไตเติ้ลพา | ศาทาย…" ตัดกลางคำ)
  assert.equal(cues[0].text, 'วันนี้เราจะมาลองทำซับไตเติ้ล');
  assert.equal(cues[0].o, undefined);
  assert.equal(cues[1].text, 'ภาษาไทยแบบอัตโนมัติ');
  assert.equal(cues[1].o, 'พาศาทายแบบอัตโนมัติ');
});

test('ไม่มีอะไรให้แก้ = ผลเหมือนไม่ผ่านตัวแก้คำทุกประการ', async () => {
  const ws = words([' สวัสดี', 'ครับ', ' วันนี้', 'อากาศ', 'ดี', 'มาก']);
  const f = await fixWords(ws, rulesFixer);
  const a = buildCues(ws).map(({ id, ...x }) => x);
  const b = buildCues(f.words, { raw: f.raw }).map(({ id, ...x }) => x);
  assert.deepEqual(b, a);
});

// ---------- โมเดลภาษา ----------
const cfgLlm = { subtitleFix: { mode: 'llm', model: 'openai/gpt-oss-120b', timeoutMs: 500 }, groq: { apiKey: 'gsk_x', apiBase: 'http://groq.test/openai/v1' } };
const reply = (fn) => async (url, opts) => {
  const body = JSON.parse(opts.body);
  const lines = JSON.parse(body.messages[1].content).lines;
  const out = fn(lines, body);
  if (out instanceof Response) return out;
  return new Response(JSON.stringify({ choices: [{ message: { content: typeof out === 'string' ? out : JSON.stringify({ lines: out }) } }] }), { status: 200 });
};

test('โมเดลภาษาแก้คำที่ฟังผิดจากบริบท และส่งคำสั่งแบบไม่ให้แต่งเพิ่ม', async () => {
  let sent = null;
  const fx = createFixer(cfgLlm, { fetchImpl: reply((lines, body) => { sent = body; return lines.map((t) => t.replace('ร้อมซับ', 'พร้อมซับ')); }) });
  const out = await fx.fixLines(['ไม่กี่นาทีก็ได้คลิปร้อมซับ', 'อับปะหลดคลิป']);
  assert.deepEqual(out, ['ไม่กี่นาทีก็ได้คลิปพร้อมซับ', 'อัปโหลดคลิป']);
  assert.equal(sent.model, 'openai/gpt-oss-120b');
  assert.equal(sent.temperature, 0);
  assert.equal(sent.reasoning_effort, 'low');
  assert.match(sent.messages[0].content, /Never paraphrase/);
  // กฎในเครื่องทำก่อนส่ง (โมเดลเห็น "อัปโหลด" แล้ว)
  assert.match(sent.messages[1].content, /อัปโหลด/);
});

test('โมเดลตอบแปลก/ล้ม/ช้า → ใช้ผลจากกฎในเครื่อง ซับไม่หาย', async () => {
  const input = ['สวยๆไปลงติกตอคได้เลย', 'วันนี้อากาศดีมาก'];
  const expect = ['สวยๆ ไปลง TikTok ได้เลย', 'วันนี้อากาศดีมาก'];
  // จำนวนท่อนไม่ตรง
  assert.deepEqual(await createFixer(cfgLlm, { fetchImpl: reply((l) => l.slice(0, 1)) }).fixLines(input), expect);
  // ไม่ใช่ JSON
  assert.deepEqual(await createFixer(cfgLlm, { fetchImpl: reply(() => 'ขอโทษครับ') }).fixLines(input), expect);
  // Groq ล่ม / โควตาเต็ม
  assert.deepEqual(await createFixer(cfgLlm, { fetchImpl: reply(() => new Response('busy', { status: 429 })) }).fixLines(input), expect);
  // เน็ตหลุด
  assert.deepEqual(await createFixer(cfgLlm, { fetchImpl: async () => { throw new Error('ECONNRESET'); } }).fixLines(input), expect);
  // ช้าเกินกำหนด (500 ms ในเทสต์)
  const slow = async (url, opts) => new Promise((ok, no) => { const t = setTimeout(() => ok(new Response('{}')), 5000); opts.signal.addEventListener('abort', () => { clearTimeout(t); no(new Error('timeout')); }); });
  const t0 = Date.now();
  assert.deepEqual(await createFixer(cfgLlm, { fetchImpl: slow }).fixLines(input), expect);
  assert.ok(Date.now() - t0 < 3000);
});

test('ด่านตรวจผลโมเดล: ห้ามแต่งใหม่ ห้ามลบทั้งท่อน ห้ามอีโมจิ แต่แก้คำได้', async () => {
  const fx = createFixer(cfgLlm, { fetchImpl: reply(() => ['วันนี้เราจะพาทุกคนไปเที่ยวทะเลที่สวยที่สุดในประเทศ', '', 'ดีมาก 😀', 'ไปลงTikTokได้เลยครับ']) });
  const out = await fx.fixLines(['วันนี้เราจะมาลองทำซับ', 'สวัสดีครับ', 'ดีมาก', 'ไปลงติกตอคได้เลยคับ']);
  assert.deepEqual(out, ['วันนี้เราจะมาลองทำซับ', 'สวัสดีครับ', 'ดีมาก', 'ไปลง TikTok ได้เลยครับ']);
  assert.equal(acceptable('อัตโนมัติแค่อับปะหลดคลิป', 'อัตโนมัติ แค่อัปโหลดคลิป'), true);
  assert.equal(acceptable('ไปเที่ยวกัน', 'เราไปกินข้าวที่ร้านอาหารญี่ปุ่นกันดีกว่า'), false);
});

test('แก้คำผิดผ่านโมเดลทั้งเส้นทาง: คำ → แก้ → บรรทัดซับ เวลาเท่าเดิม', async () => {
  const fx = createFixer(cfgLlm, { fetchImpl: reply((lines) => lines.map((t) => t.replace('คลิปร้อมซับ', 'คลิปพร้อมซับ'))) });
  const ws = [{ text: ' ไม่', start: 11.22, end: 11.5 }, { text: 'กี่', start: 11.5, end: 11.8 }, { text: 'นาที', start: 11.8, end: 12.2 },
    { text: 'ก็', start: 12.2, end: 12.4 }, { text: 'ได้', start: 12.4, end: 12.7 }, { text: 'คลิป', start: 12.7, end: 13.1 }, { text: 'ร้อม', start: 13.1, end: 13.5 }, { text: 'ซับ', start: 13.5, end: 13.98 }];
  const f = await fixWords(ws, fx);
  const cues = buildCues(f.words, { maxChars: 32, raw: f.raw });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'ไม่กี่นาทีก็ได้คลิปพร้อมซับ');
  assert.equal(cues[0].o, 'ไม่กี่นาทีก็ได้คลิปร้อมซับ');
  assert.equal(cues[0].start, 11.22);
  // fixLines พังกลางทาง → ใช้คำเดิมทั้งหมด
  const broken = { mode: 'llm', fixLines: async () => { throw new Error('x'); } };
  const g = await fixWords(ws, broken);
  assert.equal(g.words, ws);
  assert.equal(buildCues(g.words, { maxChars: 32 })[0].text, 'ไม่กี่นาทีก็ได้คลิปร้อมซับ');
});

test('หน้าแก้ซับ: ข้อความเดิม (o) เก็บต่อจากซับเดิมเท่านั้น และหายเมื่อลูกค้าใช้คำเดิมแล้ว', () => {
  const prev = [{ id: 'aaaaaaaaaa', start: 0, end: 2, text: 'ภาษาไทย', o: 'พาศาทาย', w: [['ภาษาไทย', 0]] }, { id: 'bbbbbbbbbb', start: 2, end: 4, text: 'ดีมาก', w: [['ดีมาก', 0]] }];
  const r = validateCues([{ id: 'aaaaaaaaaa', start: 0, end: 2, text: 'ภาษาไทยนะ' }, { id: 'bbbbbbbbbb', start: 2, end: 4, text: 'ดีมาก', o: 'แอบใส่เอง' }], { duration: 10, prev });
  assert.equal(r.cues[0].o, 'พาศาทาย');
  assert.equal(r.cues[1].o, undefined);
  const back = validateCues([{ id: 'aaaaaaaaaa', start: 0, end: 2, text: 'พาศาทาย' }], { duration: 10, prev });
  assert.equal(back.cues[0].o, undefined);
});

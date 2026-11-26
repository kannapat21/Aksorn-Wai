'use strict';
/*
 * ท่าเคลื่อนไหวชุดใหม่: ตรวจด้วย Chrome จริง (ข้ามถ้าเครื่องไม่มี Chrome/Chromium)
 *   - เฟรมสุดท้ายโปร่งใสสนิท
 *   - ภาพตอนจบท่าเข้า = ภาพท้ายรอบค้าง = ภาพเฟรมแรกของท่าออก (วนซ้ำและตัดเข้าท่าออกได้เนียนทุกความยาว)
 *   - โหมดซับ (ช่วงค้างสั้น ไม่มีลูกเล่นวน) ไม่พัง
 *   - วาดแบบเบราว์เซอร์ลูกค้า (SVG foreignObject) ได้ภาพเหมือนตัวเรนเดอร์ของร้าน
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
require('../public/motion.js');
const TT = globalThis.TTMotion;
const NEW = ['typewriter', 'rise', 'zoom', 'jump', 'highlight', 'glitch', 'gold', 'flip', 'karaoke', 'lower', 'impact', 'bubble'];
const products = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'products.json'), 'utf8'));

let browser = null;
let page = null;
before(async () => {
  try {
    browser = await require('../render/tools').launchBrowser();
  } catch { browser = null; }
  if (!browser) return;
  const font = fs.readFileSync(path.join(ROOT, 'fonts', 'Kanit-Bold.ttf')).toString('base64');
  const html = fs.readFileSync(path.join(ROOT, 'render', 'template.html'), 'utf8')
    .replace('__FONT_URL__', () => `data:font/ttf;base64,${font}`)
    .replace('__MOTION_JS__', () => fs.readFileSync(path.join(ROOT, 'public', 'motion.js'), 'utf8'));
  page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.setContent(html);
  await page.evaluate(async () => { await document.fonts.load('700 100px "RenderFont"', 'ทดสอบ'); await document.fonts.ready; });
});
after(async () => { if (browser) await browser.close(); });

const shot = async (motion, t, timing) => {
  await page.evaluate(([tt, tm, m]) => window.setTime(tt, tm, m), [t, timing, motion]);
  return page.screenshot({ omitBackground: true, type: 'png' });
};
// ความต่างของภาพเป็นสัดส่วนพิกเซลที่ต่างกันชัดเจน (กันความคลาดเคลื่อนเล็กๆ ของการลบรอยหยัก)
async function diff(a, b) {
  return page.evaluate(async ([x, y]) => {
    const load = async (b64) => { const i = new Image(); i.src = `data:image/png;base64,${b64}`; await i.decode(); return i; };
    const [ia, ib] = await Promise.all([load(x), load(y)]);
    const c = new OffscreenCanvas(ia.width, ia.height); const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data;
    g.clearRect(0, 0, c.width, c.height); g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
    let bad = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) + Math.abs(da[i + 3] - db[i + 3]) > 48) bad++;
    }
    return bad / (da.length / 4);
  }, [a.toString('base64'), b.toString('base64')]);
}
async function alphaSum(buf) {
  return page.evaluate(async (x) => {
    const i = new Image(); i.src = `data:image/png;base64,${x}`; await i.decode();
    const c = new OffscreenCanvas(i.width, i.height); const g = c.getContext('2d'); g.drawImage(i, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0;
    for (let k = 3; k < d.length; k += 4) s += d[k];
    return s;
  }, buf.toString('base64'));
}

test('ท่าใหม่: ข้อมูลท่า (เวลา/ฟรี-พรีเมียม) และสินค้าในร้านติดป้ายตรงกับท่า', () => {
  for (const name of NEW) {
    const m = TT.meta(name);
    assert.ok(TT.MOTIONS.includes(name), name);
    assert.ok(m.timed, `${name} ใช้เวลาตามท่า`);
    for (const sec of [3, 5, 30]) {
      const t = TT.timingFor(name, sec, 60);
      assert.ok(t.fadeStart - t.settle >= 0.9, `${name} ${sec}s ต้องมีช่วงค้าง`);
    }
    assert.ok(Math.abs(m.intro * 60 - Math.round(m.intro * 60)) < 1e-9, `${name} ช่วงเข้าต้องลงเฟรมพอดี`);
  }
  for (const p of products.filter((x) => NEW.includes(x.motion))) {
    const premium = p.tags.includes('พรีเมียม');
    assert.equal(premium, TT.meta(p.motion).premium, `${p.slug}: ป้ายพรีเมียมต้องตรงกับท่า`);
    assert.equal(p.price === 0, !premium, `${p.slug}: ของฟรีราคา 0`);
  }
  assert.equal(products.filter((x) => NEW.includes(x.motion)).length, NEW.length, 'ทุกท่าใหม่มีสินค้าในร้าน');
});

for (const motion of NEW) {
  test(`ท่า ${motion}: จบท่าเข้า = ท้ายรอบค้าง = เริ่มท่าออก · เฟรมสุดท้ายโปร่งใส`, async (t) => {
    if (!page) return t.skip('ไม่มี Chrome/Chromium');
    const p = products.find((x) => x.motion === motion);
    await page.evaluate((o) => window.setup(o), { text: 'ทดสอบ ข้อความ', fill: '#ffd400', stroke: '#111111', strokeRatio: 0.05, shadow: true, weight: 700, motion });
    const m = TT.meta(motion);
    for (const sec of [3, 10]) {
      const tm = TT.timingFor(motion, sec, 60);
      const settled = await shot(motion, tm.settle, tm);
      const outStart = await shot(motion, tm.fadeStart - 1 / 60, tm);
      assert.ok(await diff(settled, outStart) < 0.002, `${motion} ${sec}s: ภาพก่อนเข้าท่าออกต้องเหมือนตอนจบท่าเข้า`);
      if (m.loop && sec === 10) {
        const tail = await shot(motion, tm.settle + (tm.holdOff || 0) + m.loop - 1 / 60, tm);
        assert.ok(await diff(settled, tail) < 0.002, `${motion}: ท้ายรอบค้างต้องกลับมาเหมือนเดิม (วนเนียน)`);
      }
      assert.equal(await alphaSum(await shot(motion, tm.fadeEnd, tm)), 0, `${motion} ${sec}s: เฟรมสุดท้ายต้องโปร่งใสสนิท`);
      assert.ok(await alphaSum(settled) > 0, `${motion}: ต้องเห็นข้อความตอนค้าง`);
    }
    // โหมดซับ: บรรทัดสั้น 1.2 วิ ช่วงค้างนิ่ง
    const st = TT.subtitleTiming(motion, 1.2, 30);
    const a = await shot(motion, st.settle + 0.05, st);
    const b = await shot(motion, st.fadeStart - 0.02, st);
    assert.ok(await diff(a, b) < 0.002, `${motion}: โหมดซับช่วงค้างต้องนิ่ง`);
    assert.ok(p, `${motion} มีสินค้า`);
  });
}

test('ท่าใหม่วาดแบบเบราว์เซอร์ลูกค้า (SVG foreignObject) ได้ภาพเหมือนตัวเรนเดอร์ของร้าน', async (t) => {
  if (!page) return t.skip('ไม่มี Chrome/Chromium');
  for (const motion of NEW) {
    await page.evaluate((o) => window.setup(o), { text: 'ทดสอบ ข้อความ', fill: '#ffd400', stroke: '#111111', strokeRatio: 0.05, shadow: true, weight: 700, motion });
    const tm = TT.timingFor(motion, 5, 60);
    const at = tm.settle + 0.5;
    const direct = await shot(motion, at, tm);
    const viaSvg = await page.evaluate(async () => {
      const w = innerWidth, h = innerHeight;
      const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
      const ser = new XMLSerializer();
      const kids = [document.getElementById('filters'), document.getElementById('stage')].map((n) => ser.serializeToString(n)).join('');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${w}px;height:${h}px;margin:0;overflow:hidden"><style>${css}</style>${kids.replace(/ xmlns="http:\/\/www.w3.org\/1999\/xhtml"/g, '')}</div></foreignObject></svg>`;
      const img = new Image(); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await img.decode();
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    });
    const d = await diff(direct, Buffer.from(viaSvg, 'base64'));
    assert.ok(d < 0.01, `${motion}: ภาพจากเบราว์เซอร์ลูกค้าต่างจากของร้าน ${(d * 100).toFixed(2)}%`);
  }
});

// โหมด serverless: ปุ่มและแถบความคืบหน้าของงานที่เบราว์เซอร์ลูกค้าทำเอง (แอนิเมชันปรับแต่ง · ฟังเสียง · เบิร์นซับ)
import { renderAnimation, burnSubtitles, extractSpeech, probeClip, saveBlob, keepClip, loadClip, dropOldClips, supportInfo } from './render-engine.js';

const $ = (sel, el) => (el || document).querySelector(sel);
const csrfOf = (el) => el.getAttribute('data-csrf') || (document.querySelector('meta[name="csrf"]') || {}).content || '';
const fmtMB = (n) => `${(n / 1048576).toFixed(n > 104857600 ? 0 : 1)} MB`;

async function postJson(url, csrf, body) {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body || {}) });
  let j = {};
  try { j = await r.json(); } catch (e) { j = {}; }
  if (!r.ok) throw new Error(j.error || `ร้านตอบกลับผิดปกติ (${r.status})`);
  return j;
}
async function getJson(url) {
  const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  let j = {};
  try { j = await r.json(); } catch (e) { j = {}; }
  if (!r.ok) throw new Error(j.error || `ร้านตอบกลับผิดปกติ (${r.status})`);
  return j;
}

// แถบความคืบหน้า: [data-bar] [data-pct] [data-stage] [data-err]
function progressUi(box) {
  const bar = $('[data-bar]', box), pct = $('[data-pct]', box), stage = $('[data-stage]', box), err = $('[data-err]', box);
  let last = 0;
  return {
    set(p, text) {
      p = Math.max(last, Math.min(100, Math.round(p)));
      last = p;
      if (bar) bar.style.width = `${p}%`;
      if (pct) pct.textContent = `${p}%`;
      if (stage && text) stage.textContent = text;
    },
    reset() { last = 0; this.set(0); },
    error(t) { if (err) { err.textContent = t || ''; err.hidden = !t; } },
  };
}

function guardLeave(on) {
  const h = (e) => { e.preventDefault(); e.returnValue = ''; };
  if (on) window.addEventListener('beforeunload', h);
  return () => window.removeEventListener('beforeunload', h);
}

const unsupported = () => {
  const s = supportInfo();
  return !s.wasm || !s.offscreen ? 'เบราว์เซอร์นี้สร้างไฟล์ไม่ได้ ลองเปิดด้วย Chrome / Edge / Safari รุ่นใหม่' : '';
};

// ---------- 1) แอนิเมชันที่ปรับแต่ง (หน้าเวอร์ชันของฉัน) ----------
const job = $('[data-browser-job]');
if (job) {
  const ui = progressUi(job);
  const btn = $('[data-go]', job);
  const after = $('[data-after]', job);
  const csrf = csrfOf(job);
  const base = job.getAttribute('data-base');
  const mode = job.getAttribute('data-mode'); // create | download
  let busy = false;
  const go = async () => {
    if (busy) return;
    const bad = unsupported();
    if (bad) { ui.error(bad); return; }
    busy = true; ui.error(''); ui.reset();
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    const release = guardLeave(true);
    try {
      ui.set(1, 'กำลังเตรียม');
      const spec = await getJson(`${base}/spec${mode === 'download' ? '?download=1' : ''}`);
      const r = await renderAnimation(spec, (p, s) => ui.set(p, s));
      saveBlob(r.blob, spec.fileName);
      if (mode !== 'download') await postJson(`${base}/finished`, csrf, { bytes: r.blob.size, ms: r.ms });
      ui.set(100, `บันทึกไฟล์ลงเครื่องแล้ว · ${fmtMB(r.blob.size)} (ถ้าไม่เห็นไฟล์ ดูในโฟลเดอร์ดาวน์โหลด)`);
      if (after) after.hidden = false;
      if (btn) { btn.hidden = true; }
    } catch (e) {
      ui.error(e.message || 'สร้างไฟล์ไม่สำเร็จ');
      if (mode !== 'download') postJson(`${base}/failed`, csrf, { error: String(e.message || e) }).catch(() => {});
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.hidden = false; btn.textContent = 'ลองอีกครั้ง'; }
    } finally {
      release();
      busy = false;
    }
  };
  if (btn) btn.addEventListener('click', go);
  if (job.hasAttribute('data-auto')) go();
}

// ---------- 2) ใส่ซับ: เลือกคลิป → แยกเสียงในเครื่อง → ส่งเสียงทีละท่อนให้ร้านถอด ----------
async function transcribeClip(id, file, csrf, ui) {
  ui.set(3, 'กำลังแยกเสียงพูดจากคลิป (ทำในเครื่องคุณ)');
  const parts = await extractSpeech(file, (p) => ui.set(3 + 22 * p, 'กำลังแยกเสียงพูดจากคลิป (ทำในเครื่องคุณ)'));
  for (let i = 0; i < parts.length; i++) {
    ui.set(25 + 73 * (i / parts.length), `กำลังฟังเสียงพูด ${parts.length > 1 ? `(ท่อน ${i + 1}/${parts.length})` : ''}`);
    let tries = 0;
    for (;;) {
      const r = await fetch(`/subtitles/${id}/audio?i=${i}&n=${parts.length}&start=${parts[i].start.toFixed(3)}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'audio/wav', 'x-csrf-token': csrf }, body: parts[i].blob,
      });
      let j = {};
      try { j = await r.json(); } catch (e) { j = {}; }
      if (r.ok) break;
      if (r.status >= 500 && tries++ < 1) { await new Promise((ok) => setTimeout(ok, 2500)); continue; }
      throw new Error(j.error || 'ฟังเสียงไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }
  ui.set(100, 'เรียบร้อย กำลังเปิดหน้าตรวจคำ…');
}

const subForm = document.querySelector('[data-sub-new][data-browser]');
if (subForm) {
  dropOldClips();
  const fileIn = $('[data-file]', subForm), startBtn = $('[data-start]', subForm), up = $('[data-up]', subForm), errEl = $('[data-up-err]', subForm);
  const drop = $('[data-drop]', subForm);
  if (drop) drop.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files[0]) subForm._picked = e.dataTransfer.files[0]; });
  fileIn.addEventListener('change', () => { subForm._picked = fileIn.files[0] || null; });
  const mapUi = { set: (p, s) => { $('[data-up-bar]', up).style.width = `${Math.round(p)}%`; $('[data-up-pct]', up).textContent = `${Math.round(p)}%`; if (s) $('[data-up-text]', up).textContent = s; } };
  const showErr = (t) => { errEl.textContent = t || ''; errEl.hidden = !t; };
  // ทำงานแทนปุ่มอัปโหลดเดิม (subtitles.js) ทั้งหมด
  startBtn.addEventListener('click', async (e) => {
    e.stopImmediatePropagation();
    const file = fileIn.files && fileIn.files[0] ? fileIn.files[0] : subForm._picked;
    const style = $('input[name="order"]:checked', subForm);
    if (!file) return showErr('กรุณาเลือกคลิปก่อน');
    if (!style) return showErr('กรุณาเลือกแบบตัวอักษรก่อน');
    const bad = unsupported() || (supportInfo().webcodecs ? '' : 'เบราว์เซอร์นี้อ่านคลิปไม่ได้ ลองเปิดด้วย Chrome / Edge / Safari รุ่นใหม่');
    if (bad) return showErr(bad);
    showErr(''); startBtn.disabled = true; startBtn.classList.add('loading'); up.hidden = false;
    const release = guardLeave(true);
    try {
      mapUi.set(1, 'กำลังอ่านคลิป');
      const info = await probeClip(file);
      if (!info.ok) throw new Error('เปิดไฟล์นี้ไม่ได้ ไฟล์อาจเสียหรือไม่ใช่วิดีโอ ลองส่งออกจากแอปตัดต่อเป็น MP4 แล้วเลือกใหม่');
      const r = await postJson('/subtitles/new', csrfOf(subForm), { order: style.value, name: file.name, bytes: file.size, width: info.width, height: info.height, duration: info.duration, audio: info.audio });
      await keepClip(r.id, file);
      await transcribeClip(r.id, file, csrfOf(subForm), mapUi);
      release();
      location.href = r.url;
    } catch (err) {
      release();
      showErr(err.message || 'ไม่สำเร็จ ลองใหม่อีกครั้ง');
      startBtn.disabled = false; startBtn.classList.remove('loading'); up.hidden = true;
    }
  }, true);
}

// หน้า "กำลังฟังเสียง" ของงานโหมดเบราว์เซอร์: ฟังต่อจากคลิปที่เก็บไว้ในเครื่อง หรือให้เลือกคลิปเดิมอีกครั้ง
const resume = $('[data-sub-resume]');
if (resume) {
  const id = resume.getAttribute('data-id');
  const csrf = csrfOf(resume);
  const ui = progressUi(resume);
  const pick = $('[data-pick]', resume);
  const run = async (file) => {
    ui.error(''); pick.hidden = true;
    const release = guardLeave(true);
    try {
      await transcribeClip(id, file, csrf, ui);
      release();
      location.reload();
    } catch (e) {
      release();
      ui.error(e.message);
      pick.hidden = false;
    }
  };
  $('input[type=file]', pick).addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) { await keepClip(id, f); run(f); } });
  loadClip(id).then((f) => { if (f) run(f); else pick.hidden = false; });
}

// ---------- 3) หน้าแก้ซับ: เล่นคลิปจากเครื่อง + สร้างคลิปพร้อมซับในเบราว์เซอร์ ----------
const local = $('[data-local-clip]');
let clipFile = null;
if (local) {
  const id = local.getAttribute('data-local-clip');
  const video = $('[data-video]');
  const ask = $('[data-clip-ask]');
  const use = (f) => { clipFile = f; if (video) { video.src = URL.createObjectURL(f); video.load(); } if (ask) ask.hidden = true; };
  if (ask) $('input[type=file]', ask).addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) { await keepClip(id, f); use(f); } });
  loadClip(id).then((f) => { if (f) use(f); else if (ask) ask.hidden = false; });
}

async function burnAndSave(spec, box, csrf, { report }) {
  const ui = progressUi(box);
  box.hidden = false; ui.reset(); ui.error('');
  if (!clipFile) clipFile = await loadClip(spec.id);
  if (!clipFile) { ui.error('ต้องเลือกคลิปต้นฉบับ (ไฟล์เดิม) ก่อน ร้านไม่ได้เก็บคลิปของคุณไว้'); const ask = $('[data-clip-ask]'); if (ask) ask.hidden = false; return false; }
  const bad = unsupported() || (supportInfo().webcodecs ? '' : 'เบราว์เซอร์นี้สร้างคลิปไม่ได้ ลองเปิดด้วย Chrome / Edge / Safari รุ่นใหม่');
  if (bad) { ui.error(bad); return false; }
  const release = guardLeave(true);
  try {
    const r = await burnSubtitles(clipFile, spec, (p, s) => ui.set(p, s));
    saveBlob(r.blob, spec.fileName);
    if (report) await postJson(`/subtitles/${spec.id}/rendered`, csrf, { bytes: r.blob.size, ms: r.ms });
    ui.set(100, `บันทึกคลิปลงเครื่องแล้ว · ${fmtMB(r.blob.size)} (ถ้าไม่เห็นไฟล์ ดูในโฟลเดอร์ดาวน์โหลด)`);
    const v = $('[data-out-video]', box);
    if (v) { v.src = URL.createObjectURL(r.blob); v.hidden = false; }
    return true;
  } catch (e) {
    ui.error(e.message || 'สร้างคลิปไม่สำเร็จ');
    return false;
  } finally {
    release();
  }
}

// ปุ่ม "สร้างคลิปพร้อมซับ" (subtitles.js บันทึกแล้วส่งสูตรมาให้ทาง event)
document.addEventListener('aw:render-subtitles', async (e) => {
  const box = $('[data-burn]');
  if (box) { box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  const ok = await burnAndSave(e.detail.spec, box, e.detail.csrf, { report: true });
  e.detail.done(ok);
});

// หน้า "เสร็จแล้ว": ปุ่มดาวน์โหลด = สร้างคลิปอีกครั้งจากคลิปในเครื่อง
const again = $('[data-burn-again]');
if (again) {
  const csrf = csrfOf(again);
  const id = again.getAttribute('data-burn-again');
  const btn = $('[data-go]', again);
  const go = async () => {
    btn.disabled = true; btn.classList.add('loading');
    try {
      const spec = await getJson(`/subtitles/${id}/spec?download=1`);
      await burnAndSave(spec, again, csrf, { report: false });
    } catch (err) { progressUi(again).error(err.message); }
    btn.disabled = false; btn.classList.remove('loading');
  };
  btn.addEventListener('click', go);
  if (again.hasAttribute('data-auto')) go();
}

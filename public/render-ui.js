// โหมด serverless: ปุ่มและแถบความคืบหน้าของงานที่เบราว์เซอร์ลูกค้าทำเอง (แอนิเมชันปรับแต่ง · ฟังเสียง · เบิร์นซับ)
import { renderAnimation, burnSubtitles, extractSpeech, wavePeaks, probeClip, playableClip, saveBlob, keepClip, loadClip, dropOldClips, supportInfo } from './render-engine.js';

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

// แถบความคืบหน้า: [data-bar] [data-pct] [data-stage] [data-err] · ใส่เวลาที่เหลือ (จากความเร็วจริง) และปุ่มยกเลิกได้
const fmtEta = (s) => (s < 60 ? `${Math.max(1, s)} วินาที` : `${Math.floor(s / 60)} นาที ${s % 60 ? `${s % 60} วินาที` : ''}`.trim());
function progressUi(box) {
  const bar = $('[data-bar]', box), pct = $('[data-pct]', box), stage = $('[data-stage]', box), err = $('[data-err]', box);
  let last = 0, cancelBtn = null;
  return {
    set(p, text, info) {
      p = Math.max(last, Math.min(100, Math.round(p)));
      last = p;
      if (bar) bar.style.width = `${p}%`;
      if (pct) pct.textContent = `${p}%`;
      if (stage && text) stage.textContent = info && info.eta ? `${text} · เหลือประมาณ ${fmtEta(info.eta)}` : text;
    },
    reset() { last = 0; this.set(0); },
    error(t) { if (err) { err.textContent = t || ''; err.hidden = !t; } },
    // ปุ่มยกเลิก: คืนตัวควบคุม (AbortController) · เรียก done() เมื่อจบงาน
    cancelable() {
      const ctl = new AbortController();
      if (stage && stage.parentNode) {
        cancelBtn = document.createElement('button');
        cancelBtn.type = 'button'; cancelBtn.className = 'btn light small'; cancelBtn.textContent = 'ยกเลิก'; cancelBtn.style.marginLeft = '.6rem';
        cancelBtn.addEventListener('click', () => { cancelBtn.disabled = true; cancelBtn.textContent = 'กำลังยกเลิก…'; ctl.abort(); });
        stage.parentNode.appendChild(cancelBtn);
      }
      return { signal: ctl.signal, done: () => { if (cancelBtn) { cancelBtn.remove(); cancelBtn = null; } } };
    },
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
    const cancel = ui.cancelable();
    try {
      ui.set(1, 'กำลังเตรียม');
      const spec = await getJson(`${base}/spec${mode === 'download' ? '?download=1' : ''}`);
      const r = await renderAnimation(spec, (p, s, i) => ui.set(p, s, i), { signal: cancel.signal });
      saveBlob(r.blob, spec.fileName);
      if (mode !== 'download') await postJson(`${base}/finished`, csrf, { bytes: r.blob.size, ms: r.ms });
      ui.set(100, `บันทึกไฟล์ลงเครื่องแล้ว · ${fmtMB(r.blob.size)} (ถ้าไม่เห็นไฟล์ ดูในโฟลเดอร์ดาวน์โหลด)`);
      if (after) after.hidden = false;
      if (btn) { btn.hidden = true; }
    } catch (e) {
      const stopped = e && e.name === 'AbortError';
      ui.error(stopped ? 'ยกเลิกแล้ว กดสร้างใหม่ได้เมื่อพร้อม' : (e.message || 'สร้างไฟล์ไม่สำเร็จ'));
      if (!stopped && mode !== 'download') postJson(`${base}/failed`, csrf, { error: String(e.message || e) }).catch(() => {});
      ui.reset();
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.hidden = false; btn.textContent = stopped ? 'สร้างอีกครั้ง' : 'ลองอีกครั้ง'; }
    } finally {
      cancel.done();
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
      // ไฟล์ที่เบราว์เซอร์เปิดภาพไม่ได้ (HEVC จากมือถือ ฯลฯ) แปลงเป็น H.264 ก่อน ไม่งั้นได้ภาพดำ
      const pc = await playableClip(file, (p, s) => mapUi.set(p, s));
      const info = pc.info, clip = pc.file;
      if (pc.converted) mapUi.set(1, 'แปลงคลิปเสร็จแล้ว กำลังเริ่มฟังเสียง');
      const r = await postJson('/subtitles/new', csrfOf(subForm), { order: style.value, name: file.name, bytes: file.size, width: info.width, height: info.height, duration: info.duration, audio: info.audio });
      await keepClip(r.id, clip);
      await transcribeClip(r.id, clip, csrfOf(subForm), mapUi);
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
  // แถบใต้คลิป: แจ้งสถานะตอนแปลงคลิปอัตโนมัติ (ซ่อนไว้ถ้าไม่มีอะไรต้องบอก)
  const fix = document.createElement('div');
  fix.className = 'sub-fix small';
  fix.innerHTML = '<span data-fix-msg></span>';
  fix.hidden = true;
  local.appendChild(fix);
  const fixMsg = $('[data-fix-msg]', fix);
  if (/\bLine\/|FBAN|FBAV|Instagram|TikTok/i.test(navigator.userAgent)) {
    fix.hidden = false;
    fixMsg.textContent = 'คุณเปิดผ่านแอปแชท/โซเชียล ซึ่งมักเล่นคลิปไม่ได้ แนะนำเปิดลิงก์นี้ใน Chrome หรือ Safari ·';
  }
  let converting = false, autoTried = false;
  const convert = async (why) => {
    if (converting || !clipFile) return;
    converting = true; fix.hidden = false;
    fixMsg.className = '';
    try {
      const pc = await playableClip(clipFile, (p, s) => { fixMsg.textContent = `${why} ${s || 'กำลังแปลงคลิป'} ${p}%`; }, { force: true });
      await keepClip(id, pc.file);
      fixMsg.textContent = 'แปลงคลิปเสร็จแล้ว';
      use(pc.file, true);
      setTimeout(() => { if (!converting) { fixMsg.textContent = ''; fix.hidden = true; } }, 4000);
    } catch (err) {
      fixMsg.textContent = `${err.message || 'แปลงคลิปไม่สำเร็จ'} · ลองส่งออกคลิปเป็น MP4 (H.264) จากแอปกล้องหรือแอปตัดต่อ แล้วเลือกใหม่`;
      fixMsg.className = 'error';
    } finally { converting = false; }
  };
  // ตรวจว่าคลิปเล่นภาพได้จริง: เล่นไม่ได้ / ไม่มีภาพ / ดำทั้งเฟรม → แปลงเป็น H.264 อัตโนมัติ (ครั้งเดียว)
  const frameDark = () => {
    try {
      const c = document.createElement('canvas'); c.width = 24; c.height = 24;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(video, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i], d[i + 1], d[i + 2]);
      return max < 6;
    } catch (e) { return false; }
  };
  const check = (converted) => new Promise((done) => {
    let settled = false;
    const end = (ok) => { if (settled) return; settled = true; clearTimeout(t); video.removeEventListener('error', onErr); video.removeEventListener('loadeddata', onData); done(ok); };
    const onErr = () => end(false);
    const onData = () => {
      if (!video.videoWidth) return end(false); // มีแต่เสียง ภาพถอดรหัสไม่ได้
      if (!frameDark()) return end(true);
      // เฟรมแรกดำ (คลิปอาจเริ่มจากจอดำ) ลองดูกลางคลิปก่อนตัดสิน
      const back = video.currentTime;
      video.addEventListener('seeked', function once() { video.removeEventListener('seeked', once); const dark = frameDark(); video.currentTime = back; end(!dark); });
      video.currentTime = Math.min((video.duration || 2) / 2, 5);
    };
    video.addEventListener('error', onErr);
    video.addEventListener('loadeddata', onData);
    // iPhone ไม่โหลดภาพจนกว่าจะกดเล่น: มีขนาดภาพแล้วถือว่าเล่นได้
    const t = setTimeout(() => end(video.readyState >= 1 && video.videoWidth > 0), 8000);
    if (converted) end(true);
  });
  const use = (f, converted) => {
    clipFile = f;
    if (video) {
      video.src = URL.createObjectURL(f); video.load();
      check(converted).then((ok) => {
        if (ok || converted || clipFile !== f) return;
        if (!autoTried) { autoTried = true; convert('เครื่องนี้เล่นภาพคลิปนี้ไม่ได้ กำลังแปลงเป็น MP4 ให้อัตโนมัติ ·'); } else { fix.hidden = false; fixMsg.className = 'error'; fixMsg.textContent = 'เครื่องนี้ยังเล่นคลิปนี้ไม่ได้ ลองส่งออกคลิปเป็น MP4 จากแอปกล้องหรือแอปตัดต่อ แล้วเลือกใหม่'; }
      });
    }
    if (ask) ask.hidden = true;
    // คลื่นเสียงของไทม์ไลน์ คำนวณจากคลิปในเครื่อง (ร้านไม่มีคลิป)
    if ($('[data-tl-wave]')) wavePeaks(f).then((peaks) => document.dispatchEvent(new CustomEvent('aw:peaks', { detail: peaks }))).catch(() => {});
  };
  if (video) video.addEventListener('error', () => { if (clipFile && !converting && !autoTried) { autoTried = true; convert('เครื่องนี้เล่นคลิปนี้ไม่ได้ กำลังแปลงเป็น MP4 ให้อัตโนมัติ ·'); } });
  if (ask) $('input[type=file]', ask).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const note = $('[data-clip-note]', ask) || ask.appendChild(Object.assign(document.createElement('p'), { className: 'small muted' }));
    note.setAttribute('data-clip-note', '');
    try {
      const pc = await playableClip(f, (p, s) => { note.textContent = `${s || 'กำลังเตรียมคลิป'} ${p}%`; });
      note.textContent = '';
      await keepClip(id, pc.file); use(pc.file);
    } catch (err) { note.textContent = err.message || 'เปิดคลิปนี้ไม่ได้'; note.className = 'small error'; }
  });
  loadClip(id).then((f) => { if (f) use(f); else if (ask) ask.hidden = false; });
}

// ข้อผิดพลาดต้องเห็นชัด: ขึ้นทั้งในกล่องความคืบหน้าและใต้ปุ่มสร้างคลิป
function burnError(box, ui, msg) {
  ui.error(msg);
  const top = document.querySelector('.sub-go > [data-err]');
  if (top) { top.textContent = msg; top.hidden = false; }
  const retry = $('[data-burn-retry]', box);
  if (retry) retry.hidden = false;
  console.error('[ใส่ซับ] สร้างคลิปไม่สำเร็จ:', msg);
}
let lastUrl = null;
async function burnAndSave(spec, box, csrf, { report }) {
  const ui = progressUi(box);
  box.hidden = false; ui.reset(); ui.error('');
  const dl = $('[data-dl]', box), retry = $('[data-burn-retry]', box), top = document.querySelector('.sub-go > [data-err]');
  if (dl) dl.hidden = true;
  if (retry) retry.hidden = true;
  if (top) top.hidden = true;
  ui.set(1, 'กำลังเตรียมคลิปและฟอนต์…');
  if (!clipFile) clipFile = await loadClip(spec.id);
  if (!clipFile) { burnError(box, ui, 'ต้องเลือกคลิปต้นฉบับ (ไฟล์เดิม) ก่อน ร้านไม่ได้เก็บคลิปของคุณไว้ กดเลือกคลิปด้านบน แล้วกดสร้างอีกครั้ง'); const ask = $('[data-clip-ask]'); if (ask) { ask.hidden = false; ask.scrollIntoView({ behavior: 'smooth', block: 'center' }); } return false; }
  const bad = unsupported() || (supportInfo().webcodecs ? '' : 'เบราว์เซอร์นี้สร้างคลิปไม่ได้ ลองเปิดด้วย Chrome / Edge / Safari รุ่นใหม่');
  if (bad) { burnError(box, ui, bad); return false; }
  const release = guardLeave(true);
  const cancel = ui.cancelable();
  try {
    const r = await burnSubtitles(clipFile, spec, (p, s, i) => ui.set(p, s, i), { signal: cancel.signal });
    if (!r || !r.blob || !r.blob.size) throw new Error('ได้ไฟล์เปล่า ลองอีกครั้ง หรือลองเปิดด้วย Chrome รุ่นใหม่');
    // ปุ่มดาวน์โหลดค้างไว้เสมอ (บางเบราว์เซอร์ เช่น Safari บนมือถือ ไม่ยอมโหลดเองอัตโนมัติ)
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(r.blob);
    if (dl) { dl.href = lastUrl; dl.download = spec.fileName || 'คลิปพร้อมซับ.mp4'; dl.hidden = false; }
    const v = $('[data-out-video]', box);
    if (v) { v.src = lastUrl; v.hidden = false; }
    ui.set(100, `คลิปพร้อมซับเสร็จแล้ว · ${fmtMB(r.blob.size)} · กำลังดาวน์โหลด ถ้าไฟล์ไม่ขึ้น กดปุ่ม "ดาวน์โหลดคลิป MP4"`);
    try { saveBlob(r.blob, spec.fileName); } catch (e) { /* ใช้ปุ่มแทน */ }
    if (dl) dl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // แจ้งร้านว่าเสร็จ (ไม่สำเร็จก็ไม่เป็นไร ลูกค้าได้ไฟล์แล้ว)
    if (report) postJson(`/subtitles/${spec.id}/rendered`, csrf, { bytes: r.blob.size, ms: r.ms }).catch((e) => console.warn('[ใส่ซับ] แจ้งร้านไม่สำเร็จ', e));
    return true;
  } catch (e) {
    console.error(e);
    burnError(box, ui, e && e.name === 'AbortError' ? 'ยกเลิกแล้ว กดสร้างใหม่ได้เมื่อพร้อม' : (e && e.message) || 'สร้างคลิปไม่สำเร็จ ลองอีกครั้ง');
    return false;
  } finally {
    cancel.done();
    release();
  }
}

// ปุ่ม "สร้างคลิปพร้อมซับ" (subtitles.js บันทึกแล้วส่งสูตรมาให้ทาง event)
window.AWRenderReady = true; // subtitles.js เช็กก่อนกดสร้าง (ถ้าสคริปต์นี้โหลดไม่ขึ้น จะบอกลูกค้าแทนการเงียบ)
document.addEventListener('aw:render-subtitles', async (e) => {
  const box = $('[data-burn]');
  if (box) { box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  let ok = false;
  try { ok = await burnAndSave(e.detail.spec, box, e.detail.csrf, { report: true }); } catch (err) { burnError(box, progressUi(box), (err && err.message) || 'สร้างคลิปไม่สำเร็จ'); }
  e.detail.done(ok);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-burn-retry]')) return;
  const b = document.querySelector('[data-render]');
  if (b) b.click();
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

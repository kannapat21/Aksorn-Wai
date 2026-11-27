'use strict';
/*
 * ซับอัตโนมัติ: คิวงาน "ถอดเสียง" และ "เบิร์นซับ" ของคลิปลูกค้า
 *
 *   queued → transcribing → review (ลูกค้าแก้คำ/เลือกแบบ) → queued_render → rendering → done
 *   failed (ทุกขั้น) · expired (ครบเวลาเก็บ ลบไฟล์และข้อความซับแล้ว)
 *
 *  - ทำทีละงานทั้งร้าน (SUBTITLE_CONCURRENCY) เพราะ Whisper และ Chrome ใช้หน่วยความจำมาก
 *  - คลิปลูกค้า ข้อความซับ และไฟล์ที่ได้ ลบอัตโนมัติหลัง SUBTITLE_RETENTION_HOURS (ค่าเริ่มต้น 24 ชม.)
 *  - งานที่ค้างตอนปิดร้าน กลับเข้าคิวเมื่อเปิดร้านใหม่
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cuesLib = require('./subcues');

const HOUR = 60 * 60 * 1000;
const SIZES = ['sm', 'md', 'lg'];
const POSITIONS = ['bottom', 'middle', 'top'];
const OUTLINES = { none: 0, thin: 0.035, medium: 0.05, thick: 0.08 };

function createSubtitles({ db, cfg, log, now, transcriber, renderer, toolsOk, resolveFont }) {
  const S = cfg.subtitles;
  db.exec(`
    CREATE TABLE IF NOT EXISTS subtitle_jobs (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      order_id     TEXT NOT NULL,           -- แบบในคลังที่ใช้ (คำสั่งซื้อที่เป็นเจ้าของ)
      product_slug TEXT NOT NULL,
      font         TEXT NOT NULL,
      fill         TEXT NOT NULL,
      stroke       TEXT NOT NULL,
      outline      TEXT NOT NULL,
      shadow       INTEGER NOT NULL DEFAULT 0,
      size         TEXT NOT NULL DEFAULT 'md',
      position     TEXT NOT NULL DEFAULT 'bottom',
      status       TEXT NOT NULL DEFAULT 'queued',
      progress     INTEGER NOT NULL DEFAULT 0,
      stage        TEXT NOT NULL DEFAULT '',
      error        TEXT,
      src_name     TEXT NOT NULL DEFAULT '',
      src_ext      TEXT NOT NULL DEFAULT 'mp4',
      src_bytes    INTEGER NOT NULL DEFAULT 0,
      width        INTEGER NOT NULL DEFAULT 0,
      height       INTEGER NOT NULL DEFAULT 0,
      duration     REAL NOT NULL DEFAULT 0,
      hdr          INTEGER NOT NULL DEFAULT 0,
      cues_json    TEXT,
      engine       TEXT,
      out_bytes    INTEGER,
      renders      INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      queued_at    INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL,
      finished_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS subtitle_user ON subtitle_jobs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS subtitle_queue ON subtitle_jobs(status, queued_at);
  `);
  // โหมดเบราว์เซอร์ (serverless): เครื่องร้านไม่ได้ทำงานค้างเอง ห้ามรีเซ็ตสถานะตอนฟังก์ชันเริ่มใหม่
  const browserMode = cfg.renderMode === 'browser';
  if (!browserMode) {
    db.exec(`
      UPDATE subtitle_jobs SET status = 'queued', progress = 0, stage = '' WHERE status = 'transcribing';
      UPDATE subtitle_jobs SET status = 'queued_render', progress = 0, stage = '' WHERE status = 'rendering';
    `);
  }
  // คำที่ถอดได้ทีละท่อน (เบราว์เซอร์ส่งเสียงมาทีละท่อน) · งานที่คลิปอยู่ในเครื่องลูกค้าเท่านั้น
  const subCols = db.prepare('PRAGMA table_info(subtitle_jobs)').all().map((c) => c.name);
  if (!subCols.includes('asr_json')) db.exec('ALTER TABLE subtitle_jobs ADD COLUMN asr_json TEXT');
  if (!subCols.includes('browser')) db.exec('ALTER TABLE subtitle_jobs ADD COLUMN browser INTEGER NOT NULL DEFAULT 0');
  const q = {
    insert: db.prepare(`INSERT INTO subtitle_jobs (id, user_id, order_id, product_slug, font, fill, stroke, outline, shadow, size, position, status,
                          src_name, src_ext, src_bytes, width, height, duration, hdr, created_at, queued_at, updated_at, expires_at)
                        VALUES (@id, @user_id, @order_id, @product_slug, @font, @fill, @stroke, @outline, @shadow, @size, @position, 'queued',
                          @src_name, @src_ext, @src_bytes, @width, @height, @duration, @hdr, @t, @t, @t, @expires_at)`),
    get: db.prepare('SELECT * FROM subtitle_jobs WHERE id = ?'),
    byUser: db.prepare("SELECT * FROM subtitle_jobs WHERE user_id = ? AND status != 'expired' ORDER BY created_at DESC LIMIT 50"),
    since: db.prepare('SELECT COUNT(*) AS n FROM subtitle_jobs WHERE user_id = ? AND created_at > ?'),
    active: db.prepare("SELECT COUNT(*) AS n FROM subtitle_jobs WHERE user_id = ? AND status IN ('queued','transcribing','queued_render','rendering')"),
    next: db.prepare("SELECT * FROM subtitle_jobs WHERE status IN ('queued','queued_render') ORDER BY queued_at LIMIT 1"),
    position: db.prepare("SELECT COUNT(*) AS n FROM subtitle_jobs WHERE status IN ('queued','queued_render') AND queued_at < ?"),
    claim: db.prepare('UPDATE subtitle_jobs SET status = ?, progress = 1, stage = ?, updated_at = ? WHERE id = ? AND status = ?'),
    progress: db.prepare('UPDATE subtitle_jobs SET progress = ?, stage = ? WHERE id = ?'),
    review: db.prepare("UPDATE subtitle_jobs SET status = 'review', progress = 100, stage = '', cues_json = ?, engine = ?, updated_at = ? WHERE id = ?"),
    done: db.prepare("UPDATE subtitle_jobs SET status = 'done', progress = 100, stage = '', out_bytes = ?, renders = renders + 1, finished_at = ?, updated_at = ? WHERE id = ?"),
    fail: db.prepare("UPDATE subtitle_jobs SET status = 'failed', stage = '', error = ?, updated_at = ?, finished_at = ? WHERE id = ?"),
    retryAsr: db.prepare("UPDATE subtitle_jobs SET status = 'queued', progress = 0, stage = '', error = NULL, queued_at = ?, updated_at = ? WHERE id = ? AND status = 'failed' AND cues_json IS NULL"),
    backToReview: db.prepare("UPDATE subtitle_jobs SET status = 'review', stage = '', error = NULL, updated_at = ? WHERE id = ? AND status IN ('done','failed') AND cues_json IS NOT NULL"),
    saveCues: db.prepare("UPDATE subtitle_jobs SET cues_json = ?, updated_at = ? WHERE id = ? AND status IN ('review','done','failed')"),
    setStyle: db.prepare(`UPDATE subtitle_jobs SET order_id = @order_id, product_slug = @product_slug, font = @font, fill = @fill, stroke = @stroke,
                            outline = @outline, shadow = @shadow, size = @size, position = @position, updated_at = @t WHERE id = @id`),
    queueRender: db.prepare("UPDATE subtitle_jobs SET status = 'queued_render', progress = 0, stage = '', error = NULL, queued_at = ?, updated_at = ? WHERE id = ? AND status IN ('review','done','failed') AND cues_json IS NOT NULL"),
    expired: db.prepare("SELECT id FROM subtitle_jobs WHERE expires_at < ? AND status != 'expired'"),
    expire: db.prepare("UPDATE subtitle_jobs SET status = 'expired', cues_json = NULL, src_name = '', error = NULL, stage = '', updated_at = ? WHERE id = ?"),
    purgeOld: db.prepare("DELETE FROM subtitle_jobs WHERE status = 'expired' AND expires_at < ?"),
    del: db.prepare("UPDATE subtitle_jobs SET status = 'expired', cues_json = NULL, src_name = '', expires_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status IN ('review','done','failed','queued','queued_render')"),
    known: db.prepare("SELECT id FROM subtitle_jobs WHERE status != 'expired'"),
    insertBrowser: db.prepare(`INSERT INTO subtitle_jobs (id, user_id, order_id, product_slug, font, fill, stroke, outline, shadow, size, position, status, stage,
                          src_name, src_ext, src_bytes, width, height, duration, hdr, browser, asr_json, created_at, queued_at, updated_at, expires_at)
                        VALUES (@id, @user_id, @order_id, @product_slug, @font, @fill, @stroke, @outline, @shadow, @size, @position, 'transcribing', 'กำลังฟังเสียงพูด',
                          @src_name, @src_ext, @src_bytes, @width, @height, @duration, 0, 1, '[]', @t, @t, @t, @expires_at)`),
    asrSave: db.prepare("UPDATE subtitle_jobs SET asr_json = ?, progress = ?, stage = ?, updated_at = ? WHERE id = ? AND status = 'transcribing'"),
    asrRestart: db.prepare("UPDATE subtitle_jobs SET status = 'transcribing', progress = 0, stage = 'กำลังฟังเสียงพูด', error = NULL, asr_json = '[]', updated_at = ? WHERE id = ? AND status IN ('transcribing','failed') AND cues_json IS NULL"),
    asrResume: db.prepare("UPDATE subtitle_jobs SET status = 'transcribing', stage = 'กำลังฟังเสียงพูด', error = NULL, updated_at = ? WHERE id = ? AND status = 'failed' AND cues_json IS NULL"),
    renderedBrowser: db.prepare("UPDATE subtitle_jobs SET status = 'done', progress = 100, stage = '', out_bytes = ?, renders = renders + 1, finished_at = ?, updated_at = ? WHERE id = ? AND status IN ('review','done','failed') AND cues_json IS NOT NULL"),
  };

  const dirOf = (id) => path.join(S.dir, id);
  const srcOf = (job) => path.join(dirOf(job.id), `source.${job.src_ext}`);
  const outOf = (job) => path.join(dirOf(job.id), 'subtitled.mp4');
  const cuesOf = (job) => (job && job.cues_json ? JSON.parse(job.cues_json) : []);
  const busyStates = ['queued', 'transcribing', 'queued_render', 'rendering'];
  let running = 0;

  const activeRecent = db.prepare("SELECT COUNT(*) AS n FROM subtitle_jobs WHERE user_id = ? AND status = 'transcribing' AND updated_at > ?");
  function limits(userId) {
    // โหมดเบราว์เซอร์: งานที่ฟังเสียงค้าง (ลูกค้าปิดหน้าไปกลางทาง) เกิน 15 นาที ไม่บล็อกคลิปใหม่
    const active = browserMode ? activeRecent.get(userId, now() - 15 * 60 * 1000).n : q.active.get(userId).n;
    return { today: q.since.get(userId, now() - 24 * HOUR).n, maxPerDay: S.dailyLimit, active };
  }

  // ตรวจแบบตัวอักษร (สไตล์) ที่ลูกค้าเลือก: ต้องเป็นแอนิเมชันที่มีในคลัง
  function validateStyle(body, { owned, fonts }) {
    const order = owned.find((o) => o.id === String(body.order || ''));
    if (!order) return { error: 'กรุณาเลือกแบบตัวอักษรจากคลังของคุณ' };
    const font = fonts.find((f) => f.id === String(body.font || ''));
    if (!font) return { error: 'กรุณาเลือกฟอนต์' };
    const fill = String(body.fill || '').toLowerCase();
    const stroke = String(body.stroke || '').toLowerCase();
    const outline = String(body.outline || 'medium');
    if (!/^#[0-9a-f]{6}$/.test(fill)) return { error: 'สีตัวอักษรไม่ถูกต้อง' };
    if (!(outline in OUTLINES)) return { error: 'ความหนาขอบไม่ถูกต้อง' };
    const size = String(require('../public/subplan').sizePct(String(body.size || 'md')));
    // บน/กลาง/ล่าง หรือ % ความสูงที่ลูกค้าลากซับไปวางเอง (5–95)
    const pct = require('../public/subplan').posPct(body.position);
    const position = POSITIONS.includes(body.position) ? body.position : pct !== null ? String(pct) : 'bottom';
    const shadow = body.shadow === true || body.shadow === '1' || body.shadow === 'on' || body.shadow === 1;
    return {
      value: {
        order_id: order.id, product_slug: order.product_slug, font: font.id, fill,
        stroke: /^#[0-9a-f]{6}$/.test(stroke) ? stroke : '#111111', outline, shadow: shadow ? 1 : 0, size, position,
      },
    };
  }

  // รับคลิปที่อัปโหลดเสร็จแล้ว (ไฟล์ชั่วคราว) → ตรวจ → ย้ายเข้าโฟลเดอร์งาน → เข้าคิวถอดเสียง
  async function receive({ user, style, tmpFile, name, bytes, probe }) {
    const info = await probe(tmpFile).catch(() => ({ ok: false }));
    if (!info.ok) return { error: 'เปิดไฟล์นี้ไม่ได้ ไฟล์อาจเสียหรือไม่ใช่วิดีโอ ลองส่งออกจากแอปตัดต่อเป็น MP4 แล้วอัปใหม่' };
    if (!info.audio) return { error: 'คลิปนี้ไม่มีเสียง ระบบต้องฟังเสียงพูดเพื่อทำซับ' };
    if (info.duration > S.maxSeconds + 0.5) return { error: `คลิปยาว ${fmtDur(info.duration)} เกินที่รับได้ (${fmtDur(S.maxSeconds)}) ตัดให้สั้นลงแล้วอัปใหม่` };
    if (info.duration < 1) return { error: 'คลิปสั้นเกินไป' };
    if (Math.min(info.width, info.height) < 240) return { error: 'คลิปความละเอียดต่ำเกินไป (ต้องอย่างน้อย 240p)' };
    const id = crypto.randomBytes(12).toString('hex');
    const ext = /\.(mov|m4v|webm|mkv)$/i.exec(name || '') ? RegExp.$1.toLowerCase() : 'mp4';
    fs.mkdirSync(dirOf(id), { recursive: true, mode: 0o700 });
    fs.renameSync(tmpFile, path.join(dirOf(id), `source.${ext}`));
    const t = now();
    q.insert.run({
      id, user_id: user.id, ...style, src_name: cleanName(name), src_ext: ext, src_bytes: bytes,
      width: info.width, height: info.height, duration: info.duration, hdr: info.hdr ? 1 : 0, t, expires_at: t + S.retentionHours * HOUR,
    });
    log(`[subtitles] รับคลิป ${id} (${fmtDur(info.duration)}, ${info.width}x${info.height})`);
    setImmediate(pump);
    return { job: q.get.get(id) };
  }

  // ---------- โหมดเบราว์เซอร์: คลิปไม่ถูกอัปขึ้นร้าน เบราว์เซอร์ส่งแค่ข้อมูลคลิป + เสียงพูดทีละท่อน ----------
  function checkInfo(info) {
    if (!info.audio) return { error: 'คลิปนี้ไม่มีเสียง ระบบต้องฟังเสียงพูดเพื่อทำซับ' };
    if (!(info.duration > 0) || !(info.width > 0) || !(info.height > 0)) return { error: 'เปิดไฟล์นี้ไม่ได้ ไฟล์อาจเสียหรือไม่ใช่วิดีโอ ลองส่งออกจากแอปตัดต่อเป็น MP4 แล้วเลือกใหม่' };
    if (info.duration > S.maxSeconds + 0.5) return { error: `คลิปยาว ${fmtDur(info.duration)} เกินที่รับได้ (${fmtDur(S.maxSeconds)}) ตัดให้สั้นลงแล้วเลือกใหม่` };
    if (info.duration < 1) return { error: 'คลิปสั้นเกินไป' };
    if (Math.min(info.width, info.height) < 240) return { error: 'คลิปความละเอียดต่ำเกินไป (ต้องอย่างน้อย 240p)' };
    if (Math.max(info.width, info.height) > 8192) return { error: 'คลิปความละเอียดสูงเกินไป' };
    if (info.bytes > S.maxMb * 1024 * 1024) return { error: `ไฟล์ใหญ่เกิน ${S.maxMb} MB` };
    return null;
  }

  function createBrowserJob({ user, style, name, info }) {
    const bad = checkInfo(info);
    if (bad) return bad;
    const id = crypto.randomBytes(12).toString('hex');
    const ext = /\.(mov|m4v|webm|mkv)$/i.exec(name || '') ? RegExp.$1.toLowerCase() : 'mp4';
    const t = now();
    q.insertBrowser.run({
      id, user_id: user.id, ...style, src_name: cleanName(name), src_ext: ext, src_bytes: Math.round(info.bytes) || 0,
      width: Math.round(info.width), height: Math.round(info.height), duration: Number(info.duration), t, expires_at: t + S.retentionHours * HOUR,
    });
    log(`[subtitles] เริ่มคลิป ${id} (${fmtDur(info.duration)}, ${info.width}x${info.height}, ฟังเสียงผ่าน Groq)`);
    return { job: q.get.get(id) };
  }

  // รับคำที่ถอดได้ของท่อนที่ i (จากทั้งหมด n ท่อน) · มาไม่เรียงก็ได้ ส่งซ้ำก็ได้ (เบราว์เซอร์ลองใหม่เอง)
  // ครบทุกท่อนแล้ว = สร้างบรรทัดซับ → ให้ลูกค้าตรวจ
  // asr_json = { n, parts: { i: [คำ] } } (รูปแบบเก่าเป็นอาร์เรย์ ถือว่าเริ่มใหม่)
  function asrChunk(job, i, n, words) {
    let st = null;
    try { st = JSON.parse(job.asr_json || 'null'); } catch { st = null; }
    if (!st || Array.isArray(st) || st.n !== n || typeof st.parts !== 'object') st = { n, parts: {} };
    st.parts[i] = words.map((w) => ({ text: w.text, start: Math.round(w.start * 1000) / 1000, end: Math.round(w.end * 1000) / 1000 }));
    const got = Object.keys(st.parts).length;
    if (got < n) {
      q.asrSave.run(JSON.stringify(st), Math.round((got / n) * 95), 'กำลังฟังเสียงพูด', now(), job.id);
      return { done: false };
    }
    const all = [];
    for (let k = 0; k < n; k++) all.push(...(st.parts[k] || []));
    all.sort((a, b) => a.start - b.start);
    const maxChars = cuesLib.maxCharsFor(job.width, job.height);
    const cues = cuesLib.buildCues(all, { maxChars, duration: job.duration });
    q.review.run(JSON.stringify(cues), 'groq', now(), job.id);
    db.prepare('UPDATE subtitle_jobs SET asr_json = NULL WHERE id = ?').run(job.id);
    log(`[subtitles] ถอดเสียงเสร็จ ${job.id} (${n} ท่อน, ${cues.length} บรรทัด)`);
    return { done: true, cues };
  }

  const restartAsr = (job) => q.asrRestart.run(now(), job.id).changes > 0;
  const resumeAsr = (job) => q.asrResume.run(now(), job.id).changes > 0;
  const failAsr = (job, msg) => q.fail.run(msg, now(), now(), job.id);
  const renderedInBrowser = (job, bytes) => q.renderedBrowser.run(Math.max(0, Math.round(Number(bytes) || 0)), now(), now(), job.id).changes > 0;

  async function work(job) {
    const phase = job.status === 'queued' ? 'asr' : 'render';
    const claimed = q.claim.run(phase === 'asr' ? 'transcribing' : 'rendering', phase === 'asr' ? 'กำลังเตรียมเสียง' : 'เริ่มสร้างคลิป', now(), job.id, job.status);
    if (claimed.changes === 0) return;
    running++;
    let last = -1;
    const onProgress = (p, stage) => {
      const v = Math.max(1, Math.min(99, Math.round(p)));
      if (v > last) { last = v; q.progress.run(v, String(stage || ''), job.id); }
    };
    try {
      if (phase === 'asr') await transcribe(job, onProgress);
      else await burn(q.get.get(job.id), onProgress);
    } catch (e) {
      log(`[subtitles] ${phase === 'asr' ? 'ถอดเสียง' : 'สร้างคลิป'}ไม่สำเร็จ ${job.id}: ${String(e.message).split('\n')[0]}`);
      q.fail.run(e.userMessage || (phase === 'asr' ? 'ถอดเสียงไม่สำเร็จ กรุณาลองใหม่ หรือทักเพจ อักษรไหว' : 'สร้างคลิปไม่สำเร็จ กรุณาลองใหม่ หรือทักเพจ อักษรไหว'), now(), now(), job.id);
      fs.rmSync(outOf(job), { force: true });
    } finally {
      fs.rmSync(path.join(dirOf(job.id), 'audio.wav'), { force: true });
      fs.rmSync(path.join(dirOf(job.id), 'asr.json'), { force: true });
      running--;
      setImmediate(pump);
    }
  }

  async function transcribe(job, onProgress) {
    const dir = dirOf(job.id);
    const wav = path.join(dir, 'audio.wav');
    await renderer.extractAudio(srcOf(job), wav);
    onProgress(8, 'กำลังฟังเสียงพูด');
    // จำกัดเวลาตามความยาวคลิป (ราว 6 เท่าของความยาว อย่างน้อย 5 นาที ไม่เกินค่าที่ตั้งไว้) งานที่ค้างจะจบเป็น "ไม่สำเร็จ" ให้กดลองใหม่ได้
    const timeoutMs = Math.min(cfg.subtitles.asrTimeoutMin * 60e3, Math.max(5 * 60e3, (job.duration || 60) * 6e3));
    let r;
    try {
      r = await transcriber.transcribe(wav, { outFile: path.join(dir, 'asr.json'), timeoutMs, onProgress: (p) => onProgress(8 + p * 0.9, 'กำลังฟังเสียงพูด') });
    } catch (e) {
      if (/SIGKILL/.test(String(e.message))) e.userMessage = 'ถอดเสียงนานเกินกำหนด (เครื่องร้านอาจทำงานหนักอยู่) กดลองใหม่ได้เลย';
      throw e;
    }
    const fresh = q.get.get(job.id);
    if (!fresh || fresh.status !== 'transcribing') return; // ลูกค้าลบระหว่างทำ
    const maxChars = cuesLib.maxCharsFor(job.width, job.height);
    const cues = cuesLib.buildCues(r.words || [], { maxChars, duration: job.duration });
    q.review.run(JSON.stringify(cues), r.engine || '', now(), job.id);
    log(`[subtitles] ถอดเสียงเสร็จ ${job.id} (${cues.length} บรรทัด)`);
  }

  async function burn(job, onProgress) {
    const cues = cuesOf(job);
    const font = resolveFont(job);
    if (font.user && font.chars) {
      const missing = [...new Set(Array.from(cues.map((c) => c.text).join('').replace(/\s/g, '')).filter((ch) => !font.chars.includes(ch)))];
      if (missing.length) {
        const e = new Error('font missing chars');
        e.userMessage = `ฟอนต์ "${font.label}" ไม่มีตัวอักษร: ${missing.slice(0, 12).join(' ')} เลือกฟอนต์อื่นแล้วสร้างใหม่`;
        throw e;
      }
    }
    const p = cfg.products.find((x) => x.slug === job.product_slug);
    fs.rmSync(outOf(job), { force: true });
    const r = await renderer.render({
      src: srcOf(job), outFile: outOf(job), cues, motion: (p && p.motion) || 'pop',
      fill: job.fill, stroke: job.stroke, strokeRatio: OUTLINES[job.outline] || 0, shadow: Boolean(job.shadow),
      font, size: job.size, position: job.position, tmpDir: dirOf(job.id),
      info: { width: job.width, height: job.height, duration: job.duration, hdr: Boolean(job.hdr) },
      onProgress,
    });
    const fresh = q.get.get(job.id);
    if (!fresh || fresh.status !== 'rendering') { fs.rmSync(outOf(job), { force: true }); return; }
    q.done.run(r.bytes, now(), now(), job.id);
    log(`[subtitles] สร้างคลิปเสร็จ ${job.id} (${Math.round(r.ms / 1000)} วิ)`);
  }

  function pump() {
    if (!toolsOk()) return;
    while (running < S.concurrency) {
      const job = q.next.get();
      if (!job) return;
      work(job);
    }
  }

  async function idle() {
    for (let i = 0; i < 3000; i++) {
      if (running === 0 && (!toolsOk() || !q.next.get())) return;
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  function saveCues(job, input) {
    const r = cuesLib.validateCues(input, { duration: job.duration, prev: cuesOf(job) });
    if (r.error) return r;
    q.saveCues.run(JSON.stringify(r.cues), now(), job.id);
    return r;
  }

  function setStyle(job, value) { q.setStyle.run({ id: job.id, ...value, t: now() }); }

  function queueRender(job) {
    const ok = q.queueRender.run(now(), now(), job.id).changes > 0;
    if (ok) setImmediate(pump);
    return ok;
  }

  // คลื่นเสียงของคลิป (คำนวณครั้งเดียว เก็บไว้ในโฟลเดอร์งาน ถูกลบพร้อมคลิป)
  const peaksBusy = new Map();
  function peaksOf(job) {
    const file = path.join(dirOf(job.id), 'peaks.json');
    try { return Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { /* ยังไม่มี */ }
    if (!renderer.peaks || !fs.existsSync(srcOf(job))) return Promise.resolve(null);
    if (!peaksBusy.has(job.id)) {
      peaksBusy.set(job.id, renderer.peaks(srcOf(job)).then((r) => {
        try { fs.writeFileSync(file, JSON.stringify(r), { mode: 0o600 }); } catch { /* โฟลเดอร์ถูกลบไปแล้ว */ }
        return r;
      }).finally(() => peaksBusy.delete(job.id)));
    }
    return peaksBusy.get(job.id);
  }

  function retry(job) {
    const ok = q.retryAsr.run(now(), now(), job.id).changes > 0;
    if (ok) setImmediate(pump);
    return ok;
  }

  function reopen(job) { return q.backToReview.run(now(), job.id).changes > 0; }

  function remove(id, userId) {
    const t = now();
    const ok = q.del.run(t, t, id, userId).changes > 0;
    if (ok) fs.rmSync(dirOf(id), { recursive: true, force: true });
    return ok;
  }

  // ลบงานที่ครบเวลาเก็บ + โฟลเดอร์ที่ไม่มีงานแล้ว (เช่น อัปค้างตอนร้านปิด)
  function sweep() {
    const t = now();
    for (const r of q.expired.all(t)) {
      const job = q.get.get(r.id);
      if (job && (job.status === 'transcribing' || job.status === 'rendering')) continue; // รอให้ทำเสร็จก่อน
      fs.rmSync(dirOf(r.id), { recursive: true, force: true });
      q.expire.run(t, r.id);
    }
    q.purgeOld.run(t - 30 * 24 * HOUR); // เก็บแถวสรุป (ไม่มีข้อความ) ไว้นับโควตา/สถิติ 30 วัน
    try {
      const keep = new Set(q.known.all().map((x) => x.id));
      for (const name of fs.readdirSync(S.dir)) {
        const full = path.join(S.dir, name);
        if (keep.has(name)) continue;
        if (name === '.incoming') {
          // อัปโหลดที่ค้าง (ขาดกลางทาง/ร้านปิดระหว่างอัป)
          for (const f of fs.readdirSync(full)) {
            const ff = path.join(full, f);
            if (t - fs.statSync(ff).mtimeMs > 2 * HOUR) fs.rmSync(ff, { force: true });
          }
          continue;
        }
        const st = fs.statSync(full);
        if (t - st.mtimeMs > HOUR) fs.rmSync(full, { recursive: true, force: true });
      }
    } catch { /* ยังไม่มีโฟลเดอร์ */ }
  }

  fs.mkdirSync(S.dir, { recursive: true, mode: 0o700 });
  sweep();
  const timer = setInterval(sweep, 10 * 60 * 1000);
  if (timer.unref) timer.unref();
  setImmediate(pump);

  return {
    get: (id) => q.get.get(String(id || '')),
    byUser: (userId) => q.byUser.all(userId),
    position: (job) => (job.status === 'queued' || job.status === 'queued_render' ? q.position.get(job.queued_at).n + 1 : 0),
    limits, validateStyle, receive, saveCues, createBrowserJob, asrChunk, restartAsr, resumeAsr, failAsr, renderedInBrowser, setStyle, queueRender, retry, peaksOf, reopen, remove, sweep, pump, idle,
    cuesOf, srcOf, outOf, dirOf, busy: (job) => busyStates.includes(job.status),
    tmpDir: () => { const d = path.join(S.dir, '.incoming'); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; },
  };
}

function fmtDur(sec) {
  const s = Math.round(sec);
  return s >= 60 ? `${Math.floor(s / 60)} นาที${s % 60 ? ` ${s % 60} วินาที` : ''}` : `${s} วินาที`;
}

function cleanName(name) {
  return String(name || 'คลิป').normalize('NFC').replace(/[\p{Cc}\p{Cf}<>\\/:*?"|]/gu, '').trim().slice(0, 80) || 'คลิป';
}

module.exports = { createSubtitles, fmtDur, SIZES, POSITIONS };

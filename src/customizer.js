'use strict';
/*
 * ปรับแต่งแอนิเมชันหลังซื้อ: ตรวจค่าที่ลูกค้าส่งมา + คิวเรนเดอร์เบื้องหลัง
 *  - เรนเดอร์ทีละงาน (CUSTOM_CONCURRENCY) เพื่อไม่ให้เครื่องล่ม
 *  - งานที่ค้าง "กำลังเรนเดอร์" ตอนปิดร้าน จะกลับเข้าคิวเมื่อเปิดร้านใหม่
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { inspectFont, FontError } = require('./fontcheck');
const { safely } = require('./crashguard');

const MAX_GRAPHEMES = 40;
const COLOR_RE = /^#[0-9a-f]{6}$/;
// อักษรไทย, ASCII ที่พิมพ์ได้ (ยกเว้น < > ` \), ช่องว่าง และเครื่องหมายที่ใช้บ่อย
const ALLOWED_RE = /^[ก-ฺ฿-๛ !"#$%&'()*+,\-./0-9:;=?@A-Z[\]^_a-z{|}~ ‘’“”…–—•·×÷°]+$/u;
const OUTLINES = { none: 0, thin: 0.035, medium: 0.05, thick: 0.08 };
const SECONDS = [3, 5, 10, 15, 30]; // ความยาวที่เลือกได้ (เข้า 0.5 วิ + ค้าง + ออก 0.5 วิ)
const SIZES = ['vertical', 'horizontal'];

function graphemes(str) {
  return Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(str), (x) => x.segment);
}

// ทำความสะอาดข้อความ: NFC, ตัดอักขระควบคุม/ซ่อน, ยุบช่องว่าง
function cleanText(raw) {
  return String(raw || '')
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateRequest(body, { fonts, editors }) {
  const text = cleanText(body.text);
  const font = fonts.find((f) => f.id === String(body.font || ''));
  const fill = String(body.fill || '').toLowerCase();
  const stroke = String(body.stroke || '').toLowerCase();
  const outline = String(body.outline || 'medium');
  const shadow = body.shadow === '1' || body.shadow === 'on' || body.shadow === true;
  const editor = String(body.editor || '');
  const size = String(body.size || 'vertical');
  const seconds = Number(body.seconds || 5);
  const filetype = body.filetype === 'alt' ? 'alt' : 'main';
  const value = { text, font: font && font.id, fill, stroke, outline, shadow, editor, size, seconds, filetype };
  if (!text) return { error: 'กรุณาพิมพ์ข้อความ', value };
  if (graphemes(text).length > MAX_GRAPHEMES) return { error: `ข้อความยาวได้ไม่เกิน ${MAX_GRAPHEMES} ตัวอักษร`, value };
  if (!ALLOWED_RE.test(text)) return { error: 'ใช้ได้เฉพาะตัวอักษรไทย อังกฤษ ตัวเลข และเครื่องหมายทั่วไป (ไม่รองรับอีโมจิ และเครื่องหมาย < > ` \\)', value };
  if (!font) return { error: 'กรุณาเลือกฟอนต์', value };
  if (font.chars) {
    // ฟอนต์ของลูกค้า: ตรวจว่ามีทุกตัวอักษรที่พิมพ์ (ไม่งั้นเบราว์เซอร์จะแอบใช้ฟอนต์อื่นแทน)
    const missing = [...new Set(Array.from(text.replace(/\s/g, '')).filter((ch) => !font.chars.includes(ch)))];
    if (missing.length) return { error: `ฟอนต์ "${font.label}" ไม่มีตัวอักษร: ${missing.slice(0, 12).join(' ')} ลองเปลี่ยนข้อความหรือเลือกฟอนต์อื่น`, value };
  }
  if (!COLOR_RE.test(fill)) return { error: 'สีตัวอักษรไม่ถูกต้อง', value };
  if (!(outline in OUTLINES)) return { error: 'ความหนาขอบไม่ถูกต้อง', value };
  if (OUTLINES[outline] > 0 && !COLOR_RE.test(stroke)) return { error: 'สีขอบไม่ถูกต้อง', value };
  if (!editors[editor]) return { error: 'กรุณาเลือกโปรแกรมตัดต่อ', value };
  if (!SIZES.includes(size)) return { error: 'กรุณาเลือกแนวตั้งหรือแนวนอน', value };
  if (!SECONDS.includes(seconds)) return { error: 'กรุณาเลือกความยาว', value };
  return { value: { ...value, stroke: COLOR_RE.test(stroke) ? stroke : '#111111' } };
}

// ตรวจ "สไตล์" (หน้าตาอย่างเดียว: ฟอนต์ สี ขอบ เงา ไม่รวมข้อความ)
function validateStyle(body, { fonts }) {
  const font = fonts.find((f) => f.id === String(body.font || ''));
  const fill = String(body.fill || '').toLowerCase();
  const stroke = String(body.stroke || '').toLowerCase();
  const outline = String(body.outline || 'medium');
  const shadow = body.shadow === true || body.shadow === '1' || body.shadow === 'on' || body.shadow === 1;
  const name = cleanText(body.name).slice(0, 40);
  if (!font) return { error: 'กรุณาเลือกฟอนต์' };
  if (!COLOR_RE.test(fill)) return { error: 'สีตัวอักษรไม่ถูกต้อง' };
  if (!(outline in OUTLINES)) return { error: 'ความหนาขอบไม่ถูกต้อง' };
  if (OUTLINES[outline] > 0 && !COLOR_RE.test(stroke)) return { error: 'สีขอบไม่ถูกต้อง' };
  return { value: { name, text: '', font: font.id, fill, stroke: COLOR_RE.test(stroke) ? stroke : '#111111', outline, shadow } };
}

function createCustomizer({ db, cfg, log, now, renderer, toolsOk }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_renders (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      order_id     TEXT NOT NULL REFERENCES orders(id),
      product_slug TEXT NOT NULL,
      text         TEXT NOT NULL,
      font         TEXT NOT NULL,
      fill         TEXT NOT NULL,
      stroke       TEXT NOT NULL,
      outline      TEXT NOT NULL,
      shadow       INTEGER NOT NULL DEFAULT 0,
      editor       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'queued',  -- queued | rendering | done | failed
      progress     INTEGER NOT NULL DEFAULT 0,
      stage        TEXT NOT NULL DEFAULT '',
      error        TEXT,
      files_json   TEXT,
      created_at   INTEGER NOT NULL,
      started_at   INTEGER,
      finished_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS custom_user ON custom_renders(user_id, created_at);

    -- พรีเซ็ตการปรับแต่งของลูกค้า (ใช้ซ้ำกับแอนิเมชันไหนก็ได้ที่เป็นเจ้าของ)
    CREATE TABLE IF NOT EXISTS custom_presets (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      name       TEXT NOT NULL,
      text       TEXT NOT NULL,
      font       TEXT NOT NULL,
      fill       TEXT NOT NULL,
      stroke     TEXT NOT NULL,
      outline    TEXT NOT NULL,
      shadow     INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS presets_user ON custom_presets(user_id, updated_at);

    -- ฟอนต์ที่ลูกค้าอัปโหลดเอง (เห็นและใช้ได้เฉพาะเจ้าของ ไฟล์อยู่นอก public)
    CREATE TABLE IF NOT EXISTS user_fonts (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      name       TEXT NOT NULL,
      format     TEXT NOT NULL,
      bytes      INTEGER NOT NULL,
      chars      TEXT NOT NULL,   -- ตัวอักษรที่ฟอนต์มี (จาก cmap)
      thai       TEXT NOT NULL,   -- full | partial | none
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS user_fonts_user ON user_fonts(user_id, created_at);
  `);
  // โหมดเบราว์เซอร์: เบราว์เซอร์ลูกค้าเรนเดอร์เอง เซิร์ฟเวอร์ไม่มีคิว (ไม่รีเซ็ตสถานะตอนฟังก์ชันเริ่มใหม่)
  const browserMode = cfg.renderMode === 'browser';
  if (!browserMode) db.exec("UPDATE custom_renders SET status = 'queued', progress = 0, stage = '' WHERE status = 'rendering'");
  // งานรุ่นใหม่: แนวที่เลือก ความยาว และชนิดไฟล์
  const cols = db.prepare('PRAGMA table_info(custom_renders)').all().map((x) => x.name);
  if (!cols.includes('size')) db.exec("ALTER TABLE custom_renders ADD COLUMN size TEXT NOT NULL DEFAULT 'vertical'");
  if (!cols.includes('seconds')) db.exec('ALTER TABLE custom_renders ADD COLUMN seconds REAL NOT NULL DEFAULT 3');
  if (!cols.includes('filetype')) db.exec("ALTER TABLE custom_renders ADD COLUMN filetype TEXT NOT NULL DEFAULT 'main'");
  // ค่าที่ใช้ล่าสุดของแต่ละบัญชี
  if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'last_custom')) db.exec('ALTER TABLE users ADD COLUMN last_custom TEXT');
  const q = {
    insert: db.prepare(`INSERT INTO custom_renders (id, user_id, order_id, product_slug, text, font, fill, stroke, outline, shadow, editor, size, seconds, filetype, created_at)
                        VALUES (@id, @user_id, @order_id, @product_slug, @text, @font, @fill, @stroke, @outline, @shadow, @editor, @size, @seconds, @filetype, @created_at)`),
    get: db.prepare('SELECT * FROM custom_renders WHERE id = ?'),
    byUser: db.prepare('SELECT * FROM custom_renders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'),
    byUserOrder: db.prepare('SELECT * FROM custom_renders WHERE user_id = ? AND order_id = ? ORDER BY created_at DESC LIMIT 50'),
    active: db.prepare("SELECT COUNT(*) AS n FROM custom_renders WHERE user_id = ? AND status IN ('queued','rendering')"),
    since: db.prepare("SELECT COUNT(*) AS n FROM custom_renders WHERE user_id = ? AND created_at > ? AND status != 'failed'"),
    next: db.prepare("SELECT * FROM custom_renders WHERE status = 'queued' ORDER BY created_at LIMIT 1"),
    position: db.prepare("SELECT COUNT(*) AS n FROM custom_renders WHERE status = 'queued' AND created_at < ?"),
    start: db.prepare("UPDATE custom_renders SET status = 'rendering', started_at = ?, progress = 1, stage = 'เริ่มเรนเดอร์' WHERE id = ? AND status = 'queued'"),
    progress: db.prepare('UPDATE custom_renders SET progress = ?, stage = ? WHERE id = ?'),
    done: db.prepare("UPDATE custom_renders SET status = 'done', progress = 100, stage = 'เสร็จแล้ว', files_json = ?, finished_at = ? WHERE id = ?"),
    fail: db.prepare("UPDATE custom_renders SET status = 'failed', stage = '', error = ?, finished_at = ? WHERE id = ?"),
    del: db.prepare("DELETE FROM custom_renders WHERE id = ? AND user_id = ? AND status IN ('done','failed')"),
    doneFiles: db.prepare("SELECT files_json FROM custom_renders WHERE user_id = ? AND status = 'done'"),
    setLast: db.prepare('UPDATE users SET last_custom = ? WHERE id = ?'),
    // พรีเซ็ต
    presetIns: db.prepare(`INSERT INTO custom_presets (id, user_id, name, text, font, fill, stroke, outline, shadow, created_at, updated_at)
                           VALUES (@id, @user_id, @name, @text, @font, @fill, @stroke, @outline, @shadow, @t, @t)`),
    presetUpd: db.prepare(`UPDATE custom_presets SET text = @text, font = @font, fill = @fill, stroke = @stroke, outline = @outline, shadow = @shadow, updated_at = @t
                           WHERE id = @id AND user_id = @user_id`),
    presetRename: db.prepare('UPDATE custom_presets SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?'),
    presetDel: db.prepare('DELETE FROM custom_presets WHERE id = ? AND user_id = ?'),
    presetGet: db.prepare('SELECT * FROM custom_presets WHERE id = ? AND user_id = ?'),
    presets: db.prepare('SELECT * FROM custom_presets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200'),
    presetCount: db.prepare('SELECT COUNT(*) AS n FROM custom_presets WHERE user_id = ?'),
    // ฟอนต์ของลูกค้า
    fontIns: db.prepare('INSERT INTO user_fonts (id, user_id, name, format, bytes, chars, thai, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    fontGet: db.prepare('SELECT * FROM user_fonts WHERE id = ? AND user_id = ?'),
    fonts: db.prepare('SELECT * FROM user_fonts WHERE user_id = ? ORDER BY created_at DESC'),
    fontDel: db.prepare('DELETE FROM user_fonts WHERE id = ? AND user_id = ?'),
  };

  let running = 0;
  const DAY_MS = 24 * 60 * 60 * 1000;

  function outDir(id) { return path.join(cfg.customDir, id); }

  async function work(job) {
    if (q.start.run(now(), job.id).changes === 0) return;
    running++;
    log(`[custom] เริ่ม ${job.id}`);
    let last = 0;
    try {
      const files = await renderer(job, {
        outDir: outDir(job.id),
        font: resolveFont(job),
        onProgress: (p, stage) => {
          const v = Math.max(1, Math.min(99, Math.round(p)));
          if (v !== last) { last = v; q.progress.run(v, String(stage || ''), job.id); }
        },
      });
      q.done.run(JSON.stringify(files), now(), job.id);
      log(`[custom] เสร็จ ${job.id}`);
    } catch (e) {
      log(`[custom] ล้มเหลว ${job.id}: ${e.message}`);
      q.fail.run('เรนเดอร์ไม่สำเร็จ กรุณาลองใหม่ หรือทักเพจ อักษรไหว', now(), job.id);
      fs.rmSync(outDir(job.id), { recursive: true, force: true });
    } finally {
      running--;
      pump();
    }
  }

  // หยิบงานถัดไปจากคิว ถ้ายังมีช่องว่าง
  const pump = safely('custom', () => {
    if (!toolsOk()) return;
    while (running < cfg.customConcurrency) {
      const job = q.next.get();
      if (!job) return;
      const started = work(job);
      if (!started) return;
      started.catch((e) => log(`[custom] งาน ${job.id} ล้ม: ${(e && e.stack) || e}`));
      // work() เปลี่ยนสถานะเป็น rendering ทันทีแบบ synchronous ก่อน await แรก จึงไม่หยิบงานเดิมซ้ำ
    }
  }, log);

  // รองานในคิวให้เสร็จ (ใช้ในเทสต์)
  async function idle() {
    for (let i = 0; i < 400; i++) {
      if (running === 0 && (!toolsOk() || !q.next.get())) return;
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  // ไฟล์ที่เบราว์เซอร์ลูกค้าสร้าง (browser: true) อยู่ในเครื่องลูกค้า ไม่กินพื้นที่ร้าน
  function usedBytes(userId) {
    return q.doneFiles.all(userId).reduce((sum, r) => sum + JSON.parse(r.files_json || '[]').reduce((a, f) => a + (f.browser ? 0 : f.bytes || 0), 0), 0);
  }

  // เบราว์เซอร์ลูกค้าเริ่มสร้าง / สร้างเสร็จ / ไม่สำเร็จ
  function browserStart(job) {
    if (job.status === 'queued') q.start.run(now(), job.id);
    return q.get.get(job.id);
  }
  function browserDone(job, { codec, ext, bytes, ms }) {
    const file = { format: 'single', codec, size: job.size, seconds: job.seconds, file: `${job.id}.${ext}`, bytes: Math.max(0, Math.round(Number(bytes) || 0)), ms: Math.round(Number(ms) || 0), browser: true };
    q.done.run(JSON.stringify([file]), now(), job.id);
  }
  function browserFail(job, msg) { if (job.status !== 'done') q.fail.run(msg, now(), job.id); }

  // ไม่จำกัดจำนวนครั้ง: กันเครื่องล่มด้วยคิวทีละงานต่อบัญชี และโควตาพื้นที่เก็บไฟล์
  // (CUSTOM_DAILY_LIMIT ตั้งได้ถ้าอยากจำกัดต่อวัน ค่าเริ่มต้น 0 = ไม่จำกัด)
  const activeRecent = db.prepare("SELECT COUNT(*) AS n FROM custom_renders WHERE user_id = ? AND status IN ('queued','rendering') AND created_at > ?");
  function limits(userId) {
    return {
      // โหมดเบราว์เซอร์: งานที่ลูกค้าปิดหน้าไปก่อนเสร็จ ไม่บล็อกงานใหม่เกิน 10 นาที
      active: browserMode ? activeRecent.get(userId, now() - 10 * 60 * 1000).n : q.active.get(userId).n,
      today: q.since.get(userId, now() - DAY_MS).n,
      maxActive: cfg.customMaxActive,
      maxPerDay: cfg.customDailyLimit,
      usedBytes: usedBytes(userId),
      quotaBytes: cfg.customStorageMb * 1024 * 1024,
    };
  }

  // ---------- พรีเซ็ต ----------
  const presetRow = (userId, v) => ({ user_id: userId, text: v.text, font: v.font, fill: v.fill, stroke: v.stroke, outline: v.outline, shadow: v.shadow ? 1 : 0, t: now() });
  const presets = {
    list: (userId) => q.presets.all(userId),
    get: (id, userId) => q.presetGet.get(String(id || ''), userId),
    count: (userId) => q.presetCount.get(userId).n,
    create(userId, name, v) {
      const id = crypto.randomBytes(9).toString('hex');
      q.presetIns.run({ id, name, ...presetRow(userId, v) });
      return id;
    },
    update: (id, userId, v) => q.presetUpd.run({ id, ...presetRow(userId, v) }).changes > 0,
    rename: (id, userId, name) => q.presetRename.run(name, now(), id, userId).changes > 0,
    remove: (id, userId) => q.presetDel.run(id, userId).changes > 0,
  };

  function rememberLast(userId, v) {
    q.setLast.run(JSON.stringify({ text: v.text, font: v.font, fill: v.fill, stroke: v.stroke, outline: v.outline, shadow: Boolean(v.shadow), size: v.size, seconds: v.seconds, filetype: v.filetype }), userId);
  }

  // ---------- ฟอนต์ของลูกค้า ----------
  const fontPath = (row) => path.join(cfg.userFontDir, row.user_id, `${row.id}.${row.format}`);
  const userFonts = {
    list: (userId) => q.fonts.all(userId),
    get: (id, userId) => q.fontGet.get(String(id || ''), userId),
    path: fontPath,
    key: (row) => `user-fonts/${row.user_id}/${row.id}.${row.format}`,
    add(userId, buf) {
      if (q.fonts.all(userId).length >= cfg.userFontMax) throw new FontError(`อัปโหลดฟอนต์ได้สูงสุด ${cfg.userFontMax} ไฟล์ ลบฟอนต์ที่ไม่ใช้ก่อน`);
      const info = inspectFont(buf);
      const id = crypto.randomBytes(9).toString('hex');
      const row = { id, user_id: userId, format: info.format };
      fs.mkdirSync(path.dirname(fontPath(row)), { recursive: true });
      fs.writeFileSync(fontPath(row), buf, { mode: 0o600 });
      q.fontIns.run(id, userId, info.name || 'ฟอนต์ของฉัน', info.format, buf.length, info.chars, info.thai, now());
      return { id, ...info };
    },
    remove(id, userId) {
      const row = q.fontGet.get(id, userId);
      if (!row) return false;
      q.fontDel.run(id, userId);
      fs.rmSync(fontPath(row), { force: true });
      return true;
    },
  };

  // รายการฟอนต์ที่บัญชีนี้เลือกได้: ฟอนต์ของร้าน + ฟอนต์ที่ตัวเองอัปโหลด (id ขึ้นต้น u-)
  function fontsFor(userId) {
    return [
      ...cfg.fonts.map((f) => ({ ...f, shop: true })),
      ...q.fonts.all(userId).map((r) => ({
        id: `u-${r.id}`, label: r.name, weight: 400, mood: r.thai === 'full' ? 'ฟอนต์ของคุณ' : r.thai === 'partial' ? 'ของคุณ · ไทยไม่ครบ' : 'ของคุณ · ไม่มีอักษรไทย',
        url: `/library/fonts/${r.id}/file`, chars: r.chars, thai: r.thai, user: true, rowId: r.id,
      })),
    ];
  }

  // หาไฟล์ฟอนต์ของงาน (ฟอนต์ของลูกค้าต้องเป็นของเจ้าของงานเท่านั้น)
  function resolveFont(job) {
    if (job.font.startsWith('u-')) {
      const row = q.fontGet.get(job.font.slice(2), job.user_id);
      if (!row) throw new Error('ไม่พบฟอนต์ของลูกค้า (อาจถูกลบไปแล้ว)');
      return { file: fontPath(row), weight: 400, label: row.name, mime: `font/${row.format}`, user: true };
    }
    const f = cfg.fonts.find((x) => x.id === job.font);
    if (!f) throw new Error('ไม่พบฟอนต์');
    return { file: f.path, weight: f.weight, label: f.label, licensePath: f.licensePath, mime: 'font/ttf' };
  }

  function enqueue({ id, user, order, value }) {
    q.insert.run({
      id, user_id: user.id, order_id: order.id, product_slug: order.product_slug,
      text: value.text, font: value.font, fill: value.fill, stroke: value.stroke, outline: value.outline,
      shadow: value.shadow ? 1 : 0, editor: value.editor, size: value.size, seconds: value.seconds, filetype: value.filetype, created_at: now(),
    });
    setImmediate(pump);
    return q.get.get(id);
  }

  function queuePosition(job) { return job.status === 'queued' ? q.position.get(job.created_at).n + 1 : 0; }

  function remove(id, userId) {
    const r = q.del.run(id, userId);
    if (r.changes) fs.rmSync(outDir(id), { recursive: true, force: true });
    return r.changes > 0;
  }

  setImmediate(pump);
  return {
    get: (id) => q.get.get(id),
    byUser: (userId) => q.byUser.all(userId),
    byUserOrder: (userId, orderId) => q.byUserOrder.all(userId, orderId),
    limits, enqueue, queuePosition, remove, pump, idle, outDir, browserStart, browserDone, browserFail, presets, fileOf: (job) => JSON.parse(job.files_json || '[]').find((f) => f.format === 'single') || null, rememberLast, userFonts, fontsFor, resolveFont,
  };
}

// ตัวเรนเดอร์จริง: ไฟล์เดียวตามแนว/ความยาว/โปรแกรมที่เลือก ใช้ pipeline เดียวกับสินค้า (Chrome วาดเฟรม + ffmpeg)
// เปิดเบราว์เซอร์ค้างไว้ใช้ซ้ำระหว่างงาน (เร็วขึ้น ~1 วินาทีต่องาน) แล้วปิดเองเมื่อว่าง 2 นาที
function createRenderer(cfg) {
  let browserP = null;
  let idle = null;
  const getBrowser = async () => {
    clearTimeout(idle);
    if (!browserP) {
      browserP = require('../render/tools').launchBrowser();
      browserP.then((b) => b.on('disconnected', () => { browserP = null; })).catch(() => { browserP = null; });
    }
    return browserP;
  };
  const release = () => {
    clearTimeout(idle);
    idle = setTimeout(async () => { const p = browserP; browserP = null; if (p) (await p).close().catch(() => {}); }, 120 * 1000);
    if (idle.unref) idle.unref();
  };
  return async (job, { outDir, onProgress, font }) => {
    const { renderSingle } = require('../render/render');
    const ed = cfg.editorsConfig.editors[job.editor];
    const prod = cfg.products.find((x) => x.slug === job.product_slug);
    const format = job.filetype === 'alt' && ed.alt ? ed.alt : ed.single;
    fs.mkdirSync(outDir, { recursive: true });
    const ext = { mp4_green: 'mp4', mp4_black: 'mp4', prores4444: 'mov', webm_alpha: 'webm' }[format];
    const browser = await getBrowser();
    try {
      const r = await renderSingle({
        browser, text: job.text, fill: job.fill, stroke: job.stroke, strokeRatio: OUTLINES[job.outline] || 0, shadow: Boolean(job.shadow),
        font: { file: font.file, weight: font.weight, mime: font.mime }, size: job.size || 'vertical', seconds: job.seconds || 5, motion: (prod && prod.motion) || 'pop',
        format, outFile: path.join(outDir, `${job.id}.${ext}`), onProgress,
      });
      return [{ format: 'single', codec: format, size: job.size, seconds: job.seconds, file: r.file, bytes: r.bytes, mime: r.mime, ms: r.ms }];
    } finally {
      release();
    }
  };
}

module.exports = { createCustomizer, createRenderer, validateRequest, validateStyle, SECONDS, cleanText, OUTLINES, MAX_GRAPHEMES };

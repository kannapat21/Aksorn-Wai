'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const { openDb } = require('./db');
const links = require('./links');
const views = require('./views');
const auth = require('./auth');
const { createMailer } = require('./mailer');
const { getProvider, WebhookSignatureError } = require('./payments');
const custom = require('./customizer');
const renderTools = require('../render/tools');
const { createSubtitles } = require('./subtitles');
const { createTranscriber } = require('./transcribe');
const { createStorage, productKey } = require('./storage');

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

function createApp(cfg, opts = {}) {
  const db = opts.db || openDb(cfg.databaseFile, { authToken: cfg.databaseAuthToken });
  const mailer = opts.mailer || createMailer(cfg);
  const provider = opts.provider || getProvider(cfg.paymentProvider);
  const log = opts.log || console.log;
  const storage = opts.storage || createStorage(cfg);
  const now = opts.now || (() => Date.now());
  const secureCookies = cfg.baseUrl.startsWith('https://');
  // คุกกี้ Secure เฉพาะคำขอที่มาทาง https จริง (เปิดผ่าน http://localhost ตอนทดสอบในเครื่อง ต้องเข้าสู่ระบบได้ด้วย
  // ถึงจะตั้ง BASE_URL เป็นลิงก์ https ไว้ · ผ่านอุโมงค์ cloudflared จะได้ X-Forwarded-Proto: https จาก loopback)
  const secureFor = (res) => secureCookies && Boolean(res.req && res.req.secure);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  // Netlify: คำขอผ่าน CDN ของ Netlify เสมอ IP จริงของลูกค้าอยู่ใน x-nf-client-connection-ip (ใช้จำกัดจำนวนครั้ง/กันเดารหัส)
  if (cfg.serverless) {
    app.use((req, res, next) => {
      const ip = req.get('x-nf-client-connection-ip') || String(req.get('x-forwarded-for') || '').split(',')[0].trim();
      if (ip) Object.defineProperty(req, 'ip', { value: ip, configurable: true });
      next();
    });
  }

  const productsBySlug = new Map(cfg.products.map((p) => [p.slug, p]));

  // ความพร้อมของเครื่องมือเรนเดอร์ (ตรวจซ้ำทุก 1 นาทีถ้ายังไม่พร้อม เผื่อเพิ่งติดตั้ง ffmpeg)
  let toolsCache = null;
  let toolsCheckedAt = 0;
  const browserMode = cfg.renderMode === 'browser';
  function tools() {
    if (opts.renderTools) return opts.renderTools;
    // โหมดเบราว์เซอร์: เครื่องร้านไม่เรนเดอร์ (ไม่มี Chrome/ffmpeg) เบราว์เซอร์ลูกค้าทำเอง
    if (browserMode) return { ok: true, browserMode: true, browser: { how: 'เบราว์เซอร์ของลูกค้า (ffmpeg.wasm + WebCodecs)' } };
    if (!toolsCache || (!toolsCache.ok && Date.now() - toolsCheckedAt > 60 * 1000)) {
      toolsCache = renderTools.checkRenderTools();
      toolsCheckedAt = Date.now();
    }
    return toolsCache;
  }
  const { editors } = cfg.editorsConfig;

  // ---------- ส่วนหัวความปลอดภัย ----------
  // โหมดเบราว์เซอร์: ตัวเข้ารหัสวิดีโอ (ffmpeg.wasm) โหลดจาก cdn.jsdelivr.net ครั้งแรกแล้วเก็บในเครื่องลูกค้า
  // ต้องอนุญาต WebAssembly, worker และ blob: (ภาพเฟรมที่วาดในเบราว์เซอร์)
  const CSP = browserMode
    ? "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' blob: data: https://cdn.jsdelivr.net; object-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    : "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      // ลิงก์ดาวน์โหลดมีลายเซ็นใน URL ห้ามส่ง Referer ออกนอกเว็บ (ภายในเว็บส่งได้ ใช้ตัดสินว่าแสดงหน้าโหลดไหม)
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': CSP,
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-DNS-Prefetch-Control': 'off',
    });
    // ขายจริงบน https: บังคับให้เบราว์เซอร์ใช้ https เสมอ
    if (secureCookies && req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // ---------- SQL ----------
  const q = {
    insertOrder: db.prepare(`INSERT INTO orders (id, product_slug, editor, email, amount, currency, status, provider, created_at, user_id, transfer_amount, pay_ref)
                             VALUES (@id, @product_slug, @editor, @email, @amount, 'THB', 'pending', @provider, @created_at, @user_id, @transfer_amount, @pay_ref)`),
    // โอนเงินเอง (manual)
    openTransfer: db.prepare("SELECT * FROM orders WHERE user_id = ? AND product_slug = ? AND provider = 'manual' AND status IN ('pending','review','rejected') ORDER BY created_at DESC LIMIT 1"),
    confirmTransfer: db.prepare("UPDATE orders SET status = 'review', confirmed_at = ?, transfer_time = ?, confirm_count = confirm_count + 1 WHERE id = ? AND user_id = ? AND provider = 'manual' AND status IN ('pending','rejected') AND confirm_count < ?"),
    approveTransfer: db.prepare("UPDATE orders SET status = 'paid', paid_at = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND provider = 'manual' AND status = 'review'"),
    rejectTransfer: db.prepare("UPDATE orders SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ? AND provider = 'manual' AND status = 'review'"),
    staleTransfers: db.prepare("SELECT id FROM orders WHERE provider = 'manual' AND ((status = 'pending' AND created_at < ?) OR (status = 'rejected' AND COALESCE(reviewed_at, created_at) < ?))"),
    expireTransfer: db.prepare("UPDATE orders SET status = 'expired' WHERE id = ? AND provider = 'manual' AND status IN ('pending','rejected')"),
    audit: db.prepare('INSERT INTO payment_audit (order_id, actor_id, actor_email, action, detail, at) VALUES (?, ?, ?, ?, ?, ?)'),
    sameAmount: db.prepare(`SELECT o.id, o.status, o.pay_ref, o.confirmed_at, o.transfer_time, u.email AS user_email FROM orders o LEFT JOIN users u ON u.id = o.user_id
                            WHERE o.provider = 'manual' AND o.transfer_amount = ? AND o.id != ? AND o.status IN ('pending','review') ORDER BY o.created_at`),
    reviewQueue: db.prepare(`SELECT o.*, u.email AS user_email FROM orders o LEFT JOIN users u ON u.id = o.user_id
                             WHERE o.provider = 'manual' AND o.status = 'review' ORDER BY o.confirmed_at ASC`),
    reviewCount: db.prepare("SELECT COUNT(*) AS n FROM orders WHERE provider = 'manual' AND status = 'review'"),
    reviewedRecent: db.prepare(`SELECT o.*, u.email AS user_email, r.email AS reviewer_email FROM orders o
                                LEFT JOIN users u ON u.id = o.user_id LEFT JOIN users r ON r.id = o.reviewed_by
                                WHERE o.provider = 'manual' AND o.reviewed_at IS NOT NULL ORDER BY o.reviewed_at DESC LIMIT 30`),
    auditRecent: db.prepare('SELECT a.*, o.pay_ref FROM payment_audit a LEFT JOIN orders o ON o.id = a.order_id ORDER BY a.id DESC LIMIT 80'),
    setPaymentRef: db.prepare('UPDATE orders SET payment_ref = ? WHERE id = ?'),
    getOrder: db.prepare('SELECT * FROM orders WHERE id = ?'),
    insertEvent: db.prepare('INSERT OR IGNORE INTO webhook_events (event_id, provider, order_id, type, received_at) VALUES (?, ?, ?, ?, ?)'),
    markPaid: db.prepare("UPDATE orders SET status = 'paid', paid_at = ?, payment_ref = COALESCE(?, payment_ref) WHERE id = ? AND status IN ('pending','failed','expired')"),
    // จ่ายไม่สำเร็จ/หมดอายุ: เปลี่ยนได้เฉพาะตอนยังรอจ่าย · คืนเงิน: เอาออกจากคลัง
    markUnpaid: db.prepare("UPDATE orders SET status = ? WHERE id = ? AND status = 'pending' AND (payment_ref IS NULL OR payment_ref = ?)"),
    markRefunded: db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ? AND status = 'paid'"),
    setRefOnly: db.prepare('UPDATE orders SET payment_ref = ? WHERE id = ?'),
    insertGrant: db.prepare('INSERT INTO download_grants (id, order_id, expires_at, created_at, reason) VALUES (?, ?, ?, ?, ?)'),
    liveGrant: db.prepare('SELECT * FROM download_grants WHERE order_id = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1'),
    grantById: db.prepare('SELECT * FROM download_grants WHERE id = ?'),
    touchEmail: db.prepare('UPDATE orders SET last_email_at = ? WHERE id = ?'),
    // บัญชี
    insertUser: db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    setEditor: db.prepare('UPDATE users SET editor = ? WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    sessionById: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    deleteSessionsOf: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    // คลัง
    libraryOrders: db.prepare("SELECT * FROM orders WHERE user_id = ? AND status = 'paid' ORDER BY paid_at DESC"),
    openOrders: db.prepare("SELECT * FROM orders WHERE user_id = ? AND status IN ('pending','review','rejected') ORDER BY created_at DESC LIMIT 10"),
    ownedPaid: db.prepare("SELECT * FROM orders WHERE user_id = ? AND product_slug = ? AND status = 'paid' LIMIT 1"),
    logDownload: db.prepare('INSERT INTO download_log (user_id, order_id, file, editor, at) VALUES (?, ?, ?, ?, ?)'),
    downloadsSince: db.prepare('SELECT COUNT(*) AS n FROM download_log WHERE user_id = ? AND at > ?'),
    // หลังบ้าน
    listOrders: db.prepare(`SELECT o.*, (SELECT COUNT(*) FROM download_log d WHERE d.order_id = o.id) AS downloads
                            FROM orders o ORDER BY o.created_at DESC LIMIT 200`),
    statTotals: db.prepare(`SELECT SUM(status='paid') AS paid, SUM(status='pending') AS pending,
                                   COALESCE(SUM(CASE WHEN status='paid' THEN amount END),0) AS revenue FROM orders`),
    statUsers: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role != 'admin'"),
    // นับว่าลูกค้า "ใช้" ไฟล์กับโปรแกรมไหน (คำสั่งซื้อ x โปรแกรม ไม่นับซ้ำ)
    statEditors: db.prepare('SELECT editor, COUNT(DISTINCT order_id) AS n FROM download_log GROUP BY editor ORDER BY n DESC'),
  };

  const customizer = custom.createCustomizer({
    db, cfg, log, now,
    renderer: opts.renderer || custom.createRenderer(cfg),
    toolsOk: () => !browserMode && tools().ok,
  });

  // ---------- ซับอัตโนมัติ ----------
  const transcriber = opts.transcriber || createTranscriber(cfg);
  const subRender = opts.subtitleRenderer || (() => {
    const R = require('../render/subtitles');
    return { render: (o) => R.renderSubtitled(o), extractAudio: R.extractAudio, probe: R.probe, peaks: R.peaks };
  })();
  const subtitles = createSubtitles({
    db, cfg, log, now, transcriber, renderer: subRender,
    toolsOk: () => !browserMode && tools().ok,
    resolveFont: (job) => {
      const f = customizer.resolveFont(job);
      if (f.user) f.chars = (customizer.userFonts.get(job.font.slice(2), job.user_id) || {}).chars || '';
      return f;
    },
  });
  let subReady = { ok: false, reason: 'กำลังตรวจ' };
  const subCheck = async () => { subReady = opts.transcriber ? { ok: true } : await transcriber.check().catch(() => ({ ok: false })); return subReady; };
  subCheck().then((r) => log(r.ok ? `ซับอัตโนมัติ: พร้อม (${r.engine || 'whisper'})` : `ซับอัตโนมัติ: ยังไม่พร้อม (${r.reason || ''}) ดูวิธีติดตั้งใน README หัวข้อ "ซับอัตโนมัติ"`));

  // ---------- บัญชีแอดมิน (สร้าง/ซิงก์จาก .env ทุกครั้งที่เปิดร้าน) ----------
  // แอดมินเข้าสู่ระบบที่หน้าเข้าสู่ระบบปกติ แล้วเปิด /admin ได้ ลูกค้าทั่วไปเข้าไม่ได้
  const adminQ = {
    setRole: db.prepare("UPDATE users SET role = 'admin', email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?"),
    demoteOthers: db.prepare("UPDATE users SET role = 'customer' WHERE role = 'admin' AND id != ?"),
    setHash: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    insertAdmin: db.prepare("INSERT INTO users (id, email, name, password_hash, role, email_verified_at, created_at) VALUES (?, ?, 'ผู้ดูแลร้าน', ?, 'admin', ?, ?)"),
  };
  function seedAdmin() {
    if (!cfg.adminEmail || !EMAIL_RE.test(cfg.adminEmail) || cfg.adminPassword.length < 12) {
      log('[admin] ปิดหลังบ้านอยู่: ตั้ง ADMIN_EMAIL และ ADMIN_PASSWORD (อย่างน้อย 12 ตัวอักษร) ใน .env');
      return;
    }
    let u = q.userByEmail.get(cfg.adminEmail);
    if (!u) {
      const id = crypto.randomBytes(16).toString('hex');
      adminQ.insertAdmin.run(id, cfg.adminEmail, auth.hashPasswordSync(cfg.adminPassword), now(), now());
      u = q.userById.get(id);
    } else {
      adminQ.setRole.run(now(), u.id);
      if (!auth.verifyPasswordSync(cfg.adminPassword, u.password_hash)) {
        adminQ.setHash.run(auth.hashPasswordSync(cfg.adminPassword), u.id); // .env เป็นต้นฉบับของรหัสแอดมิน
        q.deleteSessionsOf.run(u.id);
      }
    }
    adminQ.demoteOthers.run(u.id); // มีแอดมินได้คนเดียวตาม .env
  }
  seedAdmin();

  // ---------- คุกกี้ เซสชัน CSRF ----------
  // CSRF แบบ double-submit: คุกกี้ csrf (SameSite=Strict) ต้องตรงกับช่อง csrf ในฟอร์มทุกฟอร์มที่ POST
  // ---------- แอป (PWA) ----------
  // service worker ต้องอยู่ที่ราก และห้ามแคชนาน (เวอร์ชันเปลี่ยนทุกครั้งที่เปิดร้านใหม่)
  const SW_VERSION = Date.now().toString(36);
  const swSource = fs.readFileSync(path.join(cfg.root, 'public', 'sw.template.js'), 'utf8').replace('__VERSION__', SW_VERSION);
  app.get('/sw.js', (req, res) => {
    res.set({ 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
    res.send(swSource);
  });
  app.get('/manifest.webmanifest', (req, res) => {
    res.set({ 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    res.sendFile(path.join(cfg.root, 'public', 'manifest.webmanifest'));
  });
  app.get('/sw.template.js', (req, res) => res.status(404).end());

  app.use(express.static(path.join(cfg.root, 'public'), { maxAge: '1h', index: false }));

  // จำกัดคำขอทั้งเว็บต่อ IP (ไม่นับไฟล์ static)
  const globalHits = new Map();
  app.use((req, res, next) => {
    if (!cfg.rateGlobalPerMin || req.path === '/webhooks/payment') return next();
    const t = now();
    const key = req.ip;
    const list = (globalHits.get(key) || []).filter((x) => t - x < MIN_MS);
    if (list.length >= cfg.rateGlobalPerMin) {
      res.set('Retry-After', '60');
      return res.status(429).type('text/plain; charset=utf-8').send('ทำรายการถี่เกินไป กรุณารอ 1 นาทีแล้วลองใหม่');
    }
    list.push(t);
    globalHits.set(key, list);
    if (globalHits.size > 50000) globalHits.clear();
    next();
  });

  app.use((req, res, next) => {
    req.cookies = auth.parseCookies(req.headers.cookie);
    let csrf = req.cookies.csrf;
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(csrf || '')) {
      csrf = crypto.randomBytes(32).toString('base64url');
      res.append('Set-Cookie', auth.cookie('csrf', csrf, { secure: secureFor(res), sameSite: 'Strict' }));
    }
    req.csrf = csrf;
    const sid = req.cookies.sid;
    if (sid) {
      const s = q.sessionById.get(auth.tokenId(sid));
      if (s && s.expires_at > now()) {
        req.user = q.userById.get(s.user_id) || null;
        req.sessionRowId = s.id;
      }
    }
    next();
  });

  // ปิดอีเมลอยู่ (MAIL_MODE=off): ไม่แสดงแถบ "ยืนยันอีเมล" เพราะส่งลิงก์ให้ไม่ได้
  const viewUser = (u) => (u && cfg.mail.mode === 'off' ? { ...u, hideVerifyBar: true } : u || null);
  const page = (req, fn, args = {}) => views[fn]({ cfg, user: viewUser(req.user), csrf: req.csrf, ...args });
  const send = (req, res, fn, args, status = 200) => res.status(status).send(page(req, fn, args));
  const notFound = (req, res, text = '') => send(req, res, 'message', { title: 'ไม่พบหน้านี้', text }, 404);

  function csrfOk(req) { return auth.safeEqual(req.body && req.body.csrf, req.csrf); }
  function requireCsrf(req, res, next) {
    if (csrfOk(req)) return next();
    return send(req, res, 'message', { title: 'หมดเวลาแบบฟอร์ม', text: 'กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง' }, 403);
  }
  function requireUser(req, res, next) {
    if (req.user) return next();
    const back = req.method === 'GET' ? req.originalUrl : (req.get('referer') ? '' : '');
    return res.redirect(303, `/login?next=${encodeURIComponent(auth.safeNext(back || '/library'))}`);
  }

  function startSession(res, userId) {
    const token = auth.newToken();
    const t = now();
    q.deleteExpiredSessions.run(t);
    q.insertSession.run(auth.tokenId(token), userId, t, t + cfg.sessionDays * DAY_MS);
    res.append('Set-Cookie', auth.cookie('sid', token, { secure: secureFor(res), maxAgeSec: cfg.sessionDays * 86400 }));
  }

  // ---------- จำกัดการลองรหัสผ่าน ----------
  const LOGIN_WINDOW_MS = 15 * MIN_MS;
  const attempts = new Map(); // key → [เวลาที่ล้มเหลว]
  const recent = (key) => (attempts.get(key) || []).filter((x) => now() - x < LOGIN_WINDOW_MS);
  function loginBlocked(ip, email) { return recent(`ip:${ip}`).length >= 20 || recent(`em:${email}`).length >= 5; }
  function loginFailed(ip, email) {
    for (const k of [`ip:${ip}`, `em:${email}`]) attempts.set(k, [...recent(k), now()]);
    if (attempts.size > 10000) attempts.clear();
  }

  // ---------- จำกัดจำนวนครั้ง (กันสแปม / เดารหัส / โหลดผิดปกติ) ----------
  // นับในหน่วยความจำต่อเครื่อง (เพียงพอสำหรับร้านขนาดเล็ก ถ้ามีหลายเซิร์ฟเวอร์ควรย้ายไป Redis หรือ reverse proxy)
  const byIp = (req) => `ip:${req.ip}`;
  const byUser = (req) => (req.user ? `u:${req.user.id}` : `ip:${req.ip}`);
  function tooMany(req, res, retrySec) {
    res.set('Retry-After', String(retrySec));
    const json = /json/.test(req.get('accept') || '') || req.get('x-csrf-token') || req.path.startsWith('/library/fonts') || /\/status$/.test(req.path);
    if (json) return res.status(429).json({ error: 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' });
    return send(req, res, 'message', { title: 'ทำรายการถี่เกินไป', text: `เพื่อความปลอดภัย กรุณารอประมาณ ${Math.ceil(retrySec / 60)} นาทีแล้วลองใหม่` }, 429);
  }
  function limiter(name, max, windowMs, keyFn = byIp) {
    const hits = new Map();
    return (req, res, next) => {
      if (!max) return next();
      const key = keyFn(req);
      const t = now();
      const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        log(`[rate] ${name} เกินกำหนด`);
        return tooMany(req, res, Math.max(1, Math.ceil((windowMs - (t - list[0])) / 1000)));
      }
      list.push(t);
      hits.set(key, list);
      if (hits.size > 50000) hits.clear();
      next();
    };
  }
  const MIN15 = 15 * MIN_MS;
  const HOUR = 60 * MIN_MS;
  const limit = {
    signup: limiter('signup', cfg.rateSignupPerHour, HOUR),
    forgot: limiter('forgot', 5, MIN15),
    reset: limiter('reset', 10, MIN15),
    verifyResend: limiter('verify-resend', 3, HOUR, byUser),
    checkout: limiter('checkout', 20, MIN15, byUser),
    download: limiter('download', 120, MIN15, byUser),
    render: limiter('render', 30, MIN15, byUser),
    fontUpload: limiter('font-upload', 20, HOUR, byUser),
    styles: limiter('styles', 60, MIN15, byUser),
    confirm: limiter('transfer-confirm', 6, HOUR, byUser), // แจ้งโอนได้ 6 ครั้งต่อชั่วโมงต่อบัญชี
    subUpload: limiter('subtitle-upload', 20, HOUR, byUser),
    subSave: limiter('subtitle-save', 240, MIN15, byUser),
  };

  // ---------- อีเมลยืนยัน / ลืมรหัสผ่าน ----------
  const tq = {
    insert: db.prepare('INSERT INTO email_tokens (id, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    get: db.prepare('SELECT * FROM email_tokens WHERE id = ? AND kind = ?'),
    use: db.prepare('UPDATE email_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?'),
    lastOf: db.prepare('SELECT created_at FROM email_tokens WHERE user_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1'),
    voidOthers: db.prepare('UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL'),
    verify: db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?'),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    dropSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  };
  const TOKEN_TTL = { verify: 48 * HOUR, reset: 30 * MIN_MS };
  const form = express.urlencoded({ extended: false, limit: '10kb' });

  function issueEmailToken(userId, kind) {
    const token = auth.newToken();
    tq.voidOthers.run(now(), userId, kind); // ลิงก์เก่าที่ยังไม่ได้ใช้ ใช้ไม่ได้แล้ว
    tq.insert.run(auth.tokenId(token), userId, kind, now(), now() + TOKEN_TTL[kind]);
    return token;
  }

  async function sendVerifyEmail(user) {
    const token = issueEmailToken(user.id, 'verify');
    await mailer.send({ to: user.email, subject: `ยืนยันอีเมลของคุณ – ${cfg.shopName}`, text: views.verifyEmailBody({ cfg, user, url: `${cfg.baseUrl}/verify-email?t=${token}` }) });
  }

  app.get('/verify-email', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = auth.tokenId(String(req.query.t || ''));
    const row = tq.get.get(id, 'verify');
    if (!row || row.used_at || row.expires_at < now() || tq.use.run(now(), id, now()).changes !== 1) {
      return send(req, res, 'message', { title: 'ลิงก์ยืนยันใช้ไม่ได้', text: 'ลิงก์อาจหมดอายุหรือถูกใช้ไปแล้ว เข้าสู่ระบบแล้วกด "ส่งอีเมลยืนยันอีกครั้ง" ได้เลย', action: { href: '/library', label: 'ไปที่คลัง' } }, 400);
    }
    tq.verify.run(now(), row.user_id);
    send(req, res, 'message', { title: 'ยืนยันอีเมลแล้ว', text: 'ขอบคุณครับ บัญชีของคุณยืนยันอีเมลเรียบร้อย', action: { href: '/library', label: 'ไปที่คลังของฉัน' } });
  });

  app.post('/verify-email/resend', form, (req, res, next) => (req.user ? next() : res.redirect(303, '/login')), limit.verifyResend, (req, res, next) => {
    if (!auth.safeEqual(req.body && req.body.csrf, req.csrf)) return send(req, res, 'message', { title: 'หมดเวลาแบบฟอร์ม', text: 'กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง' }, 403);
    if (req.user.email_verified_at) return res.redirect(303, '/library');
    sendVerifyEmail(req.user).then(() => {
      send(req, res, 'message', { title: 'ส่งอีเมลยืนยันแล้ว', text: `เราส่งลิงก์ยืนยันไปที่ ${req.user.email} แล้ว อย่าลืมดูในโฟลเดอร์สแปม`, action: { href: '/library', label: 'กลับไปที่คลัง' } });
    }).catch(next);
  });

  // ลืมรหัสผ่าน: ตอบข้อความเดียวกันเสมอ ไม่บอกว่าอีเมลไหนมีบัญชี
  app.get('/forgot', (req, res) => send(req, res, 'forgot', {}));
  app.post('/forgot', limit.forgot, form, (req, res, next) => {
    if (!auth.safeEqual(req.body && req.body.csrf, req.csrf)) return send(req, res, 'message', { title: 'หมดเวลาแบบฟอร์ม', text: 'กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง' }, 403);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 200);
    if (!EMAIL_RE.test(email)) return send(req, res, 'forgot', { form: { email }, error: 'กรุณากรอกอีเมลให้ถูกต้อง' }, 400);
    const user = q.userByEmail.get(email);
    const done = () => send(req, res, 'forgot', { sent: true, form: { email } });
    if (!user || user.role === 'admin') return done(); // รหัสแอดมินเปลี่ยนที่ .env เท่านั้น
    const last = tq.lastOf.get(user.id, 'reset');
    if (last && now() - last.created_at < 2 * MIN_MS) return done(); // กันกดรัว ส่งซ้ำไม่เกินทุก 2 นาที
    const token = issueEmailToken(user.id, 'reset');
    mailer.send({ to: user.email, subject: `ตั้งรหัสผ่านใหม่ – ${cfg.shopName}`, text: views.resetEmailBody({ cfg, user, url: `${cfg.baseUrl}/reset?t=${token}` }) })
      .then(done).catch(next);
  });

  function resetRow(token) {
    const row = tq.get.get(auth.tokenId(String(token || '')), 'reset');
    return row && !row.used_at && row.expires_at > now() ? row : null;
  }
  app.get('/reset', (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    if (!resetRow(req.query.t)) return send(req, res, 'message', { title: 'ลิงก์ตั้งรหัสผ่านใช้ไม่ได้', text: 'ลิงก์อาจหมดอายุ (30 นาที) หรือถูกใช้ไปแล้ว ขอลิงก์ใหม่ได้เลย', action: { href: '/forgot', label: 'ขอลิงก์ใหม่' } }, 400);
    send(req, res, 'reset', { token: String(req.query.t) });
  });
  app.post('/reset', limit.reset, form, async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      if (!auth.safeEqual(req.body && req.body.csrf, req.csrf)) return send(req, res, 'message', { title: 'หมดเวลาแบบฟอร์ม', text: 'กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง' }, 403);
      const token = String(req.body.t || '');
      const password = String(req.body.password || '');
      if (password.length < 8 || password.length > 200) return send(req, res, 'reset', { token, error: 'รหัสผ่านต้องยาว 8–200 ตัวอักษร' }, 400);
      const row = resetRow(token);
      if (!row) return send(req, res, 'message', { title: 'ลิงก์ตั้งรหัสผ่านใช้ไม่ได้', text: 'ลิงก์อาจหมดอายุหรือถูกใช้ไปแล้ว ขอลิงก์ใหม่ได้เลย', action: { href: '/forgot', label: 'ขอลิงก์ใหม่' } }, 400);
      const hash = await auth.hashPassword(password);
      const ok = db.transaction(() => {
        if (tq.use.run(now(), row.id, now()).changes !== 1) return false; // ใช้ได้ครั้งเดียว
        tq.setPassword.run(hash, row.user_id);
        tq.dropSessions.run(row.user_id); // ออกจากระบบทุกเครื่อง
        tq.verify.run(now(), row.user_id); // รับอีเมลได้ = ยืนยันอีเมลแล้ว
        return true;
      })();
      if (!ok) return send(req, res, 'message', { title: 'ลิงก์ตั้งรหัสผ่านใช้ไม่ได้', text: 'ลิงก์ถูกใช้ไปแล้ว', action: { href: '/forgot', label: 'ขอลิงก์ใหม่' } }, 400);
      res.append('Set-Cookie', auth.cookie('sid', '', { secure: secureFor(res), maxAgeSec: 0 }));
      res.redirect(303, '/login?reset=1');
    } catch (e) { next(e); }
  });

  // ---------- ยืนยันการชำระเงิน (เรียกจาก webhook เท่านั้น) ----------
  // ทำใน transaction เดียว: บันทึก event_id (กันซ้ำ) → เปลี่ยนสถานะ (ได้ครั้งเดียว)
  const HANDLED = ['payment.succeeded', 'payment.failed', 'payment.expired', 'payment.refunded'];
  const applyPaymentEvent = db.transaction((ev) => {
    const inserted = q.insertEvent.run(ev.eventId, provider.name, ev.orderId || null, ev.type || null, now());
    if (inserted.changes === 0) return { result: 'duplicate' };
    if (!HANDLED.includes(ev.type)) return { result: 'ignored' };
    const order = ev.orderId && q.getOrder.get(ev.orderId);
    if (!order) return { result: 'unknown_order' };
    if (Number(ev.amount) !== order.amount || (ev.currency && ev.currency !== order.currency)) {
      return { result: 'amount_mismatch', order };
    }
    if (ev.type === 'payment.failed' || ev.type === 'payment.expired') {
      const st = ev.type === 'payment.failed' ? 'failed' : 'expired';
      const upd = q.markUnpaid.run(st, order.id, ev.paymentRef || null);
      return { result: upd.changes ? st : 'ignored', order: q.getOrder.get(order.id) };
    }
    if (ev.type === 'payment.refunded') {
      const upd = q.markRefunded.run(order.id);
      return { result: upd.changes ? 'refunded' : 'ignored', order: q.getOrder.get(order.id) };
    }
    const upd = q.markPaid.run(now(), ev.paymentRef || null, order.id);
    if (upd.changes === 0) return { result: 'already_paid', order };
    return { result: 'paid', order: q.getOrder.get(order.id) };
  });

  // ใช้หลังดึงสถานะ charge จาก gateway ฝั่งเซิร์ฟเวอร์ (ไม่เชื่อสิ่งที่เบราว์เซอร์ส่งมา)
  function applyAndNotify(ev, source) {
    const r = applyPaymentEvent(ev);
    log(`[payment] ${source} ${ev.eventId} ${ev.type} order=${ev.orderId} → ${r.result}`);
    if (r.result === 'paid') sendReceipt(r.order).catch((e) => log(`[mail] ส่งไม่สำเร็จ: ${e.message}`));
    return r;
  }

  async function sendReceipt(order) {
    const p = productsBySlug.get(order.product_slug);
    const user = order.user_id ? q.userById.get(order.user_id) : null;
    await mailer.send({
      to: order.email,
      subject: `ยืนยันการสั่งซื้อ "${p.title}" – ${cfg.shopName}`,
      text: views.emailBody({ cfg, order, p, user }),
    });
    q.touchEmail.run(now(), order.id);
  }

  app.post('/webhooks/payment', express.raw({ type: '*/*', limit: '64kb' }), async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    let ev;
    try {
      ev = await provider.parseWebhook({ rawBody, headers: req.headers, cfg });
    } catch (e) {
      if (e && e.name === 'OmiseApiError') {
        // ลายเซ็นถูกแต่ดึง charge จาก Omise ไม่ได้ชั่วคราว: ตอบ 500 ให้ Omise ส่งซ้ำ
        log(`[webhook] ดึง charge ไม่สำเร็จ: ${e.message}`);
        return res.status(500).json({ error: 'retry' });
      }
      if (e instanceof WebhookSignatureError) {
        log(`[webhook] ปฏิเสธ: ${e.message}`);
        return res.status(400).json({ error: 'invalid signature' });
      }
      log(`[webhook] อ่านไม่ได้: ${e.message}`);
      return res.status(400).json({ error: 'bad payload' });
    }
    if (!ev || !ev.eventId) return res.status(400).json({ error: 'missing event id' });
    if (ev.type === 'ignored' && ev.eventId) return res.json({ ok: true, result: 'ignored' });
    const r = applyAndNotify(ev, 'webhook');
    res.json({ ok: true, result: r.result });
  });

  app.use(express.urlencoded({ extended: false, limit: '10kb' }));

  // ---------- หน้าร้าน ----------
  app.get('/', (req, res) => {
    const owned = new Set(req.user ? q.libraryOrders.all(req.user.id).map((o) => o.product_slug) : []);
    send(req, res, 'home', { products: cfg.products, owned });
  });

  app.get('/p/:slug', (req, res) => {
    const p = productsBySlug.get(req.params.slug);
    if (!p) return send(req, res, 'message', { title: 'ไม่พบสินค้า', text: 'สินค้านี้ไม่มีอยู่หรือถูกนำออกแล้ว' }, 404);
    const owned = req.user ? q.ownedPaid.get(req.user.id, p.slug) : null;
    send(req, res, 'product', { p, owned });
  });

  app.get('/license', (req, res) => send(req, res, 'licensePage'));
  for (const kind of ['terms', 'refund', 'privacy']) app.get(`/${kind}`, (req, res) => send(req, res, 'legalPage', { kind }));
  app.get('/contact', (req, res) => send(req, res, 'contactPage'));
  app.get('/license/kanit-ofl.txt', (req, res) => {
    res.type('text/plain; charset=utf-8').send(fs.readFileSync(path.join(cfg.root, 'fonts', 'OFL.txt')));
  });

  // ---------- สมัคร / เข้าสู่ระบบ / ออกจากระบบ ----------
  app.get('/signup', (req, res) => {
    if (req.user) return res.redirect(303, auth.safeNext(req.query.next));
    send(req, res, 'signup', { next: auth.safeNext(req.query.next) });
  });

  app.post('/signup', limit.signup, requireCsrf, async (req, res, next) => {
    try {
      const name = String(req.body.name || '').trim().slice(0, 80);
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const nextUrl = auth.safeNext(req.body.next);
      const form = { name, email, next: nextUrl };
      let error = null;
      if (email.length > 200 || !EMAIL_RE.test(email)) error = 'กรุณากรอกอีเมลให้ถูกต้อง';
      else if (password.length < 8) error = 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร';
      else if (password.length > 200) error = 'รหัสผ่านยาวเกินไป';
      else if (q.userByEmail.get(email)) error = 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ';
      if (error) return send(req, res, 'signup', { form, next: nextUrl, error }, 400);
      const id = crypto.randomBytes(16).toString('hex');
      const hash = await auth.hashPassword(password);
      try {
        q.insertUser.run(id, email, name, hash, now());
      } catch (e) {
        if (/UNIQUE/.test(e.message)) return send(req, res, 'signup', { form, next: nextUrl, error: 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ' }, 400);
        throw e;
      }
      startSession(res, id);
      log('[auth] สมัครสมาชิกใหม่');
      sendVerifyEmail(q.userById.get(id)).catch((e) => log(`[mail] ส่งอีเมลยืนยันไม่สำเร็จ: ${e.message}`));
      res.redirect(303, nextUrl);
    } catch (e) { next(e); }
  });

  app.get('/login', (req, res) => {
    if (req.user) return res.redirect(303, auth.safeNext(req.query.next));
    send(req, res, 'login', { next: auth.safeNext(req.query.next), notice: req.query.reset === '1' ? 'ตั้งรหัสผ่านใหม่แล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย' : '' });
  });

  app.post('/login', requireCsrf, async (req, res, next) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase().slice(0, 200);
      const password = String(req.body.password || '').slice(0, 200);
      const nextUrl = auth.safeNext(req.body.next);
      const form = { email };
      if (loginBlocked(req.ip, email)) {
        return send(req, res, 'login', { form, next: nextUrl, error: 'ลองรหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่' }, 429);
      }
      const user = q.userByEmail.get(email);
      const ok = await auth.verifyPassword(password, user && user.password_hash);
      if (!user || !ok) {
        loginFailed(req.ip, email);
        return send(req, res, 'login', { form, next: nextUrl, error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' }, 401);
      }
      attempts.delete(`em:${email}`);
      if (req.sessionRowId) q.deleteSession.run(req.sessionRowId);
      startSession(res, user.id);
      res.redirect(303, nextUrl);
    } catch (e) { next(e); }
  });

  app.post('/logout', requireCsrf, (req, res) => {
    if (req.sessionRowId) q.deleteSession.run(req.sessionRowId);
    res.append('Set-Cookie', auth.cookie('sid', '', { secure: secureFor(res), maxAgeSec: 0 }));
    res.redirect(303, '/');
  });

  // ---------- สั่งซื้อ (ต้องเข้าสู่ระบบ) ----------
  app.post('/checkout', limit.checkout, (req, res, next) => {
    if (!req.user) {
      const p = productsBySlug.get(String(req.body.product || ''));
      return res.redirect(303, `/login?next=${encodeURIComponent(p ? `/p/${p.slug}` : '/')}`);
    }
    next();
  }, requireCsrf, async (req, res, next) => {
    try {
      const p = productsBySlug.get(String(req.body.product || ''));
      if (!p) return send(req, res, 'message', { title: 'ไม่พบสินค้า', text: 'กรุณาเลือกสินค้าใหม่' }, 404);
      const owned = q.ownedPaid.get(req.user.id, p.slug);
      if (owned) return res.redirect(303, `/library/${owned.id}`); // มีในคลังแล้ว ไม่ต้องซื้อซ้ำ
      if (p.free) {
        // ของฟรี: ไม่ผ่านหน้าจ่ายเงิน สร้างรายการที่ "ได้แล้ว" แล้วพาเข้าคลังทันที
        const id = claimFree(req.user, p);
        return res.redirect(303, `/library/${id}?claimed=1`);
      }
      if (provider.name === 'manual') {
        // โอนเงินเอง: หนึ่งบัญชีมีออเดอร์ค้างได้ 1 รายการต่อสินค้า (กลับไปใช้อันเดิม ไม่สร้างซ้ำ)
        expireStale();
        const open = q.openTransfer.get(req.user.id, p.slug);
        if (open) return res.redirect(303, open.status === 'review' ? `/order/${open.id}` : `/pay/transfer/${open.id}`);
      }
      const order = {
        id: crypto.randomBytes(16).toString('hex'),
        product_slug: p.slug,
        editor: req.user.editor || '',
        email: req.user.email,
        amount: p.price, // ราคาเอาจาก config ฝั่งเซิร์ฟเวอร์เสมอ
        provider: provider.name,
        created_at: now(),
        user_id: req.user.id,
        transfer_amount: null,
        pay_ref: null,
      };
      if (provider.name === 'manual') {
        if (!insertManualOrder(order)) return send(req, res, 'message', { title: 'ตอนนี้มีออเดอร์รอโอนจำนวนมาก', text: 'กรุณาลองใหม่อีกครั้งในอีกสักครู่' }, 503);
      } else q.insertOrder.run(order);
      const full = q.getOrder.get(order.id);
      const { redirectUrl, paymentRef } = await provider.createCheckout({ order: full, product: p, cfg });
      if (paymentRef) q.setPaymentRef.run(paymentRef, order.id);
      res.redirect(303, redirectUrl);
    } catch (e) { next(e); }
  });

  // รับของฟรี (ทำในทรานแซกชันเดียว กดซ้ำเร็วๆ ก็ได้รายการเดียว)
  const claimFree = db.transaction((user, p) => {
    const owned = q.ownedPaid.get(user.id, p.slug);
    if (owned) return owned.id;
    const id = crypto.randomBytes(16).toString('hex');
    q.insertOrder.run({
      id, product_slug: p.slug, editor: user.editor || '', email: user.email, amount: 0, provider: 'free',
      created_at: now(), user_id: user.id, transfer_amount: null, pay_ref: null,
    });
    q.markPaid.run(now(), null, id);
    return id;
  });

  // คำสั่งซื้อของบัญชีที่ล็อกอินอยู่เท่านั้น (ของคนอื่นตอบเหมือนไม่มี)
  function ownOrder(req) {
    const order = q.getOrder.get(String(req.params.id || req.params.orderId || ''));
    return order && req.user && order.user_id === req.user.id ? order : null;
  }

  // ---------- โหมดทดสอบการจ่ายเงิน ----------
  // ปุ่มจำลองจ่าย: เฉพาะแอดมิน หรือเปิดจากเครื่องร้านเอง (ผ่านลิงก์สาธารณะ/อุโมงค์ req.ip จะเป็น IP จริงของผู้ใช้ จึงกดไม่ได้)
  const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const canMock = (req) => provider.name === 'mock' && (cfg.mockAllowPublic || (req.user && req.user.role === 'admin') || (isLoopback(req.ip) && !req.get('x-forwarded-for')));
  app.get('/pay/mock/:id', requireUser, (req, res) => {
    if (provider.name !== 'mock') return notFound(req, res);
    const order = ownOrder(req);
    if (!order) return notFound(req, res);
    if (order.status === 'paid') return res.redirect(303, `/order/${order.id}`);
    send(req, res, 'mockPay', { order, p: productsBySlug.get(order.product_slug), allowed: canMock(req) });
  });

  app.post('/pay/mock/:id/simulate', requireUser, requireCsrf, async (req, res, next) => {
    try {
      if (provider.name !== 'mock') return notFound(req, res);
      const order = ownOrder(req);
      if (!order) return notFound(req, res);
      if (!canMock(req)) return send(req, res, 'message', { title: 'ยังเปิดขายไม่ได้', text: 'ร้านยังอยู่ในโหมดทดสอบ การจำลองจ่ายเงินทำได้เฉพาะเจ้าของร้าน' }, 403);
      // จำลองว่า gateway ยิง webhook เข้ามา: เซิร์ฟเวอร์เซ็นแล้ว POST เข้า endpoint จริงของตัวเอง
      const body = JSON.stringify(provider.buildEvent(order));
      const target = (app.locals.internalUrl || cfg.baseUrl) + '/webhooks/payment';
      const r = await fetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mock-signature': provider.signPayload(cfg.webhookSecret, body) },
        body,
      });
      if (!r.ok) throw new Error(`mock webhook ล้มเหลว ${r.status}`);
      res.redirect(303, `/order/${order.id}`);
    } catch (e) { next(e); }
  });

  // ---------- Omise: เลือกวิธีจ่าย (PromptPay / บัตร) ----------
  // หน้าจ่ายเงินโหลด Omise.js จาก cdn.omise.co (เลขบัตรส่งตรงไป vault.omise.co ไม่ผ่านเซิร์ฟเวอร์ร้าน)
  const OMISE_CSP = "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://cdn.omise.co; connect-src 'self' https://vault.omise.co https://api.omise.co; frame-src https://*.omise.co; object-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
  const isOmise = () => provider.name === 'omise';
  function payableOrder(req, res) {
    if (!isOmise()) { notFound(req, res); return null; }
    const order = ownOrder(req);
    if (!order) { notFound(req, res, 'ไม่พบคำสั่งซื้อนี้ในบัญชีของคุณ'); return null; }
    if (order.status === 'paid') { res.redirect(303, `/order/${order.id}`); return null; }
    if (order.status === 'refunded') { send(req, res, 'message', { title: 'คำสั่งซื้อนี้คืนเงินแล้ว', text: 'สั่งซื้อใหม่ได้จากหน้าสินค้า' }, 400); return null; }
    return order;
  }
  // จ่ายไม่สำเร็จ/หมดอายุ แล้วลองใหม่: กลับมารอจ่ายได้
  const reopen = db.prepare("UPDATE orders SET status = 'pending' WHERE id = ? AND status IN ('failed','expired')");

  app.get('/pay/omise/:id', requireUser, async (req, res, next) => {
    try {
      const order = payableOrder(req, res);
      if (!order) return;
      res.set({ 'Cache-Control': 'no-store', 'Content-Security-Policy': OMISE_CSP });
      let qr = null;
      if (req.query.method === 'promptpay' && order.payment_ref && order.status === 'pending') {
        const ch = await provider.api(cfg).getCharge(order.payment_ref).catch(() => null);
        if (ch && ch.status === 'pending' && ch.source && ch.source.type === 'promptpay') qr = { expiresAt: ch.expires_at };
      }
      send(req, res, 'omisePay', { order, p: productsBySlug.get(order.product_slug), publicKey: cfg.omise.publicKey, qr, error: req.query.error ? String(req.query.error).slice(0, 200) : '' });
    } catch (e) { next(e); }
  });

  app.post('/pay/omise/:id/promptpay', requireUser, limit.checkout, requireCsrf, async (req, res, next) => {
    try {
      const order = payableOrder(req, res);
      if (!order) return;
      reopen.run(order.id);
      const ch = await provider.createPromptPay({ order, product: productsBySlug.get(order.product_slug), cfg });
      if (Number(ch.amount) !== order.amount) throw new Error('ยอด charge ไม่ตรงกับคำสั่งซื้อ');
      q.setRefOnly.run(ch.id, order.id);
      res.redirect(303, `/pay/omise/${order.id}?method=promptpay`);
    } catch (e) {
      if (e && e.name === 'OmiseApiError') return res.redirect(303, `/pay/omise/${req.params.id}?error=${encodeURIComponent('สร้าง QR ไม่สำเร็จ: ' + e.message)}`);
      next(e);
    }
  });

  // รูป QR: ดึงจาก Omise ด้วย secret key แล้วส่งต่อ (เฉพาะเจ้าของคำสั่งซื้อ)
  app.get('/pay/omise/:id/qr', requireUser, async (req, res, next) => {
    try {
      if (!isOmise()) return notFound(req, res);
      const order = ownOrder(req);
      if (!order || !order.payment_ref) return notFound(req, res);
      const ch = await provider.api(cfg).getCharge(order.payment_ref);
      const uri = ch.source && ch.source.scannable_code && ch.source.scannable_code.image && ch.source.scannable_code.image.download_uri;
      if (!uri || (ch.metadata && ch.metadata.order_id) !== order.id) return notFound(req, res);
      const img = await provider.api(cfg).download(uri);
      res.set({ 'Content-Type': /svg|png|jpeg/.test(img.type) ? img.type : 'image/svg+xml', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      res.send(img.body);
    } catch (e) { next(e); }
  });

  // บัตร: รับเฉพาะโทเคนจาก Omise.js แล้วสร้าง charge ฝั่งเซิร์ฟเวอร์ · ต้องยืนยัน 3DS → ส่งไปหน้าธนาคาร
  app.post('/pay/omise/:id/card', requireUser, limit.checkout, requireCsrf, async (req, res, next) => {
    try {
      const order = payableOrder(req, res);
      if (!order) return;
      reopen.run(order.id);
      const ch = await provider.createCardCharge({ order, product: productsBySlug.get(order.product_slug), cfg, token: String(req.body.omiseToken || '') });
      q.setRefOnly.run(ch.id, order.id);
      if (ch.status === 'pending' && ch.authorize_uri && /^https:\/\/[a-z0-9.-]*omise\.co\//.test(ch.authorize_uri)) return res.redirect(303, ch.authorize_uri);
      // ยืนยันผลด้วยการดึง charge จาก Omise อีกครั้ง (ไม่เชื่อผลจากคำขอนี้อย่างเดียว)
      applyAndNotify(await provider.syncCharge({ chargeId: ch.id, cfg, reason: 'card' }), 'card');
      const now2 = q.getOrder.get(order.id);
      if (now2.status === 'paid') return res.redirect(303, `/order/${order.id}`);
      res.redirect(303, `/pay/omise/${order.id}?error=${encodeURIComponent('จ่ายด้วยบัตรไม่สำเร็จ: ' + (ch.failure_message || 'ลองบัตรอื่นหรือ PromptPay'))}`);
    } catch (e) {
      if (e && e.name === 'OmiseApiError') return res.redirect(303, `/pay/omise/${req.params.id}?error=${encodeURIComponent('จ่ายด้วยบัตรไม่สำเร็จ: ' + e.message)}`);
      next(e);
    }
  });

  // กลับจากหน้าธนาคาร (3DS): ดึงสถานะจริงจาก Omise เสมอ
  app.get('/pay/omise/:id/return', requireUser, async (req, res, next) => {
    try {
      if (!isOmise()) return notFound(req, res);
      const order = ownOrder(req);
      if (!order) return notFound(req, res);
      if (order.payment_ref && order.status !== 'paid') applyAndNotify(await provider.syncCharge({ chargeId: order.payment_ref, cfg, reason: 'return' }), 'return');
      const o = q.getOrder.get(order.id);
      if (o.status === 'paid') return res.redirect(303, `/order/${o.id}`);
      if (o.status === 'pending') return res.redirect(303, `/order/${o.id}`); // ธนาคารยังยืนยันไม่เสร็จ หน้านั้นรอให้เอง
      res.redirect(303, `/pay/omise/${o.id}?error=${encodeURIComponent('การยืนยันกับธนาคารไม่สำเร็จ กรุณาลองใหม่')}`);
    } catch (e) { next(e); }
  });

  // สำรองกรณี webhook ยังไม่มา (เช่น ยังไม่ได้ตั้ง webhook): ตอนลูกค้ารออยู่ ถามสถานะจาก Omise ทุก ~5 วินาที
  const lastSync = new Map();
  async function maybeSync(order) {
    if (!isOmise() || order.status !== 'pending' || !order.payment_ref) return order;
    const t = now();
    if (t - (lastSync.get(order.id) || 0) < 5000) return order;
    lastSync.set(order.id, t);
    if (lastSync.size > 5000) lastSync.clear();
    try { applyAndNotify(await provider.syncCharge({ chargeId: order.payment_ref, cfg, reason: 'poll' }), 'poll'); } catch (e) { log(`[payment] ถามสถานะไม่สำเร็จ: ${e.message}`); }
    return q.getOrder.get(order.id);
  }

  // ---------- โอนเงินเอง (PAYMENT_PROVIDER=manual) ----------
  // ลูกค้ากด "ยืนยันการโอนเงิน" ได้แค่เปลี่ยนเป็น "รอตรวจสอบ" · สินค้าเข้าคลังเมื่อแอดมินอนุมัติเท่านั้น
  const isManual = () => provider.name === 'manual';
  const PAYREF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ไม่มี 0/O/1/I กันอ่านผิด
  function newPayRef() {
    let r = '';
    for (let i = 0; i < 6; i++) r += PAYREF_CHARS[crypto.randomInt(PAYREF_CHARS.length)];
    return 'AW-' + r;
  }
  // ยอดโอน: ค่าเริ่มต้น = ราคาเป๊ะ (สแกนแล้วขึ้นยอดตามราคา) · ถ้าเปิด MANUAL_UNIQUE_SATANG=1 จะบวกเศษสตางค์ 1–99 ที่ไม่ซ้ำกับออเดอร์ที่ยังเปิดอยู่
  const amountTaken = db.prepare("SELECT 1 FROM orders WHERE transfer_amount = ? AND provider = 'manual' AND status IN ('pending','review','rejected') LIMIT 1");
  const insertManualTx = db.transaction((order) => {
    let amount = order.amount;
    if (cfg.transfer.uniqueSatang) {
      amount = 0;
      for (let i = 0; i < 99 && !amount; i++) {
        const cand = order.amount + 1 + crypto.randomInt(99);
        if (!amountTaken.get(cand)) amount = cand;
      }
      if (!amount) for (let n = 1; n <= 99 && !amount; n++) if (!amountTaken.get(order.amount + n)) amount = order.amount + n;
      if (!amount) return false;
    }
    for (let i = 0; i < 40; i++) {
      try { q.insertOrder.run({ ...order, transfer_amount: amount, pay_ref: newPayRef() }); return true; } catch (e) {
        if (!/UNIQUE/i.test(String((e && e.code) || '') + String(e && e.message))) throw e; // รหัสอ้างอิงซ้ำ → สุ่มใหม่
      }
    }
    return false;
  });
  const insertManualOrder = (order) => insertManualTx(order);
  const audit = (orderId, actor, action, detail) => q.audit.run(orderId, actor ? actor.id : null, actor ? actor.email : null, action, detail || null, now());
  // ออเดอร์ที่ไม่โอน/ถูกปฏิเสธแล้วเงียบ เกิน MANUAL_EXPIRE_HOURS → หมดอายุ (ยอดโอนว่างให้ออเดอร์ใหม่)
  function expireStale() {
    if (!isManual()) return;
    const cutoff = now() - cfg.transfer.expireHours * HOUR;
    const ids = q.staleTransfers.all(cutoff, cutoff);
    if (!ids.length) return;
    db.transaction(() => { for (const { id } of ids) if (q.expireTransfer.run(id).changes) audit(id, null, 'expire', `เกิน ${cfg.transfer.expireHours} ชั่วโมง`); })();
  }
  if (isManual()) { const t = setInterval(() => { try { expireStale(); } catch (e) { log(`[manual] ${e.message}`); } }, MIN_MS); if (t.unref) t.unref(); }

  function transferOrder(req, res) {
    if (!isManual()) { notFound(req, res); return null; }
    expireStale();
    const order = ownOrder(req);
    if (!order || order.provider !== 'manual') { notFound(req, res, 'ไม่พบคำสั่งซื้อนี้ในบัญชีของคุณ'); return null; }
    return order;
  }
  const notifyAdmin = (subject, text) => (cfg.adminEmail ? mailer.send({ to: cfg.adminEmail, subject, text }).catch((e) => log(`[mail] ส่งหาแอดมินไม่สำเร็จ: ${e.message}`)) : null);

  app.get('/pay/transfer/:id', requireUser, (req, res) => {
    const order = transferOrder(req, res);
    if (!order) return;
    res.set('Cache-Control', 'no-store');
    if (order.status !== 'pending' && order.status !== 'rejected') return res.redirect(303, `/order/${order.id}`);
    send(req, res, 'transferPay', { order, p: productsBySlug.get(order.product_slug), expiresAt: (order.status === 'rejected' ? order.reviewed_at : order.created_at) + cfg.transfer.expireHours * HOUR, error: req.query.error ? String(req.query.error).slice(0, 200) : '' });
  });

  // รูป QR PromptPay (สร้างในเซิร์ฟเวอร์ ยอดตรงกับออเดอร์ · เฉพาะเจ้าของออเดอร์)
  app.get('/pay/transfer/:id/qr', requireUser, async (req, res, next) => {
    try {
      const order = transferOrder(req, res);
      if (!order) return;
      if (!cfg.transfer.promptpayId || !['pending', 'rejected'].includes(order.status)) return notFound(req, res);
      res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      res.send(await require('./promptpay').svg(cfg.transfer.promptpayId, order.transfer_amount));
    } catch (e) { next(e); }
  });

  app.post('/pay/transfer/:id/confirm', requireUser, limit.confirm, requireCsrf, (req, res, next) => {
    try {
      const order = transferOrder(req, res);
      if (!order) return;
      if (order.status === 'review' || order.status === 'paid') return res.redirect(303, `/order/${order.id}`);
      // หน้าชำระเงินมีแค่ QR + ปุ่มยืนยัน (ไม่ต้องกรอกอะไร) · ร้านใช้ "เวลาที่กดยืนยัน" จับคู่กับรายการในแอปธนาคาร
      const tt = String(req.body.transfer_time || '');
      const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(tt) ? tt : '';
      const ok = db.transaction(() => {
        const r = q.confirmTransfer.run(now(), time, order.id, req.user.id, cfg.transfer.maxConfirms);
        if (r.changes !== 1) return false;
        audit(order.id, req.user, 'customer_confirm', time ? `ลูกค้าแจ้งโอนเวลา ${time}` : 'ลูกค้าแจ้งโอน');
        return true;
      })();
      if (!ok) {
        const msg = order.status === 'expired' ? 'ออเดอร์นี้หมดอายุแล้ว สั่งซื้อใหม่ได้จากหน้าสินค้า' : order.confirm_count >= cfg.transfer.maxConfirms ? 'แจ้งโอนครบจำนวนครั้งแล้ว กรุณาติดต่อร้านพร้อมรหัสอ้างอิง' : 'ทำรายการไม่สำเร็จ';
        return send(req, res, 'message', { title: 'แจ้งโอนไม่ได้', text: msg, action: { href: `/order/${order.id}`, label: 'ดูสถานะ' } }, 400);
      }
      const fresh = q.getOrder.get(order.id);
      const p = productsBySlug.get(fresh.product_slug);
      mailer.send({ to: fresh.email, subject: `รับแจ้งโอนเงินแล้ว รอตรวจสอบ – ${cfg.shopName}`, text: views.transferReceivedEmail({ cfg, order: fresh, p }) }).catch((e) => log(`[mail] ${e.message}`));
      notifyAdmin(`มีรายการรอตรวจสอบการโอน ${views.baht(fresh.transfer_amount)} (${fresh.pay_ref})`, views.adminTransferEmail({ cfg, order: fresh, p }));
      res.redirect(303, `/order/${order.id}`);
    } catch (e) { next(e); }
  });

  // ---------- สถานะคำสั่งซื้อ ----------
  app.get('/order/:id', requireUser, (req, res) => {
    if (isManual()) expireStale();
    const order = ownOrder(req);
    if (!order) return notFound(req, res, 'ไม่พบคำสั่งซื้อนี้ในบัญชีของคุณ');
    res.set('Cache-Control', 'no-store');
    send(req, res, 'orderStatus', { order, p: productsBySlug.get(order.product_slug) });
  });

  app.get('/order/:id/status', async (req, res, next) => {
    try {
      if (isManual()) expireStale();
      let order = ownOrder(req);
      res.set('Cache-Control', 'no-store');
      if (!order) return res.status(404).json({ error: 'not found' });
      order = await maybeSync(order);
      res.json({ status: order.status });
    } catch (e) { next(e); }
  });

  // ---------- คลัง ----------
  function downloadsLeft(userId) {
    const used = q.downloadsSince.get(userId, now() - DAY_MS).n;
    return Math.max(0, cfg.dailyDownloadLimit - used);
  }

  // หน้าบัญชี (แท็บ "บัญชี" บนมือถือ)
  app.get('/account', (req, res) => {
    res.set('Cache-Control', 'no-store');
    send(req, res, 'account', { items: req.user ? q.libraryOrders.all(req.user.id).length : 0 });
  });

  app.get('/library', requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (isManual()) expireStale();
    // ออเดอร์ที่ยังไม่เสร็จ (รอโอน / รอร้านตรวจ / ร้านยังไม่พบยอด) ให้ลูกค้ากลับไปทำต่อได้จากคลัง
    const open = q.openOrders.all(req.user.id)
      .map((o) => ({ order: o, p: productsBySlug.get(o.product_slug) }))
      .filter((x) => x.p);
    const items = q.libraryOrders.all(req.user.id)
      .map((o) => ({ order: o, p: productsBySlug.get(o.product_slug) }))
      .filter((x) => x.p);
    send(req, res, 'library', { items, open, customs: customizer.byUser(req.user.id), fonts: customizer.fontsFor(req.user.id), limits: customizer.limits(req.user.id) });
  });

  // ---------- ปรับแต่งแอนิเมชัน (เวอร์ชันของฉัน) ----------
  function ownCustom(req) {
    const job = customizer.get(String(req.params.id || ''));
    return job && req.user && job.user_id === req.user.id ? job : null;
  }

  app.get('/library/custom/:id', requireUser, (req, res) => {
    const job = ownCustom(req);
    if (!job) return notFound(req, res, 'ไม่พบเวอร์ชันนี้ในคลังของคุณ');
    res.set('Cache-Control', 'no-store');
    send(req, res, 'customStatus', { job, p: productsBySlug.get(job.product_slug), position: customizer.queuePosition(job), fonts: customizer.fontsFor(req.user.id), browserMode, save: req.query.save === '1' });
  });

  app.get('/library/custom/:id/status', (req, res) => {
    const job = ownCustom(req);
    res.set('Cache-Control', 'no-store');
    if (!job) return res.status(404).json({ error: 'not found' });
    res.json({ status: job.status, progress: job.progress, stage: job.stage, position: customizer.queuePosition(job) });
  });

  // ---------- โหมดเบราว์เซอร์: เบราว์เซอร์ลูกค้าเรนเดอร์เอง ร้านส่งแค่ "สูตร" ----------
  const RENDER_SIZES = { vertical: { w: 1080, h: 1920 }, horizontal: { w: 1920, h: 1080 } };
  const SINGLE_FMT = { mp4_green: { ext: 'mp4', mime: 'video/mp4' }, mp4_black: { ext: 'mp4', mime: 'video/mp4' }, prores4444: { ext: 'mov', mime: 'video/quicktime' }, webm_alpha: { ext: 'webm', mime: 'video/webm' } };
  const fontSpec = (userId, fontId) => {
    const f = customizer.fontsFor(userId).find((x) => x.id === fontId);
    if (!f) return null;
    const ext = String(f.user ? (customizer.userFonts.get(f.rowId, userId) || {}).format || 'ttf' : path.extname(f.url).slice(1) || 'ttf');
    return { url: f.url, weight: f.weight || 400, mime: `font/${ext}`, label: f.label };
  };
  function customSpec(job, userId) {
    const ed = editors[job.editor] || {};
    const p = productsBySlug.get(job.product_slug);
    const format = job.filetype === 'alt' && ed.alt ? ed.alt : ed.single;
    const fmt = SINGLE_FMT[format];
    const font = fontSpec(userId, job.font);
    if (!fmt || !font) return null;
    const friendly = `${job.text} - ${ed.label || job.editor} - ${job.size === 'horizontal' ? 'แนวนอน' : 'แนวตั้ง'} ${job.seconds}วิ.${fmt.ext}`.replace(/[\\/:*?"<>|]/g, ' ');
    return {
      id: job.id, text: job.text, fill: job.fill, stroke: job.stroke, strokeRatio: custom.OUTLINES[job.outline] || 0, shadow: Boolean(job.shadow),
      motion: (p && p.motion) || 'pop', size: RENDER_SIZES[job.size] || RENDER_SIZES.vertical, seconds: Number(job.seconds) || 5, fps: 60,
      format, ext: fmt.ext, mime: fmt.mime, fileName: friendly, font,
    };
  }
  const jsonCsrf = (req, res) => {
    if (!auth.safeEqual(req.get('x-csrf-token'), req.csrf)) { res.status(403).json({ error: 'หมดเวลาแบบฟอร์ม กรุณาโหลดหน้าใหม่' }); return false; }
    return true;
  };

  // สูตรเรนเดอร์ (เจ้าของเท่านั้น) · ?download=1 = ทำไฟล์ซ้ำเพื่อดาวน์โหลด (นับโควตาดาวน์โหลดต่อวันเหมือนไฟล์อื่น)
  app.get('/library/custom/:id/spec', requireUser, limit.download, (req, res) => {
    res.set('Cache-Control', 'no-store');
    let job = ownCustom(req);
    if (!job) return res.status(404).json({ error: 'ไม่พบเวอร์ชันนี้ในคลังของคุณ' });
    if (!browserMode) return res.status(409).json({ error: 'ร้านนี้เรนเดอร์บนเครื่องร้าน' });
    if (req.query.download === '1') {
      if (job.status !== 'done') return res.status(409).json({ error: 'เวอร์ชันนี้ยังสร้างไม่เสร็จ' });
      if (downloadsLeft(req.user.id) <= 0) return res.status(429).json({ error: `วันนี้ดาวน์โหลดครบ ${cfg.dailyDownloadLimit} ครั้งแล้ว กลับมาโหลดได้อีกครั้งพรุ่งนี้` });
      const one = customizer.fileOf(job);
      q.logDownload.run(req.user.id, job.order_id, one ? one.file : `${job.id}`, job.editor, now());
    } else if (job.status === 'queued' || job.status === 'rendering' || job.status === 'failed') {
      job = customizer.browserStart(job.status === 'failed' ? { ...job, status: 'x' } : job);
    } else {
      return res.status(409).json({ error: 'เวอร์ชันนี้สร้างเสร็จแล้ว' });
    }
    const spec = customSpec(job, req.user.id);
    if (!spec) return res.status(400).json({ error: 'ไม่พบฟอนต์หรือชนิดไฟล์ของเวอร์ชันนี้ (ฟอนต์อาจถูกลบไปแล้ว)' });
    res.json(spec);
  });

  app.post('/library/custom/:id/finished', requireUser, express.json({ limit: '4kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!jsonCsrf(req, res)) return;
    const job = ownCustom(req);
    if (!job || !browserMode) return res.status(404).json({ error: 'ไม่พบเวอร์ชันนี้' });
    const spec = customSpec(job, req.user.id);
    if (job.status !== 'done' && spec) customizer.browserDone(job, { codec: spec.format, ext: spec.ext, bytes: (req.body || {}).bytes, ms: (req.body || {}).ms });
    res.json({ ok: true });
  });

  app.post('/library/custom/:id/failed', requireUser, express.json({ limit: '4kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!jsonCsrf(req, res)) return;
    const job = ownCustom(req);
    if (!job || !browserMode) return res.status(404).json({ error: 'ไม่พบเวอร์ชันนี้' });
    log(`[custom] เบราว์เซอร์ลูกค้าเรนเดอร์ไม่สำเร็จ ${job.id}: ${String((req.body || {}).error || '').slice(0, 200)}`);
    customizer.browserFail(job, 'เบราว์เซอร์นี้สร้างไฟล์ไม่สำเร็จ ลองใหม่ หรือเปิดด้วย Chrome บนคอมพิวเตอร์');
    res.json({ ok: true });
  });

  // ปุ่มดาวน์โหลดเดียว: ไฟล์วิดีโอไฟล์เดียวของเวอร์ชันนี้
  app.get('/library/custom/:id/download', requireUser, limit.download, (req, res) => {
    if (browserMode) return res.redirect(303, `/library/custom/${encodeURIComponent(req.params.id)}?save=1`);
    const job = ownCustom(req);
    const file = job && job.status === 'done' && customizer.fileOf(job);
    if (!file) return notFound(req, res, 'ไฟล์ยังไม่พร้อม หรือไม่พบเวอร์ชันนี้ในคลังของคุณ');
    if (downloadsLeft(req.user.id) <= 0) {
      return send(req, res, 'message', {
        title: 'วันนี้ดาวน์โหลดครบจำนวนแล้ว',
        text: `บัญชีหนึ่งดาวน์โหลดได้ ${cfg.dailyDownloadLimit} ครั้งต่อ 24 ชั่วโมง ไฟล์ยังอยู่ในคลังของคุณ กลับมาโหลดได้อีกครั้งพรุ่งนี้`,
        action: { href: '/library', label: 'กลับไปที่คลัง' },
      }, 429);
    }
    q.logDownload.run(req.user.id, job.order_id, file.file, job.editor, now());
    const exp = Math.floor((now() + cfg.linkMinutes * MIN_MS) / 1000);
    const sig = links.sign(cfg.downloadSecret, `custom:${job.id}`, exp);
    res.set('Cache-Control', 'no-store');
    res.redirect(303, `/c/${job.id}/f/${encodeURIComponent(file.file)}?e=${exp}&s=${sig}`);
  });

  app.post('/library/custom/:id/delete', requireUser, requireCsrf, (req, res) => {
    const job = ownCustom(req);
    if (!job) return notFound(req, res);
    customizer.remove(job.id, req.user.id);
    res.redirect(303, `/library/${job.order_id}/customize`);
  });

  // ไฟล์ที่ปรับแต่งแล้ว: ลิงก์ที่เซ็นแล้วเท่านั้น (ลายเซ็นแยกประเภทจากไฟล์สินค้า ใช้แทนกันไม่ได้)
  app.get('/c/:id/f/:file', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    const v = links.verify(cfg.downloadSecret, `custom:${req.params.id}`, String(req.query.e || ''), String(req.query.s || ''), Math.floor(now() / 1000));
    if (v === 'bad') return send(req, res, 'message', { title: 'ลิงก์ไม่ถูกต้อง', text: 'กรุณากดดาวน์โหลดจากคลังของคุณอีกครั้ง', action: { href: '/library', label: 'ไปที่คลัง' } }, 403);
    if (v === 'expired') return send(req, res, 'message', { title: 'ลิงก์หมดอายุแล้ว', text: 'กดดาวน์โหลดจากคลังอีกครั้งได้เลย ไฟล์ยังอยู่ในคลังของคุณ', action: { href: '/library', label: 'ไปที่คลัง' } }, 410);
    const job = customizer.get(req.params.id);
    const file = job && job.status === 'done' && JSON.parse(job.files_json || '[]').find((f) => f.file === req.params.file);
    if (!file) return notFound(req, res, 'ไม่พบไฟล์');
    const ed = editors[job.editor] || { label: job.editor };
    const friendly = file.format === 'single'
      ? `${job.text} - ${ed.label} - ${job.size === 'horizontal' ? 'แนวนอน' : 'แนวตั้ง'} ${job.seconds}วิ${path.extname(file.file)}`.replace(/[\\/:*?"<>|]/g, ' ')
      : file.file;
    res.download(path.join(customizer.outDir(job.id), path.basename(file.file)), friendly, { headers: { 'Cache-Control': 'no-store' } }, (err) => { if (err && !res.headersSent) next(err); });
  });

  function libraryItem(req, res) {
    const order = ownOrder(req);
    if (!order || order.status !== 'paid') { notFound(req, res, 'ไม่พบรายการนี้ในคลังของคุณ'); return null; }
    const p = productsBySlug.get(order.product_slug);
    if (!p) { notFound(req, res); return null; }
    return { order, p };
  }

  function pickEditor(req) {
    const e = String(req.query.editor || '');
    if (editors[e]) return e;
    return editors[req.user.editor] ? req.user.editor : 'capcut_mobile';
  }

  // ค่าเริ่มต้นของฟอร์มปรับแต่ง: สไตล์ที่เลือก → เวอร์ชันเดิม → ค่าที่ใช้ล่าสุด → ค่าของสินค้า
  function customizeDefaults(req, p, editorId) {
    const base = {
      text: p.manifest.text, font: cfg.fonts[0] ? cfg.fonts[0].id : 'kanit',
      fill: String(p.manifest.fill || '#ffd400').toLowerCase(), stroke: String(p.manifest.stroke || '#111111').toLowerCase(),
      outline: 'medium', shadow: false, editor: editorId, size: 'vertical', seconds: 5, filetype: 'main',
    };
    const pick = (src) => ({
      text: src.text, font: src.font, fill: src.fill, stroke: src.stroke, outline: src.outline, shadow: Boolean(src.shadow),
      ...(src.size ? { size: src.size } : {}), ...(src.seconds ? { seconds: Number(src.seconds) } : {}), ...(src.filetype ? { filetype: src.filetype } : {}),
    });
    const look = (src) => ({ font: src.font, fill: src.fill, stroke: src.stroke, outline: src.outline, shadow: Boolean(src.shadow) });
    const withFont = (v) => (req.query.font ? { ...v, font: String(req.query.font) } : v); // เพิ่งอัปโหลดฟอนต์ → เลือกให้เลย
    let last = null;
    try { last = req.user.last_custom ? JSON.parse(req.user.last_custom) : null; } catch { last = null; }
    // สไตล์ = หน้าตาอย่างเดียว ข้อความใช้ของล่าสุด/ของสินค้า
    const styleId = req.query.style || req.query.preset;
    const style = styleId ? customizer.presets.get(styleId, req.user.id) : null;
    if (style) return { value: withFont({ ...base, ...(last ? pick(last) : {}), ...look(style), editor: editorId }), preset: style };
    // "ทำอีกแบบจากเวอร์ชันนี้": เริ่มจากค่าของเวอร์ชันเดิม (ของตัวเองเท่านั้น)
    const from = req.query.from ? customizer.get(String(req.query.from)) : null;
    if (from && from.user_id === req.user.id) return { value: withFont({ ...base, ...pick(from), editor: from.editor in editors ? from.editor : editorId }), preset: null };
    return { value: withFont(last ? { ...base, ...last, editor: editorId } : base), preset: null };
  }

  function customizePage(req, res, it, extra = {}, status = 200) {
    const editorId = extra.editorId || pickEditor(req);
    const d = customizeDefaults(req, it.p, editorId);
    const fonts = customizer.fontsFor(req.user.id);
    const form = extra.form || d.value;
    if (!fonts.some((f) => f.id === form.font)) form.font = fonts[0] ? fonts[0].id : 'kanit'; // ฟอนต์ในพรีเซ็ตถูกลบไปแล้ว
    send(req, res, 'customize', {
      ...it, editorId, versions: customizer.byUserOrder(req.user.id, it.order.id), limits: customizer.limits(req.user.id),
      tools: tools(), fonts, presets: customizer.presets.list(req.user.id), preset: extra.preset !== undefined ? extra.preset : d.preset,
      last: (() => { try { return req.user.last_custom ? JSON.parse(req.user.last_custom) : null; } catch { return null; } })(),
      ...extra, form,
    }, status);
  }

  app.get('/library/:orderId/customize', requireUser, (req, res) => {
    const it = libraryItem(req, res);
    if (!it) return;
    res.set('Cache-Control', 'no-store');
    customizePage(req, res, it);
  });

  app.post('/library/:orderId/customize', requireUser, limit.render, requireCsrf, (req, res) => {
    const it = libraryItem(req, res);
    if (!it) return;
    const fonts = customizer.fontsFor(req.user.id);
    const { error, value } = custom.validateRequest(req.body, { fonts, editors });
    const again = (status, err) => customizePage(req, res, it, {
      editorId: editors[value.editor] ? value.editor : pickEditor(req), form: value, error: err, preset: null,
    }, status);
    if (error) return again(400, error);

    customizer.rememberLast(req.user.id, value);
    if (!tools().ok) return again(503, 'ตอนนี้เครื่องเซิร์ฟเวอร์ยังเรนเดอร์ไม่ได้ กรุณาลองใหม่ภายหลัง');
    const lim = customizer.limits(req.user.id);
    if (lim.active >= lim.maxActive) return again(429, 'มีงานที่กำลังสร้างอยู่ รอให้เสร็จก่อนแล้วค่อยสั่งงานใหม่ (ระหว่างรอ บันทึกสไตล์ไว้ได้)');
    if (lim.maxPerDay > 0 && lim.today >= lim.maxPerDay) return again(429, `วันนี้สร้างเวอร์ชันใหม่ครบ ${lim.maxPerDay} ครั้งแล้ว`);
    if (lim.usedBytes >= lim.quotaBytes) return again(429, 'พื้นที่เก็บเวอร์ชันของคุณเต็มแล้ว ลบเวอร์ชันเก่าที่ไม่ใช้ในคลังก่อน แล้วสร้างใหม่ได้ทันที');
    q.setEditor.run(value.editor, req.user.id);
    const job = customizer.enqueue({ id: crypto.randomBytes(12).toString('hex'), user: req.user, order: it.order, value });
    res.redirect(303, `/library/custom/${job.id}`);
  });

  // ---------- สไตล์ของฉัน (ฟอนต์ + สี + ขอบ + เงา ที่บันทึกไว้ใช้ซ้ำ) ----------
  // หน้าปรับแต่งเรียกผ่าน fetch (JSON) เพื่อไม่ต้องโหลดหน้าใหม่ · CSRF ส่งใน header x-csrf-token หรือในฟอร์ม
  const csrfAny = (req) => auth.safeEqual(req.get('x-csrf-token') || (req.body && req.body.csrf), req.csrf);
  const wantsJson = (req) => /json/.test(req.get('accept') || '') || Boolean(req.get('x-csrf-token'));

  app.get(['/library/styles', '/library/presets'], requireUser, (req, res) => {
    if (req.path === '/library/presets') return res.redirect(301, '/library/styles');
    res.set('Cache-Control', 'no-store');
    send(req, res, 'presetsPage', { presets: customizer.presets.list(req.user.id), fonts: customizer.fontsFor(req.user.id), items: q.libraryOrders.all(req.user.id) });
  });

  app.post('/library/styles', requireUser, limit.styles, express.json({ limit: '4kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!csrfAny(req)) return res.status(403).json({ error: 'หมดเวลาแบบฟอร์ม กรุณาโหลดหน้าใหม่' });
    const { error, value } = custom.validateStyle(req.body || {}, { fonts: customizer.fontsFor(req.user.id) });
    if (error) return res.status(400).json({ error });
    if (customizer.presets.count(req.user.id) >= 200) return res.status(429).json({ error: 'บันทึกสไตล์ได้สูงสุด 200 แบบ ลบแบบที่ไม่ใช้ก่อน' });
    const name = value.name || `สไตล์ ${customizer.presets.count(req.user.id) + 1}`;
    const id = customizer.presets.create(req.user.id, name, value);
    res.json({ ok: true, id, name, style: { font: value.font, fill: value.fill, stroke: value.stroke, outline: value.outline, shadow: value.shadow } });
  });

  app.post('/library/styles/:id/rename', requireUser, (req, res) => {
    if (!csrfAny(req)) return send(req, res, 'message', { title: 'หมดเวลาแบบฟอร์ม', text: 'กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง' }, 403);
    const name = custom.cleanText(req.body.name).slice(0, 40);
    if (!name || !customizer.presets.rename(req.params.id, req.user.id, name)) return notFound(req, res, 'ไม่พบสไตล์นี้');
    res.redirect(303, '/library/styles');
  });

  app.post('/library/styles/:id/delete', requireUser, (req, res) => {
    if (!csrfAny(req)) return wantsJson(req) ? res.status(403).json({ error: 'หมดเวลาแบบฟอร์ม' }) : send(req, res, 'message', { title: 'หมดเวลาแบบฟอร์ม', text: '' }, 403);
    const ok = customizer.presets.remove(req.params.id, req.user.id);
    if (wantsJson(req)) return ok ? res.json({ ok: true }) : res.status(404).json({ error: 'ไม่พบสไตล์นี้' });
    if (!ok) return notFound(req, res, 'ไม่พบสไตล์นี้');
    res.redirect(303, '/library/styles');
  });

  // ---------- ฟอนต์ของฉัน (อัปโหลดเอง) ----------
  app.get('/library/fonts', requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store');
    send(req, res, 'fontsPage', { fonts: customizer.userFonts.list(req.user.id), max: cfg.userFontMax });
  });

  // อัปโหลดเป็นไฟล์ดิบ (application/octet-stream) จากสคริปต์ในหน้า ต้องมี CSRF ใน header และยืนยันสิทธิ์ใช้ฟอนต์
  app.post('/library/fonts', limit.fontUpload, express.raw({ type: 'application/octet-stream', limit: '5mb' }), async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    if (!auth.safeEqual(req.get('x-csrf-token'), req.csrf)) return res.status(403).json({ error: 'หมดเวลาแบบฟอร์ม กรุณาโหลดหน้าใหม่' });
    if (req.get('x-font-rights') !== 'yes') return res.status(400).json({ error: 'กรุณายืนยันว่าคุณมีสิทธิ์ใช้ฟอนต์นี้เชิงพาณิชย์' });
    try {
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      // บน Netlify คำขอรับได้ราว 4.5 MB (ไฟล์ถูกแปลงเป็น base64 ระหว่างทาง)
      if (cfg.serverless && buf.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'ไฟล์ฟอนต์ใหญ่เกิน 4 MB' });
      const f = customizer.userFonts.add(req.user.id, buf);
      if (storage.driver === 'supabase') {
        // เก็บถาวรบน Supabase (ดิสก์ของ Netlify หายทุกครั้งที่ฟังก์ชันเริ่มใหม่)
        const row = customizer.userFonts.get(f.id, req.user.id);
        await storage.put(customizer.userFonts.key(row), buf, `font/${row.format}`);
      }
      log('[fonts] ลูกค้าอัปโหลดฟอนต์');
      const latest = q.libraryOrders.all(req.user.id)[0];
      res.json({
        ok: true, id: f.id, fontId: `u-${f.id}`, name: f.name, thai: f.thai, format: f.format, chars: f.chars,
        url: `/library/fonts/${f.id}/file`, customizeUrl: latest ? `/library/${latest.id}/customize?font=u-${f.id}` : null,
      });
    } catch (e) {
      if (e.name === 'FontError') return res.status(400).json({ error: e.message });
      next(e);
    }
  });

  // ส่งไฟล์ฟอนต์ให้เจ้าของเท่านั้น (ใช้แสดงตัวอย่าง) คนอื่นตอบเหมือนไม่มี
  app.get('/library/fonts/:id/file', requireUser, async (req, res, next) => {
    const row = customizer.userFonts.get(req.params.id, req.user.id);
    if (!row) return res.status(404).end();
    res.set({ 'Content-Type': `font/${row.format}`, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff' });
    if (storage.driver === 'supabase' && !fs.existsSync(customizer.userFonts.path(row))) {
      try { return res.send(await storage.get(customizer.userFonts.key(row))); } catch (e) { return next(e); }
    }
    res.sendFile(customizer.userFonts.path(row));
  });

  app.post('/library/fonts/:id/delete', requireUser, requireCsrf, (req, res) => {
    const row = customizer.userFonts.get(req.params.id, req.user.id);
    if (!customizer.userFonts.remove(req.params.id, req.user.id)) return notFound(req, res, 'ไม่พบฟอนต์นี้');
    if (storage.driver === 'supabase') storage.remove(customizer.userFonts.key(row)).catch((e) => log(`[fonts] ลบไฟล์บน Supabase ไม่สำเร็จ: ${e.message}`));
    res.redirect(303, '/library/fonts');
  });

  // ---------- ซับอัตโนมัติ: อัปคลิป → ถอดเสียง → แก้คำ → เบิร์นซับด้วยแบบในคลัง ----------
  const ownedItems = (userId) => q.libraryOrders.all(userId).map((o) => ({ order: o, p: productsBySlug.get(o.product_slug) })).filter((x) => x.p);
  const subFonts = (userId) => customizer.fontsFor(userId).filter((f) => !f.user || f.thai !== 'none');
  function ownSub(req) {
    const job = subtitles.get(req.params.id);
    return job && req.user && job.user_id === req.user.id && job.status !== 'expired' ? job : null;
  }
  // หน้าตาเริ่มต้น: ค่าที่ใช้ล่าสุดตอนปรับแต่ง ไม่งั้นสีของแบบนั้นในร้าน
  function defaultStyle(user, item) {
    let last = {};
    try { last = JSON.parse(user.last_custom || '{}') || {}; } catch { last = {}; }
    const mf = item.p.manifest || {};
    return {
      order: item.order.id, font: last.font || 'kanit', fill: (last.fill || mf.fill || '#ffffff').toLowerCase(), stroke: (last.stroke || mf.stroke || '#111111').toLowerCase(),
      outline: last.outline || 'medium', shadow: last.shadow !== undefined ? Boolean(last.shadow) : true, size: 'md', position: 'bottom',
    };
  }

  app.get('/subtitles', requireUser, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    await subCheck();
    send(req, res, 'subtitlesHome', {
      owned: ownedItems(req.user.id), jobs: subtitles.byUser(req.user.id), limits: subtitles.limits(req.user.id),
      ready: { ok: subReady.ok && tools().ok }, now: now(), picked: String(req.query.style || ''), browserMode,
    });
  });

  // อัปโหลดเป็นไฟล์ดิบแบบสตรีม (ไม่เก็บทั้งไฟล์ในหน่วยความจำ) · CSRF และแบบที่เลือกส่งมาใน header
  app.post('/subtitles/upload', limit.subUpload, async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const fail = (status, error) => { req.resume(); return res.status(status).set('Connection', 'close').json({ error }); };
    try {
      if (!req.user) return fail(401, 'กรุณาเข้าสู่ระบบ');
      if (!auth.safeEqual(req.get('x-csrf-token'), req.csrf)) return fail(403, 'หมดเวลาแบบฟอร์ม กรุณาโหลดหน้าใหม่');
      const S = cfg.subtitles;
      if (!(await subCheck()).ok || !tools().ok) return fail(503, 'ระบบใส่ซับยังไม่พร้อมใช้งาน ลองใหม่ภายหลัง');
      const lim = subtitles.limits(req.user.id);
      if (lim.active > 0) return fail(409, 'มีคลิปที่กำลังทำอยู่ รอให้เสร็จก่อนแล้วค่อยอัปคลิปใหม่');
      if (lim.maxPerDay > 0 && lim.today >= lim.maxPerDay) return fail(429, `วันนี้อัปครบ ${lim.maxPerDay} คลิปแล้ว อัปเพิ่มได้อีกครั้งพรุ่งนี้`);
      const max = S.maxMb * 1024 * 1024;
      const len = Number(req.get('content-length') || 0);
      if (!len) return fail(411, 'ไม่พบไฟล์คลิป');
      if (len > max) return fail(413, `ไฟล์ใหญ่เกิน ${S.maxMb} MB ลองส่งออกคลิปเป็น 1080p แล้วอัปใหม่`);
      const owned = ownedItems(req.user.id).map((x) => x.order);
      const item = ownedItems(req.user.id).find((x) => x.order.id === String(req.get('x-style') || ''));
      if (!item) return fail(400, 'กรุณาเลือกแบบตัวอักษรจากคลังของคุณ');
      const st = subtitles.validateStyle(defaultStyle(req.user, item), { owned, fonts: subFonts(req.user.id) });
      const style = st.value || subtitles.validateStyle({ ...defaultStyle(req.user, item), font: 'kanit' }, { owned, fonts: subFonts(req.user.id) }).value;
      let name = '';
      try { name = decodeURIComponent(String(req.get('x-filename') || '')).slice(0, 200); } catch { name = ''; }
      const tmp = path.join(subtitles.tmpDir(), `${crypto.randomBytes(12).toString('hex')}.part`);
      const out = fs.createWriteStream(tmp, { mode: 0o600 });
      let bytes = 0;
      let aborted = false;
      const cleanup = () => { out.destroy(); fs.rmSync(tmp, { force: true }); };
      req.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > max && !aborted) { aborted = true; req.unpipe(out); cleanup(); res.status(413).set('Connection', 'close').json({ error: `ไฟล์ใหญ่เกิน ${S.maxMb} MB` }); }
      });
      req.on('aborted', () => { aborted = true; cleanup(); });
      req.pipe(out);
      out.on('error', (e) => { if (!aborted) { aborted = true; cleanup(); next(e); } });
      out.on('finish', async () => {
        if (aborted) return;
        try {
          const r = await subtitles.receive({ user: req.user, style, tmpFile: tmp, name, bytes, probe: subRender.probe });
          if (r.error) { fs.rmSync(tmp, { force: true }); return res.status(400).json({ error: r.error }); }
          log('[subtitles] ลูกค้าอัปคลิป');
          res.json({ ok: true, url: `/subtitles/${r.job.id}` });
        } catch (e) { fs.rmSync(tmp, { force: true }); next(e); }
      });
    } catch (e) { next(e); }
  });

  // ---------- ซับโหมดเบราว์เซอร์: คลิปอยู่ในเครื่องลูกค้า ร้านรับแค่ข้อมูลคลิป + เสียงพูด (WAV 16 kHz โมโน) ทีละท่อน ----------
  app.post('/subtitles/new', limit.subUpload, express.json({ limit: '8kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    if (!jsonCsrf(req, res)) return;
    if (!browserMode) return res.status(409).json({ error: 'ร้านนี้รับคลิปแบบอัปโหลด' });
    if (!(await subCheck()).ok) return res.status(503).json({ error: 'ระบบใส่ซับยังไม่พร้อมใช้งาน ลองใหม่ภายหลัง' });
    const b = req.body || {};
    const lim = subtitles.limits(req.user.id);
    if (lim.active > 0) return res.status(409).json({ error: 'มีคลิปที่กำลังฟังเสียงอยู่ รอให้เสร็จก่อนแล้วค่อยเริ่มคลิปใหม่' });
    if (lim.maxPerDay > 0 && lim.today >= lim.maxPerDay) return res.status(429).json({ error: `วันนี้ทำครบ ${lim.maxPerDay} คลิปแล้ว ทำเพิ่มได้อีกครั้งพรุ่งนี้` });
    const owned = ownedItems(req.user.id).map((x) => x.order);
    const item = ownedItems(req.user.id).find((x) => x.order.id === String(b.order || ''));
    if (!item) return res.status(400).json({ error: 'กรุณาเลือกแบบตัวอักษรจากคลังของคุณ' });
    const st = subtitles.validateStyle(defaultStyle(req.user, item), { owned, fonts: subFonts(req.user.id) });
    const style = st.value || subtitles.validateStyle({ ...defaultStyle(req.user, item), font: 'kanit' }, { owned, fonts: subFonts(req.user.id) }).value;
    const info = { width: Number(b.width), height: Number(b.height), duration: Number(b.duration), audio: Boolean(b.audio), bytes: Number(b.bytes) || 0 };
    const r = subtitles.createBrowserJob({ user: req.user, style, name: String(b.name || '').slice(0, 200), info });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, id: r.job.id, url: `/subtitles/${r.job.id}` });
  });

  // เสียงท่อนที่ i จาก n (เริ่มที่วินาที start) → Groq ถอดเสียง → เก็บคำ · ท่อนสุดท้าย = ได้บรรทัดซับ
  app.post('/subtitles/:id/audio', limit.subSave, express.raw({ type: ['audio/wav', 'application/octet-stream'], limit: '4500kb' }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    if (!jsonCsrf(req, res)) return;
    const job = ownSub(req);
    if (!job || !job.browser) return res.status(404).json({ error: 'ไม่พบคลิปนี้' });
    const i = Number(req.query.i), n = Number(req.query.n), start = Number(req.query.start);
    if (!(Number.isInteger(i) && Number.isInteger(n) && n >= 1 && n <= 60 && i >= 0 && i < n && start >= 0 && start <= job.duration + 1)) return res.status(400).json({ error: 'ข้อมูลเสียงไม่ถูกต้อง' });
    if (job.status !== 'transcribing') {
      if (i === 0 && !subtitles.restartAsr(job)) return res.status(409).json({ error: 'คลิปนี้ฟังเสียงเสร็จแล้ว' });
      if (i !== 0) return res.status(409).json({ error: 'คลิปนี้ฟังเสียงเสร็จแล้ว' });
    }
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    try { require('./transcribe').parseWav(buf); } catch { return res.status(400).json({ error: 'ไฟล์เสียงไม่ถูกต้อง' }); }
    try {
      const fresh = subtitles.get(job.id);
      const prompt = i > 0 ? JSON.parse(fresh.asr_json || '[]').slice(-40).map((w) => w.text).join('') : '';
      const r = await transcriber.chunk(buf, start, prompt);
      const out = subtitles.asrChunk(subtitles.get(job.id), i, n, r.words);
      res.json({ ok: true, done: out.done, url: `/subtitles/${job.id}` });
    } catch (e) {
      log(`[subtitles] ถอดเสียงไม่สำเร็จ ${job.id}: ${String(e.message).split('\n')[0]}`);
      const msg = e.userMessage || 'ถอดเสียงไม่สำเร็จ ลองใหม่อีกครั้ง';
      subtitles.failAsr(job, msg);
      res.status(e.status === 429 ? 429 : 502).json({ error: msg });
    }
  });

  // เบราว์เซอร์สร้างคลิปพร้อมซับเสร็จ (ไฟล์อยู่ในเครื่องลูกค้า ร้านเก็บแค่ขนาดไฟล์)
  app.post('/subtitles/:id/rendered', requireUser, express.json({ limit: '4kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!jsonCsrf(req, res)) return;
    const job = ownSub(req);
    if (!job || !job.browser) return res.status(404).json({ error: 'ไม่พบคลิปนี้' });
    subtitles.renderedInBrowser(job, (req.body || {}).bytes);
    log('[subtitles] เบราว์เซอร์ลูกค้าสร้างคลิปพร้อมซับเสร็จ');
    res.json({ ok: true });
  });

  // สูตรเบิร์นซับให้เบราว์เซอร์ (ฟอนต์ สี ตำแหน่ง ท่าเคลื่อนไหว บรรทัดซับ)
  function subtitleSpec(job) {
    const R = require('../public/subplan');
    const p = productsBySlug.get(job.product_slug);
    const font = fontSpec(job.user_id, job.font);
    const { w, h } = R.outSize(job.width, job.height, job.browser ? R.MAX_SIDE_BROWSER : R.MAX_SIDE);
    return {
      id: job.id, cues: subtitles.cuesOf(job), motion: (p && p.motion) || 'pop', fill: job.fill, stroke: job.stroke,
      strokeRatio: custom.OUTLINES[job.outline] || 0, shadow: Boolean(job.shadow), size: job.size, position: job.position,
      font, out: { w, h }, layout: R.layoutFor(w, h, { size: job.size, position: job.position }), fps: R.FPS, duration: job.duration,
      fileName: `${(job.src_name || 'clip').replace(/\.[a-z0-9]{2,4}$/i, '')}-ซับ.mp4`.replace(/[\\/:*?"<>|]/g, ' '),
      srcName: job.src_name, srcBytes: job.src_bytes,
    };
  }
  app.get('/subtitles/:id/spec', requireUser, limit.download, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const job = ownSub(req);
    if (!job || !job.browser || !job.cues_json) return res.status(404).json({ error: 'ไม่พบคลิปนี้' });
    if (req.query.download === '1') {
      if (downloadsLeft(req.user.id) <= 0) return res.status(429).json({ error: `วันนี้ดาวน์โหลดครบ ${cfg.dailyDownloadLimit} ครั้งแล้ว` });
      q.logDownload.run(req.user.id, job.order_id, `subtitles:${job.id}`, 'subtitles', now());
    }
    res.json(subtitleSpec(job));
  });

  function subLayout(job) {
    const R = require('../public/subplan');
    const { w, h } = R.outSize(job.width, job.height, job.browser ? R.MAX_SIDE_BROWSER : R.MAX_SIDE);
    const sizes = {};
    for (const k of ['sm', 'md', 'lg']) for (const pos of ['top', 'middle', 'bottom']) sizes[`${k}:${pos}`] = R.layoutFor(w, h, { size: k, position: pos });
    return { w, h, sizes };
  }

  app.get('/subtitles/:id', requireUser, (req, res) => {
    const job = ownSub(req);
    if (!job) return notFound(req, res, 'ไม่พบคลิปนี้ (คลิปถูกลบอัตโนมัติเมื่อครบเวลาเก็บ)');
    res.set('Cache-Control', 'no-store');
    send(req, res, 'subtitleJob', {
      job, cues: subtitles.cuesOf(job), owned: ownedItems(req.user.id), fonts: subFonts(req.user.id),
      layoutInfo: subLayout(job), position: subtitles.position(job), now: now(), save: req.query.save === '1',
    });
  });

  app.get('/subtitles/:id/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const job = ownSub(req);
    if (!job) return res.status(404).json({ error: 'ไม่พบคลิปนี้' });
    res.json({ status: job.status, progress: job.progress, stage: job.stage, position: subtitles.position(job), elapsed: ['transcribing', 'rendering'].includes(job.status) ? Math.max(0, now() - job.updated_at) : 0 });
  });

  // คลื่นเสียงสำหรับไทม์ไลน์ในหน้าแก้ซับ
  app.get('/subtitles/:id/peaks', requireUser, async (req, res) => {
    const job = ownSub(req);
    res.set('Cache-Control', 'private, no-store');
    if (!job) return res.status(404).json({ error: 'ไม่พบคลิปนี้' });
    try {
      const p = await subtitles.peaksOf(job);
      if (!p) return res.status(404).json({ error: 'ไม่มีข้อมูลเสียง' });
      res.json(p);
    } catch (e) {
      log(`[subtitles] อ่านคลื่นเสียงไม่สำเร็จ ${job.id}: ${String(e.message).split('\n')[0]}`);
      res.status(500).json({ error: 'อ่านคลื่นเสียงไม่สำเร็จ' });
    }
  });

  // คลิปต้นฉบับ (ใช้เล่นในหน้าแก้ซับ รองรับเลื่อนเวลาแบบ Range) เจ้าของเท่านั้น
  app.get('/subtitles/:id/source', requireUser, (req, res) => {
    const job = ownSub(req);
    if (!job || !fs.existsSync(subtitles.srcOf(job))) return res.status(404).end();
    const type = { mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', m4v: 'video/mp4' }[job.src_ext] || 'video/mp4';
    res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': type });
    res.sendFile(subtitles.srcOf(job));
  });

  function applyBody(job, body) {
    const owned = ownedItems(job.user_id).map((x) => x.order);
    if (body.style) {
      const st = subtitles.validateStyle(body.style, { owned, fonts: subFonts(job.user_id) });
      if (st.error) return { error: st.error };
      subtitles.setStyle(job, st.value);
    }
    if (body.cues) {
      const r = subtitles.saveCues(job, body.cues);
      if (r.error) return r;
      return { cues: r.cues };
    }
    return { cues: subtitles.cuesOf(job) };
  }

  app.post('/subtitles/:id/save', limit.subSave, express.json({ limit: '512kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    if (!auth.safeEqual(req.get('x-csrf-token'), req.csrf)) return res.status(403).json({ error: 'หมดเวลาแบบฟอร์ม กรุณาโหลดหน้าใหม่' });
    const job = ownSub(req);
    if (!job) return res.status(404).json({ error: 'ไม่พบคลิปนี้' });
    if (!['review', 'failed'].includes(job.status)) return res.status(409).json({ error: 'คลิปนี้กำลังสร้างอยู่ แก้ไม่ได้ตอนนี้' });
    const r = applyBody(job, req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    if (req.query.render === '1') {
      if (!tools().ok) return res.status(503).json({ error: 'ระบบสร้างคลิปยังไม่พร้อม ลองใหม่ภายหลัง' });
      if (!r.cues.length) return res.status(400).json({ error: 'ยังไม่มีข้อความซับ เพิ่มอย่างน้อย 1 บรรทัด' });
      // โหมดเบราว์เซอร์: ส่งสูตรกลับไปให้เบราว์เซอร์ลูกค้าสร้างคลิปเอง
      if (job.browser) return res.json({ ok: true, cues: r.cues, spec: subtitleSpec(subtitles.get(job.id)) });
      if (!subtitles.queueRender(subtitles.get(job.id))) return res.status(409).json({ error: 'เริ่มสร้างคลิปไม่ได้ ลองโหลดหน้าใหม่' });
      log('[subtitles] ลูกค้าสั่งสร้างคลิป');
    }
    res.json({ ok: true, cues: r.cues });
  });

  app.post('/subtitles/:id/retry', requireUser, requireCsrf, (req, res) => {
    const job = ownSub(req);
    if (!job) return notFound(req, res, 'ไม่พบคลิปนี้');
    if (job.browser) subtitles.restartAsr(job);
    else subtitles.retry(job);
    res.redirect(303, `/subtitles/${job.id}`);
  });

  app.post('/subtitles/:id/edit', requireUser, requireCsrf, (req, res) => {
    const job = ownSub(req);
    if (!job) return notFound(req, res, 'ไม่พบคลิปนี้');
    subtitles.reopen(job);
    res.redirect(303, `/subtitles/${job.id}`);
  });

  app.get('/subtitles/:id/srt', requireUser, (req, res) => {
    const job = ownSub(req);
    if (!job || !job.cues_json) return notFound(req, res, 'ยังไม่มีซับของคลิปนี้');
    const base = (job.src_name || 'clip').replace(/\.[a-z0-9]{2,4}$/i, '');
    res.set({ 'Content-Type': 'application/x-subrip; charset=utf-8', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="subtitles.srt"; filename*=UTF-8''${encodeURIComponent(base)}.srt` });
    res.send('﻿' + require('./subcues').toSrt(subtitles.cuesOf(job)));
  });

  app.get('/subtitles/:id/download', requireUser, limit.download, (req, res) => {
    const job = ownSub(req);
    if (job && job.browser) return res.redirect(303, `/subtitles/${encodeURIComponent(job.id)}?save=1`);
    if (!job || job.status !== 'done' || !fs.existsSync(subtitles.outOf(job))) return notFound(req, res, 'ยังไม่มีคลิปพร้อมซับ');
    const base = (job.src_name || 'clip').replace(/\.[a-z0-9]{2,4}$/i, '');
    res.set({ 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store' });
    if (req.query.inline !== '1') res.set('Content-Disposition', `attachment; filename="subtitled.mp4"; filename*=UTF-8''${encodeURIComponent(`${base}-ซับ`)}.mp4`);
    res.sendFile(subtitles.outOf(job));
  });

  app.post('/subtitles/:id/delete', requireUser, requireCsrf, (req, res) => {
    const job = ownSub(req);
    if (!job) return notFound(req, res, 'ไม่พบคลิปนี้');
    if (!subtitles.remove(job.id, req.user.id)) {
      return send(req, res, 'message', { title: 'ลบตอนนี้ไม่ได้', text: 'คลิปนี้กำลังประมวลผลอยู่ รอให้เสร็จก่อนแล้วลบได้ (หรือรอลบอัตโนมัติ)' }, 409);
    }
    log('[subtitles] ลูกค้าลบคลิป');
    res.redirect(303, '/subtitles');
  });

  app.get('/library/:orderId', requireUser, (req, res) => {
    const it = libraryItem(req, res);
    if (!it) return;
    const editorId = pickEditor(req);
    if (req.query.editor && editorId !== req.user.editor) {
      q.setEditor.run(editorId, req.user.id); // จำโปรแกรมที่ใช้ล่าสุด
      req.user.editor = editorId;
    }
    res.set('Cache-Control', 'no-store');
    send(req, res, 'libraryItem', { ...it, editorId, size: req.query.size === 'horizontal' ? 'horizontal' : 'vertical', left: downloadsLeft(req.user.id), claimed: req.query.claimed === '1' });
  });

  function grantFor(order) {
    const t = now();
    let grant = q.liveGrant.get(order.id, t + MIN_MS);
    if (!grant) {
      const id = crypto.randomBytes(16).toString('base64url');
      q.insertGrant.run(id, order.id, t + cfg.linkMinutes * MIN_MS, t, 'library');
      grant = q.grantById.get(id);
    }
    return links.buildDownloadPath(cfg.downloadSecret, grant.id, Math.floor(grant.expires_at / 1000));
  }

  // แบบต้นฉบับ: ไฟล์เดียวตามโปรแกรมและแนวที่เลือก (คลิป 3 วินาทีที่เรนเดอร์ไว้แล้ว ส่งได้ทันที)
  app.get('/library/:orderId/download', requireUser, limit.download, (req, res) => {
    const it = libraryItem(req, res);
    if (!it) return;
    const editorId = pickEditor(req);
    const ed = editors[editorId];
    const format = req.query.filetype === 'alt' && ed.alt ? ed.alt : ed.single;
    const size = req.query.size === 'horizontal' ? 'horizontal' : 'vertical';
    const file = it.p.manifest.files.find((f) => f.format === format && f.size === size && (f.part || 'full') === 'full');
    if (!file) return notFound(req, res, 'ไม่พบไฟล์');
    if (downloadsLeft(req.user.id) <= 0) {
      return send(req, res, 'message', { title: 'วันนี้ดาวน์โหลดครบจำนวนแล้ว', text: `บัญชีหนึ่งดาวน์โหลดได้ ${cfg.dailyDownloadLimit} ครั้งต่อ 24 ชั่วโมง กลับมาโหลดได้อีกครั้งพรุ่งนี้`, action: { href: '/library', label: 'กลับไปที่คลัง' } }, 429);
    }
    q.logDownload.run(req.user.id, it.order.id, file.file, editorId, now());
    if (req.query.editor && editorId !== req.user.editor) q.setEditor.run(editorId, req.user.id);
    const u = new URL(grantFor(it.order), 'http://x');
    res.set('Cache-Control', 'no-store');
    res.redirect(303, `${u.pathname}/f/${encodeURIComponent(file.file)}${u.search}`);
  });

  // กดดาวน์โหลดในคลัง → ตรวจสิทธิ์ → สร้างลิงก์ที่เซ็นแล้ว อายุสั้น → พาไปโหลด
  app.get('/library/:orderId/get/:file', requireUser, limit.download, (req, res) => {
    const it = libraryItem(req, res);
    if (!it) return;
    const editorId = pickEditor(req);
    const allowed = new Set(editors[editorId].formats);
    const file = it.p.manifest.files.find((f) => f.file === req.params.file && allowed.has(f.format));
    if (!file) return notFound(req, res, 'ไม่พบไฟล์นี้ในรายการของคุณ');
    if (downloadsLeft(req.user.id) <= 0) {
      return send(req, res, 'message', {
        title: 'วันนี้ดาวน์โหลดครบจำนวนแล้ว',
        text: `บัญชีหนึ่งดาวน์โหลดได้ ${cfg.dailyDownloadLimit} ไฟล์ต่อ 24 ชั่วโมง เพื่อป้องกันการแชร์บัญชี ไฟล์ยังอยู่ในคลังของคุณ กลับมาโหลดได้อีกครั้งพรุ่งนี้`,
        action: { href: '/library', label: 'กลับไปที่คลัง' },
      }, 429);
    }
    q.logDownload.run(req.user.id, it.order.id, file.file, editorId, now());
    // ใช้ลิงก์เดิมถ้ายังเหลืออายุ ไม่งั้นสร้างใหม่
    const t = now();
    let grant = q.liveGrant.get(it.order.id, t + MIN_MS);
    if (!grant) {
      const id = crypto.randomBytes(16).toString('base64url');
      q.insertGrant.run(id, it.order.id, t + cfg.linkMinutes * MIN_MS, t, 'library');
      grant = q.grantById.get(id);
    }
    const signed = links.buildDownloadPath(cfg.downloadSecret, grant.id, Math.floor(grant.expires_at / 1000));
    const u = new URL(signed, 'http://x');
    res.set('Cache-Control', 'no-store');
    res.redirect(303, `${u.pathname}/f/${encodeURIComponent(file.file)}${u.search}`);
  });

  // ---------- ส่งไฟล์ (ลิงก์ที่เซ็นแล้วเท่านั้น) ----------
  // ตรวจลายเซ็น + วันหมดอายุ + สถานะคำสั่งซื้อ ทุกครั้ง ใช้ได้โดยไม่ต้องมีคุกกี้ (โปรแกรมช่วยโหลดใช้ได้)
  app.get('/d/:grantId/f/:file', (req, res, next) => {
    const { grantId } = req.params;
    const exp = String(req.query.e || '');
    const sig = String(req.query.s || '');
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    const v = links.verify(cfg.downloadSecret, grantId, exp, sig, Math.floor(now() / 1000));
    const grant = v === 'bad' ? null : q.grantById.get(grantId);
    if (!grant) return send(req, res, 'message', { title: 'ลิงก์ไม่ถูกต้อง', text: 'กรุณากดดาวน์โหลดจากคลังของคุณอีกครั้ง', action: { href: '/library', label: 'ไปที่คลัง' } }, 403);
    if (v === 'expired' || grant.expires_at < now()) {
      return send(req, res, 'message', { title: 'ลิงก์หมดอายุแล้ว', text: 'ลิงก์ดาวน์โหลดใช้ได้ไม่กี่นาที กดดาวน์โหลดจากคลังอีกครั้งได้เลย ไฟล์ยังอยู่ในคลังของคุณ', action: { href: '/library', label: 'ไปที่คลัง' } }, 410);
    }
    const order = q.getOrder.get(grant.order_id);
    const p = order && productsBySlug.get(order.product_slug);
    if (!order || order.status !== 'paid' || !p) return send(req, res, 'message', { title: 'ลิงก์ไม่ถูกต้อง', text: '' }, 403);
    // ชื่อไฟล์ต้องอยู่ใน manifest ของสินค้าที่ซื้อ (กัน path traversal)
    const file = p.manifest.files.find((f) => f.file === req.params.file);
    if (!file) return notFound(req, res, 'ไม่พบไฟล์');
    if (storage.driver === 'supabase') {
      // ไฟล์อยู่บน Supabase (private): ส่งลูกค้าไปโหลดด้วยลิงก์เซ็นอายุ 2 นาที ไฟล์ไม่ผ่านเซิร์ฟเวอร์ร้าน
      const k = productKey(p.slug, file);
      return storage.signedUrl(k.key, { expiresIn: 120, downloadName: k.name })
        .then((u) => res.redirect(302, u))
        .catch(next);
    }
    const abs = path.join(cfg.storageDir, p.slug, path.basename(file.file));
    res.download(abs, file.file, { headers: { 'Cache-Control': 'no-store' } }, (err) => { if (err && !res.headersSent) next(err); });
  });

  // ---------- หลังบ้าน ----------
  // ต้องล็อกอินด้วยบัญชีแอดมินที่หน้าเข้าสู่ระบบปกติ · ยังไม่ล็อกอิน → พาไปล็อกอินแล้วกลับมา · ลูกค้าทั่วไป → ตอบเหมือนไม่มีหน้านี้
  function adminAuth(req, res, next) {
    if (!req.user) return res.redirect(303, `/login?next=${encodeURIComponent('/admin')}`);
    if (req.user.role !== 'admin') return notFound(req, res);
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    next();
  }

  app.get('/admin', adminAuth, (req, res) => {
    const totals = q.statTotals.get();
    const stats = {
      paid: totals.paid || 0, pending: totals.pending || 0, revenue: totals.revenue || 0,
      users: q.statUsers.get().n, byEditor: q.statEditors.all(),
    };
    send(req, res, 'admin', { orders: q.listOrders.all(), stats, tools: tools(), installHelp: renderTools.installHelp(tools()), reviewCount: q.reviewCount.get().n });
  });

  // คิวตรวจสอบการโอนเงิน: อนุมัติ/ปฏิเสธได้เฉพาะแอดมิน · ทุกครั้งบันทึกใน payment_audit
  app.get('/admin/transfers', adminAuth, (req, res) => {
    if (!isManual()) return notFound(req, res);
    expireStale();
    send(req, res, 'adminTransfers', { waiting: q.reviewQueue.all().map((o) => ({ ...o, same: q.sameAmount.all(o.transfer_amount, o.id) })).sort((a, b) => (a.transfer_amount - b.transfer_amount) || (a.confirmed_at - b.confirmed_at)), recent: q.reviewedRecent.all(), audit: q.auditRecent.all(), done: String(req.query.done || '').slice(0, 20), problem: String(req.query.problem || '').slice(0, 20) });
  });

  app.post('/admin/transfers/:id/approve', adminAuth, requireCsrf, (req, res, next) => {
    try {
      if (!isManual()) return notFound(req, res);
      const id = String(req.params.id || '');
      const result = db.transaction(() => {
        const o = q.getOrder.get(id);
        if (!o || o.provider !== 'manual') return null;
        const r = q.approveTransfer.run(now(), req.user.id, now(), id); // เปลี่ยนได้ครั้งเดียว: ต้องเป็น "รอตรวจสอบ" เท่านั้น
        if (r.changes !== 1) return 'noop';
        audit(id, req.user, 'approve', `อนุมัติยอด ${views.baht(o.transfer_amount)} (${o.pay_ref})`);
        return 'ok';
      })();
      if (!result) return notFound(req, res);
      if (result === 'noop') return res.redirect(303, '/admin/transfers?problem=handled');
      const order = q.getOrder.get(id);
      log(`[payment] manual approve ${id} by ${req.user.email}`);
      sendReceipt(order).catch((e) => log(`[mail] ส่งไม่สำเร็จ: ${e.message}`));
      res.redirect(303, `/admin/transfers?done=approved`);
    } catch (e) { next(e); }
  });

  app.post('/admin/transfers/:id/reject', adminAuth, requireCsrf, (req, res, next) => {
    try {
      if (!isManual()) return notFound(req, res);
      const id = String(req.params.id || '');
      const reason = custom.cleanText(req.body.reason || '').slice(0, 200);
      if (reason.length < 3) return res.redirect(303, '/admin/transfers?problem=reason');
      const result = db.transaction(() => {
        const o = q.getOrder.get(id);
        if (!o || o.provider !== 'manual') return null;
        const r = q.rejectTransfer.run(req.user.id, now(), reason, id);
        if (r.changes !== 1) return 'noop';
        audit(id, req.user, 'reject', `ปฏิเสธ (${o.pay_ref}): ${reason}`);
        return 'ok';
      })();
      if (!result) return notFound(req, res);
      if (result === 'noop') return res.redirect(303, '/admin/transfers?problem=handled');
      const order = q.getOrder.get(id);
      mailer.send({ to: order.email, subject: `ยังไม่พบรายการโอน – ${cfg.shopName}`, text: views.transferRejectedEmail({ cfg, order, p: productsBySlug.get(order.product_slug), reason }) }).catch((e) => log(`[mail] ${e.message}`));
      res.redirect(303, `/admin/transfers?done=rejected`);
    } catch (e) { next(e); }
  });

  // ---------- error ----------
  app.use((req, res) => notFound(req, res));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large' && req.path === '/library/fonts') return res.status(413).json({ error: 'ไฟล์ฟอนต์ใหญ่เกิน 5 MB' });
    log(`[error] ${err.stack || err}`);
    send(req, res, 'message', { title: 'เกิดข้อผิดพลาด', text: 'กรุณาลองใหม่อีกครั้ง' }, 500);
  });

  return { app, db, mailer, provider, applyPaymentEvent, customizer, subtitles };
}

module.exports = { createApp };

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

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

function createApp(cfg, opts = {}) {
  const db = opts.db || openDb(cfg.databaseFile);
  const mailer = opts.mailer || createMailer(cfg);
  const provider = opts.provider || getProvider(cfg.paymentProvider);
  const log = opts.log || console.log;
  const now = opts.now || (() => Date.now());
  const secureCookies = cfg.baseUrl.startsWith('https://');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  const productsBySlug = new Map(cfg.products.map((p) => [p.slug, p]));

  // ความพร้อมของเครื่องมือเรนเดอร์ (ตรวจซ้ำทุก 1 นาทีถ้ายังไม่พร้อม เผื่อเพิ่งติดตั้ง ffmpeg)
  let toolsCache = null;
  let toolsCheckedAt = 0;
  function tools() {
    if (opts.renderTools) return opts.renderTools;
    if (!toolsCache || (!toolsCache.ok && Date.now() - toolsCheckedAt > 60 * 1000)) {
      toolsCache = renderTools.checkRenderTools();
      toolsCheckedAt = Date.now();
    }
    return toolsCache;
  }
  const { editors } = cfg.editorsConfig;

  // ---------- ส่วนหัวความปลอดภัย ----------
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      // ลิงก์ดาวน์โหลดมีลายเซ็นใน URL ห้ามส่ง Referer ออกนอกเว็บ (ภายในเว็บส่งได้ ใช้ตัดสินว่าแสดงหน้าโหลดไหม)
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
    next();
  });

  // ---------- SQL ----------
  const q = {
    insertOrder: db.prepare(`INSERT INTO orders (id, product_slug, editor, email, amount, currency, status, provider, created_at, user_id)
                             VALUES (@id, @product_slug, @editor, @email, @amount, 'THB', 'pending', @provider, @created_at, @user_id)`),
    setPaymentRef: db.prepare('UPDATE orders SET payment_ref = ? WHERE id = ?'),
    getOrder: db.prepare('SELECT * FROM orders WHERE id = ?'),
    insertEvent: db.prepare('INSERT OR IGNORE INTO webhook_events (event_id, provider, order_id, type, received_at) VALUES (?, ?, ?, ?, ?)'),
    markPaid: db.prepare("UPDATE orders SET status = 'paid', paid_at = ?, payment_ref = COALESCE(?, payment_ref) WHERE id = ? AND status = 'pending'"),
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
    // คลัง
    libraryOrders: db.prepare("SELECT * FROM orders WHERE user_id = ? AND status = 'paid' ORDER BY paid_at DESC"),
    ownedPaid: db.prepare("SELECT * FROM orders WHERE user_id = ? AND product_slug = ? AND status = 'paid' LIMIT 1"),
    logDownload: db.prepare('INSERT INTO download_log (user_id, order_id, file, editor, at) VALUES (?, ?, ?, ?, ?)'),
    downloadsSince: db.prepare('SELECT COUNT(*) AS n FROM download_log WHERE user_id = ? AND at > ?'),
    // หลังบ้าน
    listOrders: db.prepare(`SELECT o.*, (SELECT COUNT(*) FROM download_log d WHERE d.order_id = o.id) AS downloads
                            FROM orders o ORDER BY o.created_at DESC LIMIT 200`),
    statTotals: db.prepare(`SELECT SUM(status='paid') AS paid, SUM(status='pending') AS pending,
                                   COALESCE(SUM(CASE WHEN status='paid' THEN amount END),0) AS revenue FROM orders`),
    statUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    // นับว่าลูกค้า "ใช้" ไฟล์กับโปรแกรมไหน (คำสั่งซื้อ x โปรแกรม ไม่นับซ้ำ)
    statEditors: db.prepare('SELECT editor, COUNT(DISTINCT order_id) AS n FROM download_log GROUP BY editor ORDER BY n DESC'),
  };

  const customizer = custom.createCustomizer({
    db, cfg, log, now,
    renderer: opts.renderer || custom.createRenderer(cfg),
    toolsOk: () => tools().ok,
  });

  // ---------- คุกกี้ เซสชัน CSRF ----------
  // CSRF แบบ double-submit: คุกกี้ csrf (SameSite=Strict) ต้องตรงกับช่อง csrf ในฟอร์มทุกฟอร์มที่ POST
  app.use(express.static(path.join(cfg.root, 'public'), { maxAge: '1h', index: false }));

  app.use((req, res, next) => {
    req.cookies = auth.parseCookies(req.headers.cookie);
    let csrf = req.cookies.csrf;
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(csrf || '')) {
      csrf = crypto.randomBytes(32).toString('base64url');
      res.append('Set-Cookie', auth.cookie('csrf', csrf, { secure: secureCookies, sameSite: 'Strict' }));
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

  const page = (req, fn, args = {}) => views[fn]({ cfg, user: req.user || null, csrf: req.csrf, ...args });
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
    res.append('Set-Cookie', auth.cookie('sid', token, { secure: secureCookies, maxAgeSec: cfg.sessionDays * 86400 }));
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

  // ---------- ยืนยันการชำระเงิน (เรียกจาก webhook เท่านั้น) ----------
  // ทำใน transaction เดียว: บันทึก event_id (กันซ้ำ) → เปลี่ยนสถานะ (ได้ครั้งเดียว)
  const applyPaymentEvent = db.transaction((ev) => {
    const inserted = q.insertEvent.run(ev.eventId, provider.name, ev.orderId || null, ev.type || null, now());
    if (inserted.changes === 0) return { result: 'duplicate' };
    if (ev.type !== 'payment.succeeded') return { result: 'ignored' };
    const order = ev.orderId && q.getOrder.get(ev.orderId);
    if (!order) return { result: 'unknown_order' };
    if (Number(ev.amount) !== order.amount || (ev.currency && ev.currency !== order.currency)) {
      return { result: 'amount_mismatch', order };
    }
    const upd = q.markPaid.run(now(), ev.paymentRef || null, order.id);
    if (upd.changes === 0) return { result: 'already_paid', order };
    return { result: 'paid', order: q.getOrder.get(order.id) };
  });

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
      ev = provider.parseWebhook({ rawBody, headers: req.headers, cfg });
    } catch (e) {
      if (e instanceof WebhookSignatureError) {
        log(`[webhook] ปฏิเสธ: ${e.message}`);
        return res.status(400).json({ error: 'invalid signature' });
      }
      log(`[webhook] อ่านไม่ได้: ${e.message}`);
      return res.status(400).json({ error: 'bad payload' });
    }
    if (!ev || !ev.eventId) return res.status(400).json({ error: 'missing event id' });
    const r = applyPaymentEvent(ev);
    log(`[webhook] ${ev.eventId} ${ev.type} order=${ev.orderId} → ${r.result}`);
    if (r.result === 'paid') sendReceipt(r.order).catch((e) => log(`[mail] ส่งไม่สำเร็จ: ${e.message}`));
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
  app.get('/license/kanit-ofl.txt', (req, res) => {
    res.type('text/plain; charset=utf-8').send(fs.readFileSync(path.join(cfg.root, 'fonts', 'OFL.txt')));
  });

  // ---------- สมัคร / เข้าสู่ระบบ / ออกจากระบบ ----------
  app.get('/signup', (req, res) => {
    if (req.user) return res.redirect(303, auth.safeNext(req.query.next));
    send(req, res, 'signup', { next: auth.safeNext(req.query.next) });
  });

  app.post('/signup', requireCsrf, async (req, res, next) => {
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
      res.redirect(303, nextUrl);
    } catch (e) { next(e); }
  });

  app.get('/login', (req, res) => {
    if (req.user) return res.redirect(303, auth.safeNext(req.query.next));
    send(req, res, 'login', { next: auth.safeNext(req.query.next) });
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
    res.append('Set-Cookie', auth.cookie('sid', '', { secure: secureCookies, maxAgeSec: 0 }));
    res.redirect(303, '/');
  });

  // ---------- สั่งซื้อ (ต้องเข้าสู่ระบบ) ----------
  app.post('/checkout', (req, res, next) => {
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
      const order = {
        id: crypto.randomBytes(16).toString('hex'),
        product_slug: p.slug,
        editor: req.user.editor || '',
        email: req.user.email,
        amount: p.price, // ราคาเอาจาก config ฝั่งเซิร์ฟเวอร์เสมอ
        provider: provider.name,
        created_at: now(),
        user_id: req.user.id,
      };
      q.insertOrder.run(order);
      const full = q.getOrder.get(order.id);
      const { redirectUrl, paymentRef } = await provider.createCheckout({ order: full, product: p, cfg });
      if (paymentRef) q.setPaymentRef.run(paymentRef, order.id);
      res.redirect(303, redirectUrl);
    } catch (e) { next(e); }
  });

  // คำสั่งซื้อของบัญชีที่ล็อกอินอยู่เท่านั้น (ของคนอื่นตอบเหมือนไม่มี)
  function ownOrder(req) {
    const order = q.getOrder.get(String(req.params.id || req.params.orderId || ''));
    return order && req.user && order.user_id === req.user.id ? order : null;
  }

  // ---------- โหมดทดสอบการจ่ายเงิน ----------
  app.get('/pay/mock/:id', requireUser, (req, res) => {
    if (provider.name !== 'mock') return notFound(req, res);
    const order = ownOrder(req);
    if (!order) return notFound(req, res);
    if (order.status === 'paid') return res.redirect(303, `/order/${order.id}`);
    send(req, res, 'mockPay', { order, p: productsBySlug.get(order.product_slug) });
  });

  app.post('/pay/mock/:id/simulate', requireUser, requireCsrf, async (req, res, next) => {
    try {
      if (provider.name !== 'mock') return notFound(req, res);
      const order = ownOrder(req);
      if (!order) return notFound(req, res);
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

  // ---------- สถานะคำสั่งซื้อ ----------
  app.get('/order/:id', requireUser, (req, res) => {
    const order = ownOrder(req);
    if (!order) return notFound(req, res, 'ไม่พบคำสั่งซื้อนี้ในบัญชีของคุณ');
    res.set('Cache-Control', 'no-store');
    send(req, res, 'orderStatus', { order, p: productsBySlug.get(order.product_slug) });
  });

  app.get('/order/:id/status', (req, res) => {
    const order = ownOrder(req);
    res.set('Cache-Control', 'no-store');
    if (!order) return res.status(404).json({ error: 'not found' });
    res.json({ status: order.status });
  });

  // ---------- คลัง ----------
  function downloadsLeft(userId) {
    const used = q.downloadsSince.get(userId, now() - DAY_MS).n;
    return Math.max(0, cfg.dailyDownloadLimit - used);
  }

  app.get('/library', requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const items = q.libraryOrders.all(req.user.id)
      .map((o) => ({ order: o, p: productsBySlug.get(o.product_slug) }))
      .filter((x) => x.p);
    send(req, res, 'library', { items, customs: customizer.byUser(req.user.id), fonts: customizer.fontsFor(req.user.id), limits: customizer.limits(req.user.id) });
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
    send(req, res, 'customStatus', { job, p: productsBySlug.get(job.product_slug), position: customizer.queuePosition(job), fonts: customizer.fontsFor(req.user.id) });
  });

  app.get('/library/custom/:id/status', (req, res) => {
    const job = ownCustom(req);
    res.set('Cache-Control', 'no-store');
    if (!job) return res.status(404).json({ error: 'not found' });
    res.json({ status: job.status, progress: job.progress, stage: job.stage, position: customizer.queuePosition(job) });
  });

  // ปุ่มดาวน์โหลดเดียว: ไฟล์วิดีโอไฟล์เดียวของเวอร์ชันนี้
  app.get('/library/custom/:id/download', requireUser, (req, res) => {
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

  app.post('/library/:orderId/customize', requireUser, requireCsrf, (req, res) => {
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

  app.post('/library/styles', requireUser, express.json({ limit: '4kb' }), (req, res) => {
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
  app.post('/library/fonts', express.raw({ type: 'application/octet-stream', limit: '5mb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    if (!auth.safeEqual(req.get('x-csrf-token'), req.csrf)) return res.status(403).json({ error: 'หมดเวลาแบบฟอร์ม กรุณาโหลดหน้าใหม่' });
    if (req.get('x-font-rights') !== 'yes') return res.status(400).json({ error: 'กรุณายืนยันว่าคุณมีสิทธิ์ใช้ฟอนต์นี้เชิงพาณิชย์' });
    try {
      const f = customizer.userFonts.add(req.user.id, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
      log('[fonts] ลูกค้าอัปโหลดฟอนต์');
      const latest = q.libraryOrders.all(req.user.id)[0];
      res.json({
        ok: true, id: f.id, fontId: `u-${f.id}`, name: f.name, thai: f.thai, format: f.format, chars: f.chars,
        url: `/library/fonts/${f.id}/file`, customizeUrl: latest ? `/library/${latest.id}/customize?font=u-${f.id}` : null,
      });
    } catch (e) {
      if (e.name === 'FontError') return res.status(400).json({ error: e.message });
      throw e;
    }
  });

  // ส่งไฟล์ฟอนต์ให้เจ้าของเท่านั้น (ใช้แสดงตัวอย่าง) คนอื่นตอบเหมือนไม่มี
  app.get('/library/fonts/:id/file', requireUser, (req, res) => {
    const row = customizer.userFonts.get(req.params.id, req.user.id);
    if (!row) return res.status(404).end();
    res.set({ 'Content-Type': `font/${row.format}`, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(customizer.userFonts.path(row));
  });

  app.post('/library/fonts/:id/delete', requireUser, requireCsrf, (req, res) => {
    if (!customizer.userFonts.remove(req.params.id, req.user.id)) return notFound(req, res, 'ไม่พบฟอนต์นี้');
    res.redirect(303, '/library/fonts');
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
    send(req, res, 'libraryItem', { ...it, editorId, size: req.query.size === 'horizontal' ? 'horizontal' : 'vertical', left: downloadsLeft(req.user.id) });
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
  app.get('/library/:orderId/download', requireUser, (req, res) => {
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
  app.get('/library/:orderId/get/:file', requireUser, (req, res) => {
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
    const abs = path.join(cfg.storageDir, p.slug, path.basename(file.file));
    res.download(abs, file.file, { headers: { 'Cache-Control': 'no-store' } }, (err) => { if (err && !res.headersSent) next(err); });
  });

  // ---------- หลังบ้าน ----------
  function adminAuth(req, res, next) {
    if (!cfg.adminPassword || cfg.adminPassword.length < 12) {
      return res.status(503).send('ปิดหลังบ้านอยู่: ตั้ง ADMIN_PASSWORD (อย่างน้อย 12 ตัวอักษร) ใน .env');
    }
    const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
    const [user, ...rest] = m ? Buffer.from(m[1], 'base64').toString('utf8').split(':') : [];
    const pass = rest.join(':');
    const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
    const ok = user === 'admin' && crypto.timingSafeEqual(h(pass), h(cfg.adminPassword));
    if (!ok) {
      res.set('WWW-Authenticate', 'Basic realm="admin", charset="UTF-8"');
      return res.status(401).send('ต้องเข้าสู่ระบบ');
    }
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    next();
  }

  app.get('/admin', adminAuth, (req, res) => {
    const totals = q.statTotals.get();
    const stats = {
      paid: totals.paid || 0, pending: totals.pending || 0, revenue: totals.revenue || 0,
      users: q.statUsers.get().n, byEditor: q.statEditors.all(),
    };
    send(req, res, 'admin', { orders: q.listOrders.all(), stats, tools: tools(), installHelp: renderTools.installHelp(tools()) });
  });

  // ---------- error ----------
  app.use((req, res) => notFound(req, res));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large' && req.path === '/library/fonts') return res.status(413).json({ error: 'ไฟล์ฟอนต์ใหญ่เกิน 5 MB' });
    log(`[error] ${err.stack || err}`);
    send(req, res, 'message', { title: 'เกิดข้อผิดพลาด', text: 'กรุณาลองใหม่อีกครั้ง' }, 500);
  });

  return { app, db, mailer, provider, applyPaymentEvent, customizer };
}

module.exports = { createApp };

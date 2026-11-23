'use strict';
/*
 * Omise (Opn Payments): PromptPay QR และบัตรเครดิต/เดบิต
 * อ้างอิงคู่มือทางการ docs.omise.co (Charges API, PromptPay, Omise.js, Webhooks, Events, Refunds, Testing)
 *
 *  - ร้านไม่แตะเลขบัตร: หน้าเว็บใช้ Omise.js ส่งเลขบัตรไป vault.omise.co โดยตรง ได้กลับมาเป็นโทเคน tokn_ ใช้ได้ครั้งเดียว
 *    เซิร์ฟเวอร์รับแค่โทเคน แล้วสร้าง charge ด้วย secret key (ไม่สร้าง charge ฝั่งลูกค้า)
 *  - PromptPay: เซิร์ฟเวอร์สร้าง charge พร้อม source[type]=promptpay แล้วส่งรูป QR ให้ลูกค้า (ผ่านเซิร์ฟเวอร์เรา)
 *  - ยืนยันการจ่าย: webhook ที่ตรวจลายเซ็น Omise-Signature (HMAC-SHA256 ของ "<timestamp>.<raw body>" ด้วย secret ที่ถอด base64)
 *    แล้ว "ดึง charge จาก Omise ใหม่" (GET /charges/:id) ก่อนเชื่อสถานะและยอดเงินเสมอ
 *    (บัตรที่ไม่ผ่าน 3DS ไม่ยิง charge.complete ตามคู่มือ จึงยืนยันด้วยการดึง charge จาก API ฝั่งเซิร์ฟเวอร์ด้วย)
 *  - คีย์อยู่ใน .env เท่านั้น: OMISE_PUBLIC_KEY, OMISE_SECRET_KEY, OMISE_WEBHOOK_SECRET
 */
const crypto = require('crypto');

const API_VERSION = '2019-05-29';
const SIG_TOLERANCE_SEC = 5 * 60;

class OmiseApiError extends Error {
  constructor(msg, { status, code } = {}) { super(msg); this.name = 'OmiseApiError'; this.status = status; this.code = code; }
}

const isTestKey = (k) => /_test_/.test(String(k || ''));

// form-encode รองรับ object ซ้อน เช่น source[type]=promptpay, metadata[order_id]=...
function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

function api(cfg) {
  const base = (cfg.omise.apiBase || 'https://api.omise.co').replace(/\/+$/, '');
  const auth = 'Basic ' + Buffer.from(`${cfg.omise.secretKey}:`).toString('base64');
  async function call(method, path, body) {
    const r = await fetch(base + path, {
      method,
      headers: { authorization: auth, 'omise-version': API_VERSION, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: body ? formEncode(body).toString() : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.object === 'error') throw new OmiseApiError(j.message || `Omise API ${r.status}`, { status: r.status, code: j.code });
    return j;
  }
  return {
    createCharge: (params) => call('POST', '/charges', params),
    getCharge: (id) => {
      if (!/^chrg(_test)?_[0-9a-z]+$/.test(String(id))) throw new OmiseApiError('รหัส charge ไม่ถูกต้อง');
      return call('GET', `/charges/${id}`);
    },
    // รูป QR ของ PromptPay (ดึงด้วย secret key แล้วส่งต่อให้ลูกค้า เฉพาะ URL ของ Omise เท่านั้น)
    async download(uri) {
      const u = new URL(uri);
      const allowed = new URL(base);
      if (u.origin !== allowed.origin) throw new OmiseApiError('ที่อยู่รูป QR ไม่ใช่ของ Omise');
      const r = await fetch(u, { headers: { authorization: auth, 'omise-version': API_VERSION } });
      if (!r.ok) throw new OmiseApiError(`โหลด QR ไม่สำเร็จ ${r.status}`, { status: r.status });
      return { type: r.headers.get('content-type') || 'image/svg+xml', body: Buffer.from(await r.arrayBuffer()) };
    },
  };
}

// สถานะของ Omise → เหตุการณ์กลางของร้าน
function toEvent(charge, eventId) {
  const status = charge.status;
  let type = 'ignored';
  if (status === 'successful' && charge.paid !== false) type = 'payment.succeeded';
  if (status === 'failed') type = 'payment.failed';
  if (status === 'expired') type = 'payment.expired';
  if (status === 'reversed' || charge.voided) type = 'payment.refunded';
  if (status === 'successful' && Number(charge.refunded_amount) >= Number(charge.amount) && Number(charge.amount) > 0) type = 'payment.refunded';
  return {
    eventId,
    type,
    orderId: charge.metadata && charge.metadata.order_id,
    amount: charge.amount,
    currency: String(charge.currency || '').toUpperCase(),
    paymentRef: charge.id,
    livemode: Boolean(charge.livemode),
    failureCode: charge.failure_code || null,
    failureMessage: charge.failure_message || null,
  };
}

function verifySignature({ rawBody, headers, secret, nowSec = Math.floor(Date.now() / 1000) }) {
  const { WebhookSignatureError } = require('./index');
  const sigHeader = String(headers['omise-signature'] || '');
  const ts = String(headers['omise-signature-timestamp'] || '');
  if (!sigHeader || !/^\d{9,12}$/.test(ts)) throw new WebhookSignatureError('ไม่มีลายเซ็น');
  if (Math.abs(nowSec - Number(ts)) > SIG_TOLERANCE_SEC) throw new WebhookSignatureError('ลายเซ็นหมดอายุ');
  if (!secret) throw new WebhookSignatureError('ยังไม่ได้ตั้ง OMISE_WEBHOOK_SECRET');
  const key = Buffer.from(secret, 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${ts}.${rawBody}`).digest();
  // ระหว่างเปลี่ยน secret Omise ส่งมา 2 ลายเซ็นคั่นด้วยจุลภาค
  const ok = sigHeader.split(',').map((s) => s.trim()).some((s) => {
    if (!/^[0-9a-f]+$/i.test(s)) return false;
    const given = Buffer.from(s, 'hex');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  if (!ok) throw new WebhookSignatureError('ลายเซ็นไม่ถูกต้อง');
}

// ทำลายเซ็นแบบเดียวกับ Omise (ใช้ในเทสต์)
function signPayload(secretB64, rawBody, ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', Buffer.from(secretB64, 'base64')).update(`${ts}.${rawBody}`).digest('hex');
  return { 'omise-signature': sig, 'omise-signature-timestamp': String(ts) };
}

module.exports = {
  name: 'omise',
  OmiseApiError,
  isTestKey,
  signPayload,
  verifySignature,
  toEvent,
  api,

  // ส่งลูกค้าไปหน้าเลือกวิธีจ่ายของร้าน (PromptPay / บัตร) ยังไม่สร้าง charge จนกว่าจะเลือก
  async createCheckout({ order }) {
    return { redirectUrl: `/pay/omise/${order.id}`, paymentRef: null };
  },

  async createPromptPay({ order, product, cfg }) {
    const expires = new Date(Date.now() + cfg.omise.qrMinutes * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    return api(cfg).createCharge({
      amount: order.amount, currency: 'THB', source: { type: 'promptpay' },
      description: `${cfg.shopName}: ${product.title}`.slice(0, 255),
      metadata: { order_id: order.id }, expires_at: expires,
    });
  },

  async createCardCharge({ order, product, cfg, token }) {
    if (!/^tokn(_test)?_[0-9a-z]+$/.test(String(token || ''))) throw new OmiseApiError('โทเคนบัตรไม่ถูกต้อง');
    return api(cfg).createCharge({
      amount: order.amount, currency: 'THB', card: token,
      return_uri: `${cfg.baseUrl}/pay/omise/${order.id}/return`,
      description: `${cfg.shopName}: ${product.title}`.slice(0, 255),
      metadata: { order_id: order.id },
    });
  },

  // ดึงสถานะล่าสุดของ charge จาก Omise (แหล่งความจริงเดียว)
  async syncCharge({ chargeId, cfg, reason = 'sync' }) {
    const charge = await api(cfg).getCharge(chargeId);
    return toEvent(charge, `omise:${reason}:${charge.id}:${charge.status}:${charge.refunded_amount || 0}`);
  },

  // webhook: ตรวจลายเซ็น → อ่าน event → ดึง charge จาก Omise ใหม่ → แปลงเป็นเหตุการณ์กลาง
  async parseWebhook({ rawBody, headers, cfg }) {
    verifySignature({ rawBody, headers, secret: cfg.omise.webhookSecret });
    const ev = JSON.parse(rawBody);
    if (!ev || ev.object !== 'event' || !ev.id) return { eventId: ev && ev.id, type: 'ignored' };
    const key = String(ev.key || '');
    const data = ev.data || {};
    const chargeId = key.startsWith('charge.') ? data.id : key === 'refund.create' ? (typeof data.charge === 'string' ? data.charge : data.charge && data.charge.id) : null;
    if (!chargeId) return { eventId: ev.id, type: 'ignored' };
    const charge = await api(cfg).getCharge(chargeId);
    return toEvent(charge, ev.id);
  },
};

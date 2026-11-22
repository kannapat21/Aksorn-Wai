'use strict';
/*
 * โหมดทดสอบ: ไม่มีเงินจริง
 * - createCheckout พาไปหน้า /pay/mock/:orderId ที่มีปุ่ม "จำลองจ่ายสำเร็จ"
 * - ปุ่มนั้นให้ "เซิร์ฟเวอร์" สร้าง webhook ที่เซ็นด้วย PAYMENT_WEBHOOK_SECRET แล้ว POST เข้า /webhooks/payment
 *   เหมือน gateway จริงยิงมา (หน้าจอลูกค้าไม่ได้เปลี่ยนสถานะคำสั่งซื้อเอง)
 *
 * รูปแบบลายเซ็น: header  x-mock-signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>
 */
const crypto = require('crypto');

const TOLERANCE_SEC = 300;

function computeSig(secret, t, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
}

function signPayload(secret, rawBody, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${computeSig(secret, t, rawBody)}`;
}

module.exports = {
  name: 'mock',

  async createCheckout({ order }) {
    return { redirectUrl: `/pay/mock/${order.id}`, paymentRef: `mock_${order.id.slice(0, 12)}` };
  },

  parseWebhook({ rawBody, headers, cfg }) {
    const { WebhookSignatureError } = require('./index');
    const header = String(headers['x-mock-signature'] || '');
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')).filter((p) => p.length === 2));
    const t = Number(parts.t);
    if (!parts.v1 || !Number.isInteger(t)) throw new WebhookSignatureError('ไม่มีลายเซ็น');
    if (Math.abs(Math.floor(Date.now() / 1000) - t) > TOLERANCE_SEC) throw new WebhookSignatureError('ลายเซ็นหมดอายุ');
    const expected = Buffer.from(computeSig(cfg.webhookSecret, t, rawBody), 'hex');
    const given = Buffer.from(String(parts.v1), 'hex');
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
      throw new WebhookSignatureError('ลายเซ็นไม่ถูกต้อง');
    }
    const ev = JSON.parse(rawBody);
    return {
      eventId: String(ev.id),
      type: ev.type,
      orderId: ev.data && ev.data.order_id,
      amount: ev.data && ev.data.amount,
      currency: ev.data && ev.data.currency,
      paymentRef: ev.data && ev.data.payment_ref,
    };
  },

  // ใช้โดยปุ่ม "จำลองจ่ายสำเร็จ" และในเทสต์
  buildEvent(order, { eventId } = {}) {
    return {
      id: eventId || `evt_${crypto.randomBytes(12).toString('hex')}`,
      type: 'payment.succeeded',
      data: { order_id: order.id, amount: order.amount, currency: order.currency, payment_ref: order.payment_ref },
    };
  },
  signPayload,
};

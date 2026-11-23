'use strict';
/*
 * Payment adapter
 *
 * ทุก adapter ต้องมี:
 *   name
 *   createCheckout({ order, product, cfg }) -> Promise<{ redirectUrl, paymentRef }>
 *       สร้างการชำระเงินที่ gateway แล้วคืน URL ให้พาลูกค้าไปจ่าย (หน้า QR PromptPay / หน้ากรอกบัตรของ gateway)
 *       ร้านไม่รับ/ไม่เก็บข้อมูลบัตรเอง ลูกค้ากรอกบัตรบนหน้าของ gateway เท่านั้น
 *   parseWebhook({ rawBody, headers, cfg }) -> { eventId, type, orderId, amount, currency, paymentRef }
 *       ตรวจลายเซ็น webhook (ถ้าไม่ถูกให้ throw WebhookSignatureError) แล้วแปลงเป็นรูปแบบกลาง
 *       (async ได้) type ที่ระบบสนใจ: 'payment.succeeded' | 'payment.failed' | 'payment.expired' | 'payment.refunded'
 *
 * คำสั่งซื้อจะเปลี่ยนเป็น "จ่ายแล้ว" ได้ทางเดียวคือ webhook ที่ลายเซ็นถูกต้อง (ดู src/app.js)
 */
class WebhookSignatureError extends Error {}

function getProvider(name) {
  switch (name) {
    case 'mock': return require('./mock');
    case 'manual': return require('./manual'); // โอนเงินแล้วกดยืนยัน แอดมินตรวจและอนุมัติ
    case 'omise': return require('./omise'); // Omise (Opn Payments): PromptPay + บัตร
    default: throw new Error(`ไม่รู้จัก PAYMENT_PROVIDER=${name}`);
  }
}

module.exports = { getProvider, WebhookSignatureError };

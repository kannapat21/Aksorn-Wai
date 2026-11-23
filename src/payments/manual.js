'use strict';
/*
 * โอนเงินเอง (PAYMENT_PROVIDER=manual): ลูกค้าโอนผ่าน PromptPay/บัญชีธนาคารของร้าน แล้วกด "ยืนยันการโอนเงิน"
 *  - การกดของลูกค้า "ไม่ให้สินค้า" ได้แค่เปลี่ยนเป็น "รอตรวจสอบ" · สินค้าเข้าคลังเมื่อแอดมินกดอนุมัติเท่านั้น (src/app.js)
 *  - ไม่มี webhook: endpoint /webhooks/payment ปฏิเสธทุกคำขอในโหมดนี้
 *  - ยอดโอนของแต่ละออเดอร์มีเศษสตางค์ไม่ซ้ำกัน (และมีรหัสอ้างอิง) เพื่อให้แอดมินจับคู่รายการในแอปธนาคารได้
 */
module.exports = {
  name: 'manual',

  async createCheckout({ order }) {
    return { redirectUrl: `/pay/transfer/${order.id}`, paymentRef: null };
  },

  parseWebhook() {
    const { WebhookSignatureError } = require('./index');
    throw new WebhookSignatureError('โหมดโอนเงินไม่รับ webhook');
  },
};

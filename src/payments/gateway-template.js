'use strict';
/*
 * โครงสำหรับต่อ payment gateway จริง (ยังไม่ได้เลือก gateway)
 *
 * วิธีใช้: คัดลอกไฟล์นี้เป็น src/payments/<ชื่อ>.js แล้วเติม 2 ฟังก์ชันตามเอกสารของ gateway
 * จากนั้นเพิ่ม case ใน src/payments/index.js และตั้ง PAYMENT_PROVIDER=<ชื่อ> ใน .env
 *
 * ข้อกำหนด:
 *  - ใช้หน้าชำระเงินของ gateway (hosted checkout / QR PromptPay) ร้านไม่รับเลขบัตรเอง
 *  - ยืนยันการจ่ายด้วย webhook ที่ตรวจลายเซ็นเท่านั้น
 *  - eventId ต้องเป็นรหัสที่ไม่ซ้ำของ gateway (ใช้กันประมวลผลซ้ำ)
 *  - amount เป็นสตางค์ ตรงกับ orders.amount
 */
const { WebhookSignatureError } = require('./index');

module.exports = {
  name: 'template',

  async createCheckout({ order, product, cfg }) {
    // ตัวอย่างขั้นตอนทั่วไป:
    // 1) เรียก API ของ gateway สร้าง charge/checkout session
    //    amount: order.amount (สตางค์), currency: 'THB', payment methods: ['promptpay', 'card']
    //    metadata: { order_id: order.id }
    //    return_url: `${cfg.baseUrl}/order/${order.id}`
    //    ใช้ API key จาก cfg.paymentApiKey
    // 2) คืน URL ของหน้าชำระเงิน และรหัสอ้างอิงของ gateway
    void order; void product; void cfg;
    throw new Error('ยังไม่ได้ต่อ gateway จริง');
    // return { redirectUrl: session.url, paymentRef: session.id };
  },

  parseWebhook({ rawBody, headers, cfg }) {
    // 1) ตรวจลายเซ็นตามวิธีของ gateway ด้วย cfg.webhookSecret (ใช้ crypto.timingSafeEqual)
    //    ถ้าไม่ผ่าน: throw new WebhookSignatureError('...')
    // 2) แปลง event ให้เป็นรูปแบบกลาง
    void rawBody; void headers; void cfg;
    throw new WebhookSignatureError('ยังไม่ได้ต่อ gateway จริง');
    // return { eventId, type: 'payment.succeeded', orderId, amount, currency: 'THB', paymentRef };
  },
};

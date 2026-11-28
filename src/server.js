'use strict';
const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { checkRenderTools, installHelp } = require('../render/tools');
const { installCrashGuard } = require('./crashguard');

installCrashGuard();

let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const { app } = createApp(cfg);
const server = app.listen(cfg.port, () => {
  app.locals.internalUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`ร้านเปิดแล้วที่ ${cfg.baseUrl}`);
  console.log(`หลังบ้าน: เข้าสู่ระบบที่ ${cfg.baseUrl}/login ด้วยอีเมลแอดมิน (${cfg.adminEmail || 'ยังไม่ได้ตั้ง ADMIN_EMAIL'}) แล้วเลือก "หลังบ้าน" ในเมนู (รหัสผ่านอยู่ใน .env)`);
  if (cfg.paymentProvider === 'mock') console.log('การชำระเงิน: โหมดทดสอบ (mock) ไม่มีเงินจริง');
  if (cfg.paymentProvider === 'omise') console.log(`การชำระเงิน: Omise ${/_test_/.test(cfg.omise.secretKey) ? 'โหมดทดสอบ (คีย์ test)' : 'คีย์จริง'}${cfg.omise.webhookSecret ? '' : ' · ยังไม่ได้ตั้ง OMISE_WEBHOOK_SECRET (webhook จะถูกปฏิเสธ ระบบถามสถานะเองระหว่างลูกค้ารอ)'}`);
  if (cfg.mail.mode === 'console') console.log('อีเมล: โหมดทดสอบ (พิมพ์ลงหน้าจอนี้)');
  {
    const st = require('./mailer').mailStatus(cfg);
    if (st.mode === 'brevo' || st.mode === 'smtp') console.log(`[mail] อีเมล: ${st.problem ? `ตั้งค่ายังไม่ครบ · ${st.problem}` : `ส่งจริงผ่าน ${st.mode} · ผู้ส่ง ${st.from}`} · แจ้งร้านที่: ${st.notify.join(', ') || '-'}`);
  }
  if (cfg.mail.mode === 'off') console.log('อีเมล: ปิดอยู่ (MAIL_MODE=off) ลูกค้ายืนยันอีเมลและกู้รหัสผ่านทางอีเมลไม่ได้ จนกว่าจะตั้ง SMTP');
  const t = checkRenderTools();
  if (t.ok) console.log(`ระบบปรับแต่ง: พร้อมเรนเดอร์ (${t.browser.how} + ffmpeg)`);
  else console.log(`ระบบปรับแต่ง: ยังเรนเดอร์ไม่ได้\n  - ${installHelp(t).join('\n  - ')}`);
});

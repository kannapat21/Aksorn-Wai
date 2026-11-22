'use strict';
const { loadConfig } = require('./config');
const { createApp } = require('./app');
const { checkRenderTools, installHelp } = require('../render/tools');

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
  console.log(`หลังบ้าน: ${cfg.baseUrl}/admin (ผู้ใช้ admin, รหัสผ่านอยู่ใน .env)`);
  if (cfg.paymentProvider === 'mock') console.log('การชำระเงิน: โหมดทดสอบ (mock) ไม่มีเงินจริง');
  if (cfg.mail.mode === 'console') console.log('อีเมล: โหมดทดสอบ (พิมพ์ลงหน้าจอนี้)');
  const t = checkRenderTools();
  if (t.ok) console.log(`ระบบปรับแต่ง: พร้อมเรนเดอร์ (${t.browser.how} + ffmpeg)`);
  else console.log(`ระบบปรับแต่ง: ยังเรนเดอร์ไม่ได้\n  - ${installHelp(t).join('\n  - ')}`);
});

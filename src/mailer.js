'use strict';
/*
 * ส่งอีเมล
 *  MAIL_MODE=console  พิมพ์ลง console (โหมดทดสอบ)
 *  MAIL_MODE=smtp     ส่งจริงผ่าน SMTP (ตั้ง SMTP_HOST/PORT/USER/PASS)
 */
function createMailer(cfg, { log = console.log } = {}) {
  const sent = []; // เก็บไว้ให้เทสต์ตรวจได้
  let transport = null;
  if (cfg.mail.mode === 'smtp') {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({
      host: cfg.mail.host, port: cfg.mail.port, secure: cfg.mail.port === 465,
      auth: cfg.mail.user ? { user: cfg.mail.user, pass: cfg.mail.pass } : undefined,
    });
  }
  return {
    sent,
    async send({ to, subject, text }) {
      sent.push({ to, subject, text });
      if (transport) {
        await transport.sendMail({ from: cfg.mail.from, to, subject, text });
        return;
      }
      log(`\n===== อีเมล (โหมดทดสอบ ไม่ได้ส่งจริง) =====\nถึง: ${to}\nเรื่อง: ${subject}\n\n${text}\n==========================================\n`);
    },
  };
}

module.exports = { createMailer };

'use strict';
/*
 * ส่งอีเมล
 *  MAIL_MODE=console  พิมพ์ลง console (โหมดทดสอบ)
 *  MAIL_MODE=smtp     ส่งจริงผ่าน SMTP (ตั้ง SMTP_HOST/PORT/USER/PASS)
 *  MAIL_MODE=brevo    ส่งจริงผ่าน Brevo API (HTTPS) ใช้บน Render ฟรีที่ปิดพอร์ต SMTP · ตั้ง BREVO_API_KEY + MAIL_FROM (อีเมลที่ยืนยันกับ Brevo แล้ว)
 *  MAIL_MODE=off      ไม่ส่งอีเมลเลย (ใช้ตอนยังไม่มี SMTP: ลูกค้ายืนยันอีเมล/กู้รหัสผ่านทางอีเมลไม่ได้) ไม่พิมพ์ลิงก์ลง log
 */
function createMailer(cfg, { log = console.log, ...opts } = {}) {
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
      if (cfg.mail.mode === 'off') { log(`[mail] ปิดการส่งอีเมล (MAIL_MODE=off) ไม่ได้ส่งถึง ${to}: ${subject}`); return; }
      if (cfg.mail.mode === 'brevo') {
        const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(cfg.mail.from || '');
        const sender = m ? { name: (m[1] || '').trim() || undefined, email: m[2].trim() } : { email: String(cfg.mail.from || '').trim() };
        const r = await (opts.fetch || fetch)('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': cfg.mail.brevoKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw new Error(`Brevo ตอบ ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
        return;
      }
      if (transport) {
        await transport.sendMail({ from: cfg.mail.from, to, subject, text });
        return;
      }
      log(`\n===== อีเมล (โหมดทดสอบ ไม่ได้ส่งจริง) =====\nถึง: ${to}\nเรื่อง: ${subject}\n\n${text}\n==========================================\n`);
    },
  };
}

module.exports = { createMailer };

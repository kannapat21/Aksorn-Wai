'use strict';
/*
 * ส่งอีเมล
 *  MAIL_MODE=console  พิมพ์ลง console (โหมดทดสอบ)
 *  MAIL_MODE=smtp     ส่งจริงผ่าน SMTP (ตั้ง SMTP_HOST/PORT/USER/PASS)
 *  MAIL_MODE=brevo    ส่งจริงผ่าน Brevo API (HTTPS) ใช้บน Render ฟรีที่ปิดพอร์ต SMTP · ตั้ง BREVO_API_KEY + MAIL_FROM (อีเมลที่ยืนยันกับ Brevo แล้ว)
 *  MAIL_MODE=off      ไม่ส่งอีเมลเลย (ใช้ตอนยังไม่มี SMTP: ลูกค้ายืนยันอีเมล/กู้รหัสผ่านทางอีเมลไม่ได้) ไม่พิมพ์ลิงก์ลง log
 */
const clean = (v) => String(v || '').trim().replace(/^["']|["']$/g, '').trim();
const redact = (t) => String(t || '').replace(/x(?:keysib|smtpsib)-[\w-]+/g, '[ซ่อนคีย์]');

// ตรวจค่าตั้งเมลก่อนส่ง · คืนข้อความภาษาไทยที่บอกว่าต้องแก้อะไร (ไม่มีคีย์ในข้อความ)
function mailStatus(cfg) {
  const mode = clean(cfg.mail.mode).toLowerCase() || 'console';
  const from = clean(cfg.mail.from);
  const out = { mode, from, notify: cfg.mail.notify || [], problem: '' };
  if (mode === 'brevo') {
    const key = clean(cfg.mail.brevoKey);
    out.keyKind = !key ? 'none' : key.startsWith('xkeysib-') ? 'api' : key.startsWith('xsmtpsib-') ? 'smtp' : 'unknown';
    if (out.keyKind === 'none') out.problem = 'ยังไม่ได้ตั้ง BREVO_API_KEY';
    else if (out.keyKind === 'smtp') out.problem = 'BREVO_API_KEY เป็น "SMTP key" (ขึ้นต้น xsmtpsib-) ใช้ไม่ได้ ต้องใช้ "API key" ที่ขึ้นต้น xkeysib- (Brevo → SMTP & API → แท็บ API Keys → Generate a new API key)';
    else if (!from || /example\.com/i.test(from)) out.problem = 'ยังไม่ได้ตั้ง MAIL_FROM เป็นอีเมลผู้ส่งที่ยืนยันใน Brevo แล้ว (Brevo → Senders, Domains & Dedicated IPs → Senders)';
  } else if (mode === 'off') out.problem = 'MAIL_MODE=off ระบบไม่ส่งเมล (ตั้ง MAIL_MODE=brevo)';
  else if (mode === 'console') out.problem = 'โหมดทดสอบ: เมลพิมพ์ลง log ไม่ได้ส่งจริง (ตั้ง MAIL_MODE=brevo)';
  if (!out.notify.length) out.notifyProblem = 'ยังไม่มีอีเมลร้านที่จะรับแจ้งเตือน (ตั้ง SHOP_NOTIFY_EMAIL หรือ ADMIN_EMAIL)';
  return out;
}

// แปลคำตอบ error ของ Brevo เป็นสิ่งที่ต้องไปแก้
function brevoHint(status, body) {
  const m = `${body.code || ''} ${body.message || ''}`.toLowerCase();
  if (status === 401 && /ip/.test(m)) return 'Brevo บล็อก IP ของเซิร์ฟเวอร์ร้าน: ไปที่ Brevo → Security → Authorised IPs แล้วกดปิด (Deactivate blocking) หรือเพิ่ม IP ที่แสดงใน log';
  if (status === 401) return 'Brevo ไม่รับคีย์นี้: สร้าง API key ใหม่ (ขึ้นต้น xkeysib-) แล้ววางใน BREVO_API_KEY บน Render';
  if (/sender|from/.test(m)) return 'อีเมลใน MAIL_FROM ยังไม่ได้ยืนยันใน Brevo: Brevo → Senders → Add a sender แล้วกดยืนยันจากเมลที่ได้รับ';
  if (status === 403 || /not.*activated|suspend/.test(m)) return 'บัญชี Brevo ยังไม่เปิดให้ส่งเมลแบบ transactional: เข้า Brevo ดูแจ้งเตือนบนหน้าแรก หรือติดต่อ Brevo ให้เปิดบัญชี';
  if (status === 429) return 'ส่งเกินโควตา Brevo วันนี้ (ฟรี 300 ฉบับ/วัน)';
  return '';
}

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
      const st = mailStatus(cfg);
      if (st.mode === 'off') { log(`[mail] ปิดการส่งอีเมล (MAIL_MODE=off) ไม่ได้ส่งถึง ${to}: ${subject}`); return; }
      if (st.mode === 'brevo') {
        if (st.problem) throw new Error(st.problem);
        const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(st.from);
        const sender = m ? { name: (m[1] || '').trim() || undefined, email: m[2].trim() } : { email: st.from };
        let r;
        try {
          r = await (opts.fetch || fetch)('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: { 'api-key': clean(cfg.mail.brevoKey), 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text }),
            signal: AbortSignal.timeout(15000),
          });
        } catch (e) { throw new Error(`ติดต่อ Brevo ไม่ได้ (${e.name === 'TimeoutError' ? 'หมดเวลา' : e.message})`); }
        if (!r.ok) {
          const raw = redact(await r.text().catch(() => ''));
          let body = {};
          try { body = JSON.parse(raw); } catch { /* ไม่ใช่ JSON */ }
          const hint = brevoHint(r.status, body);
          throw new Error(`Brevo ตอบ ${r.status}${body.code ? ` (${body.code})` : ''}: ${(body.message || raw).slice(0, 200)}${hint ? ` → ${hint}` : ''}`);
        }
        log(`[mail] ส่งผ่าน Brevo แล้ว ถึง ${to}: ${subject}`);
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

module.exports = { createMailer, mailStatus, brevoHint };

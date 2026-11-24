'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { loadConfig } = require('../src/config');
const { createMailer } = require('../src/mailer');

const prod = (extra = {}) => ({
  NODE_ENV: 'production', DATABASE_FILE: ':memory:', BASE_URL: 'https://shop.example.com', ADMIN_EMAIL: 'a@b.co', ADMIN_PASSWORD: 'x'.repeat(14),
  DOWNLOAD_LINK_SECRET: crypto.randomBytes(32).toString('hex'), PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex'),
  PAYMENT_PROVIDER: 'manual', PROMPTPAY_ID: '0812345678', PROMPTPAY_NAME: 'ร้าน', LEGAL_NAME: 'ร้านทดสอบ', CONTACT_EMAIL: 'c@d.co', ...extra,
});

test('MAIL_MODE=off ใช้ได้ตอน production (ยังไม่มี SMTP) และไม่ส่ง/ไม่พิมพ์ลิงก์ลง log', async () => {
  const cfg = loadConfig(prod({ MAIL_MODE: 'off' }));
  const logs = [];
  const m = createMailer(cfg, { log: (x) => logs.push(x) });
  await m.send({ to: 'u@x.co', subject: 'ตั้งรหัสผ่านใหม่', text: 'https://shop.example.com/reset?t=SECRET' });
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes('SECRET'));
});

test('production: console ยังห้าม และชื่อโหมดที่ไม่รู้จักถูกปฏิเสธ', () => {
  assert.throws(() => loadConfig(prod()), /MAIL_MODE/);
  assert.throws(() => loadConfig(prod({ MAIL_MODE: 'smtpp' })), /MAIL_MODE/);
});

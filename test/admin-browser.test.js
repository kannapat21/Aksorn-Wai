'use strict';
// หน้าหลังบ้านต้องเปิดได้ในโหมดเรนเดอร์บนเบราว์เซอร์ (เซิร์ฟเวอร์ไม่มี ffmpeg/Chrome) · เคยล้มเป็นหน้า "เกิดข้อผิดพลาด" บน Render
process.env.NODE_ENV = 'test';
const { test, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-'));
let server;
after(() => { if (server) server.close(); });

test('แอดมินเปิด /admin และ /admin/transfers ได้เมื่อ RENDER_MODE=browser', async () => {
  const cfg = loadConfig({
    NODE_ENV: 'test', DATABASE_FILE: ':memory:', DOWNLOAD_LINK_SECRET: crypto.randomBytes(32).toString('hex'), PAYMENT_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex'),
    ADMIN_EMAIL: 'admin@x.co', ADMIN_PASSWORD: 'long-admin-pass-1', PAYMENT_PROVIDER: 'manual', PROMPTPAY_ID: '0812345678', RENDER_MODE: 'browser', GROQ_API_KEY: 'k',
    MAIL_MODE: 'off', BASE_URL: 'http://localhost', RATE_GLOBAL_PER_MIN: '0', CUSTOM_DIR: path.join(dir, 'c'), USER_FONT_DIR: path.join(dir, 'f'), SUBTITLE_DIR: path.join(dir, 's'),
  });
  const ctx = createApp(cfg, { log: () => {} });
  server = await new Promise((r) => { const s = ctx.app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let jar = '';
  const grab = (r) => { for (const c of r.headers.getSetCookie()) jar += `${c.split(';')[0]}; `; };
  let r = await fetch(`${base}/login`); grab(r);
  const csrf = decodeURIComponent((jar.match(/csrf=([^;]+)/) || [])[1] || '');
  r = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { cookie: jar, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf, email: 'admin@x.co', password: 'long-admin-pass-1' }) });
  grab(r);
  assert.equal(r.status, 303);
  r = await fetch(`${base}/admin`, { headers: { cookie: jar } });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /เบราว์เซอร์ของลูกค้า/);
  r = await fetch(`${base}/admin/transfers`, { headers: { cookie: jar } });
  assert.equal(r.status, 200);
});

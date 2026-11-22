'use strict';
/*
 * โหลดค่าตั้งค่าจาก .env และ config/*.json
 * ถ้ายังไม่มี .env จะสร้างให้อัตโนมัติจาก .env.example พร้อมสุ่ม secret (เพื่อให้รันในเครื่องได้ด้วยคำสั่งเดียว)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function ensureEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath) || process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') return;
  const rnd = (n) => crypto.randomBytes(n).toString('hex');
  const adminPw = crypto.randomBytes(9).toString('base64url');
  const text = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')
    .replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${adminPw}`)
    .replace(/^DOWNLOAD_LINK_SECRET=.*$/m, `DOWNLOAD_LINK_SECRET=${rnd(32)}`)
    .replace(/^PAYMENT_WEBHOOK_SECRET=.*$/m, `PAYMENT_WEBHOOK_SECRET=${rnd(32)}`);
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  console.log('สร้างไฟล์ .env ให้แล้ว (สุ่ม secret ใหม่)');
  console.log(`  รหัสผ่านหลังบ้าน /admin  ผู้ใช้: admin  รหัส: ${adminPw}`);
}

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

// ฟอนต์ที่เลือกได้ตอนปรับแต่ง: ใช้เฉพาะตัวที่มีทั้งไฟล์ฟอนต์และไฟล์สัญญา OFL อยู่จริง
function loadFonts() {
  return loadJson('config/fonts.json').fonts.map((f) => ({
    ...f,
    url: `/fonts/thai/${f.id}/${f.file}`,
    path: path.join(ROOT, 'public', 'fonts', 'thai', f.id, f.file),
    licensePath: path.join(ROOT, 'public', 'fonts', 'thai', f.id, 'OFL.txt'),
  })).filter((f) => fs.existsSync(f.path) && fs.existsSync(f.licensePath));
}

function loadConfig(overrides = {}) {
  ensureEnvFile();
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const env = { ...process.env, ...overrides };

  const cfg = {
    root: ROOT,
    env: env.NODE_ENV || 'development',
    port: Number(env.PORT || 3000),
    baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, ''),
    shopName: env.SHOP_NAME || 'อักษรไหว',
    databaseFile: env.DATABASE_FILE || './data/shop.db',
    adminPassword: env.ADMIN_PASSWORD || '',
    downloadSecret: env.DOWNLOAD_LINK_SECRET || '',
    // ลิงก์ดาวน์โหลดที่เซ็นแล้ว สร้างใหม่ทุกครั้งที่กดในคลัง ใช้ได้กี่นาที
    linkMinutes: Number(env.DOWNLOAD_LINK_MINUTES || 10),
    // กันการโหลดผิดปกติ: บัญชีหนึ่งกดดาวน์โหลดได้กี่ไฟล์ต่อ 24 ชั่วโมง
    dailyDownloadLimit: Number(env.DOWNLOAD_DAILY_LIMIT || 60),
    sessionDays: Number(env.SESSION_DAYS || 30),
    paymentProvider: env.PAYMENT_PROVIDER || 'mock',
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET || '',
    paymentApiKey: env.PAYMENT_API_KEY || '',
    mail: {
      mode: env.MAIL_MODE || 'console',
      from: env.MAIL_FROM || 'no-reply@example.com',
      host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER, pass: env.SMTP_PASS,
    },
    storageDir: path.resolve(ROOT, env.STORAGE_DIR || 'storage/products'),
    // ไฟล์ที่ลูกค้าปรับแต่งเอง (เก็บถาวร ให้โหลดซ้ำจากคลังได้)
    customDir: path.resolve(ROOT, env.CUSTOM_DIR || 'storage/custom'),
    customConcurrency: Number(env.CUSTOM_CONCURRENCY || 1), // เรนเดอร์พร้อมกันได้กี่งานทั้งร้าน
    customMaxActive: Number(env.CUSTOM_MAX_ACTIVE || 1), // บัญชีหนึ่งมีงานรอ/กำลังทำได้กี่งาน
    customDailyLimit: Number(env.CUSTOM_DAILY_LIMIT || 0), // จำกัดครั้งต่อ 24 ชม. (0 = ไม่จำกัด)
    customStorageMb: Number(env.CUSTOM_STORAGE_MB || 3000), // พื้นที่เก็บ "เวอร์ชันของฉัน" ต่อบัญชี
    userFontDir: path.resolve(ROOT, env.USER_FONT_DIR || 'storage/user-fonts'),
    userFontMax: Number(env.USER_FONT_MAX || 20), // ฟอนต์ที่อัปโหลดได้ต่อบัญชี
    fonts: loadFonts(),
    products: overrides.products || loadJson('config/products.json'),
    editorsConfig: overrides.editorsConfig || loadJson('config/editors.json'),
  };
  if (!path.isAbsolute(cfg.databaseFile) && cfg.databaseFile !== ':memory:') {
    cfg.databaseFile = path.resolve(ROOT, cfg.databaseFile);
  }

  const problems = [];
  if (cfg.downloadSecret.length < 32) problems.push('DOWNLOAD_LINK_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร');
  if (cfg.webhookSecret.length < 32) problems.push('PAYMENT_WEBHOOK_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร');
  if (cfg.env === 'production') {
    if (cfg.paymentProvider === 'mock') problems.push('ห้ามใช้ PAYMENT_PROVIDER=mock ตอน NODE_ENV=production');
    if (!cfg.baseUrl.startsWith('https://')) problems.push('BASE_URL ต้องเป็น https ตอนขายจริง');
    if (cfg.mail.mode === 'console') problems.push('MAIL_MODE=console ใช้ได้เฉพาะตอนทดสอบ');
  }
  if (problems.length) {
    const e = new Error('ตั้งค่าไม่ครบ:\n - ' + problems.join('\n - '));
    e.configProblems = problems;
    throw e;
  }

  // ตรวจว่าแต่ละสินค้ามีไฟล์ครบตาม manifest
  for (const p of cfg.products) {
    const mf = path.join(cfg.storageDir, p.slug, 'manifest.json');
    if (!fs.existsSync(mf)) throw new Error(`สินค้า ${p.slug} ยังไม่มีไฟล์ (รัน npm run render -- --text "..." --slug ${p.slug})`);
    p.manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  }
  for (const [id, ed] of Object.entries(cfg.editorsConfig.editors)) {
    for (const f of ed.formats) {
      if (!cfg.editorsConfig.formats[f]) throw new Error(`config/editors.json: โปรแกรม ${id} อ้างถึงฟอร์แมต ${f} ที่ไม่มี`);
    }
  }
  return cfg;
}

module.exports = { loadConfig, ROOT };

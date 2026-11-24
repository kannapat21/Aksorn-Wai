'use strict';
/*
 * โหลดค่าตั้งค่าจาก .env และ config/*.json
 * ถ้ายังไม่มี .env จะสร้างให้อัตโนมัติจาก .env.example พร้อมสุ่ม secret (เพื่อให้รันในเครื่องได้ด้วยคำสั่งเดียว)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
// ท่าเคลื่อนไหวชุดเดียวกับที่เบราว์เซอร์ใช้ (public/motion.js ลงทะเบียนเป็น globalThis.TTMotion)
require('../public/motion.js');
const MOTIONS = globalThis.TTMotion.MOTIONS;

// รันบนโฮสต์แบบ serverless (Netlify/Vercel/AWS Lambda): ไม่มีดิสก์ถาวร ไม่มี Chrome/ffmpeg เขียนได้แค่ /tmp
function isServerless(env) {
  return env.SERVERLESS === '1' || Boolean(env.NETLIFY || env.AWS_LAMBDA_FUNCTION_NAME || env.VERCEL);
}

function ensureEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (isServerless(process.env) || fs.existsSync(envPath) || process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') return;
  const rnd = (n) => crypto.randomBytes(n).toString('hex');
  const adminPw = crypto.randomBytes(18).toString('base64url'); // 24 ตัวอักษร สุ่ม
  const text = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8')
    .replace(/^ADMIN_EMAIL=.*$/m, 'ADMIN_EMAIL=admin@aksornwai.local')
    .replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${adminPw}`)
    .replace(/^DOWNLOAD_LINK_SECRET=.*$/m, `DOWNLOAD_LINK_SECRET=${rnd(32)}`)
    .replace(/^PAYMENT_WEBHOOK_SECRET=.*$/m, `PAYMENT_WEBHOOK_SECRET=${rnd(32)}`);
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  console.log('สร้างไฟล์ .env ให้แล้ว (สุ่ม secret ใหม่)');
  console.log(`  เข้าหลังบ้านที่หน้าเข้าสู่ระบบปกติ  อีเมล: admin@aksornwai.local  รหัส: ${adminPw}`);
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
  const serverless = isServerless(env);
  // ที่เก็บไฟล์ชั่วคราว: บน serverless เขียนได้แค่ /tmp
  const writable = (rel, envName) => path.resolve(serverless ? path.join(require('os').tmpdir(), 'aksornwai') : ROOT, env[envName] || rel);

  const cfg = {
    root: ROOT,
    env: env.NODE_ENV || 'development',
    port: Number(env.PORT || 3000),
    baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, ''),
    shopName: env.SHOP_NAME || 'อักษรไหว',
    // DATABASE_URL (libsql://...turso.io) ใช้ฐานข้อมูลบน Turso แทนไฟล์ในเครื่อง (จำเป็นบน Netlify ที่ไม่มีดิสก์ถาวร)
    databaseFile: env.DATABASE_URL || env.DATABASE_FILE || './data/shop.db',
    databaseAuthToken: env.DATABASE_AUTH_TOKEN || '',
    // บัญชีแอดมินสร้าง/ซิงก์จาก .env ทุกครั้งที่เปิดร้าน (ล็อกอินที่หน้าเข้าสู่ระบบปกติ)
    adminEmail: String(env.ADMIN_EMAIL || '').trim().toLowerCase(),
    adminPassword: env.ADMIN_PASSWORD || '',
    downloadSecret: env.DOWNLOAD_LINK_SECRET || '',
    // ลิงก์ดาวน์โหลดที่เซ็นแล้ว สร้างใหม่ทุกครั้งที่กดในคลัง ใช้ได้กี่นาที
    linkMinutes: Number(env.DOWNLOAD_LINK_MINUTES || 10),
    // กันการโหลดผิดปกติ: บัญชีหนึ่งกดดาวน์โหลดได้กี่ไฟล์ต่อ 24 ชั่วโมง
    dailyDownloadLimit: Number(env.DOWNLOAD_DAILY_LIMIT || 60),
    sessionDays: Number(env.SESSION_DAYS || 30),
    // จำกัดคำขอทั้งเว็บต่อ IP ต่อนาที (กันสแปม/บอท) · 0 = ปิด
    rateGlobalPerMin: Number(env.RATE_GLOBAL_PER_MIN || 600),
    rateSignupPerHour: Number(env.RATE_SIGNUP_PER_HOUR || 10), // สมัครสมาชิกได้กี่ครั้งต่อ IP ต่อชั่วโมง
    // ข้อมูลร้านที่แสดงในหน้านโยบาย (เว้นว่าง = แสดงช่องให้กรอก)
    legal: {
      name: env.LEGAL_NAME || '', contactEmail: env.CONTACT_EMAIL || '', phone: env.CONTACT_PHONE || '', line: env.CONTACT_LINE || '',
      address: env.CONTACT_ADDRESS || '', taxId: env.TAX_ID || '', refundDays: Number(env.REFUND_DAYS || 7),
    },
    paymentProvider: env.PAYMENT_PROVIDER || 'mock',
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET || '',
    paymentApiKey: env.PAYMENT_API_KEY || '',
    omise: {
      publicKey: env.OMISE_PUBLIC_KEY || '', secretKey: env.OMISE_SECRET_KEY || '', webhookSecret: env.OMISE_WEBHOOK_SECRET || '',
      apiBase: env.OMISE_API_BASE || 'https://api.omise.co', // เปลี่ยนได้เฉพาะตอนเทสต์ (เซิร์ฟเวอร์จำลอง)
      qrMinutes: Number(env.OMISE_QR_MINUTES || 15), // QR PromptPay หมดอายุกี่นาที (ไม่เกิน 24 ชม.)
    },
    // โอนเงินแล้วกดยืนยัน (PAYMENT_PROVIDER=manual): ข้อมูลรับเงินอยู่ใน .env เท่านั้น ห้ามใส่ในโค้ด/ห้าม commit
    transfer: {
      promptpayId: String(env.PROMPTPAY_ID || '').replace(/[\s-]/g, ''),
      promptpayName: env.PROMPTPAY_NAME || '',
      bankName: env.BANK_NAME || '', bankAccountNo: String(env.BANK_ACCOUNT_NO || '').trim(), bankAccountName: env.BANK_ACCOUNT_NAME || '',
      expireHours: Number(env.MANUAL_EXPIRE_HOURS || 24), // ออเดอร์ที่ยังไม่โอน/ถูกปฏิเสธ เก็บไว้กี่ชั่วโมงก่อนหมดอายุ
      maxConfirms: Number(env.MANUAL_MAX_CONFIRMS || 5), // กดยืนยันได้กี่ครั้งต่อออเดอร์ (กันกดรัว)
      // 1 = บวกเศษสตางค์ไม่ซ้ำต่อออเดอร์ (จับคู่ง่ายแต่ลูกค้าเห็นยอดไม่ตรงราคา) · ค่าเริ่มต้น 0 = ยอดตรงราคาเป๊ะ จับคู่ด้วยยอด+เวลาโอน+รหัสอ้างอิง
      uniqueSatang: env.MANUAL_UNIQUE_SATANG === '1',
    },
    // ปุ่ม "จำลองจ่ายสำเร็จ" ของโหมด mock: กดได้เฉพาะแอดมิน หรือคนที่เปิดจากเครื่องร้านเอง (localhost) คนภายนอกกดไม่ได้
    mockAllowPublic: env.MOCK_ALLOW_PUBLIC === '1',
    mail: {
      // ตั้ง SMTP_HOST แล้วไม่ได้ระบุ MAIL_MODE = ส่งจริงผ่าน SMTP · ไม่ได้ตั้ง = พิมพ์ลงหน้าจอ (โหมดทดสอบ)
      mode: env.MAIL_MODE || (env.SMTP_HOST ? 'smtp' : 'console'),
      from: env.MAIL_FROM || 'no-reply@example.com',
      host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER, pass: env.SMTP_PASS,
    },
    storageDir: path.resolve(ROOT, env.STORAGE_DIR || 'storage/products'),
    // ไฟล์ที่ลูกค้าปรับแต่งเอง (เก็บถาวร ให้โหลดซ้ำจากคลังได้)
    customDir: writable('storage/custom', 'CUSTOM_DIR'),
    customConcurrency: Number(env.CUSTOM_CONCURRENCY || 1), // เรนเดอร์พร้อมกันได้กี่งานทั้งร้าน
    customMaxActive: Number(env.CUSTOM_MAX_ACTIVE || 1), // บัญชีหนึ่งมีงานรอ/กำลังทำได้กี่งาน
    customDailyLimit: Number(env.CUSTOM_DAILY_LIMIT || 0), // จำกัดครั้งต่อ 24 ชม. (0 = ไม่จำกัด)
    customStorageMb: Number(env.CUSTOM_STORAGE_MB || 3000), // พื้นที่เก็บ "เวอร์ชันของฉัน" ต่อบัญชี
    userFontDir: writable('storage/user-fonts', 'USER_FONT_DIR'),
    serverless,
    // server = เครื่องร้านเรนเดอร์เอง (Chrome + ffmpeg) · browser = เบราว์เซอร์ของลูกค้าเรนเดอร์ เซิร์ฟเวอร์ใช้แรมแทบไม่มี
    renderMode: env.RENDER_MODE || (serverless ? 'browser' : 'server'),
    // ไฟล์สินค้าและฟอนต์ลูกค้า: local = โฟลเดอร์ในเครื่อง · supabase = Supabase Storage (ลิงก์ดาวน์โหลดเซ็นชั่วคราว)
    storage: {
      driver: env.STORAGE_DRIVER || (env.SUPABASE_URL ? 'supabase' : 'local'),
      supabaseUrl: String(env.SUPABASE_URL || '').replace(/\/+$/, ''),
      supabaseKey: env.SUPABASE_SERVICE_KEY || '',
      bucket: env.SUPABASE_BUCKET || 'shop-files',
    },
    // ถอดเสียงด้วย Groq (Whisper large-v3 บนคลาวด์ ฟรีตามโควตา) ใช้เมื่อ SUBTITLE_ENGINE=groq
    groq: { apiKey: env.GROQ_API_KEY || '', model: env.GROQ_MODEL || 'whisper-large-v3', apiBase: env.GROQ_API_BASE || 'https://api.groq.com/openai/v1' },
    userFontMax: Number(env.USER_FONT_MAX || 20), // ฟอนต์ที่อัปโหลดได้ต่อบัญชี
    // ซับอัตโนมัติ: ลูกค้าอัปคลิป ร้านถอดเสียงด้วย Whisper ในเครื่อง แล้วเบิร์นซับด้วยแบบในคลัง
    subtitles: {
      engine: env.SUBTITLE_ENGINE || (env.GROQ_API_KEY ? 'groq' : 'auto'), // auto | mlx | faster-whisper | groq | off
      python: env.SUBTITLE_PYTHON || (fs.existsSync(path.join(ROOT, '.venv-stt', 'bin', 'python')) ? path.join(ROOT, '.venv-stt', 'bin', 'python') : 'python3'),
      model: env.SUBTITLE_MODEL || '', // ว่าง = whisper-large-v3-turbo
      dir: writable('storage/subtitles', 'SUBTITLE_DIR'),
      maxMb: Number(env.SUBTITLE_MAX_MB || 300), // ขนาดคลิปสูงสุด
      maxSeconds: Number(env.SUBTITLE_MAX_SECONDS || 180), // ความยาวคลิปสูงสุด (วินาที)
      dailyLimit: Number(env.SUBTITLE_DAILY_LIMIT || 5), // อัปคลิปได้กี่คลิปต่อบัญชีต่อ 24 ชม. (0 = ไม่จำกัด)
      retentionHours: Number(env.SUBTITLE_RETENTION_HOURS || 24), // ลบคลิปลูกค้าและไฟล์ที่ได้อัตโนมัติหลังกี่ชั่วโมง
      concurrency: Number(env.SUBTITLE_CONCURRENCY || 1),
      asrTimeoutMin: Number(env.SUBTITLE_ASR_TIMEOUT_MIN || 20),
    },
    fonts: loadFonts(),
    products: overrides.products || loadJson('config/products.json'),
    editorsConfig: overrides.editorsConfig || loadJson('config/editors.json'),
  };
  if (!/^[a-z]+:\/\//.test(cfg.databaseFile) && !path.isAbsolute(cfg.databaseFile) && cfg.databaseFile !== ':memory:') {
    cfg.databaseFile = path.resolve(ROOT, cfg.databaseFile);
  }

  const problems = [];
  if (cfg.downloadSecret.length < 32) problems.push('DOWNLOAD_LINK_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร');
  // Omise: ต้องมีคีย์ครบ · คีย์จริง (ไม่มี _test_) ใช้ได้เฉพาะตอน NODE_ENV=production · มีคีย์จริงอยู่ห้ามใช้ mock
  const O = cfg.omise;
  const liveKey = [O.publicKey, O.secretKey].some((k) => k && !/_test_/.test(k));
  if (cfg.paymentProvider === 'omise') {
    if (!/^pkey_/.test(O.publicKey) || !/^skey_/.test(O.secretKey)) problems.push('ตั้ง OMISE_PUBLIC_KEY (pkey_...) และ OMISE_SECRET_KEY (skey_...) ใน .env');
    // ขายจริงต้องมี webhook secret · ช่วงทดสอบยังไม่ตั้งก็ได้ (ระบบถามสถานะจาก Omise เองระหว่างลูกค้ารอ แต่ webhook จะถูกปฏิเสธ)
    if (!O.webhookSecret && cfg.env === 'production') problems.push('ตั้ง OMISE_WEBHOOK_SECRET (จากหน้า Webhooks ใน dashboard ของ Omise)');
    if (liveKey && cfg.env !== 'production') problems.push('คีย์ Omise เป็นคีย์จริง (ไม่มี _test_) ใช้ได้เฉพาะตอน NODE_ENV=production');
    if (cfg.env === 'production' && !liveKey && O.secretKey) problems.push('ขายจริงต้องใช้คีย์จริงของ Omise (ตอนนี้เป็นคีย์ทดสอบ)');
  }
  if (cfg.paymentProvider === 'manual') {
    const T = cfg.transfer;
    const bank = T.bankName && T.bankAccountNo && T.bankAccountName;
    if (!T.promptpayId && !bank) problems.push('ตั้ง PROMPTPAY_ID (เบอร์มือถือ 10 หลัก หรือเลข 13 หลัก) และ/หรือ BANK_NAME + BANK_ACCOUNT_NO + BANK_ACCOUNT_NAME ใน .env');
    if (T.promptpayId && !require('./promptpay').normalizeId(T.promptpayId)) problems.push('PROMPTPAY_ID ต้องเป็นเบอร์มือถือ 10 หลัก (0xxxxxxxxx) หรือเลข 13 หลัก');
    if (!(T.expireHours >= 1 && T.expireHours <= 720)) problems.push('MANUAL_EXPIRE_HOURS ต้องอยู่ระหว่าง 1–720');
    if (!(T.maxConfirms >= 1 && T.maxConfirms <= 20)) problems.push('MANUAL_MAX_CONFIRMS ต้องอยู่ระหว่าง 1–20');
    if (!cfg.adminEmail || cfg.adminPassword.length < 12) problems.push('โหมดโอนเงินต้องมีแอดมินไว้อนุมัติ: ตั้ง ADMIN_EMAIL และ ADMIN_PASSWORD (อย่างน้อย 12 ตัวอักษร)');
  }
  if (cfg.paymentProvider === 'mock' && liveKey) problems.push('มีคีย์ Omise จริงอยู่ใน .env ห้ามใช้ PAYMENT_PROVIDER=mock');
  if (!(O.qrMinutes > 0 && O.qrMinutes <= 24 * 60)) problems.push('OMISE_QR_MINUTES ต้องอยู่ระหว่าง 1–1440');
  if (cfg.webhookSecret.length < 32) problems.push('PAYMENT_WEBHOOK_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร');
  if (cfg.env === 'production') {
    if (cfg.paymentProvider === 'mock') problems.push('ห้ามใช้ PAYMENT_PROVIDER=mock ตอน NODE_ENV=production');
    if (!cfg.baseUrl.startsWith('https://')) problems.push('BASE_URL ต้องเป็น https ตอนขายจริง');
    if (cfg.mail.mode === 'console') problems.push('MAIL_MODE=console ใช้ได้เฉพาะตอนทดสอบ');
    if (cfg.mail.mode === 'smtp' && (!cfg.mail.host || !cfg.mail.user || !cfg.mail.pass)) problems.push('ตั้ง SMTP_HOST / SMTP_USER / SMTP_PASS ให้ครบ');
    if (!cfg.legal.name || !cfg.legal.contactEmail) problems.push('ตั้ง LEGAL_NAME และ CONTACT_EMAIL สำหรับหน้านโยบาย');
  }
  const S = cfg.subtitles;
  if (!['auto', 'mlx', 'faster-whisper', 'groq', 'off'].includes(S.engine)) problems.push('SUBTITLE_ENGINE ต้องเป็น auto / mlx / faster-whisper / groq / off');
  if (S.engine === 'groq' && !cfg.groq.apiKey) problems.push('SUBTITLE_ENGINE=groq ต้องตั้ง GROQ_API_KEY (สมัครฟรีที่ console.groq.com)');
  if (!['server', 'browser'].includes(cfg.renderMode)) problems.push('RENDER_MODE ต้องเป็น server หรือ browser');
  if (cfg.renderMode === 'browser' && S.engine !== 'groq' && S.engine !== 'off') problems.push('RENDER_MODE=browser ถอดเสียงในเซิร์ฟเวอร์ไม่ได้: ตั้ง GROQ_API_KEY (หรือ SUBTITLE_ENGINE=off)');
  const ST = cfg.storage;
  if (!['local', 'supabase'].includes(ST.driver)) problems.push('STORAGE_DRIVER ต้องเป็น local หรือ supabase');
  if (ST.driver === 'supabase' && (!/^https:\/\//.test(ST.supabaseUrl) || !ST.supabaseKey)) problems.push('ตั้ง SUPABASE_URL (https://xxxx.supabase.co) และ SUPABASE_SERVICE_KEY ให้ครบ');
  if (serverless && ST.driver === 'local') problems.push('บน Netlify ต้องเก็บไฟล์สินค้าบน Supabase: ตั้ง SUPABASE_URL และ SUPABASE_SERVICE_KEY');
  if (serverless && /^\//.test(cfg.databaseFile) && !/^[a-z]+:\/\//.test(env.DATABASE_URL || '')) problems.push('บน Netlify ต้องใช้ฐานข้อมูล Turso: ตั้ง DATABASE_URL (libsql://...) และ DATABASE_AUTH_TOKEN');
  if (!(S.maxMb >= 5 && S.maxMb <= 4000)) problems.push('SUBTITLE_MAX_MB ต้องอยู่ระหว่าง 5–4000');
  if (!(S.maxSeconds >= 10 && S.maxSeconds <= 1800)) problems.push('SUBTITLE_MAX_SECONDS ต้องอยู่ระหว่าง 10–1800');
  if (!(S.retentionHours >= 1 && S.retentionHours <= 720)) problems.push('SUBTITLE_RETENTION_HOURS ต้องอยู่ระหว่าง 1–720');
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
    p.motion = p.motion || p.manifest.motion || 'pop'; // ท่าเคลื่อนไหว ใช้ทั้งพรีวิวสดและไฟล์จริง (ดู public/motion.js)
    if (!MOTIONS.includes(p.motion)) throw new Error(`สินค้า ${p.slug}: motion ต้องเป็น ${MOTIONS.join(' / ')}`);
    // ราคาเป็นสตางค์ · 0 = ของฟรี (กดรับแล้วเข้าคลังทันที ไม่ผ่านหน้าจ่ายเงิน)
    if (!Number.isInteger(p.price) || p.price < 0) throw new Error(`สินค้า ${p.slug}: price ต้องเป็นจำนวนเต็ม (สตางค์) ตั้งแต่ 0 ขึ้นไป`);
    if (p.price > 0 && p.price < 2000) throw new Error(`สินค้า ${p.slug}: ราคาต่ำสุด ฿20 (หรือ 0 = ฟรี)`);
    p.free = p.price === 0;
    p.premium = globalThis.TTMotion.meta(p.motion).premium;
  }
  for (const [id, ed] of Object.entries(cfg.editorsConfig.editors)) {
    for (const f of ed.formats) {
      if (!cfg.editorsConfig.formats[f]) throw new Error(`config/editors.json: โปรแกรม ${id} อ้างถึงฟอร์แมต ${f} ที่ไม่มี`);
    }
  }
  return cfg;
}

module.exports = { loadConfig, ROOT };

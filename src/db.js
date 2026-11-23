'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id            TEXT PRIMARY KEY,
      product_slug  TEXT NOT NULL,
      editor        TEXT NOT NULL,
      email         TEXT NOT NULL,
      amount        INTEGER NOT NULL,          -- หน่วยสตางค์
      currency      TEXT NOT NULL DEFAULT 'THB',
      status        TEXT NOT NULL DEFAULT 'pending', -- pending | paid
      provider      TEXT NOT NULL,
      payment_ref   TEXT,
      created_at    INTEGER NOT NULL,
      paid_at       INTEGER,
      last_email_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at);

    -- กันประมวลผล webhook ซ้ำ: event_id เดิมจะถูกข้าม
    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id    TEXT PRIMARY KEY,
      provider    TEXT NOT NULL,
      order_id    TEXT,
      type        TEXT,
      received_at INTEGER NOT NULL
    );

    -- สิทธิ์ดาวน์โหลด = 1 ลิงก์ (อายุ 7 วัน ไฟล์ละ 10 ครั้ง)
    -- ลูกค้าซื้อแล้วใช้ได้ตลอด: ขอลิงก์ใหม่ได้เรื่อยๆ แต่ละครั้งได้ grant ใหม่
    -- (กันสร้างซ้ำจาก webhook ซ้ำด้วยสถานะคำสั่งซื้อ pending → paid ที่เปลี่ยนได้ครั้งเดียว)
    CREATE TABLE IF NOT EXISTS download_grants (
      id         TEXT PRIMARY KEY,
      order_id   TEXT NOT NULL REFERENCES orders(id),
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      reason     TEXT NOT NULL DEFAULT 'purchase' -- purchase | lookup | admin (รุ่นก่อน) | library
    );

    CREATE TABLE IF NOT EXISTS download_counts (
      grant_id TEXT NOT NULL REFERENCES download_grants(id),
      file     TEXT NOT NULL,
      count    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (grant_id, file)
    );
  `);
  migrateGrants(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS grants_order ON download_grants(order_id, created_at);

    -- บัญชีลูกค้า (รหัสผ่านเก็บเป็น scrypt ดู src/auth.js)
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      editor        TEXT NOT NULL DEFAULT '',   -- โปรแกรมที่ใช้ล่าสุด (จำไว้ให้ในคลัง)
      created_at    INTEGER NOT NULL
    );

    -- เซสชัน: เก็บ SHA-256 ของ token ในคุกกี้ ไม่เก็บ token ตรงๆ
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

    -- ประวัติดาวน์โหลดจากคลัง (ใช้จำกัดจำนวนต่อวัน และทำสถิติในหลังบ้าน)
    CREATE TABLE IF NOT EXISTS download_log (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id  TEXT NOT NULL,
      order_id TEXT NOT NULL,
      file     TEXT NOT NULL,
      editor   TEXT NOT NULL,
      at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS download_log_user ON download_log(user_id, at);
  `);
  // ยืนยันอีเมล / ลืมรหัสผ่าน: เก็บแค่ SHA-256 ของโทเคน ใช้ได้ครั้งเดียว มีวันหมดอายุ
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_tokens (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,   -- verify | reset
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS email_tokens_user ON email_tokens(user_id, kind, created_at);
  `);
  if (!db.prepare('PRAGMA table_info(users)').all().some((x) => x.name === 'role')) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer'"); // customer | admin
  }
  if (!db.prepare('PRAGMA table_info(users)').all().some((x) => x.name === 'email_verified_at')) {
    db.exec('ALTER TABLE users ADD COLUMN email_verified_at INTEGER');
  }
  // คำสั่งซื้อผูกกับบัญชี (ฐานข้อมูลรุ่นก่อนไม่มีคอลัมน์นี้)
  if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'user_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN user_id TEXT REFERENCES users(id)');
  }
  db.exec('CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, status)');
  // โอนเงินแล้วกดยืนยัน (PAYMENT_PROVIDER=manual): ยอดโอนไม่ซ้ำต่อออเดอร์ที่ยังเปิดอยู่ + รหัสอ้างอิง + ผลการตรวจของแอดมิน
  const orderCols = new Set(db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name));
  for (const [name, type] of [['transfer_amount', 'INTEGER'], ['pay_ref', 'TEXT'], ['confirmed_at', 'INTEGER'], ['transfer_time', 'TEXT'],
    ['reviewed_by', 'TEXT'], ['reviewed_at', 'INTEGER'], ['review_note', 'TEXT'], ['confirm_count', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!orderCols.has(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${type}`);
  }
  db.exec(`
    DROP INDEX IF EXISTS orders_open_transfer; -- รุ่นก่อนบังคับยอดไม่ซ้ำที่ฐานข้อมูล ตอนนี้เป็นตัวเลือก (MANUAL_UNIQUE_SATANG) เช็คในโค้ด
    CREATE INDEX IF NOT EXISTS orders_open_transfer_amt ON orders(transfer_amount)
      WHERE transfer_amount IS NOT NULL AND status IN ('pending','review','rejected');
    CREATE UNIQUE INDEX IF NOT EXISTS orders_pay_ref ON orders(pay_ref) WHERE pay_ref IS NOT NULL;
    -- บันทึกการตรวจสอบ: ใครทำอะไรกับออเดอร์ไหน เมื่อไหร่ (แก้/ลบผ่านเว็บไม่ได้)
    CREATE TABLE IF NOT EXISTS payment_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id    TEXT NOT NULL,
      actor_id    TEXT,
      actor_email TEXT,
      action      TEXT NOT NULL,   -- customer_confirm | approve | reject | expire
      detail      TEXT,
      at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS payment_audit_at ON payment_audit(at);
  `);
  return db;
}

// ฐานข้อมูลรุ่นแรกบังคับ 1 คำสั่งซื้อ = 1 grant (UNIQUE) → สร้างตารางใหม่โดยคงข้อมูลเดิม
function migrateGrants(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'download_grants'").get();
  if (!row || !/order_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(row.sql)) return;
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE download_grants_new (
        id         TEXT PRIMARY KEY,
        order_id   TEXT NOT NULL REFERENCES orders(id),
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        reason     TEXT NOT NULL DEFAULT 'purchase'
      );
      INSERT INTO download_grants_new (id, order_id, expires_at, created_at)
        SELECT id, order_id, expires_at, created_at FROM download_grants;
      DROP TABLE download_grants;
      ALTER TABLE download_grants_new RENAME TO download_grants;
    `);
  })();
  db.pragma('foreign_keys = ON');
}

module.exports = { openDb };

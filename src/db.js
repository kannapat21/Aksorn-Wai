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
  // คำสั่งซื้อผูกกับบัญชี (ฐานข้อมูลรุ่นก่อนไม่มีคอลัมน์นี้)
  if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'user_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN user_id TEXT REFERENCES users(id)');
  }
  db.exec('CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, status)');
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

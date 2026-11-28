'use strict';
/*
 * ฐานข้อมูล: libSQL (SQLite ที่ต่อกับ Turso บนคลาวด์ได้) ใช้คำสั่งแบบเดียวกับ better-sqlite3 ทุกอย่าง
 *   - ไม่ตั้ง DATABASE_URL  → ไฟล์ในเครื่อง (เหมือนเดิม ใช้ตอนรันบนคอม/เทสต์)
 *   - ตั้ง DATABASE_URL=libsql://...turso.io + DATABASE_AUTH_TOKEN → ฐานข้อมูลบน Turso (ใช้บน Netlify)
 * ห่อไว้ชั้นเดียวเพื่อให้ผลลัพธ์เหมือน better-sqlite3 เป๊ะ (libsql แถม _metadata ในแถว และรับ null เป็นพารามิเตอร์ไม่ได้)
 */
const Libsql = require('libsql');

function plain(row) {
  if (row && typeof row === 'object' && '_metadata' in row) delete row._metadata;
  return row;
}
// ชื่อพารามิเตอร์แบบ @name / :name / $name ตามลำดับที่ปรากฏครั้งแรกใน SQL (ตัดข้อความในเครื่องหมายคำพูดออกก่อน)
// SQLite นับลำดับพารามิเตอร์ตามชื่อที่เจอครั้งแรก จึงส่งเป็นแบบตามตำแหน่งได้ตรงกัน
// (Turso แบบ remote ผูกชื่อให้ไม่ได้ ค่าจะเป็น NULL → "NOT NULL constraint failed" จึงแปลงเป็นตำแหน่งเองทุกกรณี)
function namedOrder(sql) {
  const bare = sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*/g, ' ');
  const names = [];
  for (const m of bare.matchAll(/[@:$]([A-Za-z_][A-Za-z0-9_]*)/g)) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}
// better-sqlite3: get(obj) = พารามิเตอร์แบบชื่อ · get(null/ค่าเดี่ยว) = พารามิเตอร์ตามตำแหน่ง
function args(params, names) {
  if (params.length === 1 && params[0] !== null && typeof params[0] === 'object' && !Array.isArray(params[0]) && !Buffer.isBuffer(params[0])) {
    const o = params[0];
    return [names.map((n) => (o[n] === undefined ? null : o[n]))];
  }
  return [params.flat()];
}

// Turso สะดุด/ทิ้ง stream ที่ว่างนานไป → libsql ใช้ stream เดิมต่อไปตลอด ทุกคำสั่งล้ม "stream not found" จนกว่าจะเปิดใหม่
// (log จริงบน Render 2026-11-28: 502 connect to upstream failed → 404 stream not found ทุกนาที → ร้านล่ม)
// error พวกนี้ = คำสั่งยังไม่ถูกรันบนเซิร์ฟเวอร์ จึงเปิดการเชื่อมต่อใหม่แล้วลองซ้ำได้ปลอดภัย
const RECONNECT_RE = /stream not found|stream expired|connect to upstream failed|status=50[234]\b|Bad Gateway|Service Unavailable|Gateway Timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|socket hang up|connection (?:reset|closed|refused)|error sending request|operation timed out|Hrana\(Http/i;
const isReconnectable = (e) => Boolean(e) && RECONNECT_RE.test(String((e && e.message) || e));

class Statement {
  constructor(owner, sql) {
    this.owner = owner;
    this.sql = sql;
    this.names = namedOrder(sql);
    this.isPluck = false;
    this.gen = -1;
    this.stmt = null;
  }
  raw() {
    if (this.gen !== this.owner.gen || !this.stmt) {
      this.stmt = this.owner.db.prepare(this.sql);
      if (this.isPluck) this.stmt.pluck(true);
      this.gen = this.owner.gen;
    }
    return this.stmt;
  }
  pluck(on = true) { this.isPluck = on; this.owner.retry(() => this.raw().pluck(on)); return this; }
  run(...p) { return this.owner.retry(() => this.raw().run(...args(p, this.names))); }
  get(...p) { return plain(this.owner.retry(() => this.raw().get(...args(p, this.names)))); }
  all(...p) { return this.owner.retry(() => this.raw().all(...args(p, this.names))).map(plain); }
  iterate(...p) { return Array.prototype.map.call(this.all(...p), (x) => x)[Symbol.iterator](); }
}

class Database {
  constructor(file, opts = {}) {
    this.remote = /^(libsql|https?|wss?):\/\//.test(file);
    this.Driver = opts.driver || Libsql;
    this.file = file;
    this.authToken = opts.authToken;
    this.log = opts.log || console.log;
    this.retries = opts.retries == null ? 2 : opts.retries;
    this.gen = 0;
    this.reconnects = 0;
    this.connPragmas = [];
    this.db = this.open();
    this.name = file;
  }
  open() { return new this.Driver(this.file, this.remote ? { authToken: this.authToken || undefined } : {}); }
  reconnect(reason) {
    try { this.db.close(); } catch { /* ปิดไปแล้ว */ }
    this.db = this.open();
    this.gen++;
    this.reconnects++;
    for (const p of this.connPragmas) { try { this.db.exec(`PRAGMA ${p}`); } catch { /* ไม่เป็นไร */ } }
    this.log(`[db] เชื่อมต่อฐานข้อมูลใหม่ (${String(reason).split('\n')[0].slice(0, 160)})`);
  }
  // ลองคำสั่งซ้ำหลังเปิดการเชื่อมต่อใหม่ เฉพาะฐานข้อมูลบนคลาวด์ + error ที่แปลว่าเน็ต/stream หลุด
  retry(fn) {
    for (let attempt = 0; ; attempt++) {
      try {
        return fn();
      } catch (e) {
        if (!this.remote || attempt >= this.retries || !isReconnectable(e)) throw e;
        this.reconnect(e.message || e);
      }
    }
  }
  prepare(sql) { return new Statement(this, sql); }
  exec(sql) { return this.retry(() => this.db.exec(sql)); }
  pragma(source, options = {}) {
    if (/=/.test(source) && !this.connPragmas.includes(source)) this.connPragmas.push(source);
    const rows = this.prepare(`PRAGMA ${source}`).all();
    if (options.simple) return rows.length ? rows[0][Object.keys(rows[0])[0]] : undefined;
    return rows;
  }
  // Turso แบบ remote: แต่ละ exec เป็นคนละ stream, BEGIN ไม่คงอยู่ถึง COMMIT ("cannot commit - no transaction is active")
  // จึงรันตรงๆ ทีละคำสั่ง (autocommit) · ส่วนที่ต้องกันซ้ำใช้ UPDATE ... WHERE เงื่อนไข + ตรวจ changes อยู่แล้ว
  transaction(fn) {
    const db = this;
    if (this.remote) return (...a) => fn(...a);
    return (...a) => {
      db.exec('BEGIN');
      try {
        const r = fn(...a);
        db.exec('COMMIT');
        return r;
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* ปิดไปแล้ว */ }
        throw e;
      }
    };
  }
  close() { this.db.close(); }
}

module.exports = { Database, isReconnectable };

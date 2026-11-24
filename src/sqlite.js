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

class Statement {
  constructor(stmt, sql) { this.stmt = stmt; this.names = namedOrder(sql); this.isPluck = false; }
  pluck(on = true) { this.isPluck = on; this.stmt.pluck(on); return this; }
  run(...p) { return this.stmt.run(...args(p, this.names)); }
  get(...p) { return plain(this.stmt.get(...args(p, this.names))); }
  all(...p) { return this.stmt.all(...args(p, this.names)).map(plain); }
  iterate(...p) { return Array.prototype.map.call(this.all(...p), (x) => x)[Symbol.iterator](); }
}

class Database {
  constructor(file, opts = {}) {
    this.remote = /^(libsql|https?|wss?):\/\//.test(file);
    this.db = new Libsql(file, this.remote ? { authToken: opts.authToken || undefined } : {});
    this.name = file;
  }
  prepare(sql) { return new Statement(this.db.prepare(sql), sql); }
  exec(sql) { return this.db.exec(sql); }
  pragma(source, options = {}) {
    const rows = this.prepare(`PRAGMA ${source}`).all();
    if (options.simple) return rows.length ? rows[0][Object.keys(rows[0])[0]] : undefined;
    return rows;
  }
  transaction(fn) {
    const db = this;
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

module.exports = { Database };

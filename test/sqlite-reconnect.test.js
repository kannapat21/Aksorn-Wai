'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Libsql = require('libsql');
const { Database, isReconnectable } = require('../src/sqlite');

// จำลอง Turso: การเชื่อมต่อที่ "ตาย" ตอบทุกคำสั่งด้วย error แบบเดียวกับ log จริงบน Render
const STREAM_GONE = 'Hrana(Api("status=404 Not Found, body={\\"error\\":\\"stream not found: b7bfcb7a:876\\"}"))';
function fakeDriver() {
  const shared = new Libsql(':memory:');
  const conns = [];
  class Conn {
    constructor() { this.dead = false; this.closed = false; this.pragmas = []; conns.push(this); }
    check() { if (this.dead) throw new Error(STREAM_GONE); }
    prepare(sql) {
      this.check();
      const real = shared.prepare(sql);
      const self = this;
      const w = (fn) => (...a) => { self.check(); return fn.apply(real, a); };
      return { run: w(real.run), get: w(real.get), all: w(real.all), pluck: (on) => { real.pluck(on); } };
    }
    exec(sql) { this.check(); if (/^PRAGMA/.test(sql)) this.pragmas.push(sql); return shared.exec(sql); }
    close() { this.closed = true; }
  }
  return { Conn, conns };
}

test('Turso ทิ้ง stream (404 stream not found): เปิดการเชื่อมต่อใหม่แล้วคำสั่งเดิมสำเร็จ ไม่ล้มต่อเนื่อง', () => {
  const { Conn, conns } = fakeDriver();
  const logs = [];
  const db = new Database('libsql://shop.turso.io', { driver: Conn, log: (m) => logs.push(m) });
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
  const ins = db.prepare('INSERT INTO t (v) VALUES (@v)');
  const count = db.prepare('SELECT count(*) AS n FROM t'); // เตรียมไว้ตั้งแต่เปิดร้าน (เหมือน q.* ในแอป)
  const ids = db.prepare('SELECT id FROM t').pluck();
  ins.run({ v: 'a' });

  conns[0].dead = true; // Turso สะดุด
  assert.equal(count.get().n, 1);
  assert.equal(conns.length, 2);
  assert.equal(conns[0].closed, true);
  assert.deepEqual(conns[1].pragmas, ['PRAGMA foreign_keys = ON']); // ตั้งค่าการเชื่อมต่อซ้ำ
  ins.run({ v: 'b' });
  assert.deepEqual(ids.all(), [1, 2]); // pluck ยังทำงานบนการเชื่อมต่อใหม่
  assert.match(logs.join('\n'), /\[db\] เชื่อมต่อฐานข้อมูลใหม่ \(Hrana/);

  conns[1].dead = true;
  db.exec('DELETE FROM t WHERE id = 1');
  assert.equal(count.get().n, 1);
  assert.equal(db.reconnects, 2);
});

test('Turso ล่มจริง (ต่อใหม่กี่ครั้งก็ไม่ได้): ลองไม่เกิน 2 ครั้งแล้วโยน error ไม่วนไม่รู้จบ', () => {
  const { Conn, conns } = fakeDriver();
  const db = new Database('libsql://shop.turso.io', { driver: Conn, log: () => {} });
  const q = db.prepare('SELECT 1 AS x');
  const orig = Conn.prototype.check;
  Conn.prototype.check = function () { throw new Error('Hrana(Api("status=502 Bad Gateway, body={\\"error\\":\\"connect to upstream failed\\"}"))'); };
  try {
    assert.throws(() => q.get(), /502/);
    assert.equal(conns.length, 3); // ครั้งแรก + ต่อใหม่ 2 ครั้ง
  } finally { Conn.prototype.check = orig; }
});

test('error อื่น (SQL ผิด/UNIQUE) และฐานข้อมูลไฟล์ในเครื่อง: ไม่ต่อใหม่ ไม่ลองซ้ำ', () => {
  const { Conn, conns } = fakeDriver();
  const db = new Database('libsql://shop.turso.io', { driver: Conn, log: () => {} });
  db.exec('CREATE TABLE u (id INTEGER PRIMARY KEY)');
  db.prepare('INSERT INTO u (id) VALUES (?)').run(1);
  assert.throws(() => db.prepare('INSERT INTO u (id) VALUES (?)').run(1), /UNIQUE/);
  assert.equal(conns.length, 1);

  const local = new Database(':memory:', { driver: Conn, log: () => {} });
  local.db.dead = true;
  assert.throws(() => local.exec('SELECT 1'), /stream not found/);
  assert.equal(local.reconnects, 0);
});

test('isReconnectable: จับเฉพาะ error เครือข่าย/stream', () => {
  assert.equal(isReconnectable(new Error(STREAM_GONE)), true);
  assert.equal(isReconnectable(new Error('Hrana(Api("status=502 Bad Gateway, body={\\"error\\":\\"connect to upstream failed\\"}"))')), true);
  assert.equal(isReconnectable(new Error('read ECONNRESET')), true);
  assert.equal(isReconnectable(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email')), false);
  assert.equal(isReconnectable(new Error('no such table: x')), false);
});

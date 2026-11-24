'use strict';
// Turso (remote) ผูกพารามิเตอร์แบบชื่อ (@name) ไม่ได้ ค่าเลยเป็น NULL → "NOT NULL constraint failed: orders.product_slug" ตอนกดซื้อ
// ห่อ libsql ให้แปลงเป็นตำแหน่งเองเสมอ ทดสอบว่าแปลงถูก (ชื่อซ้ำ ข้อความในเครื่องหมายคำพูด ค่าที่ไม่ได้ส่ง)
const { test } = require('node:test');
const assert = require('node:assert');
const { Database } = require('../src/sqlite');

test('พารามิเตอร์แบบชื่อ: ส่งตามลำดับที่ชื่อปรากฏ ชื่อซ้ำใช้ค่าเดียวกัน คีย์เกินถูกข้าม', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (a TEXT NOT NULL, b INTEGER, c TEXT)');
  db.prepare("INSERT INTO t VALUES (@a, @b, ':x @fake')").run({ b: 3, zzz: 1, a: 'hi' });
  assert.equal(db.prepare('UPDATE t SET b = @b WHERE a = @a AND b < @b + 10').run({ a: 'hi', b: 7 }).changes, 1);
  assert.deepEqual(db.prepare('SELECT * FROM t').all(), [{ a: 'hi', b: 7, c: ':x @fake' }]);
  assert.equal(db.prepare('SELECT b FROM t WHERE a = :a').get({ a: 'hi' }).b, 7);
});

test('ค่าที่ไม่ได้ส่งเป็น NULL (คอลัมน์ NOT NULL ต้องล้ม ไม่เงียบ) · พารามิเตอร์ตามตำแหน่งยังใช้ได้', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (a TEXT NOT NULL, b INTEGER)');
  assert.throws(() => db.prepare('INSERT INTO t VALUES (@a, @b)').run({ b: 1 }), /NOT NULL/);
  db.prepare('INSERT INTO t VALUES (?, ?)').run('x', 2);
  db.prepare('INSERT INTO t VALUES (?, ?)').run(['y', 3]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM t').get().n, 2);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { Database } = require('../src/sqlite');

// จำลอง Turso remote: BEGIN/COMMIT/ROLLBACK แยก exec แล้วไม่ใช้ transaction ร่วมกัน
test('transaction() ใช้ได้เมื่อ BEGIN/COMMIT ไม่คงอยู่ข้ามคำสั่ง (remote)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtx-'));
  const db = new Database(path.join(dir, 't.db'));
  db.remote = true;
  const realExec = db.db.exec.bind(db.db);
  db.db.exec = (sql) => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) throw new Error('cannot commit - no transaction is active');
    return realExec(sql);
  };
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
  const ins = db.prepare('INSERT INTO t (v) VALUES (@v)');
  const tx = db.transaction((v) => { ins.run({ v }); return 'ok'; });
  assert.equal(tx('a'), 'ok');
  assert.equal(db.prepare('SELECT count(*) AS n FROM t').get().n, 1);
  assert.throws(() => db.transaction(() => { throw new Error('boom'); })(), /boom/);
  db.close();
});

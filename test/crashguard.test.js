'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const express = require('express');
const { installCrashGuard, guardAsyncRoutes, safely } = require('../src/crashguard');

async function serve(app) {
  const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((ok) => server.close(ok)) };
}

test('route แบบ async ที่ throw (เช่น Turso สะดุด) ได้หน้า 500 ไม่ทำให้ร้านล่ม', async () => {
  const errors = [];
  const app = guardAsyncRoutes(express());
  app.set('x-test', 'v');
  assert.strictEqual(app.get('x-test'), 'v'); // app.get('ชื่อ') ยังอ่านค่าตั้งได้
  app.get('/boom', async () => { await new Promise((r) => setImmediate(r)); throw new Error('SQLITE_BUSY: network'); });
  app.post('/boom2', (req, res, next) => next(), async () => { throw new Error('after await'); });
  app.get('/ok', async (req, res) => { res.send('ok'); });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => { errors.push(err.message); res.status(500).send('error'); });
  let unhandled = 0;
  const onRej = () => { unhandled++; };
  process.on('unhandledRejection', onRej);
  const s = await serve(app);
  try {
    const r1 = await fetch(`${s.url}/boom`);
    assert.strictEqual(r1.status, 500);
    const r2 = await fetch(`${s.url}/boom2`, { method: 'POST' });
    assert.strictEqual(r2.status, 500);
    assert.strictEqual(await (await fetch(`${s.url}/ok`)).text(), 'ok');
  } finally {
    await s.close();
    process.off('unhandledRejection', onRej);
  }
  assert.deepStrictEqual(errors, ['SQLITE_BUSY: network', 'after await']);
  assert.strictEqual(unhandled, 0);
});

test('router ย่อยและ express.static ยังใช้ได้หลังห่อ', async () => {
  const app = guardAsyncRoutes(express());
  const r = express.Router();
  r.get('/x', (req, res) => res.send('sub'));
  app.use('/r', r);
  app.use([(req, res, next) => next()], (req, res) => res.status(404).send('nf'));
  const s = await serve(app);
  try {
    assert.strictEqual(await (await fetch(`${s.url}/r/x`)).text(), 'sub');
    assert.strictEqual((await fetch(`${s.url}/nope`)).status, 404);
  } finally { await s.close(); }
});

test('crash guard: promise ล้มไม่มีใครจับ = เขียน log แล้วรันต่อ', () => {
  const proc = new EventEmitter();
  const logs = [];
  let exited = null;
  const g = installCrashGuard({ proc, log: (m) => logs.push(m), exit: (c) => { exited = c; } });
  proc.emit('unhandledRejection', new Error('Groq ECONNRESET'));
  assert.strictEqual(exited, null);
  assert.match(logs[0], /Groq ECONNRESET/);
  assert.match(logs[0], /crashguard\.test\.js/); // มี stack ให้หาสาเหตุใน log ของ Render
  g.uninstall();
  assert.strictEqual(proc.listenerCount('unhandledRejection'), 0);
});

test('crash guard: error หลุดมือครั้งเดียวรันต่อ · ถี่เกิน 5 ครั้งใน 60 วิ ค่อยปิดให้ Render เปิดใหม่', () => {
  const proc = new EventEmitter();
  let t = 0;
  let exited = null;
  installCrashGuard({ proc, log: () => {}, exit: (c) => { exited = c; }, now: () => t });
  for (let i = 0; i < 4; i++) { proc.emit('uncaughtException', new Error('x')); t += 1000; }
  assert.strictEqual(exited, null);
  t += 120000; // เว้นนาน = นับใหม่
  for (let i = 0; i < 4; i++) proc.emit('uncaughtException', new Error('y'));
  assert.strictEqual(exited, null);
  proc.emit('uncaughtException', new Error('z'));
  assert.strictEqual(exited, 1);
});

test('safely: งานเบื้องหลัง (sweep/pump) ที่ throw หรือคืน promise ล้ม ไม่หลุดออกไป', async () => {
  const logs = [];
  const f = safely('sweep', () => { throw new Error('turso down'); }, (m) => logs.push(m));
  assert.doesNotThrow(() => f());
  const g = safely('pump', async () => { throw new Error('later'); }, (m) => logs.push(m));
  await g();
  await new Promise((r) => setImmediate(r));
  assert.match(logs[0], /\[sweep\].*turso down/);
  assert.match(logs[1], /\[pump\].*later/);
});

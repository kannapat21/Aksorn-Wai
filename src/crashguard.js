'use strict';
/*
 * กันร้านล่มทั้งตัวเพราะข้อผิดพลาดหลุดมือจุดเดียว (เช่น Turso/Groq สะดุดชั่วคราวในงานเบื้องหลังหรือ route แบบ async)
 * Node 15+ เจอ promise ที่ล้มแล้วไม่มีใครจับ = ปิดโปรแกรมทันที (Render แจ้ง "Exited with status 1")
 *   - unhandledRejection: เขียน log พร้อม stack แล้วรันต่อ
 *   - uncaughtException: เขียน log แล้วรันต่อ แต่ถ้าเกิดถี่เกิน (ค่าเริ่มต้น 5 ครั้งใน 60 วินาที) ถือว่าพังจริง ปิดให้ Render เปิดใหม่
 */
function installCrashGuard({ proc = process, log = console.error, exit = (c) => process.exit(c), now = () => Date.now(), maxErrors = 5, windowMs = 60000 } = {}) {
  const recent = [];
  const fmt = (e) => (e && e.stack) || String(e);
  const onRejection = (reason) => {
    log(`[crash-guard] promise ล้มโดยไม่มีใครจับ (ร้านยังเปิดต่อ): ${fmt(reason)}`);
  };
  const onException = (err) => {
    const t = now();
    recent.push(t);
    while (recent.length && recent[0] <= t - windowMs) recent.shift();
    log(`[crash-guard] ข้อผิดพลาดหลุดมือ (${recent.length}/${maxErrors} ใน ${Math.round(windowMs / 1000)} วิ): ${fmt(err)}`);
    if (recent.length >= maxErrors) {
      log('[crash-guard] ผิดพลาดถี่เกินไป ปิดร้านเพื่อให้เริ่มใหม่');
      exit(1);
    }
  };
  proc.on('unhandledRejection', onRejection);
  proc.on('uncaughtException', onException);
  return { onRejection, onException, uninstall: () => { proc.off('unhandledRejection', onRejection); proc.off('uncaughtException', onException); } };
}

// Express 4 ไม่ส่ง error ของ handler แบบ async ไปที่ error handler (กลายเป็น unhandledRejection)
// ห่อทุก handler ที่ลงทะเบียนผ่าน app/router: ถ้าคืน promise ที่ล้ม → next(err) → หน้า "เกิดข้อผิดพลาด" ตามปกติ
const METHODS = ['use', 'all', 'get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
function wrapHandler(fn) {
  if (typeof fn !== 'function' || fn.__guarded) return fn;
  let w;
  if (fn.length === 4) {
    w = function guardedErr(err, req, res, next) {
      try {
        const r = fn.call(this, err, req, res, next);
        if (r && typeof r.catch === 'function') r.catch(next);
        return r;
      } catch (e) { return next(e); }
    };
  } else {
    // ห้ามห่อแอปย่อย/router (มี .handle) ไม่งั้น express มองไม่เห็นว่าเป็นแอปย่อย
    if (typeof fn.handle === 'function' || typeof fn.set === 'function') return fn;
    w = function guarded(req, res, next) {
      const r = fn.call(this, req, res, next);
      if (r && typeof r.catch === 'function') r.catch(next);
      return r;
    };
  }
  w.__guarded = true;
  return w;
}
function wrapArgs(args) {
  return args.map((a) => (Array.isArray(a) ? wrapArgs(a) : wrapHandler(a)));
}
function guardAsyncRoutes(app) {
  for (const m of METHODS) {
    const orig = app[m];
    if (typeof orig !== 'function') continue;
    app[m] = function (...args) {
      // app.get('ชื่อค่า') = อ่านค่าตั้ง ไม่ใช่ลงทะเบียน route
      if (m === 'get' && args.length === 1 && typeof args[0] === 'string') return orig.apply(this, args);
      return orig.apply(this, wrapArgs(args));
    };
  }
  return app;
}

// ห่องานเบื้องหลัง (setInterval/setImmediate) ไม่ให้ error หลุดไปปิดร้าน
function safely(name, fn, log = console.error) {
  return (...a) => {
    try {
      const r = fn(...a);
      if (r && typeof r.catch === 'function') return r.catch((e) => { log(`[${name}] ${(e && e.stack) || e}`); });
      return r;
    } catch (e) {
      log(`[${name}] ${(e && e.stack) || e}`);
      return undefined;
    }
  };
}

module.exports = { installCrashGuard, guardAsyncRoutes, safely, wrapHandler };

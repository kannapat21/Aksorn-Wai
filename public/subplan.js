/*
 * วางแผนซับ (ใช้ร่วมกัน 2 ที่ ให้ได้ผลเหมือนกันทุกเฟรม)
 *   1) render/subtitles.js   เครื่องร้านเรนเดอร์ (Chrome + ffmpeg)
 *   2) public/render-engine  เบราว์เซอร์ลูกค้าเรนเดอร์เอง (โหมด serverless)
 * ต้องโหลด motion.js (TTMotion) ก่อน
 */
(function (g) {
  'use strict';
  var FPS = 30;
  var MAX_SIDE = 1920; // เครื่องร้าน: คลิปใหญ่กว่านี้ (2K/4K) ย่อเหลือด้านยาว 1920 ให้เรนเดอร์ทันและไฟล์ไม่ใหญ่เกิน
  var MAX_SIDE_BROWSER = 3840; // เบราว์เซอร์ลูกค้า: คงความละเอียดเดิมถึง 4K (เครื่องที่เข้ารหัสไม่ไหวจะย่อเอง)
  var SIZE_K = { sm: 0.066, md: 0.082, lg: 0.1 };
  var SIZE_MIN = 50, SIZE_MAX = 200;
  // ขนาดซับ: '50'..'200' (% ของขนาดกลาง) หรือค่าเก่า sm / md / lg
  function sizePct(v) {
    if (SIZE_K[v]) return Math.round((SIZE_K[v] / SIZE_K.md) * 20) * 5;
    var n = Math.round(Number(v));
    return isFinite(n) && n >= SIZE_MIN && n <= SIZE_MAX ? n : 100;
  }
  var POS_Y = { bottom: { v: 0.70, h: 0.85 }, middle: { v: 0.5, h: 0.5 }, top: { v: 0.2, h: 0.16 } };

  // ขนาดไฟล์ผลลัพธ์ (เลขคู่ ด้านยาวไม่เกิน MAX_SIDE)
  function outSize(w, h, max) {
    var k = Math.min(1, (max || MAX_SIDE) / Math.max(w, h));
    var even = function (x) { return Math.max(2, Math.round((x * k) / 2) * 2); };
    return { w: even(w), h: even(h) };
  }

  // ขนาดตัวอักษร / แถบซับ / ตำแหน่ง ตามแนวคลิป
  function layoutFor(w, h, o) {
    o = o || {};
    var fontPx = Math.round(Math.min(w, h) * SIZE_K.md * sizePct(o.size || 'md') / 100);
    var band = Math.min(h, Math.round((fontPx * 3.6) / 2) * 2);
    var vertical = h > w;
    var cy = h * (POS_Y[o.position] || POS_Y.bottom)[vertical ? 'v' : 'h'];
    var y = Math.max(0, Math.min(h - band, Math.round(cy - band / 2)));
    return { fontPx: fontPx, band: band, y: y };
  }

  // วางแผนเฟรม: ทุกเฟรมของคลิปใช้ภาพไหน (null = ว่าง / เลขภาพที่ต้องวาด)
  function planFrames(cues, o) {
    var TT = o.TT || g.TTMotion;
    var total = Math.max(1, Math.ceil(o.duration * FPS));
    var frames = new Array(total).fill(null);
    var shots = [];
    cues.forEach(function (c, ci) {
      var f0 = Math.max(0, Math.round(c.start * FPS));
      var f1 = Math.min(total, Math.round(c.end * FPS));
      if (f1 - f0 < 2) return;
      var d = (f1 - f0) / FPS;
      var wordAt = (c.w || []).filter(function (x) { return x[1] !== null; }).map(function (x) { return Math.min(x[1], Math.max(0, d - 0.3)); });
      var timing = TT.subtitleTiming(o.motion, d, FPS, wordAt);
      var staticShot = -1;
      for (var f = f0; f < f1; f++) {
        var t = (f - f0) / FPS;
        if (TT.subtitleMoving(o.motion, t, timing)) {
          shots.push({ cue: ci, t: t, timing: timing });
          frames[f] = shots.length - 1;
          staticShot = -1;
        } else {
          if (staticShot < 0) { shots.push({ cue: ci, t: t, timing: timing }); staticShot = shots.length - 1; }
          frames[f] = staticShot;
        }
      }
    });
    return { total: total, frames: frames, shots: shots };
  }

  var api = { FPS: FPS, MAX_SIDE: MAX_SIDE, MAX_SIDE_BROWSER: MAX_SIDE_BROWSER, SIZE_K: SIZE_K, SIZE_MIN: SIZE_MIN, SIZE_MAX: SIZE_MAX, sizePct: sizePct, POS_Y: POS_Y, outSize: outSize, layoutFor: layoutFor, planFrames: planFrames };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  g.TTSubPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

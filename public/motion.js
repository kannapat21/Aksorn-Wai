/*
 * ท่าเคลื่อนไหวของแอนิเมชัน (ใช้ร่วมกัน 2 ที่ ให้ได้ผลเหมือนกันทุกพิกเซล)
 *   1) render/template.html  ตอนเรนเดอร์ไฟล์จริงทีละเฟรม
 *   2) หน้าปรับแต่งในคลัง     ตอนแสดงตัวอย่างสดในเบราว์เซอร์
 * ข้อความใส่ด้วย textContent เสมอ (ไม่ใช่ HTML) จึงไม่มีทางแทรกโค้ดได้
 */
(function (g) {
  'use strict';
  var TIMING = { popUp: 0.30, settle: 0.50, fadeStart: 2.50, fadeEnd: 3 - 1 / 30, duration: 3 };
  var easeOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
  var easeInOutSine = function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  // ฟิลเตอร์ SVG: ขอบ (ขยายรูปทรงทั้งคำ เติมสีทึบ) + เงา (เบลอจากรูปทรงที่มีขอบแล้ว)
  function filterMarkup(id) {
    return '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">' +
      '<filter id="' + id + '" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">' +
      '<feMorphology class="m-grow" in="SourceAlpha" operator="dilate" radius="10" result="grow"/>' +
      '<feFlood class="m-outline" flood-color="#111111" result="oc"/>' +
      '<feComposite in="oc" in2="grow" operator="in" result="outline"/>' +
      '<feGaussianBlur class="m-blur" in="grow" stdDeviation="0" result="blur"/>' +
      '<feOffset class="m-off" in="blur" dx="0" dy="0" result="off"/>' +
      '<feFlood class="m-shadow" flood-color="#000000" flood-opacity="0" result="sc"/>' +
      '<feComposite in="sc" in2="off" operator="in" result="shadow"/>' +
      '<feMerge><feMergeNode in="shadow"/><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge>' +
      '</filter></svg>';
  }

  /*
   * จัดข้อความให้พอดีพื้นที่ แล้วตั้งสี/ขอบ/เงา
   * opts: { text, fontFamily, weight, fill, stroke, strokeRatio, shadow, width, height, filterId }
   */
  function setup(el, opts) {
    var fill = el.querySelector('.fill');
    fill.textContent = opts.text;
    el.style.fontFamily = '"' + opts.fontFamily + '", sans-serif';
    el.style.fontWeight = String(opts.weight || 700);
    el.style.setProperty('--fill', opts.fill);
    var W = opts.width, H = opts.height;
    var vertical = H > W;
    var maxW = vertical ? 0.86 : 0.70, maxH = vertical ? 0.22 : 0.40;
    el.style.transform = 'none';
    var size = 400;
    el.style.fontSize = size + 'px';
    var r = el.getBoundingClientRect();
    // เผื่อ scale 1.1 ตอนเด้ง
    var k = Math.min((W * maxW) / r.width, (H * maxH) / r.height) / 1.1;
    size = Math.max(4, Math.floor(size * k));
    el.style.fontSize = size + 'px';

    var doc = el.ownerDocument;
    var f = doc.getElementById(opts.filterId || 'outline');
    var ratio = Number(opts.strokeRatio) || 0;
    f.querySelector('.m-grow').setAttribute('radius', ratio > 0 ? Math.max(1, Math.round(size * ratio)) : 0);
    f.querySelector('.m-outline').setAttribute('flood-color', opts.stroke || '#111111');
    f.querySelector('.m-outline').setAttribute('flood-opacity', ratio > 0 ? '1' : '0');
    f.querySelector('.m-blur').setAttribute('stdDeviation', opts.shadow ? (size * 0.035).toFixed(2) : '0');
    f.querySelector('.m-off').setAttribute('dy', opts.shadow ? (size * 0.06).toFixed(2) : '0');
    f.querySelector('.m-shadow').setAttribute('flood-opacity', opts.shadow ? '0.55' : '0');
    fill.style.filter = (ratio > 0 || opts.shadow) ? 'url(#' + (opts.filterId || 'outline') + ')' : 'none';
    return { fontSize: size };
  }

  // ท่า "เด้งเข้า": 0→1.1 (0–0.30s), 1.1→1 (0.30–0.50s), ค้าง, จางออก (2.5–3.0s)
  function setTime(el, t, timing) {
    timing = timing || TIMING;
    var s = 1, o = 1;
    if (t < timing.popUp) s = lerp(0, 1.1, easeOutCubic(t / timing.popUp));
    else if (t < timing.settle) s = lerp(1.1, 1, easeInOutSine((t - timing.popUp) / (timing.settle - timing.popUp)));
    if (t >= timing.fadeStart) o = 1 - Math.min(1, (t - timing.fadeStart) / (timing.fadeEnd - timing.fadeStart));
    el.style.transform = 'scale(' + s.toFixed(5) + ')';
    el.style.opacity = o.toFixed(5);
  }

  g.TTMotion = { TIMING: TIMING, filterMarkup: filterMarkup, setup: setup, setTime: setTime };
})(typeof window !== 'undefined' ? window : globalThis);

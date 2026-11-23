/*
 * ท่าเคลื่อนไหวของแอนิเมชัน (ใช้ร่วมกัน 2 ที่ ให้ได้ผลเหมือนกันทุกพิกเซล)
 *   1) render/template.html  ตอนเรนเดอร์ไฟล์จริงทีละเฟรม
 *   2) หน้าปรับแต่งในคลัง     ตอนแสดงตัวอย่างสดในเบราว์เซอร์
 * ข้อความใส่ด้วย textContent เสมอ (ไม่ใช่ HTML) จึงไม่มีทางแทรกโค้ดได้
 */
(function (g) {
  'use strict';
  var TIMING = { popUp: 0.30, settle: 0.50, fadeStart: 2.50, fadeEnd: 3 - 1 / 60, duration: 3 };
  var easeOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
  var easeInOutSine = function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; };
  var easeOutBounce = function (t) {
    var n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) { t -= 1.5 / d; return n * t * t + 0.75; }
    if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; }
    t -= 2.625 / d; return n * t * t + 0.984375;
  };
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
    el.__H = H; // ท่า drop ใช้ความสูงของเวที
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

  /*
   * ท่าเคลื่อนไหว (เลือกด้วยชื่อ ค่าเริ่มต้น pop) ทุกท่าใช้โครงเดียวกัน:
   *   เข้า 0 → settle (0.5 วิ) · ค้างนิ่ง · ออก fadeStart → fadeEnd (0.5 วิสุดท้าย, เฟรมสุดท้ายโปร่งใสสนิท)
   *   ค้างต้องนิ่งสนิท เพราะตัวเรนเดอร์ใช้เฟรมค้างเฟรมเดียวต่อซ้ำ
   *   pop  : เด้งขยายเข้า (สั่งซื้อเลย)
   *   drop : ร่วงจากด้านบนแล้วเด้งกระดอนลงพื้น แล้วลอยขึ้นจางออก (กดติดตามเลย)
   */
  var MOTIONS = {
    pop: function (el, t, timing) {
      var s = 1;
      if (t < timing.popUp) s = lerp(0, 1.1, easeOutCubic(t / timing.popUp));
      else if (t < timing.settle) s = lerp(1.1, 1, easeInOutSine((t - timing.popUp) / (timing.settle - timing.popUp)));
      return { transform: 'scale(' + s.toFixed(5) + ')', fadeIn: 1 };
    },
    drop: function (el, t, timing) {
      var H = el.__H || 1080, y = 0;
      if (t < timing.settle) y = -(1 - easeOutBounce(t / timing.settle)) * H * 0.5;
      else if (t >= timing.fadeStart) {
        var q = Math.min(1, (t - timing.fadeStart) / (timing.fadeEnd - timing.fadeStart));
        y = -q * q * H * 0.06;
      }
      return { transform: 'translateY(' + y.toFixed(2) + 'px)', fadeIn: Math.min(1, t / 0.08) };
    },
  };

  function setTime(el, t, timing, motion) {
    timing = timing || TIMING;
    var m = (MOTIONS[motion] || MOTIONS.pop)(el, t, timing);
    var o = m.fadeIn;
    if (t >= timing.fadeStart) o = Math.min(o, 1 - Math.min(1, (t - timing.fadeStart) / (timing.fadeEnd - timing.fadeStart)));
    el.style.transform = m.transform;
    el.style.opacity = o.toFixed(5);
  }

  g.TTMotion = { MOTIONS: Object.keys(MOTIONS), TIMING: TIMING, filterMarkup: filterMarkup, setup: setup, setTime: setTime };
})(typeof window !== 'undefined' ? window : globalThis);

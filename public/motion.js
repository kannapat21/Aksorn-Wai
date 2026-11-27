/*
 * ท่าเคลื่อนไหวของแอนิเมชัน (ใช้ร่วมกัน 2 ที่ ให้ได้ผลเหมือนกันทุกพิกเซล)
 *   1) render/template.html  ตอนเรนเดอร์ไฟล์จริงทีละเฟรม
 *   2) หน้าปรับแต่งในคลัง     ตอนแสดงตัวอย่างสดในเบราว์เซอร์
 * ข้อความใส่ด้วย textContent เสมอ (ไม่ใช่ HTML) จึงไม่มีทางแทรกโค้ดได้
 *
 * ทุกท่าใช้โครงเดียวกัน:  เข้า (0 → settle) · ค้าง · ออก (fadeStart → fadeEnd, เฟรมสุดท้ายโปร่งใสสนิท)
 *   ท่าฟรี (pop, drop)  : ค้างนิ่งสนิท ตัวเรนเดอร์ใช้เฟรมค้างเฟรมเดียวต่อซ้ำ
 *   ท่าพรีเมียม          : ช่วงค้างมีชีวิต (แสงวิ่ง ไฟกระพริบ คำเด้ง) เป็นวงรอบที่ต่อกันเนียน (loop วินาที)
 *                          ตัวเรนเดอร์วาดหนึ่งรอบแล้ววนซ้ำ ไฟล์ยาวแค่ไหนก็ใช้เวลาเท่าเดิม
 *   ทุกท่าพรีเมียมกำหนดให้ "ช่วงท้ายของรอบ" นิ่ง จึงตัดเข้าส่วนออกได้เนียนทุกความยาว
 *   และหายสนิทก่อนจบส่วนออกเล็กน้อย (ไฟล์ WebM บีบอัดข้ามเฟรม ต้องมีเฟรมว่างก่อนเฟรมสุดท้าย)
 */
(function (g) {
  'use strict';
  var TIMING = { popUp: 0.30, settle: 0.50, fadeStart: 2.50, fadeEnd: 3 - 1 / 60, duration: 3 };
  var clamp = function (x, a, b) { return x < a ? a : x > b ? b : x; };
  var easeOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
  var easeInCubic = function (t) { return t * t * t; };
  var easeInOutSine = function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; };
  var easeOutBack = function (t) { var c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  var easeOutBounce = function (t) {
    var n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) { t -= 1.5 / d; return n * t * t + 0.75; }
    if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; }
    t -= 2.625 / d; return n * t * t + 0.984375;
  };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var easeOutExpo = function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); };
  var easeInOutCubic = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var easeInBack = function (t) { var c1 = 1.70158; return (c1 + 1) * t * t * t - c1 * t * t; };
  // ค่าสุ่มแบบคงที่ (ได้ค่าเดิมทุกครั้ง เรนเดอร์ซ้ำได้ผลเหมือนเดิมทุกพิกเซล)
  var hash = function (i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  function hexRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    var n = m ? parseInt(m[1], 16) : 0xffffff;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(hex, toHex, k) {
    var a = hexRgb(hex), b = hexRgb(toHex);
    return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(lerp(a[i], b[i], k)); }).join(',') + ')';
  }
  function luminance(hex) { var c = hexRgb(hex); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }

  // ฟิลเตอร์ SVG
  //   id       : ขอบ (ขยายรูปทรงทั้งคำ เติมสีทึบ) + เงา (เบลอจากรูปทรงที่มีขอบแล้ว)
  //   id-glow  : ไฟนีออน (หลอดสี + แสงฟุ้ง 3 ชั้น)
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
      '</filter>' +
      '<filter id="' + id + '-glow" x="-40%" y="-120%" width="180%" height="340%" color-interpolation-filters="sRGB">' +
      '<feMorphology class="n-tube" in="SourceAlpha" operator="dilate" radius="3" result="tube"/>' +
      '<feFlood class="n-color" flood-color="#ff2bd6" result="nc"/>' +
      '<feComposite in="nc" in2="tube" operator="in" result="tubeC"/>' +
      '<feGaussianBlur class="n-b1" in="tubeC" stdDeviation="4" result="b1r"/>' +
      '<feComponentTransfer in="b1r" result="b1"><feFuncA type="linear" slope="1.8"/></feComponentTransfer>' +
      '<feGaussianBlur class="n-b2" in="tubeC" stdDeviation="12" result="b2r"/>' +
      '<feComponentTransfer in="b2r" result="b2"><feFuncA type="linear" slope="2.4"/></feComponentTransfer>' +
      '<feFlood class="n-halo" flood-color="#ff2bd6" result="hc"/>' +
      '<feComposite in="hc" in2="tube" operator="in" result="tubeH"/>' +
      '<feGaussianBlur class="n-b3" in="tubeH" stdDeviation="30" result="b3"/>' +
      '<feComponentTransfer in="b3" result="b3s"><feFuncA class="n-b3a" type="linear" slope="0.9"/></feComponentTransfer>' +
      '<feMerge><feMergeNode in="b3s"/><feMergeNode in="b2"/><feMergeNode in="b1"/><feMergeNode in="tubeC"/><feMergeNode in="SourceGraphic"/></feMerge>' +
      '</filter></svg>';
  }

  // ---------- แบ่งข้อความเป็นชิ้น (ตัวอักษรไทยรวมสระ/วรรณยุกต์เป็นชิ้นเดียวเสมอ) ----------
  function segments(text, granularity) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter('th', { granularity: granularity }).segment(text), function (x) { return x.segment; });
    }
    return granularity === 'word' ? text.split(/(\s+)/).filter(Boolean) : Array.from(text);
  }
  // คำ: ช่องว่างไม่เคลื่อนไหว · คำเยอะเกิน 10 ชิ้นจะรวมคำติดกันให้เหลือ 10 (ให้แต่ละคำยังเห็นจังหวะชัด)
  function wordUnits(text) {
    var parts = segments(text, 'word');
    var words = [];
    parts.forEach(function (s) {
      if (/^\s+$/.test(s)) words.push({ space: true, text: s });
      else words.push({ text: s });
    });
    var real = words.filter(function (w) { return !w.space; });
    var MAXW = 10;
    if (real.length > MAXW) {
      var per = Math.ceil(real.length / MAXW), out = [], cur = null, count = 0;
      words.forEach(function (w) {
        if (w.space) { if (cur) { out.push(cur); cur = null; count = 0; } out.push(w); return; }
        if (!cur) cur = { text: '' };
        cur.text += w.text; count++;
        if (count >= per) { out.push(cur); cur = null; count = 0; }
      });
      if (cur) out.push(cur);
      words = out;
    }
    return words;
  }

  // สร้างชิ้นตัวอักษร (inline-block) ลงใน container
  function buildUnits(container, units) {
    var doc = container.ownerDocument;
    container.textContent = '';
    var spans = [];
    units.forEach(function (u) {
      if (u.space) { container.appendChild(doc.createTextNode(u.text)); return; }
      var s = doc.createElement('span');
      s.textContent = u.text;
      s.style.display = 'inline-block';
      s.style.transformOrigin = '50% 60%';
      container.appendChild(s);
      spans.push(s);
    });
    return spans;
  }

  function graphemeUnits(text) {
    return segments(text, 'grapheme').map(function (s) { return /^\s+$/.test(s) ? { space: true, text: s } : { text: s }; });
  }
  // สำเนาข้อความวางทับ .fill พอดี (ชั้นแสง/สี/แถบฉีก) · behind = วางไว้ใต้ตัวหลัก
  function overlayText(el, cls, text, css, behind) {
    var s = el.ownerDocument.createElement('span');
    s.className = 'tt-x ' + cls;
    s.setAttribute('aria-hidden', 'true');
    s.style.cssText = 'grid-area:1/1;pointer-events:none;' + (css || '');
    s.textContent = text;
    var fill = el.querySelector('.fill');
    if (behind) el.insertBefore(s, fill); else el.appendChild(s);
    return s;
  }
  // กล่อง/แถบ วางตำแหน่งแบบ absolute ใน el (หน่วย em ตามขนาดตัวอักษร) อยู่ใต้ตัวอักษร
  function addBox(el, cls, css) {
    var b = el.ownerDocument.createElement('i');
    b.className = 'tt-x ' + cls;
    b.setAttribute('aria-hidden', 'true');
    b.style.cssText = 'position:absolute;display:block;pointer-events:none;z-index:0;' + css;
    el.insertBefore(b, el.firstChild);
    return b;
  }

  function clearExtras(el) {
    Array.prototype.slice.call(el.querySelectorAll('.tt-x')).forEach(function (n) { n.parentNode.removeChild(n); });
  }

  /*
   * ท่าเคลื่อนไหว
   *   intro / outro : ความยาวช่วงเข้า/ออก (วินาที)
   *   loop          : ช่วงค้างวนรอบละกี่วินาที (0 = ค้างนิ่ง)
   *   fit           : เผื่อพื้นที่ (ท่าที่ขยายเกินขนาดจริงหรือมีแสงฟุ้งต้องเผื่อมากขึ้น)
   *   build(el, o)  : สร้างชิ้นส่วนเพิ่ม (ถ้ามี)
   *   frame(el, t, timing) → { transform, opacity }
   */
  var MOTIONS = {
    // เด้งขยายเข้า (สั่งซื้อเลย)
    pop: {
      intro: 0.5, outro: 0.5, loop: 0, fit: 1.1,
      frame: function (el, t, timing) {
        var s = 1;
        if (t < timing.popUp) s = lerp(0, 1.1, easeOutCubic(t / timing.popUp));
        else if (t < timing.settle) s = lerp(1.1, 1, easeInOutSine((t - timing.popUp) / (timing.settle - timing.popUp)));
        return { transform: 'scale(' + s.toFixed(5) + ')', fadeIn: 1 };
      },
    },
    // ร่วงจากด้านบนแล้วเด้งกระดอนลงพื้น แล้วลอยขึ้นจางออก (กดติดตามเลย)
    drop: {
      intro: 0.5, outro: 0.5, loop: 0, fit: 1.1,
      frame: function (el, t, timing) {
        var H = el.__H || 1080, y = 0;
        if (t < timing.settle) y = -(1 - easeOutBounce(t / timing.settle)) * H * 0.5;
        else if (t >= timing.fadeStart) {
          var q = Math.min(1, (t - timing.fadeStart) / (timing.fadeEnd - timing.fadeStart));
          y = -q * q * H * 0.06;
        }
        return { transform: 'translateY(' + y.toFixed(2) + 'px)', fadeIn: Math.min(1, t / 0.08) };
      },
    },

    /*
     * ไตเติลภาพยนตร์ (พรีเมียม)
     *   เข้า 1.2 วิ: ตัวอักษรทีละตัวโผล่จากความเบลอ ระยะห่างตัวอักษรหดเข้า ภาพซูมถอยช้าๆ เส้นบาง 2 เส้นลากออกจากกลาง
     *   ค้าง: แสงวิ่งผ่านหน้าตัวอักษรรอบละ 2.4 วิ
     *   ออก 0.8 วิ: ทีละตัวลอยขึ้น เบลอ จางหาย เส้นหดกลับเข้ากลาง
     */
    cinema: {
      intro: 1.2, outro: 0.8, loop: 2.4, fit: 1.14,
      build: function (el, o) {
        var doc = el.ownerDocument;
        var units = segments(o.text, 'grapheme').map(function (s) { return /^\s+$/.test(s) ? { space: true, text: s } : { text: s }; });
        el.__units = buildUnits(el.querySelector('.fill'), units);
        // แสงวิ่ง: ชิ้นตัวอักษรชุดเดียวกันซ้อนทับพอดี สีสว่าง มองเห็นเฉพาะแถบแสง (mask)
        var shine = doc.createElement('span');
        shine.className = 'tt-x tt-shine';
        shine.setAttribute('aria-hidden', 'true');
        shine.style.cssText = 'grid-area:1/1;pointer-events:none;';
        var light = luminance(o.fill) > 0.72;
        shine.style.color = light ? '#ffffff' : mix(o.fill, '#ffffff', 0.78);
        if (light) shine.style.textShadow = '0 0 ' + (o.size * 0.08).toFixed(1) + 'px rgba(255,255,255,.95), 0 0 ' + (o.size * 0.22).toFixed(1) + 'px ' + mix(o.fill, '#fff6d8', 0.5);
        el.__shineUnits = buildUnits(shine, units);
        el.appendChild(shine);
        el.__shine = shine;
        // เส้นบนและล่าง
        el.__lines = ['top', 'bottom'].map(function (side) {
          var ln = doc.createElement('i');
          ln.className = 'tt-x tt-line';
          ln.setAttribute('aria-hidden', 'true');
          var hpx = Math.max(2, Math.round(o.size * 0.03));
          ln.style.cssText = 'position:absolute;left:50%;' + side + ':' + (o.size * 0.16).toFixed(1) + 'px;height:' + hpx + 'px;width:100%;' +
            'transform-origin:50% 50%;border-radius:' + hpx + 'px;pointer-events:none;' +
            'background:linear-gradient(90deg,rgba(0,0,0,0),' + o.fill + ' 22%,' + o.fill + ' 78%,rgba(0,0,0,0));';
          if (o.strokeRatio > 0) ln.style.boxShadow = '0 0 0 ' + Math.max(1, Math.round(o.size * o.strokeRatio * 0.5)) + 'px ' + o.stroke;
          el.appendChild(ln);
          return ln;
        });
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var units = el.__units || [], shineUnits = el.__shineUnits || [], n = units.length || 1;
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        // ช่วงเข้าสั้น (โหมดซับ) ไม่ให้ลำดับทีละตัวยาวเกินช่วงเข้า · ช่วงเข้าปกติ 1.2 วิได้ค่าเดิมทุกพิกเซล
        var stagger = Math.min(0.045, 0.5 / Math.max(1, n - 1), Math.max(0, intro - 0.25) / Math.max(1, n - 1));
        var dur = Math.max(0.12, intro - 0.1 - stagger * (n - 1));
        var mid = (n - 1) / 2;
        units.forEach(function (s, i) {
          var p = 1, x = 0, y = 0, blur = 0, op = 1;
          if (t < intro) {
            p = clamp((t - 0.05 - stagger * i) / dur, 0, 1);
            var e = easeOutCubic(p);
            op = clamp(p * 1.6, 0, 1);
            y = (1 - e) * 0.28 * fs;
            x = (1 - e) * (i - mid) * 0.1 * fs; // ระยะห่างตัวอักษรหดเข้า
            blur = (1 - e) * 0.12 * fs;
          }
          if (t >= timing.fadeStart) {
            var q = clamp((t - timing.fadeStart - (outLen * 0.3) * (i / Math.max(1, n - 1))) / (outLen * 0.55), 0, 1);
            var eq = easeInCubic(q);
            op = Math.min(op, 1 - q);
            y -= eq * 0.22 * fs;
            blur += eq * 0.1 * fs;
          }
          s.style.opacity = op.toFixed(4);
          s.style.transform = (x || y) ? 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px)' : 'none';
          s.style.filter = blur > 0.05 ? 'blur(' + blur.toFixed(2) + 'px)' : 'none';
          if (shineUnits[i]) shineUnits[i].style.opacity = op.toFixed(4);
        });
        // แถบแสงวิ่ง (เฉพาะช่วงค้าง ตอนตัวอักษรนิ่งแล้ว)
        var band = -1;
        if (t >= intro && !timing.still) {
          var h = holdPhase(t, timing, 2.4);
          if (h >= 0.05 && h < 0.85) band = easeInOutSine((h - 0.05) / 0.8);
        }
        if (el.__shine) {
          if (band < 0) { el.__shine.style.visibility = 'hidden'; } else {
            var c = lerp(-25, 125, band);
            var g2 = 'linear-gradient(105deg,transparent ' + (c - 16).toFixed(2) + '%,rgba(0,0,0,.55) ' + (c - 5).toFixed(2) + '%,#000 ' + c.toFixed(2) + '%,rgba(0,0,0,.55) ' + (c + 5).toFixed(2) + '%,transparent ' + (c + 16).toFixed(2) + '%)';
            el.__shine.style.visibility = 'visible';
            el.__shine.style.webkitMaskImage = g2;
            el.__shine.style.maskImage = g2;
          }
        }
        // เส้นบน/ล่าง
        var lw = 0, lo = 1;
        if (t < intro) lw = easeOutCubic(clamp((t - 0.25) / (intro - 0.25), 0, 1));
        else lw = 1;
        if (t >= timing.fadeStart) { var r = clamp((t - timing.fadeStart) / (outLen * 0.85), 0, 1); lw *= 1 - easeInCubic(r); lo = 1 - r; }
        (el.__lines || []).forEach(function (ln) {
          ln.style.transform = 'translateX(-50%) scaleX(' + (lw * 0.82).toFixed(4) + ')';
          ln.style.opacity = (lw > 0.001 ? lo : 0).toFixed(4);
        });
        // ภาพรวมซูมถอยช้าๆ ตอนเข้า
        var sc = t < intro ? lerp(1.12, 1, easeOutCubic(t / intro)) : 1;
        return { transform: 'scale(' + sc.toFixed(5) + ')', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    /*
     * ป้ายไฟนีออน (พรีเมียม)
     *   สีตัวอักษร = สีไฟ · สีขอบ = สีแสงฟุ้งรอบนอก · ความหนาขอบ = ความแรงของแสง
     *   เข้า 1.0 วิ: หลอดไฟดับจางขึ้นมา แล้วติดทีละตัวแบบกระพริบไม่พร้อมกัน
     *   ค้าง: ไฟสว่างนิ่ง มีตัวหนึ่งกระตุกวูบรอบละ 2 วิ
     *   ออก 0.6 วิ: ไฟตกกระพริบแล้วดับ
     */
    neon: {
      intro: 1.0, outro: 0.6, loop: 2.0, fit: 1.28,
      build: function (el, o) {
        var units = segments(o.text, 'grapheme').map(function (s) { return /^\s+$/.test(s) ? { space: true, text: s } : { text: s }; });
        var fill = el.querySelector('.fill');
        el.__units = buildUnits(fill, units);
        var f = el.ownerDocument.getElementById((o.filterId || 'outline') + '-glow');
        var k = { 0: 0, 0.035: 0.75, 0.05: 1, 0.08: 1.35 }[String(o.strokeRatio)];
        if (k === undefined) k = o.strokeRatio > 0 ? 1 : 0;
        var size = o.size;
        f.querySelector('.n-tube').setAttribute('radius', Math.max(1, Math.round(size * 0.018)));
        f.querySelector('.n-color').setAttribute('flood-color', o.fill);
        f.querySelector('.n-b1').setAttribute('stdDeviation', (size * 0.025).toFixed(2));
        f.querySelector('.n-b2').setAttribute('stdDeviation', (size * 0.07 * Math.max(0.7, k)).toFixed(2));
        f.querySelector('.n-halo').setAttribute('flood-color', k > 0 ? o.stroke : o.fill);
        f.querySelector('.n-b3').setAttribute('stdDeviation', (size * 0.16 * Math.max(0.5, k)).toFixed(2));
        f.querySelector('.n-b3a').setAttribute('slope', k > 0 ? (2.6 * Math.min(1.35, k)).toFixed(2) : '0');
        // แกนหลอดสว่างเกือบขาว ส่วนสีมาจากแสงฟุ้ง
        fill.style.color = mix(o.fill, '#ffffff', 0.62);
        fill.style.filter = 'url(#' + (o.filterId || 'outline') + '-glow)';
        // ลำดับไฟติด: สุ่มแบบคงที่ตามตำแหน่ง
        el.__on = el.__units.map(function (_, i) { return 0.18 + hash(i + 1) * 0.5; });
        el.__buzz = Math.floor(el.__units.length * 0.62);
      },
      frame: function (el, t, timing) {
        var units = el.__units || [];
        var UNLIT = 0.14;
        var intro = timing.settle;
        var base = clamp(t / 0.15, 0, 1); // หลอดดับค่อยๆ ปรากฏ
        // ลำดับกระพริบตอนไฟติด (วินาทีหลังเวลาติดของแต่ละตัว): ติด ดับ ติด ดับ ติดยาว
        var lit = function (dt) { return dt < 0 ? 0 : dt < 0.033 ? 1 : dt < 0.083 ? 0 : dt < 0.1 ? 0.8 : dt < 0.133 ? 0.1 : 1; };
        var h = t >= intro ? holdPhase(t, timing, 2) : -1;
        var outLen = timing.fadeEnd - timing.fadeStart;
        var off = t >= timing.fadeStart ? (t - timing.fadeStart) / outLen : -1;
        units.forEach(function (s, i) {
          var L = t < intro ? lit(t - el.__on[i] * intro) : 1;
          if (!timing.still && h >= 1.5 && h < 1.62 && i === el.__buzz) L = (h < 1.53 || (h >= 1.57 && h < 1.6)) ? 0.25 : 1;
          if (off >= 0) {
            // ไฟตก: (เฟรมแรกยังสว่างเท่าท่าค้าง ต่อจากภาพนิ่งได้เนียน) หรี่ → ติด → ดับ → วูบ → ดับสนิท
            var o2 = off < 0.06 ? 1 : off < 0.14 ? 0.35 : off < 0.22 ? 1 : off < 0.34 ? 0 : off < 0.42 ? 0.6 : 0;
            if (hash(i + 7) > 0.5 && off >= 0.34 && off < 0.42) o2 = 0;
            L = Math.min(L, o2);
          }
          s.style.opacity = (UNLIT + (1 - UNLIT) * L).toFixed(4);
        });
        var op = base;
        if (off >= 0) op *= 1 - clamp((off - 0.34) / 0.5, 0, 1);
        if (t >= timing.fadeEnd) op = 0;
        return { transform: 'none', opacity: op };
      },
    },

    /*
     * คำเด้งทีละคำ (พรีเมียม) สไตล์คำบรรยาย TikTok/Reels
     *   เข้า 1.0 วิ: แต่ละคำเด้งขึ้นมาตามจังหวะ หมุนเอียงนิดๆ แล้วตั้งตรง
     *   ค้าง: คลื่นเด้งวิ่งผ่านทีละคำ รอบละ 2 วิ
     *   ออก 0.5 วิ: ทีละคำยุบหายไป
     */
    kinetic: {
      intro: 1.0, outro: 0.5, loop: 2.0, fit: 1.12,
      build: function (el, o) {
        // โหมดซับ: ส่งคำมาเอง (o.words) ให้ตรงกับเวลาที่พูดแต่ละคำ
        el.__units = buildUnits(el.querySelector('.fill'), o.words ? o.words.map(function (w) { return /^\s+$/.test(w) ? { space: true, text: w } : { text: w }; }) : wordUnits(o.text));
        // สีไฮไลต์คำที่กำลังเด้ง: ตัวอักษรสีอ่อน → เหลือง · สีอื่น → ขาว
        el.__fill = o.fill;
        el.__hl = luminance(o.fill) > 0.8 ? '#FFD400' : '#FFFFFF';
      },
      frame: function (el, t, timing) {
        var units = el.__units || [], n = units.length || 1;
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var dur = 0.38, stagger = n > 1 ? Math.max(0, Math.min(0.2, (intro - dur - 0.04) / (n - 1))) : 0;
        var h = t >= intro && !timing.still ? holdPhase(t, timing, 2) : -1;
        var at = timing.wordAt; // โหมดซับ: เวลาที่พูดแต่ละคำ (วินาทีจากต้นบรรทัด)
        units.forEach(function (s, i) {
          var sc = 1, y = 0, rot = 0, op = 1, hl = 0;
          if (at && at.length === n) {
            // คำเด้งขึ้นตอนพูด เป็นสีไฮไลต์จนถึงคำถัดไป แล้วค่อยกลับสีเดิม
            var pa = clamp((t - at[i]) / dur, 0, 1);
            var next = i + 1 < n ? at[i + 1] : at[i] + dur + 0.25;
            hl = pa <= 0 ? 0 : 1 - clamp((t - Math.max(next, at[i] + dur)) / 0.2, 0, 1);
            sc = pa <= 0 ? 0 : easeOutBack(pa);
            y = (1 - easeOutCubic(pa)) * 0.3 * fs;
            rot = (1 - easeOutCubic(pa)) * (i % 2 ? 9 : -9);
            op = clamp(pa * 4, 0, 1);
          } else if (t < intro) {
            var p = clamp((t - 0.02 - stagger * i) / dur, 0, 1);
            hl = p <= 0 ? 0 : 1 - clamp((t - 0.02 - stagger * i - dur) / 0.25, 0, 1); // คำที่เพิ่งเด้งเป็นสีไฮไลต์ แล้วค่อยกลับสีเดิม
            sc = p <= 0 ? 0 : easeOutBack(p);
            y = (1 - easeOutCubic(p)) * 0.3 * fs;
            rot = (1 - easeOutCubic(p)) * (i % 2 ? 9 : -9);
            op = clamp(p * 4, 0, 1);
          }
          if (h >= 0.1 && h < 0.9) {
            var c = 0.1 + ((i + 0.5) / n) * 0.8, w = Math.max(0.16, 0.8 / n * 1.6);
            var a = Math.max(0, 1 - Math.abs(h - c) / (w / 2));
            a = easeInOutSine(a);
            sc *= 1 + 0.1 * a;
            y -= 0.1 * fs * a;
            hl = Math.max(hl, a);
          }
          if (t >= timing.fadeStart) {
            var q = clamp((t - timing.fadeStart - (outLen * 0.35) * (i / Math.max(1, n - 1))) / (outLen * 0.5), 0, 1);
            sc *= q < 0.3 ? lerp(1, 1.08, q / 0.3) : lerp(1.08, 0, easeInCubic((q - 0.3) / 0.7));
            op = Math.min(op, q >= 1 ? 0 : 1);
            rot += q * (i % 2 ? -12 : 12);
          }
          s.style.opacity = op.toFixed(4);
          s.style.color = hl > 0.001 ? mix(el.__fill, el.__hl, hl) : '';
          s.style.transform = (sc === 1 && !y && !rot) ? 'none' : 'translateY(' + y.toFixed(2) + 'px) rotate(' + rot.toFixed(3) + 'deg) scale(' + Math.max(0, sc).toFixed(5) + ')';
        });
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },
    /* ==================== ท่าชุดใหม่ (ฟรี 5 · พรีเมียม 7) ====================
     * ทุกท่าคิดเวลาจาก timing (settle = จบท่าเข้า, fadeStart/fadeEnd = ช่วงออก) จึงใช้ได้ทั้งคลิปเต็ม ปรับความยาว และโหมดซับ
     * timing.still (โหมดซับ) = ช่วงค้างนิ่งสนิท ไม่มีลูกเล่นวน
     * ช่วงท้ายของรอบค้างทุกท่า = ภาพนิ่งเดียวกับตอนจบท่าเข้า จึงวนซ้ำและตัดเข้าท่าออกได้เนียนทุกความยาว
     */

    // พิมพ์ทีละตัว (ฟรี): ตัวอักษรขึ้นทีละตัวพร้อมเคอร์เซอร์ · ค้าง: เคอร์เซอร์กระพริบ · ออก: ลบถอยหลังทีละตัว
    typewriter: {
      intro: 1.0, outro: 0.5, loop: 1.2, fit: 1.08, premium: false,
      build: function (el, o) {
        el.__units = buildUnits(el.querySelector('.fill'), graphemeUnits(o.text));
        var c = el.ownerDocument.createElement('i');
        c.className = 'tt-x tt-caret';
        c.setAttribute('aria-hidden', 'true');
        var wpx = Math.max(2, Math.round(o.size * 0.07));
        c.style.cssText = 'position:absolute;left:0;top:0;width:' + wpx + 'px;height:10px;border-radius:' + Math.ceil(wpx / 2) + 'px;pointer-events:none;background:' + o.fill + ';' +
          (o.strokeRatio > 0 ? 'box-shadow:0 0 0 ' + Math.max(1, Math.round(o.size * o.strokeRatio * 0.6)) + 'px ' + o.stroke + ';' : '');
        el.appendChild(c);
        el.__caret = c;
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var units = el.__units || [], n = units.length || 1;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var per = Math.max(0.01, (intro - 0.08) / n);
        var shown = t < intro ? clamp(Math.floor((t - 0.02) / per) + 1, 0, n) : n;
        if (t >= timing.fadeStart) shown = Math.min(shown, n - Math.floor(clamp((t - timing.fadeStart) / (outLen * 0.75), 0, 1) * n));
        units.forEach(function (s, i) {
          var on = i < shown;
          var age = t < intro ? t - (0.02 + per * i) : 1;
          var sc = on && age < 0.08 ? lerp(1.22, 1, easeOutCubic(clamp(age / 0.08, 0, 1))) : 1;
          s.style.opacity = on ? '1' : '0';
          s.style.transform = sc !== 1 ? 'scale(' + sc.toFixed(4) + ')' : 'none';
        });
        var c = el.__caret;
        if (c) {
          var vis = !timing.still;
          if (t >= intro && t < timing.fadeStart && !timing.still) { var h = holdPhase(t, timing, 1.2); if (h >= 0.35 && h < 0.75) vis = false; }
          if (t >= timing.fadeStart && (t - timing.fadeStart) / outLen > 0.82) vis = false;
          var er = el.getBoundingClientRect();
          var ref = units[Math.max(0, shown - 1)];
          if (ref && vis) {
            var r = ref.getBoundingClientRect();
            var x = shown ? r.right - er.left : r.left - er.left;
            var hh = r.height * 0.52;
            c.style.height = hh.toFixed(1) + 'px';
            c.style.transform = 'translate(' + (x + r.height * 0.03).toFixed(1) + 'px,' + (r.top - er.top + r.height * 0.24).toFixed(1) + 'px)';
          }
          c.style.opacity = vis ? '1' : '0';
        }
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    // สไลด์ขึ้นจากเส้น (ฟรี): ตัวอักษรเลื่อนขึ้นจากใต้เส้นทีละตัว · ออก: เลื่อนขึ้นหายไปด้านบน
    rise: {
      intro: 0.8, outro: 0.5, loop: 0, fit: 1.06, premium: false,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        el.__units = buildUnits(fill, graphemeUnits(o.text));
        fill.style.clipPath = 'inset(0 -40% 0 -40%)';
      },
      frame: function (el, t, timing) {
        var units = el.__units || [], n = units.length || 1;
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var st = Math.min(0.05, (intro * 0.45) / Math.max(1, n - 1)), dur = Math.max(0.1, intro - st * (n - 1) - 0.02);
        units.forEach(function (s, i) {
          var y = 0, sk = 0;
          if (t < intro) { var p = clamp((t - st * i) / dur, 0, 1), e = easeOutExpo(p); y = (1 - e) * 1.35 * fs; sk = (1 - e) * -8; }
          if (t >= timing.fadeStart) {
            var q = clamp((t - timing.fadeStart - (outLen * 0.35) * (i / Math.max(1, n - 1))) / (outLen * 0.5), 0, 1);
            y -= easeInCubic(q) * 1.35 * fs;
          }
          s.style.transform = (y || sk) ? 'translateY(' + y.toFixed(2) + 'px) skewY(' + sk.toFixed(3) + 'deg)' : 'none';
        });
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    // ซูมพุ่งเข้า (ฟรี): พุ่งจากใหญ่และเบลอเข้ามาหยุดคม · ออก: พุ่งทะลุจอ
    zoom: {
      intro: 0.6, outro: 0.5, loop: 0, fit: 1.04, premium: false,
      frame: function (el, t, timing) {
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var s = 1, rot = 0, blur = 0, op = 1;
        if (t < intro) { var e = easeOutExpo(clamp(t / intro, 0, 1)); s = lerp(2.6, 1, e); rot = (1 - e) * -7; blur = (1 - e) * 0.1 * fs; op = clamp(t / (intro * 0.35), 0, 1); }
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1), eq = easeInCubic(q); s *= lerp(1, 3.2, eq); blur += eq * 0.12 * fs; op = Math.min(op, 1 - q); }
        if (t >= timing.fadeEnd) op = 0;
        el.style.filter = blur > 0.05 ? 'blur(' + blur.toFixed(2) + 'px)' : '';
        return { transform: 'rotate(' + rot.toFixed(3) + 'deg) scale(' + s.toFixed(5) + ')', opacity: op };
      },
    },

    // ตัวอักษรกระโดด (ฟรี): ตกลงมาทีละตัว เด้งพื้นแบบยืดหยุ่น · ออก: ร่วงลงหายทีละตัว
    jump: {
      intro: 1.0, outro: 0.5, loop: 0, fit: 1.08, premium: false,
      build: function (el, o) {
        el.__units = buildUnits(el.querySelector('.fill'), graphemeUnits(o.text));
        el.__units.forEach(function (s) { s.style.transformOrigin = '50% 85%'; });
      },
      frame: function (el, t, timing) {
        var units = el.__units || [], n = units.length || 1;
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var st = Math.min(0.06, (intro * 0.45) / Math.max(1, n - 1)), dur = Math.max(0.12, intro - st * (n - 1) - 0.02);
        units.forEach(function (s, i) {
          var y = 0, sx = 1, sy = 1, rot = 0, op = 1;
          if (t < intro) {
            var p = clamp((t - st * i) / dur, 0, 1);
            y = -(1 - easeOutBounce(p)) * 1.1 * fs;
            var land = p > 0.36 ? Math.sin(clamp((p - 0.36) / 0.3, 0, 1) * Math.PI) * (1 - p) : 0; // ยุบตอนกระทบพื้น
            sy = 1 - 0.3 * land; sx = 1 + 0.22 * land;
            if (p < 0.36) { sy = 1 + 0.12 * (1 - p / 0.36); sx = 1 - 0.08 * (1 - p / 0.36); }
            op = clamp(p * 6, 0, 1);
          }
          if (t >= timing.fadeStart) {
            var q = clamp((t - timing.fadeStart - (outLen * 0.4) * (i / Math.max(1, n - 1))) / (outLen * 0.5), 0, 1);
            y += easeInCubic(q) * 0.9 * fs; rot = q * (i % 2 ? 18 : -18); op = Math.min(op, 1 - q);
          }
          s.style.opacity = op.toFixed(4);
          s.style.transform = (y || rot || sx !== 1 || sy !== 1) ? 'translateY(' + y.toFixed(2) + 'px) rotate(' + rot.toFixed(2) + 'deg) scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')' : 'none';
        });
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    // ป้ายไฮไลต์ (ฟรี): แถบปากกาเน้นข้อความปาดเข้า แล้วตัวอักษรเผยตาม · สีขอบ = สีแถบ
    highlight: {
      intro: 0.8, outro: 0.5, loop: 0, fit: 1.1, premium: false,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        fill.style.position = 'relative';
        fill.style.zIndex = '1';
        fill.style.filter = 'none'; // ตัวอักษรอยู่บนแถบสีทึบ ไม่ต้องมีขอบ/เงา (เงาอยู่ที่แถบแทน)
        el.__box = addBox(el, 'tt-box', 'left:.16em;right:.16em;top:.42em;bottom:.42em;border-radius:.1em;background:' + o.stroke + ';' +
          (o.shadow ? 'box-shadow:0 .05em .16em rgba(0,0,0,.35);' : ''));
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var fill = el.querySelector('.fill');
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var bw = 1, reveal = 1, cut = 0, origin = '0% 50%';
        if (t < intro) { bw = easeOutExpo(clamp(t / (intro * 0.55), 0, 1)); reveal = easeOutCubic(clamp((t - intro * 0.25) / (intro * 0.7), 0, 1)); }
        if (t >= timing.fadeStart) {
          var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1);
          cut = easeInCubic(clamp(q / 0.6, 0, 1));
          bw = 1 - easeInCubic(clamp((q - 0.2) / 0.8, 0, 1)); origin = '100% 50%';
        }
        if (el.__box) { el.__box.style.transformOrigin = origin; el.__box.style.transform = 'skewX(-6deg) scaleX(' + bw.toFixed(4) + ')'; el.__box.style.opacity = bw > 0.002 ? '1' : '0'; }
        fill.style.clipPath = 'inset(-20% ' + ((1 - reveal) * 110 - 5).toFixed(2) + '% -20% ' + (cut * 110 - 5).toFixed(2) + '%)';
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    // กลิตช์ดิจิทัล (พรีเมียม): สีแยก RGB + ภาพฉีกเป็นแถบ · ค้าง: สะดุดเป็นจังหวะ · ออก: ดับแบบจอทีวี
    glitch: {
      intro: 0.8, outro: 0.5, loop: 2.2, fit: 1.14, premium: true,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        el.__rgb = [['#FF2D55', 'screen'], ['#00E5FF', 'screen']].map(function (c) {
          var s = overlayText(el, 'tt-rgb', o.text, 'color:' + c[0] + ';opacity:0;', true);
          return s;
        });
        el.__slices = [0, 1].map(function () {
          return overlayText(el, 'tt-slice', o.text, 'color:' + o.fill + ';visibility:hidden;' + (fill.style.filter ? 'filter:' + fill.style.filter + ';' : ''));
        });
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var fill = el.querySelector('.fill');
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var g = 0, op = 1, sx = 1, sy = 1;
        var seed = Math.floor(t * 30) + 1;
        if (t < intro) {
          g = 1 - easeOutCubic(clamp(t / intro, 0, 1));
          if (t < intro * 0.7) op = hash(seed * 5) > 0.35 ? 1 : 0.25;
          op *= clamp(t / 0.06, 0, 1);
        } else if (t < timing.fadeStart && !timing.still) {
          var h = holdPhase(t, timing, 2.2);
          if (h >= 0.9 && h < 1.12) g = 0.85; else if (h >= 1.24 && h < 1.34) g = 0.5;
        }
        if (t >= timing.fadeStart) {
          var q = clamp((t - timing.fadeStart) / outLen, 0, 1);
          g = Math.max(g, 0.5 + q * 0.5);
          if (q > 0.45) { var k = easeInCubic(clamp((q - 0.45) / 0.4, 0, 1)); sy = lerp(1, 0.03, k); sx = lerp(1, 1.35, k); }
          op = 1 - clamp((q - 0.75) / 0.15, 0, 1);
        }
        if (t >= timing.fadeEnd) op = 0;
        var calm = g < 0.01;
        var d = g * 0.16 * fs;
        (el.__rgb || []).forEach(function (s, i) {
          var dx = calm ? 0 : (i ? -1 : 1) * (d * 0.6 + (hash(seed * 3 + i) - 0.5) * d);
          var dy = calm ? 0 : (hash(seed * 7 + i) - 0.5) * d * 0.4;
          s.style.opacity = calm ? '0' : '0.85';
          s.style.transform = 'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px)';
        });
        // แถบฉีก 2 แถบ: ซ่อนแถบนั้นจากตัวหลัก แล้วโชว์สำเนาที่เลื่อนไปด้านข้างแทน
        var bands = [];
        if (g > 0.15) {
          var a1 = 8 + hash(seed * 11) * 30, h1 = 6 + hash(seed * 13) * 12;
          var a2 = 52 + hash(seed * 17) * 28, h2 = 5 + hash(seed * 19) * 12;
          bands = [[a1, h1], [a2, h2]];
        }
        (el.__slices || []).forEach(function (s, i) {
          var b = bands[i];
          if (!b) { s.style.visibility = 'hidden'; return; }
          var dx = (hash(seed * 23 + i) - 0.5 > 0 ? 1 : -1) * (0.4 + hash(seed * 41 + i) * 0.6) * g * 0.3 * fs;
          s.style.visibility = 'visible';
          s.style.clipPath = 'inset(' + b[0].toFixed(2) + '% -30% ' + (100 - b[0] - b[1]).toFixed(2) + '% -30%)';
          s.style.transform = 'translateX(' + dx.toFixed(2) + 'px)';
        });
        if (bands.length) {
          var m = 'linear-gradient(180deg,#000 ' + bands[0][0].toFixed(2) + '%,transparent ' + bands[0][0].toFixed(2) + '%,transparent ' + (bands[0][0] + bands[0][1]).toFixed(2) + '%,#000 ' + (bands[0][0] + bands[0][1]).toFixed(2) + '%,#000 ' +
            bands[1][0].toFixed(2) + '%,transparent ' + bands[1][0].toFixed(2) + '%,transparent ' + (bands[1][0] + bands[1][1]).toFixed(2) + '%,#000 ' + (bands[1][0] + bands[1][1]).toFixed(2) + '%)';
          fill.style.webkitMaskImage = m; fill.style.maskImage = m;
        } else { fill.style.webkitMaskImage = ''; fill.style.maskImage = ''; }
        var jx = calm ? 0 : (hash(seed * 29) - 0.5) * g * 0.05 * fs;
        var skew = calm || hash(seed * 31) < 0.6 ? 0 : (hash(seed * 37) - 0.5) * g * 24;
        return { transform: 'translateX(' + jx.toFixed(2) + 'px) skewX(' + skew.toFixed(2) + 'deg) scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')', opacity: op };
      },
    },

    // ทองประกาย (พรีเมียม): ตัวอักษรไล่สีโลหะ แสงวิ่งผ่าน ดาววิบวับรอบคำ · สีตัวอักษร = สีโลหะหลัก
    gold: {
      intro: 1.0, outro: 0.6, loop: 2.4, fit: 1.12, premium: true,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        var light = mix(o.fill, '#ffffff', 0.7), dark = mix(o.fill, '#000000', 0.38);
        fill.style.backgroundImage = 'linear-gradient(180deg,' + light + ' 8%,' + mix(o.fill, '#ffffff', 0.2) + ' 38%,' + dark + ' 52%,' + o.fill + ' 66%,' + light + ' 92%)';
        fill.style.webkitBackgroundClip = 'text';
        fill.style.backgroundClip = 'text';
        fill.style.webkitTextFillColor = 'transparent';
        fill.style.color = 'transparent';
        var sh = overlayText(el, 'tt-shine', o.text, 'color:#fff;-webkit-text-fill-color:#fff;visibility:hidden;text-shadow:0 0 ' + (o.size * 0.06).toFixed(1) + 'px rgba(255,255,255,.9);');
        el.__shine = sh;
        var doc = el.ownerDocument;
        el.__stars = [0, 1, 2, 3, 4].map(function (j) {
          var s = doc.createElement('span');
          s.className = 'tt-x tt-star';
          s.setAttribute('aria-hidden', 'true');
          var sz = (0.5 + hash(j + 40) * 0.45).toFixed(3);
          var left = [10, 88, 30, 70, 52][j] + (hash(j + 50) - 0.5) * 8, top = [22, 30, 80, 76, 14][j] + (hash(j + 60) - 0.5) * 10;
          s.style.cssText = 'position:absolute;left:' + left.toFixed(1) + '%;top:' + top.toFixed(1) + '%;width:' + sz + 'em;height:' + sz + 'em;margin:-' + (sz / 2).toFixed(3) + 'em;opacity:0;pointer-events:none;z-index:2;';
          s.innerHTML = '<svg viewBox="-10 -10 20 20" width="100%" height="100%" style="display:block;overflow:visible"><circle r="3.2" fill="' + mix(o.fill, '#ffffff', 0.6) + '" opacity=".55"/><path d="M0-10C.8-2.2 2.2-.8 10 0 2.2.8.8 2.2 0 10-.8 2.2-2.2.8-10 0-2.2-.8-.8-2.2 0-10Z" fill="#fff"/></svg>';
          el.appendChild(s);
          return s;
        });
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var s = 1, op = 1, band = -1;
        if (t < intro) {
          var e = easeOutCubic(clamp(t / (intro * 0.7), 0, 1));
          s = lerp(0.82, 1, e); op = clamp(t / (intro * 0.35), 0, 1);
          if (t >= intro * 0.3 && t < intro * 0.95) band = easeInOutSine((t - intro * 0.3) / (intro * 0.65));
        }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.4) : -1;
        if (h >= 0.1 && h < 0.9) band = easeInOutSine((h - 0.1) / 0.8);
        var q = t >= timing.fadeStart ? clamp((t - timing.fadeStart) / (outLen * 0.85), 0, 1) : -1;
        if (q >= 0) { s *= lerp(1, 1.1, easeInCubic(q)); op = 1 - easeInCubic(q); }
        if (t >= timing.fadeEnd) op = 0;
        var sh = el.__shine;
        if (sh) {
          if (band < 0) sh.style.visibility = 'hidden';
          else {
            var c = lerp(-25, 125, band);
            var g2 = 'linear-gradient(110deg,transparent ' + (c - 14).toFixed(2) + '%,rgba(0,0,0,.5) ' + (c - 4).toFixed(2) + '%,#000 ' + c.toFixed(2) + '%,rgba(0,0,0,.5) ' + (c + 4).toFixed(2) + '%,transparent ' + (c + 14).toFixed(2) + '%)';
            sh.style.visibility = 'visible'; sh.style.webkitMaskImage = g2; sh.style.maskImage = g2;
          }
        }
        // ดาววิบวับ: ตอนเข้าแต่ละดวงโผล่ไล่กัน · ช่วงค้างวิบทีละดวง (จบก่อนท้ายรอบ) · ตอนออกวาบพร้อมกัน
        (el.__stars || []).forEach(function (st, j) {
          var u = -1;
          if (t < intro) u = (t - (0.25 + j * 0.12) * intro) / (0.5 * Math.max(intro, 0.6));
          else if (h >= 0) u = (h - (0.15 + j * 0.17)) / 0.45;
          else if (q >= 0) u = q / 0.7;
          var a = u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
          st.style.opacity = a.toFixed(4);
          st.style.transform = 'rotate(' + (u * 90).toFixed(2) + 'deg) scale(' + (0.2 + a * 0.9).toFixed(4) + ')';
        });
        return { transform: 'scale(' + s.toFixed(5) + ')', opacity: op };
      },
    },

    // พลิก 3D (พรีเมียม): ตัวอักษรนูนมีความลึก พลิกลงมาทีละตัว · ค้าง: หมุนรอบตัวเป็นคลื่น · ออก: พลิกหายทีละตัว
    flip: {
      intro: 1.1, outro: 0.6, loop: 2.6, fit: 1.12, premium: true,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        el.__units = buildUnits(fill, graphemeUnits(o.text));
        var depth = Math.max(3, Math.round(o.size * 0.055)), dark = mix(o.fill, '#000000', 0.5), sh = [];
        for (var k = 1; k <= depth; k++) sh.push('0 ' + k + 'px 0 ' + mix(o.fill, '#000000', 0.38 + 0.25 * (k / depth)));
        sh.push('0 ' + (depth + 2) + 'px ' + (depth * 1.4).toFixed(1) + 'px rgba(0,0,0,.45)');
        fill.style.textShadow = sh.join(',');
        el.__dark = dark;
        el.__units.forEach(function (s) { s.style.transformOrigin = '50% 50%'; s.style.backfaceVisibility = 'visible'; });
      },
      frame: function (el, t, timing) {
        var units = el.__units || [], n = units.length || 1;
        var fs = parseFloat(el.style.fontSize) || 100, P = (fs * 4).toFixed(0);
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var st = Math.min(0.06, (intro * 0.45) / Math.max(1, n - 1)), dur = Math.max(0.14, intro - st * (n - 1) - 0.02);
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.6) : -1;
        var sg = Math.min(0.06, 0.45 / Math.max(1, n));
        units.forEach(function (s, i) {
          var rx = 0, ry = 0, y = 0, op = 1;
          if (t < intro) { var p = clamp((t - st * i) / dur, 0, 1); rx = lerp(-100, 0, easeOutBack(p)); y = (1 - easeOutCubic(p)) * -0.3 * fs; op = clamp(p * 3, 0, 1); }
          if (h >= 0) { var u = clamp((h - 0.15 - sg * i) / 0.55, 0, 1); ry = u >= 1 ? 0 : 360 * easeInOutCubic(u); }
          if (t >= timing.fadeStart) {
            var q = clamp((t - timing.fadeStart - (outLen * 0.35) * (i / Math.max(1, n - 1))) / (outLen * 0.5), 0, 1);
            rx += 100 * easeInCubic(q); op = Math.min(op, 1 - clamp((q - 0.4) / 0.6, 0, 1));
          }
          var shade = Math.abs(Math.sin((rx / 180) * Math.PI)) * 0.4 + Math.abs(Math.sin((ry / 180) * Math.PI)) * 0.35;
          s.style.opacity = op.toFixed(4);
          s.style.filter = shade > 0.01 ? 'brightness(' + (1 - shade).toFixed(3) + ')' : 'none';
          s.style.transform = (rx || ry || y) ? 'perspective(' + P + 'px) translateY(' + y.toFixed(2) + 'px) rotateX(' + rx.toFixed(3) + 'deg) rotateY(' + ry.toFixed(3) + 'deg)' : 'none';
        });
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    // คาราโอเกะ (พรีเมียม): สีวิ่งตามคำร้องจากซ้ายไปขวา มีลูกบอลกระโดดนำ · สีตัวอักษร = สีที่วิ่ง
    karaoke: {
      intro: 0.5, outro: 0.4, loop: 2.4, fit: 1.12, premium: true,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        fill.style.color = luminance(o.fill) > 0.86 ? '#8b919a' : '#ffffff';
        el.__hl = overlayText(el, 'tt-hl', o.text, 'color:' + o.fill + ';' + (fill.style.filter ? 'filter:' + fill.style.filter + ';' : '') + 'clip-path:inset(-30% 100% -30% -5%);');
        var b = el.ownerDocument.createElement('i');
        b.className = 'tt-x tt-ball';
        b.setAttribute('aria-hidden', 'true');
        var d = Math.max(6, Math.round(o.size * 0.22));
        b.style.cssText = 'position:absolute;left:0;top:0;width:' + d + 'px;height:' + d + 'px;border-radius:50%;opacity:0;pointer-events:none;background:' + o.fill + ';' +
          (o.strokeRatio > 0 ? 'box-shadow:0 0 0 ' + Math.max(1, Math.round(o.size * o.strokeRatio * 0.5)) + 'px ' + o.stroke + ';' : '');
        el.appendChild(b);
        el.__ball = b; el.__ballD = d;
        el.__beats = Math.max(2, wordUnits(o.text).filter(function (w) { return !w.space; }).length);
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var y = 0, op = 1, p = -1, hlOp = 1, ballOp = 0;
        if (t < intro) { var e = easeOutCubic(clamp(t / intro, 0, 1)); y = (1 - e) * 0.25 * fs; op = clamp(t / (intro * 0.6), 0, 1); }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.4) : -1;
        if (h >= 0) {
          p = clamp((h - 0.15) / 1.2, 0, 1);
          ballOp = clamp((h - 0.02) / 0.12, 0, 1) * (1 - clamp((h - 1.35) / 0.15, 0, 1));
          hlOp = 1 - clamp((h - 1.5) / 0.35, 0, 1);
        }
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.85), 0, 1); y -= easeInCubic(q) * 0.2 * fs; op = 1 - easeInCubic(q); }
        if (t >= timing.fadeEnd) op = 0;
        var hl = el.__hl;
        if (hl) {
          hl.style.clipPath = 'inset(-30% ' + (p < 0 ? 100 : (1 - p) * 100).toFixed(2) + '% -30% -5%)';
          hl.style.opacity = hlOp.toFixed(4);
        }
        var b = el.__ball;
        if (b) {
          if (ballOp > 0.001 && p >= 0) {
            var fill = el.querySelector('.fill');
            var er = el.getBoundingClientRect(), fr = fill.getBoundingClientRect(), d = el.__ballD;
            var hop = Math.abs(Math.sin(p * Math.PI * el.__beats));
            var x = fr.left - er.left + p * fr.width - d / 2;
            var by = fr.top - er.top + fr.height * 0.16 - d - hop * fs * 0.28;
            b.style.transform = 'translate(' + x.toFixed(1) + 'px,' + by.toFixed(1) + 'px) scale(' + (1 + (1 - hop) * 0.12).toFixed(3) + ',' + (1 - (1 - hop) * 0.12).toFixed(3) + ')';
          }
          b.style.opacity = ballOp.toFixed(4);
        }
        return { transform: 'translateY(' + y.toFixed(2) + 'px)', opacity: op };
      },
    },

    // แถบชื่อ Lower Third (พรีเมียม): ขีดสีโผล่ แถบปาดออก ข้อความสไลด์ตาม · สีขอบ = สีแถบ · สีตัวอักษร = สีข้อความและขีด
    lower: {
      intro: 1.0, outro: 0.6, loop: 3.0, fit: 1.08, premium: true,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        fill.style.position = 'relative';
        fill.style.zIndex = '1';
        fill.style.filter = 'none';
        el.__bar = addBox(el, 'tt-bar', 'left:.22em;right:.1em;top:.4em;bottom:.4em;border-radius:.06em;overflow:hidden;background:' + o.stroke + ';' +
          (o.shadow ? 'box-shadow:0 .06em .2em rgba(0,0,0,.4);' : ''));
        var sh = el.ownerDocument.createElement('i');
        sh.style.cssText = 'position:absolute;top:-10%;bottom:-10%;left:0;width:16%;opacity:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.28) 50%,transparent);';
        el.__bar.appendChild(sh);
        el.__barShine = sh;
        el.__acc = addBox(el, 'tt-acc', 'left:0;width:.13em;top:.32em;bottom:.32em;border-radius:.03em;background:' + o.fill + ';');
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var fill = el.querySelector('.fill');
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var acc = 1, bar = 1, rev = 1, tx = 0, cut = 0, barOrigin = '0% 50%', shine = -1;
        if (t < intro) {
          acc = easeOutCubic(clamp(t / (intro * 0.3), 0, 1));
          bar = easeOutExpo(clamp((t - intro * 0.12) / (intro * 0.5), 0, 1));
          var r = easeOutCubic(clamp((t - intro * 0.3) / (intro * 0.6), 0, 1));
          rev = r; tx = (1 - r) * -0.5 * fs;
        }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 3) : -1;
        if (h >= 0.2 && h < 1.0) shine = easeInOutSine((h - 0.2) / 0.8);
        if (t >= timing.fadeStart) {
          var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1);
          var tq = easeInCubic(clamp(q / 0.5, 0, 1));
          rev = 1 - tq; tx = -tq * 0.3 * fs;
          bar = 1 - easeInCubic(clamp((q - 0.2) / 0.55, 0, 1)); barOrigin = '0% 50%';
          acc = 1 - easeInCubic(clamp((q - 0.6) / 0.35, 0, 1));
        }
        if (el.__bar) { el.__bar.style.transformOrigin = barOrigin; el.__bar.style.transform = 'scaleX(' + bar.toFixed(4) + ')'; el.__bar.style.opacity = bar > 0.002 ? '1' : '0'; }
        if (el.__barShine) { el.__barShine.style.opacity = shine >= 0 ? '1' : '0'; el.__barShine.style.transform = 'translateX(' + (lerp(-120, 720, Math.max(0, shine))).toFixed(2) + '%) skewX(-22deg)'; }
        if (el.__acc) { el.__acc.style.transform = 'scaleY(' + acc.toFixed(4) + ')'; el.__acc.style.opacity = acc > 0.002 ? '1' : '0'; }
        fill.style.clipPath = 'inset(-20% -10% -20% 0)';
        fill.style.transform = tx ? 'translateX(' + tx.toFixed(2) + 'px)' : '';
        fill.style.opacity = rev.toFixed(4);
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    // กระแทกสะเทือน (พรีเมียม): ข้อความกระแทกลงจอ สั่น คลื่นกระแทกและเศษกระจาย · ค้าง: เต้นตุบๆ · ออก: หดหายหมุน
    impact: {
      intro: 0.9, outro: 0.5, loop: 2.0, fit: 1.16, premium: true,
      build: function (el, o) {
        var doc = el.ownerDocument;
        el.__ring = addBox(el, 'tt-ring', 'left:0;right:0;top:0;bottom:0;border-radius:50%;opacity:0;border:' + Math.max(2, Math.round(o.size * 0.05)) + 'px solid ' + o.fill + ';');
        el.__bits = [];
        for (var j = 0; j < 12; j++) {
          var b = doc.createElement('i');
          b.className = 'tt-x tt-bit';
          b.setAttribute('aria-hidden', 'true');
          var len = (0.35 + hash(j + 80) * 0.35).toFixed(3);
          b.style.cssText = 'position:absolute;left:50%;top:50%;width:' + len + 'em;height:.09em;margin:-.045em 0 0 -' + (len / 2).toFixed(3) + 'em;border-radius:.05em;opacity:0;pointer-events:none;background:' + (j % 3 === 2 ? o.stroke : o.fill) + ';';
          el.appendChild(b);
          el.__bits.push({ el: b, a: (j / 12) * Math.PI * 2 + (hash(j + 90) - 0.5) * 0.4, k: 0.85 + hash(j + 100) * 0.4 });
        }
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var T0 = Math.min(0.28, intro * 0.35);
        var s = 1, op = 1, dx = 0, dy = 0, rot = 0, ring = -1, burst = -1;
        if (t < T0) { var p = clamp(t / T0, 0, 1); s = lerp(3.4, 1, easeInCubic(p)); op = clamp(p * 2.5, 0, 1); }
        else if (t < intro) {
          var d = 1 - clamp((t - T0) / (intro - T0), 0, 1), amp = d * d * 0.06 * fs, sd = Math.floor(t * 60);
          dx = (hash(sd) - 0.5) * 2 * amp; dy = (hash(sd + 500) - 0.5) * 2 * amp;
          s = 1 + Math.sin((t - T0) * 40) * 0.05 * d * d;
          ring = (t - T0) / Math.max(0.2, intro - T0); burst = ring;
        }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2) : -1;
        if (h >= 0.1 && h < 0.35) s = 1 + 0.07 * Math.sin(((h - 0.1) / 0.25) * Math.PI);
        else if (h >= 0.35 && h < 0.6) s = 1 + 0.04 * Math.sin(((h - 0.35) / 0.25) * Math.PI);
        if (h >= 0.1 && h < 0.7) ring = ((h - 0.1) / 0.6) * 0.75 + 0.25;
        if (t >= timing.fadeStart) {
          var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1);
          s *= 1 - easeInBack(q); rot = q * -12; op = 1 - clamp((q - 0.6) / 0.4, 0, 1);
        }
        if (t >= timing.fadeEnd) op = 0;
        if (el.__ring) {
          var ru = ring > 0 && ring < 1 ? ring : -1;
          el.__ring.style.opacity = ru < 0 ? '0' : ((1 - ru) * (h >= 0 ? 0.45 : 0.9)).toFixed(4);
          el.__ring.style.transform = 'scale(' + lerp(0.75, 1.45, easeOutCubic(Math.max(0, ru))).toFixed(4) + ')';
        }
        var W = el.offsetWidth / 2, H = el.offsetHeight / 2;
        (el.__bits || []).forEach(function (b) {
          var u = burst > 0 && burst < 1 ? burst : -1;
          if (u < 0) { b.el.style.opacity = '0'; return; }
          var r = lerp(0.55, 1.3, easeOutCubic(u)) * b.k;
          b.el.style.opacity = (1 - u).toFixed(4);
          b.el.style.transform = 'translate(' + (Math.cos(b.a) * W * r).toFixed(1) + 'px,' + (Math.sin(b.a) * H * r * 1.3).toFixed(1) + 'px) rotate(' + (b.a * 180 / Math.PI).toFixed(2) + 'deg) scaleX(' + (1 - u * 0.8).toFixed(3) + ')';
        });
        return { transform: 'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px) rotate(' + rot.toFixed(2) + 'deg) scale(' + Math.max(0, s).toFixed(5) + ')', opacity: op };
      },
    },

    // กล่องแชท (พรีเมียม): กล่องข้อความเด้งขึ้น จุดกำลังพิมพ์... แล้วข้อความโผล่ · ค้าง: กล่องโยกเบาๆ · สีขอบ = สีกล่อง
    bubble: {
      intro: 1.2, outro: 0.5, loop: 2.4, fit: 1.16, premium: true,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        fill.style.position = 'relative';
        fill.style.zIndex = '1';
        fill.style.filter = 'none';
        var box = addBox(el, 'tt-bubble', 'left:.05em;right:.05em;top:.2em;bottom:.3em;border-radius:.55em;background:' + o.stroke + ';' +
          (o.shadow ? 'box-shadow:0 .08em .25em rgba(0,0,0,.35);' : ''));
        var tail = el.ownerDocument.createElement('i');
        tail.style.cssText = 'position:absolute;left:14%;bottom:-.17em;width:.42em;height:.42em;border-radius:.06em;background:' + o.stroke + ';transform:rotate(45deg) skew(8deg,8deg);';
        box.appendChild(tail);
        el.__box = box;
        var dots = addBox(el, 'tt-dots', 'left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center;gap:.16em;z-index:2;opacity:0;');
        el.__dots = [0, 1, 2].map(function () {
          var d = el.ownerDocument.createElement('i');
          d.style.cssText = 'display:block;width:.2em;height:.2em;border-radius:50%;background:' + o.fill + ';';
          dots.appendChild(d);
          return d;
        });
        el.__dotsBox = dots;
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var fill = el.querySelector('.fill');
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var bs = 1, txt = 1, ty = 0, dotsOp = 0, s = 1, rot = 0, op = 1;
        var short = intro < 0.7; // โหมดซับ: ไม่มีจุดกำลังพิมพ์
        if (t < intro) {
          bs = easeOutBack(clamp(t / (short ? intro : 0.45), 0, 1));
          op = clamp(t / 0.08, 0, 1);
          if (!short) {
            dotsOp = clamp((t - 0.15) / 0.12, 0, 1) * (1 - clamp((t - 0.62) / 0.12, 0, 1));
            var r = easeOutCubic(clamp((t - 0.66) / (intro - 0.66), 0, 1)); txt = r; ty = (1 - r) * 0.25 * fs;
          } else { var r2 = easeOutCubic(clamp(t / intro, 0, 1)); txt = r2; ty = (1 - r2) * 0.2 * fs; }
        }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.4) : -1;
        if (h >= 0.1 && h < 1.1) { var w = (h - 0.1) / 1.0; rot = Math.sin(w * Math.PI * 2) * 2.2 * Math.sin(w * Math.PI); s = 1 + 0.03 * Math.sin(w * Math.PI); }
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1); s *= 1 - easeInBack(q); op = 1 - clamp((q - 0.5) / 0.5, 0, 1); }
        if (t >= timing.fadeEnd) op = 0;
        if (el.__box) { el.__box.style.transformOrigin = '18% 100%'; el.__box.style.transform = 'scale(' + Math.max(0, bs).toFixed(4) + ')'; }
        (el.__dots || []).forEach(function (d, i) {
          var u = ((t - i * 0.1) % 0.45) / 0.45;
          d.style.transform = 'translateY(' + (-Math.max(0, Math.sin(u * Math.PI * 2)) * 0.12 * fs).toFixed(2) + 'px)';
        });
        if (el.__dotsBox) el.__dotsBox.style.opacity = dotsOp.toFixed(4);
        fill.style.opacity = txt.toFixed(4);
        fill.style.transform = ty ? 'translateY(' + ty.toFixed(2) + 'px)' : '';
        el.style.transformOrigin = '18% 100%';
        return { transform: 'rotate(' + rot.toFixed(3) + 'deg) scale(' + Math.max(0, s).toFixed(5) + ')', opacity: op };
      },
    },

    /* ==================== ท่าชุดที่ 3 (ฟรี 4 · พรีเมียม 6) ====================
     * กติกาเดียวกับชุดก่อน: ภาพตอนจบท่าเข้า = ภาพท้ายรอบค้าง = ภาพเริ่มท่าออก · timing.still (โหมดซับ) ช่วงค้างนิ่ง
     */

    // ชัดขึ้นนุ่มๆ (ฟรี): ตัวอักษรค่อยๆ ชัดจากความเบลอ ระยะห่างหดเข้าเล็กน้อย · ออก: เบลอจางหาย (สายมินิมอล/Vlog)
    blur: {
      intro: 0.9, outro: 0.5, loop: 0, fit: 1.1, premium: false,
      build: function (el, o) {
        el.__units = buildUnits(el.querySelector('.fill'), graphemeUnits(o.text));
      },
      frame: function (el, t, timing) {
        var units = el.__units || [], n = units.length || 1;
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var st = Math.min(0.035, (intro * 0.4) / Math.max(1, n - 1)), dur = Math.max(0.1, intro - st * (n - 1) - 0.02);
        var mid = (n - 1) / 2, sc = 1, op = 1;
        if (t < intro) sc = lerp(1.06, 1, easeOutCubic(clamp(t / intro, 0, 1)));
        var q = t >= timing.fadeStart ? clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1) : -1;
        if (q >= 0) { sc = lerp(1, 0.96, easeInCubic(q)); op = 1 - easeInCubic(q); }
        units.forEach(function (s, i) {
          var x = 0, blur = 0, o2 = 1;
          if (t < intro) {
            var e = easeOutCubic(clamp((t - st * i) / dur, 0, 1));
            o2 = clamp(e * 1.3, 0, 1); blur = (1 - e) * 0.16 * fs; x = (1 - e) * (i - mid) * 0.05 * fs;
          }
          if (q >= 0) { blur += easeInCubic(q) * 0.14 * fs; x += easeInCubic(q) * (i - mid) * 0.04 * fs; }
          s.style.opacity = o2.toFixed(4);
          s.style.filter = blur > 0.05 ? 'blur(' + blur.toFixed(2) + 'px)' : 'none';
          s.style.transform = x ? 'translateX(' + x.toFixed(2) + 'px)' : 'none';
        });
        return { transform: 'scale(' + sc.toFixed(5) + ')', opacity: t >= timing.fadeEnd ? 0 : op };
      },
    },

    // คลื่นตัวอักษร (ฟรี): ตัวอักษรเด้งขึ้นทีละตัว · ค้าง: คลื่นวิ่งผ่านจากซ้ายไปขวา · ออก: ร่วงลงทีละตัว
    wave: {
      intro: 0.9, outro: 0.5, loop: 1.8, fit: 1.14, premium: false,
      build: function (el, o) {
        el.__units = buildUnits(el.querySelector('.fill'), graphemeUnits(o.text));
        el.__units.forEach(function (s) { s.style.transformOrigin = '50% 100%'; });
      },
      frame: function (el, t, timing) {
        var units = el.__units || [], n = units.length || 1;
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var st = Math.min(0.05, (intro * 0.45) / Math.max(1, n - 1)), dur = Math.max(0.12, intro - st * (n - 1) - 0.02);
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 1.8) : -1;
        units.forEach(function (s, i) {
          var y = 0, sc = 1, op = 1;
          if (t < intro) {
            var p = clamp((t - st * i) / dur, 0, 1);
            y = (1 - easeOutBack(p)) * 0.55 * fs; op = clamp(p * 4, 0, 1); sc = lerp(0.6, 1, easeOutCubic(p));
          }
          if (h >= 0) {
            var u = (h - 0.1 - 0.6 * (i / Math.max(1, n - 1))) / 0.5;
            if (u > 0 && u < 1) { var a = Math.sin(u * Math.PI); y -= a * 0.2 * fs; sc *= 1 + 0.06 * a; }
          }
          if (t >= timing.fadeStart) {
            var q = clamp((t - timing.fadeStart - (outLen * 0.35) * (i / Math.max(1, n - 1))) / (outLen * 0.5), 0, 1);
            y += easeInCubic(q) * 0.6 * fs; op = Math.min(op, 1 - q);
          }
          s.style.opacity = op.toFixed(4);
          s.style.transform = (y || sc !== 1) ? 'translateY(' + y.toFixed(2) + 'px) scale(' + sc.toFixed(4) + ')' : 'none';
        });
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    // ปั๊มตรา (ฟรี): ข้อความในกรอบกระแทกลงเหมือนตรายาง เอียงนิดๆ · สีตัวอักษร = สีตราและกรอบ
    stamp: {
      intro: 0.6, outro: 0.5, loop: 0, fit: 1.16, premium: false,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        fill.style.position = 'relative';
        fill.style.zIndex = '1';
        var bw = Math.max(2, Math.round(o.size * 0.07)), ow = Math.max(1, Math.round(o.size * (o.strokeRatio || 0) * 0.6));
        var sh = [];
        if (o.strokeRatio > 0) sh.push('0 0 0 ' + ow + 'px ' + o.stroke, 'inset 0 0 0 ' + ow + 'px ' + o.stroke);
        if (o.shadow) sh.push('0 ' + (o.size * 0.05).toFixed(1) + 'px ' + (o.size * 0.08).toFixed(1) + 'px rgba(0,0,0,.4)');
        el.__box = addBox(el, 'tt-stamp', 'left:.08em;right:.08em;top:.3em;bottom:.3em;border-radius:.16em;border:' + bw + 'px solid ' + o.fill + ';' + (sh.length ? 'box-shadow:' + sh.join(',') + ';' : ''));
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var T = intro * 0.5, s = 1, op = 1, dx = 0, dy = 0, rot = -6;
        if (t < T) { var p = clamp(t / T, 0, 1); s = lerp(2.4, 1, easeInCubic(p)); op = clamp(p * 2.2, 0, 1); rot = lerp(-14, -6, p); }
        else if (t < intro) {
          var r = clamp((t - T) / (intro - T), 0, 1), d = 1 - r;
          s = 1 - 0.07 * Math.sin(r * Math.PI) * d;
          var sd = Math.floor(t * 60), amp = d * d * 0.035 * fs;
          dx = (hash(sd + 3) - 0.5) * 2 * amp; dy = (hash(sd + 900) - 0.5) * 2 * amp;
        }
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1); s *= lerp(1, 1.3, easeInCubic(q)); op = 1 - easeInCubic(q); }
        if (t >= timing.fadeEnd) op = 0;
        return { transform: 'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px) rotate(' + rot.toFixed(3) + 'deg) scale(' + s.toFixed(5) + ')', opacity: op };
      },
    },

    // ประกบสองซีก (ฟรี): ครึ่งบนพุ่งมาจากซ้าย ครึ่งล่างจากขวา มาประกบกันพอดี · ออก: แยกออกคนละทาง
    split: {
      intro: 0.8, outro: 0.5, loop: 0, fit: 1.06, premium: false,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        var f = fill.style.filter ? 'filter:' + fill.style.filter + ';' : '';
        el.__halves = [['inset(-40% -60% 50% -60%)'], ['inset(50% -60% -40% -60%)']].map(function (c) {
          return overlayText(el, 'tt-half', o.text, 'color:' + o.fill + ';' + f + 'clip-path:' + c[0] + ';visibility:hidden;');
        });
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var fill = el.querySelector('.fill');
        var W = el.offsetWidth || 400;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var off = 0, op = 1;
        if (t < intro) { var p = clamp(t / intro, 0, 1); off = 1 - easeOutExpo(p); op = clamp(p * 3, 0, 1); }
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1); off = -easeInCubic(q); op = 1 - easeInCubic(clamp((q - 0.2) / 0.8, 0, 1)); }
        if (t >= timing.fadeEnd) op = 0;
        // นิ่งแล้ว: ใช้ตัวหลักชิ้นเดียว (ไม่มีรอยต่อกลางตัวอักษร)
        var moving = Math.abs(off) > 0.0005;
        fill.style.visibility = moving ? 'hidden' : '';
        (el.__halves || []).forEach(function (s, i) {
          s.style.visibility = moving ? 'visible' : 'hidden';
          s.style.transform = 'translateX(' + ((i ? 1 : -1) * off * W * 0.7).toFixed(2) + 'px)';
        });
        return { transform: 'none', opacity: op };
      },
    },

    // สีรุ้งไหล (พรีเมียม): ตัวอักษรเด้งเข้าทีละตัว · ค้าง: สีรุ้งไหลผ่านตัวอักษรต่อเนื่อง (วนครบรอบพอดี) · ไม่ใช้สีตัวอักษร
    rainbow: {
      intro: 0.9, outro: 0.5, loop: 1.6, fit: 1.12, premium: true,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        el.style.position = 'relative';
        el.__units = buildUnits(fill, graphemeUnits(o.text));
        var grad = 'linear-gradient(90deg,#ff3b6b,#ff9f1c,#ffe14d,#3ddc84,#1fb6ff,#8b5cf6,#ff3b6b)';
        var W = Math.max(1, fill.offsetWidth), x0 = fill.offsetLeft;
        el.__rbW = W;
        el.__units.forEach(function (s) {
          s.style.backgroundImage = grad;
          s.style.backgroundSize = W + 'px 100%';
          s.style.backgroundRepeat = 'repeat-x';
          s.style.webkitBackgroundClip = 'text';
          s.style.backgroundClip = 'text';
          s.style.webkitTextFillColor = 'transparent';
          s.style.color = 'transparent';
          s.__x = s.offsetLeft - x0;
        });
      },
      frame: function (el, t, timing) {
        var units = el.__units || [], n = units.length || 1;
        var fs = parseFloat(el.style.fontSize) || 100, W = el.__rbW || 1;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var st = Math.min(0.05, (intro * 0.45) / Math.max(1, n - 1)), dur = Math.max(0.12, intro - st * (n - 1) - 0.02);
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 1.6) : 0;
        var shift = (h / (timing.loop || 1.6)) * W; // ไหลครบหนึ่งช่วงสีพอดีรอบ → วนต่อกันเนียน
        units.forEach(function (s, i) {
          var sc = 1, y = 0, op = 1, rot = 0;
          if (t < intro) { var p = clamp((t - st * i) / dur, 0, 1); sc = p <= 0 ? 0 : easeOutBack(p); y = (1 - easeOutCubic(p)) * 0.25 * fs; rot = (1 - easeOutCubic(p)) * (i % 2 ? 10 : -10); op = clamp(p * 4, 0, 1); }
          if (t >= timing.fadeStart) {
            var q = clamp((t - timing.fadeStart - (outLen * 0.35) * (i / Math.max(1, n - 1))) / (outLen * 0.5), 0, 1);
            sc *= 1 - easeInBack(q); op = Math.min(op, q >= 1 ? 0 : 1);
          }
          s.style.backgroundPosition = (shift - (s.__x || 0)).toFixed(2) + 'px 0';
          s.style.opacity = op.toFixed(4);
          s.style.transform = (sc === 1 && !y && !rot) ? 'none' : 'translateY(' + y.toFixed(2) + 'px) rotate(' + rot.toFixed(2) + 'deg) scale(' + Math.max(0, sc).toFixed(5) + ')';
        });
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    // น้ำเติมตัวอักษร (พรีเมียม): ตัวอักษรว่างเปล่า แล้วน้ำสีไหลขึ้นมาเต็มเป็นคลื่น · ค้าง: น้ำลดแล้วเติมใหม่ · สีตัวอักษร = สีน้ำ
    liquid: {
      intro: 1.2, outro: 0.5, loop: 2.2, fit: 1.08, premium: true,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        fill.style.color = mix(o.fill, o.strokeRatio > 0 ? o.stroke : '#000000', 0.72);
        el.__back = overlayText(el, 'tt-liq', o.text, 'color:' + mix(o.fill, '#ffffff', 0.45) + ';');
        el.__front = overlayText(el, 'tt-liq', o.text, 'color:' + o.fill + ';');
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var L = 1, op = 1, ph = t * Math.PI * 2 * 0.9;
        if (t < intro) { L = easeInOutSine(clamp((t - 0.12) / (intro * 0.86 - 0.12), 0, 1)); op = clamp(t / 0.12, 0, 1); }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.2) : -1;
        if (h >= 0.15 && h < 1.25) { var w = Math.sin(Math.PI * (h - 0.15) / 1.1); L = 1 - 0.55 * w * w; }
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1); L = 1 - easeInCubic(clamp(q / 0.7, 0, 1)); op = 1 - easeInCubic(clamp((q - 0.35) / 0.65, 0, 1)); }
        if (t >= timing.fadeEnd) op = 0;
        // ระดับน้ำ: ตัวอักษรอยู่ราว 22%–80% ของกล่อง · คลื่นแรงตอนครึ่งๆ หายไปเมื่อเต็มหรือว่าง
        var amp = 6 * Math.sin(Math.PI * clamp(L, 0, 1));
        var shape = function (lvl, phase, a) {
          if (lvl >= 1 && a < 0.01) return 'inset(-40% -40% -40% -40%)'; // เต็ม (ไม่ใช้ none: Chrome บางรุ่นไม่วาดใหม่ตอนลบ clip-path)
          var y0 = lerp(82, 20, lvl), pts = [];
          for (var k = 0; k <= 24; k++) { var x = -10 + k * 5; pts.push(x + '% ' + (y0 + a * Math.sin(phase + x / 100 * Math.PI * 3)).toFixed(2) + '%'); }
          pts.push('110% 140%', '-10% 140%');
          return 'polygon(' + pts.join(',') + ')';
        };
        if (el.__front) el.__front.style.clipPath = shape(L, ph, amp);
        if (el.__back) {
          el.__back.style.clipPath = shape(Math.min(1, L + 0.05 * Math.sin(Math.PI * L)), ph + Math.PI * 0.8, amp * 0.8);
          el.__back.style.opacity = L > 0.001 && L < 0.999 ? '1' : '0';
        }
        if (el.__front) el.__front.style.opacity = L > 0.001 ? '1' : '0';
        return { transform: 'none', opacity: op };
      },
    },

    // สติกเกอร์ (พรีเมียม): ขอบขาวหนาแบบสติกเกอร์ไดคัท ตบลงจอเอียงนิดๆ · ค้าง: โยกดุ๊กดิ๊ก แสงวาบ · สีขอบ = สีขอบสติกเกอร์ (หนาเสมอ)
    sticker: {
      intro: 0.8, outro: 0.5, loop: 2.4, fit: 1.3, premium: true,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        var id = o.filterId || 'outline', f = el.ownerDocument.getElementById(id);
        if (f) {
          f.querySelector('.m-grow').setAttribute('radius', Math.max(2, Math.round(o.size * 0.085)));
          f.querySelector('.m-outline').setAttribute('flood-color', o.stroke || '#ffffff');
          f.querySelector('.m-outline').setAttribute('flood-opacity', '1');
          f.querySelector('.m-blur').setAttribute('stdDeviation', (o.size * 0.03).toFixed(2));
          f.querySelector('.m-off').setAttribute('dy', (o.size * 0.045).toFixed(2));
          f.querySelector('.m-shadow').setAttribute('flood-opacity', o.shadow ? '0.45' : '0.25');
        }
        fill.style.filter = 'url(#' + id + ')';
        el.__shine = overlayText(el, 'tt-shine', o.text, 'color:#fff;visibility:hidden;opacity:.75;');
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var s = 1, rot = -4, op = 1, band = -1;
        if (t < intro) { var p = clamp(t / intro, 0, 1); s = Math.max(0, easeOutBack(p)); rot = lerp(-28, -4, easeOutBack(p)); op = clamp(p * 5, 0, 1); }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.4) : -1;
        if (h >= 0.1 && h < 1.0) { var w = (h - 0.1) / 0.9; rot += Math.sin(w * Math.PI * 4) * 4 * (1 - w); s *= 1 + 0.05 * Math.sin(w * Math.PI); }
        if (h >= 1.0 && h < 1.6) band = easeInOutSine((h - 1.0) / 0.6);
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1); s *= 1 - easeInBack(q); rot += q * 20; op = 1 - clamp((q - 0.6) / 0.4, 0, 1); }
        if (t >= timing.fadeEnd) op = 0;
        var sh = el.__shine;
        if (sh) {
          if (band < 0) sh.style.visibility = 'hidden';
          else {
            var c = lerp(-25, 125, band);
            var g2 = 'linear-gradient(115deg,transparent ' + (c - 12).toFixed(2) + '%,#000 ' + c.toFixed(2) + '%,transparent ' + (c + 12).toFixed(2) + '%)';
            sh.style.visibility = 'visible'; sh.style.webkitMaskImage = g2; sh.style.maskImage = g2;
          }
        }
        return { transform: 'rotate(' + rot.toFixed(3) + 'deg) scale(' + Math.max(0, s).toFixed(5) + ')', opacity: op };
      },
    },

    // ถอดรหัส (พรีเมียม): ตัวอักษรสุ่มรัวๆ แล้วล็อกเป็นคำจริงทีละตัวจากซ้ายไปขวา · ค้าง: บางตัวสุ่มใหม่แล้วล็อกกลับ · ออก: สุ่มแล้วหาย
    scramble: {
      intro: 1.2, outro: 0.5, loop: 2.6, fit: 1.1, premium: true,
      build: function (el, o) {
        var units = graphemeUnits(o.text);
        el.__units = buildUnits(el.querySelector('.fill'), units);
        el.__real = el.__units.map(function (s) { return s.textContent; });
        // ล็อกความกว้างแต่ละช่อง ตัวที่สุ่มกว้าง/แคบไม่ทำให้ทั้งคำขยับ
        var ws = el.__units.map(function (s) { return s.getBoundingClientRect().width; });
        el.__units.forEach(function (s, i) { s.style.width = ws[i].toFixed(2) + 'px'; s.style.textAlign = 'center'; });
        el.__acc = luminance(o.fill) > 0.55 ? mix(o.fill, '#3ddc84', 0.6) : mix(o.fill, '#ffffff', 0.55);
      },
      frame: function (el, t, timing) {
        var units = el.__units || [], n = units.length || 1, real = el.__real || [];
        var GL = 'กขคงจฉชซญดตถทธนบปผพฟมยรลวศสหอฮ0123456789#%&@?';
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var seed = Math.floor(t * 20);
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.6) : -1;
        var q = t >= timing.fadeStart ? clamp((t - timing.fadeStart) / outLen, 0, 1) : -1;
        units.forEach(function (s, i) {
          var r = n > 1 ? i / (n - 1) : 0, locked = true, op = 1;
          if (t < intro) { locked = t >= 0.12 * intro + 0.72 * intro * r; op = clamp((t - 0.6 * intro * r * 0.3) / 0.06, 0, 1); }
          if (h >= 0 && hash(i + 13) > 0.55) { var a = 0.3 + hash(i + 31) * 0.4; if (h >= a && h < a + 0.4) locked = false; }
          if (q >= 0) { if (q >= 0.5 * r) locked = false; op = 1 - clamp((q - 0.25 - 0.45 * r) / 0.2, 0, 1); }
          var txt = locked ? real[i] : GL.charAt(Math.floor(hash(seed * 7 + i * 13 + 1) * GL.length));
          if (s.textContent !== txt) s.textContent = txt;
          s.style.color = locked ? '' : el.__acc;
          s.style.opacity = op.toFixed(4);
        });
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    // หัวใจลอย (พรีเมียม): ข้อความเด้งเข้าพร้อมหัวใจกระจาย · ค้าง: ข้อความเต้นตึกตัก หัวใจลอยขึ้น · สีขอบ = สีหัวใจ
    hearts: {
      intro: 0.8, outro: 0.5, loop: 2.4, fit: 1.3, premium: true,
      build: function (el, o) {
        var doc = el.ownerDocument;
        var sc0 = hexRgb(o.stroke), colorful = Math.max.apply(null, sc0) - Math.min.apply(null, sc0) > 60;
        var col = o.strokeRatio > 0 && colorful ? o.stroke : '#ff3d7f'; // ขอบดำ/ขาว/เทา → หัวใจสีชมพู
        el.__hearts = [];
        for (var j = 0; j < 9; j++) {
          var s = doc.createElement('span');
          s.className = 'tt-x tt-heart';
          s.setAttribute('aria-hidden', 'true');
          var sz = (0.32 + hash(j + 200) * 0.3).toFixed(3), c = j % 3 === 1 ? mix(col, '#ffffff', 0.45) : col;
          s.style.cssText = 'position:absolute;left:0;top:0;width:' + sz + 'em;height:' + sz + 'em;margin:-' + (sz / 2).toFixed(3) + 'em 0 0 -' + (sz / 2).toFixed(3) + 'em;opacity:0;pointer-events:none;z-index:2;';
          s.innerHTML = '<svg viewBox="-6 -7 12 12" width="100%" height="100%" style="display:block;overflow:visible"><path d="M0 4.2C-2.6 2.2-5.6 0-5.6-2.9-5.6-5-4-6.4-2.3-6.4-1.2-6.4-.4-5.8 0-4.9.4-5.8 1.2-6.4 2.3-6.4 4-6.4 5.6-5 5.6-2.9 5.6 0 2.6 2.2 0 4.2Z" fill="' + c + '" stroke="#ffffff" stroke-width=".9"/></svg>';
          el.appendChild(s);
          el.__hearts.push({ el: s, x: 0.08 + 0.84 * ((j * 0.37 + hash(j + 210) * 0.2) % 1), a: (j / 9) * Math.PI * 2 + 0.3, sw: (hash(j + 220) - 0.5) * 2 });
        }
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var s = 1, op = 1;
        if (t < intro) { var p = clamp(t / (intro * 0.75), 0, 1); s = lerp(0.3, 1, easeOutBack(p)); op = clamp(p * 4, 0, 1); }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.4) : -1;
        if (h >= 0.1 && h < 0.7) { var b = (h - 0.1) / 0.6; s *= 1 + 0.07 * Math.max(0, Math.sin(b * Math.PI * 2)) * (b < 0.5 ? 1 : 0.6); }
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1); s *= 1 - easeInBack(q) * 0.9; op = 1 - easeInCubic(q); }
        if (t >= timing.fadeEnd) op = 0;
        var W = el.offsetWidth, H = el.offsetHeight;
        (el.__hearts || []).forEach(function (hh, j) {
          var x, y, a = 0, sc = 1, rot = 0;
          if (t < intro && !timing.still && intro > 0.5) {
            // ตอนเข้า: หัวใจพุ่งออกจากกลางคำ
            var u = (t - 0.12 - j * 0.02) / (intro - 0.05);
            if (u > 0 && u < 1) { var e = easeOutCubic(u); x = W / 2 + Math.cos(hh.a) * W * 0.55 * e; y = H / 2 + Math.sin(hh.a) * H * 0.75 * e; a = Math.sin(u * Math.PI); sc = 0.4 + 0.8 * e; rot = hh.sw * 30 * e; }
          } else if (h >= 0) {
            // ช่วงค้าง: ลอยขึ้นแกว่งไปมา ทุกดวงหายก่อนจบรอบ
            var v = (h - 0.1 - j * 0.08) / 0.9;
            if (v > 0 && v < 1) { x = W * hh.x + Math.sin(v * Math.PI * 2) * W * 0.03 * hh.sw; y = lerp(H * 0.72, -H * 0.25, easeOutCubic(v)); a = Math.sin(v * Math.PI); sc = 0.6 + 0.5 * v; rot = hh.sw * 18 * Math.sin(v * Math.PI * 2); }
          }
          if (!a) { hh.el.style.opacity = '0'; return; }
          hh.el.style.opacity = a.toFixed(4);
          hh.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + rot.toFixed(2) + 'deg) scale(' + sc.toFixed(3) + ')';
        });
        return { transform: 'scale(' + Math.max(0, s).toFixed(5) + ')', opacity: op };
      },
    },

    // ย้อนยุค 3D (พรีเมียม): ตัวอักษรเด้งเข้า เงายาวแบบยุค 80 ยืดออก · ค้าง: เงาหดแล้วยืดกลับ · สีขอบ = สีเงา 3D
    retro: {
      intro: 0.9, outro: 0.5, loop: 2.4, fit: 1.2, premium: true,
      build: function (el, o) {
        el.__ext = o.strokeRatio > 0 ? o.stroke : mix(o.fill, '#000000', 0.55);
        el.__soft = !!o.shadow;
        var id = o.filterId || 'outline', f = el.ownerDocument.getElementById(id);
        // ขอบเข้มกว่าเงา 3D เล็กน้อย ให้แยกชั้นชัด
        if (f && o.strokeRatio > 0) f.querySelector('.m-outline').setAttribute('flood-color', mix(o.stroke, '#000000', 0.55));
      },
      frame: function (el, t, timing) {
        var fill = el.querySelector('.fill');
        var fs = parseFloat(el.style.fontSize) || 100, D = fs * 0.18;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var s = 1, op = 1, k = 1;
        if (t < intro) { var p = clamp(t / (intro * 0.55), 0, 1); s = lerp(0.6, 1, easeOutBack(p)); op = clamp(p * 4, 0, 1); k = easeOutCubic(clamp((t - intro * 0.35) / (intro * 0.65), 0, 1)); }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.4) : -1;
        if (h >= 0.15 && h < 1.55) { var w = Math.sin(Math.PI * (h - 0.15) / 1.4); k = 1 - 0.65 * w * w; }
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1); k = 1 - easeInCubic(clamp(q / 0.6, 0, 1)); s = lerp(1, 0.85, easeInCubic(q)); op = 1 - easeInCubic(clamp((q - 0.3) / 0.7, 0, 1)); }
        if (t >= timing.fadeEnd) op = 0;
        var d = D * k, steps = Math.max(1, Math.min(28, Math.round(d))), sh = [];
        if (d > 0.3) for (var i = 1; i <= steps; i++) { var o2 = (d * i / steps).toFixed(2); sh.push(o2 + 'px ' + o2 + 'px 0 ' + el.__ext); }
        if (el.__soft && d > 0.3) sh.push((d + fs * 0.03).toFixed(2) + 'px ' + (d + fs * 0.04).toFixed(2) + 'px ' + (fs * 0.06).toFixed(2) + 'px rgba(0,0,0,.35)');
        fill.style.textShadow = sh.length ? sh.join(',') : 'none';
        // ตัวอักษรเลื่อนขึ้นซ้ายครึ่งหนึ่งของความลึก ภาพรวมจึงอยู่กลางเสมอ
        fill.style.transform = d > 0.01 ? 'translate(' + (-d / 2).toFixed(2) + 'px,' + (-d / 2).toFixed(2) + 'px)' : '';
        return { transform: 'scale(' + s.toFixed(5) + ')', opacity: op };
      },
    },

    /* ==================== ท่าชุดที่ 4 (ฟรี 5 · พรีเมียม 6) ====================
     * กติกาเดิม + ส่วนที่ขยับของรอบค้างต้องจบภายในช่วงค้างของคลิป 3 วินาที (3 - เข้า - ออก)
     */

    // สไลด์เข้า (ฟรี): ข้อความพุ่งเข้าจากซ้าย เอียงนิดๆ แล้วตั้งตรง · ออก: พุ่งออกขวา
    slide: {
      intro: 0.7, outro: 0.5, loop: 0, fit: 1.06, premium: false,
      frame: function (el, t, timing) {
        var W = el.offsetWidth || 400, fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var x = 0, sk = 0, op = 1, blur = 0;
        if (t < intro) { var p = clamp(t / intro, 0, 1), e = easeOutExpo(p); x = -(1 - e) * W * 0.55; sk = (1 - e) * -18; op = clamp(p * 4, 0, 1); blur = (1 - e) * 0.06 * fs; }
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1), eq = easeInCubic(q); x += eq * W * 0.55; sk += eq * 18; op = Math.min(op, 1 - eq); blur += eq * 0.06 * fs; }
        if (t >= timing.fadeEnd) op = 0;
        el.style.filter = blur > 0.05 ? 'blur(' + blur.toFixed(2) + 'px)' : '';
        return { transform: 'translateX(' + x.toFixed(2) + 'px) skewX(' + sk.toFixed(3) + 'deg)', opacity: op };
      },
    },

    // ลอยขึ้นทีละคำ (ฟรี): แต่ละคำค่อยๆ ลอยขึ้นและชัดตามจังหวะ (สไตล์แคปชันรีลส์) · ออก: ลอยต่อขึ้นแล้วหาย
    fadeup: {
      intro: 1.0, outro: 0.5, loop: 0, fit: 1.08, premium: false,
      build: function (el, o) { el.__units = buildUnits(el.querySelector('.fill'), wordUnits(o.text)); },
      frame: function (el, t, timing) {
        var units = el.__units || [], n = units.length || 1;
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var dur = Math.min(0.5, intro * 0.6), st = n > 1 ? Math.max(0, (intro - dur - 0.02) / (n - 1)) : 0;
        st = Math.min(st, 0.22);
        units.forEach(function (s, i) {
          var y = 0, op = 1, blur = 0;
          if (t < intro) { var e = easeOutCubic(clamp((t - st * i) / dur, 0, 1)); y = (1 - e) * 0.45 * fs; op = e; blur = (1 - e) * 0.07 * fs; }
          if (t >= timing.fadeStart) {
            var q = clamp((t - timing.fadeStart - (outLen * 0.3) * (i / Math.max(1, n - 1))) / (outLen * 0.6), 0, 1), eq = easeInCubic(q);
            y -= eq * 0.35 * fs; op = Math.min(op, 1 - eq); blur += eq * 0.06 * fs;
          }
          s.style.opacity = op.toFixed(4);
          s.style.filter = blur > 0.05 ? 'blur(' + blur.toFixed(2) + 'px)' : 'none';
          s.style.transform = y ? 'translateY(' + y.toFixed(2) + 'px)' : 'none';
        });
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    // ขีดเส้นใต้ (ฟรี): ข้อความโผล่ แล้วเส้นใต้ลากจากซ้ายไปขวา · ออก: เส้นหดไปทางขวา ข้อความจาง · สีตัวอักษร = สีเส้น
    underline: {
      intro: 0.9, outro: 0.5, loop: 0, fit: 1.08, premium: false,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        fill.style.position = 'relative'; fill.style.zIndex = '1';
        var ow = Math.max(1, Math.round(o.size * (o.strokeRatio || 0) * 0.6));
        el.__line = addBox(el, 'tt-uline', 'left:.42em;right:.42em;bottom:.36em;height:.1em;border-radius:.05em;background:' + o.fill + ';z-index:2;' +
          ((o.strokeRatio > 0 || o.shadow) ? 'box-shadow:' + [o.strokeRatio > 0 ? '0 0 0 ' + ow + 'px ' + o.stroke : '', o.shadow ? '0 ' + (o.size * 0.05).toFixed(1) + 'px ' + (o.size * 0.06).toFixed(1) + 'px rgba(0,0,0,.45)' : ''].filter(Boolean).join(',') + ';' : ''));
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var fill = el.querySelector('.fill');
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var ty = 0, top = 1, lw = 1, origin = '0% 50%';
        if (t < intro) {
          var e = easeOutCubic(clamp(t / (intro * 0.55), 0, 1)); ty = (1 - e) * 0.25 * fs; top = e;
          lw = easeInOutCubic(clamp((t - intro * 0.35) / (intro * 0.6), 0, 1));
        }
        if (t >= timing.fadeStart) {
          var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1);
          lw = 1 - easeInCubic(clamp(q / 0.6, 0, 1)); origin = '100% 50%';
          top = 1 - easeInCubic(clamp((q - 0.25) / 0.75, 0, 1)); ty = -easeInCubic(q) * 0.15 * fs;
        }
        if (el.__line) { el.__line.style.transformOrigin = origin; el.__line.style.transform = 'scaleX(' + lw.toFixed(4) + ')'; el.__line.style.opacity = lw > 0.002 ? '1' : '0'; }
        fill.style.opacity = top.toFixed(4);
        fill.style.transform = ty ? 'translateY(' + ty.toFixed(2) + 'px)' : '';
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    // ป้ายแขวน (ฟรี): ป้ายร่วงลงมาแล้วแกว่งไปมาเหมือนแขวนเชือก ค่อยๆ หยุดนิ่ง · ออก: ร่วงลงหาย
    swing: {
      intro: 1.3, outro: 0.5, loop: 0, fit: 1.16, premium: false,
      frame: function (el, t, timing) {
        var H = el.__H || 1080;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var y = 0, rot = 0, op = 1, T = Math.min(0.25, intro * 0.3);
        el.style.transformOrigin = '50% 8%';
        if (t < T) { var p = clamp(t / T, 0, 1); y = -(1 - easeOutCubic(p)) * H * 0.35; rot = 16 * easeOutCubic(p); op = clamp(p * 3, 0, 1); }
        else if (t < intro) { var u = clamp((t - T) / (intro - T), 0, 1); rot = 16 * Math.pow(1 - u, 2) * Math.cos(u * Math.PI * 5); }
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1), eq = easeInCubic(q); y += eq * H * 0.25; rot -= eq * 14; op = 1 - eq; }
        if (t >= timing.fadeEnd) op = 0;
        return { transform: 'translateY(' + y.toFixed(2) + 'px) rotate(' + rot.toFixed(3) + 'deg)', opacity: op };
      },
    },

    // ขีดฆ่าราคา (ฟรี): ข้อความเด้งเข้า แล้วเส้นขีดฆ่าปาดผ่าน (ราคาเดิม/คำที่ไม่ใช่) · สีขอบ = สีเส้นขีด
    strike: {
      intro: 0.9, outro: 0.5, loop: 0, fit: 1.1, premium: false,
      build: function (el, o) {
        var c0 = hexRgb(o.stroke), sh = Math.max.apply(null, c0) - Math.min.apply(null, c0) > 60 ? o.stroke : '#FF3B30'; // ขอบดำ/ขาว/เทา → เส้นแดง
        el.__strike = addBox(el, 'tt-strike', 'left:.25em;right:.25em;top:calc(54% - .055em);height:.11em;border-radius:.06em;z-index:2;background:' + sh + ';' +
          (o.shadow ? 'box-shadow:0 ' + (o.size * 0.03).toFixed(1) + 'px ' + (o.size * 0.05).toFixed(1) + 'px rgba(0,0,0,.4);' : ''));
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var s = 1, op = 1, lw = 1;
        if (t < intro) { var p = clamp(t / (intro * 0.45), 0, 1); s = lerp(0.7, 1, easeOutBack(p)); op = clamp(p * 3, 0, 1); lw = easeOutExpo(clamp((t - intro * 0.5) / (intro * 0.45), 0, 1)); }
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1); s = lerp(1, 0.9, easeInCubic(q)); op = 1 - easeInCubic(q); }
        if (t >= timing.fadeEnd) op = 0;
        if (el.__strike) { el.__strike.style.transformOrigin = '50% 50%'; el.__strike.style.transform = 'rotate(-4deg) translateX(' + (-(1 - lw) * 50).toFixed(3) + '%) scaleX(' + lw.toFixed(4) + ')'; el.__strike.style.opacity = lw > 0.002 ? '1' : '0'; }
        return { transform: 'scale(' + s.toFixed(5) + ')', opacity: op };
      },
    },

    // สปอตไลต์ (พรีเมียม): ข้อความมืด แสงไฟฉายส่องกวาดแล้วสว่างเต็ม · ค้าง: ไฟหรี่เหลือวงเดียว กวาดไปมาแล้วสว่างกลับ
    spotlight: {
      intro: 1.1, outro: 0.5, loop: 2.2, fit: 1.1, premium: true,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        fill.style.color = mix(o.fill, '#000000', 0.72);
        el.__lit = overlayText(el, 'tt-lit', o.text, 'color:' + o.fill + ';text-shadow:0 0 ' + (o.size * 0.12).toFixed(1) + 'px ' + mix(o.fill, '#ffffff', 0.5) + ';');
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var X = 50, R = 260, op = 1;
        if (t < intro) {
          op = clamp(t / 0.15, 0, 1);
          X = lerp(-20, 50, easeInOutSine(clamp((t - 0.05) / (intro * 0.6), 0, 1)));
          R = lerp(24, 260, easeInCubic(clamp((t - intro * 0.55) / (intro * 0.45), 0, 1)));
        }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.2) : -1;
        if (h >= 0.1 && h < 1.4) { var w = (h - 0.1) / 1.3, k = Math.sin(Math.PI * w); X = 50 + 42 * Math.sin(2 * Math.PI * w); R = lerp(260, 24, Math.min(1, k * 2.2)); }
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1); R = lerp(260, 0, easeInCubic(clamp(q / 0.7, 0, 1))); op = 1 - easeInCubic(q); }
        if (t >= timing.fadeEnd) op = 0;
        var m = R >= 259.9 ? 'linear-gradient(#000,#000)' : 'radial-gradient(' + R.toFixed(2) + '% 160% at ' + X.toFixed(2) + '% 50%,#000 55%,transparent 100%)';
        if (el.__lit) { el.__lit.style.webkitMaskImage = m; el.__lit.style.maskImage = m; }
        return { transform: 'none', opacity: op };
      },
    },

    // พลุกระดาษ (พรีเมียม): ข้อความเด้งเข้า · ค้าง: กระดาษสีพุ่งขึ้นแล้วร่วงหมุนติ้ว · เหมาะฉลอง/ขอบคุณ
    confetti: {
      intro: 0.8, outro: 0.5, loop: 2.4, fit: 1.25, premium: true,
      build: function (el, o) {
        var doc = el.ownerDocument, C = ['#ff3b6b', '#ffd400', '#3ddc84', '#1fb6ff', '#a259ff', '#ff9f1c'];
        el.__bits = [];
        for (var j = 0; j < 28; j++) {
          var b = doc.createElement('i');
          b.className = 'tt-x tt-conf';
          b.setAttribute('aria-hidden', 'true');
          var round = j % 4 === 3, w = round ? 0.2 : 0.15 + hash(j + 300) * 0.08, hh = round ? 0.2 : 0.28 + hash(j + 310) * 0.12;
          b.style.cssText = 'position:absolute;left:0;top:0;width:' + w.toFixed(3) + 'em;height:' + hh.toFixed(3) + 'em;margin:-' + (hh / 2).toFixed(3) + 'em 0 0 -' + (w / 2).toFixed(3) + 'em;border-radius:' + (round ? '50%' : '.02em') + ';opacity:0;pointer-events:none;z-index:2;background:' + C[j % C.length] + ';';
          el.appendChild(b);
          var a = -Math.PI / 2 + (hash(j + 320) - 0.5) * 2.2;
          el.__bits.push({ el: b, vx: Math.cos(a) * (0.5 + hash(j + 330) * 0.6), vy: Math.sin(a) * (0.9 + hash(j + 340) * 0.7), spin: (hash(j + 350) - 0.5) * 1440, x0: (hash(j + 360) - 0.5) * 0.5, d: hash(j + 370) * 0.15 });
        }
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var s = 1, op = 1, rot = 0;
        if (t < intro) { var p = clamp(t / intro, 0, 1); s = Math.max(0, lerp(0.2, 1, easeOutBack(p))); rot = (1 - easeOutCubic(p)) * -8; op = clamp(p * 4, 0, 1); }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.4) : -1;
        if (h >= 0.05 && h < 0.35) s = 1 + 0.08 * Math.sin(Math.PI * (h - 0.05) / 0.3);
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1); s = 1 - easeInBack(q); op = 1 - clamp((q - 0.5) / 0.5, 0, 1); }
        if (t >= timing.fadeEnd) op = 0;
        var W = el.offsetWidth, H = el.offsetHeight;
        (el.__bits || []).forEach(function (b) {
          var u = h >= 0 ? (h - 0.08 - b.d) / 1.2 : -1;
          if (!(u > 0 && u < 1)) { b.el.style.opacity = '0'; return; }
          var x = W * (0.5 + b.x0) + b.vx * W * 0.8 * u;
          var y = H * 0.4 + b.vy * H * 2.3 * u + H * 3.0 * u * u;
          var fl = Math.cos((b.spin * u) * Math.PI / 180 * 2);
          b.el.style.opacity = (u < 0.75 ? 1 : (1 - u) / 0.25).toFixed(4);
          b.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + (b.spin * u).toFixed(1) + 'deg) scaleX(' + fl.toFixed(3) + ')';
        });
        return { transform: 'rotate(' + rot.toFixed(3) + 'deg) scale(' + s.toFixed(5) + ')', opacity: op };
      },
    },

    // บล็อกเปิดเผย (พรีเมียม): แถบสีปาดคลุมแล้วเปิดเผยข้อความ สไตล์โมชันกราฟิก · ค้าง: ปาดซ้ำอีกรอบ · สีขอบ = สีแถบ
    reveal: {
      intro: 1.0, outro: 0.6, loop: 2.6, fit: 1.06, premium: true,
      build: function (el, o) {
        var bc = luminance(o.stroke) < 0.05 ? mix(o.fill, '#000000', 0.15) : o.stroke;
        el.__blk = addBox(el, 'tt-blk', 'left:.3em;right:.3em;top:.32em;bottom:.32em;z-index:3;background:' + bc + ';');
        el.__blk2 = addBox(el, 'tt-blk', 'left:.3em;right:.3em;top:.32em;bottom:.32em;z-index:2;background:' + mix(bc, '#ffffff', 0.55) + ';');
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var fill = el.querySelector('.fill');
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        // หนึ่งรอบปาด: c=0..1 · แถบ 1 ขยายจากซ้าย (0–.45) แล้วหดออกขวา (.5–1) · แถบ 2 (สีอ่อน) นำหน้าเล็กน้อย · ข้อความเปลี่ยนตอนแถบคลุมเต็ม
        var wipe = function (c, k0) {
          var a = clamp((c - k0) / 0.42, 0, 1), b = clamp((c - k0 - 0.5) / 0.42, 0, 1);
          if (c - k0 < 0.5) return { s: easeInOutCubic(a), o: '0% 50%' };
          return { s: 1 - easeInOutCubic(b), o: '100% 50%' };
        };
        var c = -1, textOn = 1;
        if (t < intro) { c = clamp(t / intro, 0, 1); textOn = c >= 0.48 ? 1 : 0; }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.6) : -1;
        if (h >= 0.25 && h < 1.25) c = (h - 0.25) / 1.0;
        var out = t >= timing.fadeStart ? clamp((t - timing.fadeStart) / (outLen * 0.95), 0, 1) : -1;
        if (out >= 0) { c = out; textOn = out < 0.48 ? 1 : 0; }
        var w1 = c >= 0 ? wipe(c, 0.06) : { s: 0, o: '0% 50%' }, w2 = c >= 0 ? wipe(c, 0) : { s: 0, o: '0% 50%' };
        [[el.__blk, w1], [el.__blk2, w2]].forEach(function (x) {
          if (!x[0]) return;
          x[0].style.transformOrigin = x[1].o; x[0].style.transform = 'scaleX(' + x[1].s.toFixed(4) + ')'; x[0].style.opacity = x[1].s > 0.002 ? '1' : '0';
        });
        fill.style.opacity = String(textOn);
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    // เงาซ้อน (พรีเมียม): ข้อความกลางเด้งเข้า เส้นขอบซ้ำบน-ล่างกางออก · ค้าง: เงาซ้อนยุบเข้าแล้วกางใหม่เป็นคลื่น
    echo: {
      intro: 1.0, outro: 0.5, loop: 2.0, fit: 1.12, premium: true,
      build: function (el, o) {
        var sw = Math.max(1, o.size * 0.022).toFixed(2);
        el.__echo = [-2, -1, 1, 2].map(function (k) {
          var s = overlayText(el, 'tt-echo', o.text, 'color:transparent;-webkit-text-fill-color:transparent;-webkit-text-stroke:' + sw + 'px ' + o.fill + ';opacity:0;', true);
          s.__k = k; return s;
        });
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var fill = el.querySelector('.fill');
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var s = 1, op = 1, sp = 1;
        if (t < intro) { var p = clamp(t / (intro * 0.5), 0, 1); s = lerp(0.6, 1, easeOutBack(p)); op = clamp(p * 3, 0, 1); sp = easeOutBack(clamp((t - intro * 0.35) / (intro * 0.65), 0, 1)); }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.0) : -1;
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1); sp = 1 - easeInCubic(clamp(q / 0.6, 0, 1)); s = lerp(1, 1.15, easeInCubic(q)); op = 1 - easeInCubic(q); }
        if (t >= timing.fadeEnd) op = 0;
        (el.__echo || []).forEach(function (e, i) {
          var a = Math.abs(e.__k), k = sp;
          if (h >= 0) { var u = (h - 0.1 - (a - 1) * 0.12) / 0.9; if (u > 0 && u < 1) k = 1 - Math.sin(Math.PI * u); }
          e.style.transform = 'translateY(' + (e.__k * 0.42 * fs * k).toFixed(2) + 'px)';
          e.style.opacity = (k <= 0.001 ? 0 : (a === 1 ? 0.75 : 0.4) * clamp(k * 2, 0, 1)).toFixed(4);
        });
        fill.style.transform = 'scale(' + s.toFixed(5) + ')';
        return { transform: 'none', opacity: op };
      },
    },

    // เยลลี่เด้งดึ๋ง (พรีเมียม): ตกลงมายุบแล้วเด้งดึ๋งเหมือนเยลลี่ · ค้าง: ตัวอักษรสั่นดึ๋งเป็นคลื่น · ออก: ยุบแบนหาย
    jelly: {
      intro: 1.1, outro: 0.5, loop: 2.0, fit: 1.22, premium: true,
      build: function (el, o) {
        el.__units = buildUnits(el.querySelector('.fill'), graphemeUnits(o.text));
        el.__units.forEach(function (s) { s.style.transformOrigin = '50% 90%'; });
      },
      frame: function (el, t, timing) {
        var units = el.__units || [], n = units.length || 1;
        var fs = parseFloat(el.style.fontSize) || 100;
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var T = Math.min(0.32, intro * 0.3);
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 2.0) : -1;
        units.forEach(function (s, i) {
          var y = 0, sx = 1, sy = 1, op = 1, r = n > 1 ? i / (n - 1) : 0;
          if (t < intro) {
            var t2 = t - r * 0.08;
            if (t2 < T) { var p = clamp(t2 / T, 0, 1); y = -(1 - p * p) * 1.1 * fs; sy = 1 + 0.18 * (1 - p); sx = 1 - 0.1 * (1 - p); op = clamp(p * 4, 0, 1); if (t2 < 0) op = 0; }
            else { var d = clamp((t2 - T) / (intro - T - 0.08), 0, 1), k = 0.32 * Math.pow(1 - d, 2) * Math.cos(d * Math.PI * 4); sy = 1 - k; sx = 1 + k * 0.8; }
          }
          if (h >= 0) { var u = (h - 0.1 - r * 0.35) / 0.65; if (u > 0 && u < 1) { var k2 = 0.14 * Math.sin(u * Math.PI * 3) * (1 - u); sy *= 1 - k2; sx *= 1 + k2 * 0.8; } }
          if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart - outLen * 0.3 * r) / (outLen * 0.6), 0, 1); sy *= 1 - easeInBack(q) * 0.98; sx *= 1 + q * 0.5; op = Math.min(op, q >= 1 ? 0 : 1); }
          s.style.opacity = op.toFixed(4);
          s.style.transform = (y || sx !== 1 || sy !== 1) ? 'translateY(' + y.toFixed(2) + 'px) scale(' + sx.toFixed(4) + ',' + Math.max(0, sy).toFixed(4) + ')' : 'none';
        });
        return { transform: 'none', opacity: t >= timing.fadeEnd ? 0 : 1 };
      },
    },

    // การ์ตูนบึ้ม (พรีเมียม): ข้อความกระแทกบนดาวระเบิดแบบหนังสือการ์ตูน · ค้าง: ดาวหมุนช้าๆ ต่อเนื่อง · สีขอบ = สีดาว
    comic: {
      intro: 0.7, outro: 0.5, loop: 1.8, fit: 1.45, premium: true,
      build: function (el, o) {
        var fill = el.querySelector('.fill');
        fill.style.position = 'relative'; fill.style.zIndex = '2';
        var id = o.filterId || 'outline', f = el.ownerDocument.getElementById(id);
        if (f && o.strokeRatio > 0) f.querySelector('.m-outline').setAttribute('flood-color', '#111111');
        var N = 14, pts = function (ro, ri, off) {
          var a = [];
          for (var j = 0; j < N * 2; j++) { var ang = ((j + (off || 0) * 2) / (N * 2)) * Math.PI * 2 - Math.PI / 2, r = j % 2 ? ri : ro - ((j / 2) % 2) * 6; a.push((50 + r * Math.cos(ang)).toFixed(2) + '% ' + (50 + r * Math.sin(ang)).toFixed(2) + '%'); }
          return 'polygon(' + a.join(',') + ')';
        };
        el.__pts = pts;
        var col = o.strokeRatio > 0 && luminance(o.stroke) > 0.15 && luminance(o.stroke) < 0.9 ? o.stroke : '#ff3b30';
        el.__burst = [addBox(el, 'tt-burst', 'left:-.3em;right:-.3em;top:-.55em;bottom:-.55em;z-index:0;background:#111111;clip-path:' + pts(50, 36) + ';'),
          addBox(el, 'tt-burst', 'left:-.3em;right:-.3em;top:-.55em;bottom:-.55em;z-index:1;background:' + col + ';clip-path:' + pts(46, 32) + ';')];
        el.style.position = 'relative';
      },
      frame: function (el, t, timing) {
        var fill = el.querySelector('.fill');
        var intro = timing.settle, outLen = timing.fadeEnd - timing.fadeStart;
        var bs = 1, br = 0, ts = 1, op = 1;
        if (t < intro) { var p = clamp(t / (intro * 0.75), 0, 1); bs = Math.max(0, easeOutBack(p)); br = (1 - easeOutCubic(p)) * -40; op = clamp(t / 0.06, 0, 1); var p2 = clamp((t - intro * 0.25) / (intro * 0.6), 0, 1); ts = p2 <= 0 ? 0 : lerp(2.2, 1, easeOutCubic(p2)); }
        var h = t >= intro && t < timing.fadeStart && !timing.still ? holdPhase(t, timing, 1.8) : 0;
        // ช่วงค้าง: เลื่อนแฉกไปตามขอบรูปรี (ไม่หมุนทั้งกล่อง) สองแฉกพอดีรอบ แฉกยาว/สั้นสลับ → วนเนียน
        var off = h > 0 ? (0.5 - 0.5 * Math.cos(Math.PI * h / (timing.loop || 1.8))) * 2 : 0;
        if (t >= timing.fadeStart) { var q = clamp((t - timing.fadeStart) / (outLen * 0.9), 0, 1); bs = 1 - easeInBack(q); ts = 1 - easeInBack(clamp(q * 1.2, 0, 1)); op = 1 - clamp((q - 0.6) / 0.4, 0, 1); }
        if (t >= timing.fadeEnd) op = 0;
        if (el.__burst && el.__pts) { el.__burst[0].style.clipPath = el.__pts(50, 36, off); el.__burst[1].style.clipPath = el.__pts(46, 32, off); }
        (el.__burst || []).forEach(function (b) { b.style.transform = 'rotate(' + br.toFixed(3) + 'deg) scale(' + Math.max(0, bs).toFixed(4) + ')'; });
        fill.style.transform = 'scale(' + Math.max(0, ts).toFixed(4) + ')';
        fill.style.opacity = ts <= 0 ? '0' : '1';
        return { transform: 'none', opacity: op };
      },
    },
  };

  var NAMES = Object.keys(MOTIONS);
  // premium = ท่าระดับพรีเมียม (ท่าที่ไม่ระบุ: มีชิ้นส่วนเพิ่ม = พรีเมียม) · timed = ใช้เวลาเข้า/ออกตามท่า (ท่าฟรีรุ่นแรก pop/drop ใช้เวลาเดิมคงที่)
  function meta(motion) {
    var name = MOTIONS[motion] ? motion : 'pop', m = MOTIONS[name];
    return { intro: m.intro, outro: m.outro, loop: m.loop, premium: m.premium !== undefined ? m.premium : !!m.build, timed: name !== 'pop' && name !== 'drop' };
  }

  // เวลาของคลิปยาว seconds วินาที (ใช้เหมือนกันทั้งตัวเรนเดอร์และตัวอย่างสด)
  function timingFor(motion, seconds, fps) {
    var m = MOTIONS[motion] || MOTIONS.pop;
    var tm = { popUp: 0.3, settle: m.intro, fadeStart: seconds - m.outro, fadeEnd: seconds - 1 / (fps || 60), loop: m.loop };
    if (m.loop) {
      // ช่วงค้างยาวกว่ารอบ: เศษที่ไม่ครบรอบไว้ต้นช่วงค้างเป็นภาพนิ่ง → รอบสุดท้ายจบพอดีตอนเริ่มท่าออก (ไม่ตัดกลางลูกเล่น)
      var f = fps || 60, holdN = Math.round(seconds * f) - Math.round(m.intro * f) - Math.round(m.outro * f), loopN = Math.round(m.loop * f);
      tm.holdOff = loopN < holdN ? (holdN % loopN) / f : 0;
    }
    return tm;
  }
  // ตำแหน่งในรอบค้าง (วินาที) ใช้ร่วมกันทุกท่า · ก่อนถึง holdOff = ภาพนิ่ง (ตำแหน่ง 0)
  function holdPhase(t, timing, loop) {
    var d = t - timing.settle - (timing.holdOff || 0);
    return d <= 0 ? 0 : d % (timing.loop || loop);
  }

  /*
   * เวลาของซับหนึ่งบรรทัด ยาว d วินาที (ช่วงเข้า/ออกสั้นลงให้ทันคำพูด ช่วงค้างนิ่ง)
   *   wordAt: เวลาเริ่มพูดแต่ละคำ (ท่าคำเด้งใช้ให้คำเด้งตรงจังหวะพูด)
   */
  function subtitleTiming(motion, d, fps, wordAt) {
    var m = MOTIONS[motion] || MOTIONS.pop;
    fps = fps || 30;
    var outro = Math.min(m.outro, 0.3, d * 0.25);
    var intro = Math.min(m.intro, Math.max(0.12, d * 0.4), d - outro - 1 / fps);
    var tm = { popUp: Math.min(0.3, intro * 0.6), settle: intro, fadeStart: d - outro, fadeEnd: d - 1 / fps, loop: m.loop, still: true };
    if (motion === 'kinetic' && wordAt && wordAt.length) tm.wordAt = wordAt;
    return tm;
  }
  /*
   * เฟรมช่วงค้างที่ j (0..holdN-1) ใช้ภาพวนรอบที่เท่าไร (0..loopN-1)
   *   เศษที่ไม่ครบรอบไว้ต้นช่วงค้างเป็นภาพนิ่ง (= ภาพตอนจบท่าเข้า) รอบสุดท้ายจึงจบพอดีตอนเริ่มท่าออก
   *   ไม่ว่าคลิปยาวเท่าไร ไม่มีการตัดเข้าท่าออกกลางลูกเล่น (เช่น แสงวิ่งค้างครึ่งทาง)
   */
  function holdIndex(j, holdN, loopN) {
    if (loopN <= 1) return 0;
    var off = holdN % loopN;
    return j < off ? 0 : (j - off) % loopN;
  }

  // ช่วงเวลาที่ภาพขยับ (ต้องวาดทุกเฟรม) นอกนั้นนิ่ง วาดเฟรมเดียวใช้ซ้ำได้
  function subtitleMoving(motion, t, tm) {
    if (t < tm.settle + 0.02 || t >= tm.fadeStart) return true;
    if (tm.wordAt) {
      var at = tm.wordAt, n = at.length;
      for (var i = 0; i < n; i++) {
        // เด้งเข้า (0.38 วิ) และไฮไลต์จางกลับสีเดิม (0.2 วิ) ตรงกับท่า kinetic ด้านบน
        var next = i + 1 < n ? at[i + 1] : at[i] + 0.63;
        var fade = Math.max(next, at[i] + 0.38);
        if ((t >= at[i] - 0.001 && t < at[i] + 0.4) || (t >= fade - 0.001 && t < fade + 0.22)) return true;
      }
    }
    return false;
  }

  /*
   * จัดข้อความให้พอดีพื้นที่ แล้วตั้งสี/ขอบ/เงา
   * opts: { text, fontFamily, weight, fill, stroke, strokeRatio, shadow, width, height, filterId, motion }
   */
  function setup(el, opts) {
    var fill = el.querySelector('.fill');
    var motion = MOTIONS[opts.motion] ? opts.motion : 'pop';
    var M = MOTIONS[motion];
    clearExtras(el);
    fill.textContent = opts.text;
    fill.removeAttribute('style'); // ล้างสไตล์ที่ท่าก่อนหน้าตั้งไว้ (สี ไล่สี ตัดขอบ ฯลฯ)
    fill.style.gridArea = '1 / 1';
    el.style.filter = '';
    el.style.transformOrigin = '';
    el.__units = el.__shineUnits = el.__lines = el.__shine = null;
    el.style.fontFamily = '"' + opts.fontFamily + '", sans-serif';
    el.style.fontWeight = String(opts.weight || 700);
    el.style.setProperty('--fill', opts.fill);
    var W = opts.width, H = opts.height;
    el.__H = H; // ท่า drop ใช้ความสูงของเวที
    var vertical = H > W;
    var maxW = opts.maxW || (vertical ? 0.86 : 0.70), maxH = opts.maxH || (vertical ? 0.22 : 0.40);
    el.style.transform = 'none';
    el.style.opacity = '1';
    var size = 400;
    el.style.fontSize = size + 'px';
    if (M.build) M.build(el, Object.assign({}, opts, { size: size })); // วัดขนาดด้วยชิ้นแบบเดียวกับตอนเล่นจริง
    var r = el.getBoundingClientRect();
    // เผื่อขนาดตอนขยายเกิน/แสงฟุ้ง
    var k = Math.min((W * maxW) / r.width, (H * maxH) / r.height) / M.fit;
    size = Math.max(4, Math.floor(size * k));
    if (opts.fixedSize) size = Math.min(size, Math.round(opts.fixedSize)); // โหมดซับ: ขนาดเท่ากันทุกบรรทัด (ย่อเฉพาะบรรทัดที่ยาวเกิน)
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
    // ท่าพรีเมียม: สร้างชิ้นส่วนใหม่ตามขนาดจริง (เส้น/แสงคำนวณจากขนาดฟอนต์)
    if (M.build) { clearExtras(el); M.build(el, Object.assign({}, opts, { size: size, strokeRatio: ratio })); }
    return { fontSize: size };
  }

  function setTime(el, t, timing, motion) {
    timing = timing || TIMING;
    var M = MOTIONS[motion] || MOTIONS.pop;
    var m = M.frame(el, t, timing);
    var o;
    if (m.opacity !== undefined) o = m.opacity; // ท่าพรีเมียมคุมการจางเอง
    else {
      o = m.fadeIn;
      if (t >= timing.fadeStart) o = Math.min(o, 1 - Math.min(1, (t - timing.fadeStart) / (timing.fadeEnd - timing.fadeStart)));
    }
    el.style.transform = m.transform;
    el.style.opacity = o.toFixed(5);
  }

  g.TTMotion = { MOTIONS: NAMES, TIMING: TIMING, meta: meta, timingFor: timingFor, subtitleTiming: subtitleTiming, subtitleMoving: subtitleMoving, holdIndex: holdIndex, filterMarkup: filterMarkup, setup: setup, setTime: setTime };
})(typeof window !== 'undefined' ? window : globalThis);

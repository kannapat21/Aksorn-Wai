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
          var h = (t - intro) % (timing.loop || 2.4);
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
        var h = t >= intro ? (t - intro) % (timing.loop || 2) : -1;
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
        var h = t >= intro && !timing.still ? (t - intro) % (timing.loop || 2) : -1;
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
  };

  var NAMES = Object.keys(MOTIONS);
  function meta(motion) { var m = MOTIONS[motion] || MOTIONS.pop; return { intro: m.intro, outro: m.outro, loop: m.loop, premium: !!m.build }; }

  // เวลาของคลิปยาว seconds วินาที (ใช้เหมือนกันทั้งตัวเรนเดอร์และตัวอย่างสด)
  function timingFor(motion, seconds, fps) {
    var m = MOTIONS[motion] || MOTIONS.pop;
    return { popUp: 0.3, settle: m.intro, fadeStart: seconds - m.outro, fadeEnd: seconds - 1 / (fps || 60), loop: m.loop };
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
    fill.style.color = '';
    fill.style.gridArea = '1 / 1';
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

  g.TTMotion = { MOTIONS: NAMES, TIMING: TIMING, meta: meta, timingFor: timingFor, subtitleTiming: subtitleTiming, subtitleMoving: subtitleMoving, filterMarkup: filterMarkup, setup: setup, setTime: setTime };
})(typeof window !== 'undefined' ? window : globalThis);

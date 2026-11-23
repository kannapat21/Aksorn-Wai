// หน้าปรับแต่ง: ตัวอย่างเคลื่อนไหวสด ใช้ท่าเดียวกับไฟล์จริง (public/motion.js)
(function () {
  'use strict';
  var form = document.querySelector('[data-cz-form]');
  var stage = document.querySelector('[data-stage]');
  var el = document.querySelector('[data-preview-text]');
  if (!form || !stage || !el || !window.TTMotion) return;
  var M = window.TTMotion;
  var OUTLINES = { none: 0, thin: 0.035, medium: 0.05, thick: 0.08 };
  var MAX = 40;
  document.querySelector('[data-filters]').innerHTML = M.filterMarkup('czf');

  var textInput = form.querySelector('[data-cz-text]');
  var counter = form.querySelector('[data-counter]');
  var fillInput = form.querySelector('[data-cz-fill]');
  var strokeInput = form.querySelector('[data-cz-stroke]');
  var shadowInput = form.querySelector('[data-cz-shadow]');
  var strokeRow = form.querySelector('[data-stroke-row]');
  var scrub = document.querySelector('[data-scrub]');
  var timeLabel = document.querySelector('[data-time]');
  var fontWarn = form.querySelector('[data-font-warn]');

  // ฟอนต์ของลูกค้า: เตือนถ้าไม่มีตัวอักษรที่พิมพ์ (ร้านตรวจซ้ำที่เซิร์ฟเวอร์ก่อนสร้างไฟล์)
  function checkCoverage() {
    var input = form.querySelector('[name="font"]:checked');
    var chars = input && input.getAttribute('data-chars');
    if (!chars) { fontWarn.hidden = true; return; }
    var seen = {}, missing = [];
    Array.from(textInput.value.replace(/\s/g, '')).forEach(function (ch) { if (chars.indexOf(ch) === -1 && !seen[ch]) { seen[ch] = 1; missing.push(ch); } });
    fontWarn.hidden = missing.length === 0;
    fontWarn.textContent = missing.length ? 'ฟอนต์ "' + input.getAttribute('data-label') + '" ไม่มีตัวอักษร: ' + missing.slice(0, 12).join(' ') + ' ตัวอย่างจะแสดงด้วยฟอนต์สำรอง และสร้างไฟล์ไม่ได้จนกว่าจะเปลี่ยนข้อความหรือฟอนต์' : '';
  }

  function graphemes(s) {
    if (window.Intl && Intl.Segmenter) return Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(s), function (x) { return x.segment; });
    return Array.from(s);
  }
  function val(name) { var i = form.querySelector('[name="' + name + '"]:checked'); return i ? i.value : ''; }
  function state() {
    var fontInput = form.querySelector('[name="font"]:checked');
    var text = textInput.value.replace(/\s+/g, ' ').trim() || ' ';
    return {
      text: text,
      fontFamily: 'tt-' + (fontInput ? fontInput.value : 'kanit'),
      weight: fontInput ? Number(fontInput.getAttribute('data-weight')) : 700,
      fill: fillInput.value, stroke: strokeInput.value,
      strokeRatio: OUTLINES[val('outline')] || 0, shadow: shadowInput.checked,
    };
  }

  var ready = 0;
  function apply() {
    var s = state();
    var n = graphemes(textInput.value.trim()).length;
    counter.textContent = n + '/' + MAX;
    counter.classList.toggle('over', n > MAX);
    strokeRow.classList.toggle('dim', s.strokeRatio === 0);
    checkCoverage();
    var token = ++ready;
    var load = document.fonts ? document.fonts.load(s.weight + ' 100px "' + s.fontFamily + '"', s.text) : Promise.resolve();
    load.catch(function () {}).then(function () {
      if (token !== ready) return; // มีการเปลี่ยนค่าใหม่กว่าแล้ว
      s.width = stage.clientWidth; s.height = stage.clientHeight; s.filterId = 'czf'; s.motion = motion;
      M.setup(el, s);
      draw(current);
    });
  }

  // ---------- เล่นวน / หยุด / ดูท่าค้าง / เลื่อนดูทีละเฟรม ----------
  // ความยาวคลิปที่เลือก: ท่าเข้า → ค้าง → ท่าออก (เวลาของแต่ละท่าเหมือนไฟล์จริงทุกอย่าง)
  var seconds = Number(val('seconds')) || 5;
  var motion = stage.getAttribute('data-motion') || 'pop';
  function timing() { return M.timingFor ? M.timingFor(motion, seconds, 60) : { popUp: 0.3, settle: 0.5, fadeStart: seconds - 0.5, fadeEnd: seconds - 1 / 60 }; }
  var playing = true, current = 0, t0 = performance.now(), LOOP = seconds + 0.4;
  function draw(t) {
    current = t;
    M.setTime(el, Math.min(t, seconds), timing(), motion);
    scrub.value = Math.round(Math.min(t, seconds) * 100);
    timeLabel.textContent = Math.min(t, seconds).toFixed(1) + 's';
  }
  form.addEventListener('change', function (e) {
    if (e.target.name === 'seconds') {
      seconds = Number(e.target.value) || 5;
      LOOP = seconds + 0.4;
      scrub.max = String(seconds * 100);
      t0 = performance.now(); current = 0;
    }
    if (e.target.name === 'size') {
      stage.setAttribute('data-ratio', e.target.value === 'horizontal' ? 'h' : 'v');
    }
    if (e.target.name === 'editor') {
      // ชื่อชนิดไฟล์ตามโปรแกรม (ไฟล์แนะนำ / ทางเลือก)
      form.querySelector('[data-type-label="main"]').textContent = e.target.getAttribute('data-main');
      form.querySelector('[data-type-label="alt"]').textContent = e.target.getAttribute('data-alt');
    }
  });
  function frame(now) {
    if (playing) draw(((now - t0) / 1000) % LOOP);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  var playBtn = document.querySelector('[data-play]');
  function setPlaying(p) {
    playing = p;
    playBtn.textContent = p ? '❚❚' : '▶';
    if (p) t0 = performance.now() - current * 1000;
  }
  playBtn.addEventListener('click', function () { setPlaying(!playing); });
  // ท่าค้าง: ท่าพรีเมียมเลือกจังหวะที่นิ่ง (ไม่มีแสงวิ่ง/คำเด้ง)
  function holdTime() { var m = M.meta ? M.meta(motion) : { loop: 0 }; return m.loop ? timing().settle + 0.95 : 1.5; }
  document.querySelector('[data-hold]').addEventListener('click', function () { setPlaying(false); draw(holdTime()); });
  scrub.addEventListener('input', function () { setPlaying(false); draw(scrub.value / 100); });
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { setPlaying(false); draw(holdTime()); }

  // ---------- ขนาด / พื้นหลัง ----------
  document.querySelectorAll('[data-ratio-btn]').forEach(function (b) {
    b.addEventListener('click', function () {
      stage.setAttribute('data-ratio', b.getAttribute('data-ratio-btn'));
      document.querySelectorAll('[data-ratio-btn]').forEach(function (x) { x.classList.toggle('active', x === b); });
      apply();
    });
  });
  document.querySelectorAll('[data-bg-btn]').forEach(function (b) {
    b.addEventListener('click', function () {
      stage.setAttribute('data-bg', b.getAttribute('data-bg-btn'));
      document.querySelectorAll('[data-bg-btn]').forEach(function (x) { x.classList.toggle('active', x === b); });
    });
  });

  // ---------- สีสำเร็จรูป ----------
  form.addEventListener('click', function (e) {
    var sw = e.target.closest('[data-swatch]');
    if (!sw) return;
    var input = sw.getAttribute('data-swatch') === 'fill' ? fillInput : strokeInput;
    input.value = sw.getAttribute('data-color');
    sw.parentNode.querySelectorAll('.swatch').forEach(function (x) { x.classList.toggle('active', x === sw); });
    apply();
  });
  [fillInput, strokeInput].forEach(function (i) {
    i.addEventListener('input', function () {
      i.closest('.swatches').querySelectorAll('.swatch').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-color') === i.value); });
    });
  });

  form.addEventListener('input', apply);
  form.addEventListener('change', apply);
  if (window.ResizeObserver) new ResizeObserver(function () { apply(); }).observe(stage);
  apply();

  // ---------- สไตล์ของฉัน: กดทีเดียวใช้ได้ / บันทึกแค่ตั้งชื่อ ----------
  var bar = document.querySelector('[data-styles]');
  if (bar) {
    var chips = bar.querySelector('[data-style-chips]');
    var saveBtn = bar.querySelector('[data-style-save]');
    var nameForm = bar.querySelector('[data-style-form]');
    var nameIn = bar.querySelector('[data-style-name]');
    var smsg = bar.querySelector('[data-style-msg]');
    var csrf = bar.getAttribute('data-csrf');
    var applying = false;
    var note = function (t, cls) { smsg.textContent = t; smsg.className = 'style-hint small ' + (cls || 'muted'); };
    var setActive = function (chip) { chips.querySelectorAll('[data-style-chip]').forEach(function (x) { x.classList.toggle('active', x === chip); }); };
    var markSwatch = function (input) {
      input.closest('.swatches').querySelectorAll('.swatch').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-color') === input.value); });
    };
    var applyStyle = function (st, chip) {
      applying = true;
      var font = form.querySelector('[name="font"][value="' + st.font + '"]');
      if (font) font.checked = true;
      fillInput.value = st.fill; strokeInput.value = st.stroke;
      markSwatch(fillInput); markSwatch(strokeInput);
      var ol = form.querySelector('[name="outline"][value="' + st.outline + '"]');
      if (ol) ol.checked = true;
      shadowInput.checked = Boolean(st.shadow);
      apply();
      setActive(chip);
      applying = false;
      note(font ? 'ใช้สไตล์ "' + chip.querySelector('.style-name').textContent + '" แล้ว' : 'ใช้สีแล้ว แต่ฟอนต์ของสไตล์นี้ถูกลบไปแล้ว', font ? 'ok' : 'error');
    };
    // แก้ค่าเองหลังเลือกสไตล์ → ไม่ถือว่าใช้สไตล์นั้นแล้ว
    form.addEventListener('input', function () { if (!applying) setActive(null); });
    form.addEventListener('change', function () { if (!applying) setActive(null); });

    var currentLook = function () {
      var f = form.querySelector('[name="font"]:checked');
      return { font: f ? f.value : '', fill: fillInput.value, stroke: strokeInput.value, outline: val('outline'), shadow: shadowInput.checked };
    };
    var makeChip = function (id, name, st) {
      var wrap = document.createElement('span');
      wrap.className = 'style-chip just-added';
      wrap.setAttribute('data-style-chip', '');
      wrap.setAttribute('data-style', JSON.stringify(st));
      wrap.setAttribute('data-style-id', id);
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'style-apply'; b.setAttribute('data-style-apply', '');
      var sample = document.createElement('span');
      sample.className = 'style-sample'; sample.textContent = 'ก';
      var fi = form.querySelector('[name="font"][value="' + st.font + '"]');
      sample.style.fontFamily = "'tt-" + st.font + "', sans-serif";
      sample.style.fontWeight = fi ? fi.getAttribute('data-weight') : '700';
      sample.style.color = st.fill;
      if (st.outline !== 'none') { sample.style.webkitTextStroke = '3px ' + st.stroke; sample.style.paintOrder = 'stroke fill'; }
      if (st.shadow) sample.style.textShadow = '0 2px 3px rgba(0,0,0,.5)';
      var nm = document.createElement('span');
      nm.className = 'style-name'; nm.textContent = name;
      b.appendChild(sample); b.appendChild(nm);
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'style-x'; x.setAttribute('data-style-del', ''); x.setAttribute('aria-label', 'ลบสไตล์ ' + name); x.textContent = '×';
      wrap.appendChild(b); wrap.appendChild(x);
      return wrap;
    };

    chips.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-style-chip]');
      if (!chip) return;
      if (e.target.closest('[data-style-del]')) {
        var name = chip.querySelector('.style-name').textContent;
        if (!confirm('ลบสไตล์ "' + name + '"?')) return;
        fetch('/library/styles/' + chip.getAttribute('data-style-id') + '/delete', { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': csrf, accept: 'application/json' } })
          .then(function (r) { if (r.ok) { chip.remove(); note('ลบสไตล์ "' + name + '" แล้ว'); } else note('ลบไม่สำเร็จ', 'error'); });
        return;
      }
      try { applyStyle(JSON.parse(chip.getAttribute('data-style')), chip); } catch (err) { /* ข้าม */ }
    });

    saveBtn.addEventListener('click', function () {
      nameForm.hidden = false;
      saveBtn.hidden = true;
      nameIn.value = '';
      nameIn.focus();
    });
    bar.querySelector('[data-style-cancel]').addEventListener('click', function () { nameForm.hidden = true; saveBtn.hidden = false; });
    // ช่องตั้งชื่ออยู่ในฟอร์มหลัก: กด Enter = บันทึกสไตล์ (ไม่ใช่สั่งสร้างไฟล์)
    nameIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveStyle(); } });
    bar.querySelector('[data-style-submit]').addEventListener('click', saveStyle);
    function saveStyle() {
      var st = currentLook();
      var body = JSON.stringify({ name: nameIn.value, font: st.font, fill: st.fill, stroke: st.stroke, outline: st.outline, shadow: st.shadow });
      fetch('/library/styles', { method: 'POST', credentials: 'same-origin', body: body, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf } })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) return note(res.j.error || 'บันทึกไม่สำเร็จ', 'error');
          var chip = makeChip(res.j.id, res.j.name, res.j.style);
          chips.insertBefore(chip, saveBtn);
          setActive(chip);
          nameForm.hidden = true; saveBtn.hidden = false;
          note('บันทึกสไตล์ "' + res.j.name + '" แล้ว · ครั้งหน้ากดชื่อนี้ทีเดียวก็ได้หน้าตาเดิม', 'ok');
        }).catch(function () { note('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง', 'error'); });
    }
  }

  // ---------- ใช้ฟอนต์ของฉันเอง: อัปโหลดแล้วเลือกให้ และเห็นในตัวอย่างทันที ----------
  var inline = document.querySelector('[data-inline-upload]');
  if (inline) {
    var fileIn = inline.querySelector('[data-inline-font]');
    var rights = inline.querySelector('[data-inline-rights]');
    var msg = inline.querySelector('[data-inline-msg]');
    var grid = document.querySelector('[data-my-fonts]');
    var say = function (text, cls) { msg.textContent = text; msg.className = 'small ' + (cls || 'muted'); };
    fileIn.addEventListener('change', function () {
      var f = fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      if (!rights.checked) return say('กรุณาติ๊กยืนยันว่ามีสิทธิ์ใช้ฟอนต์นี้เชิงพาณิชย์ก่อน', 'error');
      if (!/\.(ttf|otf|woff2?)$/i.test(f.name)) return say('รองรับเฉพาะ .ttf .otf .woff .woff2', 'error');
      if (f.size > 5 * 1024 * 1024) return say('ไฟล์ใหญ่เกิน 5 MB', 'error');
      say('กำลังตรวจและอัปโหลด ' + f.name + ' …');
      f.arrayBuffer().then(function (buf) {
        return fetch('/library/fonts', {
          method: 'POST', body: buf, credentials: 'same-origin',
          headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': inline.getAttribute('data-csrf'), 'x-font-rights': 'yes' },
        });
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (res) {
        if (!res.ok) return say(res.j.error || 'อัปโหลดไม่สำเร็จ', 'error');
        var j = res.j;
        var face = new FontFace('tt-' + j.fontId, 'url(' + j.url + ')');
        document.fonts.add(face);
        return face.load().catch(function () {}).then(function () {
          var label = document.createElement('label');
          label.className = 'font-opt mine' + (j.thai !== 'full' ? ' warn' : '') + ' just-added';
          var input = document.createElement('input');
          input.type = 'radio'; input.name = 'font'; input.value = j.fontId; input.required = true;
          input.setAttribute('data-weight', '400'); input.setAttribute('data-chars', j.chars); input.setAttribute('data-label', j.name);
          var sample = document.createElement('span');
          sample.className = 'font-sample'; sample.style.fontFamily = "'tt-" + j.fontId + "'"; sample.textContent = j.thai === 'none' ? 'Hello Aa' : 'สวัสดี Aa';
          var small = document.createElement('small');
          small.textContent = j.name + ' · ' + (j.thai === 'full' ? 'ฟอนต์ของคุณ' : j.thai === 'partial' ? 'ของคุณ · ไทยไม่ครบ' : 'ของคุณ · ไม่มีอักษรไทย');
          label.appendChild(input); label.appendChild(sample); label.appendChild(small);
          grid.insertBefore(label, grid.firstChild);
          input.checked = true;
          apply();
          label.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          if (j.thai === 'none') say('ใช้ "' + j.name + '" แล้ว · ฟอนต์นี้ไม่มีอักษรไทย ใช้ได้กับข้อความภาษาอังกฤษเท่านั้น', 'error');
          else if (j.thai === 'partial') say('ใช้ "' + j.name + '" แล้ว · ฟอนต์นี้มีอักษรไทยไม่ครบ บางตัวอาจใช้ไม่ได้', 'error');
          else say('ใช้ "' + j.name + '" แล้ว ดูตัวอย่างด้านซ้ายได้เลย', 'ok');
        });
      }).catch(function () { say('อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง', 'error'); });
    });
  }

  // กันส่งข้อความยาวเกิน (เซิร์ฟเวอร์ตรวจซ้ำอยู่แล้ว)
  form.addEventListener('submit', function (e) {
    if (graphemes(textInput.value.trim()).length > MAX) { e.preventDefault(); textInput.focus(); counter.classList.add('shake'); setTimeout(function () { counter.classList.remove('shake'); }, 500); }
  });
})();

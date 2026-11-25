// หน้าปรับแต่งบนมือถือ: ทำทีละขั้น (ข้อความ → ฟอนต์ → สี → แนว/ความยาว → สร้าง)
// ตัวอย่างสดติดอยู่ด้านบน ปุ่มหลักติดอยู่ด้านล่าง เลื่อนปัดซ้าย/ขวาเพื่อเปลี่ยนขั้นได้
// หน้าจอกว้าง (คอม) ไม่ทำงาน ทุกอย่างแสดงในหน้าเดียวเหมือนเดิม
(function () {
  'use strict';
  var form = document.querySelector('[data-cz-form]');
  if (!form || !window.matchMedia) return;
  var steps = Array.prototype.slice.call(form.querySelectorAll('.cz-step'));
  var head = form.querySelector('[data-wiz-head]');
  var bar = document.querySelector('[data-wiz-bar]');
  if (!steps.length || !head || !bar) return;

  var mq = window.matchMedia('(max-width: 720px)');
  var back = bar.querySelector('[data-wiz-back]');
  var next = bar.querySelector('[data-wiz-next]');
  var nEl = head.querySelector('[data-wiz-n]');
  var tEl = head.querySelector('[data-wiz-title]');
  var dots = head.querySelector('[data-wiz-dots]');
  var textInput = form.querySelector('[data-cz-text]');
  var renderBtn = form.querySelector('[data-render-btn]');
  var counter = form.querySelector('[data-counter]');
  var stage = document.querySelector('[data-stage]');
  var cur = 0, active = false, lastDir = 1;

  steps.forEach(function (s, i) {
    var d = document.createElement('button');
    d.type = 'button'; d.className = 'wiz-dot'; d.setAttribute('role', 'tab');
    d.setAttribute('aria-label', 'ขั้นที่ ' + (i + 1) + ' ' + s.getAttribute('data-title'));
    d.addEventListener('click', function () { go(i); });
    dots.appendChild(d);
  });

  function graphemes(s) {
    if (window.Intl && Intl.Segmenter) return Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(s), function (x) { return x.segment; });
    return Array.from(s);
  }

  // ตรวจก่อนไปขั้นถัดไป (ขั้นแรก: ต้องมีข้อความและไม่เกิน 40 ตัวอักษร)
  function canLeave(i) {
    if (i !== 0) return true;
    var n = graphemes(textInput.value.trim()).length;
    if (n === 0 || n > 40) {
      textInput.focus();
      if (counter) { counter.classList.add('shake'); setTimeout(function () { counter.classList.remove('shake'); }, 500); }
      textInput.setCustomValidity(n === 0 ? 'พิมพ์ข้อความก่อน' : 'ข้อความยาวเกิน 40 ตัวอักษร');
      textInput.reportValidity();
      textInput.setCustomValidity('');
      return false;
    }
    return true;
  }

  function show() {
    steps.forEach(function (s, i) {
      var on = i === cur;
      s.classList.toggle('wiz-on', on);
      if (on) { s.classList.remove('wiz-left', 'wiz-right'); void s.offsetWidth; s.classList.add(lastDir > 0 ? 'wiz-right' : 'wiz-left'); }
    });
    nEl.textContent = (cur + 1) + '/' + steps.length;
    tEl.textContent = steps[cur].getAttribute('data-title');
    Array.prototype.forEach.call(dots.children, function (d, i) {
      d.classList.toggle('on', i === cur); d.classList.toggle('done', i < cur);
      d.setAttribute('aria-selected', i === cur ? 'true' : 'false');
    });
    back.hidden = cur === 0;
    var last = cur === steps.length - 1;
    next.textContent = last ? 'สร้างไฟล์ของฉัน' : 'ถัดไป ›';
    next.classList.toggle('go', last);
    next.disabled = last && renderBtn && renderBtn.disabled;
    updateSamples();
    if (cur === steps.length - 1) summary();
  }

  // สรุปสิ่งที่เลือกก่อนกดสร้าง
  function summary() {
    var ul = form.querySelector('[data-wiz-summary]');
    if (!ul) return;
    var lab = function (name) { var i = form.querySelector('[name="' + name + '"]:checked'); return i ? (i.parentNode.querySelector('b') || i.parentNode.querySelector('span:last-child') || i.parentNode).textContent.trim() : ''; };
    var font = form.querySelector('[name="font"]:checked');
    var rows = [
      ['ข้อความ', textInput.value.trim()],
      ['ฟอนต์', font ? font.parentNode.querySelector('small').textContent.split(' · ')[0] : ''],
      ['แนว', lab('size')],
      ['ความยาว', lab('seconds')],
    ];
    ul.textContent = '';
    rows.forEach(function (r) {
      var li = document.createElement('li');
      var k = document.createElement('span'); k.textContent = r[0];
      var v = document.createElement('b'); v.textContent = r[1];
      li.appendChild(k); li.appendChild(v); ul.appendChild(li);
    });
    ul.hidden = !active;
  }

  function go(i) {
    if (i === cur) return;
    if (i > cur && !canLeave(cur)) return;
    lastDir = i > cur ? 1 : -1;
    cur = Math.max(0, Math.min(steps.length - 1, i));
    if (document.activeElement && document.activeElement.blur && document.activeElement.tagName !== 'BODY') document.activeElement.blur();
    show();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // มือถือ: ตอนคีย์บอร์ดเปิดอยู่ แตะครั้งแรกเบราว์เซอร์จะปิดคีย์บอร์ดก่อน แถบล่างเลื่อนลง (และปุ่มย้อนกลับโผล่)
  // click เลยไปตกที่อื่น ต้องแตะซ้ำ → ทำงานตอนยกนิ้ว (ก่อนคีย์บอร์ดยุบ) และกันไม่ให้ปุ่มแย่งโฟกัสจากช่องพิมพ์
  function tap(btn, fn) {
    var down = false, doneAt = 0;
    btn.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      down = true;
      e.preventDefault(); // ไม่ให้ช่องพิมพ์เสียโฟกัส (คีย์บอร์ดยังไม่ยุบ แถบไม่ขยับ)
    });
    btn.addEventListener('pointercancel', function () { down = false; });
    btn.addEventListener('pointerleave', function () { down = false; });
    btn.addEventListener('pointerup', function (e) {
      if (!down || e.pointerType === 'mouse') return;
      down = false;
      if (btn.disabled) return;
      doneAt = Date.now();
      fn();
    });
    btn.addEventListener('click', function () {
      if (Date.now() - doneAt < 700) return; // ทำไปแล้วตอนยกนิ้ว
      fn();
    });
  }
  tap(back, function () { go(cur - 1); });
  tap(next, function () {
    if (cur < steps.length - 1) return go(cur + 1);
    if (!canLeave(0)) { go(0); return; }
    if (renderBtn && !renderBtn.disabled) {
      next.disabled = true; next.textContent = 'กำลังส่ง…';
      if (form.requestSubmit) form.requestSubmit(renderBtn); else renderBtn.click();
    }
  });

  // Enter ในช่องข้อความ = ขั้นถัดไป (ไม่ใช่ส่งฟอร์ม) · คีย์บอร์ดมือถือขึ้นปุ่ม "ถัดไป"
  textInput.addEventListener('keydown', function (e) {
    if (active && e.key === 'Enter') { e.preventDefault(); go(1); }
  });

  // ปัดซ้าย/ขวาเพื่อเปลี่ยนขั้น (ไม่ทำงานบนแถบสไตล์ แถบเลื่อน หรือช่องกรอก)
  var sx = 0, sy = 0, sOk = false;
  form.addEventListener('touchstart', function (e) {
    var t = e.touches[0];
    sx = t.clientX; sy = t.clientY;
    sOk = active && e.touches.length === 1 && !e.target.closest('.style-chips, input, select, textarea, [data-my-fonts] label.btn');
  }, { passive: true });
  form.addEventListener('touchend', function (e) {
    if (!sOk) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45 && Math.abs(dx) > Math.abs(dy) * 2) go(cur + (dx < 0 ? 1 : -1));
  }, { passive: true });

  // ตัวอย่างฟอนต์ในการ์ดใช้ข้อความของลูกค้าเอง
  function updateSamples() {
    var txt = textInput.value.replace(/\s+/g, ' ').trim();
    form.querySelectorAll('.font-opt').forEach(function (o) {
      var sample = o.querySelector('.font-sample');
      if (!sample) return;
      var none = o.getAttribute('data-thai') === 'none' || /^Hello/.test(sample.getAttribute('data-orig') || sample.textContent);
      if (!sample.hasAttribute('data-orig')) sample.setAttribute('data-orig', sample.textContent);
      sample.textContent = txt && !none ? txt : sample.getAttribute('data-orig');
    });
  }
  form.addEventListener('input', updateSamples);
  // ฟอนต์ที่เพิ่งอัปโหลดถูกเพิ่มเข้ามาทีหลัง
  var myGrid = form.querySelector('[data-my-fonts]');
  if (myGrid && window.MutationObserver) new MutationObserver(updateSamples).observe(myGrid, { childList: true });

  // คีย์บอร์ดขึ้น: ย่อตัวอย่างและยกแถบล่างให้พ้นคีย์บอร์ด
  var vv = window.visualViewport;
  function viewport() {
    if (!active) return;
    var kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    var open = kb > 120;
    document.documentElement.style.setProperty('--kb', (open ? kb : 0) + 'px');
    document.body.classList.toggle('kb-open', open);
  }
  if (vv) { vv.addEventListener('resize', viewport); vv.addEventListener('scroll', viewport); }

  // แตะที่ตัวอย่างเพื่อหยุด/เล่น
  var playBtn = document.querySelector('[data-play]');
  if (stage && playBtn) stage.addEventListener('click', function () { if (active) playBtn.click(); });

  function setup() {
    var on = mq.matches;
    if (on === active) return;
    active = on;
    form.classList.toggle('wiz', on);
    document.body.classList.toggle('wiz-on', on);
    head.hidden = !on; bar.hidden = !on;
    if (!on) {
      steps.forEach(function (s) { s.classList.remove('wiz-on', 'wiz-left', 'wiz-right'); });
      document.documentElement.style.removeProperty('--kb');
      document.body.classList.remove('kb-open');
      var sm = form.querySelector('[data-wiz-summary]'); if (sm) sm.hidden = true;
    } else { show(); }
  }
  if (mq.addEventListener) mq.addEventListener('change', setup); else if (mq.addListener) mq.addListener(setup);
  // ถ้าเซิร์ฟเวอร์ตอบกลับมาพร้อมข้อผิดพลาด ให้เริ่มที่ขั้นสุดท้าย (ลูกค้าเพิ่งกดสร้าง)
  if (document.querySelector('.error[role="alert"]')) cur = steps.length - 1;
  setup();
  updateSamples();
})();

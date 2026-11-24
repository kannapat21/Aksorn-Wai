// ใส่ซับอัตโนมัติ: อัปโหลดคลิป (แถบความคืบหน้า) · รอถอดเสียง · แก้ซับพร้อมตัวอย่างสดบนคลิปจริง (ท่าเดียวกับไฟล์จริง)
(function () {
  'use strict';
  var root = document.documentElement;
  var calm = root.classList.contains('calm') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  var fmtMB = function (n) { return (n / 1048576).toFixed(n > 104857600 ? 0 : 1) + ' MB'; };
  var fmtT = function (s, dec) {
    s = Math.max(0, s || 0);
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + (dec ? r.toFixed(1) : Math.floor(r));
  };

  // ---------- หน้าแรก: เลือกแบบ + อัปคลิป ----------
  var form = $('[data-sub-new]');
  if (form) (function () {
    var fileIn = $('[data-file]', form), drop = $('[data-drop]', form), startBtn = $('[data-start]', form);
    var nameEl = $('[data-file-name]', form), infoEl = $('[data-file-info]', form), errEl = $('[data-up-err]', form);
    var up = $('[data-up]', form), bar = $('[data-up-bar]', form), pct = $('[data-up-pct]', form), upText = $('[data-up-text]', form);
    var maxMb = Number(form.getAttribute('data-max-mb')), maxSec = Number(form.getAttribute('data-max-sec'));
    var off = form.hasAttribute('data-off');
    var picked = null, sending = false;
    var showErr = function (t) { errEl.textContent = t || ''; errEl.hidden = !t; };
    var refresh = function () { startBtn.disabled = off || sending || !picked; drop.classList.toggle('has-file', Boolean(picked)); };
    var pick = function (f) {
      showErr('');
      picked = null;
      if (!f) return refresh();
      if (!/\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name) && !/^video\//.test(f.type)) { showErr('รองรับเฉพาะไฟล์วิดีโอ เช่น MP4 หรือ MOV'); return refresh(); }
      if (f.size > maxMb * 1048576) { showErr('ไฟล์ใหญ่ ' + fmtMB(f.size) + ' เกิน ' + maxMb + ' MB ลองส่งออกคลิปเป็น 1080p แล้วเลือกใหม่'); return refresh(); }
      nameEl.textContent = f.name;
      infoEl.textContent = fmtMB(f.size) + ' · กำลังอ่านความยาว…';
      picked = f; refresh();
      // อ่านความยาวในเครื่อง (ไม่ต้องรออัปเสร็จถึงรู้ว่ายาวเกิน) · บางไฟล์เบราว์เซอร์อ่านไม่ได้ ให้ร้านตรวจแทน
      var v = document.createElement('video');
      var url = URL.createObjectURL(f);
      var done = function () { URL.revokeObjectURL(url); v.removeAttribute('src'); };
      v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = function () {
        var d = v.duration; done();
        if (picked !== f) return;
        if (isFinite(d) && d > maxSec + 0.5) {
          picked = null; refresh();
          showErr('คลิปยาว ' + fmtT(d) + ' นาที เกินที่รับได้ (' + fmtT(maxSec) + ' นาที) ตัดให้สั้นลงแล้วเลือกใหม่');
          infoEl.textContent = fmtMB(f.size);
          return;
        }
        infoEl.textContent = fmtMB(f.size) + (isFinite(d) ? ' · ยาว ' + fmtT(d) + ' นาที' : '');
      };
      v.onerror = function () { done(); if (picked === f) infoEl.textContent = fmtMB(f.size); };
      v.src = url;
    };
    fileIn.addEventListener('change', function () { pick(fileIn.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); if (!off) drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (!off && e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); });
    startBtn.addEventListener('click', function () {
      var style = $('input[name="order"]:checked', form);
      if (!picked || sending) return;
      if (!style) { showErr('กรุณาเลือกแบบตัวอักษรก่อน'); return; }
      sending = true; refresh(); showErr('');
      startBtn.classList.add('loading');
      up.hidden = false;
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/subtitles/upload');
      xhr.setRequestHeader('content-type', 'application/octet-stream');
      xhr.setRequestHeader('x-csrf-token', form.getAttribute('data-csrf'));
      xhr.setRequestHeader('x-style', style.value);
      xhr.setRequestHeader('x-filename', encodeURIComponent(picked.name));
      xhr.upload.onprogress = function (e) {
        if (!e.lengthComputable) return;
        var p = Math.round((e.loaded / e.total) * 100);
        bar.style.width = p + '%'; pct.textContent = p + '%';
        upText.textContent = p < 100 ? 'กำลังอัปโหลด ' + fmtMB(e.loaded) + ' / ' + fmtMB(e.total) : 'ร้านกำลังตรวจคลิป…';
      };
      var fail = function (t) { sending = false; startBtn.classList.remove('loading'); up.hidden = true; bar.style.width = '0%'; showErr(t); refresh(); };
      xhr.onload = function () {
        var j = {};
        try { j = JSON.parse(xhr.responseText); } catch (e) { j = {}; }
        if (xhr.status === 200 && j.url) { upText.textContent = 'เรียบร้อย กำลังเริ่มฟังเสียง…'; location.href = j.url; return; }
        fail(j.error || 'อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง');
      };
      xhr.onerror = function () { fail('การเชื่อมต่อขาดระหว่างอัปโหลด ลองใหม่อีกครั้ง (แนะนำใช้ Wi-Fi)'); };
      xhr.send(picked);
    });
    refresh();
  })();

  // ---------- รอผล (ถอดเสียง / สร้างคลิป) ----------
  var poll = $('[data-sub-poll]');
  if (poll) (function () {
    var url = poll.getAttribute('data-sub-poll'), first = poll.getAttribute('data-status');
    var pbar = $('[data-job-bar]', poll), ppct = $('[data-job-pct]', poll), pstage = $('[data-job-stage]', poll), ptime = $('[data-job-time]', poll);
    var mmss = function (ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };
    var phase = function (s) { return s === 'queued' || s === 'transcribing' ? 'asr' : s === 'queued_render' || s === 'rendering' ? 'render' : 'idle'; };
    var tick = function () {
      fetch(url, { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.status || phase(j.status) !== phase(first)) { try { sessionStorage.setItem('noIntroOnce', '1'); } catch (e) { /* ข้าม */ } location.reload(); return; }
        pbar.style.width = j.progress + '%';
        ppct.textContent = j.progress + '%';
        pstage.textContent = j.position ? 'รอคิว (ลำดับที่ ' + j.position + ')' : (j.stage || 'กำลังทำ');
        if (ptime) ptime.textContent = j.elapsed ? '· ผ่านไป ' + mmss(j.elapsed) : '';
        setTimeout(tick, 1500);
      }).catch(function () { setTimeout(tick, 4000); });
    };
    setTimeout(tick, 1200);
  })();

  // ---------- หน้าแก้ซับ ----------
  var editor = $('[data-sub-editor]');
  var dataEl = document.getElementById('sub-data');
  if (!editor || !dataEl || !window.TTMotion) return;
  var M = window.TTMotion;
  var D = JSON.parse(dataEl.textContent);
  var OUTLINES = { none: 0, thin: 0.035, medium: 0.05, thick: 0.08 };
  var NOTE = {
    kinetic: 'คำเด้งขึ้นตรงจังหวะพูดทีละคำ มีไฮไลต์คำที่กำลังพูด',
    cinema: 'ตัวอักษรโผล่จากความเบลอทีละตัว มีเส้นบางบนล่าง',
    neon: 'ไฟนีออน: สีตัวอักษร = สีไฟ, สีขอบ = สีแสงฟุ้ง, ความหนาขอบ = ความแรงของแสง',
    pop: 'แต่ละบรรทัดเด้งขยายเข้า แล้วจางออก',
    drop: 'แต่ละบรรทัดร่วงลงมาเด้งกระดอน',
  };
  var cues = D.cues.map(function (c) { return { id: c.id, start: c.start, end: c.end, text: c.text, w: c.w || null }; });
  var style = D.style;
  var video = $('[data-video]'), player = $('[data-player]'), band = $('[data-band]'), el = $('[data-sub-text]');
  var scrub = $('[data-scrub]'), clock = $('[data-clock]'), playBtn = $('[data-play]');
  var list = $('[data-list]'), countEl = $('[data-count]'), saveState = $('[data-save-state]'), errEl = $('[data-err]');
  var look = $('[data-look]'), lookSum = $('[data-look-sum]'), motionNote = $('[data-motion-note]');
  var renderBtn = $('[data-render]'), addBtn = $('[data-add]');
  var disabled = D.disabled;
  $('[data-filters]').innerHTML = M.filterMarkup('subf');

  var motionOf = function () { var o = D.owned.filter(function (x) { return x.id === style.order; })[0]; return o ? o.motion : 'pop'; };
  var fontOf = function () { return D.fonts.filter(function (f) { return f.id === style.font; })[0] || D.fonts[0]; };
  var graphemes = function (s) { return window.Intl && Intl.Segmenter ? Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(s), function (x) { return x.segment; }) : Array.from(s); };
  // คำในบรรทัดที่เพิ่งแก้ (ร้านคำนวณใหม่ตอนบันทึก) แบ่งเวลาตามจำนวนตัวอักษร เหมือนฝั่งร้าน
  function spread(text, dur) {
    var parts = window.Intl && Intl.Segmenter ? Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(text), function (x) { return x.segment; }) : [text];
    var total = 0;
    parts.forEach(function (p) { if (!/^\s+$/.test(p)) total += graphemes(p).length; });
    var span = Math.max(0, dur * 0.8 - 0.2), acc = 0;
    return parts.map(function (p) {
      if (/^\s+$/.test(p)) return [' ', null];
      var at = Math.round((acc / (total || 1)) * span * 100) / 100;
      acc += graphemes(p).length;
      return [p, at];
    });
  }

  // ---------- ตัวอย่างสด ----------
  var cur = -1, dirty = true, scale = 1, lay = null;
  function measure() {
    // ขนาดเครื่องเล่นพอดีสัดส่วนคลิป (แถบซับต้องวางตรงตำแหน่งเดียวกับไฟล์จริง)
    var maxH = innerHeight * (innerWidth <= 900 ? 0.38 : 0.7);
    var pw = Math.min(player.parentElement.clientWidth, maxH * D.width / D.height);
    player.style.width = Math.round(pw) + 'px';
    player.style.height = Math.round(pw * D.height / D.width) + 'px';
    scale = player.clientWidth / D.width;
    lay = D.sizes[(style.size || 'md') + ':' + (style.position || 'bottom')];
    band.style.top = (lay.y * scale) + 'px';
    band.style.height = (lay.band * scale) + 'px';
    dirty = true;
  }
  function findCue(t) {
    for (var i = 0; i < cues.length; i++) if (t >= cues[i].start && t < cues[i].end) return i;
    return -1;
  }
  function timingOf(c) {
    var d = c.end - c.start;
    var w = c.w || spread(c.text, d);
    var at = w.filter(function (x) { return x[1] !== null; }).map(function (x) { return Math.min(x[1], Math.max(0, d - 0.3)); });
    return { tm: M.subtitleTiming(motionOf(), d, 30, at), words: w.map(function (x) { return x[0]; }) };
  }
  function draw() {
    if (!lay) return;
    var t = video.currentTime || 0;
    scrub.value = Math.round(t * 100);
    clock.textContent = fmtT(t) + ' / ' + fmtT(D.duration);
    var i = findCue(t);
    if (i !== cur) highlight(i);
    if (i < 0) { el.style.opacity = '0'; cur = -1; return; }
    var c = cues[i], T = timingOf(c), motion = motionOf();
    if (i !== cur || dirty) {
      var f = fontOf();
      M.setup(el, {
        text: c.text, words: motion === 'kinetic' && T.words.join('') === c.text ? T.words : null,
        fontFamily: 'tt-' + f.id, weight: f.weight, fill: style.fill, stroke: style.stroke,
        strokeRatio: OUTLINES[style.outline] || 0, shadow: style.shadow, motion: motion,
        width: player.clientWidth, height: lay.band * scale, filterId: 'subf', fixedSize: lay.fontPx * scale, maxW: 0.92, maxH: 0.92,
      });
      cur = i; dirty = false;
    }
    var tt = t - c.start;
    if (calm) tt = Math.min(Math.max(tt, T.tm.settle + 0.6), T.tm.fadeStart - 0.01); // ลดการเคลื่อนไหว: แสดงท่านิ่ง
    M.setTime(el, tt, T.tm, motion);
  }
  var raf = 0;
  function loop() { draw(); raf = video.paused ? 0 : requestAnimationFrame(loop); }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }
  var fontToken = 0;
  function restyle() {
    var f = fontOf(), token = ++fontToken;
    var sample = cues.map(function (c) { return c.text; }).join(' ').slice(0, 400) || 'ก';
    (document.fonts ? document.fonts.load(f.weight + ' 100px "tt-' + f.id + '"', sample) : Promise.resolve()).catch(function () {}).then(function () {
      if (token !== fontToken) return;
      measure(); draw();
    });
    var o = D.owned.filter(function (x) { return x.id === style.order; })[0];
    lookSum.textContent = (o ? o.title : '') + ' · ' + f.label;
    motionNote.textContent = NOTE[motionOf()] || '';
    var sr = $('[data-stroke-row]');
    if (sr) sr.classList.toggle('dim', style.outline === 'none');
  }
  video.addEventListener('play', function () { player.classList.add('playing'); kick(); });
  video.addEventListener('pause', function () { player.classList.remove('playing'); draw(); });
  video.addEventListener('seeked', draw);
  video.addEventListener('loadedmetadata', draw);
  video.addEventListener('timeupdate', function () { if (video.paused) draw(); });
  var toggle = function () { if (video.paused) { var p = video.play(); if (p && p.catch) p.catch(function () {}); } else video.pause(); };
  playBtn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
  player.addEventListener('click', toggle);
  scrub.addEventListener('input', function () { video.currentTime = Number(scrub.value) / 100; draw(); });
  document.addEventListener('keydown', function (e) {
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (e.key === ' ' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(tag)) { e.preventDefault(); toggle(); }
  });
  addEventListener('resize', function () { measure(); draw(); });

  // ---------- รายการบรรทัดซับ ----------
  function rowHtml() {
    return '<button type="button" class="sub-time" data-seek></button>' +
      '<textarea rows="1" data-text maxlength="120" aria-label="ข้อความซับ"></textarea>' +
      '<div class="sub-row-tools">' +
      '<label class="sub-num">เริ่ม <input type="number" step="0.1" min="0" inputmode="decimal" data-start></label>' +
      '<label class="sub-num">จบ <input type="number" step="0.1" min="0" inputmode="decimal" data-end></label>' +
      '<button type="button" class="sub-mini" data-split title="แบ่งเป็น 2 บรรทัดตรงตำแหน่งเคอร์เซอร์">แบ่ง</button>' +
      '<button type="button" class="sub-mini" data-merge title="รวมกับบรรทัดถัดไป">รวม↓</button>' +
      '<button type="button" class="sub-mini danger" data-del aria-label="ลบบรรทัดนี้">ลบ</button></div>';
  }
  function fit(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  function renderList() {
    list.innerHTML = '';
    cues.forEach(function (c, i) {
      var li = document.createElement('li');
      li.className = 'sub-row';
      li.setAttribute('data-i', i);
      li.innerHTML = rowHtml();
      $('[data-seek]', li).textContent = fmtT(c.start, true);
      var ta = $('[data-text]', li);
      ta.value = c.text;
      $('[data-start]', li).value = c.start.toFixed(1);
      $('[data-end]', li).value = c.end.toFixed(1);
      if (disabled) $$('textarea,input,button', li).forEach(function (x) { if (!x.hasAttribute('data-seek')) x.disabled = true; });
      list.appendChild(li);
      fit(ta);
    });
    countEl.textContent = cues.length + ' บรรทัด';
    renderBtn.disabled = disabled || !cues.length;
    cur = -2; draw();
  }
  function highlight(i) {
    $$('.sub-row.on', list).forEach(function (x) { x.classList.remove('on'); });
    if (i < 0) return;
    var li = list.children[i];
    if (!li) return;
    li.classList.add('on');
    if (!video.paused && !list.contains(document.activeElement)) {
      var r = li.getBoundingClientRect(), lr = list.getBoundingClientRect();
      if (list.scrollHeight > list.clientHeight + 4 && (r.top < lr.top || r.bottom > lr.bottom)) list.scrollTop += r.top - lr.top - 40;
    }
  }
  var idx = function (node) { var li = node.closest('.sub-row'); return li ? Number(li.getAttribute('data-i')) : -1; };
  list.addEventListener('click', function (e) {
    var i = idx(e.target);
    if (i < 0) return;
    var c = cues[i];
    if (e.target.closest('[data-seek]')) { video.currentTime = c.start + 0.01; draw(); return; }
    if (e.target.closest('[data-del]')) {
      lastDeleted = { at: i, cue: cues.splice(i, 1)[0] };
      renderList(); changed();
      showUndo();
      return;
    }
    if (e.target.closest('[data-merge]')) {
      var n = cues[i + 1];
      if (!n) return;
      c.text = (c.text + ' ' + n.text).trim(); c.end = n.end; c.w = null;
      cues.splice(i + 1, 1); renderList(); changed(); return;
    }
    if (e.target.closest('[data-split]')) {
      var ta = $('[data-text]', list.children[i]);
      var pos = ta.selectionStart || 0;
      var a = c.text.slice(0, pos).trim(), b = c.text.slice(pos).trim();
      if (!a || !b) { a = c.text.slice(0, Math.ceil(c.text.length / 2)); b = c.text.slice(a.length); }
      var k = graphemes(a).length / Math.max(1, graphemes(a + b).length);
      var mid = Math.round((c.start + (c.end - c.start) * k) * 100) / 100;
      cues.splice(i, 1, { id: '', start: c.start, end: mid, text: a, w: null }, { id: '', start: mid, end: c.end, text: b, w: null });
      renderList(); changed();
    }
  });
  list.addEventListener('input', function (e) {
    var i = idx(e.target);
    if (i < 0) return;
    var c = cues[i];
    if (e.target.matches('[data-text]')) { c.text = e.target.value.replace(/\s+/g, ' '); c.w = null; fit(e.target); }
    if (e.target.matches('[data-start]')) { var s = Number(e.target.value); if (isFinite(s)) { c.start = Math.max(0, s); c.w = null; $('[data-seek]', list.children[i]).textContent = fmtT(c.start, true); } }
    if (e.target.matches('[data-end]')) { var en = Number(e.target.value); if (isFinite(en)) { c.end = Math.min(D.duration, en); c.w = null; } }
    dirty = true; draw(); changed();
  });
  // เลื่อนไปช่วงของบรรทัดที่กำลังแก้ (ไม่เล่นเอง)
  list.addEventListener('focusin', function (e) {
    var i = idx(e.target);
    if (i >= 0 && video.paused && findCue(video.currentTime) !== i) { video.currentTime = cues[i].start + Math.min(0.6, (cues[i].end - cues[i].start) / 2); }
  });
  addBtn.addEventListener('click', function () {
    var t = Math.round((video.currentTime || 0) * 10) / 10;
    var i = 0;
    while (i < cues.length && cues[i].start <= t) i++;
    var nextStart = i < cues.length ? cues[i].start : D.duration;
    if (i > 0 && cues[i - 1].end > t) cues[i - 1].end = Math.max(cues[i - 1].start + 0.3, t);
    var end = Math.min(nextStart, t + 2, D.duration);
    if (end - t < 0.3) { setErr('ช่วงเวลานี้มีซับอยู่แล้ว เลื่อนไปช่วงที่ว่างแล้วกดใหม่'); return; }
    cues.splice(i, 0, { id: '', start: t, end: Math.round(end * 10) / 10, text: '', w: null });
    renderList();
    var ta = $('[data-text]', list.children[i]);
    ta.focus();
    ta.placeholder = 'พิมพ์ข้อความ';
  });

  // ---------- เลิกทำการลบ ----------
  var lastDeleted = null, undoTimer = 0;
  function showUndo() {
    saveState.innerHTML = 'ลบบรรทัดแล้ว · <button type="button" class="linklike" data-undo>เลิกทำ</button>';
    clearTimeout(undoTimer);
    undoTimer = setTimeout(function () { lastDeleted = null; }, 8000);
  }
  saveState.addEventListener('click', function (e) {
    if (!e.target.closest('[data-undo]') || !lastDeleted) return;
    cues.splice(lastDeleted.at, 0, lastDeleted.cue);
    lastDeleted = null; renderList(); changed();
  });

  // ---------- หน้าตา ----------
  function setColor(name, val) {
    style[name] = val.toLowerCase();
    var input = $('input[type="color"][name="' + name + '"]', look);
    if (input) input.value = val;
    $$('[data-swatch="' + name + '"]', look).forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-color') === style[name]); });
  }
  look.addEventListener('click', function (e) {
    var sw = e.target.closest('[data-swatch]');
    if (!sw) return;
    setColor(sw.getAttribute('data-swatch'), sw.getAttribute('data-color'));
    restyle(); changed();
  });
  look.addEventListener('input', function (e) {
    var t = e.target;
    if (t.name === 'fill' || t.name === 'stroke') setColor(t.name, t.value);
    else if (t.name === 'shadow') style.shadow = t.checked;
    else if (t.name === 'font') style.font = t.value;
    else if (t.name === 'order' || t.name === 'outline' || t.name === 'size' || t.name === 'position') style[t.name] = t.value;
    else return;
    restyle(); changed();
  });

  // ---------- บันทึกอัตโนมัติ / สร้างคลิป ----------
  var saveTimer = 0, saving = null, pending = false;
  function setErr(t) { errEl.textContent = t || ''; errEl.hidden = !t; }
  function changed() { pending = true; saveState.textContent = 'มีการแก้ไข…'; clearTimeout(saveTimer); saveTimer = setTimeout(save, 900); }
  function payload() { return { style: style, cues: cues.map(function (c) { return { id: c.id, start: c.start, end: c.end, text: c.text }; }) }; }
  function save(render) {
    clearTimeout(saveTimer);
    if (saving) return saving.then(function () { return save(render); });
    var sentFor = cues.slice();
    pending = false;
    saveState.textContent = render ? 'กำลังเริ่มสร้างคลิป…' : 'กำลังบันทึก…';
    saving = fetch('/subtitles/' + D.id + '/save' + (render ? '?render=1' : ''), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': D.csrf },
      body: JSON.stringify(payload()),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (res) {
      saving = null;
      if (!res.ok) { setErr(res.j.error || 'บันทึกไม่สำเร็จ'); saveState.textContent = 'ยังไม่ได้บันทึก'; return false; }
      setErr('');
      if (render && res.j.spec) {
        // โหมดเบราว์เซอร์: เครื่องนี้สร้างคลิปเอง (public/render-ui.js)
        return new Promise(function (ok) {
          document.dispatchEvent(new CustomEvent('aw:render-subtitles', { detail: { spec: res.j.spec, csrf: D.csrf, done: function (r) { saveState.textContent = r ? 'สร้างคลิปเสร็จแล้ว' : 'บันทึกแล้ว'; ok(r ? 'browser' : false); } } }));
        });
      }
      if (render) return true;
      // รับเวลาคำที่ร้านคำนวณ (ถ้าระหว่างนั้นไม่ได้แก้เพิ่ม)
      if (!pending && sentFor.length === cues.length && res.j.cues) {
        var same = res.j.cues.length === cues.length && res.j.cues.every(function (s, i) { return s.text === cues[i].text.trim(); });
        if (same) res.j.cues.forEach(function (s, i) { cues[i].id = s.id; cues[i].w = s.w; cues[i].start = s.start; cues[i].end = s.end; });
        else if (!list.contains(document.activeElement)) { cues = res.j.cues.map(function (c) { return { id: c.id, start: c.start, end: c.end, text: c.text, w: c.w }; }); renderList(); }
      }
      if (!pending) saveState.textContent = 'บันทึกแล้ว';
      dirty = true; draw();
      return true;
    }).catch(function () { saving = null; saveState.textContent = 'ยังไม่ได้บันทึก (เน็ตหลุด) จะลองใหม่'; saveTimer = setTimeout(save, 4000); return false; });
    return saving;
  }
  renderBtn.addEventListener('click', function () {
    if (!cues.length) return;
    renderBtn.classList.add('loading'); renderBtn.disabled = true;
    save(true).then(function (ok) {
      if (ok === 'browser' || (ok === false && D.browser)) { renderBtn.classList.remove('loading'); renderBtn.disabled = false; return; }
      if (ok) { try { sessionStorage.setItem('noIntroOnce', '1'); } catch (e) { /* ข้าม */ } location.reload(); return; }
      renderBtn.classList.remove('loading'); renderBtn.disabled = false;
    });
  });

  renderList();
  restyle();
  measure();
  draw();
})();

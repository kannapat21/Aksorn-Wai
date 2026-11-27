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

  // ---------- แบบที่ใช้บ่อย (จำไว้ในเบราว์เซอร์นี้) ขึ้นก่อนเสมอ ----------
  var USE_KEY = 'aw-sub-looks';
  function useRead() {
    try { var o = JSON.parse(localStorage.getItem(USE_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
  }
  function useAdd(slugs) {
    var o = useRead(), now = Date.now();
    slugs.forEach(function (k) {
      if (!k) return;
      var r = o[k] || {};
      o[k] = { n: Math.min(9999, (Number(r.n) || 0) + 1), t: now };
    });
    try { localStorage.setItem(USE_KEY, JSON.stringify(o)); } catch (e) { /* โหมดส่วนตัว: ไม่จำ */ }
  }
  // แบบที่ใช้บ่อยสุด (มากไปน้อย · เท่ากัน = ใช้ล่าสุดก่อน)
  function topUsed(slugs, k) {
    var o = useRead();
    var n = function (x) { return Number(o[x] && o[x].n) || 0; };
    var t = function (x) { return Number(o[x] && o[x].t) || 0; };
    return slugs.filter(function (x, i) { return n(x) > 0 && slugs.indexOf(x) === i; })
      .sort(function (a, b) { return (n(b) - n(a)) || (t(b) - t(a)); }).slice(0, k || 4);
  }
  // ย้ายแบบที่ใช้บ่อยขึ้นไปก่อน (จัดครั้งเดียวตอนเปิดหน้า ปุ่มจะไม่กระโดดหนีนิ้ว)
  function frontUsed(box, itemSel, badge) {
    if (!box) return [];
    var items = $$(itemSel, box);
    var slugOf = function (it) { var i = $('input[data-slug]', it); return i ? i.getAttribute('data-slug') : ''; };
    var top = topUsed(items.map(slugOf), 4);
    top.slice().reverse().forEach(function (k) {
      var it = items.filter(function (x) { return slugOf(x) === k; })[0];
      if (!it) return;
      box.insertBefore(it, box.firstChild);
      var host = badge ? badge(it) : null;
      if (host && !$('.sub-used', it)) { var b = document.createElement('i'); b.className = 'sub-used'; b.textContent = 'ใช้บ่อย'; host.appendChild(b); }
    });
    return top;
  }

  // ---------- หน้าแรก: เลือกแบบ + อัปคลิป ----------
  var form = $('[data-sub-new]');
  if (form) (function () {
    var fileIn = $('[data-file]', form), drop = $('[data-drop]', form), startBtn = $('[data-start]', form);
    var nameEl = $('[data-file-name]', form), infoEl = $('[data-file-info]', form), errEl = $('[data-up-err]', form);
    var up = $('[data-up]', form), bar = $('[data-up-bar]', form), pct = $('[data-up-pct]', form), upText = $('[data-up-text]', form);
    var maxMb = Number(form.getAttribute('data-max-mb')), maxSec = Number(form.getAttribute('data-max-sec'));
    var off = form.hasAttribute('data-off');
    var picked = null, sending = false;
    var top = frontUsed($('.sub-styles', form), '.sub-style', function (it) { return $('.sub-style-card', it); });
    if (top.length && !form.hasAttribute('data-picked')) {
      var first = $('input[data-slug="' + top[0] + '"]', form);
      if (first) first.checked = true;
    }
    startBtn.addEventListener('click', function () {
      var ch = $('input[name="order"]:checked', form);
      if (ch && !startBtn.disabled) useAdd([ch.getAttribute('data-slug')]);
    }, true);
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
    typewriter: 'ตัวอักษรพิมพ์ขึ้นทีละตัว',
    rise: 'ตัวอักษรเลื่อนขึ้นจากใต้เส้นทีละตัว',
    zoom: 'แต่ละบรรทัดพุ่งจากใหญ่และเบลอเข้ามาหยุดคม',
    jump: 'ตัวอักษรตกลงมาเด้งทีละตัว',
    highlight: 'แถบไฮไลต์ปาดเข้าใต้ข้อความ (สีขอบ = สีแถบ)',
    glitch: 'ข้อความโผล่แบบสัญญาณกลิตช์ สีแยก RGB',
    gold: 'ตัวอักษรสีโลหะเงาวาว (สีตัวอักษร = สีโลหะ)',
    flip: 'ตัวอักษร 3D พลิกลงมาทีละตัว',
    karaoke: 'ข้อความสีขาว ขอบตามที่เลือก (สีวิ่งแบบคาราโอเกะมีเฉพาะในคลิปแอนิเมชัน)',
    lower: 'แถบชื่อปาดเข้า ข้อความสไลด์ตาม (สีขอบ = สีแถบ)',
    impact: 'แต่ละบรรทัดกระแทกลงจอ มีคลื่นกระแทก',
    bubble: 'ข้อความอยู่ในกล่องแชท (สีขอบ = สีกล่อง)',
    blur: 'ตัวอักษรค่อยๆ ชัดจากความเบลอ นุ่มนวล',
    wave: 'ตัวอักษรเด้งขึ้นทีละตัวแบบคลื่น',
    stamp: 'แต่ละบรรทัดกระแทกลงในกรอบแบบตรายาง (สีตัวอักษร = สีตรา)',
    split: 'ครึ่งบนกับครึ่งล่างพุ่งมาประกบกัน',
    rainbow: 'ตัวอักษรสีรุ้ง เด้งเข้าทีละตัว (สีตัวอักษรไม่มีผล)',
    liquid: 'น้ำสีไหลขึ้นมาเต็มตัวอักษร (สีตัวอักษร = สีน้ำ)',
    sticker: 'ข้อความแบบสติกเกอร์ขอบหนา (สีขอบ = สีขอบสติกเกอร์)',
    scramble: 'ตัวอักษรสุ่มรัวๆ แล้วล็อกเป็นคำจริง',
    hearts: 'ข้อความเด้งเข้าพร้อมหัวใจกระจาย (สีขอบ = สีหัวใจ)',
    retro: 'ตัวอักษรมีเงา 3D ยาวแบบยุค 80 (สีขอบ = สีเงา)',
    slide: 'ข้อความพุ่งเข้าจากด้านข้างแล้วเบรกนุ่มๆ',
    fadeup: 'คำลอยขึ้นและชัดทีละคำ',
    underline: 'ข้อความขึ้นแล้วมีเส้นใต้ลากตาม (สีตัวอักษร = สีเส้น)',
    swing: 'ป้ายข้อความห้อยลงมาแกว่งแล้วนิ่ง',
    strike: 'ข้อความโดนขีดฆ่า (สีขอบ = สีเส้นขีด)',
    spotlight: 'แสงสปอตไลต์กวาดผ่านข้อความ',
    confetti: 'ข้อความเด้งเข้าพร้อมกระดาษสีระเบิด',
    reveal: 'แถบสีวิ่งผ่านเผยข้อความ (สีขอบ = สีแถบ)',
    echo: 'เส้นข้อความซ้อนกระจายขึ้นลงเป็นจังหวะ (สีตัวอักษร = สีเส้นซ้อน)',
    jelly: 'ตัวอักษรหล่นลงมาเด้งดึ๋งเหมือนเยลลี่',
    comic: 'คำกระแทกบนดาวระเบิดแบบการ์ตูน (สีขอบ = สีดาว)',
  };
  // แบบ (แอนิเมชัน) ที่มีในคลัง · บรรทัดที่เลือกแบบเองเก็บ slug ไว้ใน c.p (ไม่มี = ใช้แบบหลัก)
  var bySlug = {};
  var LOOK_COLORS = ['#e0563b', '#2f9e6e', '#7b5cd6', '#d99a00', '#1f8fd1', '#d6408f', '#5c8a1f', '#8a5a2b'];
  D.owned.forEach(function (o, i) { bySlug[o.slug] = o; o.color = LOOK_COLORS[i % LOOK_COLORS.length]; });
  var MAX_LOOKS = 8;
  var cleanP = function (p) { return p && bySlug[p] ? p : null; }; // แบบที่ไม่มีในคลังแล้ว → กลับไปใช้แบบหลัก
  var cues = D.cues.map(function (c) { return { id: c.id, start: c.start, end: c.end, text: c.text, w: c.w || null, p: cleanP(c.p) }; });
  var style = D.style;
  if (!style.looks || typeof style.looks !== 'object') style.looks = {};
  var video = $('[data-video]'), player = $('[data-player]'), band = $('[data-band]'), el = $('[data-sub-text]');
  var clock = $('[data-clock]'), playBtn = $('[data-play]');
  var saveState = $('[data-save-state]'), errEl = $('[data-err]');
  var look = $('[data-look]'), lookSum = $('[data-look-sum]'), motionNote = $('[data-motion-note]');
  var renderBtn = $('[data-render]'), addBtn = $('[data-add]');
  var disabled = D.disabled;
  $('[data-filters]').innerHTML = M.filterMarkup('subf');

  var mainLook = function () { return D.owned.filter(function (x) { return x.id === style.order; })[0] || null; };
  var lookOf = function (c) { return (c && c.p && bySlug[c.p]) || mainLook(); };
  var isMain = function (c) { var m = mainLook(); return !c || !c.p || !bySlug[c.p] || Boolean(m && c.p === m.slug); };
  var motionOf = function (c) { var o = lookOf(c); return o ? o.motion : 'pop'; };
  // ตำแหน่งของบรรทัด: แบบหลักใช้ตำแหน่งหลัก · แบบอื่นใช้ตำแหน่งของแบบนั้น (ยังไม่เคยลาก = ตำแหน่งหลัก)
  var posOf = function (c) { return isMain(c) ? style.position : (style.looks[c.p] || style.position); };
  var looksUsed = function (list) {
    var seen = [];
    (list || cues).forEach(function (c) { var o = lookOf(c); if (o && seen.indexOf(o.slug) < 0) seen.push(o.slug); });
    return seen;
  };
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
    var maxH = innerWidth <= 900 ? Math.max(200, innerHeight * 0.38) : Math.max(260, Math.min(innerHeight * 0.62, 600));
    var pw = Math.min(player.parentElement.clientWidth, maxH * D.width / D.height);
    player.style.width = Math.round(pw) + 'px';
    player.style.height = Math.round(pw * D.height / D.width) + 'px';
    scale = player.clientWidth / D.width;
    lay = window.TTSubPlan.layoutFor(D.width, D.height, { size: style.size, position: style.position });
    band.style.height = (lay.band * scale) + 'px';
    placeBand(shown);
    dirty = true;
  }
  // วางแถบซับตามตำแหน่งของบรรทัดที่กำลังแสดง (คนละแบบอยู่คนละที่ได้)
  var shown = null, bandY = 0;
  function placeBand(c) {
    shown = c || null;
    var L = window.TTSubPlan.layoutFor(D.width, D.height, { size: style.size, position: posOf(c) });
    bandY = L.y;
    band.style.top = (L.y * scale) + 'px';
    var o = lookOf(c);
    band.setAttribute('aria-label', 'ตำแหน่งซับ' + (o && !isMain(c) ? ' แบบ ' + o.title : '') + ' ลากหรือกดลูกศรขึ้นลง');
  }
  function findCue(t) {
    for (var i = 0; i < cues.length; i++) if (t >= cues[i].start && t < cues[i].end) return i;
    return -1;
  }
  function timingOf(c) {
    var d = c.end - c.start;
    var w = c.w || spread(c.text, d);
    var at = w.filter(function (x) { return x[1] !== null; }).map(function (x) { return Math.min(x[1], Math.max(0, d - 0.3)); });
    return { tm: M.subtitleTiming(motionOf(c), d, 30, at), words: w.map(function (x) { return x[0]; }) };
  }
  function draw() {
    if (!lay) return;
    var t = video.currentTime || 0;
    tlHead(t);
    clock.textContent = fmtT(t) + ' / ' + fmtT(D.duration);
    var i = findCue(t);
    if (i !== cur) highlight(i);
    if (i < 0) {
      // ไม่มีซับตรงจุดนี้: ตอนหยุดเล่นโชว์ซับตัวอย่างจางๆ ให้เห็นตำแหน่งและลากย้ายได้
      if (video.paused && !disabled && cues.length) { ghost(); return; }
      band.classList.remove('ghost'); el.style.opacity = '0'; cur = -1; return;
    }
    band.classList.remove('ghost');
    var c = cues[i], T = timingOf(c), motion = motionOf(c);
    if (i !== cur || dirty) {
      placeBand(c);
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
  function ghost() {
    var c = cues[Math.max(0, sel)] || cues[0], T = timingOf(c), motion = motionOf(c);
    if (cur !== -3 || dirty || shown !== c) {
      placeBand(c);
      var f = fontOf();
      M.setup(el, {
        text: c.text || 'ตัวอย่างซับ', words: null,
        fontFamily: 'tt-' + f.id, weight: f.weight, fill: style.fill, stroke: style.stroke,
        strokeRatio: OUTLINES[style.outline] || 0, shadow: style.shadow, motion: motion,
        width: player.clientWidth, height: lay.band * scale, filterId: 'subf', fixedSize: lay.fontPx * scale, maxW: 0.92, maxH: 0.92,
      });
      cur = -3; dirty = false;
    }
    M.setTime(el, Math.min(T.tm.settle + 0.6, T.tm.fadeStart - 0.01), T.tm, motion);
    band.classList.add('ghost');
  }

  // ---------- ลากซับบนวิดีโอเพื่อย้ายตำแหน่ง (ขึ้น-ลง) ใช้ตำแหน่งเดียวกันตอนสร้างคลิป ----------
  var P = window.TTSubPlan;
  var bandDrag = null;
  function setPos(pct) {
    pct = Math.round(Math.max(P.POS_MIN, Math.min(P.POS_MAX, pct)) * 10) / 10;
    if (Math.abs(pct - 50) < 1.5) pct = 50; // ดูดเข้ากึ่งกลางจอ
    if (shown && !isMain(shown)) style.looks[shown.p] = String(pct); // ย้ายเฉพาะแบบของบรรทัดที่เห็นอยู่
    else {
      style.position = String(pct);
      $$('input[name="position"]', look).forEach(function (r) { r.checked = false; });
    }
    measure(); dirty = true; draw();
  }
  function curPct() { return ((bandY + lay.band / 2) / D.height) * 100; }
  function movedNote() {
    var o = lookOf(shown);
    if (o && !isMain(shown)) saveState.textContent = 'ย้ายเฉพาะแบบ "' + o.title + '"';
  }
  if (!disabled) {
    band.tabIndex = 0;
    band.setAttribute('role', 'slider');
    band.setAttribute('aria-label', 'ตำแหน่งซับ ลากหรือกดลูกศรขึ้นลง');
    band.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      e.stopPropagation(); e.preventDefault();
      bandDrag = { y0: e.clientY, p0: curPct(), moved: false };
      try { band.setPointerCapture(e.pointerId); } catch (err) { /* ข้าม */ }
      player.classList.add('dragging');
    });
    band.addEventListener('pointermove', function (e) {
      if (!bandDrag) return;
      var dy = e.clientY - bandDrag.y0;
      if (!bandDrag.moved && Math.abs(dy) < 3) return;
      bandDrag.moved = true;
      setPos(bandDrag.p0 + (dy / player.clientHeight) * 100);
    });
    var bandUp = function () {
      if (!bandDrag) return;
      var moved = bandDrag.moved;
      bandDrag = null;
      player.classList.remove('dragging');
      if (moved) { changed(); movedNote(); var hint = $('[data-drag-hint]'); if (hint) hint.hidden = true; }
    };
    band.addEventListener('pointerup', bandUp);
    band.addEventListener('pointercancel', bandUp);
    band.addEventListener('click', function (e) { e.stopPropagation(); });
    band.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault(); e.stopPropagation();
      setPos(curPct() + (e.key === 'ArrowUp' ? -2 : 2)); changed(); movedNote();
    });
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
    var o = mainLook();
    lookSum.textContent = (o ? o.title : '') + ' · ' + f.label;
    motionNote.textContent = NOTE[motionOf(null)] || '';
    var sr = $('[data-stroke-row]');
    if (sr) sr.classList.toggle('dim', style.outline === 'none');
  }
  video.addEventListener('play', function () { player.classList.add('playing'); kick(); });
  video.addEventListener('pause', function () { player.classList.remove('playing'); draw(); });
  video.addEventListener('seeked', draw);
  video.addEventListener('loadedmetadata', function () {
    // เปิดหน้ามา: ไปที่ซับบรรทัดแรกตอนแสดงเต็ม ให้เห็นหน้าตาและลากย้ายได้ทันที
    if (!video.currentTime && cues.length) {
      var c0 = cues[0], T0 = timingOf(c0);
      seek(Math.min(c0.start + T0.tm.settle + 0.2, c0.end - 0.05));
    }
    draw();
  });
  video.addEventListener('timeupdate', function () { if (video.paused) draw(); });
  var toggle = function () { if (video.paused) { var p = video.play(); if (p && p.catch) p.catch(function () {}); } else video.pause(); };
  playBtn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
  player.addEventListener('click', toggle);
  document.addEventListener('keydown', function (e) {
    if (sheet && !sheet.hidden) return; // กล่องเลือกแบบเปิดอยู่: ไม่ใช้คีย์ลัดของหน้า
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    var typing = /INPUT|TEXTAREA|SELECT/.test(tag);
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      if (typing && hist.typingFocus) return; // ให้ช่องพิมพ์เลิกทำตัวอักษรเอง
      e.preventDefault(); undo(); return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); toggle(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      seek((video.currentTime || 0) + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1));
      return;
    }
    if (disabled) return;
    if (e.key === 's' || e.key === 'S' || e.key === 'ห') { e.preventDefault(); splitAtHead(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0) { e.preventDefault(); removeCue(sel); }
  });
  addEventListener('resize', function () { measure(); draw(); });

  // ---------- ไทม์ไลน์ (แบบแอปตัดต่อ): คลื่นเสียง · บล็อกซับลากปรับเวลาได้ · เส้นเวลา ----------
  var tl = $('[data-tl]'), tlScroll = $('[data-tl-scroll]'), track = $('[data-tl-track]'), tlCues = $('[data-tl-cues]');
  var tlHeadEl = $('[data-tl-head]'), wave = $('[data-tl-wave]'), undoBtn = $('[data-tl-undo]');
  var ZOOMS = [10, 20, 40, 80, 160, 320];
  var zoom = 3, pps = ZOOMS[zoom], peaks = null, sel = -1, MIN = 0.3, WAVE_H = 34;
  var hist = { stack: [], typingFocus: false };
  var r2 = function (x) { return Math.round(x * 100) / 100; };
  var clamp = function (x, a, b) { return Math.max(a, Math.min(b, x)); };

  function snap() {
    hist.stack.push(JSON.stringify(cues));
    if (hist.stack.length > 60) hist.stack.shift();
    if (undoBtn) undoBtn.disabled = disabled;
  }
  function undo() {
    if (disabled || !hist.stack.length) return;
    cues = JSON.parse(hist.stack.pop());
    hist.typingFocus = false;
    multiSel = [];
    if (undoBtn) undoBtn.disabled = !hist.stack.length;
    sel = Math.min(sel, cues.length - 1);
    renderList(); changed();
    saveState.textContent = 'เลิกทำแล้ว';
  }
  function seek(t) {
    video.currentTime = clamp(t, 0, Math.max(0, D.duration - 0.01));
    draw();
  }
  function select(i, quiet) {
    sel = i;
    $$('.sub-tl-cue.sel', tlCues).forEach(function (b) { b.classList.remove('sel'); });
    if (i < 0) return;
    var b = tlCues.children[i];
    if (b) {
      b.classList.add('sel');
      var x = cues[i].start * pps, w = tlScroll.clientWidth;
      if (x < tlScroll.scrollLeft || x > tlScroll.scrollLeft + w - 60) tlScroll.scrollLeft = Math.max(0, x - w * 0.25);
    }
  }
  function removeCue(i) {
    if (disabled || !cues[i]) return;
    snap();
    cues.splice(i, 1);
    sel = -1;
    renderList(); changed();
    saveState.innerHTML = 'ลบบรรทัดแล้ว · <button type="button" class="linklike" data-undo>เลิกทำ</button>';
  }
  function splitCue(i, at, a, b) {
    var c = cues[i];
    if (c.end - c.start < MIN * 2) { setErr('บรรทัดนี้สั้นเกินกว่าจะแบ่ง'); return; }
    var mid = r2(clamp(at, c.start + MIN, c.end - MIN));
    snap();
    cues.splice(i, 1, { id: '', start: c.start, end: mid, text: a.trim(), w: null, p: c.p || null }, { id: '', start: mid, end: c.end, text: b.trim(), w: null, p: c.p || null });
    setErr('');
    renderList(); changed();
    select(i + 1);
  }
  // แบ่งบรรทัดตรงเส้นเวลา: ตัดข้อความที่รอยต่อคำที่ใกล้จังหวะนั้นที่สุด (ใช้เวลาคำจริงถ้ามี)
  function splitAtHead() {
    var t = video.currentTime || 0, i = findCue(t);
    if (i < 0) { setErr('เลื่อนเส้นเวลาไปไว้บนบรรทัดที่ต้องการแบ่ง แล้วกดแบ่งอีกครั้ง'); return; }
    var c = cues[i], rel = t - c.start, cut = -1;
    if (c.w && c.w.length > 1 && c.w.map(function (x) { return x[0]; }).join('') === c.text) {
      var acc = 0;
      for (var k = 0; k < c.w.length; k++) {
        if (k > 0 && c.w[k][1] !== null && c.w[k][1] >= rel - 0.05) { cut = acc; break; }
        acc += c.w[k][0].length;
      }
    }
    if (cut <= 0 || cut >= c.text.length) {
      var parts = window.Intl && Intl.Segmenter ? Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(c.text), function (x) { return x.segment; }) : graphemes(c.text);
      if (parts.length < 2) parts = graphemes(c.text);
      var total = graphemes(c.text).length, target = total * (rel / Math.max(0.01, c.end - c.start)), pos = 0, g = 0, best = Infinity;
      for (var j = 0; j < parts.length - 1; j++) {
        pos += parts[j].length; g += graphemes(parts[j]).length;
        if (Math.abs(g - target) < best) { best = Math.abs(g - target); cut = pos; }
      }
    }
    if (cut <= 0 || cut >= c.text.length) { setErr('บรรทัดนี้มีคำเดียว แบ่งไม่ได้'); return; }
    splitCue(i, t, c.text.slice(0, cut), c.text.slice(cut));
  }

  function tlSize() {
    track.style.width = Math.max(tlScroll.clientWidth, Math.ceil(D.duration * pps)) + 'px';
  }
  function tlUpdate(i) {
    var b = tlCues.children[i], c = cues[i];
    lineUpdate(i);
    if (!b || !c) return;
    b.style.left = (c.start * pps) + 'px';
    b.style.width = Math.max(4, (c.end - c.start) * pps) + 'px';
    var s = $('span', b);
    s.textContent = c.text || '…';
    var o = lookOf(c), own = !isMain(c);
    b.classList.toggle('lk', own);
    if (own && o) { b.style.setProperty('--lk', o.color); b.title = o.title; } else { b.style.removeProperty('--lk'); b.removeAttribute('title'); }
    b.classList.toggle('pk', multi && multiSel.indexOf(c) >= 0);
  }
  function tlRender() {
    tlSize();
    tlCues.innerHTML = '';
    cues.forEach(function (c, i) {
      var b = document.createElement('div');
      b.className = 'sub-tl-cue' + (i === sel ? ' sel' : '');
      b.setAttribute('data-ti', i);
      b.innerHTML = '<i class="h-l" data-h="l"></i><span></span><i class="h-r" data-h="r"></i>';
      tlCues.appendChild(b);
      tlUpdate(i);
    });
    tlHead(video.currentTime || 0, true);
    drawWave();
  }
  function tlActive(i) {
    $$('.sub-tl-cue.on', tlCues).forEach(function (b) { b.classList.remove('on'); });
    var b = i >= 0 && tlCues.children[i];
    if (b) b.classList.add('on');
  }
  function tlHead(t, quiet) {
    if (!tlHeadEl) return;
    var x = t * pps;
    tlHeadEl.style.transform = 'translateX(' + x + 'px)';
    track.setAttribute('aria-valuenow', Math.round(t));
    track.setAttribute('aria-valuetext', fmtT(t, true));
    if (quiet || drag) return;
    var w = tlScroll.clientWidth, sl = tlScroll.scrollLeft;
    if (!video.paused && (x > sl + w - 30 || x < sl)) tlScroll.scrollLeft = Math.max(0, x - w * 0.25);
  }
  function cssVar(n) { return getComputedStyle(tl).getPropertyValue(n).trim(); }
  function drawWave() {
    var w = tlScroll.clientWidth, h = tlScroll.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!w || !h) return;
    if (wave.width !== Math.round(w * dpr) || wave.height !== Math.round(h * dpr)) {
      wave.width = Math.round(w * dpr); wave.height = Math.round(h * dpr);
      wave.style.width = w + 'px'; wave.style.height = h + 'px';
    }
    var g = wave.getContext('2d'), sl = tlScroll.scrollLeft;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    // ไม้บรรทัดเวลา
    var step = pps >= 80 ? 1 : pps >= 20 ? 5 : 10;
    g.fillStyle = cssVar('--muted') || '#888';
    g.font = '11px Kanit, system-ui, sans-serif';
    g.textBaseline = 'top';
    for (var s = Math.floor(sl / pps / step) * step; s * pps < sl + w; s += step) {
      var x = Math.round(s * pps - sl) + 0.5;
      g.fillRect(x, 0, 1, 5);
      if (s % (step * (pps >= 160 ? 1 : 2)) === 0) g.fillText(fmtT(s), x + 3, 2);
    }
    if (!peaks) return;
    var laneTop = h - WAVE_H, mid = laneTop + WAVE_H / 2, amp = WAVE_H / 2 - 3; // เลนคลื่นเสียงอยู่ใต้เลนซับ (แบบแอปตัดต่อ)
    g.fillStyle = cssVar('--tl-lane') || 'rgba(0,0,0,.04)';
    g.fillRect(0, laneTop, w, WAVE_H);
    g.fillStyle = cssVar('--tl-wave') || 'rgba(120,130,150,.5)';
    for (var px = 0; px < w; px++) {
      var a = Math.floor(((sl + px) / pps) * peaks.perSec), b = Math.max(a + 1, Math.floor(((sl + px + 1) / pps) * peaks.perSec));
      if (a >= peaks.data.length) break;
      var m = 0;
      for (var k = a; k < b && k < peaks.data.length; k++) if (peaks.data[k] > m) m = peaks.data[k];
      var hh = Math.max(1, (m / 255) * amp);
      g.fillRect(px, mid - hh, 1, hh * 2);
    }
  }
  var waveRaf = 0;
  tlScroll.addEventListener('scroll', function () { if (!waveRaf) waveRaf = requestAnimationFrame(function () { waveRaf = 0; drawWave(); }); }, { passive: true });
  function setZoom(z, anchorT) {
    z = clamp(z, 0, ZOOMS.length - 1);
    if (z === zoom) return;
    var t = anchorT === undefined ? (video.currentTime || 0) : anchorT;
    var off = t * pps - tlScroll.scrollLeft;
    zoom = z; pps = ZOOMS[z];
    tlSize();
    cues.forEach(function (c, i) { tlUpdate(i); });
    tlScroll.scrollLeft = Math.max(0, t * pps - off);
    tlHead(video.currentTime || 0, true);
    drawWave();
  }
  tl.addEventListener('click', function (e) {
    var z = e.target.closest('[data-tl-zoom]');
    if (z) { setZoom(zoom + Number(z.getAttribute('data-tl-zoom'))); return; }
    if (e.target.closest('[data-tl-play]')) { toggle(); return; }
    if (e.target.closest('[data-tl-split]')) { splitAtHead(); return; }
    if (e.target.closest('[data-tl-edit]')) { var ei = pick(); if (ei >= 0) openEdit(ei); else setErr('แตะบล็อกซับที่ต้องการแก้ก่อน'); return; }
    if (e.target.closest('[data-tl-del]')) { var di = pick(); if (di >= 0) removeCue(di); else setErr('แตะบล็อกซับที่ต้องการลบก่อน'); return; }
    if (e.target.closest('[data-tl-look]')) { var li2 = pick(); if (li2 >= 0) openSheet([cues[li2]]); else setErr('แตะบล็อกซับที่ต้องการเปลี่ยนแบบก่อน'); return; }
    if (e.target.closest('[data-tl-undo]')) undo();
  });
  tlScroll.addEventListener('wheel', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return; // ซูมด้วย Ctrl/⌘ + ล้อเมาส์ หรือหยิกบนทัชแพด
    e.preventDefault();
    var t = (tlScroll.scrollLeft + e.clientX - tlScroll.getBoundingClientRect().left) / pps;
    setZoom(zoom + (e.deltaY < 0 ? 1 : -1), t);
  }, { passive: false });

  // ลาก: ขอบซ้าย/ขวา = ปรับเวลาเริ่ม/จบ · กลางบล็อก = เลื่อนทั้งบรรทัด · พื้นที่ว่าง = เลื่อนเวลา
  var drag = null;
  var timeAt = function (e) { return (e.clientX - track.getBoundingClientRect().left) / pps; };
  track.addEventListener('pointerdown', function (e) {
    if (e.button > 0 || (edIn && e.target === edIn)) return;
    if (edIn) closeEdit();
    var blk = e.target.closest('.sub-tl-cue'), h = e.target.closest('[data-h]');
    var i = blk ? Number(blk.getAttribute('data-ti')) : -1;
    if (i < 0 || disabled) {
      if (e.pointerType === 'touch' && !blk) { drag = { mode: 'tap', x0: e.clientX, t: timeAt(e) }; return; }
      drag = { mode: 'scrub' };
      seek(timeAt(e));
    } else {
      var c = cues[i];
      drag = { mode: h ? h.getAttribute('data-h') : 'move', i: i, x0: e.clientX, s0: c.start, e0: c.end, t: timeAt(e), live: !!h, snapped: false, was: sel === i };
      select(i, true);
      e.preventDefault();
    }
    try { track.setPointerCapture(e.pointerId); } catch (err) { /* ข้าม */ }
  });
  track.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (drag.mode === 'scrub') { seek(timeAt(e)); return; }
    if (drag.mode === 'tap') { if (Math.abs(e.clientX - drag.x0) > 8) drag = null; return; }
    var dx = e.clientX - drag.x0;
    if (!drag.live && Math.abs(dx) < 5) return;
    drag.live = true;
    var i = drag.i, c = cues[i], dt = dx / pps;
    var lo = i > 0 ? cues[i - 1].end : 0, hi = i < cues.length - 1 ? cues[i + 1].start : D.duration;
    var ns = c.start, ne = c.end;
    if (drag.mode === 'move') { var len = drag.e0 - drag.s0; ns = clamp(drag.s0 + dt, lo, hi - len); ne = ns + len; }
    else if (drag.mode === 'l') ns = clamp(drag.s0 + dt, lo, c.end - MIN);
    else ne = clamp(drag.e0 + dt, c.start + MIN, hi);
    ns = r2(ns); ne = r2(ne);
    if (ns === c.start && ne === c.end) return;
    if (!drag.snapped) { snap(); drag.snapped = true; }
    c.start = ns; c.end = ne; c.w = c.w && drag.mode === 'move' ? c.w : null;
    tlUpdate(i);
    if (video.paused) seek(drag.mode === 'r' ? c.end - 0.05 : c.start + 0.01);
    dirty = true;
  });
  function endDrag(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    if (d.mode === 'tap') { seek(d.t); return; }
    if (d.mode === 'scrub') return;
    if (d.snapped) { changed(); draw(); return; }
    if (!e || e.type !== 'pointerup') return;
    if (multi) { togglePick(cues[d.i]); return; } // โหมดเลือกหลายบรรทัด: แตะบล็อก = เลือก/ไม่เลือก
    if (d.was && d.mode === 'move') { openEdit(d.i); return; } // แตะบล็อกที่เลือกอยู่ = พิมพ์แก้ในบล็อก
    seek(clamp(d.t, cues[d.i].start, cues[d.i].end - 0.01)); // แตะบล็อก = เลือก + ไปที่จุดนั้น
  }
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('dblclick', function (e) { var b = e.target.closest('.sub-tl-cue'); if (b) openEdit(Number(b.getAttribute('data-ti'))); });
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('keydown', function (e) {
    if (e.key === 'Home') { e.preventDefault(); seek(0); }
    if (e.key === 'End') { e.preventDefault(); seek(D.duration); }
  });
  document.addEventListener('aw:peaks', function (e) { if (e.detail && e.detail.data) { peaks = e.detail; drawWave(); } });
  if (!D.browser) fetch('/subtitles/' + D.id + '/peaks', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (p) { if (p && p.data) { peaks = p; drawWave(); } }).catch(function () {});
  // เริ่มต้นให้เห็นราว 12 วินาทีในจอ
  (function () {
    var w = tlScroll.clientWidth || 320, want = w / Math.min(D.duration || 12, 12), z = 0;
    while (z < ZOOMS.length - 1 && ZOOMS[z + 1] <= want) z++;
    zoom = z; pps = ZOOMS[z];
  })();
  addEventListener('resize', function () { tlSize(); drawWave(); });

  // ---------- แก้คำในบล็อกบนไทม์ไลน์ ----------
  var edIn = null, edI = -1, edOld = '', edSnap = false;
  function pick() { return sel >= 0 && cues[sel] ? sel : findCue(video.currentTime || 0); }
  function renderList() {
    closeEdit(true);
    tlRender();
    multiRefresh();
    renderLines();
    renderBtn.disabled = disabled;
    cur = -2; draw();
  }
  function highlight(i) {
    tlActive(i);
    if (!linesEl) return;
    $$('.sub-line.on', linesEl).forEach(function (li) { li.classList.remove('on'); });
    var li = i >= 0 && linesEl.children[i];
    if (li) {
      li.classList.add('on');
      if (!video.paused && !typingLine()) { var top = li.offsetTop; if (top < linesEl.scrollTop || top > linesEl.scrollTop + linesEl.clientHeight - li.offsetHeight) linesEl.scrollTop = Math.max(0, top - 8); }
    }
  }

  // ---------- รายการข้อความซับ (แตะแล้วพิมพ์แก้ได้ทันที) ----------
  var linesEl = $('[data-lines]'), lineSnap = false;
  function typingLine() { return Boolean(linesEl && document.activeElement && linesEl.contains(document.activeElement)); }
  function renderLines() {
    if (!linesEl) return;
    linesEl.innerHTML = '';
    cues.forEach(function (c, i) {
      var li = document.createElement('li');
      li.className = 'sub-line';
      li.innerHTML = '<input type="checkbox" class="sub-line-ck" tabindex="-1"><button type="button" class="sub-line-t" data-line-seek tabindex="-1"></button><input type="text" class="sub-line-in" maxlength="120" enterkeyhint="next" placeholder="พิมพ์ข้อความซับ"><button type="button" class="sub-line-lk" data-line-look></button>';
      $('.sub-line-t', li).textContent = fmtT(c.start);
      var inp = $('.sub-line-in', li);
      inp.value = c.text; inp.disabled = disabled; inp.readOnly = multi; inp.setAttribute('aria-label', 'ซับบรรทัดที่ ' + (i + 1));
      $('.sub-line-ck', li).setAttribute('aria-label', 'เลือกบรรทัดที่ ' + (i + 1));
      linesEl.appendChild(li);
      lineLook(li, c);
    });
    linesEl.classList.toggle('multi', multi);
    if (!cues.length) linesEl.innerHTML = '<li class="sub-line-empty muted small">ยังไม่มีซับ เล่นคลิปถึงจุดที่มีคนพูด แล้วกด "+ เพิ่มบรรทัด"</li>';
  }
  function lineUpdate(i) {
    var li = linesEl && linesEl.children[i], c = cues[i];
    var inp = li && $('.sub-line-in', li);
    if (!inp || !c) return;
    $('.sub-line-t', li).textContent = fmtT(c.start);
    if (document.activeElement !== inp) inp.value = c.text;
    lineLook(li, c);
  }
  // ปุ่มแบบท้ายบรรทัด: แบบหลัก = ✦ จางๆ · แบบของบรรทัดเอง = จุดสี + ชื่อแบบ
  function lineLook(li, c) {
    var b = $('.sub-line-lk', li), ck = $('.sub-line-ck', li);
    if (!b) return;
    var o = lookOf(c), own = !isMain(c);
    b.classList.toggle('own', own);
    b.disabled = disabled;
    b.textContent = '';
    if (own && o) {
      var dot = document.createElement('i'); dot.style.background = o.color; b.appendChild(dot);
      var nm = document.createElement('span'); nm.textContent = o.title; b.appendChild(nm);
    } else b.textContent = '✦';
    b.setAttribute('aria-label', 'เปลี่ยนแบบบรรทัดนี้ (ตอนนี้: ' + (own && o ? o.title : 'แบบหลัก') + ')');
    b.title = own && o ? o.title : 'เปลี่ยนแบบเฉพาะบรรทัดนี้';
    var on = multi && multiSel.indexOf(c) >= 0;
    if (ck) ck.checked = on;
    li.classList.toggle('pk', on);
  }
  var lineIndex = function (node) { var li = node.closest('.sub-line'); return li ? Array.prototype.indexOf.call(linesEl.children, li) : -1; };
  if (linesEl) {
    linesEl.addEventListener('focusin', function (e) {
      if (!e.target.classList.contains('sub-line-in') || multi) return;
      var i = lineIndex(e.target), c = cues[i];
      if (!c) return;
      lineSnap = false; hist.typingFocus = true;
      if (edIn) closeEdit();
      select(i, true);
      if (video.paused && findCue(video.currentTime || 0) !== i) seek(c.start + Math.min(0.6, (c.end - c.start) / 2));
    });
    linesEl.addEventListener('input', function (e) {
      var i = lineIndex(e.target), c = cues[i];
      if (!c) return;
      if (!lineSnap) { snap(); lineSnap = true; }
      c.text = e.target.value.replace(/\s+/g, ' '); c.w = null;
      tlUpdate(i); dirty = true; draw(); changed();
    });
    linesEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !e.target.classList.contains('sub-line-in')) return;
      e.preventDefault();
      var li = e.target.closest('.sub-line').nextElementSibling;
      var nx = li && $('.sub-line-in', li);
      if (nx) nx.focus(); else e.target.blur();
    });
    linesEl.addEventListener('focusout', function (e) {
      if (!e.target.classList.contains('sub-line-in')) return;
      hist.typingFocus = false;
      var i = lineIndex(e.target), c = cues[i];
      if (!c) return;
      c.text = c.text.trim();
      if (!c.text) { cues.splice(i, 1); sel = -1; renderList(); changed(); return; } // ลบข้อความหมด = ลบบรรทัด
      e.target.value = c.text;
      tlUpdate(i);
    });
    linesEl.addEventListener('click', function (e) {
      var i = lineIndex(e.target);
      if (!cues[i]) return;
      if (multi) {
        // โหมดเลือกหลายบรรทัด: แตะตรงไหนของบรรทัดก็ได้ = เลือก/ไม่เลือก
        if (e.target.classList.contains('sub-line-ck')) e.preventDefault();
        togglePick(cues[i]);
        return;
      }
      if (e.target.closest('[data-line-look]')) { select(i, true); peekCue(cues[i]); openSheet([cues[i]]); return; }
      if (!e.target.closest('[data-line-seek]')) return;
      select(i, true); seek(cues[i].start + 0.01);
    });
  }

  // ---------- แท็บ แก้คำ / หน้าตาซับ ----------
  $$('[data-sub-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-sub-tab');
      $$('[data-sub-tab]').forEach(function (x) { var on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
      $$('[data-sub-editor] [data-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== k; });
      if (k === 'words') { tlSize(); drawWave(); }
    });
  });
  function openEdit(i) {
    if (disabled || !cues[i]) return;
    closeEdit();
    select(i);
    var c = cues[i], b = tlCues.children[i];
    if (!b) return;
    if (video.paused && findCue(video.currentTime || 0) !== i) seek(c.start + Math.min(0.6, (c.end - c.start) / 2));
    edI = i; edOld = c.text; edSnap = false;
    edIn = document.createElement('input');
    edIn.type = 'text'; edIn.className = 'sub-tl-input'; edIn.maxLength = 120; edIn.value = c.text;
    edIn.setAttribute('enterkeyhint', 'done'); edIn.setAttribute('aria-label', 'แก้ข้อความซับบรรทัดนี้'); edIn.placeholder = 'พิมพ์ข้อความซับ';
    var w = Math.max(b.offsetWidth, Math.min(300, tlScroll.clientWidth - 16));
    var left = Math.max(0, Math.min(b.offsetLeft, track.offsetWidth - w));
    edIn.style.left = left + 'px'; edIn.style.width = w + 'px';
    b.classList.add('editing');
    tlCues.appendChild(edIn);
    if (left < tlScroll.scrollLeft || left + w > tlScroll.scrollLeft + tlScroll.clientWidth) tlScroll.scrollLeft = Math.max(0, left - 8);
    edIn.addEventListener('input', function () {
      if (!edSnap) { snap(); edSnap = true; }
      c.text = edIn.value.replace(/\s+/g, ' '); c.w = null;
      tlUpdate(i); dirty = true; draw(); changed();
    });
    edIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); closeEdit(); }
      if (e.key === 'Escape') { e.preventDefault(); if (edSnap) { c.text = edOld; c.w = null; changed(); } closeEdit(); }
    });
    var me = edIn;
    edIn.addEventListener('blur', function () { setTimeout(function () { if (edIn === me) closeEdit(); }, 0); });
    edIn.focus();
    try { edIn.setSelectionRange(edIn.value.length, edIn.value.length); } catch (err) { /* ข้าม */ }
  }
  function closeEdit(quiet) {
    if (!edIn) return;
    var n = edIn, i = edI;
    edIn = null; edI = -1;
    if (n.parentNode) n.parentNode.removeChild(n);
    $$('.sub-tl-cue.editing', tlCues).forEach(function (b) { b.classList.remove('editing'); });
    if (quiet) return;
    var c = cues[i];
    if (c) c.text = c.text.trim();
    if (c && !c.text) { cues.splice(i, 1); sel = -1; renderList(); changed(); return; } // บรรทัดว่าง = ลบทิ้ง
    if (c) { tlUpdate(i); dirty = true; draw(); }
  }
  addBtn.addEventListener('click', function () {
    var t = Math.round((video.currentTime || 0) * 10) / 10;
    var i = 0;
    while (i < cues.length && cues[i].start <= t) i++;
    var nextStart = i < cues.length ? cues[i].start : D.duration;
    if (i > 0 && cues[i - 1].end > t) {
      if (t - cues[i - 1].start < 0.6) { setErr('ตรงนี้มีซับอยู่แล้ว เลื่อนเส้นเวลาไปช่วงที่ว่าง แล้วกด + เพิ่ม อีกครั้ง'); return; }
      snap();
      cues[i - 1].end = Math.max(cues[i - 1].start + 0.3, t);
    } else snap();
    var end = Math.min(nextStart, t + 2, D.duration);
    if (end - t < 0.3) { hist.stack.pop(); setErr('ตรงนี้มีซับอยู่แล้ว เลื่อนเส้นเวลาไปช่วงที่ว่าง แล้วกด + เพิ่ม อีกครั้ง'); return; }
    setErr('');
    cues.splice(i, 0, { id: '', start: t, end: Math.round(end * 10) / 10, text: '', w: null, p: null });
    renderList();
    openEdit(i);
  });

  saveState.addEventListener('click', function (e) { if (e.target.closest('[data-undo]')) undo(); });

  // ---------- หน้าตา ----------
  function setColor(name, val) {
    style[name] = val.toLowerCase();
    var input = $('input[type="color"][name="' + name + '"]', look);
    if (input) input.value = val;
    $$('[data-swatch="' + name + '"]', look).forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-color') === style[name]); });
  }
  var sizeIn = $('[data-size]', look), sizeOut = $('[data-size-out]', look);
  function showSize() {
    sizeOut.textContent = style.size + '%';
    $$('[data-size-q]', look).forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-size-q') === String(style.size)); });
  }
  var fontPick = $('[data-font-pick]', look), fontCur = $('[data-font-cur]', look), fontList = $('[data-font-list]', look), fontName = $('[data-font-cur-name]', look);
  function showFont() {
    var f = fontOf();
    fontName.textContent = f.label;
    fontName.style.fontFamily = "'tt-" + f.id + "'"; fontName.style.fontWeight = f.weight || 700;
  }
  function fontOpen(on) {
    fontList.hidden = !on; fontCur.setAttribute('aria-expanded', on ? 'true' : 'false'); fontPick.classList.toggle('open', on);
    if (on) { var c = $('input:checked', fontList); if (c) c.closest('.font-opt').scrollIntoView({ block: 'nearest' }); }
  }
  fontCur.addEventListener('click', function () { fontOpen(fontList.hidden); });
  document.addEventListener('click', function (e) { if (!fontList.hidden && !fontPick.contains(e.target)) fontOpen(false); });
  fontList.addEventListener('keydown', function (e) { if (e.key === 'Escape') { fontOpen(false); fontCur.focus(); } });
  look.addEventListener('click', function (e) {
    var q = e.target.closest('[data-size-q]');
    if (q) { style.size = q.getAttribute('data-size-q'); sizeIn.value = style.size; showSize(); restyle(); changed(); return; }
    if (e.target.closest('.font-opt input')) setTimeout(function () { fontOpen(false); }, 120);
    var sw = e.target.closest('[data-swatch]');
    if (!sw) return;
    setColor(sw.getAttribute('data-swatch'), sw.getAttribute('data-color'));
    restyle(); changed();
  });
  look.addEventListener('input', function (e) {
    var t = e.target;
    if (t.name === 'fill' || t.name === 'stroke') setColor(t.name, t.value);
    else if (t.name === 'shadow') style.shadow = t.checked;
    else if (t.name === 'font') { style.font = t.value; showFont(); }
    else if (t.name === 'size') { style.size = String(t.value); showSize(); }
    else if (t.name === 'order') { switchMain(t.value); useAdd([(mainLook() || {}).slug]); renderList(); }
    else if (t.name === 'outline' || t.name === 'position') style[t.name] = t.value;
    else return;
    restyle(); changed();
  });

  // ---------- เปลี่ยนแบบหลัก: แบบเดิมที่บางบรรทัดเลือกไว้เองยังอยู่ที่ตำแหน่งเดิม ----------
  function syncPosRadios() {
    $$('input[name="position"]', look).forEach(function (r) { r.checked = r.value === style.position; });
  }
  function switchMain(orderId) {
    var old = mainLook(), nu = D.owned.filter(function (x) { return x.id === orderId; })[0];
    if (!nu) return;
    if (old && old.slug !== nu.slug) {
      if (cues.some(function (c) { return c.p === old.slug; })) style.looks[old.slug] = style.position;
      if (style.looks[nu.slug]) { style.position = style.looks[nu.slug]; syncPosRadios(); }
      delete style.looks[nu.slug];
    }
    style.order = orderId;
    measure();
  }

  // ---------- แบบของแต่ละบรรทัด: เลือกทีละบรรทัด หรือหลายบรรทัดพร้อมกัน ----------
  var multi = false, multiSel = [];
  var multiBtn = $('[data-multi]'), multiBar = $('[data-multi-bar]');
  function multiRefresh() {
    multiSel = multiSel.filter(function (c) { return cues.indexOf(c) >= 0; });
    if (!multiBar) return;
    multiBar.hidden = !multi;
    $('[data-multi-n]', multiBar).textContent = 'เลือก ' + multiSel.length + ' บรรทัด';
    $('[data-multi-look]', multiBar).disabled = !multiSel.length;
    $('[data-multi-all]', multiBar).textContent = multiSel.length === cues.length && cues.length ? 'ไม่เลือก' : 'ทั้งหมด';
    if (multiBtn) { multiBtn.setAttribute('aria-pressed', multi ? 'true' : 'false'); multiBtn.hidden = multi; }
  }
  function setMulti(on, first) {
    if (disabled) return;
    multi = Boolean(on) && cues.length > 0;
    multiSel = multi && first ? [first] : [];
    if (multi) { closeEdit(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
    renderList();
  }
  function togglePick(c) {
    var k = multiSel.indexOf(c);
    if (k >= 0) multiSel.splice(k, 1); else multiSel.push(c);
    var i = cues.indexOf(c);
    if (i >= 0) { lineUpdate(i); tlUpdate(i); }
    multiRefresh();
  }
  if (multiBtn) multiBtn.addEventListener('click', function () { setMulti(true); });
  if (multiBar) multiBar.addEventListener('click', function (e) {
    if (e.target.closest('[data-multi-done]')) { setMulti(false); return; }
    if (e.target.closest('[data-multi-all]')) {
      multiSel = multiSel.length === cues.length ? [] : cues.slice();
      cues.forEach(function (c, i) { lineUpdate(i); tlUpdate(i); });
      multiRefresh(); return;
    }
    if (e.target.closest('[data-multi-look]') && multiSel.length) openSheet(multiSel.slice());
  });

  // ไปที่บรรทัดนั้นตอนแสดงเต็ม ให้เห็นแบบบนคลิปทันที
  function peekCue(c) {
    if (!c) return;
    if (!video.paused) video.pause();
    var T = timingOf(c);
    seek(Math.max(c.start, Math.min(c.start + T.tm.settle + 0.2, c.end - 0.05)));
  }

  var sheet = $('[data-look-sheet]'), sheetBody = $('[data-look-body]'), sheetH = $('[data-look-h]');
  var sheetFor = [], sheetBack = null;
  function lookCard(o, on, extra) {
    return '<button type="button" class="look-card' + (on ? ' on' : '') + '" data-look-pick="' + o.slug + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<img src="/previews/' + encodeURIComponent(o.slug) + '_vertical.jpg" alt="" loading="lazy" width="54" height="96"><span></span>' + (extra || '') + '</button>';
  }
  function openSheet(list) {
    if (disabled || !sheet || !list.length) return;
    sheetFor = list;
    var m = mainLook();
    var same = list.every(function (c) { return (c.p || null) === (list[0].p || null); }) ? (list[0].p || null) : undefined;
    var allMain = list.every(function (c) { return !c.p; });
    sheetH.textContent = list.length > 1 ? 'แบบของ ' + list.length + ' บรรทัด' : 'แบบของบรรทัดนี้';
    var slugs = D.owned.map(function (o) { return o.slug; });
    var top = topUsed(slugs, 4);
    var html = '<button type="button" class="look-main' + (allMain ? ' on' : '') + '" data-look-pick="" aria-pressed="' + (allMain ? 'true' : 'false') + '"><b>ใช้แบบหลัก</b><span class="muted small"></span></button>';
    if (top.length) html += '<p class="look-h">ใช้บ่อย</p><div class="look-grid">' + top.map(function (k) { return lookCard(bySlug[k], same === k); }).join('') + '</div>';
    html += '<p class="look-h">' + (top.length ? 'ทั้งหมด' : 'เลือกแบบ') + '</p><div class="look-grid">' + D.owned.map(function (o) { return lookCard(o, same === o.slug); }).join('') + '</div>';
    if (list.length === 1 && cues.length > 1) html += '<button type="button" class="linklike look-more" data-look-multi>ใช้กับหลายบรรทัด…</button>';
    sheetBody.innerHTML = html;
    // ชื่อแบบใส่เป็นข้อความ (ไม่ผ่าน innerHTML)
    $$('.look-card', sheetBody).forEach(function (b) {
      $('span', b).textContent = bySlug[b.getAttribute('data-look-pick')].title;
      var im = $('img', b), done = function () { im.classList.add('loaded'); }; // รูป lazy ของหน้า ต้องมี .loaded ถึงจะแสดง
      if (im.complete) done(); else { im.addEventListener('load', done); im.addEventListener('error', done); }
    });
    $('.look-main .muted', sheetBody).textContent = m ? m.title : '';
    sheetBack = document.activeElement;
    sheet.hidden = false;
    document.documentElement.classList.add('look-open');
    var f = $('.look-card.on, .look-main.on', sheetBody) || $('.look-main', sheetBody);
    if (f) f.focus({ preventScroll: true });
    if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
  }
  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    document.documentElement.classList.remove('look-open');
    sheetFor = [];
    if (sheetBack && sheetBack.focus && document.contains(sheetBack)) sheetBack.focus({ preventScroll: true });
  }
  function applyLook(slug) {
    var list = sheetFor.filter(function (c) { return cues.indexOf(c) >= 0; });
    if (!list.length) { closeSheet(); return; }
    var p = slug && bySlug[slug] ? slug : null;
    // จำกัดจำนวนแบบต่อคลิป (ร้านตรวจซ้ำอีกชั้น)
    var after = looksUsed(cues.map(function (c) { return list.indexOf(c) >= 0 ? { p: p } : c; }));
    if (after.length > MAX_LOOKS) { setErr('ใช้แบบต่างกันได้ไม่เกิน ' + MAX_LOOKS + ' แบบในคลิปเดียว'); closeSheet(); return; }
    setErr('');
    if (list.some(function (c) { return (c.p || null) !== p; })) {
      snap();
      list.forEach(function (c) { c.p = p; });
      if (p) useAdd([p]);
      changed();
    }
    closeSheet();
    var one = list.length === 1 ? list[0] : null;
    if (multi) setMulti(false); else renderList();
    var o = p ? bySlug[p] : mainLook();
    saveState.textContent = (list.length > 1 ? list.length + ' บรรทัด' : 'บรรทัดนี้') + ' ใช้แบบ "' + (o ? o.title : '') + '"';
    var target = one || list[0];
    var ti = cues.indexOf(target);
    if (ti >= 0) { select(ti, true); peekCue(target); }
  }
  if (sheet) {
    sheet.addEventListener('click', function (e) {
      if (e.target === sheet || e.target.closest('[data-look-close]')) { closeSheet(); return; }
      if (e.target.closest('[data-look-multi]')) { var c = sheetFor[0]; closeSheet(); setMulti(true, c); return; }
      var b = e.target.closest('[data-look-pick]');
      if (b) applyLook(b.getAttribute('data-look-pick'));
    });
    sheet.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSheet(); return; }
      if (e.key !== 'Tab') return;
      // วนโฟกัสอยู่ในกล่อง
      var f = $$('button', sheet).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      var a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    });
  }
  // แบบหลักในแท็บหน้าตาซับ: ใช้บ่อยขึ้นก่อน
  frontUsed($('[data-main-chips]'), '.sub-chip');

  // ---------- บันทึกอัตโนมัติ / สร้างคลิป ----------
  var saveTimer = 0, saving = null, pending = false;
  function setErr(t) { errEl.textContent = t || ''; errEl.hidden = !t; }
  function changed() { pending = true; saveState.textContent = 'มีการแก้ไข…'; clearTimeout(saveTimer); saveTimer = setTimeout(save, 900); }
  function payload() { return { style: style, cues: cues.map(function (c) { var o = { id: c.id, start: c.start, end: c.end, text: c.text }; if (c.p) o.p = c.p; return o; }) }; }
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
          document.dispatchEvent(new CustomEvent('aw:render-subtitles', { detail: { spec: res.j.spec, csrf: D.csrf, done: function (r) { saveState.textContent = r ? 'สร้างคลิปเสร็จแล้ว ดาวน์โหลดได้ด้านล่าง' : 'บันทึกซับแล้ว แต่ยังสร้างคลิปไม่สำเร็จ (ดูข้อความด้านล่าง)'; ok(r ? 'browser' : 'browser-failed'); } } }));
        });
      }
      if (render && D.browser) { setErr('ร้านไม่ได้ส่งข้อมูลสำหรับสร้างคลิปกลับมา รีเฟรชหน้าแล้วกดอีกครั้ง'); return false; }
      if (render) return true;
      // รับเวลาคำที่ร้านคำนวณ (ถ้าระหว่างนั้นไม่ได้แก้เพิ่ม)
      if (!pending && sentFor.length === cues.length && res.j.cues) {
        var same = res.j.cues.length === cues.length && res.j.cues.every(function (s, i) { return s.text === cues[i].text.trim(); });
        if (same) res.j.cues.forEach(function (s, i) { cues[i].id = s.id; cues[i].w = s.w; cues[i].start = s.start; cues[i].end = s.end; });
        else if (!edIn && !typingLine()) { cues = res.j.cues.map(function (c) { return { id: c.id, start: c.start, end: c.end, text: c.text, w: c.w, p: cleanP(c.p) }; }); multiSel = []; renderList(); }
      }
      if (!pending) saveState.textContent = 'บันทึกแล้ว';
      dirty = true; draw();
      return true;
    }).catch(function () {
      saving = null;
      if (render) { setErr('ส่งข้อมูลไม่สำเร็จ (เน็ตหลุดหรือร้านกำลังตื่น) รอสักครู่แล้วกด "สร้างคลิปพร้อมซับ" อีกครั้ง'); saveState.textContent = 'ยังไม่ได้บันทึก'; return false; }
      saveState.textContent = 'ยังไม่ได้บันทึก (เน็ตหลุด) จะลองใหม่'; saveTimer = setTimeout(save, 4000); return false;
    });
    return saving;
  }
  // ข้อผิดพลาดที่ไม่ได้ดักไว้ระหว่างสร้างคลิป: บอกลูกค้าแทนการเงียบ
  addEventListener('unhandledrejection', function (e) {
    if (!renderBtn.classList.contains('loading')) return;
    var m = e.reason && e.reason.message ? e.reason.message : String(e.reason || '');
    setErr('สร้างคลิปไม่สำเร็จ: ' + (m || 'ไม่ทราบสาเหตุ') + ' ลองกดอีกครั้ง หรือเปิดด้วย Chrome รุ่นใหม่');
  });
  renderBtn.addEventListener('click', function () {
    closeEdit();
    if (!cues.length) { setErr('ยังไม่มีซับ เลื่อนเส้นเวลาไปจุดที่มีคนพูด แล้วกด "+ เพิ่ม" เพื่อพิมพ์ซับก่อน'); return; }
    useAdd(looksUsed());
    // โหมดเบราว์เซอร์: ตัวสร้างคลิป (render-ui.js) ต้องโหลดเสร็จก่อน ไม่งั้นกดแล้วจะเงียบ
    if (D.browser && !window.AWRenderReady) { setErr('ตัวสร้างคลิปยังโหลดไม่เสร็จ รอ 2–3 วินาทีแล้วกดอีกครั้ง (ถ้ายังไม่ได้ ให้รีเฟรชหน้า หรือเปิดด้วย Chrome / Safari รุ่นใหม่)'); return; }
    setErr('');
    renderBtn.classList.add('loading'); renderBtn.disabled = true;
    save(true).then(function (ok) {
      if (D.browser) { renderBtn.classList.remove('loading'); renderBtn.disabled = false; return; } // โหมดเบราว์เซอร์: ไม่รีโหลดหน้า ผลอยู่ในกล่องด้านล่าง
      if (ok) { try { sessionStorage.setItem('noIntroOnce', '1'); } catch (e) { /* ข้าม */ } location.reload(); return; }
      renderBtn.classList.remove('loading'); renderBtn.disabled = false;
    });
  });

  renderList();
  showSize(); showFont();
  restyle();
  measure();
  draw();
})();

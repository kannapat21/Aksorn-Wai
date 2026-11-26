// สคริปต์ของหน้าร้าน (ไม่มี inline script เพื่อให้ CSP เข้มงวดได้)
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ข้าม */ } },
  };

  // ---------- หน้าโหลดตอนเปิดเว็บ (แสดงครั้งเดียวต่อการเข้าชม กดข้ามได้) ----------
  var loader = document.querySelector('[data-loader]');
  var hasIntro = root.classList.contains('intro') && loader;
  var onReady = [];
  function markReady() {
    if (root.classList.contains('ready')) return;
    root.classList.add('ready');
    onReady.forEach(function (fn) { fn(); });
  }
  if (hasIntro) {
    var started = Date.now();
    var finished = false;
    var finish = function () {
      if (finished) return;
      finished = true;
      loader.classList.add('done');
      setTimeout(markReady, 120);
      setTimeout(function () { loader.remove(); }, 1100);
    };
    var minShow = root.classList.contains('calm') ? 500 : 1900;
    var whenLoaded = function () { setTimeout(finish, Math.max(0, minShow - (Date.now() - started))); };
    if (document.readyState === 'complete') whenLoaded(); else addEventListener('load', whenLoaded);
    setTimeout(finish, 3400); // ช้าแค่ไหนก็ไม่ให้รอเกินนี้
    loader.addEventListener('click', finish);
    document.addEventListener('keydown', function (e) { if (!finished && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) finish(); });
  } else {
    if (loader) loader.remove();
    setTimeout(markReady, 0); // รอให้ส่วนอื่นลงทะเบียน onReady ก่อน
  }

  // ---------- หัวข้อใหญ่แบบพิมพ์ทีละตัว (ตัดตามกลุ่มอักษรไทย สระ/วรรณยุกต์ไม่แยกจากพยัญชนะ) ----------
  function graphemes(str) {
    if (window.Intl && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(str), function (x) { return x.segment; });
    }
    // สำรอง: รวมสระบน/ล่างและวรรณยุกต์ (U+0E31, U+0E34–0E3A, U+0E47–0E4E) เข้ากับตัวหน้า
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str[i];
      if (out.length && /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(c)) out[out.length - 1] += c; else out.push(c);
    }
    return out;
  }
  var typeStatic = document.querySelector('[data-type-static]');
  var typeRot = document.querySelector('[data-type-rotate]');
  if (typeStatic && typeRot && !reduceMotion) {
    var h1 = typeRot.closest('h1');
    var phrases = [];
    try { phrases = JSON.parse(typeRot.getAttribute('data-type-rotate')); } catch (e) { phrases = [typeRot.textContent]; }
    var first = graphemes(typeStatic.textContent);
    // จองความสูงไว้ กันหน้ากระโดดระหว่างพิมพ์
    h1.style.minHeight = h1.offsetHeight + 'px';
    typeStatic.textContent = '';
    typeRot.textContent = '';
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var typeInto = async function (el, parts, speed) {
      h1.classList.add('typing');
      for (var i = 0; i < parts.length; i++) {
        el.textContent += parts[i];
        await sleep(speed + Math.random() * speed * 0.6);
      }
      h1.classList.remove('typing');
    };
    var erase = async function (el) {
      h1.classList.add('typing');
      var parts = graphemes(el.textContent);
      while (parts.length) { parts.pop(); el.textContent = parts.join(''); await sleep(28); }
      h1.classList.remove('typing');
    };
    onReady.push(async function () {
      await sleep(250);
      await typeInto(typeStatic, first, 45);
      var idx = 0;
      for (;;) {
        await typeInto(typeRot, graphemes(phrases[idx]), 55);
        h1.setAttribute('aria-label', typeStatic.textContent + ' ' + phrases[idx]);
        await sleep(2400);
        if (phrases.length < 2) break;
        await erase(typeRot);
        await sleep(250);
        idx = (idx + 1) % phrases.length;
      }
    });
  }

  // ---------- ปุ่ม: คลื่นตอนกด ----------
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest('.btn');
    if (!b || reduceMotion) return;
    var r = b.getBoundingClientRect();
    var d = Math.max(r.width, r.height);
    var s = document.createElement('span');
    s.className = 'ripple';
    s.style.cssText = 'width:' + d + 'px;height:' + d + 'px;left:' + (e.clientX - r.left - d / 2) + 'px;top:' + (e.clientY - r.top - d / 2) + 'px';
    b.appendChild(s);
    setTimeout(function () { s.remove(); }, 650);
  });
  // ส่งฟอร์มสั่งซื้อ: ปุ่มแสดงสถานะกำลังโหลด กันกดซ้ำ
  document.querySelectorAll('form').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      var b = f.querySelector('button[type=submit]');
      // รอให้ตัวจัดการอื่น (เช่น กล่องถามยืนยัน) ทำงานก่อน ถ้ากด "ยกเลิก" ไม่ต้องหมุนค้าง
      if (b && f.method.toLowerCase() === 'post') setTimeout(function () { if (!e.defaultPrevented) b.classList.add('loading'); }, 0);
    });
  });
  // เมื่อกดย้อนกลับมา (bfcache) ให้ปุ่มกลับมาใช้ได้
  addEventListener('pageshow', function () { document.querySelectorAll('.btn.loading').forEach(function (b) { b.classList.remove('loading'); }); });

  // ---------- หน้าต่างตัวอย่างในหน้าแรก: เอียงตามเมาส์ ----------
  var tilt = document.querySelector('[data-tilt]');
  if (tilt && !reduceMotion && window.matchMedia && matchMedia('(hover: hover)').matches) {
    var win = tilt.querySelector('.window');
    tilt.addEventListener('mousemove', function (e) {
      var r = tilt.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      win.style.setProperty('--ry', (x * 10).toFixed(2) + 'deg');
      win.style.setProperty('--rx', (-y * 8).toFixed(2) + 'deg');
    });
    tilt.addEventListener('mouseleave', function () { win.style.removeProperty('--ry'); win.style.removeProperty('--rx'); });
  }

  // ---------- แอป (PWA): ลงทะเบียน service worker (ต้องเป็น https หรือ localhost) ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
  if (window.matchMedia && matchMedia('(display-mode: standalone)').matches) root.classList.add('standalone');

  // ---------- แถบเมนูล่าง: ไฮไลต์แท็บของหน้าปัจจุบัน ----------
  var tabbar = document.querySelector('[data-tabbar]');
  if (tabbar) {
    var p = location.pathname;
    var tab = p === '/' ? (location.hash === '#catalog' ? 'shop' : 'home') : /^\/(p\/|premium)/.test(p) ? 'shop' : /^\/subtitles/.test(p) ? 'subs' : /^\/library/.test(p) ? 'library' : /^\/(account|login|signup|forgot|reset|admin)/.test(p) ? 'account' : '';
    var setTab = function (t) { tabbar.querySelectorAll('[data-tab]').forEach(function (a) { var on = a.getAttribute('data-tab') === t; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); };
    setTab(tab);
    addEventListener('hashchange', function () { if (location.pathname === '/') setTab(location.hash === '#catalog' ? 'shop' : 'home'); });
  }

  // ---------- รูปค่อยๆ ขึ้นแทนโครงร่าง (skeleton) ----------
  document.querySelectorAll('img[loading="lazy"], .lib-thumb img, .lib-item-head img').forEach(function (img) {
    var done = function () { img.classList.add('loaded'); };
    if (img.complete && img.naturalWidth) done(); else img.addEventListener('load', done);
  });

  // ---------- แสดง/ซ่อนรหัสผ่าน ----------
  document.querySelectorAll('[data-pw-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var i = b.parentNode.querySelector('input');
      var show = i.type === 'password';
      i.type = show ? 'text' : 'password';
      b.textContent = show ? 'ซ่อน' : 'แสดง';
      b.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
    });
  });
  // ปิดเมนูบัญชีเมื่อคลิกที่อื่น
  document.addEventListener('click', function (e) {
    document.querySelectorAll('details.menu[open]').forEach(function (d) { if (!d.contains(e.target)) d.open = false; });
  });

  // ---------- สลับโหมดสว่าง/มืด ----------
  var themeBtn = document.querySelector('[data-theme-toggle]');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = root.getAttribute('data-theme') ||
        (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var next = cur === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      store.set('theme', next);
    });
  }

  // ---------- แถบความคืบหน้า, เงาแถบบน, ปุ่มกลับขึ้นบน, แถบซื้อบนมือถือ ----------
  var bar = document.querySelector('[data-progress]');
  var top = document.querySelector('[data-top]');
  var toTop = document.querySelector('[data-to-top]');
  var toolbar = document.querySelector('[data-toolbar]');
  var buyBar = document.querySelector('[data-buy-bar]');
  var buyBox = document.getElementById('buy');
  if (toTop) toTop.hidden = false;
  var ticking = false;
  function onScroll() {
    ticking = false;
    var y = window.scrollY;
    var h = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, y / h) : 0) + ')';
    if (top) top.classList.toggle('scrolled', y > 4);
    if (toTop) toTop.classList.toggle('show', y > 600);
    if (toolbar) toolbar.classList.toggle('stuck', toolbar.getBoundingClientRect().top <= (top ? top.offsetHeight : 0) + 1);
    if (buyBar && buyBox) {
      var r = buyBox.getBoundingClientRect();
      buyBar.classList.toggle('show', r.bottom < 0 || r.top > innerHeight);
    }
  }
  addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();
  if (toTop) toTop.addEventListener('click', function () { scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); });

  // ---------- ค่อยๆ ปรากฏตอนเลื่อน ----------
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en, i) {
        if (!en.isIntersecting) return;
        var el = en.target;
        setTimeout(function () { el.classList.add('in'); }, Math.min(i, 6) * 60);
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -6% 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  // ---------- การ์ด: ชี้แล้วเล่นตัวอย่าง (โหลดวิดีโอเมื่อจำเป็นเท่านั้น) ----------
  var canHover = window.matchMedia && matchMedia('(hover: hover)').matches;
  document.querySelectorAll('[data-hover-play]').forEach(function (thumb) {
    var v = thumb.querySelector('video');
    if (!v) return;
    function play() {
      if (!v.src) v.src = v.getAttribute('data-src');
      var p = v.play();
      if (p && p.then) p.then(function () { thumb.classList.add('playing'); }).catch(function () {});
    }
    function stop() { thumb.classList.remove('playing'); v.pause(); }
    if (canHover) {
      var card = thumb.closest('.card') || thumb;
      card.addEventListener('mouseenter', play);
      card.addEventListener('mouseleave', stop);
      card.addEventListener('focusin', play);
      card.addEventListener('focusout', stop);
    } else if ('IntersectionObserver' in window && !reduceMotion) {
      // มือถือ: เล่นเองเมื่อการ์ดอยู่กลางจอ
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) play(); else stop(); });
      }, { threshold: 0.75 }).observe(thumb);
    }
  });

  // ---------- ค้นหา / กรองหมวด / เรียง / มุมมอง ----------
  var grid = document.querySelector('[data-grid]');
  if (grid) {
    var cards = Array.prototype.slice.call(grid.querySelectorAll('[data-card]'));
    var input = document.querySelector('[data-search]');
    var sortSel = document.querySelector('[data-sort]');
    var empty = document.querySelector('[data-empty]');
    var countLabel = document.querySelector('[data-count-label]');
    var catBtns = document.querySelectorAll('[data-cat-btn]');
    var state = { q: '', cat: '' };

    var apply = function () {
      var q = state.q.trim().toLowerCase();
      var terms = q ? q.split(/\s+/) : [];
      var shown = 0;
      cards.forEach(function (c) {
        var hay = c.getAttribute('data-search');
        var ok = (!state.cat || c.getAttribute('data-cat') === state.cat) &&
          terms.every(function (t) { return hay.indexOf(t) !== -1; });
        c.hidden = !ok;
        if (ok) { shown++; c.classList.add('in'); }
      });
      if (empty) empty.hidden = shown !== 0;
      if (countLabel) countLabel.textContent = shown + ' แบบ' + (shown !== cards.length ? ' จาก ' + cards.length : '');
    };
    var sortCards = function () {
      var mode = sortSel ? sortSel.value : 'order';
      var key = function (c) { return Number(c.getAttribute(mode === 'order' ? 'data-order' : 'data-price')); };
      cards.slice().sort(function (a, b) { return mode === 'price-desc' ? key(b) - key(a) : key(a) - key(b); })
        .forEach(function (c) { grid.appendChild(c); });
    };

    var timer;
    if (input) {
      input.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () { state.q = input.value; apply(); }, 120);
      });
      document.addEventListener('keydown', function (e) {
        var tag = (document.activeElement && document.activeElement.tagName) || '';
        if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag)) { e.preventDefault(); input.focus(); }
        if (e.key === 'Escape' && document.activeElement === input) { input.value = ''; state.q = ''; apply(); input.blur(); }
      });
    }
    catBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        state.cat = b.getAttribute('data-cat-btn');
        catBtns.forEach(function (x) { x.classList.toggle('active', x === b); });
        apply();
      });
    });
    if (sortSel) sortSel.addEventListener('change', sortCards);

    var viewBtns = document.querySelectorAll('[data-view]');
    var setView = function (v) {
      grid.classList.toggle('list', v === 'list');
      viewBtns.forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-view') === v); });
    };
    viewBtns.forEach(function (b) {
      b.addEventListener('click', function () { var v = b.getAttribute('data-view'); setView(v); store.set('view', v); });
    });
    if (store.get('view') === 'list') setView('list');

    // ปุ่ม "ลองแบบฟรี" ในหน้าแรก: เลื่อนลงมาแล้วกรองเฉพาะแบบฟรี
    document.querySelectorAll('[data-pick]').forEach(function (a) {
      a.addEventListener('click', function () {
        var want = a.getAttribute('data-pick');
        catBtns.forEach(function (x) { if (x.getAttribute('data-cat-btn') === want) x.click(); });
      });
    });

    var reset = document.querySelector('[data-reset]');
    if (reset) reset.addEventListener('click', function () {
      state.q = ''; state.cat = '';
      if (input) input.value = '';
      catBtns.forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-cat-btn') === ''); });
      apply();
    });
  }

  // ---------- หน้าสินค้า: สลับพรีวิวแนวนอน/แนวตั้ง ----------
  document.querySelectorAll('[data-tabs]').forEach(function (tabs) {
    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-show]');
      if (!btn) return;
      tabs.querySelectorAll('.tab').forEach(function (t) {
        t.classList.toggle('active', t === btn);
        t.setAttribute('aria-selected', t === btn ? 'true' : 'false');
      });
      document.querySelectorAll('[data-pane]').forEach(function (v) {
        var show = v.getAttribute('data-pane') === btn.getAttribute('data-show');
        v.hidden = !show;
        if (show) { v.play && v.play().catch(function () {}); } else { v.pause && v.pause(); }
      });
    });
  });

  // ---------- หน้าสร้างไฟล์ที่ปรับแต่ง: อัปเดตแถบความคืบหน้า ----------
  var job = document.querySelector('[data-job-poll]');
  if (job) {
    var jurl = job.getAttribute('data-job-poll');
    var jbar = job.querySelector('[data-job-bar]'), jpct = job.querySelector('[data-job-pct]'), jstage = job.querySelector('[data-job-stage]');
    var jtick = function () {
      fetch(jurl, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.status === 'done' || j.status === 'failed') return location.reload();
        jbar.style.width = j.progress + '%';
        jpct.textContent = j.progress + '%';
        jstage.textContent = j.status === 'queued' ? 'รอคิว (ลำดับที่ ' + j.position + ')' : (j.stage || 'กำลังสร้าง');
        setTimeout(jtick, 1500);
      }).catch(function () { setTimeout(jtick, 4000); });
    };
    setTimeout(jtick, 1200);
  }

  // ---------- อัปโหลดฟอนต์ของฉัน ----------
  var up = document.querySelector('[data-font-upload]');
  if (up) {
    var fileIn = up.querySelector('[data-font-file]'), rights = up.querySelector('[data-font-rights]');
    var sendBtn = up.querySelector('[data-font-send]'), msg = up.querySelector('[data-font-msg]'), drop = up.querySelector('[data-drop]');
    var picked = null;
    var refresh = function () {
      sendBtn.disabled = !(picked && rights.checked);
      drop.classList.toggle('has-file', Boolean(picked));
      if (picked) drop.querySelector('b').textContent = picked.name;
    };
    var pick = function (f) {
      msg.textContent = ''; msg.className = 'small';
      if (!f) { picked = null; return refresh(); }
      if (!/\.(ttf|otf|woff2?)$/i.test(f.name)) { picked = null; msg.textContent = 'รองรับเฉพาะ .ttf .otf .woff .woff2'; msg.className = 'small error'; return refresh(); }
      if (f.size > 5 * 1024 * 1024) { picked = null; msg.textContent = 'ไฟล์ใหญ่เกิน 5 MB'; msg.className = 'small error'; return refresh(); }
      picked = f; refresh();
    };
    fileIn.addEventListener('change', function () { pick(fileIn.files[0]); });
    rights.addEventListener('change', refresh);
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { pick(e.dataTransfer.files[0]); });
    sendBtn.addEventListener('click', function () {
      if (!picked) return;
      sendBtn.classList.add('loading');
      picked.arrayBuffer().then(function (buf) {
        return fetch('/library/fonts', {
          method: 'POST', body: buf, credentials: 'same-origin',
          headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': sendBtn.getAttribute('data-csrf'), 'x-font-rights': 'yes' },
        });
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (res) {
        sendBtn.classList.remove('loading');
        if (!res.ok) { msg.textContent = res.j.error || 'อัปโหลดไม่สำเร็จ'; msg.className = 'small error'; return; }
        msg.className = 'small ok';
        msg.textContent = 'อัปโหลด "' + res.j.name + '" แล้ว' + (res.j.thai === 'full' ? '' : res.j.thai === 'partial' ? ' · ฟอนต์นี้มีอักษรไทยไม่ครบ' : ' · ฟอนต์นี้ไม่มีอักษรไทย ใช้ได้กับข้อความภาษาอังกฤษเท่านั้น');
        // พาไปหน้าปรับแต่งพร้อมเลือกฟอนต์นี้ให้เลย (ถ้ามีแอนิเมชันในคลัง)
        setTimeout(function () { location.href = res.j.customizeUrl || location.href; }, 1200);
      }).catch(function () { sendBtn.classList.remove('loading'); msg.textContent = 'อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง'; msg.className = 'small error'; });
    });
  }

  // ---------- หน้ารอยืนยันการชำระเงิน: ถามสถานะทุก 2 วินาที ----------
  var poll = document.querySelector('[data-poll]');
  if (poll) {
    var url = poll.getAttribute('data-poll');
    var tick = function () {
      fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.status && j.status !== (poll.getAttribute('data-poll-status') || 'pending')) { try { sessionStorage.setItem('noIntroOnce', '1'); } catch (e) { /* ข้าม */ } location.reload(); } // จ่ายแล้ว / ไม่สำเร็จ / หมดอายุ / ร้านตัดสินแล้ว
        else setTimeout(tick, 2000);
      }).catch(function () { setTimeout(tick, 4000); });
    };
    setTimeout(tick, 1500);
  }

  // ---------- กล่องถามยืนยันของร้านเอง (แทนป๊อปอัปยืนยันของเบราว์เซอร์) ----------
  // AW.confirm({ title, text, ok, cancel, danger }) → Promise<boolean>
  var AW = window.AW = window.AW || {};
  AW.confirm = function (o) {
    o = o || {};
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      var wrap = document.createElement('div');
      wrap.className = 'aw-modal';
      wrap.innerHTML = '<div class="aw-modal-bg" data-close></div>' +
        '<div class="aw-modal-card" role="alertdialog" aria-modal="true" aria-labelledby="aw-m-t" aria-describedby="aw-m-d">' +
        '<div class="aw-modal-icon' + (o.danger ? ' danger' : '') + '" aria-hidden="true">' + (o.danger
          ? '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>'
          : '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>') + '</div>' +
        '<h2 id="aw-m-t"></h2><p id="aw-m-d"></p>' +
        '<div class="aw-modal-actions"><button type="button" class="btn lg" data-close></button>' +
        '<button type="button" class="btn lg ' + (o.danger ? 'danger' : 'primary') + '" data-ok></button></div></div>';
      wrap.querySelector('h2').textContent = o.title || 'ยืนยันใช่ไหม?';
      var d = wrap.querySelector('#aw-m-d');
      if (o.text) d.textContent = o.text; else d.remove();
      var okBtn = wrap.querySelector('[data-ok]');
      okBtn.textContent = o.ok || 'ยืนยัน';
      wrap.querySelector('button[data-close]').textContent = o.cancel || 'ยกเลิก';
      document.body.appendChild(wrap);
      root.classList.add('aw-modal-open');
      requestAnimationFrame(function () { wrap.classList.add('show'); });
      okBtn.focus();
      var done = function (val) {
        document.removeEventListener('keydown', onKey, true);
        wrap.classList.remove('show'); wrap.classList.add('hide');
        root.classList.remove('aw-modal-open');
        setTimeout(function () { wrap.remove(); }, reduceMotion ? 0 : 220);
        if (prevFocus && prevFocus.focus) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ข้าม */ } }
        resolve(val);
      };
      var onKey = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); done(false); }
        else if (e.key === 'Tab') { // วนโฟกัสอยู่ในกล่อง
          var f = wrap.querySelectorAll('button'), first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener('keydown', onKey, true);
      wrap.addEventListener('click', function (e) {
        if (e.target.closest('[data-ok]')) done(true);
        else if (e.target.closest('[data-close]')) done(false);
      });
    });
  };

  // ---------- ฟอร์มที่ต้องถามก่อนส่ง (เช่น แจ้งโอน อนุมัติการโอน ลบ) ----------
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (f.getAttribute('data-confirmed') === '1') { f.removeAttribute('data-confirmed'); return; }
      e.preventDefault();
      var btn = e.submitter || f.querySelector('button[type=submit]');
      AW.confirm({
        title: f.getAttribute('data-confirm-title') || f.getAttribute('data-confirm'),
        text: f.getAttribute('data-confirm-title') ? f.getAttribute('data-confirm') : '',
        ok: f.getAttribute('data-confirm-ok'), cancel: f.getAttribute('data-confirm-cancel'),
        danger: f.hasAttribute('data-confirm-danger'),
      }).then(function (yes) {
        if (!yes) return;
        f.setAttribute('data-confirmed', '1');
        if (f.requestSubmit) f.requestSubmit(btn && btn.form === f ? btn : undefined); else f.submit();
      });
    });
  });

  // ---------- ฉลองสำเร็จ: กระดาษสีเบาๆ (แจ้งโอนเสร็จ / ชำระเงินสำเร็จ) ----------
  var cel = document.querySelector('[data-celebrate]');
  if (cel) {
    var go = cel.getAttribute('data-celebrate') === 'always';
    if (!go) { // "once": เล่นเฉพาะตอนเพิ่งกดยืนยันมา ไม่เล่นซ้ำตอนรีเฟรช
      try { go = sessionStorage.getItem('justConfirmed') === cel.getAttribute('data-order'); sessionStorage.removeItem('justConfirmed'); } catch (e) { go = false; }
    }
    if (go) {
      cel.classList.add('celebrate');
      if (!root.classList.contains('calm')) {
        var box = document.createElement('div');
        box.className = 'confetti'; box.setAttribute('aria-hidden', 'true');
        var colors = ['var(--brand)', 'var(--accent)', 'var(--ok)', '#ff8fab', '#7cc4ff'];
        for (var ci = 0; ci < 26; ci++) {
          var piece = document.createElement('i');
          var ang = (Math.PI * 2 * ci) / 26 + Math.random() * 0.4;
          var dist = 90 + Math.random() * 110;
          piece.style.cssText = '--x:' + (Math.cos(ang) * dist).toFixed(0) + 'px;--y:' + (Math.sin(ang) * dist * 0.8 - 40).toFixed(0) + 'px;--r:' + (Math.random() * 540 - 270).toFixed(0) + 'deg;--d:' + (Math.random() * 0.15).toFixed(2) + 's;background:' + colors[ci % colors.length];
          box.appendChild(piece);
        }
        cel.appendChild(box);
        setTimeout(function () { box.remove(); }, 2200);
        if (navigator.vibrate) { try { navigator.vibrate(18); } catch (e) { /* ข้าม */ } }
      }
    }
  }

  // ---------- หน้าดาวน์โหลด: เปลี่ยนโปรแกรมแล้วโหลดหน้าใหม่ ----------
  document.querySelectorAll('[data-autosubmit]').forEach(function (el) {
    el.addEventListener('change', function () { el.form.submit(); });
  });
})();

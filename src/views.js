'use strict';
/* หน้าเว็บ (HTML ภาษาไทย) เขียนเป็นฟังก์ชันธรรมดา ไม่ใช้ template engine */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baht = (satang) => `฿${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const thDate = (ms) => new Date(ms).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
const fmtBytes = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`);

// เปลี่ยนทุกครั้งที่รีสตาร์ต เพื่อให้เบราว์เซอร์โหลด CSS/JS ใหม่หลังอัปเดต
const V = Date.now().toString(36);

// สิทธิ์การใช้งาน (แสดงในหน้าสินค้า หน้าดาวน์โหลด อีเมล และหน้า /license)
const LICENSE = {
  short: 'ซื้อครั้งเดียว ใช้ได้ตลอด ไม่มีวันหมดอายุ ใช้ในงานส่วนตัว งานลูกค้า และโฆษณาได้',
  points: [
    'ซื้อครั้งเดียว ใช้ได้ตลอดไป ไม่มีค่ารายเดือน และไม่มีวันหมดอายุ',
    'ใช้ในวิดีโอได้ไม่จำกัดจำนวนชิ้น ทั้งงานส่วนตัว งานลูกค้า งานรับจ้าง และโฆษณา',
    'คลิปที่ตัดต่อเสร็จแล้วเผยแพร่ได้ทุกแพลตฟอร์ม เช่น TikTok, Facebook, YouTube, Instagram และทีวี',
    'ไฟล์อยู่ในคลังของบัญชีคุณตลอดไป ทำไฟล์หายหรือเปลี่ยนเครื่อง เข้าสู่ระบบแล้วดาวน์โหลดใหม่ได้ทุกเมื่อ',
    'เปลี่ยนโปรแกรมตัดต่อได้ตลอด ระบบจะให้ไฟล์ที่ตรงกับโปรแกรมที่เลือก',
  ],
  not: [
    'ห้ามขายต่อ แจกต่อ หรือแชร์ไฟล์ต้นฉบับ (ไฟล์ MP4/MOV/PNG/WebM ที่ดาวน์โหลด)',
    'ห้ามนำไฟล์ไปรวมในชุดเทมเพลต แพ็กเอฟเฟกต์ หรือคลังสื่อเพื่อขายหรือแจก',
    'สิทธิ์เป็นของผู้ซื้อ (บุคคลหรือบริษัท) ที่สั่งซื้อเท่านั้น',
  ],
  font: 'ฟอนต์ Kanit ใช้สัญญา SIL Open Font License',
};

const ICON = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>',
  infinity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.2 8.2a4 4 0 1 1 0 7.6C15 15 9 9 5.8 8.2a4 4 0 1 0 0 7.6C9 15 15 9 18.2 8.2z"/></svg>',
  film: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  stretch: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  library: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="m17 5 4 1-3 14-4-1"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
};

// โลโก้: ตัว "อ" กับแถบ 3 ช่วง (ส่วนเข้า · ภาพนิ่ง · ส่วนออก) ไฟล์เดียวกับ public/logo.svg
function logoMark(size = 34, cls = 'logo-mark') {
  return `<svg class="${cls}" width="${size}" height="${size}" style="width:${size}px;height:${size}px" viewBox="0 0 64 64" aria-hidden="true">
  <rect width="64" height="64" rx="15" fill="#1E3A5F"/>
  <g fill="none" stroke="#FFD400" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round">
    <circle class="lm-head" cx="20.6" cy="21" r="4" pathLength="1"/>
    <path class="lm-body" pathLength="1" d="M16.6 21V33Q16.6 39 23 39H40.2Q46.4 39 46.4 33V23.4Q46.4 13.4 32.4 13.4Q27 13.4 25.2 15.8"/>
  </g>
  <rect class="lm-a" x="13" y="47" width="9" height="5" rx="2.5" fill="#FFE27A"/>
  <rect class="lm-b" x="24.5" y="47" width="16" height="5" rx="2.5" fill="#FFD400"/>
  <rect class="lm-c" x="43" y="47" width="8" height="5" rx="2.5" fill="#FFE9A3"/>
</svg>`;
}

// แยกชื่อเป็นกลุ่มอักษร (สระ/วรรณยุกต์ติดกับพยัญชนะ) ให้ค่อยๆ ลอยขึ้นทีละตัว
function letters(text) {
  const parts = Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(String(text)), (x) => x.segment);
  return parts.map((c, i) => `<span style="--i:${i}">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
}

function brand(shopName) {
  return `<a href="/" class="brand" aria-label="${esc(shopName)} หน้าแรก">${logoMark()}<span class="brand-text"><b>${esc(shopName)}</b><small>แอนิเมชันข้อความไทย</small></span></a>`;
}

function layout({ title, body, shopName, user = null, csrf = '', noindex = false, wide = false, page = '', intro = true }) {
  const account = user ? `
      <a href="/library" class="btn small ghost nav-lib">${ICON.library}<span>คลังของฉัน</span></a>
      <details class="menu">
        <summary class="icon-btn" aria-label="บัญชี">${ICON.user}</summary>
        <div class="menu-pop">
          <p class="muted small">${esc(user.name || user.email)}<br>${user.name ? esc(user.email) : ''}</p>
          <a href="/library">คลังของฉัน</a>
          <form method="post" action="/logout"><input type="hidden" name="csrf" value="${esc(csrf)}"><button type="submit" class="linklike">ออกจากระบบ</button></form>
        </div>
      </details>` : `
      <a href="/login" class="nav-login">เข้าสู่ระบบ</a>
      <a href="/signup" class="btn small primary">สมัครสมาชิก</a>`;
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
<title>${esc(title)} · ${esc(shopName)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/Kanit-Bold.ttf" as="font" type="font/ttf" crossorigin>
<script src="/theme.js?v=${V}"></script>
<link rel="stylesheet" href="/style.css?v=${V}">
</head>
<body class="${esc(page)}">
${intro ? `<div class="loader" data-loader aria-hidden="true">
  <div class="loader-curtain c-up"></div><div class="loader-curtain c-down"></div>
  <div class="loader-glow"></div>
  <div class="loader-in">
    ${logoMark(88, 'logo-mark big')}
    <div class="loader-name">${letters(shopName)}</div>
    <div class="loader-tag">แอนิเมชันข้อความภาษาไทย · พร้อมใช้ในทุกโปรแกรมตัดต่อ</div>
    <span class="loader-bar"><i></i></span>
  </div>
  <button type="button" class="loader-skip" data-loader-skip tabindex="-1">ข้าม ›</button>
</div>` : ''}
<div class="progress" aria-hidden="true"><i data-progress></i></div>
<a class="skip" href="#main">ข้ามไปเนื้อหา</a>
<header class="top" data-top>
  <div class="top-in">
    ${brand(shopName)}
    <nav class="nav" aria-label="เมนูหลัก">
      <a href="/#catalog">สินค้า</a>
      <a href="/#kit">ปรับแต่งได้</a>
      <a href="/#how">วิธีสั่งซื้อ</a>
    </nav>
    <div class="account">${account}</div>
    <button type="button" class="icon-btn" data-theme-toggle aria-label="สลับโหมดสว่าง/มืด">
      <span class="i-sun">${ICON.sun}</span><span class="i-moon">${ICON.moon}</span>
    </button>
  </div>
</header>
<main id="main" class="${wide ? 'wide' : ''}">
${body}
</main>
<footer class="foot">
  <div class="foot-in">
    <div class="foot-brand">${brand(shopName)}
      <p>แอนิเมชันข้อความภาษาไทยสำหรับคนตัดต่อ ${esc(LICENSE.short)}</p></div>
    <nav class="foot-links" aria-label="ลิงก์ท้ายเว็บ">
      <a href="/#catalog">สินค้าทั้งหมด</a>
      <a href="/library">คลังของฉัน</a>
      <a href="/license">สิทธิ์การใช้งาน</a>
    </nav>
    <div class="foot-meta">
      <span>${ICON.shield} ลิงก์ดาวน์โหลดเข้ารหัสลายเซ็น</span>
      <span>${ICON.infinity} ซื้อครั้งเดียว ใช้ได้ตลอด</span>
      <span>ฟอนต์ Kanit · SIL Open Font License</span>
    </div>
  </div>
</footer>
<button type="button" class="to-top" data-to-top aria-label="กลับขึ้นด้านบน" hidden>${ICON.up}</button>
<script src="/app.js?v=${V}" defer></script>
</body>
</html>`;
}

function card(p, i, owned) {
  const tags = [p.category, ...(p.tags || [])].filter(Boolean);
  const search = [p.title, p.subtitle, p.description, ...tags].join(' ').toLowerCase();
  return `
    <article class="card reveal" data-card data-cat="${esc(p.category || '')}" data-price="${esc(p.price)}" data-order="${i}" data-search="${esc(search)}">
      <a class="card-link" href="/p/${esc(p.slug)}" aria-label="${esc(p.title)} ${baht(p.price)}">
        <div class="thumb" data-hover-play>
          <img src="/previews/${esc(p.slug)}_horizontal.jpg" alt="" loading="lazy" width="960" height="540">
          <video data-src="/previews/${esc(p.slug)}_horizontal.mp4" muted loop playsinline preload="none"></video>
          <span class="play-hint">${ICON.play} ชี้เพื่อดูตัวอย่าง</span>
          ${owned && owned.has(p.slug) ? '<span class="dur owned">อยู่ในคลังแล้ว</span>' : `<span class="dur">${ICON.stretch} ยืดได้</span>`}
        </div>
        <div class="card-body">
          <div class="card-top">
            <h3>${esc(p.title)}</h3>
            <span class="price">${baht(p.price)}</span>
          </div>
          <p class="muted small">${esc(p.subtitle || '')}</p>
          <ul class="chips mini">${tags.slice(0, 3).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        </div>
      </a>
    </article>`;
}

// ไทม์ไลน์ตัวอย่าง: ส่วนเข้า | ภาพนิ่ง (ยืดได้) | ส่วนออก
function kitTimeline({ big = false } = {}) {
  return `<div class="timeline${big ? ' big' : ''}" aria-hidden="true">
    <div class="tl-track">
      <span class="tl-clip in"><b>เด้งเข้า</b><small>0.5 วิ</small></span>
      <span class="tl-clip hold"><b>ข้อความค้าง</b><small>นานเท่าที่เลือก 3–30 วิ</small><i class="tl-handle"></i></span>
      <span class="tl-clip out"><b>จางออก</b><small>0.5 วิ</small></span>
    </div>
    <div class="tl-track ghost"><span class="tl-clip base">คลิปของคุณ</span></div>
  </div>`;
}

function home({ cfg, user, csrf, products, owned = new Set() }) {
  const { editors } = cfg.editorsConfig;
  const cats = [...new Set(products.map((p) => p.category).filter(Boolean))];
  const cards = products.map((p, i) => card(p, i, owned)).join('');
  const editorNames = Object.values(editors).filter((e) => !/อื่น/.test(e.label)).map((e) => e.label);
  const editorList = editorNames.map((n) => `<li class="reveal">${ICON.film}<span>${esc(n)}</span></li>`).join('');
  const minPrice = products.length ? Math.min(...products.map((p) => p.price)) : 0;
  const lead = products[0];
  const phrases = ['ลากใส่คลิปได้ทันที', 'ยืดความยาวได้ตามใจ', 'ซื้อครั้งเดียว ใช้ได้ตลอด'];
  const marquee = editorNames.map((n) => `<span>${esc(n)}</span><span class="sep">✦</span>`).join('');
  return layout({
    title: 'แอนิเมชันข้อความภาษาไทย', shopName: cfg.shopName, user, csrf, page: 'page-home',
    body: `
<section class="hero">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="hero-copy">
    <p class="eyebrow pill"><span class="dot"></span> ร้านแอนิเมชันข้อความภาษาไทย สำหรับคนตัดต่อ</p>
    <h1 class="type" aria-label="ข้อความเคลื่อนไหวพร้อมใช้ ${esc(phrases[0])}">
      <span class="type-line" data-type-static aria-hidden="true">ข้อความเคลื่อนไหวพร้อมใช้</span>
      <span class="type-line hl-line" aria-hidden="true"><span class="hl" data-type-rotate="${esc(JSON.stringify(phrases))}">${esc(phrases[0])}</span><span class="caret"></span></span>
    </h1>
    <p class="lead">เลือกแอนิเมชัน บอกว่าตัดต่อด้วยโปรแกรมอะไร แล้วรับไฟล์ที่ตรงกับโปรแกรมนั้นทันที หลังซื้อปรับข้อความ ฟอนต์ สี แนว และความยาวได้เอง แล้วโหลดเป็นไฟล์เดียว</p>
    <div class="hero-cta">
      <a class="btn primary lg" href="#catalog">ดูสินค้าทั้งหมด</a>
      <a class="btn ghost lg" href="#kit">ปรับแต่งได้อย่างไร</a>
    </div>
    <ul class="facts">
      <li><b>${products.length}</b><span>แอนิเมชัน</span></li>
      <li><b>2</b><span>ขนาด แนวตั้ง/แนวนอน</span></li>
      <li><b>${editorNames.length}+</b><span>โปรแกรมตัดต่อ</span></li>
      <li><b>${baht(minPrice)}</b><span>ราคาเริ่มต้น</span></li>
    </ul>
  </div>
  ${lead ? `<a class="hero-visual" href="/p/${esc(lead.slug)}" aria-label="ดูตัวอย่าง ${esc(lead.title)}" data-tilt>
    <div class="window">
      <div class="window-bar"><i></i><i></i><i></i><span>ตัวอย่าง · ${esc(lead.title)}</span></div>
      <video src="/previews/${esc(lead.slug)}_horizontal.mp4" poster="/previews/${esc(lead.slug)}_horizontal.jpg" autoplay muted loop playsinline preload="metadata"></video>
      ${kitTimeline()}
    </div>
  </a>` : ''}
</section>

<section class="marquee" aria-label="โปรแกรมที่รองรับ: ${esc(editorNames.join(', '))}">
  <div class="marquee-track" aria-hidden="true">${marquee}${marquee}${marquee}${marquee}</div>
</section>

<section id="catalog" class="catalog">
  <div class="section-head">
    <div><p class="eyebrow">แคตตาล็อก</p><h2>สินค้าทั้งหมด</h2></div>
    <p class="muted small" data-count-label aria-live="polite">${products.length} รายการ</p>
  </div>
  <div class="toolbar" data-toolbar>
    <label class="search">
      ${ICON.search}
      <input type="search" placeholder="ค้นหาข้อความ เช่น สั่งซื้อ, ลดราคา" aria-label="ค้นหาแอนิเมชัน" data-search autocomplete="off">
      <kbd>/</kbd>
    </label>
    <div class="chips filter" role="group" aria-label="หมวดหมู่">
      <button type="button" class="chip active" data-cat-btn="">ทั้งหมด</button>
      ${cats.map((c) => `<button type="button" class="chip" data-cat-btn="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
    <div class="tools-right">
      <select data-sort aria-label="เรียงลำดับ">
        <option value="order">แนะนำ</option>
        <option value="price-asc">ราคาต่ำ → สูง</option>
        <option value="price-desc">ราคาสูง → ต่ำ</option>
      </select>
      <div class="seg" role="group" aria-label="รูปแบบการแสดงผล">
        <button type="button" class="active" data-view="grid" aria-label="แบบตาราง">${ICON.grid}</button>
        <button type="button" data-view="list" aria-label="แบบรายการ">${ICON.list}</button>
      </div>
    </div>
  </div>
  <div class="grid" data-grid>${cards}</div>
  <div class="empty" data-empty hidden>
    <p><b>ไม่พบแอนิเมชันที่ค้นหา</b></p>
    <p class="muted small">ลองคำอื่น หรือ <button type="button" class="linklike" data-reset>ล้างตัวกรอง</button></p>
  </div>
</section>

<section id="kit" class="kit-section">
  <div class="kit-copy reveal">
    <p class="eyebrow">ปรับแต่งหลังซื้อ · ไม่จำกัดครั้ง</p>
    <h2>อยากให้ข้อความค้างนานแค่ไหนก็ได้</h2>
    <p class="muted">เลือกแนวตั้งหรือแนวนอน เลือกว่าจะให้ข้อความค้างนานแค่ไหน พิมพ์ประโยคเอง เลือกฟอนต์และสี แล้วได้ไฟล์วิดีโอไฟล์เดียวที่ลากใส่โปรแกรมได้ทันที</p>
    <ol class="kit-steps">
      <li><b>เลือกแนวและความยาว</b><span>9:16 หรือ 16:9 · 3, 5, 10, 15 หรือ 30 วินาที</span></li>
      <li><b>ใส่ข้อความ ฟอนต์ สีของคุณ</b><span>ดูตัวอย่างเคลื่อนไหวสดก่อนสร้าง</span></li>
      <li><b>โหลดไฟล์เดียว</b><span>สร้างเสร็จในไม่กี่วินาที เก็บในคลังตลอด</span></li>
    </ol>
  </div>
  <div class="kit-visual reveal">${kitTimeline({ big: true })}</div>
</section>

<section id="how" class="how">
  <div class="section-head"><div><p class="eyebrow">ขั้นตอน</p><h2>ซื้อครั้งเดียว อยู่ในคลังตลอดไป</h2></div></div>
  <ol class="steps">
    <li class="reveal"><span class="num">1</span><h3>เลือกแอนิเมชัน</h3><p>ดูตัวอย่างทั้งแนวตั้งและแนวนอนก่อนซื้อ</p></li>
    <li class="reveal"><span class="num">2</span><h3>เข้าสู่ระบบแล้วจ่ายเงิน</h3><p>สมัครสมาชิกครั้งเดียว ใช้อีเมลกับรหัสผ่าน ไม่ต้องกรอกข้อมูลซ้ำทุกครั้ง</p></li>
    <li class="reveal"><span class="num">3</span><h3>เปิดใช้จากคลัง</h3><p>ไฟล์เข้าไปอยู่ในคลังของบัญชีคุณทันที เปิดใช้ได้ทุกเมื่อ ทุกเครื่อง</p></li>
  </ol>
</section>

<section id="editors" class="editors">
  <div class="section-head"><div><p class="eyebrow">รองรับ</p><h2>ใช้ได้กับโปรแกรมที่คุณถนัด</h2></div></div>
  <ul class="editor-list">${editorList}</ul>
  <ul class="perks">
    <li>${ICON.check} ไฟล์พื้นเขียว พื้นดำ และแบบโปร่งใส</li>
    <li>${ICON.check} ใช้ในงานลูกค้าและงานโฆษณาได้</li>
    <li>${ICON.check} เลือกโปรแกรมตอนใช้งานในคลัง เปลี่ยนได้ตลอด</li>
  </ul>
</section>

<section class="cta-band reveal">
  <div>
    <h2>ซื้อครั้งเดียว ใช้ได้ตลอด</h2>
    <p>ไม่มีรายเดือน ไม่มีวันหมดอายุ ทุกอย่างที่ซื้ออยู่ในคลังของบัญชีคุณ เข้าสู่ระบบแล้วโหลดใหม่ได้ทุกเมื่อ</p>
  </div>
  <div class="cta-band-actions">
    <a class="btn light lg" href="${user ? '/library' : '/signup'}">${user ? 'เปิดคลังของฉัน' : 'สมัครสมาชิกฟรี'}</a>
    <a class="btn outline-light lg" href="/license">อ่านสิทธิ์การใช้งาน</a>
  </div>
</section>`,
  });
}

function editorOptions(editors, selected) {
  return Object.entries(editors).map(([id, e]) => `
    <label class="opt"><input type="radio" name="editor" value="${esc(id)}" ${id === selected ? 'checked' : ''} required>
      <span>${esc(e.label)}</span></label>`).join('');
}

function product({ cfg, user, csrf, p, owned }) {
  const faq = (p.faq || []).map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  const tags = [p.category, ...(p.tags || [])].filter(Boolean);
  return layout({
    title: p.title, shopName: cfg.shopName, user, csrf, page: 'page-product',
    body: `
<nav class="crumb" aria-label="ตำแหน่งหน้า"><a href="/">หน้าร้าน</a><span>/</span><a href="/#catalog">สินค้าทั้งหมด</a><span>/</span><span aria-current="page">${esc(p.title)}</span></nav>
<div class="pd">
  <div class="pd-main">
    <div class="preview-head">
      <div class="preview-tabs seg" data-tabs role="tablist">
        <button type="button" class="tab active" data-show="h" role="tab" aria-selected="true">แนวนอน 16:9</button>
        <button type="button" class="tab" data-show="v" role="tab" aria-selected="false">แนวตั้ง 9:16</button>
      </div>
      <span class="muted small">คลิปตัวอย่างมีลายน้ำ</span>
    </div>
    <div class="preview">
      <video data-pane="h" src="/previews/${esc(p.slug)}_horizontal.mp4" poster="/previews/${esc(p.slug)}_horizontal.jpg" autoplay muted loop playsinline controls></video>
      <video data-pane="v" class="vertical" hidden src="/previews/${esc(p.slug)}_vertical.mp4" poster="/previews/${esc(p.slug)}_vertical.jpg" muted loop playsinline controls></video>
    </div>

    <section class="panel">
      <h2>รายละเอียด</h2>
      <p>${esc(p.description)}</p>
      <dl class="spec-grid">
        <div><dt>คลิปเต็ม</dt><dd>${esc(p.manifest.duration)} วินาที · ${esc(p.manifest.fps)} fps</dd></div>
        <div><dt>ปรับแต่งเอง</dt><dd>ความยาว 3–30 วินาที</dd></div>
        <div><dt>ขนาด</dt><dd>1080×1920 และ 1920×1080</dd></div>
        <div><dt>ฟอร์แมต</dt><dd>MP4 พื้นเขียว/ดำ, ProRes 4444, WebM, PNG</dd></div>
      </dl>
      <ul class="chips mini">${tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    </section>

    <section class="panel kit-panel">
      <h2>${ICON.stretch} ปรับแต่งเองได้หลังซื้อ</h2>
      <p class="muted">นอกจากคลิปเต็ม ${esc(p.manifest.duration)} วินาที ยังเปลี่ยนข้อความ ฟอนต์ สี แนว และความยาว (สูงสุด 30 วินาที) ได้เอง ได้เป็นไฟล์เดียวที่ตรงกับโปรแกรมที่ใช้</p>
      ${kitTimeline()}
    </section>

    <section class="panel license-panel">
      <h2>${ICON.infinity} สิทธิ์การใช้งาน: ใช้ได้ตลอด</h2>
      <ul class="ticks">${LICENSE.points.slice(0, 3).map((t) => `<li>${ICON.check}<span>${esc(t)}</span></li>`).join('')}</ul>
      <ul class="ticks no">${LICENSE.not.slice(0, 2).map((t) => `<li>${ICON.x}<span>${esc(t)}</span></li>`).join('')}</ul>
      <p class="small"><a href="/license">อ่านสิทธิ์การใช้งานทั้งหมด</a></p>
    </section>

    <section class="faq panel">
      <h2>คำถามที่พบบ่อย</h2>
      ${faq}
      <details><summary>ซื้อแล้วใช้ได้นานแค่ไหน</summary><p>ใช้ได้ตลอดไป ไม่มีวันหมดอายุ ไฟล์อยู่ในคลังของบัญชีคุณ เข้าสู่ระบบแล้วดาวน์โหลดใหม่ได้ทุกเมื่อ</p></details>
      <details><summary>เปลี่ยนข้อความ ฟอนต์ หรือสีได้ไหม</summary><p>ได้ หลังซื้อ ในคลังกด "ปรับแต่ง" พิมพ์ประโยคของคุณเอง เลือกฟอนต์ไทยที่ใช้เชิงพาณิชย์ได้ เลือกสีตัวอักษร ขอบ และเงา ดูตัวอย่างเคลื่อนไหวสดก่อน แล้วกดสร้างไฟล์ ระบบจะทำไฟล์ชุดใหม่ให้ตามโปรแกรมที่ใช้ และเก็บไว้ในคลังตลอด</p></details>
      <details><summary>ต้องเลือกโปรแกรมตัดต่อตอนซื้อไหม</summary><p>ไม่ต้อง เลือกตอนเปิดใช้ในคลัง และเปลี่ยนได้ตลอด ระบบจะให้ไฟล์ที่ตรงกับโปรแกรมนั้นพร้อมวิธีใช้</p></details>
      <details><summary>อยากให้ข้อความค้างนานกว่า ${esc(p.manifest.duration)} วินาที</summary><p>ในคลังกด "ปรับแต่ง" แล้วเลือกความยาว 5, 10, 15 หรือ 30 วินาที ระบบสร้างไฟล์ใหม่ให้ในไม่กี่วินาที</p></details>
    </section>
  </div>

  <aside class="pd-side">
    <section class="buy" id="buy">
      <p class="eyebrow">${esc(p.category || 'แอนิเมชันข้อความ')}</p>
      <h1>${esc(p.title)}</h1>
      <p class="muted">${esc(p.subtitle || '')}</p>
      <p class="price big">${baht(p.price)} <span class="price-note">จ่ายครั้งเดียว ใช้ได้ตลอด</span></p>
      ${owned ? `
      <div class="owned-box">${ICON.check}<span>คุณมีแอนิเมชันนี้ในคลังแล้ว</span></div>
      <a class="btn primary block" href="/library/${esc(owned.id)}">เปิดใช้จากคลัง</a>` : user ? `
      <form method="post" action="/checkout" data-checkout>
        <input type="hidden" name="product" value="${esc(p.slug)}">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <button class="btn primary block" type="submit"><span>ซื้อเลย ${baht(p.price)}</span></button>
      </form>
      <p class="muted small center">ไฟล์จะเข้าไปอยู่ในคลังของ ${esc(user.email)}</p>` : `
      <a class="btn primary block" href="/login?next=${encodeURIComponent('/p/' + p.slug)}">เข้าสู่ระบบเพื่อซื้อ</a>
      <p class="muted small center">ยังไม่มีบัญชี? <a href="/signup?next=${encodeURIComponent('/p/' + p.slug)}">สมัครสมาชิกฟรี</a> ใช้เวลาไม่ถึงนาที</p>`}
      <ul class="assure">
        <li>${ICON.bolt} ได้ไฟล์ทันทีหลังชำระเงิน</li>
        <li>${ICON.infinity} ซื้อครั้งเดียว อยู่ในคลังตลอดไป</li>
        <li>${ICON.film} เลือกโปรแกรมตัดต่อตอนใช้งาน เปลี่ยนได้ตลอด</li>
        <li>${ICON.edit} ปรับแต่งข้อความ ฟอนต์ และสีเองได้หลังซื้อ</li>
        <li>${ICON.check} ใช้ในงานลูกค้าและโฆษณาได้</li>
      </ul>
    </section>
  </aside>
</div>
<div class="buy-bar" data-buy-bar>
  <div><b>${esc(p.title)}</b><span class="price">${baht(p.price)}</span></div>
  <a class="btn primary" href="#buy">${owned ? 'เปิดในคลัง' : 'ซื้อเลย'}</a>
</div>`,
  });
}

function mockPay({ cfg, user, csrf, order, p }) {
  return layout({
    title: 'ชำระเงิน (โหมดทดสอบ)', shopName: cfg.shopName, user, csrf, noindex: true,
    body: `
<div class="narrow">
<div class="banner test">โหมดทดสอบ: ไม่มีการตัดเงินจริง</div>
<h1>ชำระเงิน</h1>
<div class="box">
  <p>${esc(p.title)}</p>
  <p class="price big">${baht(order.amount)}</p>
  <p class="muted">คำสั่งซื้อ ${esc(order.id.slice(0, 8))}</p>
</div>
<p>ตอนขายจริง หน้านี้จะเป็นหน้า QR PromptPay หรือหน้ากรอกบัตรของผู้ให้บริการชำระเงิน</p>
<form method="post" action="/pay/mock/${esc(order.id)}/simulate">
  <input type="hidden" name="csrf" value="${esc(csrf)}">
  <button class="btn primary block" type="submit">จำลองจ่ายสำเร็จ</button>
</form>
<p><a href="/p/${esc(p.slug)}">ยกเลิก</a></p>
</div>`,
  });
}

function orderStatus({ cfg, user, csrf, order, p }) {
  const paid = order.status === 'paid';
  return layout({
    title: paid ? 'ชำระเงินสำเร็จ' : 'รอยืนยันการชำระเงิน', shopName: cfg.shopName, user, csrf, noindex: true,
    body: paid ? `
<div class="success narrow">
  <div class="success-mark" aria-hidden="true">${ICON.check}</div>
  <h1>ชำระเงินสำเร็จ</h1>
  <p>ขอบคุณที่สั่งซื้อ <b>${esc(p.title)}</b> แอนิเมชันนี้อยู่ในคลังของคุณแล้ว</p>
  <p><a class="btn primary lg" href="/library/${esc(order.id)}">${ICON.library} เปิดใช้จากคลัง</a></p>
  <p class="muted small">รหัสคำสั่งซื้อ <b>${esc(order.id.slice(0, 8))}</b> · ส่งใบยืนยันไปที่ ${esc(order.email)} แล้ว</p>
  <div class="note">${ICON.infinity}<span>ซื้อครั้งเดียว ใช้ได้ตลอด เข้าสู่ระบบแล้วโหลดใหม่จากคลังได้ทุกเมื่อ ทุกเครื่อง</span></div>
</div>` : `
<div class="narrow">
<h1>รอยืนยันการชำระเงิน…</h1>
<p>ระบบกำลังรอการยืนยันจากผู้ให้บริการชำระเงิน หน้านี้จะเปลี่ยนเองเมื่อยืนยันแล้ว</p>
<div class="spinner" data-poll="/order/${esc(order.id)}/status" aria-hidden="true"></div>
<p class="muted small">ถ้ารอนานเกิน 5 นาที กรุณาติดต่อร้านพร้อมรหัสคำสั่งซื้อ ${esc(order.id.slice(0, 8))}</p>
</div>`,
  });
}

function fileRow({ f, href, label }) {
  return `<li class="file">
    <div><b>${esc(label)}</b><br><span class="muted small">${esc(f.file)} · ${fmtBytes(f.bytes)}</span></div>
    <a class="btn" href="${esc(href(f))}" download>${ICON.download} ดาวน์โหลด</a>
  </li>`;
}

function statusBadge(job) {
  const map = { queued: ['รอคิว', 'wait'], rendering: [`กำลังสร้าง ${job.progress}%`, 'run'], done: ['พร้อมโหลด', 'ok'], failed: ['ไม่สำเร็จ', 'bad'] };
  const [label, cls] = map[job.status] || [job.status, ''];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function versionList(cfg, versions, productsBySlug, fonts = cfg.fonts) {
  if (!versions.length) return '';
  const fontLabel = (id) => (fonts.find((f) => f.id === id) || {}).label || (String(id).startsWith('u-') ? 'ฟอนต์ที่ลบไปแล้ว' : id);
  const edLabel = (id) => (cfg.editorsConfig.editors[id] || { label: id }).label;
  return `<ul class="versions">${versions.map((v) => `
    <li class="v-row">
      <a class="v-link" href="/library/custom/${esc(v.id)}">
        <span class="v-swatch" style="background:${esc(v.fill)};box-shadow:inset 0 0 0 3px ${esc(v.outline === 'none' ? v.fill : v.stroke)}"></span>
        <span class="v-main"><b>${esc(v.text)}</b><small>${esc(SIZE_LABEL[v.size] || '')} · ${esc(v.seconds || 3)} วิ · ${esc(fontLabel(v.font))} · ${esc(edLabel(v.editor))}${productsBySlug ? ` · จาก ${esc((productsBySlug(v.product_slug) || {}).title || v.product_slug)}` : ''} · ${esc(thDate(v.created_at))}</small></span>
      </a>
      ${v.status === 'done' && /"format":"single"/.test(v.files_json || '') ? `<a class="btn small primary" href="/library/custom/${esc(v.id)}/download" aria-label="ดาวน์โหลด ${esc(v.text)}">${ICON.download} ดาวน์โหลด</a>` : statusBadge(v)}
    </li>`).join('')}</ul>`;
}

function library({ cfg, user, csrf, items, customs = [], fonts, limits }) {
  const list = items.map(({ order, p }) => `
    <article class="lib-card reveal">
      <a href="/library/${esc(order.id)}" class="lib-thumb"><img src="/previews/${esc(p.slug)}_horizontal.jpg" alt="" loading="lazy" width="960" height="540"></a>
      <div class="lib-body">
        <h3>${esc(p.title)}</h3>
        <p class="muted small">ซื้อเมื่อ ${esc(thDate(order.paid_at || order.created_at))} · รหัส ${esc(order.id.slice(0, 8))}</p>
        <div class="lib-actions">
          <a class="btn primary" href="/library/${esc(order.id)}/customize">${ICON.edit} ปรับแต่งแล้วโหลด</a>
          <a class="btn" href="/library/${esc(order.id)}">${ICON.download} แบบต้นฉบับ</a>
        </div>
      </div>
    </article>`).join('');
  return layout({
    title: 'คลังของฉัน', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-library',
    body: `
<div class="section-head lib-head">
  <div><p class="eyebrow">บัญชี ${esc(user.email)}</p><h1>คลังของฉัน</h1></div>
  <p class="muted small">${items.length} รายการ · ใช้ได้ตลอด</p>
</div>
${items.length ? `<div class="lib-grid">${list}</div>` : `
<div class="empty">
  <p><b>ยังไม่มีแอนิเมชันในคลัง</b></p>
  <p class="muted small">ซื้อแล้วจะมาอยู่ที่นี่ทันที ใช้ได้ตลอด</p>
  <p><a class="btn primary" href="/#catalog">เลือกแอนิเมชัน</a></p>
</div>`}
${items.length ? `<nav class="lib-tools" aria-label="เครื่องมือปรับแต่ง">
  <a href="/library/styles" class="lib-tool">${ICON.edit}<span><b>สไตล์ของฉัน</b><small>ฟอนต์ + สีที่บันทึกไว้ กดทีเดียวใช้ได้</small></span></a>
  <a href="/library/fonts" class="lib-tool">${ICON.film}<span><b>ฟอนต์ของฉัน</b><small>อัปโหลดฟอนต์มาใช้เอง</small></span></a>
</nav>` : ''}
${customs.length ? `<section class="lib-versions"><div class="section-head"><div><p class="eyebrow">ปรับแต่งเอง</p><h2>เวอร์ชันของฉัน</h2></div><p class="muted small">${customs.length} เวอร์ชัน · โหลดซ้ำได้ตลอด${limits ? ` · ใช้พื้นที่ ${fmtBytes(limits.usedBytes)} จาก ${fmtBytes(limits.quotaBytes)}` : ''}</p></div>${versionList(cfg, customs, (slug) => cfg.products.find((x) => x.slug === slug), fonts)}</section>` : ''}`,
  });
}

function libraryItem({ cfg, user, csrf, order, p, editorId, left, size = 'vertical' }) {
  const { editors } = cfg.editorsConfig;
  const ed = editors[editorId];
  const q = (patch) => {
    const o = { editor: editorId, size, ...patch };
    return `/library/${esc(order.id)}?editor=${esc(o.editor)}&size=${esc(o.size)}`;
  };
  const editorTabs = Object.entries(editors).map(([id, e]) => `<a href="${q({ editor: id })}" class="chip${id === editorId ? ' active' : ''}"${id === editorId ? ' aria-current="true"' : ''}>${esc(e.label)}</a>`).join('');
  const sizeTabs = ['vertical', 'horizontal'].map((k) => `<a href="${q({ size: k })}" class="chip${k === size ? ' active' : ''}">${SIZE_LABEL[k]}</a>`).join('');
  const fileFor = (fmt) => p.manifest.files.find((f) => f.format === fmt && f.size === size && (f.part || 'full') === 'full');
  const btn = (kind, fmt, primary) => {
    const f = fileFor(fmt);
    if (!f) return '';
    return `<a class="btn ${primary ? 'primary lg' : ''} block" href="/library/${esc(order.id)}/download?editor=${esc(editorId)}&size=${esc(size)}${kind === 'alt' ? '&filetype=alt' : ''}">${ICON.download} ${esc(fileLabel(cfg, fmt))} · ${fmtBytes(f.bytes)}</a>`;
  };
  return layout({
    title: `${p.title} · คลังของฉัน`, shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-library',
    body: `
<nav class="crumb" aria-label="ตำแหน่งหน้า"><a href="/library">คลังของฉัน</a><span>/</span><span aria-current="page">${esc(p.title)}</span></nav>
<div class="lib-item-head">
  <img src="/previews/${esc(p.slug)}_horizontal.jpg" alt="" width="960" height="540">
  <div>
    <p class="eyebrow">อยู่ในคลังของคุณ · ใช้ได้ตลอด</p>
    <h1>${esc(p.title)}</h1>
    <p class="muted small">ซื้อเมื่อ ${esc(thDate(order.paid_at || order.created_at))} · รหัส ${esc(order.id.slice(0, 8))}</p>
  </div>
</div>
<a class="cz-cta" href="/library/${esc(order.id)}/customize">
  <span class="cz-cta-icon">${ICON.edit}</span>
  <span><b>อยากเปลี่ยนข้อความ ฟอนต์ สี หรือความยาว?</b><small>ปรับแต่งแล้วได้ไฟล์เดียวที่ใช้กับโปรแกรมของคุณ ใช้เวลาไม่กี่วินาที</small></span>
  <span class="cz-cta-go">›</span>
</a>
<section class="editor-pick ready-box">
  <h2>แบบต้นฉบับ (ข้อความเดิม 3 วินาที)</h2>
  <p class="muted small">1. ตัดต่อด้วยโปรแกรมอะไร</p>
  <div class="chips wrap" role="group" aria-label="เลือกโปรแกรม">${editorTabs}</div>
  <p class="muted small">2. แนวของคลิป</p>
  <div class="chips wrap" role="group" aria-label="เลือกแนว">${sizeTabs}</div>
  <p class="muted small">3. กดดาวน์โหลด ได้ไฟล์วิดีโอไฟล์เดียว</p>
  <div class="dl-pair">${btn('main', ed.single, true)}${ed.alt && ed.alt !== ed.single ? btn('alt', ed.alt, false) : ''}</div>
</section>
${howToBlock(cfg, ed, ed.single)}
<p class="muted small">ลิงก์ดาวน์โหลดสร้างใหม่ทุกครั้งที่กด (ใช้ได้ ${esc(cfg.linkMinutes)} นาที) · วันนี้ดาวน์โหลดได้อีก ${esc(left)} ครั้ง</p>
<section class="guide license-mini">
  <h2>สิทธิ์การใช้งาน</h2>
  <ul class="ticks">${LICENSE.points.map((t) => `<li>${ICON.check}<span>${esc(t)}</span></li>`).join('')}</ul>
  <ul class="ticks no">${LICENSE.not.map((t) => `<li>${ICON.x}<span>${esc(t)}</span></li>`).join('')}</ul>
  <p class="small"><a href="/license/kanit-ofl.txt">สัญญาอนุญาตฟอนต์ Kanit (OFL)</a></p>
</section>`,
  });
}

const FILL_SWATCHES = ['#ffd400', '#ffffff', '#111111', '#ff3b30', '#ff7a00', '#22c55e', '#0ea5e9', '#7c3aed', '#ec4899', '#f5d0a9'];
const STROKE_SWATCHES = ['#111111', '#ffffff', '#1e3a5f', '#b91c1c', '#ffd400'];

const SIZE_LABEL = { vertical: 'แนวตั้ง 9:16', horizontal: 'แนวนอน 16:9' };
const SECONDS = [3, 5, 10, 15, 30];
const fileLabel = (cfg, fmt) => ((cfg.editorsConfig.formats[fmt] || {}).short || fmt);
// วิธีใช้ในโปรแกรม (แสดงบนหน้าเว็บแทนไฟล์อ่านก่อนใน zip)
function howToBlock(cfg, ed, fmt) {
  const isAlpha = fmt === 'prores4444' || fmt === 'webm_alpha';
  const steps = ed.guide.filter((g) => (isAlpha ? !/^สำรอง|^ทางเลือก/.test(g) : !/ProRes 4444 แล้ว|Interpret Footage|Clip Attributes/.test(g)));
  return `<section class="guide howto"><h2>วิธีใช้ใน ${esc(ed.label)}</h2><ol>${steps.map((g) => `<li>${esc(g)}</li>`).join('')}</ol></section>`;
}

function fontFaces(fonts) {
  return fonts.map((f) => `@font-face{font-family:"tt-${f.id}";src:url("${f.url}");font-weight:100 900;font-display:swap}`).join('\n');
}

function customize({ cfg, user, csrf, order, p, editorId, versions, limits, tools, form, error, fonts = cfg.fonts, presets = [], preset = null, last = null }) {
  const { editors } = cfg.editorsConfig;
  const v = form;
  const dailyLeft = limits.maxPerDay > 0 ? Math.max(0, limits.maxPerDay - limits.today) : Infinity;
  const full = limits.usedBytes >= limits.quotaBytes;
  const busy = limits.active >= limits.maxActive;
  const running = versions.find((x) => x.status === 'queued' || x.status === 'rendering');
  const canRender = tools.ok && !busy && dailyLeft > 0 && !full;
  // ปุ่มสไตล์: แสดงชื่อด้วยฟอนต์และสีของสไตล์นั้นเลย กดแล้วใช้ทันที
  const styleData = (x) => esc(JSON.stringify({ font: x.font, fill: x.fill, stroke: x.stroke, outline: x.outline, shadow: Boolean(x.shadow) }));
  const fontOf = (id) => fonts.find((ff) => ff.id === id);
  const chipLook = (x) => {
    const ff = fontOf(x.font);
    return `font-family:'tt-${esc(ff ? ff.id : 'kanit')}',sans-serif;font-weight:${esc(ff ? ff.weight : 700)};color:${esc(x.fill)};${x.outline !== 'none' ? `-webkit-text-stroke:3px ${esc(x.stroke)};paint-order:stroke fill;` : ''}${x.shadow ? 'text-shadow:0 2px 3px rgba(0,0,0,.5);' : ''}`;
  };
  const styleChip = (x, { id = '', name, cls = '', removable = true } = {}) => `<span class="style-chip${cls}${preset && preset.id === id ? ' active' : ''}" data-style-chip data-style="${styleData(x)}"${id ? ` data-style-id="${esc(id)}"` : ''}>
      <button type="button" class="style-apply" data-style-apply title="ใช้สไตล์ ${esc(name)}"><span class="style-sample" style="${chipLook(x)}">ก</span><span class="style-name">${esc(name)}</span></button>
      ${removable ? `<button type="button" class="style-x" data-style-del aria-label="ลบสไตล์ ${esc(name)}">×</button>` : ''}
    </span>`;
  const styleChips = (last && last.font ? styleChip(last, { name: 'ล่าสุด', cls: ' last', removable: false }) : '')
    + presets.map((x) => styleChip(x, { id: x.id, name: x.name })).join('');
  const shopFonts = fonts.filter((f) => !f.user);
  const myFonts = fonts.filter((f) => f.user);
  const swatches = (name, list, cur) => list.map((c) => `<button type="button" class="swatch${c === cur ? ' active' : ''}" data-swatch="${name}" data-color="${c}" style="--c:${c}" aria-label="สี ${c}"></button>`).join('');
  const fontOpt = (f) => `
      <label class="font-opt${f.user ? ' mine' : ''}${f.thai && f.thai !== 'full' ? ' warn' : ''}">
        <input type="radio" name="font" value="${esc(f.id)}" data-weight="${esc(f.weight)}"${f.chars ? ` data-chars="${esc(f.chars)}" data-label="${esc(f.label)}"` : ''} ${f.id === v.font ? 'checked' : ''} required>
        <span class="font-sample" style="font-family:'tt-${esc(f.id)}';font-weight:${esc(f.weight)}">${f.thai === 'none' ? 'Hello Aa' : 'สวัสดี Aa'}</span>
        <small>${esc(f.label)} · ${esc(f.mood)}</small>
      </label>`;
  const fontsHtml = shopFonts.map(fontOpt).join('');
  const myFontsHtml = myFonts.map(fontOpt).join('');
  const outlineOpts = [['none', 'ไม่มี'], ['thin', 'บาง'], ['medium', 'กลาง'], ['thick', 'หนา']]
    .map(([k, l]) => `<label class="seg-opt"><input type="radio" name="outline" value="${k}" ${v.outline === k ? 'checked' : ''}><span>${l}</span></label>`).join('');
  const edOpts = Object.entries(editors).map(([id, e]) => `<label class="ed-opt"><input type="radio" name="editor" value="${esc(id)}" data-main="${esc(fileLabel(cfg, e.single))}" data-alt="${esc(fileLabel(cfg, e.alt))}" ${id === v.editor ? 'checked' : ''} required><span>${esc(e.label)}</span></label>`).join('');
  const curEd = editors[v.editor] || editors[editorId];
  const sizeOpts = ['vertical', 'horizontal'].map((k) => `<label class="size-opt"><input type="radio" name="size" value="${k}" ${(v.size || 'vertical') === k ? 'checked' : ''}><span><i class="ratio ${k}"></i><b>${k === 'vertical' ? 'แนวตั้ง' : 'แนวนอน'}</b><small>${k === 'vertical' ? '9:16 · TikTok Reels Shorts' : '16:9 · YouTube'}</small></span></label>`).join('');
  const secOpts = SECONDS.map((n) => `<label class="seg-opt"><input type="radio" name="seconds" value="${n}" ${Number(v.seconds || 5) === n ? 'checked' : ''}><span>${n} วิ</span></label>`).join('');
  const typeOpts = [['main', curEd.single, 'แนะนำ'], ['alt', curEd.alt, 'ทางเลือก']].map(([k, fmt, tag]) => `<label class="type-opt"><input type="radio" name="filetype" value="${k}" ${(v.filetype || 'main') === k ? 'checked' : ''}><span><b data-type-label="${k}">${esc(fileLabel(cfg, fmt))}</b><small>${tag}</small></span></label>`).join('');
  return layout({
    title: `ปรับแต่ง ${p.title}`, shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-customize',
    body: `
<style>${fontFaces(fonts)}</style>
<nav class="crumb" aria-label="ตำแหน่งหน้า"><a href="/library">คลังของฉัน</a><span>/</span><a href="/library/${esc(order.id)}">${esc(p.title)}</a><span>/</span><span aria-current="page">ปรับแต่ง</span></nav>
<div class="cz-head">
  <div><p class="eyebrow">ปรับแต่งเป็นของคุณเอง</p><h1>${esc(p.title)}</h1></div>
  <p class="muted small">ท่าเคลื่อนไหวเดิม · เปลี่ยนข้อความ ฟอนต์ สี ได้ตามใจ</p>
</div>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<section class="styles-bar" data-styles data-csrf="${esc(csrf)}">
  <div class="styles-head">
    <b>สไตล์ของฉัน</b>
    <span class="muted small">กดเพื่อใช้ฟอนต์และสีนั้นทันที (ข้อความไม่เปลี่ยน)</span>
    ${presets.length ? '<a class="small" href="/library/styles">เปลี่ยนชื่อ / จัดการ</a>' : ''}
  </div>
  <div class="style-chips" data-style-chips>
    ${styleChips}
    <button type="button" class="style-add" data-style-save>+ บันทึกสไตล์นี้</button>
  </div>
  <form class="style-form" data-style-form hidden>
    <input type="text" maxlength="40" placeholder="ตั้งชื่อสไตล์ เช่น แดงขอบขาว" data-style-name aria-label="ชื่อสไตล์">
    <button class="btn small primary" type="submit">บันทึก</button>
    <button class="btn small ghost" type="button" data-style-cancel>ยกเลิก</button>
  </form>
  <p class="style-hint muted small" data-style-msg>${presets.length ? '' : 'ครั้งแรก: เลือกฟอนต์และสีที่ชอบด้านล่าง แล้วกด "+ บันทึกสไตล์นี้" ครั้งหน้ากดชื่อสไตล์ทีเดียวก็ได้หน้าตาเดิม'}</p>
</section>
<div class="cz">
  <div class="cz-preview-col">
    <div class="cz-preview">
      <div class="cz-stage" data-stage data-ratio="${(v.size || 'vertical') === 'horizontal' ? 'h' : 'v'}" data-bg="checker">
        <div class="cz-text" data-preview-text><span class="fill"></span></div>
      </div>
      <div class="cz-bar">
        <div class="seg" role="group" aria-label="พื้นหลังตัวอย่าง">
          <button type="button" class="active" data-bg-btn="checker" title="โปร่งใส">▦</button>
          <button type="button" data-bg-btn="green" title="พื้นเขียว"><i class="dotc" style="background:#00ff00"></i></button>
          <button type="button" data-bg-btn="black" title="พื้นดำ"><i class="dotc" style="background:#000"></i></button>
          <button type="button" data-bg-btn="white" title="พื้นขาว"><i class="dotc" style="background:#fff"></i></button>
        </div>
        <div class="seg" role="group" aria-label="เล่น">
          <button type="button" data-play aria-label="หยุด/เล่น">❚❚</button>
          <button type="button" data-hold aria-label="ดูท่าค้าง">ค้าง</button>
        </div>
      </div>
      <div class="cz-scrub"><input type="range" min="0" max="${Number(v.seconds || 5) * 100}" value="0" data-scrub aria-label="เลื่อนดูทีละเฟรม"><span data-time>0.0s</span></div>
      <div data-filters></div>
    </div>
    <p class="muted small">ตัวอย่างนี้ใช้ท่าเคลื่อนไหวและความยาวเดียวกับไฟล์จริง ไฟล์ที่ได้คมชัดเต็มขนาด ไม่มีลายน้ำ</p>
  </div>

  <form class="cz-form" method="post" action="/library/${esc(order.id)}/customize" data-cz-form>
    <input type="hidden" name="csrf" value="${esc(csrf)}">
    <fieldset class="cz-field">
      <legend>แนวของคลิป</legend>
      <div class="size-grid">${sizeOpts}</div>
    </fieldset>
    <fieldset class="cz-field">
      <legend>ข้อความ</legend>
      <div class="cz-input"><input type="text" name="text" value="${esc(v.text)}" maxlength="120" required autocomplete="off" data-cz-text><span class="muted small" data-counter></span></div>
      <p class="muted small">ไม่เกิน 40 ตัวอักษร · ภาษาไทย อังกฤษ ตัวเลข และเครื่องหมายทั่วไป</p>
    </fieldset>
    <fieldset class="cz-field">
      <legend>ฟอนต์ <span class="muted small">ฟอนต์ของร้านใช้เชิงพาณิชย์ได้ทุกตัว (SIL OFL)</span></legend>
      <div class="font-grid">${fontsHtml}</div>
      <div class="my-fonts">
        <div class="my-fonts-head"><b>ฟอนต์ของฉัน</b>${myFonts.length ? '<a class="small" href="/library/fonts">จัดการ</a>' : ''}</div>
        <div class="font-grid" data-my-fonts>${myFontsHtml}</div>
        <div class="inline-upload" data-inline-upload data-csrf="${esc(csrf)}">
          <label class="btn small"><input type="file" accept=".ttf,.otf,.woff,.woff2" data-inline-font hidden>+ ใช้ฟอนต์ของฉันเอง</label>
          <label class="check small"><input type="checkbox" data-inline-rights checked> ฉันมีสิทธิ์ใช้ฟอนต์นี้เชิงพาณิชย์</label>
          <p class="small muted" data-inline-msg>.ttf .otf .woff .woff2 · เลือกไฟล์แล้วจะเห็นในตัวอย่างทันที (ร้านให้สิทธิ์เฉพาะฟอนต์ของร้าน)</p>
        </div>
      </div>
      <p class="font-warn" data-font-warn hidden></p>
    </fieldset>
    <fieldset class="cz-field">
      <legend>สีตัวอักษร</legend>
      <div class="swatches">${swatches('fill', FILL_SWATCHES, v.fill)}<label class="swatch-pick"><input type="color" name="fill" value="${esc(v.fill)}" data-cz-fill aria-label="เลือกสีเอง"><span>เลือกเอง</span></label></div>
    </fieldset>
    <fieldset class="cz-field">
      <legend>ขอบตัวอักษร</legend>
      <div class="seg seg-wide">${outlineOpts}</div>
      <div class="swatches" data-stroke-row>${swatches('stroke', STROKE_SWATCHES, v.stroke)}<label class="swatch-pick"><input type="color" name="stroke" value="${esc(v.stroke)}" data-cz-stroke aria-label="เลือกสีขอบเอง"><span>เลือกเอง</span></label></div>
    </fieldset>
    <fieldset class="cz-field">
      <legend>เงา</legend>
      <label class="toggle"><input type="checkbox" name="shadow" value="1" ${v.shadow ? 'checked' : ''} data-cz-shadow><span class="toggle-ui"></span><span>เงานุ่มใต้ตัวอักษร <small class="muted">(สวยที่สุดกับไฟล์โปร่งใส ProRes/PNG)</small></span></label>
    </fieldset>
    <fieldset class="cz-field">
      <legend>ความยาวคลิป <span class="muted small">(ข้อความเด้งเข้า → ค้าง → จางออก)</span></legend>
      <div class="seg seg-wide">${secOpts}</div>
    </fieldset>
    <fieldset class="cz-field">
      <legend>ตัดต่อด้วยโปรแกรมอะไร</legend>
      <div class="ed-grid">${edOpts}</div>
      <div class="type-grid">${typeOpts}</div>
      <p class="muted small" data-type-note>ได้ไฟล์วิดีโอไฟล์เดียว ลากใส่โปรแกรมได้ทันที · ไฟล์โปร่งใส (ProRes) คมที่สุดแต่ใหญ่กว่า ไฟล์พื้นเขียวเล็กและโหลดเร็ว</p>
    </fieldset>
    ${tools.ok ? '' : `<div class="note warn">${ICON.shield}<span><b>ระบบสร้างไฟล์ยังไม่พร้อม</b> ลองดูตัวอย่างและเลือกค่าไว้ได้ แต่ยังกดสร้างไฟล์ไม่ได้จนกว่าร้านจะเปิดระบบเรนเดอร์</span></div>`}
    ${full ? `<div class="note warn">${ICON.shield}<span><b>พื้นที่เก็บเวอร์ชันเต็มแล้ว</b> ลบเวอร์ชันเก่าที่ไม่ใช้ใน <a href="/library">คลัง</a> แล้วสร้างใหม่ได้ทันที</span></div>` : ''}
    <button class="btn primary block lg" type="submit" name="action" value="render" ${canRender ? '' : 'disabled'}>${ICON.bolt} สร้างไฟล์ของฉัน</button>
    <p class="muted small center">${busy ? `มีงานที่กำลังสร้างอยู่${running ? ` <a href="/library/custom/${esc(running.id)}">ดูความคืบหน้า</a>` : ''} · ระหว่างนี้บันทึกสไตล์ไว้ได้` : 'สร้างได้ไม่จำกัดครั้ง · ใช้เวลาประมาณ 5–15 วินาที'}</p>
  </form>
</div>
${versions.length ? `<section class="lib-versions"><h2>เวอร์ชันของฉันจากแอนิเมชันนี้</h2>${versionList(cfg, versions, null, fonts)}</section>` : ''}
<script src="/motion.js?v=${V}" defer></script>
<script src="/customize.js?v=${V}" defer></script>`,
  });
}

function customStatus({ cfg, user, csrf, job, p, position, fonts = cfg.fonts }) {
  const font = fonts.find((f) => f.id === job.font) || { label: 'ฟอนต์ที่ลบไปแล้ว', weight: 700, id: job.font };
  const ed = cfg.editorsConfig.editors[job.editor] || { label: job.editor };
  const one = JSON.parse(job.files_json || '[]').find((x) => x.format === 'single');
  const fmt = one ? one.codec : '';
  const fontNote = font.user
    ? `<p class="muted small">ฟอนต์ "${esc(font.label)}" เป็นฟอนต์ที่คุณอัปโหลดเอง ร้านไม่ได้ให้สิทธิ์ใช้งานฟอนต์นี้ กรุณาตรวจว่ามีสิทธิ์ใช้เชิงพาณิชย์</p>`
    : `<p class="muted small">ฟอนต์ ${esc(font.label)} ใช้สัญญา SIL Open Font License ใช้เชิงพาณิชย์ได้ · <a href="/fonts/thai/${esc(font.id)}/OFL.txt">อ่านสัญญาฟอนต์</a></p>`;
  const outlineLabel = { none: 'ไม่มีขอบ', thin: 'ขอบบาง', medium: 'ขอบกลาง', thick: 'ขอบหนา' }[job.outline] || job.outline;
  const body = job.status === 'done' ? (one ? `
<section class="ready-box">
  <div class="ready-head">${ICON.check}<div><h2>พร้อมดาวน์โหลด</h2><p class="muted small">${esc(fileLabel(cfg, fmt))} · ${esc(SIZE_LABEL[job.size] || '')} · ${esc(job.seconds)} วินาที · ใช้กับ ${esc(ed.label)}</p></div></div>
  <a class="btn primary lg block" href="/library/custom/${esc(job.id)}/download">${ICON.download} ดาวน์โหลด · ${fmtBytes(one.bytes)}</a>
</section>
${ed.guide ? howToBlock(cfg, ed, fmt) : ''}
${fontNote}` : '<div class="note warn"><span>เวอร์ชันนี้สร้างด้วยระบบรุ่นก่อน กด "ทำอีกแบบจากเวอร์ชันนี้" เพื่อสร้างใหม่เป็นไฟล์เดียว</span></div>')
    : job.status === 'failed' ? `<div class="note warn">${ICON.shield}<span><b>สร้างไฟล์ไม่สำเร็จ</b> ${esc(job.error || '')}</span></div>
      <p><a class="btn primary" href="/library/${esc(job.order_id)}/customize?from=${esc(job.id)}">ลองอีกครั้ง</a></p>`
      : `<div class="job" data-job-poll="/library/custom/${esc(job.id)}/status">
      <div class="job-bar"><i data-job-bar style="width:${esc(job.progress)}%"></i></div>
      <p><b data-job-pct>${esc(job.progress)}%</b> · <span data-job-stage>${job.status === 'queued' ? `รอคิว (ลำดับที่ ${esc(position)})` : esc(job.stage || 'กำลังสร้าง')}</span></p>
      <p class="muted small">ปุ่มดาวน์โหลดจะขึ้นที่นี่เมื่อเสร็จ · ปิดหน้านี้ได้ งานจะทำต่อเบื้องหลัง และเก็บไว้ใน "เวอร์ชันของฉัน" ในคลัง</p>
    </div>`;
  return layout({
    title: `${job.text} · เวอร์ชันของฉัน`, shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-library',
    body: `
<style>${fontFaces(fonts)}</style>
<nav class="crumb" aria-label="ตำแหน่งหน้า"><a href="/library">คลังของฉัน</a><span>/</span><a href="/library/${esc(job.order_id)}/customize">ปรับแต่ง ${esc(p ? p.title : '')}</a><span>/</span><span aria-current="page">เวอร์ชันของฉัน</span></nav>
<div class="cz-summary">
  <div class="cz-mini" style="--fill:${esc(job.fill)}">
    <span class="cz-mini-text" style="font-family:'tt-${esc(font.id)}';font-weight:${esc(font.weight)};color:${esc(job.fill)};${job.outline !== 'none' ? `-webkit-text-stroke:.06em ${esc(job.stroke)};paint-order:stroke fill;` : ''}${job.shadow ? 'text-shadow:0 .08em .12em rgba(0,0,0,.55);' : ''}">${esc(job.text)}</span>
  </div>
  <div>
    <p class="eyebrow">เวอร์ชันของฉัน · ${statusBadge(job)}</p>
    <h1>${esc(job.text)}</h1>
    <p class="muted small">${esc(SIZE_LABEL[job.size] || '')} · ${esc(job.seconds)} วิ · ฟอนต์ ${esc(font.label)} · ${esc(outlineLabel)}${job.shadow ? ' · มีเงา' : ''} · สำหรับ ${esc(ed.label)} · สร้างเมื่อ ${esc(thDate(job.created_at))}</p>
  </div>
</div>
${body}
<div class="next-actions">
  <a class="btn" href="/library/${esc(job.order_id)}/customize?from=${esc(job.id)}">${ICON.edit} ทำอีกแบบจากเวอร์ชันนี้</a>
  <a class="btn ghost" href="/library">กลับไปที่คลัง</a>
</div>
${job.status === 'done' || job.status === 'failed' ? `<form method="post" action="/library/custom/${esc(job.id)}/delete" class="danger-zone" data-confirm="ลบเวอร์ชันนี้ออกจากคลัง? ไฟล์จะถูกลบถาวร">
  <input type="hidden" name="csrf" value="${esc(csrf)}">
  <button type="submit" class="linklike danger">ลบเวอร์ชันนี้</button>
</form>` : ''}`,
  });
}

function presetsPage({ cfg, user, csrf, presets, fonts, items }) {
  const fontLabel = (id) => (fonts.find((f) => f.id === id) || {}).label || 'ฟอนต์ที่ลบไปแล้ว';
  const outlineLabel = { none: 'ไม่มีขอบ', thin: 'ขอบบาง', medium: 'ขอบกลาง', thick: 'ขอบหนา' };
  const firstOrder = items[0];
  const rows = presets.map((x) => `
    <li class="preset-row">
      <span class="v-swatch" style="background:${esc(x.fill)};box-shadow:inset 0 0 0 3px ${esc(x.outline === 'none' ? x.fill : x.stroke)}"></span>
      <div class="preset-main">
        <form method="post" action="/library/styles/${esc(x.id)}/rename" class="rename">
          <input type="hidden" name="csrf" value="${esc(csrf)}">
          <input type="text" name="name" value="${esc(x.name)}" maxlength="60" required aria-label="ชื่อสไตล์">
          <button class="btn small" type="submit">เปลี่ยนชื่อ</button>
        </form>
        <small class="muted">${esc(fontLabel(x.font))} · ${esc(outlineLabel[x.outline] || x.outline)}${x.shadow ? ' · มีเงา' : ''}</small>
      </div>
      <div class="preset-row-actions">
        ${items.length ? `<details class="menu use-menu"><summary class="btn small primary">ใช้กับ…</summary><div class="menu-pop">${items.map((o) => `<a href="/library/${esc(o.id)}/customize?style=${esc(x.id)}">${esc((cfg.products.find((pp) => pp.slug === o.product_slug) || {}).title || o.product_slug)}</a>`).join('')}</div></details>` : ''}
        <form method="post" action="/library/styles/${esc(x.id)}/delete" data-confirm="ลบสไตล์ &quot;${esc(x.name)}&quot;?">
          <input type="hidden" name="csrf" value="${esc(csrf)}">
          <button class="linklike danger" type="submit">ลบ</button>
        </form>
      </div>
    </li>`).join('');
  return layout({
    title: 'สไตล์ของฉัน', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-library',
    body: `
<nav class="crumb" aria-label="ตำแหน่งหน้า"><a href="/library">คลังของฉัน</a><span>/</span><span aria-current="page">สไตล์ของฉัน</span></nav>
<div class="section-head lib-head"><div><p class="eyebrow">ฟอนต์ + สี + ขอบ + เงา ที่บันทึกไว้ ใช้ได้กับทุกแอนิเมชัน</p><h1>สไตล์ของฉัน</h1></div><p class="muted small">${presets.length} แบบ</p></div>
${presets.length ? `<ul class="presets">${rows}</ul>` : `<div class="empty"><p><b>ยังไม่มีสไตล์</b></p><p class="muted small">ในหน้าปรับแต่ง เลือกฟอนต์และสีที่ชอบ แล้วกด "+ บันทึกสไตล์นี้" ด้านบน</p>${firstOrder ? `<p><a class="btn primary" href="/library/${esc(firstOrder.id)}/customize">ไปหน้าปรับแต่ง</a></p>` : ''}</div>`}`,
  });
}

function fontsPage({ cfg, user, csrf, fonts, max }) {
  const thaiBadge = { full: ['มีอักษรไทยครบ', 'ok'], partial: ['อักษรไทยไม่ครบ', 'wait'], none: ['ไม่มีอักษรไทย', 'bad'] };
  const rows = fonts.map((f) => {
    const [label, cls] = thaiBadge[f.thai] || ['-', ''];
    return `<li class="font-row">
      <span class="font-row-sample" style="font-family:'tt-u-${esc(f.id)}'">${f.thai === 'none' ? 'Hello Aa' : 'สวัสดี Aa'}</span>
      <div><b>${esc(f.name)}</b><small class="muted">${esc(f.format.toUpperCase())} · ${fmtBytes(f.bytes)} · <span class="badge ${cls}">${label}</span></small></div>
      <form method="post" action="/library/fonts/${esc(f.id)}/delete" data-confirm="ลบฟอนต์ &quot;${esc(f.name)}&quot;? (เวอร์ชันที่สร้างไว้แล้วไม่หาย)">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <button class="linklike danger" type="submit">ลบ</button>
      </form>
    </li>`;
  }).join('');
  return layout({
    title: 'ฟอนต์ของฉัน', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-library',
    body: `
<style>${fonts.map((f) => `@font-face{font-family:"tt-u-${f.id}";src:url("/library/fonts/${f.id}/file");font-display:swap}`).join('\n')}</style>
<nav class="crumb" aria-label="ตำแหน่งหน้า"><a href="/library">คลังของฉัน</a><span>/</span><span aria-current="page">ฟอนต์ของฉัน</span></nav>
<div class="section-head lib-head"><div><p class="eyebrow">ใช้ตอนปรับแต่ง · เห็นเฉพาะบัญชีคุณ</p><h1>ฟอนต์ของฉัน</h1></div><p class="muted small">${fonts.length}/${max} ไฟล์</p></div>
<section class="box upload-box" data-font-upload>
  <h2>อัปโหลดฟอนต์</h2>
  <div class="note warn">${ICON.shield}<span><b>สำคัญ:</b> คุณต้องมีสิทธิ์ใช้ฟอนต์นี้ในงานเชิงพาณิชย์เอง ร้านให้สิทธิ์เฉพาะฟอนต์ที่ร้านจัดไว้ให้เท่านั้น ไม่ได้ให้สิทธิ์ใดๆ ในฟอนต์ที่คุณอัปโหลด</span></div>
  <label class="drop" data-drop>
    <input type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" data-font-file>
    <span>${ICON.download}<b>เลือกไฟล์ฟอนต์</b> หรือลากมาวางที่นี่<small>.ttf .otf .woff .woff2 · ไม่เกิน 5 MB</small></span>
  </label>
  <label class="check"><input type="checkbox" data-font-rights> ฉันยืนยันว่ามีสิทธิ์ใช้ฟอนต์นี้เชิงพาณิชย์</label>
  <button class="btn primary" type="button" data-font-send data-csrf="${esc(csrf)}" disabled>อัปโหลด</button>
  <p class="small" data-font-msg role="status"></p>
</section>
${fonts.length ? `<ul class="font-rows">${rows}</ul>` : '<p class="muted">ยังไม่มีฟอนต์ที่อัปโหลด</p>'}
<p class="muted small">ระบบตรวจทุกไฟล์ว่าเป็นฟอนต์จริงและมีอักษรไทยไหม อัปโหลดเสร็จจะพาไปหน้าปรับแต่งพร้อมเลือกฟอนต์นี้ให้เลย</p>`,
  });
}

function authPage({ cfg, user, csrf, mode, form = {}, error, next }) {
  const signup = mode === 'signup';
  return layout({
    title: signup ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-auth', intro: false,
    body: `
<div class="auth">
  <div class="auth-card">
    ${logoMark(48)}
    <h1>${signup ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}</h1>
    <p class="muted">${signup ? 'สร้างบัญชีเพื่อซื้อ และเก็บทุกอย่างไว้ในคลังของคุณ' : 'ยินดีต้อนรับกลับ เข้าสู่ระบบเพื่อซื้อหรือเปิดคลังของคุณ'}</p>
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <form method="post" action="/${signup ? 'signup' : 'login'}">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <input type="hidden" name="next" value="${esc(next || '/library')}">
      ${signup ? `<label class="field">ชื่อที่ใช้แสดง <span class="muted small">(ไม่บังคับ)</span>
        <input type="text" name="name" maxlength="80" autocomplete="name" value="${esc(form.name || '')}">
      </label>` : ''}
      <label class="field">อีเมล
        <input type="email" name="email" required maxlength="200" autocomplete="email" inputmode="email" value="${esc(form.email || '')}" placeholder="you@example.com" ${form.email ? '' : 'autofocus'}>
      </label>
      <label class="field">รหัสผ่าน ${signup ? '<span class="muted small">(อย่างน้อย 8 ตัวอักษร)</span>' : ''}
        <span class="pw"><input type="password" name="password" required minlength="${signup ? 8 : 1}" maxlength="200" autocomplete="${signup ? 'new-password' : 'current-password'}" ${form.email ? 'autofocus' : ''}><button type="button" class="pw-toggle" data-pw-toggle aria-label="แสดงรหัสผ่าน">แสดง</button></span>
      </label>
      <button class="btn primary block" type="submit">${signup ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}</button>
    </form>
    <p class="muted small center">${signup
    ? `มีบัญชีแล้ว? <a href="/login?next=${encodeURIComponent(next || '/library')}">เข้าสู่ระบบ</a>`
    : `ยังไม่มีบัญชี? <a href="/signup?next=${encodeURIComponent(next || '/library')}">สมัครสมาชิกฟรี</a>`}</p>
  </div>
</div>`,
  });
}
const login = (a) => authPage({ ...a, mode: 'login' });
const signup = (a) => authPage({ ...a, mode: 'signup' });

function licensePage({ cfg, user, csrf }) {
  return layout({
    title: 'สิทธิ์การใช้งาน', shopName: cfg.shopName, user, csrf,
    body: `
<div class="narrow">
  <p class="eyebrow">สิทธิ์การใช้งาน</p>
  <h1>ซื้อครั้งเดียว ใช้ได้ตลอด</h1>
  <p class="lead">${esc(LICENSE.short)}</p>
  <section class="box">
    <h2>ทำได้</h2>
    <ul class="ticks">${LICENSE.points.map((t) => `<li>${ICON.check}<span>${esc(t)}</span></li>`).join('')}</ul>
  </section>
  <section class="box">
    <h2>ห้าม</h2>
    <ul class="ticks no">${LICENSE.not.map((t) => `<li>${ICON.x}<span>${esc(t)}</span></li>`).join('')}</ul>
  </section>
  <p class="muted small">${esc(LICENSE.font)}</p>
  <p><a class="btn" href="/library">${ICON.library} เปิดคลังของฉัน</a> <a class="btn ghost" href="/license/kanit-ofl.txt">สัญญาฟอนต์ Kanit</a></p>
</div>`,
  });
}

function message({ cfg, user, csrf, title, text, action }) {
  return layout({
    title, shopName: cfg.shopName, user, csrf, noindex: true,
    body: `<div class="narrow"><h1>${esc(title)}</h1><p>${esc(text)}</p>
<p class="actions">${action ? `<a class="btn primary" href="${esc(action.href)}">${esc(action.label)}</a> ` : ''}<a class="btn" href="/">กลับหน้าร้าน</a></p></div>`,
  });
}

function admin({ cfg, user, csrf, orders, stats, tools, installHelp = [] }) {
  const { editors } = cfg.editorsConfig;
  const productTitle = (slug) => (cfg.products.find((p) => p.slug === slug) || {}).title || slug;
  const max = Math.max(1, ...stats.byEditor.map((r) => r.n));
  const bars = Object.keys(editors).map((id) => {
    const n = (stats.byEditor.find((r) => r.editor === id) || { n: 0 }).n;
    return `<div class="bar-row"><span>${esc(editors[id].label)}</span><div class="bar"><i style="width:${(n / max) * 100}%"></i></div><b>${n}</b></div>`;
  }).join('');
  const rows = orders.map((o) => `<tr>
    <td>${esc(thDate(o.created_at))}</td>
    <td><code>${esc(o.id.slice(0, 8))}</code></td>
    <td>${esc(productTitle(o.product_slug))}</td>
    <td>${esc((editors[o.editor] || {}).label || o.editor || '-')}</td>
    <td>${esc(o.email)}</td>
    <td>${baht(o.amount)}</td>
    <td><span class="tag ${o.status}">${o.status === 'paid' ? 'จ่ายแล้ว' : 'รอจ่าย'}</span></td>
    <td>${o.downloads ?? 0}</td>
  </tr>`).join('');
  return layout({
    title: 'หลังบ้าน', shopName: cfg.shopName, user, csrf, noindex: true, wide: true,
    body: `
<h1>หลังบ้าน</h1>
${cfg.paymentProvider === 'mock' ? '<div class="banner test">โหมดทดสอบการชำระเงิน (mock)</div>' : ''}
<div class="stats">
  <div class="stat"><span>คำสั่งซื้อที่จ่ายแล้ว</span><b>${stats.paid}</b></div>
  <div class="stat"><span>รอจ่าย</span><b>${stats.pending}</b></div>
  <div class="stat"><span>ยอดขาย</span><b>${baht(stats.revenue)}</b></div>
  <div class="stat"><span>สมาชิก</span><b>${stats.users}</b></div>
</div>
${tools ? `<div class="note${tools.ok ? '' : ' warn'}">${ICON.bolt}<span><b>ระบบปรับแต่ง (เรนเดอร์):</b> ${tools.ok ? `พร้อม · ใช้ ${esc(tools.browser.how)} + ffmpeg` : `ยังไม่พร้อม<br>${installHelp.map((l) => esc(l)).join('<br>')}`}</span></div>` : ''}
<h2>ลูกค้าโหลดไฟล์ไปใช้กับโปรแกรมไหน (นับต่อคำสั่งซื้อ)</h2>
<div class="bars">${bars}</div>
<h2>คำสั่งซื้อล่าสุด</h2>
<div class="table-wrap"><table>
<thead><tr><th>เวลา</th><th>รหัส</th><th>สินค้า</th><th>โปรแกรมล่าสุด</th><th>บัญชี</th><th>ราคา</th><th>สถานะ</th><th>โหลดแล้ว (ไฟล์)</th></tr></thead>
<tbody>${rows || '<tr><td colspan="8" class="muted">ยังไม่มีคำสั่งซื้อ</td></tr>'}</tbody>
</table></div>
<p class="muted small">ลูกค้าดาวน์โหลดใหม่ได้เองจากคลัง ไม่ต้องส่งลิงก์ให้</p>`,
  });
}

function emailBody({ cfg, order, p, user }) {
  return `สวัสดีค่ะ${user && user.name ? ` คุณ${user.name}` : ''}

ขอบคุณที่สั่งซื้อ "${p.title}" (${baht(order.amount)})
แอนิเมชันนี้อยู่ในคลังของบัญชี ${order.email} แล้ว

เปิดใช้งานได้ที่คลังของคุณ (เข้าสู่ระบบด้วยอีเมลนี้):
${cfg.baseUrl}/library/${order.id}

ในคลังเลือกโปรแกรมตัดต่อได้ตลอด แล้วโหลดไฟล์ที่ตรงกับโปรแกรมนั้น ทั้งคลิปเต็ม
และปรับแต่งข้อความ ฟอนต์ สี แนว และความยาวเองได้ (ได้เป็นไฟล์เดียว)

สิทธิ์การใช้งาน: ${LICENSE.short} ห้ามขายต่อหรือแจกต่อไฟล์ต้นฉบับ
อ่านเพิ่มเติม: ${cfg.baseUrl}/license

รหัสคำสั่งซื้อ: ${order.id.slice(0, 8)}
— ${cfg.shopName} · แอนิเมชันข้อความไทย`;
}

module.exports = { home, product, mockPay, orderStatus, library, libraryItem, customize, customStatus, presetsPage, fontsPage, login, signup, licensePage, message, admin, emailBody, esc, baht, LICENSE };

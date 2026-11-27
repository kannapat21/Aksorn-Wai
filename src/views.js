'use strict';
/* หน้าเว็บ (HTML ภาษาไทย) เขียนเป็นฟังก์ชันธรรมดา ไม่ใช้ template engine */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baht = (satang) => `฿${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
// ยอดโอนต้องมีทศนิยม 2 ตำแหน่งเสมอ (49.50 ไม่ใช่ 49.5) ให้ตรงกับที่แอปธนาคารแสดง
// ราคาที่แสดงบนหน้าร้าน: 0 = "ฟรี"
// ราคาที่แสดง: ของฟรี = "ฟรี" · ตัวพรีเมียม = อยู่ในแพ็กพรีเมียม (ซื้อแพ็กเดียวได้ทุกตัว)
let PACK_PRICE = 15000;
const priceLabel = (p) => (p.free ? 'ฟรี' : p.pack ? baht(p.price) : `แพ็ก ${baht(PACK_PRICE)}`);
// หน้าที่ลูกค้ากลับไปดูสินค้า/สั่งใหม่ (แพ็กไปหน้า /premium)
const productHref = (p) => (p && p.pack ? '/premium' : `/p/${esc(p && p.slug)}`);
const bahtExact = (satang) => `฿${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const thDate = (ms) => new Date(ms).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
const thTime = (ms) => new Date(ms).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) + ' น.';
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
  font: 'ฟอนต์ไทยทุกตัวที่ร้านให้เลือกใช้สัญญา SIL Open Font License ใช้ในงานเชิงพาณิชย์ได้',
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
  cc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.5 10.2a2.4 2.4 0 1 0 0 3.6M17 10.2a2.4 2.4 0 1 0 0 3.6"/></svg>',
  crown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>',
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

function layout({ title, body, shopName, user = null, csrf = '', noindex = false, wide = false, page = '', intro = true, tab = '' }) {
  const account = user ? `
      ${user.role === 'admin' ? `<a href="/admin" class="btn small primary nav-lib">${ICON.shield}<span>หลังบ้าน</span></a>` : `<a href="/library" class="btn small ghost nav-lib">${ICON.library}<span>คลังของฉัน</span></a>`}
      <details class="menu">
        <summary class="icon-btn" aria-label="บัญชี">${ICON.user}</summary>
        <div class="menu-pop">
          <p class="muted small">${esc(user.name || user.email)}<br>${user.name ? esc(user.email) : ''}</p>
          <a href="/account">${ICON.user}<span>บัญชีของฉัน</span></a>
          <a href="/library">${ICON.library}<span>คลังของฉัน</span></a>
          <a href="/library/styles">${ICON.edit}<span>สไตล์ของฉัน</span></a>
          <a href="/library/fonts">${ICON.film}<span>ฟอนต์ของฉัน</span></a>
          ${user.role === 'admin' ? `<a href="/admin">${ICON.shield}<span>หลังบ้าน</span></a>` : ''}
          <hr>
          <a href="/license">${ICON.infinity}<span>สิทธิ์การใช้งาน</span></a>
          <a href="/terms">${ICON.check}<span>เงื่อนไขการใช้งาน</span></a>
          <a href="/refund">${ICON.check}<span>นโยบายคืนเงิน</span></a>
          <a href="/privacy">${ICON.shield}<span>ความเป็นส่วนตัว (PDPA)</span></a>
          <a href="/contact">${ICON.mail}<span>ติดต่อร้าน</span></a>
          <hr>
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
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="theme-color" content="#1E3A5F">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="อักษรไหว">
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
      <a href="/subtitles" class="nav-sub">${ICON.cc}<span>ใส่ซับอัตโนมัติ</span><span class="beta">Beta</span></a>
      <a href="/#catalog">${ICON.film}<span>แอนิเมชัน</span></a>
      <a href="/premium" class="nav-pack">${ICON.crown}<span>พรีเมียม</span></a>
    </nav>
    <div class="account">${account}</div>
    <button type="button" class="icon-btn" data-theme-toggle aria-label="สลับโหมดสว่าง/มืด">
      <span class="i-sun">${ICON.sun}</span><span class="i-moon">${ICON.moon}</span>
    </button>
  </div>
</header>
<main id="main" class="${wide ? 'wide' : ''}">
${user && !user.email_verified_at && !user.hideVerifyBar ? `<div class="verify-bar" role="status">${ICON.mail}<span>ยืนยันอีเมล <b>${esc(user.email)}</b> เพื่อรับใบยืนยันการซื้อและกู้รหัสผ่านได้ · เราส่งลิงก์ไปให้แล้ว</span>
  <form method="post" action="/verify-email/resend"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="linklike" type="submit">ส่งอีกครั้ง</button></form></div>` : ''}
${body}
</main>
<footer class="foot">
  <div class="foot-in">
    <div class="foot-brand">${brand(shopName)}
      <p>แอนิเมชันข้อความภาษาไทยสำหรับคนตัดต่อ ${esc(LICENSE.short)}</p></div>
    <nav class="foot-links" aria-label="ลิงก์ท้ายเว็บ">
      <a href="/#catalog">แอนิเมชันทั้งหมด</a>
      <a href="/premium">แพ็กพรีเมียม</a>
      <a href="/subtitles">ใส่ซับอัตโนมัติ (Beta)</a>
      <a href="/library">คลังของฉัน</a>
      <a href="/license">สิทธิ์การใช้งาน</a>
      <a href="/terms">เงื่อนไขการใช้งาน</a>
      <a href="/refund">นโยบายคืนเงิน</a>
      <a href="/privacy">ความเป็นส่วนตัว (PDPA)</a>
      <a href="/contact">ติดต่อร้าน</a>
    </nav>
    <div class="foot-meta">
      <span>${ICON.shield} ลิงก์ดาวน์โหลดเข้ารหัสลายเซ็น</span>
      <span>${ICON.infinity} ซื้อครั้งเดียว ใช้ได้ตลอด</span>
      <a href="/license#fonts">ฟอนต์ไทยของร้าน · SIL Open Font License</a>
    </div>
  </div>
</footer>
<button type="button" class="to-top" data-to-top aria-label="กลับขึ้นด้านบน" hidden>${ICON.up}</button>
<nav class="tabbar" aria-label="เมนูแอป" data-tabbar>
  <a href="/" data-tab="home"${tab === 'home' ? ' class="active"' : ''}>${ICON.grid}<span>หน้าแรก</span></a>
  <a href="/#catalog" data-tab="shop"${tab === 'shop' ? ' class="active"' : ''}>${ICON.film}<span>แอนิเมชัน</span></a>
  <a href="/subtitles" data-tab="subs" class="tab-sub${tab === 'subs' ? ' active' : ''}"><span class="tab-ico">${ICON.cc}<span class="beta">Beta</span></span><span>ใส่ซับ</span></a>
  <a href="/library" data-tab="library"${tab === 'library' ? ' class="active"' : ''}>${ICON.library}<span>คลัง</span></a>
  <a href="/account" data-tab="account"${tab === 'account' ? ' class="active"' : ''}>${ICON.user}<span>${user ? 'บัญชี' : 'เข้าสู่ระบบ'}</span></a>
</nav>
<script src="/app.js?v=${V}" defer></script>
</body>
</html>`;
}

function card(p, i, owned) {
  const tier = p.free ? 'free' : 'premium';
  const have = owned && owned.has(p.slug);
  return `
    <article class="card" data-card data-cat="${tier}" data-price="${esc(p.price)}" data-order="${i}" data-search="${esc([p.title, p.subtitle].join(' ').toLowerCase())}">
      <a class="card-link" href="/p/${esc(p.slug)}" aria-label="${esc(p.title)} ${priceLabel(p)}">
        <div class="thumb" data-hover-play>
          <img src="/previews/${esc(p.slug)}_horizontal.jpg" alt="" loading="lazy" width="960" height="540">
          <video data-src="/previews/${esc(p.slug)}_horizontal.mp4" muted loop playsinline preload="none"></video>
          ${p.free ? '<span class="badge-free">ฟรี</span>' : '<span class="badge-premium">พรีเมียม</span>'}
          ${have ? '<span class="dur owned">อยู่ในคลังแล้ว</span>' : ''}
        </div>
        <div class="card-body">
          <h3>${esc(p.title)}</h3>
          <p class="muted small">${esc(p.subtitle || '')}</p>
          <div class="card-foot">
            <span class="price${p.free ? ' free' : ''}">${priceLabel(p)}</span>
            <span class="card-cta">${have ? 'เปิดใช้' : p.free ? 'รับฟรี' : 'ดูตัวอย่าง'} ›</span>
          </div>
        </div>
      </a>
    </article>`;
}

// ไทม์ไลน์ตัวอย่าง: ส่วนเข้า | ภาพนิ่ง (ยืดได้) | ส่วนออก
function kitTimeline({ big = false, p = null } = {}) {
  const tm = p && p.manifest && p.manifest.timing;
  const inSec = tm && tm.settle ? tm.settle : 0.5;
  const outSec = tm && tm.fadeStart ? Math.round((p.manifest.duration - tm.fadeStart) * 10) / 10 : 0.5;
  return `<div class="timeline${big ? ' big' : ''}" aria-hidden="true">
    <div class="tl-track">
      <span class="tl-clip in"><b>${p && p.fancy ? 'ท่าเข้า' : 'เด้งเข้า'}</b><small>${inSec} วิ</small></span>
      <span class="tl-clip hold"><b>ข้อความค้าง</b><small>นานเท่าที่เลือก 3–30 วิ</small><i class="tl-handle"></i></span>
      <span class="tl-clip out"><b>${p && p.fancy ? 'ท่าออก' : 'จางออก'}</b><small>${outSec} วิ</small></span>
    </div>
    <div class="tl-track ghost"><span class="tl-clip base">คลิปของคุณ</span></div>
  </div>`;
}

// กล่องแพ็กพรีเมียม (หน้าแรก / หน้าสินค้า / คลัง): มีแล้ว · รอโอน/รอตรวจ · ปุ่มซื้อ
function packCta({ pack, user, csrf, big = false }) {
  if (pack.owned) return `<div class="owned-box">${ICON.check}<span>คุณมีแพ็กพรีเมียมแล้ว ใช้ได้ทุกแบบ</span></div>`;
  if (pack.open) {
    const href = pack.open.status === 'review' ? `/order/${esc(pack.open.id)}` : `/pay/transfer/${esc(pack.open.id)}`;
    return `<a class="btn primary block${big ? ' lg' : ''}" href="${href}">${pack.open.status === 'review' ? 'แจ้งโอนแล้ว · ดูสถานะ' : `ไปหน้าโอนเงิน ${baht(pack.price)}`}</a>`;
  }
  if (!user) return `<a class="btn primary block${big ? ' lg' : ''}" href="/login?next=%2Fpremium">ปลดล็อกพรีเมียม ${baht(pack.price)}</a>`;
  return `<form method="post" action="/checkout" data-checkout id="pack-form">
    <input type="hidden" name="product" value="${esc(pack.slug)}">
    <input type="hidden" name="csrf" value="${esc(csrf)}">
    <button class="btn primary block${big ? ' lg' : ''}" type="submit"><span>ปลดล็อกพรีเมียม ${baht(pack.price)}</span></button>
  </form>`;
}

function home({ cfg, user, csrf, products, owned = new Set(), pack }) {
  const cards = products.map((p, i) => card(p, i, owned)).join('');
  const freeCount = products.filter((p) => p.free).length;
  const premCount = products.length - freeCount;
  const lead = products.find((p) => p.premium) || products[0];
  const phrases = ['ลากใส่คลิปได้ทันที', 'ใส่ซับอัตโนมัติในคลิก', 'ยืดความยาวได้ตามใจ', 'ซื้อครั้งเดียว ใช้ได้ตลอด'];
  const editorCount = Object.values(cfg.editorsConfig.editors).filter((e) => !/อื่น/.test(e.label)).length;
  return layout({
    title: 'แอนิเมชันข้อความภาษาไทย', shopName: cfg.shopName, user, csrf, page: 'page-home', tab: 'home',
    body: `
<section class="hero"><div class="hero-grid" aria-hidden="true"></div>
  <div class="hero-copy">
    <p class="eyebrow pill"><span class="dot"></span> ร้านแอนิเมชันข้อความภาษาไทย สำหรับคนตัดต่อ</p>
    <h1 class="type" aria-label="ข้อความเคลื่อนไหวพร้อมใช้ ${esc(phrases[0])}">
      <span class="type-line" data-type-static aria-hidden="true">ข้อความเคลื่อนไหวพร้อมใช้</span>
      <span class="type-line hl-line" aria-hidden="true"><span class="hl" data-type-rotate="${esc(JSON.stringify(phrases))}">${esc(phrases[0])}</span><span class="caret"></span></span>
    </h1>
    <p class="lead">เลือกแอนิเมชัน พิมพ์ข้อความเอง เปลี่ยนฟอนต์ สี ความยาวได้ แล้วโหลดไฟล์ที่ตรงกับโปรแกรมตัดต่อของคุณ</p>
    <div class="hero-cta">
      <a class="btn primary lg" href="#catalog">ดูแอนิเมชันทั้งหมด</a>
    </div>
    <ul class="facts">
      <li><b>${products.length}</b><span>แอนิเมชัน</span></li>
      <li><b>${freeCount}</b><span>แบบฟรี</span></li>
      <li><b>${baht(cfg.premiumPack.price)}</b><span>ได้พรีเมียมทุกแบบ</span></li>
      <li><b>${editorCount}+</b><span>โปรแกรมตัดต่อ</span></li>
    </ul>
  </div>
  ${lead ? `<a class="hero-visual" href="/p/${esc(lead.slug)}" aria-label="ดูตัวอย่าง ${esc(lead.title)}" data-tilt>
    <div class="window">
      <div class="window-bar"><i></i><i></i><i></i><span>ตัวอย่าง · ${esc(lead.title)}</span></div>
      <video src="/previews/${esc(lead.slug)}_horizontal.mp4" poster="/previews/${esc(lead.slug)}_horizontal.jpg" autoplay muted loop playsinline preload="metadata"></video>
      ${kitTimeline({ p: lead })}
    </div>
  </a>` : ''}
</section>

<section class="app-home">
  <h1 class="app-hello">${user ? `สวัสดี${user.name ? ` ${esc(user.name)}` : ''}` : 'ทำคลิปให้ปังขึ้น'}<small>วันนี้จะทำอะไรดี</small></h1>
  <div class="tools">
    <a class="tool tool-main" href="/subtitles">
      <span class="tool-ico">${ICON.cc}</span>
      <span class="tool-txt"><b>ใส่ซับอัตโนมัติ <span class="beta">Beta</span></b><small>อัปคลิป ได้ซับไทยพร้อมแอนิเมชัน</small></span>
      <span class="tool-go" aria-hidden="true">›</span>
    </a>
    <a class="tool" href="#catalog">
      <span class="tool-ico">${ICON.film}</span>
      <span class="tool-txt"><b>แอนิเมชันข้อความ</b><small>ฟรี ${freeCount} · พรีเมียม ${premCount}</small></span>
    </a>
    <a class="tool" href="/library">
      <span class="tool-ico">${ICON.library}</span>
      <span class="tool-txt"><b>คลังของฉัน</b><small>ปรับแต่งแล้วโหลด</small></span>
    </a>
  </div>
  ${premCount ? `<a class="pack-banner${pack && pack.owned ? ' have' : ''}" href="/premium">
    <span class="pack-ico">${ICON.crown}</span>
    <span class="pack-txt"><b>${pack && pack.owned ? 'คุณมีแพ็กพรีเมียมแล้ว' : `แพ็กพรีเมียม ${baht(cfg.premiumPack.price)}`}</b><small>${pack && pack.owned ? `ใช้ได้ทุกแบบ ${premCount} แบบ + แบบใหม่` : `ได้ครบ ${premCount} แบบ + แบบใหม่ในอนาคต จ่ายครั้งเดียว`}</small></span>
    <span class="pack-go">${pack && pack.owned ? 'ดู' : 'ปลดล็อก'}</span>
  </a>` : ''}
</section>

<section id="catalog" class="catalog">
  <div class="section-head">
    <h2>แอนิเมชันข้อความ</h2>
    <p class="muted small" data-count-label aria-live="polite">${products.length} แบบ</p>
  </div>
  <div class="chips filter" role="group" aria-label="กรอง">
    <button type="button" class="chip active" data-cat-btn="">ทั้งหมด</button>
    ${freeCount ? '<button type="button" class="chip" data-cat-btn="free">ฟรี</button>' : ''}
    ${premCount ? '<button type="button" class="chip" data-cat-btn="premium">พรีเมียม</button>' : ''}
  </div>
  <div class="grid" data-grid>${cards}</div>
  <div class="empty" data-empty hidden>
    <p><b>ไม่พบแอนิเมชัน</b></p>
    <p class="muted small"><button type="button" class="linklike" data-reset>ดูทั้งหมด</button></p>
  </div>
</section>`,
  });
}

// หน้าแพ็กพรีเมียม: จ่ายครั้งเดียว ได้ทุกแบบที่มีแท็กพรีเมียม (รวมแบบใหม่ที่เพิ่มทีหลัง)
function packPage({ cfg, user, csrf, pack, products }) {
  const manualPay = cfg.paymentProvider === 'manual';
  return layout({
    title: 'แพ็กพรีเมียม', shopName: cfg.shopName, user, csrf, page: 'page-pack', tab: 'shop',
    body: `
<section class="pack-hero">
  <span class="pack-ico big">${ICON.crown}</span>
  <h1>แพ็กพรีเมียม</h1>
  <p class="price big">${baht(pack.price)} <span class="price-note">จ่ายครั้งเดียว ใช้ได้ตลอด</span></p>
  <ul class="pack-ticks">
    <li>${ICON.check} ได้ครบ ${products.length} แบบพรีเมียม</li>
    <li>${ICON.check} แบบใหม่ที่ร้านเพิ่มทีหลัง ได้ฟรีอัตโนมัติ</li>
    <li>${ICON.check} ใช้กับซับอัตโนมัติได้ทุกแบบ</li>
    <li>${ICON.check} ${manualPay ? 'สแกนจ่าย PromptPay เข้าคลังเมื่อร้านยืนยัน' : 'เข้าคลังทันทีหลังจ่าย'}</li>
  </ul>
  <div class="pack-buy">${packCta({ pack, user, csrf, big: true })}</div>
  ${!pack.owned && user ? `<p class="muted small center">การกดซื้อถือว่ายอมรับ <a href="/terms">เงื่อนไขการใช้งาน</a> และ <a href="/refund">นโยบายคืนเงิน</a></p>` : ''}
</section>
<section class="catalog">
  <div class="section-head"><h2>อยู่ในแพ็ก</h2><p class="muted small">${products.length} แบบ</p></div>
  <div class="grid">${products.map((p, i) => card(p, i, null)).join('')}</div>
</section>
<div class="buy-bar" data-buy-bar>
  <div><b>แพ็กพรีเมียม</b><span class="price">${baht(pack.price)}</span></div>
  ${pack.owned ? '<a class="btn primary" href="/library">เปิดคลัง</a>' : pack.open ? `<a class="btn primary" href="${pack.open.status === 'review' ? `/order/${esc(pack.open.id)}` : `/pay/transfer/${esc(pack.open.id)}`}">ดูสถานะ</a>` : user ? '<button class="btn primary" type="submit" form="pack-form">ปลดล็อก</button>' : '<a class="btn primary" href="/login?next=%2Fpremium">ปลดล็อก</a>'}
</div>`,
  });
}

function editorOptions(editors, selected) {
  return Object.entries(editors).map(([id, e]) => `
    <label class="opt"><input type="radio" name="editor" value="${esc(id)}" ${id === selected ? 'checked' : ''} required>
      <span>${esc(e.label)}</span></label>`).join('');
}

function product({ cfg, user, csrf, p, owned, pack = null }) {
  const manualPay = cfg.paymentProvider === 'manual';
  // โหมดโอนเอง: สินค้าเข้าคลังเมื่อร้านยืนยันยอด (ไม่ใช่ "ทันที")
  const payWhen = (a) => (manualPay ? a.replace('ทันทีหลังชำระเงินสำเร็จ', 'ทันทีที่ร้านยืนยันยอดโอน (ปกติไม่นาน)') : a);
  const faq = (p.faq || []).map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(payWhen(f.a))}</p></details>`).join('');
  const tags = [p.category, ...(p.tags || [])].filter(Boolean);
  return layout({
    title: p.title, shopName: cfg.shopName, user, csrf, page: 'page-product', tab: 'shop',
    body: `
<a class="back-link" href="/#catalog">‹ แอนิเมชันทั้งหมด</a>
<div class="pd">
  <div class="pd-main">
    <div class="preview-head">
      <div class="preview-tabs seg" data-tabs role="tablist">
        <button type="button" class="tab active" data-show="h" role="tab" aria-selected="true">แนวนอน 16:9</button>
        <button type="button" class="tab" data-show="v" role="tab" aria-selected="false">แนวตั้ง 9:16</button>
      </div>
      <span class="muted small">ตัวอย่างมีลายน้ำ ไฟล์จริงไม่มี</span>
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
      <p class="muted">นอกจากคลิปเต็ม ${esc(p.manifest.duration)} วินาที ยังเปลี่ยนข้อความ ฟอนต์ สี แนว และความยาว (สูงสุด 30 วินาที) ได้เอง ได้เป็นไฟล์เดียวที่ตรงกับโปรแกรมที่ใช้${p.fancy ? ' ช่วงค้างมีลูกเล่นวนต่อเนื่องเนียนตลอดความยาวที่เลือก' : ''}</p>
      ${kitTimeline({ p })}
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
      ${p.free ? `<p class="price big free">ฟรี <span class="price-note">ไม่ต้องจ่าย ใช้ได้ตลอด</span></p>` : `<p class="price big"><span class="badge-premium">${ICON.crown} พรีเมียม</span> <span class="price-note">อยู่ในแพ็กพรีเมียม ${baht(cfg.premiumPack.price)} ได้ทุกแบบ</span></p>`}
      ${owned ? `
      <div class="owned-box">${ICON.check}<span>คุณมีแอนิเมชันนี้ในคลังแล้ว</span></div>
      <a class="btn primary block" href="/library/${esc(owned.id)}">เปิดใช้จากคลัง</a>` : !p.free && pack ? `
      ${packCta({ pack, user, csrf })}
      <p class="muted small center"><a href="/premium">ดูทุกแบบในแพ็ก (${esc(pack.count)} แบบ)</a> · แบบใหม่ได้ฟรีอัตโนมัติ</p>` : user ? `
      <form method="post" action="/checkout" data-checkout id="buy-form">
        <input type="hidden" name="product" value="${esc(p.slug)}">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <button class="btn primary block" type="submit"><span>รับฟรีเข้าคลัง</span></button>
      </form>
      <p class="muted small center">การกดรับถือว่ายอมรับ <a href="/terms">เงื่อนไขการใช้งาน</a></p>` : `
      <a class="btn primary block" href="/login?next=${encodeURIComponent('/p/' + p.slug)}">เข้าสู่ระบบเพื่อรับฟรี</a>
      <p class="muted small center">ยังไม่มีบัญชี? <a href="/signup?next=${encodeURIComponent('/p/' + p.slug)}">สมัครฟรี</a></p>`}
      <ul class="assure">
        <li>${ICON.bolt} ${p.free ? 'กดรับแล้วเข้าคลังทันที' : manualPay ? 'สแกนจ่ายแพ็กครั้งเดียว เข้าคลังเมื่อร้านยืนยันยอด' : 'ได้ทุกแบบพรีเมียมทันทีหลังชำระเงิน'}</li>
        <li>${ICON.edit} ปรับข้อความ ฟอนต์ สี และความยาวเองได้</li>
        <li>${ICON.infinity} อยู่ในคลังตลอด ใช้งานลูกค้าได้</li>
      </ul>
    </section>
  </aside>
</div>
<div class="buy-bar" data-buy-bar>
  <div><b>${esc(p.title)}</b><span class="price${p.free ? ' free' : ''}">${priceLabel(p)}</span></div>
  ${owned ? `<a class="btn primary" href="/library/${esc(owned.id)}">เปิดในคลัง</a>`
    : !p.free ? (pack && pack.open ? `<a class="btn primary" href="${pack.open.status === 'review' ? `/order/${esc(pack.open.id)}` : `/pay/transfer/${esc(pack.open.id)}`}">ดูสถานะ</a>` : user ? '<button class="btn primary" type="submit" form="pack-form">ปลดล็อกแพ็ก</button>' : '<a class="btn primary" href="/login?next=%2Fpremium">ปลดล็อกแพ็ก</a>')
      : user ? '<button class="btn primary" type="submit" form="buy-form">รับฟรี</button>'
        : `<a class="btn primary" href="/login?next=${encodeURIComponent('/p/' + p.slug)}">รับฟรี</a>`}
</div>`,
  });
}

function mockPay({ cfg, user, csrf, order, p, allowed = true }) {
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
${allowed ? `<form method="post" action="/pay/mock/${esc(order.id)}/simulate">
  <input type="hidden" name="csrf" value="${esc(csrf)}">
  <button class="btn primary block" type="submit">จำลองจ่ายสำเร็จ</button>
</form>` : '<div class="note warn"><span><b>ร้านยังไม่เปิดรับชำระเงิน</b> ตอนนี้เป็นโหมดทดสอบ ปุ่มจำลองจ่ายใช้ได้เฉพาะเจ้าของร้าน</span></div>'}
<p><a href="${productHref(p)}">ยกเลิก</a></p>
</div>`,
  });
}

function omisePay({ cfg, user, csrf, order, p, publicKey, qr, error }) {
  const test = /_test_/.test(publicKey);
  const back = `/pay/omise/${esc(order.id)}`;
  const failed = order.status === 'failed' || order.status === 'expired';
  return layout({
    title: 'ชำระเงิน', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-pay', intro: false,
    body: `
<div class="narrow pay">
  ${test ? '<div class="banner test">โหมดทดสอบของ Omise: ไม่มีการตัดเงินจริง ใช้บัตรทดสอบ 4242 4242 4242 4242 (วันหมดอายุในอนาคต CVV อะไรก็ได้)</div>' : ''}
  <h1>ชำระเงิน</h1>
  <div class="box pay-sum"><div><b>${esc(p.title)}</b><small class="muted">คำสั่งซื้อ ${esc(order.id.slice(0, 8))} · เข้าคลังทันทีที่จ่ายสำเร็จ</small></div><span class="price big">${baht(order.amount)}</span></div>
  ${error ? `<p class="error" role="alert">${esc(error)}</p>` : failed ? `<p class="error" role="alert">${order.status === 'expired' ? 'QR หมดอายุแล้ว' : 'การชำระเงินครั้งก่อนไม่สำเร็จ'} ลองใหม่ได้เลย</p>` : ''}
  ${qr ? `
  <section class="box qr-box" data-poll="/order/${esc(order.id)}/status">
    <h2>สแกนจ่ายด้วยแอปธนาคาร (PromptPay)</h2>
    <img src="${back}/qr" alt="QR PromptPay ยอด ${baht(order.amount)}" width="280" height="280" class="qr-img">
    <p class="muted small">QR หมดอายุ ${esc(qr.expiresAt ? new Date(qr.expiresAt).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }) : '')} น. · จ่ายแล้วหน้านี้จะเปลี่ยนเอง</p>
    <div class="spinner" aria-hidden="true"></div>
    <p class="small"><a href="${back}">เปลี่ยนวิธีจ่าย</a></p>
    ${test ? '<p class="muted small">โหมดทดสอบ: เปิด dashboard.omise.co → Charges → เลือกรายการนี้ → Actions → Mark as Successful</p>' : ''}
  </section>` : `
  <section class="box">
    <h2>PromptPay (สแกน QR)</h2>
    <p class="muted small">สแกนด้วยแอปธนาคารไหนก็ได้ ไม่มีค่าธรรมเนียมฝั่งลูกค้า</p>
    <form method="post" action="${back}/promptpay"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="btn primary block lg" type="submit">สร้าง QR PromptPay</button></form>
  </section>
  <section class="box card-box">
    <h2>บัตรเครดิต / เดบิต</h2>
    <p class="muted small">เลขบัตรส่งตรงไปที่ Omise อย่างปลอดภัย ร้านไม่เห็นและไม่เก็บเลขบัตร</p>
    <form method="post" action="${back}/card" data-omise-card data-pkey="${esc(publicKey)}">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <input type="hidden" name="omiseToken" data-omise-token>
      <label class="field">ชื่อบนบัตร<input type="text" data-card="name" autocomplete="cc-name" required></label>
      <label class="field">เลขบัตร<input type="text" data-card="number" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" required></label>
      <div class="card-row">
        <label class="field">เดือน<input type="text" data-card="expiration_month" inputmode="numeric" autocomplete="cc-exp-month" placeholder="MM" maxlength="2" required></label>
        <label class="field">ปี<input type="text" data-card="expiration_year" inputmode="numeric" autocomplete="cc-exp-year" placeholder="YYYY" maxlength="4" required></label>
        <label class="field">CVV<input type="text" data-card="security_code" inputmode="numeric" autocomplete="cc-csc" maxlength="4" required></label>
      </div>
      <p class="error small" data-card-error hidden></p>
      <button class="btn primary block lg" type="submit">จ่าย ${baht(order.amount)} ด้วยบัตร</button>
    </form>
  </section>`}
  <p class="muted small center">การชำระเงินดำเนินการโดย Omise (Opn Payments) · <a href="/refund">นโยบายคืนเงิน</a> · <a href="${productHref(p)}">ยกเลิก</a></p>
</div>
<script src="https://cdn.omise.co/omise.js"></script>
<script src="/pay.js?v=${V}" defer></script>`,
  });
}

function transferPay({ cfg, user, csrf, order, p, expiresAt, error }) {
  const T = cfg.transfer;
  const amt = bahtExact(order.transfer_amount);
  const satang = String(order.transfer_amount % 100).padStart(2, '0');
  const bank = T.bankName && T.bankAccountNo && T.bankAccountName;
  const rejected = order.status === 'rejected';
  return layout({
    title: 'โอนเงิน', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-pay', intro: false,
    body: `
<div class="narrow pay transfer" data-order="${esc(order.id)}">
  <h1>โอนเงินเพื่อรับสินค้า</h1>
  ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
  ${rejected ? `<div class="note warn"><span><b>ร้านยังไม่พบรายการโอนนี้</b><br>${esc(order.review_note || '')}<br><span class="small">ตรวจยอดและบัญชีผู้รับอีกครั้ง ถ้าโอนแล้วจริงกด "ยืนยันการโอนเงิน" ใหม่ด้านล่างได้</span></span></div>` : ''}
  <div class="box pay-sum"><div><b>${esc(p.title)}</b><small class="muted">ราคา ${esc(baht(order.amount))} · ซื้อครั้งเดียว ใช้ได้ตลอด</small></div></div>

  <section class="box xfer-amount" aria-label="ยอดที่ต้องโอน">
    <p class="eyebrow">ยอดที่ต้องโอน (โอนให้ตรงทุกสตางค์)</p>
    <p class="xfer-big"><span data-copy-text="${esc((order.transfer_amount / 100).toFixed(2))}">${esc(amt)}</span></p>
    <button type="button" class="btn small" data-copy="${esc((order.transfer_amount / 100).toFixed(2))}">คัดลอกยอด</button>
    ${T.uniqueSatang
    ? `<p class="muted small">เศษสตางค์ <b>.${esc(satang)}</b> ใช้ให้ร้านจับคู่กับออเดอร์ของคุณ ถ้าโอนไม่ตรงยอด ร้านจะหารายการไม่เจอและอนุมัติไม่ได้</p>`
    : '<p class="muted small">โอนตามยอดนี้เป๊ะ แล้วกด "ยืนยันการโอนเงิน" ด้านล่างทันทีหลังโอนเสร็จ</p>'}
  </section>

  ${T.promptpayId ? `<section class="box xfer-qr">
    <h2>สแกนจ่ายด้วย PromptPay</h2>
    <div class="qr-frame"><img class="qr-img" src="/pay/transfer/${esc(order.id)}/qr" alt="QR PromptPay ยอด ${esc(amt)}" width="280" height="280"><i class="qr-scan" aria-hidden="true"></i></div>
    <a class="btn block save-qr" href="/pay/transfer/${esc(order.id)}/qr.png" download="QR-${esc(order.pay_ref)}.png">${ICON.download} บันทึกรูป QR</a>
    <p class="muted small">จ่ายจากมือถือเครื่องนี้? กดบันทึกรูป แล้วเปิดแอปธนาคาร เลือกสแกนจากรูปภาพ ยอด ${esc(amt)} จะขึ้นให้เอง${T.promptpayName ? `<br>ชื่อผู้รับ: <b>${esc(T.promptpayName)}</b>` : ''}</p>
  </section>` : ''}

  ${bank ? `<section class="box xfer-bank">
    <h2>${T.promptpayId ? 'หรือโอนเข้าบัญชี' : 'โอนเข้าบัญชี'}</h2>
    <dl class="xfer-dl">
      <div><dt>ธนาคาร</dt><dd>${esc(T.bankName)}</dd></div>
      <div><dt>เลขบัญชี</dt><dd><b data-copy-text="${esc(T.bankAccountNo.replace(/\D/g, ''))}">${esc(T.bankAccountNo)}</b> <button type="button" class="btn small" data-copy="${esc(T.bankAccountNo.replace(/\D/g, ''))}">คัดลอก</button></dd></div>
      <div><dt>ชื่อบัญชี</dt><dd>${esc(T.bankAccountName)}</dd></div>
    </dl>
  </section>` : ''}

  <section class="box xfer-ref">
    <p class="eyebrow">รหัสอ้างอิงออเดอร์</p>
    <p class="xfer-code">${esc(order.pay_ref)}</p>
    <p class="muted small">ถ้าแอปธนาคารมีช่อง "บันทึกช่วยจำ" ใส่รหัสนี้ลงไปด้วย ช่วยให้ร้านจับคู่ได้ง่ายขึ้น (ไม่บังคับ) · ออเดอร์นี้เก็บไว้ให้ถึง ${esc(thDate(expiresAt))}</p>
  </section>

  <form class="box xfer-confirm" method="post" action="/pay/transfer/${esc(order.id)}/confirm" data-confirm-title="โอนเงินแล้วใช่ไหม?" data-confirm="ยอด ${esc(amt)} · กดยืนยันแล้วร้านจะตรวจรายการ และส่งสินค้าเข้าคลังให้" data-confirm-ok="โอนแล้ว ยืนยันเลย" data-confirm-cancel="ยังไม่ได้โอน">
    <input type="hidden" name="csrf" value="${esc(csrf)}">
    <h2>โอนแล้วใช่ไหม</h2>
    <button class="btn primary block lg" type="submit">ยืนยันการโอนเงิน</button>
    <p class="muted small center">กดแล้วระบบจะแจ้งร้านให้ตรวจสอบ สินค้าจะเข้าคลังเมื่อร้านอนุมัติ (ไม่ได้เข้าทันที)</p>
  </form>
  <p class="center"><a href="${productHref(p)}">ยกเลิก</a></p>
</div>
<script src="/transfer.js?v=${V}" defer></script>`,
  });
}

function adminTransfers({ cfg, user, csrf, waiting, recent, audit, done, problem }) {
  const productTitle = (slug) => (slug === cfg.premiumPack.slug ? cfg.premiumPack.title : (cfg.products.find((p) => p.slug === slug) || {}).title || slug);
  const msg = done === 'approved' ? ['ok', 'อนุมัติแล้ว สินค้าเข้าคลังของลูกค้าและส่งอีเมลแจ้งแล้ว']
    : done === 'rejected' ? ['ok', 'ปฏิเสธแล้ว ลูกค้าจะเห็นเหตุผลและแจ้งโอนใหม่ได้']
    : problem === 'handled' ? ['bad', 'รายการนี้ถูกดำเนินการไปแล้ว (อนุมัติ/ปฏิเสธซ้ำไม่ได้)']
    : problem === 'reason' ? ['bad', 'ใส่เหตุผลที่ปฏิเสธอย่างน้อย 3 ตัวอักษร'] : null;
  const cards = waiting.map((o) => `
  <article class="box review-card">
    <div class="review-top">
      <div><p class="eyebrow">ยอดที่ต้องเจอในแอปธนาคาร</p><p class="xfer-big small">${esc(bahtExact(o.transfer_amount))}</p></div>
      <span class="xfer-code">${esc(o.pay_ref)}</span>
    </div>
    <dl class="xfer-dl">
      <div><dt>สินค้า</dt><dd>${esc(productTitle(o.product_slug))} (ราคา ${esc(baht(o.amount))})</dd></div>
      <div><dt>ลูกค้า</dt><dd>${esc(o.user_email || o.email)}</dd></div>
      <div><dt>กดยืนยันโอนเมื่อ</dt><dd>${esc(thDate(o.confirmed_at))}${o.confirm_count > 1 ? ` · ครั้งที่ ${esc(o.confirm_count)}` : ''}</dd></div>
      ${o.transfer_time ? `<div><dt>ลูกค้าบอกว่าโอนเวลา</dt><dd>${esc(o.transfer_time)} น.</dd></div>` : ''}
      <div><dt>สร้างออเดอร์</dt><dd>${esc(thDate(o.created_at))}</dd></div>
    </dl>
    ${o.same && o.same.length ? `<div class="note warn same-amount"><span><b>ระวัง: มีออเดอร์ยอดเท่ากันอีก ${o.same.length} รายการ</b> ดูเวลาที่เงินเข้าในแอปธนาคาร เทียบกับเวลาที่ลูกค้ากดยืนยัน (${esc(o.transfer_time ? o.transfer_time + ' น.' : thTime(o.confirmed_at))}) ของรายการนี้ เงินที่เข้าก่อนให้อนุมัติออเดอร์ที่กดยืนยันก่อน
      <ul>${o.same.map((x) => `<li>${esc(x.user_email || '-')} · <code>${esc(x.pay_ref)}</code> · ${x.status === 'review' ? `รอตรวจ กดยืนยัน ${esc(thDate(x.confirmed_at))}` : 'ยังไม่แจ้งโอน'}</li>`).join('')}</ul></span></div>` : ''}
    <div class="review-actions">
      <form method="post" action="/admin/transfers/${esc(o.id)}/approve" data-confirm-title="เห็นยอด ${esc(bahtExact(o.transfer_amount))} เข้าบัญชีแล้วใช่ไหม?" data-confirm="${o.same && o.same.length ? `มีออเดอร์ยอดเท่ากันอีก ${o.same.length} รายการ เทียบเวลาให้ตรงกับรายการนี้ · ` : ''}อนุมัติแล้วสินค้าเข้าคลังลูกค้าทันที และยกเลิกไม่ได้" data-confirm-ok="อนุมัติ" data-confirm-cancel="ยังก่อน">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <button class="btn primary lg" type="submit">อนุมัติ</button>
      </form>
      <details class="reject">
        <summary class="btn lg">ปฏิเสธ</summary>
        <form method="post" action="/admin/transfers/${esc(o.id)}/reject">
          <input type="hidden" name="csrf" value="${esc(csrf)}">
          <label class="field">เหตุผล (ลูกค้าจะเห็น)<input type="text" name="reason" maxlength="200" required minlength="3" placeholder="เช่น ไม่พบรายการโอนยอด ${esc(bahtExact(o.transfer_amount))}"></label>
          <button class="btn danger" type="submit">ยืนยันปฏิเสธ</button>
        </form>
      </details>
    </div>
  </article>`).join('');
  const label = { paid: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ', expired: 'หมดอายุ' };
  const recentRows = recent.map((o) => `<tr><td>${esc(thDate(o.reviewed_at))}</td><td><code>${esc(o.pay_ref)}</code></td><td>${esc(bahtExact(o.transfer_amount))}</td><td>${esc(o.user_email || o.email)}</td><td><span class="tag ${esc(o.status)}">${esc(label[o.status] || o.status)}</span></td><td>${esc(o.reviewer_email || '-')}</td><td>${esc(o.status === 'rejected' ? o.review_note || '' : '')}</td></tr>`).join('');
  const act = { customer_confirm: 'ลูกค้าแจ้งโอน', approve: 'อนุมัติ', reject: 'ปฏิเสธ', expire: 'หมดอายุ' };
  const auditRows = audit.map((a) => `<tr><td>${esc(thDate(a.at))}</td><td><code>${esc(a.pay_ref || a.order_id.slice(0, 8))}</code></td><td>${esc(act[a.action] || a.action)}</td><td>${esc(a.actor_email || 'ระบบ')}</td><td>${esc(a.detail || '')}</td></tr>`).join('');
  return layout({
    title: 'ตรวจสอบการโอนเงิน', shopName: cfg.shopName, user, csrf, noindex: true, wide: true, page: 'page-admin-transfers',
    body: `
<nav class="crumb"><a href="/admin">หลังบ้าน</a><span>/</span><span aria-current="page">ตรวจสอบการโอนเงิน</span></nav>
<h1>รอตรวจสอบการโอนเงิน <span class="badge wait">${waiting.length}</span></h1>
${msg ? `<p class="${msg[0] === 'ok' ? 'success-note' : 'error'}" role="status">${esc(msg[1])}</p>` : ''}
<p class="muted small">เปิดแอปธนาคารของร้าน ดูว่ามีเงินเข้าตรงยอดและเวลาไหม ถ้ามี กด "อนุมัติ" ถ้าไม่พบ กด "ปฏิเสธ" พร้อมเหตุผล · อนุมัติแล้วสินค้าเข้าคลังลูกค้าทันที และกดซ้ำไม่ได้</p>
<div class="review-list">${cards || '<div class="empty"><p><b>ไม่มีรายการรอตรวจสอบ</b></p><p class="muted small">เมื่อมีลูกค้ากด "ยืนยันการโอนเงิน" จะขึ้นที่นี่ (และส่งอีเมลหาแอดมิน)</p></div>'}</div>
<h2>ตัดสินล่าสุด</h2>
<div class="table-wrap"><table><thead><tr><th>เวลา</th><th>รหัส</th><th>ยอด</th><th>ลูกค้า</th><th>ผล</th><th>โดย</th><th>เหตุผล</th></tr></thead><tbody>${recentRows || '<tr><td colspan="7" class="muted">ยังไม่มี</td></tr>'}</tbody></table></div>
<h2>บันทึกการตรวจสอบ (audit log)</h2>
<div class="table-wrap"><table><thead><tr><th>เวลา</th><th>รหัส</th><th>การกระทำ</th><th>ผู้ทำ</th><th>รายละเอียด</th></tr></thead><tbody>${auditRows || '<tr><td colspan="5" class="muted">ยังไม่มี</td></tr>'}</tbody></table></div>`,
  });
}

function transferReceivedEmail({ cfg, order, p }) {
  return `สวัสดีค่ะ

เราได้รับแจ้งการโอนเงินสำหรับ "${p.title}" แล้ว กำลังรอร้านตรวจสอบ
ยอดที่แจ้ง: ${bahtExact(order.transfer_amount)}
รหัสอ้างอิง: ${order.pay_ref}

เมื่อร้านตรวจพบรายการโอนและอนุมัติ แอนิเมชันจะเข้าไปอยู่ในคลังของคุณ และเราจะส่งอีเมลแจ้งอีกครั้ง
ดูสถานะได้ที่: ${cfg.baseUrl}/order/${order.id}

— ${cfg.shopName}`;
}

function transferRejectedEmail({ cfg, order, p, reason }) {
  return `สวัสดีค่ะ

ร้านยังไม่พบรายการโอนสำหรับ "${p.title}" (ยอด ${bahtExact(order.transfer_amount)} รหัส ${order.pay_ref})
เหตุผล: ${reason}

ถ้าโอนแล้วจริง ตรวจยอดและบัญชีผู้รับ แล้วกด "ยืนยันการโอนเงิน" อีกครั้งได้ที่:
${cfg.baseUrl}/pay/transfer/${order.id}

— ${cfg.shopName}`;
}

function adminTransferEmail({ cfg, order, p }) {
  return `มีลูกค้ากดยืนยันการโอนเงิน รอร้านตรวจสอบ

สินค้า: ${p.title}
ยอดที่ต้องเจอในแอปธนาคาร: ${bahtExact(order.transfer_amount)}
รหัสอ้างอิง: ${order.pay_ref}
เลขออเดอร์: ${order.id}
ลูกค้า: ${order.email}
กดยืนยันเมื่อ: ${thDate(order.confirmed_at || Date.now())}${order.confirm_count > 1 ? ` (ครั้งที่ ${order.confirm_count})` : ''}

เช็กยอดในแอปธนาคาร แล้วกดอนุมัติที่:
${cfg.baseUrl}/admin/transfers`;
}

function orderStatus({ cfg, user, csrf, order, p }) {
  const paid = order.status === 'paid';
  return layout({
    title: paid ? 'ชำระเงินสำเร็จ' : 'รอยืนยันการชำระเงิน', shopName: cfg.shopName, user, csrf, noindex: true,
    body: order.provider === 'manual' && ['pending', 'review', 'rejected', 'expired'].includes(order.status) ? manualStatusBody({ order, p }) : ['failed', 'expired', 'refunded'].includes(order.status) ? `
<div class="narrow">
<h1>${order.status === 'refunded' ? 'คืนเงินแล้ว' : order.status === 'expired' ? 'QR หมดอายุ' : 'ชำระเงินไม่สำเร็จ'}</h1>
<p>${order.status === 'refunded' ? 'คำสั่งซื้อนี้คืนเงินแล้ว สินค้าถูกนำออกจากคลัง' : 'ยังไม่มีการตัดเงิน ลองชำระใหม่ได้เลย'}</p>
${order.status === 'refunded' ? `<p><a class="btn" href="${productHref(p)}">ไปหน้าสินค้า</a></p>` : `<p><a class="btn primary" href="/pay/${esc(order.provider)}/${esc(order.id)}">ชำระเงินอีกครั้ง</a></p>`}
<p class="muted small">รหัสคำสั่งซื้อ ${esc(order.id.slice(0, 8))}</p>
</div>` : paid ? `
<div class="success narrow">
  <div class="success-mark" data-celebrate="always" aria-hidden="true">${ICON.check}</div>
  <h1>ชำระเงินสำเร็จ</h1>
  <p>ขอบคุณที่สั่งซื้อ <b>${esc(p.title)}</b> ${p.pack ? 'แอนิเมชันพรีเมียมทุกแบบเข้าคลังของคุณแล้ว' : 'แอนิเมชันนี้อยู่ในคลังของคุณแล้ว'}</p>
  <p><a class="btn primary lg" href="${p.pack ? '/library?pack=1' : `/library/${esc(order.id)}`}">${ICON.library} เปิดใช้จากคลัง</a></p>
  <p class="muted small">รหัสคำสั่งซื้อ <b>${esc(order.id.slice(0, 8))}</b> · ส่งใบยืนยันไปที่ ${esc(order.email)} แล้ว</p>
  <div class="note">${ICON.infinity}<span>ซื้อครั้งเดียว ใช้ได้ตลอด เข้าสู่ระบบแล้วโหลดใหม่จากคลังได้ทุกเมื่อ ทุกเครื่อง</span></div>
</div>` : `
<div class="narrow">
<h1>รอยืนยันการชำระเงิน…</h1>
<p>ระบบกำลังรอการยืนยันจากผู้ให้บริการชำระเงิน หน้านี้จะเปลี่ยนเองเมื่อยืนยันแล้ว</p>
<div class="spinner" data-poll="/order/${esc(order.id)}/status" aria-hidden="true"></div>
<p class="muted small">ถ้ารอนานเกิน 5 นาที กรุณา<a href="/contact">ติดต่อร้าน</a>พร้อมรหัสคำสั่งซื้อ ${esc(order.id.slice(0, 8))}</p>
</div>`,
  });
}

function manualStatusBody({ order, p }) {
  const amt = bahtExact(order.transfer_amount);
  if (order.status === 'expired') return `
<div class="narrow"><h1>ออเดอร์หมดอายุ</h1>
<p>ออเดอร์นี้หมดเวลาแล้ว ยังไม่มีการอนุมัติ ถ้าโอนไปแล้ว กรุณาติดต่อร้านพร้อมรหัสอ้างอิง <b>${esc(order.pay_ref)}</b></p>
<p><a class="btn primary" href="${productHref(p)}">สั่งซื้อใหม่</a></p></div>`;
  if (order.status === 'rejected') return `
<div class="narrow"><h1>ร้านยังไม่พบรายการโอน</h1>
<div class="note warn"><span><b>เหตุผล:</b> ${esc(order.review_note || '')}</span></div>
<p>ยอดที่ต้องโอน <b>${esc(amt)}</b> · รหัสอ้างอิง <b>${esc(order.pay_ref)}</b></p>
<p><a class="btn primary lg" href="/pay/transfer/${esc(order.id)}">ตรวจแล้วแจ้งโอนอีกครั้ง</a></p></div>`;
  if (order.status === 'pending') return `
<div class="narrow"><h1>ยังไม่ได้แจ้งโอน</h1>
<p>ยอดที่ต้องโอน <b>${esc(amt)}</b></p>
<p><a class="btn primary lg" href="/pay/transfer/${esc(order.id)}">ไปหน้าโอนเงิน</a></p></div>`;
  return `
<div class="narrow transfer-wait">
  <div class="sent-mark" data-celebrate="once" data-order="${esc(order.id)}" aria-hidden="true"><svg viewBox="0 0 52 52"><circle class="sent-ring" cx="26" cy="26" r="23"/><path class="sent-tick" d="M15 27l7 7 15-16"/></svg></div>
  <h1>แจ้งโอนสำเร็จ!</h1>
  <p class="live-wait" data-poll="/order/${esc(order.id)}/status" data-poll-status="review"><i aria-hidden="true"></i> รอร้านตรวจสอบ · หน้านี้อัปเดตเอง</p>
  <p>ร้านจะดูรายการโอนยอด <b>${esc(amt)}</b> ในบัญชี แล้วอนุมัติให้ หน้านี้จะเปลี่ยนเองเมื่ออนุมัติ ปิดหน้านี้ได้ เราจะส่งอีเมลแจ้ง</p>
  <ol class="steps-line">
    <li class="done">แจ้งโอนแล้ว</li><li class="now">ร้านกำลังตรวจสอบ</li><li>สินค้าเข้าคลัง</li>
  </ol>
  <div class="box"><dl class="xfer-dl">
    <div><dt>สินค้า</dt><dd>${esc(p.title)}</dd></div>
    <div><dt>ยอดที่แจ้ง</dt><dd><b>${esc(amt)}</b></dd></div>
    <div><dt>รหัสอ้างอิง</dt><dd><b>${esc(order.pay_ref)}</b></dd></div>
    <div><dt>แจ้งเมื่อ</dt><dd>${esc(thDate(order.confirmed_at))}</dd></div>
  </dl></div>
  <p class="muted small">ถ้ารอนานผิดปกติ <a href="/contact">ติดต่อร้าน</a>พร้อมรหัสอ้างอิงด้านบน</p>
</div>`;
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

function library({ cfg, user, csrf, items, open = [], customs = [], fonts, limits, pack = null, packJustBought = false }) {
  const openLabel = { pending: 'รอโอนเงิน', review: 'รอร้านตรวจสอบ', rejected: 'ร้านยังไม่พบยอดโอน' };
  const openHref = (o) => (o.provider === 'manual' && o.status !== 'review' ? `/pay/transfer/${o.id}` : `/order/${o.id}`);
  const openList = open.length ? `
<section class="box lib-open" aria-label="คำสั่งซื้อที่ยังไม่เสร็จ">
  <h2>คำสั่งซื้อที่ยังไม่เสร็จ</h2>
  <ul class="lib-open-list">${open.map(({ order: o, p }) => `
    <li><a href="${openHref(o)}"><b>${esc(p.title)}</b><span class="muted small">${esc(openLabel[o.status] || o.status)}${o.pay_ref ? ` · ${esc(o.pay_ref)}` : ''}</span><i>›</i></a></li>`).join('')}
  </ul>
  <p class="muted small">สินค้าจะเข้าคลังเมื่อชำระเงินเสร็จ${cfg.paymentProvider === 'manual' ? 'และร้านอนุมัติแล้ว' : ''}</p>
</section>` : '';
  const list = items.map(({ order, p }) => `
    <article class="lib-card reveal">
      <a href="/library/${esc(order.id)}" class="lib-thumb"><img src="/previews/${esc(p.slug)}_horizontal.jpg" alt="" loading="lazy" width="960" height="540"></a>
      <div class="lib-body">
        <h3>${esc(p.title)}</h3>
        <p class="muted small">${order.provider === 'free' ? 'รับฟรีเมื่อ' : order.provider === 'pack' ? 'ได้จากแพ็กพรีเมียม' : 'ซื้อเมื่อ'} ${esc(thDate(order.paid_at || order.created_at))} · รหัส ${esc(order.id.slice(0, 8))}</p>
        <div class="lib-actions">
          <a class="btn primary" href="/library/${esc(order.id)}/customize">${ICON.edit} ปรับแต่งแล้วโหลด</a>
          <a class="btn" href="/library/${esc(order.id)}">${ICON.download} แบบต้นฉบับ</a>
        </div>
      </div>
    </article>`).join('');
  return layout({
    title: 'คลังของฉัน', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-library', tab: 'library',
    body: `
<div class="section-head lib-head">
  <div><p class="eyebrow">บัญชี ${esc(user.email)}</p><h1>คลังของฉัน</h1></div>
  <p class="muted small">${items.length} รายการ · ใช้ได้ตลอด</p>
</div>
${packJustBought && pack && pack.owned ? `<div class="note ok">${ICON.check}<span><b>แพ็กพรีเมียมพร้อมใช้</b> ทุกแบบพรีเมียมอยู่ในคลังแล้ว</span></div>` : ''}
${openList}
${pack && !pack.owned && !pack.open && pack.count ? `<a class="pack-banner slim" href="/premium"><span class="pack-ico">${ICON.crown}</span><span class="pack-txt"><b>ปลดล็อกพรีเมียมทั้งหมด ${baht(pack.price)}</b><small>${esc(pack.count)} แบบ + แบบใหม่ จ่ายครั้งเดียว</small></span><span class="pack-go">ดู</span></a>` : ''}
${items.length ? `<div class="lib-grid">${list}</div>` : `
<div class="empty">
  <p><b>ยังไม่มีแอนิเมชันในคลัง</b></p>
  <p class="muted small">ซื้อแล้วจะมาอยู่ที่นี่ทันที ใช้ได้ตลอด</p>
  <p><a class="btn primary" href="/#catalog">เลือกแอนิเมชัน</a></p>
</div>`}
${items.length ? `<a class="cz-cta sub-cta" href="/subtitles">
  <span class="cz-cta-icon">${ICON.cc}</span>
  <span><b>ใส่ซับอัตโนมัติด้วยแบบในคลัง <span class="beta">Beta</span></b><small>อัปคลิปที่มีเสียงพูด ระบบทำซับไทยให้ แก้คำได้ แล้วได้คลิปพร้อมซับ + ไฟล์ .srt</small></span>
  <span class="cz-cta-go">›</span>
</a>
<nav class="lib-tools" aria-label="เครื่องมือปรับแต่ง">
  <a href="/library/styles" class="lib-tool">${ICON.edit}<span><b>สไตล์ของฉัน</b><small>ฟอนต์ + สีที่บันทึกไว้ กดทีเดียวใช้ได้</small></span></a>
  <a href="/library/fonts" class="lib-tool">${ICON.film}<span><b>ฟอนต์ของฉัน</b><small>อัปโหลดฟอนต์มาใช้เอง</small></span></a>
</nav>` : ''}
${customs.length ? `<section class="lib-versions"><div class="section-head"><div><p class="eyebrow">ปรับแต่งเอง</p><h2>เวอร์ชันของฉัน</h2></div><p class="muted small">${customs.length} เวอร์ชัน · โหลดซ้ำได้ตลอด${limits ? ` · ใช้พื้นที่ ${fmtBytes(limits.usedBytes)} จาก ${fmtBytes(limits.quotaBytes)}` : ''}</p></div>${versionList(cfg, customs, (slug) => cfg.products.find((x) => x.slug === slug), fonts)}</section>` : ''}`,
  });
}

function libraryItem({ cfg, user, csrf, order, p, editorId, left, size = 'vertical', claimed = false }) {
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
${claimed && order.provider === 'free' ? `<p class="claimed-bar" role="status">${ICON.check}<span><b>ได้รับแล้ว ฟรี!</b> "${esc(p.title)}" อยู่ในคลังของคุณ โหลดหรือปรับแต่งได้เลย</span></p>` : ''}
<div class="lib-item-head">
  <img src="/previews/${esc(p.slug)}_horizontal.jpg" alt="" width="960" height="540">
  <div>
    <p class="eyebrow">อยู่ในคลังของคุณ · ใช้ได้ตลอด</p>
    <h1>${esc(p.title)}</h1>
    <p class="muted small">${order.provider === 'free' ? 'รับฟรีเมื่อ' : order.provider === 'pack' ? 'ได้จากแพ็กพรีเมียม' : 'ซื้อเมื่อ'} ${esc(thDate(order.paid_at || order.created_at))} · รหัส ${esc(order.id.slice(0, 8))}</p>
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
  ${fileFor(ed.single) ? '' : `<p class="small"><a href="/library/${esc(order.id)}/customize">ต้องการ ${esc(fileLabel(cfg, ed.single))}? กดปรับแต่ง แล้วระบบสร้างให้ตามความยาวที่เลือก</a></p>`}
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
// ท่าที่ใช้สีต่างจากปกติ (บอกในหน้าปรับแต่ง)
const COLOR_NOTE = {
  neon: 'สีตัวอักษร = สีไฟ, สีขอบ = แสงฟุ้งรอบนอก, ความหนาขอบ = ความแรงของแสง',
  highlight: 'สีขอบ = สีแถบไฮไลต์',
  lower: 'สีขอบ = สีแถบ, สีตัวอักษร = สีข้อความและขีด',
  bubble: 'สีขอบ = สีกล่องแชท',
  gold: 'สีตัวอักษร = สีโลหะ (ระบบไล่เงาให้เอง)',
  karaoke: 'สีตัวอักษร = สีที่วิ่งตามคำ',
  stamp: 'สีตัวอักษร = สีตราและกรอบ',
  rainbow: 'สีรุ้งอัตโนมัติ (สีตัวอักษรไม่มีผล)',
  liquid: 'สีตัวอักษร = สีน้ำ',
  sticker: 'สีขอบ = สีขอบสติกเกอร์ (หนาเสมอ)',
  hearts: 'สีขอบ = สีหัวใจ (ขอบดำ/ขาว → หัวใจชมพู)',
  retro: 'สีขอบ = สีเงา 3D',
};
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
      <label class="font-opt${f.user ? ' mine' : ''}${f.thai && f.thai !== 'full' ? ' warn' : ''}" data-thai="${esc(f.thai || 'full')}">
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
  <p class="muted small">ท่าเคลื่อนไหวเดิม · เปลี่ยนข้อความ ฟอนต์ สี ได้ตามใจ${COLOR_NOTE[p.motion] ? ` · ${COLOR_NOTE[p.motion]}` : ''}</p>
</div>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<div class="cz">
  <div class="cz-preview-col">
    <div class="cz-preview">
      <div class="cz-stage" data-stage data-motion="${esc(p.motion || 'pop')}" data-ratio="${(v.size || 'vertical') === 'horizontal' ? 'h' : 'v'}" data-bg="checker">
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
    <div class="wiz-head" data-wiz-head hidden>
      <a class="wiz-x" href="/library/${esc(order.id)}" aria-label="ออกจากหน้าปรับแต่ง">✕</a>
      <div class="wiz-title"><span class="wiz-n" data-wiz-n>1/5</span><b data-wiz-title></b></div>
      <div class="wiz-dots" data-wiz-dots role="tablist" aria-label="ขั้นตอน"></div>
    </div>
    <input type="hidden" name="csrf" value="${esc(csrf)}">
    <div class="cz-step" data-step="1" data-title="พิมพ์ข้อความ">
    <fieldset class="cz-field">
      <legend>ข้อความ</legend>
      <div class="cz-input"><input type="text" name="text" value="${esc(v.text)}" maxlength="120" required autocomplete="off" enterkeyhint="next" data-cz-text><span class="muted small" data-counter></span></div>
      <p class="muted small">ไม่เกิน 40 ตัวอักษร · ภาษาไทย อังกฤษ ตัวเลข และเครื่องหมายทั่วไป</p>
    </fieldset>
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
      <div class="style-form" data-style-form hidden role="group" aria-label="ตั้งชื่อสไตล์">
        <input type="text" maxlength="40" placeholder="ตั้งชื่อสไตล์ เช่น แดงขอบขาว" data-style-name aria-label="ชื่อสไตล์">
        <button class="btn small primary" type="button" data-style-submit>บันทึก</button>
        <button class="btn small ghost" type="button" data-style-cancel>ยกเลิก</button>
      </div>
      <p class="style-hint muted small" data-style-msg>${presets.length ? '' : 'ครั้งแรก: เลือกฟอนต์และสีที่ชอบด้านล่าง แล้วกด "+ บันทึกสไตล์นี้" ครั้งหน้ากดชื่อสไตล์ทีเดียวก็ได้หน้าตาเดิม'}</p>
    </section>
    </div>
    <div class="cz-step" data-step="2" data-title="เลือกฟอนต์">
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
    </div>
    <div class="cz-step" data-step="3" data-title="เลือกสี">
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
    </div>
    <div class="cz-step" data-step="4" data-title="แนวและความยาว">
    <fieldset class="cz-field">
      <legend>แนวของคลิป</legend>
      <div class="size-grid">${sizeOpts}</div>
    </fieldset>
    <fieldset class="cz-field">
      <legend>ความยาวคลิป <span class="muted small">(เข้า → ค้าง → ออก)</span></legend>
      <div class="seg seg-wide">${secOpts}</div>
    </fieldset>
    </div>
    <div class="cz-step" data-step="5" data-title="ไฟล์ที่ได้ แล้วสร้าง">
    <ul class="wiz-summary" data-wiz-summary hidden></ul>
    <fieldset class="cz-field">
      <legend>ตัดต่อด้วยโปรแกรมอะไร</legend>
      <div class="ed-grid">${edOpts}</div>
      <div class="type-grid">${typeOpts}</div>
      <p class="muted small" data-type-note>ได้ไฟล์วิดีโอไฟล์เดียว ลากใส่โปรแกรมได้ทันที · ไฟล์โปร่งใส (ProRes) คมที่สุดแต่ใหญ่กว่า ไฟล์พื้นเขียวเล็กและโหลดเร็ว</p>
    </fieldset>
    ${tools.ok ? '' : `<div class="note warn">${ICON.shield}<span><b>ระบบสร้างไฟล์ยังไม่พร้อม</b> ลองดูตัวอย่างและเลือกค่าไว้ได้ แต่ยังกดสร้างไฟล์ไม่ได้จนกว่าร้านจะเปิดระบบเรนเดอร์</span></div>`}
    ${full ? `<div class="note warn">${ICON.shield}<span><b>พื้นที่เก็บเวอร์ชันเต็มแล้ว</b> ลบเวอร์ชันเก่าที่ไม่ใช้ใน <a href="/library">คลัง</a> แล้วสร้างใหม่ได้ทันที</span></div>` : ''}
    <div class="cz-submit">
    <button class="btn primary block lg" type="submit" name="action" value="render" data-render-btn ${canRender ? '' : 'disabled'}>${ICON.bolt} สร้างไฟล์ของฉัน</button>
    <p class="muted small center">${busy ? `มีงานที่กำลังสร้างอยู่${running ? ` <a href="/library/custom/${esc(running.id)}">ดูความคืบหน้า</a>` : ''} · ระหว่างนี้บันทึกสไตล์ไว้ได้` : 'สร้างได้ไม่จำกัดครั้ง · ใช้เวลาประมาณ 5–15 วินาที'}</p>
    </div>
    </div>
  </form>
  <div class="wiz-bar" data-wiz-bar hidden>
    <button type="button" class="btn ghost" data-wiz-back>‹ ย้อนกลับ</button>
    <button type="button" class="btn primary" data-wiz-next>ถัดไป ›</button>
  </div>
</div>
${versions.length ? `<section class="lib-versions"><h2>เวอร์ชันของฉันจากแอนิเมชันนี้</h2>${versionList(cfg, versions, null, fonts)}</section>` : ''}
<script src="/motion.js?v=${V}" defer></script>
<script src="/customize.js?v=${V}" defer></script>
<script src="/wizard.js?v=${V}" defer></script>`,
  });
}

// โหมดเบราว์เซอร์: กล่องสร้างไฟล์ในเครื่องลูกค้า (public/render-ui.js)
function browserJobBox(job, csrf, { mode, auto, title, note }) {
  return `<div class="job" data-browser-job data-base="/library/custom/${esc(job.id)}" data-mode="${mode}" data-csrf="${esc(csrf)}" ${auto ? 'data-auto' : ''}>
  <h2>${title}</h2>
  <div class="job-bar"><i data-bar style="width:0%"></i></div>
  <p><b data-pct>0%</b> · <span data-stage>${auto ? 'กำลังเริ่ม' : 'พร้อมสร้าง'}</span></p>
  <p class="error small" data-err role="alert" hidden></p>
  <button type="button" class="btn primary lg block" data-go ${auto ? 'hidden' : ''}>${ICON.download} ${mode === 'download' ? 'สร้างไฟล์และดาวน์โหลด' : 'สร้างไฟล์'}</button>
  <p class="muted small">${note}</p>
  <p data-after hidden><a class="btn ghost" href="/library/custom/${esc(job.id)}">เสร็จแล้ว · กลับไปที่เวอร์ชันนี้</a></p>
</div>`;
}
const BROWSER_NOTE = 'ไฟล์สร้างในเบราว์เซอร์ของคุณเอง (ไม่ต้องรอคิวร้าน) เปิดหน้านี้ค้างไว้จนเสร็จ · ใช้เวลาราว 20 วินาที – 3 นาที ตามความยาวและชนิดไฟล์ · ครั้งแรกต้องโหลดตัวเข้ารหัสราว 32 MB';
const browserScripts = () => `<script src="/motion.js?v=${V}" defer></script><script src="/subplan.js?v=${V}" defer></script><script type="module" src="/render-ui.js?v=${V}"></script>`;

function customStatus({ cfg, user, csrf, job, p, position, fonts = cfg.fonts, browserMode = false, save = false }) {
  const font = fonts.find((f) => f.id === job.font) || { label: 'ฟอนต์ที่ลบไปแล้ว', weight: 700, id: job.font };
  const ed = cfg.editorsConfig.editors[job.editor] || { label: job.editor };
  const one = JSON.parse(job.files_json || '[]').find((x) => x.format === 'single');
  const fmt = one ? one.codec : '';
  const fontNote = font.user
    ? `<p class="muted small">ฟอนต์ "${esc(font.label)}" เป็นฟอนต์ที่คุณอัปโหลดเอง ร้านไม่ได้ให้สิทธิ์ใช้งานฟอนต์นี้ กรุณาตรวจว่ามีสิทธิ์ใช้เชิงพาณิชย์</p>`
    : `<p class="muted small">ฟอนต์ ${esc(font.label)} ใช้สัญญา SIL Open Font License ใช้เชิงพาณิชย์ได้ · <a href="/fonts/thai/${esc(font.id)}/OFL.txt">อ่านสัญญาฟอนต์</a></p>`;
  const outlineLabel = { none: 'ไม่มีขอบ', thin: 'ขอบบาง', medium: 'ขอบกลาง', thick: 'ขอบหนา' }[job.outline] || job.outline;
  const body = browserMode && job.status !== 'done'
    ? browserJobBox(job, csrf, { mode: 'create', auto: job.status !== 'failed', title: job.status === 'failed' ? 'สร้างไฟล์ไม่สำเร็จ ลองอีกครั้งได้' : 'กำลังสร้างไฟล์ในเครื่องของคุณ', note: BROWSER_NOTE })
    : browserMode && one && one.browser ? `
<section class="ready-box">
  <div class="ready-head">${ICON.check}<div><h2>${save ? 'กำลังสร้างไฟล์ให้อีกครั้ง' : 'สร้างเสร็จแล้ว'}</h2><p class="muted small">${esc(fileLabel(cfg, fmt))} · ${esc(SIZE_LABEL[job.size] || '')} · ${esc(job.seconds)} วินาที · ใช้กับ ${esc(ed.label)}</p></div></div>
  ${browserJobBox(job, csrf, { mode: 'download', auto: save, title: 'ดาวน์โหลดอีกครั้ง', note: 'ร้านเก็บแค่ "สูตร" ของเวอร์ชันนี้ กดแล้วเบราว์เซอร์จะสร้างไฟล์เดิมให้ใหม่ทันที (นับเป็น 1 ครั้งในโควตาดาวน์โหลดต่อวัน)' })}
</section>
${ed.guide ? howToBlock(cfg, ed, fmt) : ''}
${fontNote}`
    : job.status === 'done' ? (one ? `
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
${job.status === 'done' || job.status === 'failed' ? `<form method="post" action="/library/custom/${esc(job.id)}/delete" class="danger-zone" data-confirm-title="ลบเวอร์ชันนี้ออกจากคลัง?" data-confirm="ไฟล์จะถูกลบถาวร กู้คืนไม่ได้" data-confirm-ok="ลบเลย" data-confirm-danger>
  <input type="hidden" name="csrf" value="${esc(csrf)}">
  <button type="submit" class="linklike danger">ลบเวอร์ชันนี้</button>
</form>` : ''}
${browserMode ? browserScripts() : ''}`,
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
        <form method="post" action="/library/styles/${esc(x.id)}/delete" data-confirm-title="ลบสไตล์ &quot;${esc(x.name)}&quot;?" data-confirm="ไฟล์ที่สร้างไว้แล้วยังอยู่ครบ" data-confirm-ok="ลบสไตล์" data-confirm-danger>
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
      <form method="post" action="/library/fonts/${esc(f.id)}/delete" data-confirm-title="ลบฟอนต์ &quot;${esc(f.name)}&quot;?" data-confirm="เวอร์ชันที่สร้างไว้แล้วไม่หาย" data-confirm-ok="ลบฟอนต์" data-confirm-danger>
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

function account({ cfg, user, csrf, items = 0 }) {
  const row = (href, icon, label, sub = '') => `<a class="acc-row" href="${href}">${icon}<span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><i>›</i></a>`;
  return layout({
    title: 'บัญชี', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-account',
    body: user ? `
<div class="narrow">
  <div class="acc-head">
    <span class="acc-avatar">${esc((user.name || user.email).slice(0, 1).toUpperCase())}</span>
    <div><h1>${esc(user.name || 'บัญชีของฉัน')}</h1><p class="muted small">${esc(user.email)}${user.email_verified_at ? ' · ยืนยันแล้ว' : ' · ยังไม่ยืนยันอีเมล'}</p></div>
  </div>
  <div class="acc-list">
    ${row('/library', ICON.library, 'คลังของฉัน', `${items} รายการ · ใช้ได้ตลอด`)}
    ${row('/library/styles', ICON.edit, 'สไตล์ของฉัน', 'ฟอนต์และสีที่บันทึกไว้')}
    ${row('/library/fonts', ICON.film, 'ฟอนต์ของฉัน', 'อัปโหลดฟอนต์มาใช้เอง')}
    ${user.role === 'admin' ? row('/admin', ICON.shield, 'หลังบ้าน', 'คำสั่งซื้อ ยอดขาย สถิติ') : ''}
  </div>
  <div class="acc-list">
    ${row('/license', ICON.infinity, 'สิทธิ์การใช้งาน')}
    ${row('/terms', ICON.check, 'เงื่อนไขการใช้งาน')}
    ${row('/refund', ICON.check, 'นโยบายคืนเงิน')}
    ${row('/privacy', ICON.shield, 'ความเป็นส่วนตัว (PDPA)')}
    ${row('/contact', ICON.user, 'ติดต่อร้าน')}
  </div>
  <form method="post" action="/logout" class="acc-logout"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="btn block" type="submit">ออกจากระบบ</button></form>
  <p class="muted small center" data-install-hint>เพิ่ม ${esc(cfg.shopName)} ลงหน้าจอโฮม: Safari กด แชร์ → "เพิ่มไปยังหน้าจอโฮม" · Chrome กด ⋮ → "ติดตั้งแอป"</p>
</div>` : `
<div class="narrow acc-guest">
  ${logoMark(64)}
  <h1>ยินดีต้อนรับสู่ ${esc(cfg.shopName)}</h1>
  <p class="muted">เข้าสู่ระบบเพื่อดูคลังและปรับแต่งแอนิเมชันของคุณ</p>
  <a class="btn primary block lg" href="/login?next=%2Faccount">เข้าสู่ระบบ</a>
  <a class="btn block lg" href="/signup?next=%2Faccount">สมัครสมาชิกฟรี</a>
  <div class="acc-list">
    ${row('/terms', ICON.check, 'เงื่อนไขการใช้งาน')}
    ${row('/privacy', ICON.shield, 'ความเป็นส่วนตัว (PDPA)')}
    ${row('/contact', ICON.user, 'ติดต่อร้าน')}
  </div>
</div>`,
  });
}

function authPage({ cfg, user, csrf, mode, form = {}, error, next, notice = '' }) {
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
    ${notice ? `<p class="ok" role="status">${esc(notice)}</p>` : ''}
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
      ${signup ? `<label class="field">กรอกรหัสผ่านอีกครั้ง
        <span class="pw"><input type="password" name="password2" required minlength="8" maxlength="200" autocomplete="new-password"><button type="button" class="pw-toggle" data-pw-toggle aria-label="แสดงรหัสผ่าน">แสดง</button></span>
      </label>` : ''}
      ${signup ? '' : '<p class="small right"><a href="/forgot">ลืมรหัสผ่าน?</a></p>'}
      <button class="btn primary block" type="submit">${signup ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}</button>
      ${signup ? '<p class="muted small center">การสมัครถือว่ายอมรับ <a href="/terms">เงื่อนไขการใช้งาน</a> และ <a href="/privacy">นโยบายความเป็นส่วนตัว</a></p>' : ''}
    </form>
    <p class="muted small center">${signup
    ? `มีบัญชีแล้ว? <a href="/login?next=${encodeURIComponent(next || '/library')}">เข้าสู่ระบบ</a>`
    : `ยังไม่มีบัญชี? <a href="/signup?next=${encodeURIComponent(next || '/library')}">สมัครสมาชิกฟรี</a>`}</p>
  </div>
</div>`,
  });
}
function forgot({ cfg, user, csrf, form = {}, error, sent }) {
  return layout({
    title: 'ลืมรหัสผ่าน', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-auth', intro: false,
    body: `
<div class="auth"><div class="auth-card">
  ${logoMark(48)}
  <h1>ลืมรหัสผ่าน</h1>
  <p class="muted">กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้ (ลิงก์ใช้ได้ 30 นาที ครั้งเดียว)</p>
  ${sent ? '<p class="ok" role="status">ถ้าอีเมลนี้มีบัญชีอยู่ เราส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้แล้ว อย่าลืมดูในโฟลเดอร์สแปม</p>' : ''}
  ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
  <form method="post" action="/forgot">
    <input type="hidden" name="csrf" value="${esc(csrf)}">
    <label class="field">อีเมล
      <input type="email" name="email" required maxlength="200" autocomplete="email" inputmode="email" value="${esc(form.email || '')}" placeholder="you@example.com" autofocus>
    </label>
    <button class="btn primary block" type="submit">ส่งลิงก์ตั้งรหัสผ่านใหม่</button>
  </form>
  <p class="muted small center"><a href="/login">กลับไปเข้าสู่ระบบ</a></p>
</div></div>`,
  });
}

function reset({ cfg, user, csrf, token, error }) {
  return layout({
    title: 'ตั้งรหัสผ่านใหม่', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-auth', intro: false,
    body: `
<div class="auth"><div class="auth-card">
  ${logoMark(48)}
  <h1>ตั้งรหัสผ่านใหม่</h1>
  <p class="muted">ตั้งแล้วจะออกจากระบบทุกเครื่อง แล้วเข้าสู่ระบบใหม่ด้วยรหัสนี้</p>
  ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
  <form method="post" action="/reset">
    <input type="hidden" name="csrf" value="${esc(csrf)}">
    <input type="hidden" name="t" value="${esc(token)}">
    <label class="field">รหัสผ่านใหม่ <span class="muted small">(อย่างน้อย 8 ตัวอักษร)</span>
      <span class="pw"><input type="password" name="password" required minlength="8" maxlength="200" autocomplete="new-password" autofocus><button type="button" class="pw-toggle" data-pw-toggle aria-label="แสดงรหัสผ่าน">แสดง</button></span>
    </label>
    <label class="field">กรอกรหัสผ่านใหม่อีกครั้ง
      <span class="pw"><input type="password" name="password2" required minlength="8" maxlength="200" autocomplete="new-password"><button type="button" class="pw-toggle" data-pw-toggle aria-label="แสดงรหัสผ่าน">แสดง</button></span>
    </label>
    <button class="btn primary block" type="submit">บันทึกรหัสผ่านใหม่</button>
  </form>
</div></div>`,
  });
}

// ---------- หน้านโยบาย (ร่าง: ให้นักกฎหมายตรวจก่อนขายจริง) ----------
function legalFill(v, label) {
  return v ? esc(v) : `<mark class="fill-me">[กรอก ${esc(label)}]</mark>`;
}
function legalPage({ cfg, user, csrf, kind }) {
  const L = cfg.legal;
  const shop = esc(cfg.shopName);
  const who = `${legalFill(L.name, 'ชื่อผู้ประกอบการ / บริษัท')}`;
  const contact = `อีเมล ${legalFill(L.contactEmail, 'อีเมลติดต่อ')}${L.phone ? ` · โทร ${esc(L.phone)}` : ''} · ที่อยู่ ${legalFill(L.address, 'ที่อยู่สำหรับติดต่อ')}${L.taxId ? ` · เลขประจำตัวผู้เสียภาษี ${esc(L.taxId)}` : ''}`;
  const updated = 'ปรับปรุงล่าสุด: 23 พฤศจิกายน 2569';
  const manual = cfg.paymentProvider === 'manual';
  const pages = {
    terms: { title: 'เงื่อนไขการใช้งาน', body: `
<p>เว็บไซต์ ${shop} ดำเนินการโดย ${who} (เรียกว่า "ร้าน") การสมัครสมาชิก ซื้อ หรือใช้ไฟล์จากร้าน ถือว่าคุณยอมรับเงื่อนไขนี้</p>
<h2>1. บัญชีผู้ใช้</h2>
<ul><li>คุณต้องให้อีเมลที่ใช้งานได้จริง และเก็บรหัสผ่านเป็นความลับ</li><li>ห้ามแชร์บัญชีให้ผู้อื่นใช้ ร้านจำกัดจำนวนการดาวน์โหลดต่อวันเพื่อป้องกันการแชร์บัญชี</li><li>ร้านอาจระงับบัญชีที่ใช้งานผิดเงื่อนไข เช่น แจกจ่ายไฟล์ต่อ หรือพยายามเจาะระบบ</li></ul>
<h2>2. สิทธิ์การใช้ไฟล์</h2>
<ul><li>ซื้อครั้งเดียว ใช้ได้ตลอด ใช้ในวิดีโอได้ไม่จำกัดจำนวนชิ้น ทั้งงานส่วนตัว งานลูกค้า และโฆษณา</li><li>ห้ามขายต่อ แจกต่อ หรือนำไฟล์ต้นฉบับไปรวมในชุดเทมเพลตหรือคลังสื่อ</li><li>รายละเอียดเต็มอยู่ที่หน้า <a href="/license">สิทธิ์การใช้งาน</a></li></ul>
<h2>3. เนื้อหาที่คุณปรับแต่งเอง</h2>
<ul><li>คุณรับผิดชอบข้อความที่พิมพ์ และฟอนต์ที่อัปโหลดเอง ต้องไม่ละเมิดสิทธิ์ผู้อื่น ไม่ผิดกฎหมาย และไม่หมิ่นประมาท</li><li>ร้านให้สิทธิ์เฉพาะฟอนต์ที่ร้านจัดไว้ (SIL OFL) ฟอนต์ที่คุณอัปโหลด คุณต้องมีสิทธิ์ใช้เชิงพาณิชย์เอง</li></ul>
<h2>4. ราคาและการชำระเงิน</h2>
${manual
  ? `<ul><li>ราคาที่แสดงเป็นเงินบาท ชำระโดยโอนเงินผ่าน PromptPay ตามยอดและ QR ที่แสดงในหน้าชำระเงิน</li><li>หลังโอนแล้วกด "ยืนยันการโอนเงิน" ร้านจะตรวจรายการในบัญชีแล้วอนุมัติ สินค้าเข้าคลังของบัญชีเมื่อร้านอนุมัติ และแจ้งทางอีเมล</li><li>ออเดอร์ที่ยังไม่โอนจะหมดอายุใน ${esc(cfg.transfer.expireHours)} ชั่วโมง</li></ul>`
  : `<ul><li>ราคาที่แสดงเป็นเงินบาท ชำระผ่านผู้ให้บริการชำระเงินที่ร้านเลือก ร้านไม่เก็บเลขบัตรของคุณ</li><li>เมื่อชำระสำเร็จ สินค้าจะเข้าคลังของบัญชีทันที</li></ul>`}
<h2>5. การรับประกันและความรับผิด</h2>
<ul><li>ร้านพยายามให้ไฟล์ใช้งานได้กับโปรแกรมที่ระบุ ถ้าใช้ไม่ได้ ดู <a href="/refund">นโยบายคืนเงิน</a></li><li>ความรับผิดของร้านไม่เกินราคาที่คุณจ่ายสำหรับสินค้านั้น</li></ul>
<h2>6. การเปลี่ยนแปลงเงื่อนไข</h2>
<p>ร้านอาจปรับเงื่อนไขนี้ และจะแสดงวันที่ปรับปรุงไว้ในหน้านี้ การใช้งานต่อหลังปรับปรุงถือว่ายอมรับเงื่อนไขใหม่ เงื่อนไขนี้อยู่ภายใต้กฎหมายไทย</p>` },
    refund: { title: 'นโยบายคืนเงิน', body: `
<p>สินค้าของ ${shop} เป็นไฟล์ดิจิทัลที่ส่งมอบทันทีหลังชำระเงิน จึงมีเงื่อนไขการคืนเงินดังนี้</p>
<h2>คืนเงินได้เมื่อ</h2>
<ul><li>ไฟล์เสียหรือเปิดไม่ได้ และร้านแก้ไขหรือส่งไฟล์ใหม่ให้ไม่ได้ภายใน 3 วันทำการ</li><li>ถูกเรียกเก็บเงินซ้ำสำหรับคำสั่งซื้อเดียวกัน</li><li>ได้รับสินค้าไม่ตรงกับที่ระบุในหน้าสินค้าอย่างมีนัยสำคัญ</li></ul>
<h2>ไม่คืนเงินเมื่อ</h2>
<ul><li>เปลี่ยนใจหลังดาวน์โหลดหรือปรับแต่งไฟล์แล้ว</li><li>ใช้ไม่ได้เพราะโปรแกรมของคุณไม่รองรับฟอร์แมต ทั้งที่ร้านมีฟอร์แมตอื่นให้เลือก (ร้านจะช่วยแนะนำวิธีใช้ก่อน)</li><li>ปัญหาจากฟอนต์ที่คุณอัปโหลดเอง</li></ul>
<h2>วิธีขอคืนเงิน</h2>
<ol><li>ติดต่อภายใน ${esc(L.refundDays)} วันหลังซื้อ ทาง ${legalFill(L.contactEmail, 'อีเมลติดต่อ')}</li><li>แจ้งรหัสคำสั่งซื้อ (8 ตัวในอีเมลยืนยัน) อีเมลบัญชี และอธิบายปัญหาพร้อมภาพหน้าจอ</li><li>ร้านตอบกลับภายใน 3 วันทำการ หากอนุมัติ จะคืนเงิน${manual ? 'โดยโอนกลับเข้าบัญชีที่คุณแจ้ง' : 'ผ่านช่องทางเดิม'}ภายใน 7–14 วันทำการ และนำสินค้าออกจากคลังของบัญชี</li></ol>` },
    privacy: { title: 'นโยบายความเป็นส่วนตัว (PDPA)', body: `
<p>${who} ("ร้าน") เป็นผู้ควบคุมข้อมูลส่วนบุคคลตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 นโยบายนี้อธิบายว่าเราเก็บและใช้ข้อมูลของคุณอย่างไร</p>
<h2>ข้อมูลที่เก็บ</h2>
<ul><li>ข้อมูลบัญชี: อีเมล ชื่อที่ใช้แสดง (ถ้ากรอก) และรหัสผ่านที่เข้ารหัสแบบทางเดียว (ร้านอ่านรหัสผ่านของคุณไม่ได้)</li><li>ข้อมูลการซื้อ: สินค้า ราคา เวลา และรหัสอ้างอิงการชำระเงิน (ร้านไม่เก็บเลขบัตร)</li><li>ข้อมูลการใช้งาน: ประวัติดาวน์โหลด ข้อความและสไตล์ที่ปรับแต่ง ฟอนต์ที่อัปโหลด และ IP สำหรับป้องกันการใช้งานผิดปกติ</li><li>คุกกี้ที่จำเป็นเท่านั้น: คุกกี้เข้าสู่ระบบ และคุกกี้ป้องกันการปลอมแบบฟอร์ม ไม่มีคุกกี้โฆษณาหรือติดตาม</li></ul>
<h2>ใช้ข้อมูลเพื่อ</h2>
<ul><li>ส่งมอบสินค้าและให้คุณดาวน์โหลดจากคลังได้ตลอด (ฐานสัญญา)</li><li>ส่งอีเมลยืนยันการสั่งซื้อ ยืนยันอีเมล และตั้งรหัสผ่านใหม่ (ฐานสัญญา)</li><li>ป้องกันการโกงและการแชร์บัญชี และทำตามกฎหมายภาษี/บัญชี (ฐานประโยชน์โดยชอบด้วยกฎหมาย และหน้าที่ตามกฎหมาย)</li></ul>
<h2>การเปิดเผยข้อมูล</h2>
<p>ร้านไม่ขายข้อมูลของคุณ เปิดเผยเฉพาะผู้ให้บริการที่จำเป็น เช่น ผู้ให้บริการชำระเงิน ผู้ให้บริการส่งอีเมล และผู้ให้บริการเซิร์ฟเวอร์ ตามขอบเขตที่จำเป็นเท่านั้น</p>
<h2>ระยะเวลาเก็บ</h2>
<ul><li>ข้อมูลบัญชีและคลัง: ตลอดที่บัญชียังใช้งาน (เพื่อให้ "ซื้อครั้งเดียว ใช้ได้ตลอด")</li><li>หลักฐานการซื้อ: ตามที่กฎหมายบัญชี/ภาษีกำหนด</li><li>บันทึกเพื่อความปลอดภัย: ไม่เกิน 90 วัน</li></ul>
<h2>สิทธิ์ของคุณ</h2>
<p>คุณขอเข้าถึง ขอสำเนา แก้ไข ลบ ระงับ คัดค้าน หรือขอโอนย้ายข้อมูลได้ และร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลได้ ติดต่อร้านเพื่อใช้สิทธิ์: ${contact}</p>
<h2>ความปลอดภัย</h2>
<p>รหัสผ่านเข้ารหัสแบบ scrypt ลิงก์ดาวน์โหลดเซ็นลายเซ็นและหมดอายุใน 10 นาที ไฟล์ของคุณเข้าถึงได้เฉพาะบัญชีของคุณ</p>` },
  };
  const p = pages[kind];
  return layout({
    title: p.title, shopName: cfg.shopName, user, csrf, page: 'page-legal',
    body: `<article class="narrow legal"><p class="eyebrow">${shop}</p><h1>${p.title}</h1><p class="muted small">${updated}</p>${p.body}
<h2>ติดต่อร้าน</h2><p>${who} · ${contact}</p></article>`,
  });
}

// หน้าติดต่อร้าน (ข้อมูลจาก .env: CONTACT_EMAIL, CONTACT_LINE, CONTACT_PHONE)
function contactPage({ cfg, user, csrf }) {
  const L = cfg.legal;
  const rows = [
    ['อีเมล', L.contactEmail ? `<a href="mailto:${esc(L.contactEmail)}">${esc(L.contactEmail)}</a>` : legalFill('', 'อีเมลติดต่อ')],
    L.line ? ['LINE', /^https:\/\//.test(L.line) ? `<a href="${esc(L.line)}" rel="noopener">${esc(L.line)}</a>` : esc(L.line)] : null,
    L.phone ? ['โทร', esc(L.phone)] : null,
  ].filter(Boolean);
  return layout({
    title: 'ติดต่อร้าน', shopName: cfg.shopName, user, csrf, page: 'page-legal',
    body: `<article class="narrow legal"><p class="eyebrow">${esc(cfg.shopName)}</p><h1>ติดต่อร้าน</h1>
<p class="lead">มีปัญหาเรื่องการโอนเงิน ดาวน์โหลด หรือใช้ไฟล์ในโปรแกรมตัดต่อ ทักมาได้เลย</p>
<section class="box"><dl class="contact-list">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></section>
<h2>ช่วยให้ร้านตอบได้เร็วขึ้น</h2>
<ul><li>แจ้งอีเมลที่ใช้สมัคร</li><li>ถ้าเป็นเรื่องการโอน แจ้งรหัสอ้างอิง (ขึ้นต้นด้วย AW-) ยอด และเวลาที่โอน</li><li>ถ้าไฟล์ใช้ไม่ได้ บอกชื่อโปรแกรมตัดต่อ และแนบภาพหน้าจอ</li></ul>
<p class="muted small">ร้านตอบภายใน 1–3 วันทำการ · ดูเพิ่มเติม: <a href="/refund">นโยบายคืนเงิน</a> · <a href="/license">สิทธิ์การใช้งาน</a></p></article>`,
  });
}

function verifyEmailBody({ cfg, user, url }) {
  return `สวัสดีค่ะ${user.name ? ` คุณ${user.name}` : ''}

กดลิงก์นี้เพื่อยืนยันอีเมลของบัญชี ${cfg.shopName}:
${url}

ลิงก์ใช้ได้ 48 ชั่วโมง ถ้าคุณไม่ได้สมัครสมาชิก เพิกเฉยอีเมลนี้ได้เลย
— ${cfg.shopName}`;
}

function resetEmailBody({ cfg, user, url }) {
  return `สวัสดีค่ะ${user.name ? ` คุณ${user.name}` : ''}

มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี ${user.email} ที่ ${cfg.shopName}
กดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (ใช้ได้ครั้งเดียว ภายใน 30 นาที):
${url}

ถ้าคุณไม่ได้ขอ เพิกเฉยอีเมลนี้ได้เลย รหัสผ่านเดิมยังใช้ได้ตามปกติ
— ${cfg.shopName}`;
}

// กล่องล็อกอินของ Clerk (มีปุ่ม Google) · สคริปต์ Clerk โหลดจากโดเมน Clerk ของร้าน (ดู src/clerk.js เรื่อง CSP)
// Clerk รุ่นใหม่ (Core 3): ตัวหลัก clerk-js@6 + หน้าตา @clerk/ui@1 แยกกัน (รุ่น 5 Clerk ปิดการล็อกอินแล้ว)
const CLERK_JS = '@clerk/clerk-js@6';
const CLERK_UI = '@clerk/ui@1';
function clerkScripts(cfg) {
  return `<script defer crossorigin="anonymous" data-clerk-publishable-key="${esc(cfg.clerk.publishableKey)}" src="https://${esc(cfg.clerk.frontendApi)}/npm/${CLERK_JS}/dist/clerk.browser.js"></script>
<script defer crossorigin="anonymous" src="https://${esc(cfg.clerk.frontendApi)}/npm/${CLERK_UI}/dist/ui.browser.js"></script>
<script type="module" src="/clerk-auth.js?v=${V}"></script>`;
}
function clerkAuth({ cfg, user, csrf, mode, next }) {
  const signup = mode === 'signup';
  const n = encodeURIComponent(next || '/library');
  return layout({
    title: signup ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-auth page-clerk', intro: false,
    body: `
<div class="auth clerk-auth">
  <div class="auth-card ca-card" data-ca-card>
    <div class="ca-head">
      ${logoMark(44, 'logo-mark ca-logo')}
      <h1 class="sr-only">${signup ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}</h1>
      <nav class="ca-tabs" aria-label="เลือก" style="--x:${signup ? 1 : 0}">
        <a href="/login?next=${n}" ${signup ? '' : 'aria-current="page"'}>เข้าสู่ระบบ</a>
        <a href="/signup?next=${n}" ${signup ? 'aria-current="page"' : ''}>สมัครสมาชิก</a>
        <span class="ca-pill" aria-hidden="true"></span>
      </nav>
    </div>
    <p class="error ca-error" role="alert" data-clerk-error hidden></p>
    <div class="ca-stage">
      <div class="ca-skeleton" data-clerk-loading aria-label="กำลังโหลด" role="status">
        <span class="sk sk-btn"></span>
        <span class="sk-or"><i></i><b>หรือ</b><i></i></span>
        <span class="sk sk-input"></span>
        <span class="sk sk-btn primary"></span>
      </div>
      <div class="ca-mount" data-clerk-auth data-mode="${signup ? 'signup' : 'login'}" data-next="${esc(next || '/library')}" data-csrf="${esc(csrf)}"><div id="clerk-auth" data-clerk-target></div></div>
      <div class="ca-done" data-clerk-done hidden>
        <svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27l7 7 15-16"/></svg>
        <p class="ca-done-title">เข้าสู่ระบบแล้ว</p>
      </div>
    </div>
    <noscript><p class="error">ต้องเปิด JavaScript ก่อน</p></noscript>
    <p class="muted small center ca-legal"><a href="/terms">เงื่อนไข</a> · <a href="/privacy">ความเป็นส่วนตัว</a></p>
  </div>
</div>
${clerkScripts(cfg)}`,
  });
}
function clerkSignedOut({ cfg, user, csrf }) {
  return layout({
    title: 'ออกจากระบบ', shopName: cfg.shopName, user, csrf, noindex: true, page: 'page-auth', intro: false,
    body: `
<div class="auth"><div class="auth-card" id="clerk-auth" data-clerk-signout>
  ${logoMark(48)}
  <h1>กำลังออกจากระบบ…</h1>
  <p class="muted"><a href="/">กลับหน้าแรก</a></p>
</div></div>
${clerkScripts(cfg)}`,
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
  <section class="box" id="fonts">
    <h2>ฟอนต์ที่ใช้</h2>
    <p class="muted small">${esc(LICENSE.font)} กดชื่อฟอนต์เพื่ออ่านสัญญาฉบับเต็ม</p>
    <ul class="font-licenses">${(cfg.fonts || []).map((f) => `<li><a href="/fonts/thai/${esc(f.id)}/OFL.txt">${esc(f.label)}</a></li>`).join('')}</ul>
  </section>
  <p><a class="btn" href="/library">${ICON.library} เปิดคลังของฉัน</a></p>
</div>`,
  });
}

function message({ cfg, user, csrf, title, text, action }) {
  return layout({
    title, shopName: cfg.shopName, user, csrf, noindex: true,
    body: `<div class="narrow"><h1>${esc(title)}</h1><p class="pre-line">${esc(text)}</p>
<p class="actions">${action ? `<a class="btn primary" href="${esc(action.href)}">${esc(action.label)}</a> ` : ''}<a class="btn" href="/">กลับหน้าร้าน</a></p></div>`,
  });
}

function admin({ cfg, user, csrf, orders, stats, tools, installHelp = [], reviewCount = 0, mail = null }) {
  const { editors } = cfg.editorsConfig;
  const productTitle = (slug) => (slug === cfg.premiumPack.slug ? cfg.premiumPack.title : (cfg.products.find((p) => p.slug === slug) || {}).title || slug);
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
    <td><span class="tag ${o.status}">${({ paid: 'จ่ายแล้ว', pending: 'รอจ่าย', review: 'รอตรวจสอบ', rejected: 'ปฏิเสธ', failed: 'ไม่สำเร็จ', expired: 'หมดอายุ', refunded: 'คืนเงินแล้ว' })[o.status] || o.status}</span></td>
    <td>${o.downloads ?? 0}</td>
  </tr>`).join('');
  return layout({
    title: 'หลังบ้าน', shopName: cfg.shopName, user, csrf, noindex: true, wide: true,
    body: `
<h1>หลังบ้าน</h1>
${cfg.paymentProvider === 'mock' ? '<div class="banner test">โหมดทดสอบการชำระเงิน (mock)</div>' : ''}
${cfg.paymentProvider === 'manual' ? `<a class="cz-cta review-cta${reviewCount ? ' has' : ''}" href="/admin/transfers"><span class="cz-cta-icon">${ICON.shield}</span><span><b>ตรวจสอบการโอนเงิน</b><small>${reviewCount ? `มี ${reviewCount} รายการรอตรวจสอบ` : 'ไม่มีรายการรอตรวจสอบ'}</small></span><span class="cz-cta-go">›</span></a>` : ''}
<div class="stats">
  <div class="stat"><span>คำสั่งซื้อที่จ่ายแล้ว</span><b>${stats.paid}</b></div>
  <div class="stat"><span>รอจ่าย</span><b>${stats.pending}</b></div>
  <div class="stat"><span>ยอดขาย</span><b>${baht(stats.revenue)}</b></div>
  <div class="stat"><span>สมาชิก</span><b>${stats.users}</b></div>
</div>
${tools ? `<div class="note${tools.ok ? '' : ' warn'}">${ICON.bolt}<span><b>ระบบปรับแต่ง (เรนเดอร์):</b> ${tools.ok ? `พร้อม · ใช้ ${esc(tools.browser.how)}${tools.browserMode ? '' : ' + ffmpeg'}` : `ยังไม่พร้อม<br>${installHelp.map((l) => esc(l)).join('<br>')}`}</span></div>` : ''}
${mail ? `<div class="note${mail.problem || mail.notifyProblem ? ' warn' : ''} mail-note">${ICON.mail}<span><b>อีเมลแจ้งร้าน:</b> ${mail.problem || mail.notifyProblem ? esc(mail.problem || mail.notifyProblem) : `พร้อมส่งผ่าน ${esc(mail.mode)} · ผู้ส่ง ${esc(mail.from)}`}<br><span class="small">ส่งถึง: ${mail.notify.length ? esc(mail.notify.join(', ')) : '-'}</span>
  <form method="post" action="/admin/mail-test"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="btn small" type="submit">ส่งเมลทดสอบ</button></form></span></div>` : ''}
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
${p.pack ? 'แอนิเมชันพรีเมียมทุกแบบ (รวมแบบใหม่ที่ร้านเพิ่มภายหลัง) อยู่' : 'แอนิเมชันนี้อยู่'}ในคลังของบัญชี ${order.email} แล้ว

เปิดใช้งานได้ที่คลังของคุณ (เข้าสู่ระบบด้วยอีเมลนี้):
${cfg.baseUrl}/library${p.pack ? '' : `/${order.id}`}

ในคลังเลือกโปรแกรมตัดต่อได้ตลอด แล้วโหลดไฟล์ที่ตรงกับโปรแกรมนั้น ทั้งคลิปเต็ม
และปรับแต่งข้อความ ฟอนต์ สี แนว และความยาวเองได้ (ได้เป็นไฟล์เดียว)

สิทธิ์การใช้งาน: ${LICENSE.short} ห้ามขายต่อหรือแจกต่อไฟล์ต้นฉบับ
อ่านเพิ่มเติม: ${cfg.baseUrl}/license

รหัสคำสั่งซื้อ: ${order.id.slice(0, 8)}
— ${cfg.shopName} · แอนิเมชันข้อความไทย`;
}

module.exports = { packPage, configure: (cfg) => { PACK_PRICE = cfg.premiumPack.price; }, clerkAuth, clerkSignedOut, browserScripts, contactPage, transferPay, adminTransfers, transferReceivedEmail, transferRejectedEmail, adminTransferEmail, bahtExact, omisePay, account, forgot, reset, legalPage, verifyEmailBody, resetEmailBody, home, product, mockPay, orderStatus, library, libraryItem, customize, customStatus, presetsPage, fontsPage, login, signup, licensePage, message, admin, emailBody, esc, baht, LICENSE };
// ตัวช่วยสำหรับหน้าซับอัตโนมัติ (src/views-subtitles.js)
module.exports._h = { browserScripts, layout, esc, ICON, V, fontFaces, fmtBytes, thDate, FILL_SWATCHES, STROKE_SWATCHES };
Object.assign(module.exports, require('./views-subtitles'));

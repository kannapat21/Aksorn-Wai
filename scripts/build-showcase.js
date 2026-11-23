'use strict';
// สร้างหน้าโชว์สินค้าแบบเว็บนิ่ง (static) ลงโฟลเดอร์ showcase/ สำหรับ Cloudflare Pages
// ใช้: node scripts/build-showcase.js
// ไม่อ่าน .env และไม่ใส่ข้อมูลการชำระเงินใดๆ ลงในหน้า
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'showcase');
const products = JSON.parse(fs.readFileSync(path.join(root, 'config/products.json'), 'utf8'));
const site = JSON.parse(fs.readFileSync(path.join(root, 'config/showcase.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baht = (satang) => `฿${(satang / 100).toLocaleString('th-TH')}`;
const safeUrl = (u) => (/^https:\/\//i.test(u || '') ? u : '');

fs.rmSync(out, { recursive: true, force: true });
for (const d of ['previews', 'fonts']) fs.mkdirSync(path.join(out, d), { recursive: true });
const copy = (from, to) => fs.copyFileSync(path.join(root, from), path.join(out, to));
copy('public/logo.svg', 'logo.svg');
copy('public/fonts/Kanit-Regular.ttf', 'fonts/Kanit-Regular.ttf');
copy('public/fonts/Kanit-Bold.ttf', 'fonts/Kanit-Bold.ttf');

const orderUrl = safeUrl(site.orderUrl);
const cards = [];
for (const p of products) {
  const media = {};
  for (const o of ['vertical', 'horizontal']) {
    const base = `public/previews/${p.slug}_${o}`;
    if (fs.existsSync(path.join(root, base + '.mp4'))) {
      copy(base + '.mp4', `previews/${p.slug}_${o}.mp4`);
      copy(base + '.jpg', `previews/${p.slug}_${o}.jpg`);
      media[o] = `previews/${p.slug}_${o}`;
    }
  }
  const v = media.horizontal || media.vertical;
  if (!v) { console.warn(`ข้าม ${p.slug}: ไม่มีวิดีโอตัวอย่างใน public/previews`); continue; }
  const faq = (p.faq || []).map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  const tabs = media.horizontal && media.vertical
    ? `<div class="tabs" role="group" aria-label="สัดส่วนวิดีโอ">
        <button type="button" aria-pressed="true" data-src="${media.horizontal}">แนวนอน 16:9</button>
        <button type="button" aria-pressed="false" data-src="${media.vertical}">แนวตั้ง 9:16</button>
      </div>` : '';
  cards.push(`
  <article class="card" id="${esc(p.slug)}">
    <div class="stage"><video src="${v}.mp4" poster="${v}.jpg" autoplay muted loop playsinline preload="metadata"></video></div>
    ${tabs}
    <div class="body">
      <p class="cat">${esc(p.category)}</p>
      <h2>${esc(p.title)}</h2>
      <p class="sub">${esc(p.subtitle)}</p>
      <p class="desc">${esc(p.description)}</p>
      <div class="buy">
        <span class="price">${baht(p.price)}</span>
        ${orderUrl ? `<a class="btn" href="${esc(orderUrl)}" target="_blank" rel="noopener">${esc(site.orderLabel)}</a>` : `<span class="btn off">เปิดขายเร็วๆ นี้</span>`}
      </div>
      ${faq ? `<div class="faq">${faq}</div>` : ''}
    </div>
  </article>`);
}

const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(site.shopName)}</title>
<meta name="description" content="${esc(site.tagline)}">
<link rel="icon" href="logo.svg" type="image/svg+xml">
<style>
@font-face{font-family:Kanit;src:url(fonts/Kanit-Regular.ttf) format("truetype");font-weight:400;font-display:swap}
@font-face{font-family:Kanit;src:url(fonts/Kanit-Bold.ttf) format("truetype");font-weight:700;font-display:swap}
:root{--bg:#f6f6f3;--surface:#fff;--ink:#171a20;--muted:#5d636e;--line:#e3e3dd;--accent:#1e3a5f;--accent-ink:#fff;--brand:#ffd400;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--surface:#171a21;--ink:#e8e9ec;--muted:#9aa0ab;--line:#2a2f39;--accent:#9cbcf0;--accent-ink:#0f1115;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Kanit,system-ui,sans-serif;line-height:1.6}
header{display:flex;align-items:center;gap:12px;padding:16px;max-width:1100px;margin:0 auto}
header img{width:40px;height:40px}
header b{font-size:1.25rem}
.hero{max-width:1100px;margin:0 auto;padding:8px 16px 24px}
.hero h1{font-size:clamp(1.6rem,4vw,2.4rem);margin:0 0 6px;line-height:1.25}
.hero p{margin:0;color:var(--muted)}
main{max-width:1100px;margin:0 auto;padding:0 16px 48px;display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(min(100%,460px),1fr))}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.stage{background:#111;display:flex;justify-content:center;aspect-ratio:16/9}
.stage video{max-width:100%;max-height:100%;display:block}
.tabs{display:flex;gap:8px;padding:12px 16px 0}
.tabs button{font:inherit;border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:999px;padding:4px 12px;cursor:pointer}
.tabs button[aria-pressed=true]{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.body{padding:12px 16px 16px}
.cat{margin:0;color:var(--muted);font-size:.9rem}
h2{margin:2px 0 0;font-size:1.5rem}
.sub{margin:0 0 8px;color:var(--muted)}
.desc{margin:0 0 12px}
.buy{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.price{font-size:1.6rem;font-weight:700}
.btn{display:inline-block;background:var(--brand);color:#171a20;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:10px}
.btn.off{background:var(--line);color:var(--muted)}
.faq{margin-top:12px;border-top:1px solid var(--line)}
details{border-bottom:1px solid var(--line);padding:8px 0}
summary{cursor:pointer;font-weight:700}
details p{margin:6px 0 0;color:var(--muted)}
footer{text-align:center;color:var(--muted);font-size:.85rem;padding:0 16px 32px}
</style>
</head>
<body>
<header><img src="logo.svg" alt=""><b>${esc(site.shopName)}</b></header>
<section class="hero"><h1>${esc(site.tagline)}</h1><p>วิดีโอตัวอย่างมีลายน้ำ ไฟล์จริงคมชัด 1080p 60fps ไม่มีลายน้ำ</p></section>
<main>${cards.join('')}
</main>
<footer>ฟอนต์ Kanit ใช้สัญญา SIL Open Font License</footer>
<script>
document.querySelectorAll('.tabs').forEach(function(t){
  t.addEventListener('click',function(e){
    var b=e.target.closest('button'); if(!b) return;
    t.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false')});
    var v=t.previousElementSibling.querySelector('video'); v.poster=b.dataset.src+'.jpg'; v.src=b.dataset.src+'.mp4'; v.play().catch(function(){});
  });
});
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n');
console.log(`สร้างหน้าโชว์แล้ว ${cards.length} สินค้า → showcase/index.html`);

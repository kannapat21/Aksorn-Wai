/*
 * Service worker ของแอป (ติดตั้งลงหน้าจอโฮมได้)
 *  - เก็บเฉพาะไฟล์หน้าตาร้าน (CSS/JS/ฟอนต์/ไอคอน) ไว้ให้เปิดเร็ว
 *  - ไม่เก็บหน้าเว็บ หน้าบัญชี คลัง หลังบ้าน หรือไฟล์ดาวน์โหลดเลย (ข้อมูลส่วนตัว/ลิงก์ที่เซ็นแล้ว)
 *  - ถ้าออฟไลน์ตอนเปิดหน้า แสดงหน้า /offline.html
 */
const VERSION = '__VERSION__';
const CACHE = `aksornwai-static-${VERSION}`;
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/fonts/Kanit-Bold.ttf', '/logo.svg', '/favicon.svg'];
const STATIC = /^\/(style\.css|app\.js|theme\.js|motion\.js|customize\.js|wizard\.js|transfer\.js|logo\.svg|favicon\.svg|offline\.html|manifest\.webmanifest)$|^\/(fonts|icons)\//;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('aksornwai-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // หน้าเว็บ: โหลดจากเน็ตเสมอ (ไม่เก็บ) ออฟไลน์ → หน้าออฟไลน์
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  // ไฟล์หน้าตาร้าน: ใช้ของที่เก็บไว้ก่อน แล้วอัปเดตเบื้องหลัง
  if (STATIC.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok && res.type === 'basic') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    }));
  }
  // อย่างอื่น (คลัง หลังบ้าน /d /c ไฟล์ดาวน์โหลด ฟอนต์ของลูกค้า พรีวิว ฯลฯ) ปล่อยผ่านเบราว์เซอร์ตามปกติ ไม่เก็บ
});

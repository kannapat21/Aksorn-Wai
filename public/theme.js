// รันก่อนวาดหน้า: ตั้งธีม และตัดสินใจว่าจะแสดงหน้าโหลดไหม (กันจอกะพริบ)
(function () {
  var root = document.documentElement;
  try {
    var t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
  } catch (e) { /* ใช้ตามระบบ */ }
  // แสดงหน้าโหลดเมื่อ "เข้าเว็บ" (เปิดใหม่ / มาจากเว็บอื่น / กดรีเฟรช) ไม่แสดงตอนกดลิงก์ไปมาในเว็บ
  var entering = true;
  try {
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    var internal = document.referrer && new URL(document.referrer).origin === location.origin;
    entering = !internal || (nav && nav.type === 'reload');
    if (nav && nav.type === 'back_forward') entering = false;
    // หน้ารอผลชำระเงินรีโหลดเองเมื่อสถานะเปลี่ยน: ไม่ต้องโชว์หน้าโหลดซ้ำ
    if (sessionStorage.getItem('noIntroOnce')) { sessionStorage.removeItem('noIntroOnce'); entering = false; }
  } catch (e) { entering = true; }
  root.classList.add(entering ? 'intro' : 'no-intro');
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) root.classList.add('calm');
})();

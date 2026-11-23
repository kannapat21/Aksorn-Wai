// หน้าโอนเงิน: ปุ่มคัดลอกยอด/เลขบัญชี
(function () {
  'use strict';
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    var label = b.textContent;
    b.addEventListener('click', function () {
      var text = b.getAttribute('data-copy');
      var done = function (ok) {
        b.textContent = ok ? 'คัดลอกแล้ว ✓' : 'คัดลอกไม่ได้ ลองกดค้างที่ตัวเลข';
        setTimeout(function () { b.textContent = label; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      else {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta); done(ok);
      }
    });
  });
})();

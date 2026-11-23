// หน้าโอนเงิน: ปุ่มคัดลอกยอด/เลขบัญชี · กดยืนยันแล้วจำไว้ให้หน้าถัดไปเล่นแอนิเมชันสำเร็จ
(function () {
  'use strict';
  var wrap = document.querySelector('.transfer[data-order]');
  var form = document.querySelector('.xfer-confirm');
  if (wrap && form) {
    form.addEventListener('submit', function (e) {
      // รอให้กล่องถามยืนยันทำงานก่อน ถ้ากดยกเลิกไม่ต้องทำอะไร
      setTimeout(function () {
        if (e.defaultPrevented) return;
        form.classList.add('sending');
        try { sessionStorage.setItem('justConfirmed', wrap.getAttribute('data-order')); } catch (err) { /* ข้าม */ }
      }, 0);
    });
  }
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

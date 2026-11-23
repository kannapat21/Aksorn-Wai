// หน้าจ่ายเงิน Omise: เลขบัตรส่งตรงไป Omise ด้วย Omise.js ได้โทเคนแล้วค่อยส่งโทเคน (ไม่ใช่เลขบัตร) มาที่ร้าน
(function () {
  'use strict';
  var form = document.querySelector('[data-omise-card]');
  if (!form) return;
  var err = form.querySelector('[data-card-error]');
  var show = function (m) { err.textContent = m; err.hidden = !m; };
  var val = function (k) { return form.querySelector('[data-card="' + k + '"]').value.replace(/\s+/g, k === 'name' ? ' ' : '').trim(); };
  form.addEventListener('submit', function (e) {
    if (form.querySelector('[data-omise-token]').value) return; // ได้โทเคนแล้ว ส่งได้
    e.preventDefault();
    show('');
    if (!window.Omise) { show('โหลดระบบชำระเงินไม่สำเร็จ กรุณาโหลดหน้าใหม่'); return; }
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.classList.add('loading');
    window.Omise.setPublicKey(form.getAttribute('data-pkey'));
    window.Omise.createToken('card', {
      name: val('name'), number: val('number'),
      expiration_month: val('expiration_month'), expiration_year: val('expiration_year'),
      security_code: val('security_code'),
    }, function (status, res) {
      if (status === 200 && res && res.id) {
        form.querySelector('[data-omise-token]').value = res.id;
        // ล้างช่องบัตรก่อนส่ง (ช่องบัตรไม่มี name อยู่แล้ว จึงไม่ถูกส่งไปเซิร์ฟเวอร์)
        form.querySelectorAll('[data-card]').forEach(function (i) { i.value = ''; });
        form.submit();
      } else {
        btn.disabled = false; btn.classList.remove('loading');
        show((res && res.message) ? 'บัตรใช้ไม่ได้: ' + res.message : 'ตรวจข้อมูลบัตรอีกครั้ง');
      }
    });
  });
})();

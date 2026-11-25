// กล่องล็อกอินของ Clerk (ปุ่ม Google / อีเมล) บนหน้า /login /signup และออกจาก Clerk หลังออกจากระบบของร้าน
// ล็อกอินกับ Clerk เสร็จ → ขอ session token → ส่งให้ร้านที่ POST /auth/clerk → ร้านเปิดเซสชันของตัวเองแล้วพาไปหน้าถัดไป
const root = document.querySelector('[data-clerk-auth], [data-clerk-signout]');
const errBox = document.querySelector('[data-clerk-error]');
const loading = document.querySelector('[data-clerk-loading]');

function showError(msg) {
  if (loading) loading.hidden = true;
  if (!errBox) return;
  errBox.textContent = msg;
  errBox.hidden = false;
}

async function waitForClerk(ms = 20000) {
  const end = Date.now() + ms;
  while (!window.Clerk && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  return window.Clerk || null;
}

async function main() {
  if (!root) return;
  const Clerk = await waitForClerk();
  if (!Clerk) {
    if (root.hasAttribute('data-clerk-signout')) return location.replace('/');
    return showError('โหลดระบบเข้าสู่ระบบไม่สำเร็จ ลองโหลดหน้าใหม่ หรือใช้ "เข้าด้วยรหัสผ่านแบบเดิม" ด้านล่าง');
  }
  let localization;
  try { localization = (await import('/vendor/clerk-th-TH.mjs')).thTH; } catch { /* ไม่มีไฟล์ภาษาไทย ใช้ภาษาอังกฤษไป */ }
  await Clerk.load({
    localization,
    appearance: {
      variables: { colorPrimary: '#1E3A5F', fontFamily: 'inherit', borderRadius: '12px' },
      elements: { rootBox: { width: '100%' }, cardBox: { width: '100%', boxShadow: 'none' } },
    },
  });

  if (root.hasAttribute('data-clerk-signout')) {
    try { await Clerk.signOut(); } catch { /* ออกจากร้านแล้ว ไม่ต้องรอ Clerk */ }
    return location.replace('/');
  }

  const { mode, next, csrf } = root.dataset;
  let busy = false;
  async function exchange() {
    if (busy || !Clerk.session) return;
    busy = true;
    try {
      const token = await Clerk.session.getToken();
      const r = await fetch('/auth/clerk', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token, csrf, next }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) return location.replace(j.next || next || '/library');
      showError(j.error || 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
      if (r.status === 403 || r.status === 401) await Clerk.signOut().catch(() => {});
    } catch {
      showError('เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
    }
    busy = false;
  }

  // ล็อกอินกับ Clerk อยู่แล้ว (เช่น กลับมาจากหน้า Google) → เข้าร้านเลย
  if (Clerk.session) return exchange();
  Clerk.addListener(({ session }) => { if (session) exchange(); });

  const n = encodeURIComponent(next || '/library');
  const here = location.pathname + location.search;
  const opts = {
    routing: 'hash',
    forceRedirectUrl: here, signInForceRedirectUrl: here, signUpForceRedirectUrl: here,
    signInUrl: `/login?next=${n}`, signUpUrl: `/signup?next=${n}`,
  };
  if (loading) loading.remove();
  if (mode === 'signup') Clerk.mountSignUp(root, opts);
  else Clerk.mountSignIn(root, opts);
}

main().catch(() => showError('ระบบเข้าสู่ระบบขัดข้อง ลองโหลดหน้าใหม่ หรือใช้ "เข้าด้วยรหัสผ่านแบบเดิม" ด้านล่าง'));

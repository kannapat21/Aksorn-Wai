// กล่องล็อกอินของ Clerk (ปุ่ม Google / อีเมล) บนหน้า /login /signup และออกจาก Clerk หลังออกจากระบบของร้าน
// ล็อกอินกับ Clerk เสร็จ → ขอ session token → ส่งให้ร้านที่ POST /auth/clerk → ร้านเปิดเซสชันของตัวเองแล้วพาไปหน้าถัดไป
// หน้าตา: สีจากตัวแปร CSS ของร้าน (สลับโหมดมืดแล้ววาดกล่องใหม่) + class ak-* ที่แต่งใน style.css
const root = document.querySelector('[data-clerk-auth], [data-clerk-signout]');
// Clerk เขียนทับ class ของกล่องที่ mount ลงไป จึง mount ลงกล่องลูกด้านใน (class ของร้านอยู่ที่กล่องนอก)
const target = (root && root.querySelector('[data-clerk-target]')) || root;
const stage = document.querySelector('.ca-stage');
const errBox = document.querySelector('[data-clerk-error]');
const doneBox = document.querySelector('[data-clerk-done]');
const html = document.documentElement;

function showError(msg) {
  if (stage) stage.classList.add('ready');
  if (!errBox) return;
  errBox.hidden = true;
  errBox.textContent = msg;
  errBox.hidden = false;
}

async function waitForClerk(ms = 20000) {
  const end = Date.now() + ms;
  while (!window.Clerk && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  return window.Clerk || null;
}

// แท็บ เข้าสู่ระบบ / สมัครสมาชิก: เลื่อนแถบก่อน แล้วค่อยเปลี่ยนหน้า
const tabs = document.querySelector('.ca-tabs');
if (tabs) {
  tabs.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a || a.hasAttribute('aria-current') || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    tabs.classList.add('go');
    a.style.color = 'var(--accent-ink)';
    setTimeout(() => { location.href = a.href; }, html.classList.contains('calm') ? 0 : 260);
  });
}

function cssVar(name, fallback) {
  const v = getComputedStyle(html).getPropertyValue(name).trim();
  return v || fallback;
}

function appearance() {
  return {
    variables: {
      colorPrimary: cssVar('--accent', '#1e3a5f'),
      colorTextOnPrimaryBackground: cssVar('--accent-ink', '#ffffff'),
      colorBackground: cssVar('--surface', '#ffffff'),
      colorInputBackground: cssVar('--surface-2', '#f0f0ec'),
      colorInputText: cssVar('--ink', '#171a20'),
      colorText: cssVar('--ink', '#171a20'),
      colorTextSecondary: cssVar('--muted', '#5d636e'),
      colorNeutral: cssVar('--ink', '#171a20'),
      colorDanger: cssVar('--err', '#b42318'),
      colorSuccess: cssVar('--ok', '#127a3a'),
      fontFamily: 'Kanit, system-ui, sans-serif',
      fontFamilyButtons: 'Kanit, system-ui, sans-serif',
      borderRadius: '12px',
      fontSize: '15px',
    },
    elements: {
      rootBox: { width: '100%' },
      cardBox: { width: '100%', boxShadow: 'none', border: 'none', background: 'transparent', borderRadius: '0' },
      card: { background: 'transparent', boxShadow: 'none', border: 'none', padding: '0', gap: '20px' },
      footer: { background: 'transparent', borderTop: '1px solid var(--line)', marginTop: '2px', paddingTop: '4px' },
      footerAction: { display: 'none' }, // สลับเข้าสู่ระบบ/สมัครใช้แท็บด้านบนแทน
      socialButtonsBlockButton: 'ak-social',
      form: 'ak-form',
      formFieldInput: 'ak-input',
      formButtonPrimary: 'ak-primary',
      headerTitle: { fontSize: '1.15rem' },
    },
    // ซ่อนป้าย "Development mode" ของ Clerk (ตัวเลือกที่ Clerk มีให้เอง) · ป้าย "Secured by Clerk" ปิดได้เฉพาะแพ็กเกจเสียเงินของ Clerk
    layout: { socialButtonsPlacement: 'top', socialButtonsVariant: 'blockButton', shimmer: false, unsafe_disableDevelopmentModeWarnings: true },
  };
}

async function main() {
  if (!root) return;
  const Clerk = await waitForClerk();
  if (!Clerk) {
    if (root.hasAttribute('data-clerk-signout')) return location.replace('/');
    return showError('โหลดระบบเข้าสู่ระบบไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วโหลดหน้าใหม่อีกครั้ง');
  }
  let localization;
  try { localization = (await import('/vendor/clerk-th-TH.mjs')).thTH; } catch { /* ไม่มีไฟล์ภาษาไทย ใช้ภาษาอังกฤษไป */ }
  await Clerk.load({ localization, appearance: appearance() });

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
      if (r.ok && j.ok) {
        // โชว์เครื่องหมายถูกสั้นๆ ก่อนไปต่อ
        if (stage && doneBox) { doneBox.hidden = false; stage.classList.add('ready', 'done'); }
        const wait = html.classList.contains('calm') ? 150 : 750;
        return setTimeout(() => location.replace(j.next || next || '/library'), wait);
      }
      showError(j.error || 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
      if (r.status === 403 || r.status === 401) await Clerk.signOut().catch(() => {});
    } catch {
      showError('เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
    }
    busy = false;
  }

  // ล็อกอินกับ Clerk อยู่แล้ว (เช่น กลับมาจากหน้า Google) → เข้าร้านเลย
  if (Clerk.session) {
    if (stage) stage.classList.add('ready');
    return exchange();
  }
  Clerk.addListener(({ session }) => { if (session) exchange(); });

  const n = encodeURIComponent(next || '/library');
  const here = location.pathname + location.search;
  const opts = () => ({
    routing: 'hash',
    forceRedirectUrl: here, signInForceRedirectUrl: here, signUpForceRedirectUrl: here,
    signInUrl: `/login?next=${n}`, signUpUrl: `/signup?next=${n}`,
    appearance: appearance(),
  });
  const mount = () => (mode === 'signup' ? Clerk.mountSignUp(target, opts()) : Clerk.mountSignIn(target, opts()));
  const unmount = () => (mode === 'signup' ? Clerk.unmountSignUp(target) : Clerk.unmountSignIn(target));
  mount();

  // ซ่อนโครงกระพริบเมื่อกล่องของ Clerk วาดเสร็จ
  const reveal = () => stage && stage.classList.add('ready');
  if (root.querySelector('.cl-rootBox')) reveal();
  else {
    const mo = new MutationObserver(() => { if (root.querySelector('.cl-card, .cl-rootBox')) { reveal(); mo.disconnect(); } });
    mo.observe(root, { childList: true, subtree: true });
    setTimeout(reveal, 6000);
  }

  // สลับโหมดสว่าง/มืด → วาดกล่องใหม่ด้วยสีใหม่
  const repaint = () => { try { unmount(); mount(); } catch { /* ไม่เป็นไร */ } };
  new MutationObserver(repaint).observe(html, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', repaint);
}

main().catch(() => showError('ระบบเข้าสู่ระบบขัดข้อง ลองโหลดหน้าใหม่อีกครั้ง'));

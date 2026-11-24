'use strict';
/*
 * ร้านทั้งร้านเป็นฟังก์ชันเดียวบน Netlify (Express เดิม ห่อด้วย serverless-http)
 *   - ไฟล์ใน public/ Netlify เสิร์ฟเองจาก CDN (ไม่ผ่านฟังก์ชัน ไม่กินโควตาฟังก์ชัน)
 *   - ฐานข้อมูล = Turso · ไฟล์สินค้า = Supabase Storage · ถอดเสียง = Groq · เรนเดอร์ = เบราว์เซอร์ลูกค้า
 * เปิดร้านครั้งเดียวต่อ "เครื่อง" ของฟังก์ชัน แล้วใช้ซ้ำจนกว่า Netlify จะปิดเครื่องนั้น
 */
const serverless = require('serverless-http');

let handler = null;
let bootError = null;

function boot() {
  const { loadConfig } = require('../../src/config');
  const { createApp } = require('../../src/app');
  const cfg = loadConfig();
  const { app } = createApp(cfg);
  return serverless(app, {
    // ไฟล์ไบนารีที่ฟังก์ชันส่งกลับ (QR, ฟอนต์ลูกค้า) ต้องส่งแบบ base64
    binary: ['image/*', 'font/*', 'application/octet-stream', 'application/x-subrip'],
  });
}

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  if (!handler && !bootError) {
    try { handler = boot(); } catch (e) { bootError = e; console.error(e); }
  }
  if (bootError) {
    return {
      statusCode: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      body: `ร้านยังตั้งค่าไม่ครบ ดูรายละเอียดใน Netlify > Logs > Functions\n\n${bootError.message}`,
    };
  }
  // บางกรณี Netlify ส่ง path ของฟังก์ชันมา (/.netlify/functions/server/...) แทน path ที่ลูกค้าเปิด
  if (event.path && event.path.startsWith('/.netlify/functions/server')) event.path = event.path.slice('/.netlify/functions/server'.length) || '/';
  return handler(event, context);
};

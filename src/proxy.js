'use strict';
/*
 * IP จริงของลูกค้า + https เมื่อร้านอยู่หลังพร็อกซีของโฮสต์ (Render ใช้ Cloudflare + load balancer)
 *
 * ปัญหาเดิม: Express เชื่อ X-Forwarded-* เฉพาะจาก loopback · บน Render คำขอมาจาก load balancer ภายใน
 *  → req.ip ของลูกค้าทุกคนเป็น IP เดียวกัน (ของ load balancer) ตัวจำกัดจำนวนครั้งต่อ IP เลยนับรวมทั้งเว็บ
 *    (คนเดียวยิงถี่ๆ ทำให้ทุกคนล็อกอินไม่ได้) และ req.secure เป็น false → คุกกี้ไม่ติด Secure, ไม่ส่ง HSTS
 *
 * แหล่ง IP (เรียงตามความน่าเชื่อ):
 *  1. CF-Connecting-IP  Cloudflare เขียนทับค่าที่ลูกค้าส่งมาเองเสมอ ปลอมไม่ได้
 *  2. True-Client-IP    Cloudflare ตั้งให้เช่นกัน (Render แนะนำตัวนี้)
 *  3. X-Forwarded-For   ตัวแรกสุด (Render บอกว่าเป็น IP ลูกค้า) · ใช้เมื่อไม่มีสองตัวบนเท่านั้น
 * เปิดใช้เมื่อ TRUST_PROXY=render|cloudflare หรือรันบน Render (Render ตั้ง RENDER=true ให้เอง)
 */
const net = require('net');

function proxyMode(env) {
  const v = String(env.TRUST_PROXY || '').trim().toLowerCase();
  if (v === 'off' || v === '0' || v === 'none') return '';
  if (v === 'render' || v === 'cloudflare') return v;
  return env.RENDER ? 'render' : '';
}

const first = (v) => String(v || '').split(',')[0].trim();
const validIp = (s) => (s && s.length <= 64 && net.isIP(s.replace(/^::ffff:/, '')) ? s : '');

function clientIp(headers) {
  const h = (k) => headers[k];
  const cf = validIp(first(h('cf-connecting-ip')));
  if (cf) return { ip: cf, from: 'cf-connecting-ip' };
  const tc = validIp(first(h('true-client-ip')));
  if (tc) return { ip: tc, from: 'true-client-ip' };
  const xf = validIp(first(h('x-forwarded-for')));
  if (xf) return { ip: xf, from: 'x-forwarded-for' };
  return null;
}

// middleware: ตั้ง req.ip และ req.protocol/req.secure จาก header ของพร็อกซี
function trustHostProxy(mode, log = console.log) {
  let told = false;
  return (req, res, next) => {
    const got = clientIp(req.headers);
    if (got) Object.defineProperty(req, 'ip', { value: got.ip, configurable: true });
    const proto = first(req.headers['x-forwarded-proto']).toLowerCase();
    if (proto === 'https' || proto === 'http') {
      Object.defineProperty(req, 'protocol', { value: proto, configurable: true });
      Object.defineProperty(req, 'secure', { value: proto === 'https', configurable: true });
    }
    if (!told && got) {
      told = true; // บอกครั้งเดียวว่าใช้ header ไหน (ไม่พิมพ์ IP ลง log)
      log(`[security] อยู่หลังพร็อกซี (${mode}) ใช้ IP ลูกค้าจาก ${got.from}${proto ? ` · โปรโตคอลจาก x-forwarded-proto` : ''}`);
    }
    next();
  };
}

module.exports = { proxyMode, clientIp, trustHostProxy };

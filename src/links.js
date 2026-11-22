'use strict';
/*
 * ลิงก์ดาวน์โหลดเซ็นด้วย HMAC-SHA256
 *   /d/<grantId>?e=<หมดอายุ unix วินาที>&s=<ลายเซ็น>
 * ลายเซ็นครอบ grantId + เวลาหมดอายุ แก้ค่า e เพื่อยืดอายุเองไม่ได้
 */
const crypto = require('crypto');

function sign(secret, grantId, exp) {
  return crypto.createHmac('sha256', secret).update(`dl.v1.${grantId}.${exp}`).digest('base64url');
}

function verify(secret, grantId, exp, sig, nowSec = Math.floor(Date.now() / 1000)) {
  if (typeof grantId !== 'string' || typeof sig !== 'string' || !/^\d{1,12}$/.test(String(exp))) return 'bad';
  const expected = Buffer.from(sign(secret, grantId, exp));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return 'bad';
  if (Number(exp) < nowSec) return 'expired';
  return 'ok';
}

function buildDownloadPath(secret, grantId, exp) {
  return `/d/${grantId}?e=${exp}&s=${sign(secret, grantId, exp)}`;
}

module.exports = { sign, verify, buildDownloadPath };

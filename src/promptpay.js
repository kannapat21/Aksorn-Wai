'use strict';
/*
 * PromptPay QR (มาตรฐาน EMVCo ของ ธปท.): สร้างข้อความ QR ที่ใส่เบอร์/เลขบัตรผู้รับ และยอดเงิน แล้วเรนเดอร์เป็นรูป SVG
 * ข้อมูลผู้รับมาจาก .env เท่านั้น (PROMPTPAY_ID) ไม่เก็บในโค้ด
 */
const QRCode = require('qrcode');

const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;

// CRC16-CCITT (poly 0x1021, init 0xFFFF) ตามข้อกำหนด EMVCo
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// เบอร์มือถือ 10 หลัก (0xxxxxxxxx) หรือเลขบัตรประชาชน/เลขผู้เสียภาษี 13 หลัก
function normalizeId(raw) {
  const d = String(raw || '').replace(/[\s-]/g, '');
  if (/^0\d{9}$/.test(d)) return { kind: 'phone', value: d };
  if (/^\d{13}$/.test(d)) return { kind: 'citizen', value: d };
  return null;
}

// amountSatang: จำนวนเต็มสตางค์ (4937 = 49.37 บาท)
function payload(id, amountSatang) {
  const n = normalizeId(id);
  if (!n) throw new Error('PROMPTPAY_ID ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลข 13 หลัก');
  const target = n.kind === 'phone' ? tlv('01', '0066' + n.value.slice(1)) : tlv('02', n.value);
  const merchant = tlv('29', tlv('00', 'A000000677010111') + target);
  const amount = Number(amountSatang) > 0 ? tlv('54', (Number(amountSatang) / 100).toFixed(2)) : '';
  const body = tlv('00', '01') + tlv('01', amount ? '12' : '11') + merchant + tlv('58', 'TH') + tlv('53', '764') + amount + '6304';
  return body + crc16(body);
}

async function svg(id, amountSatang) {
  return QRCode.toString(payload(id, amountSatang), { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
}

// รูป PNG สำหรับกด "บันทึกรูป" บนมือถือ แล้วเลือกจากคลังภาพในแอปธนาคาร
async function png(id, amountSatang) {
  return QRCode.toBuffer(payload(id, amountSatang), { type: 'png', margin: 4, width: 720, errorCorrectionLevel: 'M' });
}

module.exports = { payload, svg, png, crc16, normalizeId };

# หน้าโชว์สินค้าบน Cloudflare Pages

หน้าโชว์เป็นเว็บนิ่ง (มีวิดีโอตัวอย่าง ราคา คำถามที่พบบ่อย) อยู่ในโฟลเดอร์ `showcase/`
ไม่มีระบบสั่งซื้อ ไม่มีข้อมูลการชำระเงิน และไม่อ่านไฟล์ `.env`

## เชื่อมครั้งแรก (ทำครั้งเดียว)

1. เข้า dash.cloudflare.com แล้วล็อกอิน (สมัครฟรี ไม่ต้องใช้บัตร)
2. ไปที่ **Workers & Pages > Create > Pages > Connect to Git**
3. กดเชื่อม GitHub แล้วเลือก repo **Aksorn-Wai**
4. ตั้งค่าตามนี้
   - Production branch: `main`
   - Framework preset: `None`
   - Build command: ปล่อยว่าง
   - Build output directory: `/`
   - **Root directory (advanced): `showcase`**
5. กด **Save and Deploy** รอ 1 นาที จะได้ลิงก์แบบ `https://aksorn-wai.pages.dev`

## เพิ่มสินค้าใหม่ / ใส่ลิงก์ปุ่มสั่งซื้อ

1. ลิงก์ปุ่มสั่งซื้ออยู่ใน `config/showcase.json` ช่อง `orderUrl` (ต้องขึ้นต้นด้วย https://) ถ้าว่างปุ่มจะขึ้นว่า "เปิดขายเร็วๆ นี้"
2. หลังเรนเดอร์สินค้าใหม่ หรือแก้ `config/showcase.json` ให้พิมพ์
   ```
   node scripts/build-showcase.js
   ```
3. commit แล้ว push ขึ้น GitHub ไม่กี่วินาที Cloudflare จะอัปเดตหน้าเว็บเอง

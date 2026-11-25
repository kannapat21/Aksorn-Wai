# ตั้งค่า Clerk (เข้าสู่ระบบด้วย Google)

ร้านใช้ Clerk ทำหน้าเข้าสู่ระบบ/สมัครสมาชิก มีปุ่ม "เข้าสู่ระบบด้วย Google"
Clerk ส่งอีเมลยืนยันและอีเมลลืมรหัสผ่านให้เอง ร้านไม่ต้องตั้ง Brevo หรือ SMTP เพื่อเรื่องล็อกอิน

> ใช้เวลาประมาณ 10 นาที · ฟรี ไม่ต้องใช้บัตร
> **อย่าวางกุญแจ (pk_… / sk_…) ในแชตหรือในไฟล์ของโปรเจกต์** วางใน Render เท่านั้น

## 1. สมัคร Clerk และสร้างแอป

1. เปิด https://dashboard.clerk.com แล้วกด **Sign up** (สมัครด้วย Google ได้เลย)
2. หน้า **Create application**
   - Application name: `อักษรไหว`
   - ตรง Sign in options: เปิด **Email** และ **Google** (อย่างอื่นปิดไว้)
   - กด **Create application**
3. Clerk สร้างแอปแบบ **Development** ให้อัตโนมัติ ใช้แบบนี้ไปก่อน (ไม่ต้องกดสร้าง Production)

## 2. คัดลอกกุญแจ 2 ตัว

1. ในเมนูซ้ายของ Clerk กด **Configure** → **API keys**
2. จะเห็นกุญแจ 2 ตัว
   - **Publishable key** ขึ้นต้นด้วย `pk_test_`
   - **Secret key** ขึ้นต้นด้วย `sk_test_` (กดรูปตาหรือปุ่มคัดลอก)

## 3. ใส่กุญแจใน Render

1. เปิด https://dashboard.render.com → กดบริการ **aksornwai**
2. เมนูซ้ายกด **Environment** → **Add Environment Variable**
3. เพิ่ม 2 แถว
   - Key `CLERK_PUBLISHABLE_KEY` · Value = กุญแจ `pk_test_…`
   - Key `CLERK_SECRET_KEY` · Value = กุญแจ `sk_test_…`
4. กด **Save, rebuild, and deploy** แล้วรอจนขึ้น **Live** (ราว 3–5 นาที)

ไม่ต้องตั้งโดเมนใน Clerk แบบ Development ใช้กับ `aksornwai.onrender.com` ได้เลย

## 4. ลองใช้

1. เปิด https://aksornwai.onrender.com/login
2. กด **Google** → เลือกบัญชี → ควรเด้งไปหน้า **คลังของฉัน**
3. ลองด้วยอีเมลแอดมิน (อีเมลเดียวกับ `ADMIN_EMAIL` ใน Render) → ต้องเห็นปุ่ม **หลังบ้าน**

## ทำงานอย่างไร

- ร้านใช้ Clerk เข้าสู่ระบบ/สมัครสมาชิกอย่างเดียว (ไม่มีฟอร์มรหัสผ่าน ลืมรหัสผ่าน ของร้านเองแล้ว)
- ลูกค้าที่เคยสมัครด้วยรหัสผ่าน: กด Google (หรือเข้าด้วยอีเมล) ด้วยอีเมลเดิม → ได้บัญชีเดิม ออเดอร์และคลังเดิมอยู่ครบ
- ลูกค้าใหม่: กด Google ครั้งแรก → ร้านสร้างบัญชีให้อัตโนมัติ
- อีเมลแอดมิน (`ADMIN_EMAIL`): ล็อกอินด้วย Google/อีเมลนี้ → เป็นแอดมิน เปิดหลังบ้านได้ (`ADMIN_PASSWORD` ไม่ได้ใช้แล้ว)
- ตอนขายจริง (NODE_ENV=production) ต้องมีกุญแจ Clerk ทั้งสองตัว ถ้าไม่มี ร้านจะไม่เปิดและบอกใน log ว่าขาดอะไร

## ข้อจำกัดของแบบ Development (ฟรี)

- รับผู้ใช้ได้สูงสุด **100 บัญชี** ใน Clerk
- ป้าย "Development mode" ร้านซ่อนให้แล้ว แต่ป้ายเล็กๆ **Secured by Clerk** ใต้กล่องจะอยู่ (เอาออกได้เมื่อใช้แพ็กเกจเสียเงินของ Clerk: Configure → Customization → Branding)
- หน้าเลือกบัญชี Google จะขึ้นชื่อโดเมนของ Clerk (`…accounts.dev`) แทนชื่อร้าน

## เมื่อพร้อมเปิดจริง (ซื้อโดเมนแล้ว)

1. ซื้อโดเมน (เช่น `aksornwai.com`) แล้วผูกกับ Render
2. ใน Clerk กดสร้าง **Production** → ใส่โดเมน → เพิ่ม DNS ตามที่ Clerk บอก
3. สร้างกุญแจ Google เอง (Google Cloud → OAuth client) แล้วใส่ใน Clerk → SSO connections → Google
4. เปลี่ยนกุญแจ 2 ตัวใน Render เป็น `pk_live_…` และ `sk_live_…` และตั้ง `BASE_URL` เป็นโดเมนใหม่

โค้ดร้านไม่ต้องแก้ แค่เปลี่ยนกุญแจ

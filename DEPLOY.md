# สำหรับผู้ดูแล: นำขึ้นใช้งานจริง

ชุดนี้เตรียมโค้ดให้แล้ว แต่ยังไม่มีการเชื่อมผู้ให้บริการ hosting, domain หรือ developer apps ในแชตนี้ จึงยังไม่มี public URL ที่ใช้งานได้

## สิ่งที่ต้องมี

- โฮสต์ที่รัน Node.js 24 หรือ Docker ได้ พร้อม HTTPS origin ของตนเอง
- private persistent disk สำหรับ DATA_DIR (ร่าง วิดีโอ กุญแจ และข้อมูลบัญชี)
- อย่างน้อย 1 GiB RAM สำหรับการส่ง YouTube และ disk quota ตามจำนวนวิดีโอ
- Meta / TikTok / Google developer apps ที่เจ้าของจัดการได้ พร้อม OAuth redirect URI ตาม README

## วิธีติดตั้งแบบ Node

1. นำโฟลเดอร์โปรเจกต์ไปไว้ในเครื่องโฮสต์โดยไม่รวม .env, data หรือ secrets จากเครื่องอื่นที่ไม่ตั้งใจย้าย
2. ตั้ง environment ผ่าน secret settings ของ hosting; หรือสร้าง .env จากตัวอย่างครั้งแรกแล้วจำกัดสิทธิ์ไฟล์ 0600
3. ตั้ง PUBLIC_BASE_URL, DATA_DIR และ client IDs/secrets ตาม README
4. รัน npm test แล้ว npm start ด้วย process manager ของโฮสต์ ตั้ง replicas=1
5. ตั้ง reverse proxy HTTPS ไปที่ port 3000 รองรับ uploads 256 MiB, request timeout อย่างน้อย 5 นาที และไม่ cache authenticated responses
6. กุญแจเข้าสู่เว็บสร้างอัตโนมัติใน DATA_DIR/access-key เมื่อไม่มี PUBLISHER_API_KEY ให้ผู้ดูแลส่งมอบผ่านช่องทางลับ ไม่ผ่านแชตหรือ log
7. ใช้ GET /health ตรวจ service; เปิดหน้าเว็บ เข้าระบบ กดเชื่อมบัญชี และตรวจชื่อบัญชีจริง

## วิธีติดตั้งแบบ Docker

มี Dockerfile และ compose.yaml ให้ (ยังไม่ได้ build/run ใน session นี้) ต้องมี .env ก่อน:

```sh
docker compose up --build -d
```

compose เปิด port เฉพาะ loopback ให้ reverse proxy ของโฮสต์รับ HTTPS ด้านหน้า และใช้ named volume สำหรับข้อมูล
หากใช้ Docker ภายใน managed cloud ต้องทำตาม runtime skill ของแพลตฟอร์มเรื่อง proxy และ CA trust อย่าปิด TLS verification

## Domain ที่ต้องออกอินเทอร์เน็ตได้

- graph.facebook.com, www.facebook.com, rupload.facebook.com
- open.tiktokapis.com, www.tiktok.com
- accounts.google.com, oauth2.googleapis.com, www.googleapis.com
- PUBLIC_BASE_URL และ media host ที่อนุญาตเอง

รักษา HTTP_PROXY, HTTPS_PROXY, NO_PROXY และ CA trust ตาม hosting เดิม npm start ใช้ Node --use-env-proxy
OAuth callback ต้องเข้าถึงจาก browser และ media URL ต้องเข้าถึงจาก provider ได้ แอป TikTok ต้องผ่าน domain/URL-prefix verification ก่อน PULL_FROM_URL

## ก่อนเปิดเผยแพร่จริง

- เจ้าของอนุญาตเนื้อหาและบัญชีทดสอบจริงก่อน ห้ามใช้คลิปผู้ใช้โดยพลการ
- ทดสอบ OAuth, token refresh, consent denial และ app permissions กับแอปจริง
- ทดสอบคลิปของตนเองแบบ private ในแพลตฟอร์มที่รองรับ; Facebook/Instagram อาจไม่มี private publishing mode ให้ใช้ test accounts/targets ที่เหมาะสมและได้รับอนุญาต
- ตรวจ returned IDs, readback, visibility จริง และเปิด permalink ที่แพลตฟอร์มคืน
- ตั้ง backup ของข้อมูลและกุญแจ, กำหนด retention ของ media, disk/memory monitoring และจำกัดการเข้าถึงหน้าเว็บ
- หากผล unknown ให้ตรวจ provider ก่อนส่งซ้ำ ห้ามเปิดหลาย instances หรือ reset status เพื่อให้ปุ่มส่งทำงาน
- การผ่าน app review ของแต่ละแพลตฟอร์มเป็นเงื่อนไขภายนอก ไม่ได้รับรองว่าจะได้รับอนุมัติ โดยเฉพาะ TikTok ที่มี eligibility requirements

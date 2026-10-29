# ฉากต่อไป · Social Publisher

หน้าเว็บภาษาไทยสำหรับอัปโหลดคลิป เตรียมแคปชัน เชื่อมบัญชี และยืนยันส่งไป Facebook Reels, Instagram Reels, TikTok และ YouTube

**สถานะ:** พัฒนาระบบและทดสอบด้วย provider จำลองแล้ว ยังไม่เชื่อมบัญชีจริง ไม่ได้ deploy เป็นเว็บสาธารณะ และไม่มีโพสต์จริงถูกส่ง
แชตปกติใน ChatGPT นี้ยังเรียกใช้ระบบเองไม่ได้ หากต้องการให้ GPT เตรียมร่างผ่าน API ต้องใช้ Custom GPT + Actions

## ผู้ใช้งานทำอะไรบ้าง

เมื่อผู้ดูแลติดตั้งและตั้งค่าแอปครบ:

1. เปิดเว็บ เข้าสู่ระบบส่วนตัว แล้วกดเชื่อมบัญชีในหน้าเว็บ
2. เลือก Facebook Page ที่ดูแล ระบบใช้ Instagram Professional ที่ผูกกับเพจนั้น
3. อัปโหลด MP4 หรือวางลิงก์ไฟล์ ใส่ชื่อและแคปชันแยกช่อง (คัดลอกจาก ChatGPT ได้)
4. เลือกการมองเห็นและผู้ชม ตรวจวิดีโอ บัญชี และข้อความ แล้วกดยืนยันเผยแพร่
5. เว็บตรวจสถานะต่อให้ขณะเปิดหน้าอยู่ หากผลไม่ชัดเจนจะหยุดส่งซ้ำและแจ้งให้ตรวจบัญชีจริง

## เริ่มเซิร์ฟเวอร์

Node.js 24 ขึ้นไป ไม่มี npm dependencies

```sh
cd /workspace/Pichate
cp .env.example .env
# ตั้ง PUBLIC_BASE_URL เป็น HTTPS origin จริง และใส่ข้อมูลแอปใน .env อย่างปลอดภัย
npm test
npm start
```

หากไม่ได้ตั้ง PUBLISHER_API_KEY โปรแกรมสร้างและเก็บกุญแจส่วนตัวที่ `data/access-key` (หรือ DATA_DIR/access-key) ด้วยสิทธิ์ไฟล์ 0600 โดยไม่แสดงค่าใน log
ใช้กุญแจนี้เข้าสู่หน้าเว็บและตั้ง Bearer authentication ของ GPT Actions ห้ามส่งกุญแจหรือ token ในแชต
การคัดลอกไฟล์ .env ทำเฉพาะครั้งแรก อย่าทับไฟล์ที่มีข้อมูลของผู้ใช้แล้ว

ดูรายละเอียดการนำขึ้น HTTPS ที่ [DEPLOY.md](DEPLOY.md) มี Dockerfile และ compose.yaml ให้ แต่ยังไม่ได้ build/run Docker ใน session นี้
ใช้ checkout เดิมใน cloud task ซึ่งแยกสภาพแวดล้อมอยู่แล้ว ไม่ต้องสร้าง Git worktree

## บัญชีและแอปที่ต้องเป็นของผู้ใช้

| บริการ | ตั้งค่าในเซิร์ฟเวอร์ | Redirect URI |
|---|---|---|
| Meta | META_APP_ID, META_APP_SECRET, META_GRAPH_VERSION ที่แอปรองรับ | `https://YOUR-HOST/oauth/callback/meta` |
| TikTok | TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET | `https://YOUR-HOST/oauth/callback/tiktok` |
| Google | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET; เปิด YouTube Data API | `https://YOUR-HOST/oauth/callback/google` |

PUBLIC_BASE_URL ต้องเป็น origin จริง เช่น `https://publisher.example.com` ไม่รวม path หรือ query
อย่าใช้ค่า YOUR-HOST หรือโดเมนตัวอย่างเป็นปลายทางจริง

- Meta: Facebook Page, Instagram Professional ที่ผูกกับเพจ และ permissions: pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish ตามโครงแบบ Facebook Login
- TikTok: Login Kit, Content Posting API / video.publish, user.info.basic, ตรวจสอบสิทธิ์แอปและยืนยันโดเมนหรือ URL prefix สำหรับ PULL_FROM_URL; บัญชีที่แอปยังไม่ผ่านตรวจสอบอาจถูกจำกัดการมองเห็น และ TikTok อาจไม่อนุมัติเครื่องมือที่ใช้ภายในกลุ่มของตนเองเท่านั้น ต้องตรวจ eligibility ก่อนใช้จริง
- Google: OAuth consent screen และ scopes youtube.upload + youtube.readonly; โปรเจกต์ที่ยังไม่ผ่านตรวจสอบอาจบังคับวิดีโอเป็น private หรือจำกัดผู้ทดสอบ
- เว็บอ่านตัวตนบัญชีจาก provider ก่อนสร้างร่างและก่อนส่ง เก็บ target ไว้กับร่าง หากเปลี่ยนบัญชีต้องสร้างร่างใหม่
- OAuth และ API contracts ยังต้องตรวจยืนยันกับแอปจริงและเอกสารล่าสุดก่อนเปิด production

ไม่ต้องให้รหัสผ่าน social กับผู้พัฒนา ให้เจ้าของกดอนุญาตผ่านเว็บของแพลตฟอร์ม

## ทำงานแล้วในโค้ด

- หน้าภาษาไทยรองรับจอมือถือ แคปชันแยกช่อง เลือก privacy, audience, AI และ branded-content disclosures
- Facebook/Instagram OAuth, เลือกเพจที่ได้รับสิทธิ์; TikTok/Google OAuth และ refresh token
- บัญชีเก็บเข้ารหัส AES-256-GCM ใน data/accounts.enc.json; กุญแจเข้ารหัส derivation จาก PUBLISHER_API_KEY จึงต้อง backup และรักษากุญแจเดิม การเปลี่ยนกุญแจทำให้ต้อง reconnect/ย้ายข้อมูลด้วยขั้นตอนเฉพาะ
- อัปโหลด MP4 สูงสุด 256 MiB และให้ provider อ่านผ่านลิงก์ที่เดายาก ลิงก์เหล่านี้ไม่ต้อง login: ใครมีลิงก์ดูไฟล์ได้ ไม่ใช้เก็บข้อมูลลับ
- สร้างร่าง บันทึกก่อน remote side effects และ checkpoint provider ID เมื่อมี เพื่อป้องกันการส่งร่างเดิมซ้ำ
- Facebook/Instagram ประมวลผล media, finish publish และ readback permalink/status
- TikTok ตรวจ creator info, privacy options, duration, consent, ส่ง Direct Post และอ่านสถานะ
- YouTube resumable upload, visibility/audience/disclosure และอ่าน processing status/visibility จริง
- ผล unknown ห้ามลองโพสต์ใหม่ทันที เพราะ provider อาจรับโพสต์แล้ว ให้ตรวจบัญชีและ provider state ก่อน
- การสร้างร่างไม่โพสต์; Action schema ไม่มี endpoint publish

## ข้อจำกัดที่ยังต้องเตรียมก่อน production

- ยังไม่มีบัญชีแอป/โฮสต์สาธารณะในสภาพแวดล้อมนี้ จึงไม่ผ่าน live OAuth/API/media-delivery validation
- ใช้หนึ่ง Node process กับ persistent disk เท่านั้น มี in-process lock; ถ้าขยายหลาย instance ต้องใช้ transaction/distributed lock
- ยังไม่มีตัวตั้งเวลา ไม่มี background worker; หน้าเว็บตรวจ processing ต่อสูงสุดประมาณ 4 นาที หากปิดหน้า ให้เปิดร่างเดิมและกดตรวจต่อ
- บัญชี Meta ที่ไม่อยู่ใน 100 เพจแรกยังไม่รองรับ pagination; ห้ามอ้างว่าเชื่อมทุกเพจแล้ว
- อย่าเปิดหลาย instance พร้อมกันกับ data volume เดียวกัน
- อัปโหลด public media ต้องมี retention/backup/storage quota ที่ผู้ดูแลกำหนด; ขณะนี้ไม่มีระบบลบอัตโนมัติ
- YouTube ดึงไฟล์จาก PUBLIC_BASE_URL หรือ MEDIA_ALLOWED_HOSTS ที่ผู้ดูแลกำหนดเท่านั้น; ไม่ตาม redirects จำกัด 256 MiB และ buffer ใน memory ควรมี RAM อย่างน้อย 1 GiB; allowlist ต้องมีเฉพาะ host ที่ไว้ใจได้และควบคุมได้
- ยังไม่มีระบบกู้คืนอัตโนมัติจาก unknown หรือ session upload ขาดกลางทาง ไม่ทำ automatic retry เพื่อหลีกเลี่ยงโพสต์ซ้ำ
- verified หมายถึง provider ยืนยันสถานะตาม endpoint ไม่ได้รับรองยอดวิวหรือว่าทุกคนเห็นโพสต์ โดยเฉพาะ private/restricted accounts

## Custom GPT

1. ตั้ง `servers[0].url` ใน openapi.json เป็น HTTPS host จริง
2. สร้าง Custom GPT ใน ChatGPT เพิ่ม Action จากไฟล์นี้
3. ตั้ง Authentication เป็น API Key/Bearer โดยใส่กุญแจเซิร์ฟเวอร์ในช่องลับของ Actions
4. ใช้ gpt-instructions.md และทดสอบ getConnections/createDraft/getDraft
5. เจ้าของเปิดหน้าเว็บตรวจร่างที่ GPT เตรียม แล้วกดยืนยันเผยแพร่เอง

ไฟล์แนบใน ChatGPT ไม่ได้กลายเป็น public media URL อัตโนมัติ ให้อัปโหลดผ่านหน้าเว็บนี้ก่อน

## ตรวจสอบ

```sh
npm test
```

ชุดทดสอบใช้ HTTP server จริงในเครื่อง และ provider responses จำลอง ไม่โพสต์บัญชีจริง ครอบคลุม OAuth state, encryption, การเลือก target, consent, privacy, upload/readback ทั้ง 4 ช่อง, authentication, draft persistence, media ranges, concurrent publishing และ uncertain outcomes
การผ่าน tests ไม่ได้แทนการทดสอบกับบัญชี social จริง

เอกสารอ้างอิงสำหรับตรวจข้อกำหนดล่าสุด:

- https://developers.facebook.com/docs/video-api/guides/reels-publishing/
- https://developers.facebook.com/docs/instagram-platform/content-publishing/
- https://developers.tiktok.com/doc/content-posting-api-get-started/
- https://developers.tiktok.com/doc/content-sharing-guidelines/
- https://developers.google.com/youtube/v3/docs/videos/insert
- https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol

# 💈 Sartarosh Navbat — Telegram bot

Sartaroshxonalarga onlayn navbat olish boti. Bitta botdan yuzlab sartaroshlar va istalgancha mijozlar foydalanadi.

## Imkoniyatlar

**Sartarosh uchun**
- Ro'yxatdan o'tish: ism, sartaroshxona nomi, **staj (tajriba)**, **sartaroshxona rasmi**, **lokatsiya**, manzil, telefon, narx, bir mijozga ketadigan vaqt (15–90 daqiqa)
- **🟢 Ishni boshlash** — har kuni (bugun yoki ertaga uchun) kelish va ketish vaqtini belgilaydi. Navbat faqat shu oraliqqa olinadi
- **🔴 Ishni yakunlash** — erta ketsa, bugunga yangi navbat olinmaydi
- Yangi navbat so'rovi kelganda **✅ Qabul qilish / ❌ Rad etish** tugmalari
- **📋 Navbatlar** — bugungi/ertangi navbatlar, tasdiqlash, bekor qilish
- **🕐 Bo'sh vaqtlarim** — bo'sh, kutilayotgan va band vaqtlar
- **✏️ Tahrirlash** — har qanday maydonni o'zgartirish, profilni vaqtincha yashirish (ta'til)

**Mijoz uchun**
- **💈 Sartaroshlar** — hammasi, bugun ishlayotganlari birinchi (sahifalab)
- **📍 Yaqin sartaroshlar** — lokatsiya yuborsa, eng yaqinlari masofasi bilan
- **🔎 Qidirish** — ism, sartaroshxona nomi yoki manzil bo'yicha
- Sartarosh kartochkasi: rasm, staj, narx, manzil, telefon, bugungi ish vaqti, **xaritada lokatsiya**
- **Bo'sh vaqtlar tugma bo'lib ko'rinadi** — bittasini bosib navbat oladi
- Tasdiqlandi / rad etildi xabari, **navbatdan 1 soat oldin eslatma**
- **📅 Navbatlarim** — ko'rish va bekor qilish

**Himoya:** bir vaqtga ikki kishi navbat ololmaydi; bir mijoz bitta sartaroshga bir kunda bitta navbat oladi, jami 3 tadan ortiq faol navbat olmaydi; sartarosh vaqtida javob bermasa so'rov avtomatik bekor bo'ladi.

## O'rnatish

1. Telegramda [@BotFather](https://t.me/BotFather) ga kiring → `/newbot` → bot nomi va username bering → **token**ni nusxalang.
2. Kompyuterda [Node.js](https://nodejs.org) 22.13 yoki undan yangi versiya o'rnatilgan bo'lsin.
3. Loyiha papkasida `.env.example` faylidan nusxa olib `.env` deb nomlang va tokenni yozing:
   ```
   BOT_TOKEN=1234567890:AAAbbbCCC...
   ```
4. Paketlarni o'rnating va ishga tushiring:
   ```
   npm install
   npm start
   ```
   `✅ @sizning_bot ishga tushdi` yozuvi chiqsa — tayyor.

   > PowerShell'da «running scripts is disabled» xatosi chiqsa, `npm` o'rniga `npm.cmd` yozing
   > (`npm.cmd start`) yoki shunchaki **start.bat** faylini ikki marta bosing.

Tekshiruv (Telegramsiz, soxta xabarlar bilan): `npm run check`

## 🔒 Sartarosh bo'lish — faqat ruxsat bilan

Istalgan odam mijoz bo'la oladi, lekin **sartarosh bo'lib qo'shilish faqat admin ruxsat berganlarga** ochiq.
Admin — `.env` dagi `ADMIN_IDS` (o'z ID ingizni bilish: botga `/myid`).

- **So'rov orqali:** odam «💈 Men sartaroshman» ni bosadi → «📨 So'rov yuborish» → adminga
  «✅ Ruxsat berish / ❌ Rad etish» tugmalari bilan xabar keladi.
- **Taklif havolasi orqali:** admin `/invite` yozadi → bir martalik havola chiqadi → uni sartaroshga yuboradi.
  Havola faqat bir marta ishlaydi.
- `/barbers` — barcha sartaroshlar; har birining huquqini olib qo'yish (profil yashiriladi) yoki qaytarish.
- `/admin` — admin buyruqlari ro'yxati.

## 🗺 Mini app (xarita va reklamalar)

Bot ishga tushganda `http://localhost:3000` da mini app ham ochiladi:
- tepada **reklama roliklari** — o'zi keyingisiga o'tib turadi (barmoq bilan surish ham mumkin)
- ostida **xarita** — barcha sartaroshxonalar joylashuvi (🟢 — hozir ochiq)
- yonida (telefonda — pastida) **eng yaqin sartaroshxonalar** — foydalanuvchi turgan joyiga nisbatan masofa bilan
- «Navbat olish» tugmasi botdagi sartarosh kartochkasini ochadi

Telegram mini app faqat **https** manzil bilan ishlaydi. `WEBAPP_URL` bo'sh bo'lsa, bot o'zi
**localhost.run** orqali bepul https tunnel ochadi (kompyuterdagi `ssh` bilan, hech narsa o'rnatish shart emas)
va Telegramdagi «🗺 Xarita» Menu tugmasini shu manzilga sozlaydi. Tunnel manzili vaqti-vaqti bilan
o'zgaradi — bot buni ham o'zi yangilaydi. Mijoz menyusidagi «🗺 Xarita va reklamalar» tugmasi doim yangi manzilni beradi.

Doimiy manzil uchun botni serverga (masalan Railway) joylang va `.env` ga yozing: `WEBAPP_URL=https://sizning-manzil`
(tunnelni butunlay o'chirish: `TUNNEL=off`).

**Reklama qo'shish (admin):** botga `/myid` yozing, chiqqan raqamni `.env` dagi `ADMIN_IDS=` ga yozing va botni qayta
ishga tushiring. Keyin botga rasm yoki video (20 MB gacha) yuboring, izohiga yozing:
`#reklama Yangi yil chegirmasi -30% https://t.me/kanal`. Ro'yxat va o'chirish: `/ads`.

Telegramsiz namunaviy ma'lumot bilan ko'rish: `node scripts/demo.js` → http://localhost:3100

## Sozlamalar (`.env`)

| O'zgaruvchi | Ma'nosi | Standart |
|---|---|---|
| `BOT_TOKEN` | BotFather tokeni | — |
| `DB_PATH` | Baza fayli | `data/bot.db` |
| `TZ_OFFSET_MINUTES` | Vaqt zonasi (daqiqa) | `300` (Toshkent, UTC+5) |
| `ADMIN_IDS` | Admin Telegram ID lari (reklama, `/stats`), vergul bilan | bo'sh |
| `PORT` | Mini app server porti | `3000` |
| `WEBAPP_URL` | Mini app'ning tashqi https manzili | bo'sh |

## Doimiy ishlashi uchun

Bot kompyuter yoqiq turganda ishlaydi. 24/7 ishlashi uchun VPS yoki Railway kabi xizmatga joylashtiring
(`npm start` buyrug'i bilan ishga tushadi, `data/` papkasi saqlanib qolishi kerak — Railway'da Volume ulang).

## Tuzilma

```
src/
  bot.js              — ishga tushirish
  app.js              — bot va yo'naltirish
  db.js               — SQLite baza (Node.js ichidagi node:sqlite)
  slots.js            — bo'sh vaqtlarni hisoblash
  cards.js            — sartarosh kartochkasi
  handlers/barber.js  — sartarosh: ro'yxat, ish vaqti, navbatlar
  handlers/client.js  — mijoz: qidirish, bo'sh vaqtlar, navbat olish
  handlers/bookings.js— tasdiqlash/rad etish, eslatmalar
scripts/selftest.js   — avtomatik tekshiruv
```

// Telegramga ulanmasdan botning asosiy jarayonini tekshiradi: `npm run check`
process.env.DB_PATH = ':memory:';
process.env.ADMIN_IDS = '999';
const ADMIN = 999;

const { createBot } = await import('../src/app.js');
const db = await import('../src/db.js');
const { tomorrow } = await import('../src/time.js');

const calls = [];
let msgId = 1;
const bot = createBot('0:test', {
  botInfo: { id: 1, is_bot: true, first_name: 'Test', username: 'test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false },
});
bot.api.config.use(async (_prev, method, payload) => {
  calls.push({ method, payload });
  const result = method.startsWith('send') || method.startsWith('edit')
    ? { message_id: msgId++, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text ?? '' }
    : true;
  return { ok: true, result };
});

let uid = 1;
const user = (id, name) => ({ id, is_bot: false, first_name: name });
const chat = (id) => ({ id, type: 'private', first_name: 'x' });
const msg = (id, name, extra) =>
  bot.handleUpdate({ update_id: uid++, message: { message_id: msgId++, date: 0, chat: chat(id), from: user(id, name), ...extra } });
const text = (id, name, t) => msg(id, name, { text: t, ...(t.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: t.split(' ')[0].length }] } : {}) });
const cb = (id, name, data) =>
  bot.handleUpdate({
    update_id: uid++,
    callback_query: { id: String(uid), from: user(id, name), chat_instance: '1', data, message: { message_id: msgId++, date: 0, chat: chat(id), text: 'eski xabar' } },
  });

const lastTo = (chatId) => [...calls].reverse().find((c) => c.payload.chat_id === chatId && c.payload.text);
const allButtons = (c) => (c?.payload.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
let fails = 0;
const check = (cond, label) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) fails++;
};

const B = 100, C1 = 200, C2 = 300;
const tm = tomorrow();

// 0. Sartarosh bo'lish faqat ruxsat bilan
await text(B, 'Aziz', '/start');
await cb(B, 'Aziz', 'role:barber');
check(lastTo(B).payload.text.includes('ruxsat berilganlar') && allButtons(lastTo(B)).includes('acc:req'), "Ruxsatsiz odam sartarosh bo'la olmaydi, so'rov tugmasi chiqadi");
check(db.getUser(B).role !== 'barber', "Ruxsatsiz odamga sartarosh roli berilmadi");
await cb(B, 'Aziz', 'acc:req');
check(allButtons(lastTo(ADMIN)).includes(`acc:ok:${B}`), "Adminga Ruxsat/Rad tugmalari bilan so'rov keldi");
await cb(B, 'Aziz', 'acc:req');
check(calls.filter((c) => c.payload.chat_id === ADMIN && c.payload.text?.includes("so'rovi")).length === 1, "Takroriy so'rov adminga qayta yuborilmaydi");
await cb(B, 'Aziz', `acc:ok:${B}`);
check(!db.isBarberAllowed(B), "Oddiy foydalanuvchi o'ziga ruxsat bera olmaydi");
await cb(ADMIN, 'Admin', `acc:ok:${B}`);
check(db.isBarberAllowed(B) && allButtons(lastTo(B)).includes('role:barber'), "Admin ruxsat berdi, sartaroshga xabar keldi");

// 1. Sartarosh ro'yxatdan o'tadi
await cb(B, 'Aziz', 'role:barber');
await text(B, 'Aziz', 'Aziz');
await text(B, 'Aziz', 'Barber Pro');
await text(B, 'Aziz', 'besh');
check(lastTo(B).payload.text.includes('raqam'), "Staj noto'g'ri kiritilsa xato beradi");
await text(B, 'Aziz', '7');
await msg(B, 'Aziz', { photo: [{ file_id: 'PHOTO1', file_unique_id: 'u', width: 1, height: 1 }] });
await msg(B, 'Aziz', { location: { latitude: 41.31, longitude: 69.24 } });
await text(B, 'Aziz', 'Chilonzor 9, Korzinka yonida');
await msg(B, 'Aziz', { contact: { phone_number: '998901112233', first_name: 'Aziz', user_id: B } });
await text(B, 'Aziz', "⏭ O'tkazib yuborish");
await cb(B, 'Aziz', 'slot:30');
const barber = db.getBarber(B);
check(barber && barber.experience === 7 && barber.photo_file_id === 'PHOTO1' && barber.latitude === 41.31 && barber.slot_minutes === 30,
  "Sartarosh profili saqlandi (staj, rasm, lokatsiya, 30 daq)");
check(calls.some((c) => c.method === 'sendPhoto' && c.payload.chat_id === B), "Profil kartochkasi rasm bilan ko'rsatildi");

// 2. Ish vaqtini belgilaydi (ertaga 09:00 – 12:00)
await text(B, 'Aziz', '🟢 Ishni boshlash');
await cb(B, 'Aziz', `wd:${tm}`);
await cb(B, 'Aziz', 'ws:0900');
await text(B, 'Aziz', '08:00');
check(lastTo(B).payload.text.includes('kamida'), 'Ketish vaqti kelishdan oldin bo\'lsa xato');
await text(B, 'Aziz', '12:00');
const wd = db.getWorkDay(B, tm);
check(wd?.start_time === '09:00' && wd?.end_time === '12:00', 'Ish vaqti saqlandi 09:00–12:00');
check(lastTo(B).payload.text.includes('6 ta'), "6 ta bo'sh vaqt hisoblandi");

// 3. Mijoz ro'yxatdan o'tadi va navbat oladi
await text(C1, 'Ali', '/start');
await cb(C1, 'Ali', 'role:client');
await msg(C1, 'Ali', { contact: { phone_number: '998907778899', first_name: 'Ali', user_id: C1 } });
check(db.getUser(C1).phone === '+998907778899', 'Mijoz telefoni saqlandi');
await text(C1, 'Ali', '💈 Sartaroshlar');
check(allButtons(lastTo(C1)).includes(`b:${B}`), "Ro'yxatda sartarosh ko'rinadi");
await cb(C1, 'Ali', `b:${B}`);
const card = [...calls].reverse().find((c) => c.method === 'sendPhoto' && c.payload.chat_id === C1);
check(card?.payload.caption.includes('7 yil') && card.payload.caption.includes('Chilonzor'), "Kartochkada staj va manzil bor");
await cb(C1, 'Ali', `loc:${B}`);
check(calls.at(-1).method === 'sendVenue', 'Lokatsiya xaritada yuboriladi');
await cb(C1, 'Ali', `day:${B}:${tm}`);
const slotsBtns = allButtons(lastTo(C1)).filter((d) => d.startsWith('sl:'));
check(slotsBtns.length === 6, `Bo'sh vaqtlar tugma bo'lib ko'rinadi (${slotsBtns.length} ta)`);
await cb(C1, 'Ali', `sl:${B}:${tm}:0930`);
await cb(C1, 'Ali', `ok:${B}:${tm}:0930`);
const bk = db.activeBookingsForDate(B, tm)[0];
check(bk?.status === 'pending' && bk.time === '09:30', "Navbat 'kutilmoqda' holatida yaratildi");
const notif = lastTo(B);
check(allButtons(notif).includes(`bk:acc:${bk.id}`) && allButtons(notif).includes(`bk:rej:${bk.id}`), 'Sartaroshga Qabul/Rad tugmalari bilan xabar keldi');

// 4. Ikkinchi mijoz o'sha vaqtni ololmaydi
await text(C2, 'Vali', '/start');
await cb(C2, 'Vali', 'role:client');
await text(C2, 'Vali', '+998 90 555 44 33');
await cb(C2, 'Vali', `day:${B}:${tm}`);
check(!allButtons(lastTo(C2)).includes(`sl:${B}:${tm}:0930`), "Band vaqt boshqa mijozga bo'sh bo'lib ko'rinmaydi");
await cb(C2, 'Vali', `ok:${B}:${tm}:0930`);
check(db.activeBookingsForDate(B, tm).length === 1, 'Bir vaqtga ikkinchi navbat olinmadi');

// 5. Sartarosh tasdiqlaydi
await cb(C1, 'Ali', `bk:acc:${bk.id}`);
check(db.getBooking(bk.id).status === 'pending', "Mijoz o'zi tasdiqlay olmaydi");
await cb(B, 'Aziz', `bk:acc:${bk.id}`);
check(db.getBooking(bk.id).status === 'accepted', 'Sartarosh tasdiqladi');
check(lastTo(C1).payload.text.includes('tasdiqlandi'), 'Mijozga tasdiq xabari keldi');
await cb(B, 'Aziz', `bk:rej:${bk.id}`);
check(db.getBooking(bk.id).status === 'accepted', 'Tasdiqlangan navbatni qayta rad etib bo\'lmaydi');

// 6. Rad etish oqimi
await cb(C2, 'Vali', `ok:${B}:${tm}:1000`);
const bk2 = db.activeBookingsForDate(B, tm).find((x) => x.client_id === C2);
await cb(B, 'Aziz', `bk:rej:${bk2.id}`);
check(db.getBooking(bk2.id).status === 'rejected', 'Sartarosh rad etdi');
check(lastTo(C2).payload.text.includes('qabul qila olmadi'), 'Mijozga rad xabari keldi');

// 7. Mijoz bekor qiladi
await text(C1, 'Ali', '📅 Navbatlarim');
check(allButtons(lastTo(C1)).includes(`bk:ccan:${bk.id}:m`), "Navbatlarim'da bekor qilish tugmasi bor");
await cb(C1, 'Ali', `bk:ccan:${bk.id}:m`);
check(db.getBooking(bk.id).status === 'cancelled', 'Mijoz navbatni bekor qildi');
check(lastTo(B).payload.text.includes('bekor qildi'), 'Sartarosh bekor qilinganidan xabardor');

// 8. Yaqin sartaroshlar va qidiruv
await text(C1, 'Ali', '📍 Yaqin sartaroshlar');
await msg(C1, 'Ali', { location: { latitude: 41.32, longitude: 69.25 } });
check(allButtons(lastTo(C1)).includes(`b:${B}`) && lastTo(C1).payload.reply_markup.inline_keyboard[0][0].text.includes('km'), 'Yaqin sartaroshlar masofa bilan');
await text(C1, 'Ali', '🔎 Qidirish');
await text(C1, 'Ali', 'barber');
check(allButtons(lastTo(C1)).includes(`b:${B}`), "Nomi bo'yicha qidiruv ishlaydi");

// 9. Sartarosh navbatlar ro'yxati
await text(B, 'Aziz', '📋 Navbatlar');
await cb(B, 'Aziz', `bb:${tm}`);
check(lastTo(B).payload.text.includes('Navbatlar'), "Sartarosh navbatlar ro'yxatini ko'radi");

// 10. Javobsiz qolgan eski so'rov avtomatik bekor bo'ladi
const { startScheduler } = await import('../src/handlers/bookings.js');
const oldId = db.createBooking({ barber_id: B, client_id: C2, client_name: 'Vali', client_phone: '+1', date: '2020-01-01', time: '10:00', duration: 30 });
const timer = startScheduler(bot);
await new Promise((r) => setTimeout(r, 50));
clearInterval(timer);
check(db.getBooking(oldId).status === 'expired', "Javobsiz eski so'rov 'expired' bo'ldi");
check(lastTo(C2).payload.text.includes('javob bermadi'), 'Mijozga bu haqda xabar keldi');

// 10b. Lokatsiya: kompyuter/Telegram Web uchun boshqa usullar
const { parseCoordsText } = await import('../src/geo.js');
const near = (p, lat, lon) => p && Math.abs(p.latitude - lat) < 1e-6 && Math.abs(p.longitude - lon) < 1e-6;
check(near(parseCoordsText('41.311081, 69.240562'), 41.311081, 69.240562), 'Koordinata matni tushuniladi');
check(near(parseCoordsText('https://www.google.com/maps/place/Bros/@41.3005,69.2401,17z/data=!3d41.30051!4d69.24017'), 41.30051, 69.24017), 'Google Maps havolasi tushuniladi');
check(near(parseCoordsText('https://maps.google.com/?q=41.2995,69.2401'), 41.2995, 69.2401), 'Google ?q= havolasi tushuniladi');
check(near(parseCoordsText('https://yandex.uz/maps/?ll=69.240100%2C41.299500&z=17'), 41.2995, 69.2401), 'Yandex havolasi (uzunlik,kenglik) tushuniladi');
check(parseCoordsText('salom 5') === null && parseCoordsText('99.1, 200.2') === null, "Noto'g'ri matn lokatsiya deb olinmaydi");

await text(B, 'Aziz', '✏️ Tahrirlash');
await cb(B, 'Aziz', 'bedit:location');
await text(B, 'Aziz', 'Chilonzorda');
check(lastTo(B).payload.text.includes('Xaritadan tanlash'), "Tushunarsiz lokatsiyada yordam matni chiqadi");
await msg(B, 'Aziz', { web_app_data: { data: JSON.stringify({ lat: 41.2851, lon: 69.2042 }), button_text: '🗺 Xaritadan tanlash' } });
check(db.getBarber(B).latitude === 41.2851 && db.getBarber(B).longitude === 69.2042, "Xaritadan tanlangan nuqta (mini app) saqlandi");
await cb(B, 'Aziz', 'bedit:location');
await text(B, 'Aziz', 'https://maps.google.com/?q=41.31,69.24');
check(db.getBarber(B).latitude === 41.31, 'Havola orqali lokatsiya saqlandi');

// 10c. Taklif havolasi va huquqni olish
await text(ADMIN, 'Admin', '/invite');
const code = /inv_([A-Za-z0-9_-]+)/.exec(lastTo(ADMIN).payload.text)[1];
await text(500, 'Jamshid', `/start inv_${code}`);
check(db.isBarberAllowed(500) && db.getUser(500).role === 'barber', "Taklif havolasi orqali sartarosh bo'lishga ruxsat berildi");
check(lastTo(500).payload.text.includes('1/9'), "Taklifdan keyin darhol ro'yxatdan o'tish boshlandi");
await text(600, 'Begona', `/start inv_${code}`);
check(!db.isBarberAllowed(600) && lastTo(600).payload.text.includes('ruxsat berilganlar'), 'Ishlatilgan taklif havolasi ikkinchi marta ishlamaydi');
await text(B, 'Aziz', '/barbers');
check(!lastTo(B).payload.text.includes('Sartaroshlar —'), "Oddiy sartarosh admin ro'yxatini ko'ra olmaydi");
await text(ADMIN, 'Admin', '/barbers');
check(allButtons(lastTo(ADMIN)).includes(`bar:off:${B}`), "Admin sartaroshlar ro'yxatini ko'radi");
await cb(ADMIN, 'Admin', `bar:off:${B}`);
check(!db.isBarberAllowed(B) && db.getBarber(B).is_active === 0, "Admin sartarosh huquqini olib qo'ydi, profil yashirildi");
await text(B, 'Aziz', '🟢 Ishni boshlash');
check(!calls.at(-1).payload.text?.includes('Ish vaqtini belgilash'), "Huquqi olingan sartarosh ish vaqtini belgilay olmaydi");
await cb(ADMIN, 'Admin', `bar:on:${B}`);
check(db.isBarberAllowed(B) && db.getBarber(B).is_active === 1, 'Admin huquqni qaytardi');

// 11. Mini app API: Telegram imzosi bilan navbat olish va bekor qilish
const crypto = await import('node:crypto');
const { startWebServer } = await import('../src/web.js');
const TOKEN = '0:test';
const server = startWebServer({ api: bot.api, token: TOKEN, botUsername: 'test_bot', port: 0 });
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const signed = (u) => {
  const p = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify(u) });
  const dc = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(dc).digest('hex'));
  return p.toString();
};
const call = (path, initData, body) =>
  fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(initData ? { Authorization: `tma ${initData}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, data: await r.json() }));

const cfg = await call('/api/config');
check(cfg.data.tomorrow === tm, 'API: config bugun/ertaga sanasini beradi');
const sl = await call(`/api/barber/${B}/slots?date=${tm}`);
check(sl.status === 200 && sl.data.slots.some((s) => s.free), "API: sartarosh vaqtlari ko'rinadi");
check((await call('/api/me')).status === 401, 'API: imzosiz so\'rov rad etiladi');
check((await call('/api/me', signed({ id: C1, first_name: 'Ali' }) + 'x')).status === 401, "API: buzilgan imzo rad etiladi");
const forged = signed({ id: C1, first_name: 'Ali' }).replace(encodeURIComponent(`"id":${C1}`), encodeURIComponent(`"id":${B}`));
check((await call('/api/me', forged)).status === 401, "API: boshqa odam nomidan soxta so'rov rad etiladi");
const C3 = 400;
const r1 = await call('/api/book', signed({ id: C3, first_name: 'Sobir' }), { barberId: B, date: tm, time: '11:00' });
check(r1.status === 409 && r1.data.code === 'phone', "API: raqamsiz mijozdan telefon so'raladi");
await msg(C3, 'Sobir', { contact: { phone_number: '998935556677', first_name: 'Sobir', user_id: C3 } });
check(db.getUser(C3).phone === '+998935556677', 'Mini app requestContact raqami saqlandi');
const r2 = await call('/api/book', signed({ id: C3, first_name: 'Sobir' }), { barberId: B, date: tm, time: '11:00' });
check(r2.status === 200 && db.getBooking(r2.data.id)?.status === 'pending', "API: mini app'dan navbat olindi");
check(allButtons(lastTo(B)).includes(`bk:acc:${r2.data.id}`), 'API navbati sartaroshga tasdiqlash uchun keldi');
const me = await call('/api/me', signed({ id: C3, first_name: 'Sobir' }));
check(me.data.bookings.length === 1 && me.data.hasPhone, "API: Navbatlarim ro'yxati");
const r3 = await call(`/api/me/bookings/${r2.data.id}/cancel`, signed({ id: C1, first_name: 'Ali' }), {});
check(r3.status === 409, "API: boshqa birovning navbatini bekor qilib bo'lmaydi");
const r4 = await call(`/api/me/bookings/${r2.data.id}/cancel`, signed({ id: C3, first_name: 'Sobir' }), {});
check(r4.status === 200 && db.getBooking(r2.data.id).status === 'cancelled', "API: o'z navbatini bekor qildi");
server.close();

console.log(fails ? `\n❌ ${fails} ta tekshiruv o'tmadi` : '\n🎉 Barcha tekshiruvlar o\'tdi');
process.exit(fails ? 1 : 0);

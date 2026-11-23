// Mini app'ni namunaviy ma'lumotlar bilan ko'rish (Telegramsiz): node scripts/demo.js
process.env.DB_PATH = 'data/demo.db';
const fs = await import('node:fs');
for (const f of ['data/demo.db', 'data/demo.db-wal', 'data/demo.db-shm']) fs.rmSync(f, { force: true });

const db = await import('../src/db.js');
const { today, toHHMM, nowMinutes } = await import('../src/time.js');
const { startWebServer } = await import('../src/web.js');

const SAMPLE = [
  ['Jasur', 'Barber Pro', 8, 41.2995, 69.2401, 'Chilonzor 9-kvartal, Korzinka yonida', "Soch olish — 60 000 so'm"],
  ['Aziz', 'Gentlemen Club', 12, 41.3262, 69.2285, 'Yunusobod 4-kvartal', "Soch — 80 000 so'm"],
  ['Bekzod', 'Usta Barber', 5, 41.3111, 69.2797, "Amir Temur xiyoboni yaqinida", "50 000 so'm"],
  ['Sardor', 'Classic Cut', 3, 41.2856, 69.2034, 'Qatortol ko\'chasi 12', "45 000 so'm"],
  ['Otabek', 'Style Barbershop', 10, 41.3389, 69.3349, 'Buyuk Ipak Yo\'li metro', "70 000 so'm"],
  ['Ulug\'bek', 'Sartarosh Ota', 25, 41.3195, 69.2526, 'Eski shahar, Chorsu bozori', "35 000 so'm"],
  ['Doston', 'Fade Masters', 4, 41.3505, 69.2858, 'Yunusobod 19-kvartal', "55 000 so'm"],
  ['Rustam', 'King Barber', 7, 41.2702, 69.2190, 'Sergeli, Yangi hayot', "40 000 so'm"],
];

const date = today();
const now = nowMinutes();
SAMPLE.forEach(([name, salon, exp, lat, lon, address, price], i) => {
  const id = 1000 + i;
  db.touchUser({ id, first_name: name });
  db.saveBarber({ id, name, salon_name: salon, experience: exp, location: { latitude: lat, longitude: lon }, address, phone: '+998901234567', price, slot_minutes: 30 });
  if (i % 4 !== 3) {
    const start = i % 2 ? '09:00' : toHHMM(Math.max(0, now - 120 - (now % 30)));
    db.setWorkDay(id, date, start, i === 5 ? toHHMM(Math.min(now + 30, 1439)) : '21:00');
  }
});

const fakeApi = { getFile: async () => { throw new Error('demo: Telegram fayli yo\'q'); } };
startWebServer({ api: fakeApi, token: 'demo', botUsername: 'BarberShopNavbatBot', port: Number(process.env.PORT || 3100) });

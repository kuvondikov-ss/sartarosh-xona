import { Keyboard, InlineKeyboard } from 'grammy';
import { toHHMM } from './time.js';
import { getAppUrl } from './webapp.js';

export const BTN = {
  // sartarosh
  startWork: '🟢 Ishni boshlash',
  endWork: '🔴 Ishni yakunlash',
  bookings: '📋 Navbatlar',
  free: "🕐 Bo'sh vaqtlarim",
  profile: '👤 Profilim',
  edit: '✏️ Tahrirlash',
  // mijoz
  barbers: '💈 Sartaroshlar',
  near: '📍 Yaqin sartaroshlar',
  search: '🔎 Qidirish',
  my: '📅 Navbatlarim',
  mapApp: '🗺 Xarita va reklamalar',
  // umumiy
  switchRole: '🔄 Rolni almashtirish',
  skip: "⏭ O'tkazib yuborish",
  cancel: '❌ Bekor qilish',
};

export const barberMenu = () =>
  new Keyboard()
    .text(BTN.startWork).text(BTN.endWork).row()
    .text(BTN.bookings).text(BTN.free).row()
    .text(BTN.profile).text(BTN.edit).row()
    .text(BTN.switchRole)
    .resized();

// Mini app tugmasi oddiy matn tugmasi: bosilganda hozirgi (yangi) manzil bilan ochish tugmasi yuboriladi.
// Shu sabab tunnel manzili o'zgarsa ham eski klaviaturalar ishlayveradi.
export const clientMenu = () =>
  new Keyboard()
    .text(BTN.mapApp).row()
    .text(BTN.barbers).text(BTN.near).row()
    .text(BTN.search).text(BTN.my).row()
    .text(BTN.switchRole)
    .resized();

export const cancelKb = () => new Keyboard().text(BTN.cancel).resized();
export const skipKb = () => new Keyboard().text(BTN.skip).row().text(BTN.cancel).resized();
export const contactKb = () =>
  new Keyboard().requestContact('📞 Raqamimni yuborish').row().text(BTN.cancel).resized();
/**
 * Lokatsiya so'rash: telefonda — tugma, kompyuter/Telegram Web'da — xaritadan tanlash (mini app).
 * @param {'barber'|'client'} mode
 */
export const locationKb = (mode = 'barber') => {
  const kb = new Keyboard();
  const url = getAppUrl();
  if (url) kb.webApp('🗺 Xaritadan tanlash', `${url}/pick.html?mode=${mode}`).row();
  return kb.requestLocation('📍 Lokatsiyamni yuborish').row().text(BTN.cancel).resized();
};

export const roleKb = () =>
  new InlineKeyboard().text('💈 Men sartaroshman', 'role:barber').row().text('👤 Men mijozman', 'role:client');

/** Soatlar tugmalari: from..to (daqiqada), qadam 60 daqiqa. */
export function hoursGrid(prefix, fromMin, toMin, extra = []) {
  const kb = new InlineKeyboard();
  let i = 0;
  for (const [label, value] of extra) {
    kb.text(label, `${prefix}:${value}`);
    i++;
  }
  if (i) {
    kb.row();
    i = 0;
  }
  for (let t = fromMin; t <= toMin; t += 60) {
    const hhmm = toHHMM(t);
    kb.text(hhmm, `${prefix}:${hhmm.replace(':', '')}`);
    if (++i % 4 === 0) kb.row();
  }
  return kb;
}

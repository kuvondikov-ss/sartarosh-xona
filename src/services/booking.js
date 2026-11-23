// Navbat olish/bekor qilish mantiqi — bot ham, mini app ham shuni ishlatadi.
import { InlineKeyboard } from 'grammy';
import * as db from '../db.js';
import { buildSlots } from '../slots.js';
import { today, tomorrow, dayLabel, prettyDate, toMin, nowMinutes } from '../time.js';
import { esc } from '../util.js';

export const MAX_ACTIVE = 3; // bir mijozda bir vaqtda nechta faol navbat bo'lishi mumkin

export function checkSlot(barber, date, time) {
  if (!barber || !barber.is_active) return 'Sartarosh topilmadi.';
  if (date !== today() && date !== tomorrow()) return "Bu kun uchun navbat olib bo'lmaydi.";
  const work = db.getWorkDay(barber.id, date);
  const slot = buildSlots(barber, work, date).find((s) => s.time === time);
  if (!slot) return 'Bu vaqt sartaroshning ish vaqtiga kirmaydi.';
  if (slot.status === 'past') return "Bu vaqt o'tib ketdi.";
  if (slot.status !== 'free') return "Afsus, bu vaqt band bo'lib qoldi.";
  return null;
}

/** Mijozning hali o'tmagan faol navbatlari. */
export const upcomingFor = (userId) =>
  db.clientUpcoming(userId, today()).filter((b) => b.date !== today() || toMin(b.time) + b.duration > nowMinutes());

/**
 * Navbat so'rovi: tekshiradi, yaratadi va sartaroshga Qabul/Rad tugmalari bilan xabar yuboradi.
 * @returns {{ ok: true, id: number } | { error: string, refresh?: boolean }}
 */
export async function requestBooking(api, { barber, user, date, time }) {
  if (!barber || !barber.is_active) return { error: 'Sartarosh topilmadi.' };
  if (barber.id === user.id) return { error: "O'zingizga navbat ola olmaysiz 🙂" };

  const err = checkSlot(barber, date, time);
  if (err) return { error: err, refresh: true };

  const same = db.clientActiveWithBarber(user.id, barber.id, date);
  if (same) {
    return { error: `Sizda bu sartaroshda ${dayLabel(date).toLowerCase()} soat ${same.time} ga navbat bor. Avval uni bekor qiling.` };
  }
  if (upcomingFor(user.id).length >= MAX_ACTIVE) {
    return { error: `Bir vaqtda ${MAX_ACTIVE} tadan ortiq faol navbat olib bo'lmaydi.` };
  }

  const id = db.createBooking({
    barber_id: barber.id,
    client_id: user.id,
    client_name: user.name,
    client_phone: user.phone,
    date,
    time,
    duration: barber.slot_minutes,
  });
  if (!id) return { error: "Afsus, bu vaqt hozirgina band bo'ldi.", refresh: true };

  const clientLink = `<a href="tg://user?id=${user.id}">${esc(user.name || 'Mijoz')}</a>`;
  await api
    .sendMessage(
      barber.id,
      "🆕 <b>Yangi navbat so'rovi!</b>\n\n" +
        `👤 Mijoz: ${clientLink}\n📞 Telefon: ${esc(user.phone)}\n` +
        `📅 ${dayLabel(date)}, ${prettyDate(date)}\n🕐 Vaqt: <b>${time}</b>\n\nTasdiqlaysizmi?`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('✅ Qabul qilish', `bk:acc:${id}`).text('❌ Rad etish', `bk:rej:${id}`),
      },
    )
    .catch((e) => console.error('Sartaroshga xabar yuborilmadi:', e.description || e.message));

  return { ok: true, id };
}

/** Mijoz navbatni bekor qiladi va sartaroshga xabar boradi. */
export async function cancelByClient(api, bookingId, userId) {
  const b = db.getBooking(bookingId);
  if (!b || b.client_id !== userId) return { error: 'Navbat topilmadi.' };
  if (!db.transition(b.id, ['pending', 'accepted'], 'cancelled')) return { error: 'Bu navbat allaqachon yopilgan.' };
  await api
    .sendMessage(
      b.barber_id,
      `🚫 <b>Mijoz navbatni bekor qildi</b>\n\n👤 ${esc(b.client_name ?? '')} (${esc(b.client_phone ?? '')})\n` +
        `📅 ${dayLabel(b.date)}, ${prettyDate(b.date)}\n🕐 <b>${b.time}</b>\n\nBu vaqt yana bo'sh — boshqa mijozlar navbat olishi mumkin.`,
      { parse_mode: 'HTML' },
    )
    .catch((e) => console.error('Sartaroshga xabar yuborilmadi:', e.description || e.message));
  return { ok: true };
}

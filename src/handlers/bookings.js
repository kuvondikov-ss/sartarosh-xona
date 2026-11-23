import { InlineKeyboard } from 'grammy';
import * as db from '../db.js';
import { today, shortDate, prettyDate, dayLabel, nowMinutes, toMin, toHHMM } from '../time.js';
import { replyOrEdit } from '../cards.js';
import { esc } from '../util.js';
import { renderBarberBookings } from './barber.js';
import { renderClientBookings } from './client.js';

const STATUS_TEXT = {
  pending: 'tasdiq kutmoqda',
  accepted: 'qabul qilingan',
  rejected: 'rad etilgan',
  cancelled: 'bekor qilingan',
  expired: 'muddati o\'tgan',
};

const send = (api, chatId, text, extra = {}) =>
  api.sendMessage(chatId, text, { parse_mode: 'HTML', ...extra })
    .catch((e) => console.error(`Xabar yuborilmadi (${chatId}):`, e.description || e.message));

export function registerBookings(bot) {
  bot.callbackQuery(/^bk:(acc|rej|bcan|ccan):(\d+)(?::(l|m))?$/, async (ctx) => {
    const [, action, idStr, view] = ctx.match;
    const b = db.getBooking(Number(idStr));
    if (!b) return ctx.answerCallbackQuery({ text: 'Navbat topilmadi', show_alert: true });

    const byBarber = action !== 'ccan';
    if (ctx.from.id !== (byBarber ? b.barber_id : b.client_id)) {
      return ctx.answerCallbackQuery({ text: "Bu amal uchun ruxsat yo'q", show_alert: true });
    }

    const barber = db.getBarber(b.barber_id);
    const when = `📅 ${dayLabel(b.date)}, ${prettyDate(b.date)}\n🕐 <b>${b.time}</b>`;
    const salon = `💈 ${esc(barber?.salon_name ?? '')} — ${esc(barber?.name ?? '')}`;
    const otherTime = new InlineKeyboard().text('📅 Boshqa vaqt tanlash', `day:${b.barber_id}:${b.date >= today() ? b.date : today()}`);

    let ok = false;
    let statusLine = '';

    if (action === 'acc') {
      ok = db.transition(b.id, ['pending'], 'accepted');
      statusLine = '✅ Qabul qilindi';
      if (ok) {
        await send(ctx.api, b.client_id,
          `✅ <b>Navbatingiz tasdiqlandi!</b>\n\n${salon}\n${when}\n` +
            (barber?.address ? `🏠 ${esc(barber.address)}\n` : '') +
            (barber?.phone ? `📞 ${esc(barber.phone)}\n` : '') +
            '\nIltimos, vaqtida keling. Kela olmasangiz «📅 Navbatlarim» orqali bekor qiling.',
          { reply_markup: barber?.latitude != null ? new InlineKeyboard().text("📍 Xaritada ko'rish", `loc:${b.barber_id}`) : undefined });
      }
    } else if (action === 'rej') {
      ok = db.transition(b.id, ['pending'], 'rejected');
      statusLine = '❌ Rad etildi';
      if (ok) {
        await send(ctx.api, b.client_id,
          `❌ <b>Afsuski, sartarosh navbatni qabul qila olmadi.</b>\n\n${salon}\n${when}\n\nBoshqa vaqtni tanlab ko'ring.`,
          { reply_markup: otherTime });
      }
    } else if (action === 'bcan') {
      ok = db.transition(b.id, ['pending', 'accepted'], 'cancelled');
      statusLine = '🚫 Bekor qilindi';
      if (ok) {
        await send(ctx.api, b.client_id,
          `🚫 <b>Sartarosh navbatingizni bekor qildi.</b>\n\n${salon}\n${when}\n\nUzr so'raymiz. Boshqa vaqtni tanlashingiz mumkin.`,
          { reply_markup: otherTime });
      }
    } else if (action === 'ccan') {
      ok = db.transition(b.id, ['pending', 'accepted'], 'cancelled');
      statusLine = '🚫 Bekor qilindi';
      if (ok) {
        await send(ctx.api, b.barber_id,
          `🚫 <b>Mijoz navbatni bekor qildi</b>\n\n👤 ${esc(b.client_name ?? '')} (${esc(b.client_phone ?? '')})\n${when}\n\nBu vaqt yana bo'sh — boshqa mijozlar navbat olishi mumkin.`);
      }
    }

    if (!ok) {
      const cur = db.getBooking(b.id);
      await ctx.answerCallbackQuery({ text: `Bu navbat allaqachon ${STATUS_TEXT[cur.status]}.`, show_alert: true });
    } else {
      await ctx.answerCallbackQuery({ text: statusLine });
    }

    // Xabarni yangilash
    if (view === 'l' && barber) {
      const { text, kb } = renderBarberBookings(barber, b.date);
      return replyOrEdit(ctx, text, kb);
    }
    if (view === 'm') {
      const { text, kb } = renderClientBookings(ctx.from.id);
      return replyOrEdit(ctx, text, kb);
    }
    // Bildirishnoma xabari: holatni oxiriga qo'shib, tugmalarni olib tashlaymiz
    const msg = ctx.callbackQuery.message;
    if (msg?.text) {
      const cur = db.getBooking(b.id);
      const line = ok ? statusLine : `ℹ️ Holat: ${STATUS_TEXT[cur.status]}`;
      await ctx.editMessageText(`${msg.text}\n\n${line}`, { entities: msg.entities }).catch(() => {});
    }
  });
}

// ---------------------------------------------------------------------------
// Har daqiqada: eslatmalar va javobsiz qolgan so'rovlar
// ---------------------------------------------------------------------------

export function startScheduler(bot) {
  const tick = async () => {
    try {
      const t = today();
      const now = nowMinutes();

      // Vaqti o'tib ketgan, sartarosh javob bermagan so'rovlar
      for (const b of db.stalePending(t, toHHMM(now))) {
        if (!db.transition(b.id, ['pending'], 'expired')) continue;
        await send(bot.api, b.client_id,
          `⌛ Sartarosh ${shortDate(b.date)} soat <b>${b.time}</b> dagi so'rovingizga o'z vaqtida javob bermadi, so'rov bekor bo'ldi.\nBoshqa sartarosh yoki vaqtni tanlashingiz mumkin.`);
      }

      // Navbatdan ~1 soat oldin eslatma
      for (const b of db.dueReminders(t)) {
        const until = toMin(b.time) - now;
        if (until > 60) continue;
        db.markReminded(b.id);
        if (until <= 0) continue;
        await send(bot.api, b.client_id,
          `⏰ <b>Eslatma:</b> bugun soat <b>${b.time}</b> da navbatingiz bor!\n\n💈 ${esc(b.salon_name)} — ${esc(b.barber_name)}` +
            (b.address ? `\n🏠 ${esc(b.address)}` : ''),
          { reply_markup: new InlineKeyboard().text("📍 Xaritada ko'rish", `loc:${b.barber_id}`) });
      }
    } catch (e) {
      console.error('Scheduler xatosi:', e);
    }
  };
  tick();
  return setInterval(tick, 60_000);
}

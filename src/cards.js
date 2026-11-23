import { InlineKeyboard } from 'grammy';
import * as db from './db.js';
import { buildSlots } from './slots.js';
import { today, tomorrow, shortDate } from './time.js';
import { esc, expText } from './util.js';

/** Sartarosh kartochkasi matni (rasm ostidagi yozuv). */
export function barberCaption(b) {
  const t = today();
  const work = db.getWorkDay(b.id, t);
  const free = buildSlots(b, work, t).filter((s) => s.status === 'free').length;

  const lines = [
    `💈 <b>${esc(b.salon_name)}</b>`,
    '',
    `👤 Sartarosh: <b>${esc(b.name)}</b>`,
    `⭐ Staj (tajriba): <b>${expText(b.experience)}</b>`,
  ];
  if (b.price) lines.push(`💰 Narx: ${esc(b.price)}`);
  if (b.address) lines.push(`🏠 Manzil: ${esc(b.address)}`);
  if (b.phone) lines.push(`📞 Telefon: ${esc(b.phone)}`);
  lines.push(`⏱ Bir mijozga: ${b.slot_minutes} daqiqa`, '');

  if (work && free) lines.push(`🟢 Bugun: ${work.start_time} – ${work.end_time}`, `✅ Bo'sh vaqtlar: <b>${free} ta</b>`);
  else if (work) lines.push(`🟡 Bugun: ${work.start_time} – ${work.end_time}`, "❌ Bugunga bo'sh vaqt qolmadi");
  else lines.push('⚪ Bugungi ish vaqti hali belgilanmagan');

  return lines.join('\n');
}

export function barberCardKb(b) {
  const kb = new InlineKeyboard()
    .text(`📅 Bugun (${shortDate(today())})`, `day:${b.id}:${today()}`)
    .text(`📅 Ertaga (${shortDate(tomorrow())})`, `day:${b.id}:${tomorrow()}`)
    .row();
  if (b.latitude != null) kb.text("📍 Xaritada ko'rish", `loc:${b.id}`);
  return kb;
}

/** Kartochkani rasm bilan (bo'lsa) yuboradi. */
export async function sendBarberCard(ctx, b, kb = barberCardKb(b)) {
  const caption = barberCaption(b);
  if (b.photo_file_id) {
    return ctx.replyWithPhoto(b.photo_file_id, { caption, parse_mode: 'HTML', reply_markup: kb });
  }
  return ctx.reply(caption, { parse_mode: 'HTML', reply_markup: kb });
}

/** Callback xabari matnli bo'lsa tahrirlaydi, aks holda yangi xabar yuboradi. */
export async function replyOrEdit(ctx, text, kb) {
  const msg = ctx.callbackQuery?.message;
  const opts = { parse_mode: 'HTML', reply_markup: kb };
  if (msg?.text) {
    try {
      return await ctx.editMessageText(text, opts);
    } catch (e) {
      if (String(e.description || e.message).includes('message is not modified')) return;
      throw e;
    }
  }
  return ctx.reply(text, opts);
}

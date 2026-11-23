// Sartarosh bo'lish faqat ruxsat berilganlar uchun:
//  1) foydalanuvchi so'rov yuboradi -> admin "Ruxsat berish" / "Rad etish" ni bosadi
//  2) admin /invite bilan bir martalik taklif havolasini yuboradi
// Admin /barbers orqali sartaroshlarni ko'radi va huquqini olib qo'yadi yoki qaytaradi.
import crypto from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import * as db from '../db.js';
import { esc } from '../util.js';
import { ADMIN_IDS } from './admin.js';
import { showMenu } from './common.js';

export const isAdminId = (id) => ADMIN_IDS.includes(id);
export const canBeBarber = (id) => isAdminId(id) || db.isBarberAllowed(id);

const userLink = (u) =>
  `<a href="tg://user?id=${u.id}">${esc(u.name || 'Foydalanuvchi')}</a>${u.username ? ` (@${esc(u.username)})` : ''}`;

const notifyAdmins = (api, text, extra = {}) =>
  Promise.all(
    ADMIN_IDS.map((id) =>
      api.sendMessage(id, text, { parse_mode: 'HTML', ...extra }).catch((e) => console.error(`Adminga yuborilmadi (${id}):`, e.description || e.message)),
    ),
  );

/** Ruxsati yo'q foydalanuvchiga tushuntirish va so'rov tugmasi. */
export async function askBarberAccess(ctx) {
  const req = db.getAccessRequest(ctx.from.id);
  const kb = new InlineKeyboard();
  let text = "🔒 <b>Sartarosh bo'lib qo'shilish faqat ruxsat berilganlar uchun.</b>\n\n";
  if (req?.status === 'pending') {
    text += "⏳ So'rovingiz adminga yuborilgan. Ruxsat berilishi bilan sizga xabar keladi.";
  } else if (!ADMIN_IDS.length) {
    text += 'Hozircha yangi sartaroshlar qabul qilinmayapti.';
  } else {
    text += "Agar sartarosh bo'lsangiz, adminga so'rov yuboring. Ruxsat berilgach, ro'yxatdan o'tasiz.";
    if (req?.status === 'rejected') text += "\n\n<i>Avvalgi so'rovingiz rad etilgan edi.</i>";
    kb.text("📨 So'rov yuborish", 'acc:req').row();
  }
  kb.text('👤 Mijoz sifatida davom etish', 'role:client');
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
}

/** t.me/bot?start=inv_<kod> */
export async function useInviteLink(ctx, code) {
  const id = ctx.from.id;
  if (canBeBarber(id)) {
    db.setRole(id, 'barber');
    return showMenu(ctx);
  }
  if (!db.useInvite(code, id)) {
    await ctx.reply('❌ Bu taklif havolasi yaroqsiz yoki allaqachon ishlatilgan.');
    return askBarberAccess(ctx);
  }
  db.setBarberAllowed(id, true);
  db.saveAccessRequest(id, 'approved');
  db.setRole(id, 'barber');
  const u = db.getUser(id);
  await notifyAdmins(ctx.api, `🎟 Taklif havolasi ishlatildi: ${userLink(u)}`);
  await ctx.reply("✅ <b>Taklif qabul qilindi!</b> Endi sartarosh sifatida ro'yxatdan o'tasiz.", { parse_mode: 'HTML' });
  return showMenu(ctx);
}

function barbersList() {
  const list = db.allBarbers();
  const invites = db.unusedInvites().length;
  const kb = new InlineKeyboard();
  const lines = [`💈 <b>Sartaroshlar</b> — ${list.length} ta`, ''];
  if (!list.length) lines.push("Hozircha ro'yxatdan o'tgan sartarosh yo'q.");
  list.forEach((b, i) => {
    const on = b.barber_allowed && b.is_active;
    lines.push(`${i + 1}. ${on ? '🟢' : '⛔️'} <b>${esc(b.salon_name)}</b> — ${esc(b.name)}${b.username ? ` (@${esc(b.username)})` : ''}`);
    if (b.barber_allowed) kb.text(`🚫 ${i + 1}. ${b.salon_name} — huquqni olish`, `bar:off:${b.id}`).row();
    else kb.text(`✅ ${i + 1}. ${b.salon_name} — qaytarish`, `bar:on:${b.id}`).row();
  });
  lines.push('', `🎟 Ishlatilmagan taklif havolalari: ${invites} ta`, '<i>Yangi taklif: /invite</i>');
  return { text: lines.join('\n'), kb };
}

export function registerAccess(bot) {
  const adminOnly = (fn) => async (ctx) => {
    if (!isAdminId(ctx.from?.id)) {
      if (ctx.callbackQuery) return ctx.answerCallbackQuery({ text: "Ruxsat yo'q", show_alert: true });
      return; // oddiy foydalanuvchiga admin buyruqlari mavjud emasdek
    }
    return fn(ctx);
  };

  // --- So'rov yuborish ---
  bot.callbackQuery('acc:req', async (ctx) => {
    const id = ctx.from.id;
    if (canBeBarber(id)) {
      await ctx.answerCallbackQuery();
      db.setRole(id, 'barber');
      return showMenu(ctx);
    }
    if (db.getAccessRequest(id)?.status === 'pending') {
      return ctx.answerCallbackQuery({ text: "So'rov allaqachon yuborilgan, javobni kuting.", show_alert: true });
    }
    if (!ADMIN_IDS.length) return ctx.answerCallbackQuery({ text: 'Hozircha qabul yopiq.', show_alert: true });

    db.saveAccessRequest(id, 'pending');
    await ctx.answerCallbackQuery({ text: "So'rov yuborildi" });
    await ctx.editMessageText("⏳ <b>So'rovingiz adminga yuborildi.</b>\nRuxsat berilishi bilan sizga xabar keladi.", { parse_mode: 'HTML' }).catch(() => {});
    const u = db.getUser(id);
    await notifyAdmins(
      ctx.api,
      "📨 <b>Sartarosh bo'lish so'rovi</b>\n\n" +
        `👤 ${userLink(u)}\n` +
        (u.phone ? `📞 ${esc(u.phone)}\n` : '') +
        `🆔 <code>${u.id}</code>`,
      { reply_markup: new InlineKeyboard().text('✅ Ruxsat berish', `acc:ok:${id}`).text('❌ Rad etish', `acc:no:${id}`) },
    );
  });

  // --- Admin qarori ---
  bot.callbackQuery(/^acc:(ok|no):(\d+)$/, adminOnly(async (ctx) => {
    const ok = ctx.match[1] === 'ok';
    const uid = Number(ctx.match[2]);
    if (!db.resolveAccessRequest(uid, ok ? 'approved' : 'rejected')) {
      const cur = db.getAccessRequest(uid)?.status;
      return ctx.answerCallbackQuery({ text: `Bu so'rov allaqachon hal qilingan (${cur === 'approved' ? 'ruxsat berilgan' : 'rad etilgan'}).`, show_alert: true });
    }
    if (ok) db.setBarberAllowed(uid, true);
    await ctx.answerCallbackQuery({ text: ok ? 'Ruxsat berildi' : 'Rad etildi' });

    const msg = ctx.callbackQuery.message;
    const by = esc(ctx.from.first_name);
    await ctx.editMessageText(`${msg.text}\n\n${ok ? '✅ Ruxsat berildi' : '❌ Rad etildi'} — ${by}`, { entities: msg.entities }).catch(() => {});

    await ctx.api
      .sendMessage(
        uid,
        ok
          ? "✅ <b>Sizga sartarosh bo'lishga ruxsat berildi!</b>\nPastdagi tugmani bosib ro'yxatdan o'ting."
          : "❌ Afsuski, sartarosh bo'lish so'rovingiz rad etildi. Mijoz sifatida botdan foydalanishingiz mumkin.",
        { parse_mode: 'HTML', reply_markup: ok ? new InlineKeyboard().text("💈 Ro'yxatdan o'tish", 'role:barber') : undefined },
      )
      .catch(() => {});
  }));

  // --- Taklif havolasi ---
  bot.command('invite', adminOnly(async (ctx) => {
    const code = crypto.randomBytes(6).toString('base64url');
    db.createInvite(code, ctx.from.id);
    const link = `https://t.me/${ctx.me.username}?start=inv_${code}`;
    return ctx.reply(
      `🎟 <b>Bir martalik taklif havolasi</b>\n\n${link}\n\n` +
        "Bu havolani faqat sartaroshga yuboring. U <b>bir marta</b> ishlaydi: kim birinchi ochsa, o'sha sartarosh bo'lib qo'shiladi.",
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: new InlineKeyboard().text('🗑 Havolani bekor qilish', `inv:del:${code}`) },
    );
  }));

  bot.callbackQuery(/^inv:del:([\w-]+)$/, adminOnly(async (ctx) => {
    const ok = db.deleteInvite(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: ok ? 'Havola bekor qilindi' : 'Havola allaqachon ishlatilgan', show_alert: !ok });
    if (ok) await ctx.editMessageText('🗑 Taklif havolasi bekor qilindi.').catch(() => {});
  }));

  // --- Sartaroshlar ro'yxati ---
  bot.command('barbers', adminOnly(async (ctx) => {
    const { text, kb } = barbersList();
    return ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }));

  bot.callbackQuery(/^bar:(on|off):(\d+)$/, adminOnly(async (ctx) => {
    const on = ctx.match[1] === 'on';
    const id = Number(ctx.match[2]);
    if (!db.getBarber(id)) return ctx.answerCallbackQuery({ text: 'Sartarosh topilmadi', show_alert: true });
    db.setBarberAllowed(id, on);
    db.updateBarber(id, 'is_active', on ? 1 : 0);
    db.setRole(id, on ? 'barber' : 'client');
    await ctx.answerCallbackQuery({ text: on ? 'Huquq qaytarildi' : 'Huquq olib qo\'yildi' });
    await ctx.api
      .sendMessage(
        id,
        on
          ? "✅ Sartaroshlik huquqingiz qayta tiklandi. Profilingiz yana mijozlarga ko'rinadi. /start"
          : "⛔️ Sartaroshlik huquqingiz admin tomonidan to'xtatildi. Profilingiz mijozlarga ko'rinmaydi.",
      )
      .catch(() => {});
    const { text, kb } = barbersList();
    return ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
  }));

  bot.command('admin', adminOnly((ctx) =>
    ctx.reply(
      '🛠 <b>Admin buyruqlari</b>\n\n' +
        "/invite — sartaroshga bir martalik taklif havolasi\n" +
        "/barbers — sartaroshlar ro'yxati, huquqni olish/qaytarish\n" +
        "/ads — mini app reklamalari\n" +
        '/stats — statistika\n\n' +
        "Sartarosh bo'lish so'rovlari sizga avtomatik keladi.",
      { parse_mode: 'HTML' },
    ),
  ));
}

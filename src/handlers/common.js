import * as db from '../db.js';
import { BTN, barberMenu, clientMenu, roleKb } from '../keyboards.js';
import { clearState } from '../state.js';
import { startBarberRegistration } from './barber.js';
import { askClientPhone, openBarberFromLink } from './client.js';
import { canBeBarber, askBarberAccess, useInviteLink } from './access.js';

export async function askRole(ctx) {
  clearState(ctx.from.id);
  await ctx.reply(
    "💈 <b>Sartarosh Navbat</b> botiga xush kelibsiz!\n\n" +
      "Bu bot orqali:\n" +
      "• <b>Mijozlar</b> — sartaroshni tanlab, bo'sh vaqtiga navbat oladi\n" +
      "• <b>Sartaroshlar</b> — ish vaqtini belgilaydi va navbatlarni tasdiqlaydi\n\n" +
      'Siz kimsiz?',
    { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } },
  ).catch(() => {});
  await ctx.reply('👇 Tanlang:', { reply_markup: roleKb() });
}

export async function showMenu(ctx, text) {
  clearState(ctx.from.id);
  const user = db.getUser(ctx.from.id);
  if (!user?.role) return askRole(ctx);

  if (user.role === 'barber') {
    if (!canBeBarber(user.id)) {
      // huquqi yo'q (yoki olib qo'yilgan) — mijoz sifatida davom etadi
      db.setRole(user.id, 'client');
      return askBarberAccess(ctx);
    }
    if (!db.getBarber(user.id)) return startBarberRegistration(ctx);
    return ctx.reply(text ?? '💈 Sartarosh menyusi:', { parse_mode: 'HTML', reply_markup: barberMenu() });
  }
  if (!user.phone) return askClientPhone(ctx);
  return ctx.reply(text ?? '👤 Mijoz menyusi:', { parse_mode: 'HTML', reply_markup: clientMenu() });
}

export function registerCommon(bot) {
  bot.command('start', (ctx) => {
    // Mini app'dagi «Navbat olish» -> t.me/bot?start=b_<id>
    const m = /^b_(\d+)$/.exec(ctx.match ?? '');
    if (m) return openBarberFromLink(ctx, Number(m[1]));
    const inv = /^inv_([A-Za-z0-9_-]{4,40})$/.exec(ctx.match ?? '');
    if (inv) return useInviteLink(ctx, inv[1]);
    if (ctx.match === 'barber') {
      if (!canBeBarber(ctx.from.id)) return askBarberAccess(ctx);
      db.setRole(ctx.from.id, 'barber');
      return showMenu(ctx); // profil bo'lmasa ro'yxatdan o'tish boshlanadi
    }
    return showMenu(ctx);
  });
  bot.command('menu', (ctx) => showMenu(ctx));
  bot.command('role', (ctx) => askRole(ctx));
  bot.command('help', (ctx) =>
    ctx.reply(
      '<b>Yordam</b>\n\n' +
        '/start — bosh menyu\n' +
        '/role — rolni almashtirish (sartarosh / mijoz)\n\n' +
        '<b>Sartarosh:</b> har kuni ishga kelganda «🟢 Ishni boshlash» tugmasini bosib, kelish va ketish vaqtini belgilang. ' +
        'Mijozlar faqat shu oraliqdagi bo\'sh vaqtlarga navbat oladi, siz esa har bir so\'rovni tasdiqlaysiz yoki rad etasiz.\n\n' +
        "<b>Mijoz:</b> «💈 Sartaroshlar» yoki «📍 Yaqin sartaroshlar» orqali sartaroshni tanlang, bo'sh vaqtni bosing va tasdiqni kuting.",
      { parse_mode: 'HTML' },
    ),
  );

  bot.hears(BTN.switchRole, (ctx) => askRole(ctx));

  bot.callbackQuery('role:barber', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!canBeBarber(ctx.from.id)) return askBarberAccess(ctx);
    db.setRole(ctx.from.id, 'barber');
    await ctx.editMessageText('💈 Siz <b>sartarosh</b> sifatida kirdingiz.', { parse_mode: 'HTML' }).catch(() => {});
    return showMenu(ctx);
  });

  bot.callbackQuery('role:client', async (ctx) => {
    await ctx.answerCallbackQuery();
    db.setRole(ctx.from.id, 'client');
    await ctx.editMessageText('👤 Siz <b>mijoz</b> sifatida kirdingiz.', { parse_mode: 'HTML' }).catch(() => {});
    return showMenu(ctx);
  });
}

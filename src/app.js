import { Bot, GrammyError, HttpError } from 'grammy';
import { sequentialize } from '@grammyjs/runner';
import * as db from './db.js';
import { BTN } from './keyboards.js';
import { getState, clearState } from './state.js';
import { registerCommon, showMenu, askRole } from './handlers/common.js';
import { registerBarber, handleBarberState } from './handlers/barber.js';
import { registerClient, handleClientState } from './handlers/client.js';
import { registerBookings } from './handlers/bookings.js';
import { registerAdmin } from './handlers/admin.js';
import { registerAccess } from './handlers/access.js';

export function createBot(token, botConfig) {
  const bot = new Bot(token, botConfig);

  // Bitta foydalanuvchining xabarlari ketma-ket, turli foydalanuvchilarniki parallel ishlanadi
  bot.use(sequentialize((ctx) => ctx.from?.id.toString()));

  // Faqat shaxsiy chat
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') return;
    if (ctx.from) db.touchUser(ctx.from);
    return next();
  });

  registerCommon(bot);

  registerAdmin(bot);
  registerAccess(bot);

  // Kiritish holatlari (ro'yxatdan o'tish, vaqt yozish, qidiruv ...)
  const MENU_TEXTS = new Set(Object.values(BTN).filter((t) => t !== BTN.skip && t !== BTN.cancel));

  bot.on('message', async (ctx, next) => {
    const text = ctx.message.text;
    const st = getState(ctx.from.id);

    if (text === BTN.cancel) {
      clearState(ctx.from.id);
      // Ro'yxatdan o'tishni bekor qilsa — rol tanlashga qaytamiz
      if (st?.step === 'breg' || st?.step === 'creg_phone') return askRole(ctx);
      return showMenu(ctx, 'Bekor qilindi.');
    }

    if (st) {
      if (text && MENU_TEXTS.has(text)) {
        clearState(ctx.from.id); // menyu tugmasi bosildi — oldingi amal bekor
      } else {
        if (await handleBarberState(ctx, st)) return;
        if (await handleClientState(ctx, st)) return;
      }
    }
    return next();
  });

  registerBarber(bot);
  registerClient(bot);
  registerBookings(bot);

  // Tushunarsiz xabar — menyuni ko'rsatamiz
  bot.on('message', (ctx) => showMenu(ctx));
  bot.on('callback_query:data', (ctx) => ctx.answerCallbackQuery({ text: 'Bu tugma eskirgan' }));

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) console.error('Telegram xatosi:', e.description);
    else if (e instanceof HttpError) console.error('Tarmoq xatosi:', e);
    else console.error('Xatolik:', e);
  });

  return bot;
}

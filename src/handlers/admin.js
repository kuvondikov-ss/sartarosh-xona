// Admin: mini app reklamalarini boshqarish.
import { InlineKeyboard } from 'grammy';
import * as db from '../db.js';
import { esc } from '../util.js';

const MAX_TG_FILE = 20 * 1024 * 1024; // Bot API orqali yuklab olish chegarasi
export const ADMIN_IDS = (process.env.ADMIN_IDS ?? '').split(',').map((s) => Number(s.trim())).filter(Boolean);
const isAdmin = (ctx) => ADMIN_IDS.includes(ctx.from?.id);

function adsList() {
  const ads = db.listAds();
  const kb = new InlineKeyboard();
  if (!ads.length) return { text: "📢 Faol reklama yo'q.\n\nQo'shish: rasm yoki video yuboring, izohiga <b>#reklama</b> yozing.", kb };
  const lines = ['📢 <b>Faol reklamalar</b>', ''];
  for (const a of ads) {
    lines.push(`#${a.id} ${a.type === 'video' ? '🎬' : '🖼'} ${esc(a.title || '(sarlavhasiz)')}${a.link ? `\n   🔗 ${esc(a.link)}` : ''}`);
    kb.text(`🗑 #${a.id} ni o'chirish`, `ad:del:${a.id}`).row();
  }
  return { text: lines.join('\n'), kb };
}

export function registerAdmin(bot) {
  bot.command('myid', (ctx) => ctx.reply(`Sizning Telegram ID: <code>${ctx.from.id}</code>`, { parse_mode: 'HTML' }));

  bot.command('stats', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const s = db.stats();
    return ctx.reply(`📊 Sartaroshlar: ${s.barbers}\n👤 Mijozlar: ${s.clients}\n📅 Navbatlar: ${s.bookings}\n📢 Reklamalar: ${db.listAds().length}`);
  });

  bot.command('ads', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const { text, kb } = adsList();
    return ctx.reply(
      text + "\n\n<i>Yangi reklama: rasm yoki video (20 MB gacha) yuboring, izohiga #reklama, sarlavha va xohlasangiz havola yozing.\nMasalan: #reklama Yangi yil chegirmasi -30% https://t.me/kanal</i>",
      { parse_mode: 'HTML', reply_markup: kb },
    );
  });

  // Rasm/video + "#reklama" izohi -> yangi reklama
  bot.on(['message:photo', 'message:video', 'message:animation'], async (ctx, next) => {
    const caption = ctx.message.caption ?? '';
    if (!isAdmin(ctx) || !/#reklama/i.test(caption)) return next();

    const m = ctx.message;
    const media = m.video ?? m.animation ?? m.photo?.at(-1);
    const type = m.photo ? 'photo' : 'video';
    if (media.file_size && media.file_size > MAX_TG_FILE) {
      return ctx.reply('⚠️ Fayl 20 MB dan katta. Telegram bot orqali bundan katta faylni ko\'rsatib bo\'lmaydi — videoni siqib qayta yuboring.');
    }
    const link = caption.match(/https?:\/\/\S+/)?.[0] ?? null;
    const title = caption.replace(/#reklama/gi, '').replace(link ?? '', '').trim() || null;
    const id = db.addAd(type, media.file_id, title, link);
    return ctx.reply(`✅ Reklama #${id} qo'shildi. Mini app'ni qayta ochganda ko'rinadi.\n/ads — barcha reklamalar`);
  });

  bot.callbackQuery(/^ad:del:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery({ text: "Ruxsat yo'q", show_alert: true });
    db.deleteAd(Number(ctx.match[1]));
    await ctx.answerCallbackQuery({ text: "O'chirildi" });
    const { text, kb } = adsList();
    return ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
  });
}

import { InlineKeyboard } from 'grammy';
import * as db from '../db.js';
import { BTN, clientMenu, cancelKb, contactKb, locationKb } from '../keyboards.js';
import { getState, setState, clearState } from '../state.js';
import { today, tomorrow, prettyDate, shortDate, dayLabel, nowMinutes, toHHMM, toMin } from '../time.js';
import { buildSlots } from '../slots.js';
import { sendBarberCard, replyOrEdit } from '../cards.js';
import { esc, cut, expText, haversineKm, fmtKm } from '../util.js';
import { showMenu } from './common.js';
import { getAppUrl } from '../webapp.js';
import { locationFromMessage } from '../geo.js';
import { checkSlot, requestBooking, upcomingFor } from '../services/booking.js';

const PAGE = 8;
const searches = new Map(); // userId -> oxirgi qidiruv so'zi

const say = async (ctx, text, extra) => {
  await ctx.reply(text, extra);
  return true;
};

// ---------------------------------------------------------------------------
// Mijoz ro'yxatdan o'tishi (telefon)
// ---------------------------------------------------------------------------

/** Mini app'dan kelgan havola: sartarosh kartochkasini ochadi. */
export async function openBarberFromLink(ctx, barberId) {
  const b = db.getBarber(barberId);
  if (!b || !b.is_active) return showMenu(ctx, '😕 Bu sartarosh topilmadi.');
  const u = db.getUser(ctx.from.id);
  if (!u?.role) db.setRole(ctx.from.id, 'client');
  if (!u?.phone) return askClientPhone(ctx, barberId);
  clearState(ctx.from.id);
  return sendBarberCard(ctx, b);
}

export async function askClientPhone(ctx, afterBarberId = null) {
  setState(ctx.from.id, 'creg_phone', { after: afterBarberId });
  return ctx.reply(
    "📞 Navbat olish uchun telefon raqamingizni yuboring — sartarosh siz bilan bog'lana olishi uchun.\n\nPastdagi <b>«📞 Raqamimni yuborish»</b> tugmasini bosing.",
    { parse_mode: 'HTML', reply_markup: contactKb() },
  );
}

export async function handleClientState(ctx, st) {
  const msg = ctx.message;
  switch (st.step) {
    case 'creg_phone': {
      let phone = null;
      if (msg.contact) {
        if (msg.contact.user_id && msg.contact.user_id !== ctx.from.id) {
          return say(ctx, "📞 Iltimos, o'zingizning raqamingizni yuboring (pastdagi tugma orqali).");
        }
        phone = msg.contact.phone_number;
      } else if (msg.text) {
        phone = msg.text;
      }
      const digits = phone?.replace(/[^\d+]/g, '');
      if (!digits || !/^\+?\d{9,15}$/.test(digits)) {
        return say(ctx, "📞 Raqam noto'g'ri. Pastdagi tugmani bosing yoki +998901234567 ko'rinishida yozing.");
      }
      db.setUserPhone(ctx.from.id, digits.startsWith('+') ? digits : `+${digits}`);
      clearState(ctx.from.id);
      await ctx.reply(
        "✅ Rahmat! Endi sartarosh tanlab navbat olishingiz mumkin.\n\n" +
          "💈 <b>Sartaroshlar</b> — barcha sartaroshlar\n" +
          '📍 <b>Yaqin sartaroshlar</b> — sizga eng yaqinlari\n' +
          '🔎 <b>Qidirish</b> — nomi yoki manzil bo\'yicha',
        { parse_mode: 'HTML', reply_markup: clientMenu() },
      );
      const after = st.data?.after && db.getBarber(st.data.after);
      if (after?.is_active) await sendBarberCard(ctx, after);
      return true;
    }
    case 'c_near': {
      const loc = await locationFromMessage(msg);
      if (!loc) return say(ctx, "📍 Lokatsiyani tushunmadim. «🗺 Xaritadan tanlash» tugmasini bosing yoki Google Maps havolasini / koordinatani yuboring.");
      db.setUserLocation(ctx.from.id, loc.latitude, loc.longitude);
      clearState(ctx.from.id);
      await ctx.reply('📍 Lokatsiya qabul qilindi.', { reply_markup: clientMenu() });
      await sendList(ctx, 'near', 0);
      return true;
    }
    case 'c_search': {
      const text = msg.text?.trim();
      if (!text || text.length < 2) return say(ctx, '🔎 Kamida 2 ta harf yozing.');
      searches.set(ctx.from.id, text.slice(0, 50));
      clearState(ctx.from.id);
      await ctx.reply(`🔎 «${esc(text)}» bo'yicha natijalar:`, { parse_mode: 'HTML', reply_markup: clientMenu() });
      await sendList(ctx, 'search', 0);
      return true;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Sartaroshlar ro'yxati
// ---------------------------------------------------------------------------

function isOpenNow(row) {
  return row.end_time != null && row.end_time > toHHMM(nowMinutes());
}

function loadPage(userId, mode, offset) {
  const date = today();
  const nowHHMM = toHHMM(nowMinutes());
  if (mode === 'near') {
    const u = db.getUser(userId);
    if (u?.last_lat == null) return { total: 0, rows: [], noLocation: true };
    const all = db
      .barbersWithLocation(date)
      .map((b) => ({ ...b, dist: haversineKm(u.last_lat, u.last_lon, b.latitude, b.longitude) }))
      .sort((a, b) => a.dist - b.dist);
    return { total: all.length, rows: all.slice(offset, offset + PAGE) };
  }
  const search = mode === 'search' ? searches.get(userId) ?? null : null;
  return db.listBarbers({ date, nowHHMM, search, limit: PAGE, offset });
}

async function sendList(ctx, mode, offset) {
  const { total, rows, noLocation } = loadPage(ctx.from.id, mode, offset);
  if (noLocation) {
    setState(ctx.from.id, 'c_near');
    return ctx.reply('📍 Lokatsiyangizni yuboring yoki xaritadan tanlang:', { reply_markup: locationKb('client') });
  }

  const titles = {
    all: '💈 <b>Sartaroshlar</b>',
    near: '📍 <b>Sizga yaqin sartaroshlar</b>',
    search: '🔎 <b>Qidiruv natijalari</b>',
  };
  if (!total) {
    const empty = mode === 'search' ? "😕 Hech narsa topilmadi. Boshqa so'z bilan qidirib ko'ring." : "😕 Hozircha sartaroshlar yo'q.";
    return replyOrEdit(ctx, empty);
  }

  const kb = new InlineKeyboard();
  for (const b of rows) {
    const icon = isOpenNow(b) ? '🟢' : '⚪';
    const extra = mode === 'near' ? fmtKm(b.dist) : expText(b.experience);
    kb.text(cut(`${icon} ${b.salon_name} · ${b.name} · ${extra}`, 60), `b:${b.id}`).row();
  }
  const pages = Math.ceil(total / PAGE);
  const page = Math.floor(offset / PAGE) + 1;
  if (pages > 1) {
    if (offset > 0) kb.text('⬅️', `pg:${mode}:${Math.max(0, offset - PAGE)}`);
    kb.text(`${page}/${pages}`, 'noop');
    if (offset + PAGE < total) kb.text('➡️', `pg:${mode}:${offset + PAGE}`);
  }

  const text =
    `${titles[mode]} — jami ${total} ta\n\n` +
    "🟢 bugun ishlayapti   ⚪ bugun ish vaqti yo'q\n\nSartaroshni tanlang 👇";
  return replyOrEdit(ctx, text, kb);
}

// ---------------------------------------------------------------------------
// Bo'sh vaqtlar
// ---------------------------------------------------------------------------

function renderDay(barber, date) {
  const work = db.getWorkDay(barber.id, date);
  const head = `💈 <b>${esc(barber.salon_name)}</b> — ${esc(barber.name)}\n📅 <b>${dayLabel(date)}, ${prettyDate(date)}</b>`;
  const other = date === today() ? tomorrow() : today();
  const nav = new InlineKeyboard()
    .text('🔄 Yangilash', `day:${barber.id}:${date}`)
    .text(`📅 ${dayLabel(other)}`, `day:${barber.id}:${other}`);

  if (!work) {
    return {
      text: `${head}\n\n⚪ Sartarosh bu kun uchun ish vaqtini hali belgilamagan.\nSartarosh ishga kelib vaqtni belgilagach, bo'sh vaqtlar shu yerda ko'rinadi.`,
      kb: nav,
    };
  }

  const slots = buildSlots(barber, work, date);
  const free = slots.filter((s) => s.status === 'free');
  const busy = slots.filter((s) => s.status === 'pending' || s.status === 'booked').map((s) => s.time);

  const lines = [head, `🕐 Ish vaqti: ${work.start_time} – ${work.end_time}`, ''];
  if (free.length) lines.push(`✅ <b>Bo'sh vaqtlar (${free.length} ta)</b> — tanlang 👇`);
  else lines.push("❌ Bu kunga bo'sh vaqt qolmadi.");
  if (busy.length) lines.push(`🔒 Band: ${busy.join(', ')}`);

  const kb = new InlineKeyboard();
  free.forEach((s, i) => {
    kb.text(`🟢 ${s.time}`, `sl:${barber.id}:${date}:${s.time.replace(':', '')}`);
    if (i % 4 === 3) kb.row();
  });
  kb.row();
  for (const row of nav.inline_keyboard) kb.row(...row);
  return { text: lines.join('\n'), kb };
}

// ---------------------------------------------------------------------------
// Mening navbatlarim
// ---------------------------------------------------------------------------

export function renderClientBookings(userId) {
  const list = upcomingFor(userId);
  const kb = new InlineKeyboard();
  if (!list.length) return { text: "📅 Sizda faol navbatlar yo'q.\n\n«💈 Sartaroshlar» bo'limidan navbat oling.", kb };

  const lines = ['📅 <b>Mening navbatlarim</b>', ''];
  for (const b of list) {
    const st = b.status === 'accepted' ? '✅ Tasdiqlangan' : '⏳ Sartarosh tasdiqlashi kutilmoqda';
    lines.push(
      `💈 <b>${esc(b.salon_name)}</b> — ${esc(b.barber_name)}`,
      `📅 ${dayLabel(b.date)}, ${shortDate(b.date)} — 🕐 <b>${b.time}</b>`,
      ...(b.address ? [`🏠 ${esc(b.address)}`] : []),
      st,
      '',
    );
    kb.text(`📍 ${b.time} manzil`, `loc:${b.barber_id}`).text(`❌ ${b.time} bekor qilish`, `bk:ccan:${b.id}:m`).row();
  }
  return { text: lines.join('\n'), kb };
}

// ---------------------------------------------------------------------------
// Ro'yxatga olish
// ---------------------------------------------------------------------------

function withClient(fn) {
  return async (ctx) => {
    const u = db.getUser(ctx.from.id);
    if (!u?.phone) {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
      if (u?.role !== 'client') db.setRole(ctx.from.id, 'client');
      return askClientPhone(ctx);
    }
    return fn(ctx, u);
  };
}

export function registerClient(bot) {
  // Mini app'dagi «Raqamni ulash» (requestContact) yoki oddiy kontakt yuborish
  bot.on('message:contact', async (ctx, next) => {
    const c = ctx.message.contact;
    if (c.user_id !== ctx.from.id) return next();
    const digits = c.phone_number.replace(/[^\d+]/g, '');
    db.setUserPhone(ctx.from.id, digits.startsWith('+') ? digits : `+${digits}`);
    if (!db.getUser(ctx.from.id)?.role) db.setRole(ctx.from.id, 'client');
    return ctx.reply("✅ Raqamingiz saqlandi. Endi mini app'dan ham navbat olishingiz mumkin.", { reply_markup: clientMenu() });
  });

  bot.hears(BTN.mapApp, async (ctx) => {
    const url = getAppUrl();
    if (!url) return ctx.reply("🗺 Xarita hozircha ishlamayapti. Birozdan keyin qayta urinib ko'ring.");
    return ctx.reply(
      "🗺 <b>Xarita va reklamalar</b>\n\nXaritada barcha sartaroshxonalar va sizga eng yaqinlari ko'rinadi. Ochish uchun bosing 👇",
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().webApp('🗺 Xaritani ochish', url) },
    );
  });

  bot.hears(BTN.barbers, withClient((ctx) => sendList(ctx, 'all', 0)));

  bot.hears(BTN.near, withClient(async (ctx) => {
    setState(ctx.from.id, 'c_near');
    return ctx.reply("📍 Sizga eng yaqin sartaroshlarni topish uchun lokatsiyangizni yuboring 👇", {
      reply_markup: locationKb('client'),
    });
  }));

  bot.hears(BTN.search, withClient(async (ctx) => {
    setState(ctx.from.id, 'c_search');
    return ctx.reply("🔎 Sartarosh ismi, sartaroshxona nomi yoki manzilni yozing:", { reply_markup: cancelKb() });
  }));

  bot.hears(BTN.my, withClient(async (ctx) => {
    const { text, kb } = renderClientBookings(ctx.from.id);
    return ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }));

  bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

  bot.callbackQuery(/^pg:(all|near|search):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return sendList(ctx, ctx.match[1], Number(ctx.match[2]));
  });

  // Sartarosh kartochkasi
  bot.callbackQuery(/^b:(\d+)$/, async (ctx) => {
    const b = db.getBarber(Number(ctx.match[1]));
    if (!b || !b.is_active) return ctx.answerCallbackQuery({ text: 'Sartarosh topilmadi', show_alert: true });
    await ctx.answerCallbackQuery();
    return sendBarberCard(ctx, b);
  });

  // Xarita
  bot.callbackQuery(/^loc:(\d+)$/, async (ctx) => {
    const b = db.getBarber(Number(ctx.match[1]));
    if (!b || b.latitude == null) return ctx.answerCallbackQuery({ text: 'Lokatsiya kiritilmagan', show_alert: true });
    await ctx.answerCallbackQuery();
    return ctx.replyWithVenue(b.latitude, b.longitude, b.salon_name, b.address || b.name);
  });

  // Kun bo'yicha bo'sh vaqtlar
  bot.callbackQuery(/^day:(\d+):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const b = db.getBarber(Number(ctx.match[1]));
    const date = ctx.match[2];
    if (!b || !b.is_active) return ctx.answerCallbackQuery({ text: 'Sartarosh topilmadi', show_alert: true });
    if (date !== today() && date !== tomorrow()) {
      return ctx.answerCallbackQuery({ text: 'Bu tugma eskirgan, kartochkani qaytadan oching.', show_alert: true });
    }
    await ctx.answerCallbackQuery();
    const { text, kb } = renderDay(b, date);
    return replyOrEdit(ctx, text, kb);
  });

  // Vaqt tanlandi -> tasdiqlash so'raladi
  bot.callbackQuery(/^sl:(\d+):(\d{4}-\d{2}-\d{2}):(\d{2})(\d{2})$/, withClient(async (ctx) => {
    const barber = db.getBarber(Number(ctx.match[1]));
    const date = ctx.match[2];
    const time = `${ctx.match[3]}:${ctx.match[4]}`;
    if (barber?.id === ctx.from.id) return ctx.answerCallbackQuery({ text: "O'zingizga navbat ola olmaysiz 🙂", show_alert: true });
    const err = checkSlot(barber, date, time);
    if (err) {
      await ctx.answerCallbackQuery({ text: err, show_alert: true });
      if (barber) {
        const { text, kb } = renderDay(barber, date);
        return replyOrEdit(ctx, text, kb);
      }
      return;
    }
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text('✅ Ha, navbat olaman', `ok:${barber.id}:${date}:${ctx.match[3]}${ctx.match[4]}`)
      .row()
      .text('⬅️ Orqaga', `day:${barber.id}:${date}`);
    const text =
      '📝 <b>Navbatni tasdiqlang</b>\n\n' +
      `💈 ${esc(barber.salon_name)}\n👤 Sartarosh: ${esc(barber.name)}\n` +
      `📅 ${dayLabel(date)}, ${prettyDate(date)}\n🕐 Vaqt: <b>${time}</b> (${barber.slot_minutes} daqiqa)\n` +
      (barber.address ? `🏠 ${esc(barber.address)}\n` : '') +
      '\nSo\'rov sartaroshga yuboriladi, u tasdiqlagach sizga xabar keladi.';
    return replyOrEdit(ctx, text, kb);
  }));

  // Navbat olish
  bot.callbackQuery(/^ok:(\d+):(\d{4}-\d{2}-\d{2}):(\d{2})(\d{2})$/, withClient(async (ctx, user) => {
    const barber = db.getBarber(Number(ctx.match[1]));
    const date = ctx.match[2];
    const time = `${ctx.match[3]}:${ctx.match[4]}`;
    const r = await requestBooking(ctx.api, { barber, user: { ...user, name: user.name || ctx.from.first_name }, date, time });
    if (r.error) {
      await ctx.answerCallbackQuery({ text: r.error, show_alert: true });
      if (r.refresh && barber) {
        const { text, kb } = renderDay(barber, date);
        return replyOrEdit(ctx, text, kb);
      }
      return;
    }
    await ctx.answerCallbackQuery({ text: "So'rov yuborildi!" });

    await replyOrEdit(
      ctx,
      "⏳ <b>So'rovingiz sartaroshga yuborildi!</b>\n\n" +
        `💈 ${esc(barber.salon_name)} — ${esc(barber.name)}\n📅 ${dayLabel(date)}, ${prettyDate(date)}\n🕐 <b>${time}</b>\n\n` +
        "Sartarosh tasdiqlagach yoki rad etganda sizga darhol xabar keladi.\n«📅 Navbatlarim» bo'limida kuzatishingiz mumkin.",
    );

  }));
}


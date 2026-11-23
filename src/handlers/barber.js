import { InlineKeyboard } from 'grammy';
import * as db from '../db.js';
import { BTN, barberMenu, cancelKb, skipKb, contactKb, locationKb, hoursGrid } from '../keyboards.js';
import { getState, setState, clearState } from '../state.js';
import { today, tomorrow, prettyDate, shortDate, dayLabel, parseTime, toMin, toHHMM, nowMinutes } from '../time.js';
import { buildSlots } from '../slots.js';
import { sendBarberCard, replyOrEdit } from '../cards.js';
import { esc } from '../util.js';
import { showMenu } from './common.js';
import { locationFromMessage } from '../geo.js';
import { canBeBarber, askBarberAccess } from './access.js';

const LOCATION_HELP =
  "📍 Lokatsiyani tushunmadim. «🗺 Xaritadan tanlash» tugmasini bosing yoki Google Maps havolasini / koordinatani yuboring (masalan: 41.311081, 69.240562).";

// ---------------------------------------------------------------------------
// Profil maydonlari (ro'yxatdan o'tish va tahrirlashda bir xil ishlatiladi)
// ---------------------------------------------------------------------------

const FIELDS = {
  name: { label: '👤 Ism', ask: '👤 Ismingizni kiriting (mijozlar shu ismni ko\'radi):', kind: 'text', min: 2, max: 40 },
  salon_name: { label: '💈 Sartaroshxona nomi', ask: '💈 Sartaroshxona nomini kiriting:', kind: 'text', min: 2, max: 60 },
  experience: { label: '⭐ Staj', ask: '⭐ Necha yillik tajribangiz (staj) bor?\nFaqat raqam yozing, masalan: <b>5</b>', kind: 'int', min: 0, max: 70 },
  photo_file_id: { label: '📸 Rasm', ask: '📸 Sartaroshxonangiz rasmini yuboring (mijozlar shu rasmni ko\'radi):', kind: 'photo' },
  location: {
    label: '📍 Lokatsiya',
    ask:
      '📍 <b>Sartaroshxona lokatsiyasini yuboring.</b>\n\n' +
      '🗺 <b>Xaritadan tanlash</b> — xaritada aniq nuqtani belgilang (kompyuter va telefonda ishlaydi)\n' +
      "📍 <b>Lokatsiyamni yuborish</b> — hozir sartaroshxonada bo'lsangiz (faqat telefonda)\n" +
      '🔗 Yoki Google/Yandex Maps havolasini yoki koordinatani yozing, masalan: <code>41.311081, 69.240562</code>',
    kind: 'location',
  },
  address: { label: '🏠 Manzil', ask: "🏠 Manzilni matn bilan yozing (mo'ljal bilan).\nMasalan: <i>Chilonzor 9-kvartal, Korzinka yonida</i>", kind: 'text', min: 3, max: 150, skippable: true },
  phone: { label: '📞 Telefon', ask: '📞 Mijozlar bog\'lanishi uchun telefon raqamingizni yuboring yoki yozing:', kind: 'phone' },
  price: { label: '💰 Narx', ask: "💰 Xizmat narxlarini yozing.\nMasalan: <i>Soch olish — 50 000 so'm, soqol — 30 000 so'm</i>", kind: 'text', min: 2, max: 200, skippable: true },
  slot_minutes: { label: '⏱ Bir mijoz vaqti', ask: "⏱ Bitta mijozga o'rtacha necha daqiqa ketadi?\n(Navbat vaqtlari shu oraliq bilan bo'linadi)", kind: 'slot' },
};
const REG_ORDER = Object.keys(FIELDS);
const STALE = "Bu tugma eskirgan. Qaytadan «🟢 Ishni boshlash» ni bosing.";
const say = async (ctx, text) => {
  await ctx.reply(text);
  return true;
};
const SLOT_OPTIONS = [15, 20, 30, 40, 45, 60, 90];

function slotKb() {
  const kb = new InlineKeyboard();
  SLOT_OPTIONS.forEach((m, i) => {
    kb.text(`${m} daq`, `slot:${m}`);
    if (i % 4 === 3) kb.row();
  });
  return kb;
}

async function askField(ctx, key, prefix = '') {
  const f = FIELDS[key];
  const text = prefix + f.ask;
  let reply_markup = cancelKb();
  if (f.kind === 'location') reply_markup = locationKb();
  else if (f.kind === 'phone') reply_markup = contactKb();
  else if (f.skippable) reply_markup = skipKb();
  else if (f.kind === 'slot') reply_markup = slotKb();
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup });
}

/** Xabardan maydon qiymatini ajratadi: { value } yoki { error } */
async function parseField(ctx, key) {
  const f = FIELDS[key];
  const msg = ctx.message;
  const text = msg.text?.trim();

  if (f.skippable && text === BTN.skip) return { value: null };

  switch (f.kind) {
    case 'text':
      if (!text) return { error: '✍️ Iltimos, matn yozing.' };
      if (text.length < f.min || text.length > f.max) return { error: `✍️ Matn uzunligi ${f.min}–${f.max} belgi bo'lishi kerak.` };
      return { value: text };
    case 'int': {
      const n = Number(text);
      if (!text || !/^\d{1,2}$/.test(text) || n < f.min || n > f.max) return { error: '🔢 Faqat raqam yozing, masalan: 5' };
      return { value: n };
    }
    case 'photo':
      if (!msg.photo?.length) return { error: '📸 Iltimos, rasm yuboring (fayl emas, rasm ko\'rinishida).' };
      return { value: msg.photo.at(-1).file_id };
    case 'location': {
      const loc = await locationFromMessage(msg);
      if (!loc) return { error: LOCATION_HELP };
      return { value: loc };
    }
    case 'phone': {
      const raw = msg.contact?.phone_number ?? text;
      const digits = raw?.replace(/[^\d+]/g, '');
      if (!digits || !/^\+?\d{9,15}$/.test(digits)) return { error: '📞 Telefon raqam noto\'g\'ri. Masalan: +998901234567' };
      return { value: digits.startsWith('+') ? digits : `+${digits}` };
    }
    case 'slot':
      return { error: '⏱ Iltimos, yuqoridagi tugmalardan birini tanlang.' };
    default:
      return { error: 'Xatolik' };
  }
}

// ---------------------------------------------------------------------------
// Ro'yxatdan o'tish
// ---------------------------------------------------------------------------

export async function startBarberRegistration(ctx) {
  if (!canBeBarber(ctx.from.id)) return askBarberAccess(ctx);
  setState(ctx.from.id, 'breg', { idx: 0, values: {} });
  await ctx.reply(
    "📝 <b>Sartarosh sifatida ro'yxatdan o'tish</b>\n\nBir nechta savolga javob bering — mijozlar profilingizni ko'rib, navbat olishadi.\nIstalgan payt «❌ Bekor qilish» ni bosishingiz mumkin.",
    { parse_mode: 'HTML' },
  );
  return askField(ctx, REG_ORDER[0], `<b>1/${REG_ORDER.length}.</b> `);
}

async function regNext(ctx, st) {
  st.data.idx++;
  if (st.data.idx >= REG_ORDER.length) return finishRegistration(ctx, st.data.values);
  setState(ctx.from.id, 'breg', st.data);
  return askField(ctx, REG_ORDER[st.data.idx], `<b>${st.data.idx + 1}/${REG_ORDER.length}.</b> `);
}

async function finishRegistration(ctx, values) {
  db.saveBarber({ id: ctx.from.id, ...values });
  db.setRole(ctx.from.id, 'barber');
  clearState(ctx.from.id);
  const b = db.getBarber(ctx.from.id);
  await ctx.reply('✅ <b>Profilingiz tayyor!</b> Mijozlar sizni shunday ko\'radi:', { parse_mode: 'HTML', reply_markup: barberMenu() });
  await sendBarberCard(ctx, b, new InlineKeyboard());
  return ctx.reply(
    "❗️ Har kuni ishga kelganingizda <b>«🟢 Ishni boshlash»</b> tugmasini bosib, kelgan va ketadigan vaqtingizni belgilang.\n" +
      "Shundan keyin mijozlar shu oraliqdagi bo'sh vaqtlarga navbat ola boshlaydi.",
    { parse_mode: 'HTML' },
  );
}

// ---------------------------------------------------------------------------
// Holatlar (matn/rasm/lokatsiya kiritish)
// ---------------------------------------------------------------------------

export async function handleBarberState(ctx, st) {
  switch (st.step) {
    case 'breg': {
      const key = REG_ORDER[st.data.idx];
      const r = await parseField(ctx, key);
      if (r.error) return say(ctx, r.error);
      st.data.values[key] = r.value;
      await regNext(ctx, st);
      return true;
    }
    case 'bedit': {
      const key = st.data.key;
      const r = await parseField(ctx, key);
      if (r.error) return say(ctx, r.error);
      db.updateBarber(ctx.from.id, key, r.value);
      clearState(ctx.from.id);
      await ctx.reply(`✅ ${FIELDS[key].label} saqlandi.`, { reply_markup: barberMenu() });
      return true;
    }
    case 'work_start': {
      const t = parseTime(ctx.message.text ?? '');
      if (!t) return say(ctx, '🕐 Vaqtni HH:MM ko\'rinishida yozing, masalan: 08:30');
      await onWorkStart(ctx, t);
      return true;
    }
    case 'work_end': {
      const t = parseTime(ctx.message.text ?? '');
      if (!t) return say(ctx, '🕐 Vaqtni HH:MM ko\'rinishida yozing, masalan: 20:00');
      await onWorkEnd(ctx, t);
      return true;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Ish vaqtini belgilash
// ---------------------------------------------------------------------------

function roundUp5(min) {
  return Math.min(Math.ceil(min / 5) * 5, 23 * 60 + 55);
}

async function onWorkStart(ctx, start) {
  const st = getState(ctx.from.id);
  if (st?.step !== 'work_start') return replyOrEdit(ctx, STALE);
  const { date } = st.data;
  if (date === today() && toMin(start) < nowMinutes() - 5) {
    // o'tib ketgan vaqtni tanlasa — hozirdan boshlaymiz
    start = toHHMM(roundUp5(nowMinutes()));
  }
  setState(ctx.from.id, 'work_end', { date, start });
  const from = Math.ceil((toMin(start) + 60) / 60) * 60;
  const kb = hoursGrid('we', from, 23 * 60, [['23:59', '2359']]);
  return replyOrEdit(
    ctx,
    `🕐 <b>${prettyDate(date)}</b>\nKelish vaqti: <b>${start}</b>\n\n🔴 Endi <b>ketish vaqtini</b> tanlang yoki yozing (masalan: <code>20:00</code>):`,
    kb,
  );
}

async function onWorkEnd(ctx, end) {
  const st = getState(ctx.from.id);
  if (st?.step !== 'work_end') return replyOrEdit(ctx, STALE);
  const barber = db.getBarber(ctx.from.id);
  const { date, start } = st.data;
  if (toMin(end) - toMin(start) < barber.slot_minutes) {
    return ctx.reply(`⚠️ Ketish vaqti kelish vaqtidan kamida ${barber.slot_minutes} daqiqa keyin bo'lishi kerak. Qaytadan kiriting:`);
  }
  db.setWorkDay(barber.id, date, start, end);
  clearState(ctx.from.id);

  const slots = buildSlots(barber, { start_time: start, end_time: end }, date);
  const free = slots.filter((s) => s.status === 'free').length;
  const outside = db
    .activeBookingsForDate(barber.id, date)
    .filter((b) => toMin(b.time) < toMin(start) || toMin(b.time) + b.duration > toMin(end));

  let text =
    `✅ <b>${prettyDate(date)}</b> — ish vaqti saqlandi\n\n` +
    `🟢 Kelish: <b>${start}</b>\n🔴 Ketish: <b>${end}</b>\n✅ Bo'sh vaqtlar: <b>${free} ta</b>\n\n` +
    "Mijozlar endi shu oraliqdagi bo'sh vaqtlarga navbat olishlari mumkin. Har bir so'rov sizga tasdiqlash uchun keladi.";
  if (outside.length) {
    text += `\n\n⚠️ Diqqat: ${outside.length} ta navbat yangi ish vaqtidan tashqarida qoldi (${outside.map((b) => b.time).join(', ')}). «📋 Navbatlar» bo'limida ko'ring.`;
  }
  return replyOrEdit(ctx, text);
}

// ---------------------------------------------------------------------------
// Navbatlar ro'yxati (sartarosh uchun)
// ---------------------------------------------------------------------------

export function renderBarberBookings(barber, date) {
  const work = db.getWorkDay(barber.id, date);
  const list = db.activeBookingsForDate(barber.id, date);
  const lines = [`📋 <b>Navbatlar — ${dayLabel(date)}, ${shortDate(date)}</b>`];
  lines.push(work ? `🕐 Ish vaqti: ${work.start_time} – ${work.end_time}` : '⚪ Bu kunga ish vaqti belgilanmagan');
  lines.push('');

  const kb = new InlineKeyboard();
  if (!list.length) lines.push('Hozircha navbat yo\'q.');
  for (const b of list) {
    const who = `${esc(b.client_name || 'Mijoz')}${b.client_phone ? ` (${esc(b.client_phone)})` : ''}`;
    if (b.status === 'pending') {
      lines.push(`⏳ <b>${b.time}</b> — ${who} — <i>tasdiq kutmoqda</i>`);
      kb.text(`✅ ${b.time} qabul`, `bk:acc:${b.id}:l`).text(`❌ ${b.time} rad`, `bk:rej:${b.id}:l`).row();
    } else {
      lines.push(`✅ <b>${b.time}</b> — ${who}`);
      kb.text(`🚫 ${b.time} ni bekor qilish`, `bk:bcan:${b.id}:l`).row();
    }
  }
  if (list.length) lines.push('', `Jami: ${list.length} ta`);

  kb.text('Bugun', `bb:${today()}`).text('Ertaga', `bb:${tomorrow()}`).text('🔄', `bb:${date}`);
  return { text: lines.join('\n'), kb };
}

function renderFree(barber, date) {
  const work = db.getWorkDay(barber.id, date);
  const head = `🕐 <b>${dayLabel(date)}, ${shortDate(date)}</b>`;
  if (!work) return `${head}\n⚪ Ish vaqti belgilanmagan`;
  const slots = buildSlots(barber, work, date);
  const by = (s) => slots.filter((x) => x.status === s).map((x) => x.time);
  const free = by('free');
  const pending = by('pending');
  const booked = by('booked');
  const out = [`${head} (${work.start_time} – ${work.end_time})`];
  out.push(free.length ? `✅ Bo'sh (${free.length}): ${free.join(', ')}` : "✅ Bo'sh vaqt yo'q");
  if (pending.length) out.push(`⏳ Tasdiq kutmoqda: ${pending.join(', ')}`);
  if (booked.length) out.push(`🔒 Band: ${booked.join(', ')}`);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Ro'yxatga olish
// ---------------------------------------------------------------------------

function withBarber(fn) {
  return async (ctx) => {
    const b = db.getBarber(ctx.from.id);
    const u = db.getUser(ctx.from.id);
    if (!b || u?.role !== 'barber') {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
      return showMenu(ctx);
    }
    return fn(ctx, b);
  };
}

export function registerBarber(bot) {
  // --- Ishni boshlash ---
  bot.hears(BTN.startWork, withBarber(async (ctx, b) => {
    clearState(ctx.from.id);
    const t = today();
    const tm = tomorrow();
    const w = db.getWorkDay(b.id, t);
    let text = '🟢 <b>Ish vaqtini belgilash</b>\n\nQaysi kun uchun belgilaysiz?';
    if (w) text += `\n\nBugun hozir: <b>${w.start_time} – ${w.end_time}</b>`;
    const kb = new InlineKeyboard().text(`Bugun (${shortDate(t)})`, `wd:${t}`).text(`Ertaga (${shortDate(tm)})`, `wd:${tm}`);
    return ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }));

  bot.callbackQuery(/^wd:(\d{4}-\d{2}-\d{2})$/, withBarber(async (ctx) => {
    await ctx.answerCallbackQuery();
    const date = ctx.match[1];
    if (date !== today() && date !== tomorrow()) return replyOrEdit(ctx, 'Bu tugma eskirgan. Qaytadan «🟢 Ishni boshlash» ni bosing.');
    setState(ctx.from.id, 'work_start', { date });
    const extra = [];
    if (date === today()) {
      const now = toHHMM(roundUp5(nowMinutes()));
      extra.push([`⚡ Hozirdan (${now})`, now.replace(':', '')]);
    }
    const kb = hoursGrid('ws', 6 * 60, 22 * 60, extra);
    return replyOrEdit(
      ctx,
      `🕐 <b>${prettyDate(date)}</b>\n\n🟢 Ishni <b>boshlash vaqtini</b> tanlang yoki yozing (masalan: <code>08:30</code>):`,
      kb,
    );
  }));

  bot.callbackQuery(/^ws:(\d{2})(\d{2})$/, withBarber(async (ctx) => {
    await ctx.answerCallbackQuery();
    return onWorkStart(ctx, `${ctx.match[1]}:${ctx.match[2]}`);
  }));

  bot.callbackQuery(/^we:(\d{2})(\d{2})$/, withBarber(async (ctx) => {
    await ctx.answerCallbackQuery();
    return onWorkEnd(ctx, `${ctx.match[1]}:${ctx.match[2]}`);
  }));

  // --- Ishni yakunlash ---
  bot.hears(BTN.endWork, withBarber(async (ctx, b) => {
    clearState(ctx.from.id);
    const t = today();
    const w = db.getWorkDay(b.id, t);
    if (!w) return ctx.reply('⚪ Bugun ish vaqti belgilanmagan.');
    const now = nowMinutes();
    if (toMin(w.end_time) <= now) return ctx.reply(`Bugungi ish vaqti allaqachon tugagan (${w.end_time}).`);
    const newEnd = toHHMM(Math.max(now, toMin(w.start_time)));
    db.setWorkEnd(b.id, t, newEnd);
    const left = db.activeBookingsForDate(b.id, t).filter((x) => toMin(x.time) + x.duration > now);
    let text = `🔴 <b>Bugungi ish yakunlandi</b> (${newEnd}).\nEndi bugunga yangi navbat olinmaydi.`;
    if (left.length) {
      text += `\n\n⚠️ Sizda hali ${left.length} ta navbat bor: ${left.map((x) => x.time).join(', ')}.\nKerak bo'lsa «📋 Navbatlar» orqali bekor qiling — mijozga xabar boradi.`;
    }
    return ctx.reply(text, { parse_mode: 'HTML' });
  }));

  // --- Navbatlar ---
  bot.hears(BTN.bookings, withBarber(async (ctx, b) => {
    clearState(ctx.from.id);
    const { text, kb } = renderBarberBookings(b, today());
    return ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }));

  bot.callbackQuery(/^bb:(\d{4}-\d{2}-\d{2})$/, withBarber(async (ctx, b) => {
    await ctx.answerCallbackQuery();
    const { text, kb } = renderBarberBookings(b, ctx.match[1]);
    return replyOrEdit(ctx, text, kb);
  }));

  // --- Bo'sh vaqtlar ---
  bot.hears(BTN.free, withBarber(async (ctx, b) => {
    clearState(ctx.from.id);
    const text = `${renderFree(b, today())}\n\n${renderFree(b, tomorrow())}`;
    return ctx.reply(text, { parse_mode: 'HTML' });
  }));

  // --- Profil ---
  bot.hears(BTN.profile, withBarber(async (ctx, b) => {
    clearState(ctx.from.id);
    const status = b.is_active ? '👁 Profil mijozlarga <b>ko\'rinadi</b>' : '🙈 Profil mijozlardan <b>yashirilgan</b>';
    await sendBarberCard(ctx, b, new InlineKeyboard().text('✏️ Tahrirlash', 'bedit:menu'));
    return ctx.reply(status, { parse_mode: 'HTML' });
  }));

  // --- Tahrirlash ---
  const editMenu = (b) => {
    const kb = new InlineKeyboard();
    REG_ORDER.forEach((key, i) => {
      kb.text(FIELDS[key].label, `bedit:${key}`);
      if (i % 2 === 1) kb.row();
    });
    kb.row().text(b.is_active ? "🙈 Profilni yashirish" : "👁 Profilni ko'rsatish", 'bedit:toggle');
    return kb;
  };

  bot.hears(BTN.edit, withBarber(async (ctx, b) => {
    clearState(ctx.from.id);
    return ctx.reply("✏️ Nimani o'zgartirmoqchisiz?", { reply_markup: editMenu(b) });
  }));

  bot.callbackQuery(/^bedit:(\w+)$/, withBarber(async (ctx, b) => {
    await ctx.answerCallbackQuery();
    const key = ctx.match[1];
    if (key === 'menu') return ctx.reply("✏️ Nimani o'zgartirmoqchisiz?", { reply_markup: editMenu(b) });
    if (key === 'toggle') {
      db.updateBarber(b.id, 'is_active', b.is_active ? 0 : 1);
      const text = b.is_active
        ? "🙈 Profilingiz mijozlardan yashirildi. Yangi navbat olinmaydi."
        : "👁 Profilingiz yana mijozlarga ko'rinadi.";
      return replyOrEdit(ctx, text);
    }
    if (!FIELDS[key]) return;
    setState(ctx.from.id, 'bedit', { key });
    return askField(ctx, key);
  }));

  // --- Bir mijoz vaqti (ro'yxatdan o'tish yoki tahrirlash) ---
  bot.callbackQuery(/^slot:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const minutes = Number(ctx.match[1]);
    if (!SLOT_OPTIONS.includes(minutes)) return;
    const st = getState(ctx.from.id);
    if (st?.step === 'breg' && REG_ORDER[st.data.idx] === 'slot_minutes') {
      st.data.values.slot_minutes = minutes;
      await ctx.editMessageText(`⏱ Bir mijozga: <b>${minutes} daqiqa</b>`, { parse_mode: 'HTML' }).catch(() => {});
      return regNext(ctx, st);
    }
    if (st?.step === 'bedit' && st.data.key === 'slot_minutes') {
      db.updateBarber(ctx.from.id, 'slot_minutes', minutes);
      clearState(ctx.from.id);
      await ctx.editMessageText(`⏱ Bir mijozga: <b>${minutes} daqiqa</b>`, { parse_mode: 'HTML' }).catch(() => {});
      return ctx.reply('✅ Saqlandi. Yangi vaqt oralig\'i keyingi ish kunlaridan to\'liq qo\'llanadi.', { reply_markup: barberMenu() });
    }
  });
}

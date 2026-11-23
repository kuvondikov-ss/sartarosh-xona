// Vaqt bilan ishlash. Server qaysi zonada bo'lishidan qat'i nazar Toshkent vaqti ishlatiladi.
const OFFSET_MIN = Number(process.env.TZ_OFFSET_MINUTES ?? 300);

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const WEEKDAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];

/** Mahalliy vaqt (UTC getterlari bilan o'qiladi). */
export function nowLocal() {
  return new Date(Date.now() + OFFSET_MIN * 60000);
}

export function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

export function today() {
  return dateStr(nowLocal());
}

export function tomorrow() {
  return dateStr(new Date(nowLocal().getTime() + 86400000));
}

/** Bugun yarim tundan beri o'tgan daqiqalar. */
export function nowMinutes() {
  const d = nowLocal();
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function toHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** "9", "09:30", "9.30", "0930" -> "09:30"; noto'g'ri bo'lsa null. */
export function parseTime(text) {
  const m = /^(\d{1,2})(?:[:.\s-]?(\d{2}))?$/.exec(String(text).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (h > 23 || mi > 59) return null;
  return toHHMM(h * 60 + mi);
}

/** "2026-11-21" -> "21-noyabr, Shanba" */
export function prettyDate(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${d}-${MONTHS[m - 1]}, ${WEEKDAYS[wd]}`;
}

/** "2026-11-21" -> "21-noyabr" */
export function shortDate(ds) {
  const [, m, d] = ds.split('-').map(Number);
  return `${d}-${MONTHS[m - 1]}`;
}

export function dayLabel(ds) {
  if (ds === today()) return 'Bugun';
  if (ds === tomorrow()) return 'Ertaga';
  return shortDate(ds);
}

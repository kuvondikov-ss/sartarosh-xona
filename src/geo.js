// Xabardan joylashuvni ajratish: Telegram lokatsiyasi, xaritadan tanlash (mini app),
// koordinata matni yoki Google/Yandex Maps havolasi.

const valid = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

const point = (lat, lon) => (valid(lat, lon) ? { latitude: lat, longitude: lon } : null);

/** Havola yoki matndan koordinata (sinxron). */
export function parseCoordsText(text) {
  if (!text) return null;
  let s = text.trim();
  try { s = decodeURIComponent(s); } catch { /* buzilgan kodlash */ }
  const num = '(-?\\d{1,3}\\.\\d+)';
  const isYandex = /yandex\./i.test(s);

  // Yandex: ll=, pt=, whatshere[point]= -> "uzunlik,kenglik" tartibida
  if (isYandex) {
    const m = new RegExp(`(?:[?&](?:pt|ll)|whatshere\\[point\\])=${num},${num}`).exec(s);
    if (m) return point(Number(m[2]), Number(m[1]));
  }
  // Google: !3d<lat>!4d<lon> (aniq nuqta), @lat,lon, ?q=lat,lon, ?query=, ?destination=, ?ll=
  const patterns = [
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`[?&](?:q|query|destination|daddr|ll|center)=(?:loc:)?${num},\\s*${num}`),
    new RegExp(`@${num},${num}`),
    new RegExp(`(?:^|[^\\d.])${num}\\s*[,;\\s]\\s*${num}(?![\\d.])`), // oddiy "41.31, 69.24"
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) return point(Number(m[1]), Number(m[2]));
  }
  return null;
}

const SHORT_LINK = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?yandex\.(?:uz|ru|com|kz)\/maps\/-)\/?\S*/i;

/** Qisqa havolani (maps.app.goo.gl, yandex.uz/maps/-/...) ochib, to'liq manzilni oladi. */
async function expandShortLink(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    const body = r.ok ? (await r.text()).slice(0, 200_000) : '';
    return parseCoordsText(r.url) ?? parseCoordsText(body.match(/https:\/\/[^"'\s]*(?:@|ll=|q=)[^"'\s]*/)?.[0]);
  } catch {
    return null;
  }
}

/** Telegram xabaridan joylashuv; topilmasa null. */
export async function locationFromMessage(msg) {
  const loc = msg.location ?? msg.venue?.location;
  if (loc) return point(loc.latitude, loc.longitude);

  if (msg.web_app_data?.data) {
    try {
      const d = JSON.parse(msg.web_app_data.data);
      return point(Number(d.lat), Number(d.lon));
    } catch {
      return null;
    }
  }

  const text = msg.text ?? msg.caption;
  if (!text) return null;
  const direct = parseCoordsText(text);
  if (direct) return direct;
  const short = text.match(SHORT_LINK)?.[0];
  return short ? expandShortLink(short) : null;
}

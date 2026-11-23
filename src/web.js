// Mini app uchun HTTP server: sahifa, API va Telegram rasmlari/videolari proksisi.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as db from './db.js';
import { buildSlots } from './slots.js';
import { today, tomorrow, nowMinutes, toHHMM, dayLabel, prettyDate } from './time.js';
import { verifyInitData } from './services/tgauth.js';
import { requestBooking, cancelByClient, upcomingFor } from './services/booking.js';

function readJson(req, limit = 10_000) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

const PUBLIC_DIR = path.resolve('public');
const CACHE_DIR = path.resolve(path.dirname(process.env.DB_PATH && process.env.DB_PATH !== ':memory:' ? process.env.DB_PATH : 'data/x'), 'cache');
const MAX_TG_FILE = 20 * 1024 * 1024; // Bot API getFile chegarasi

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
};
const typeOf = (file) => TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
const hashOf = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Topilmadi');
}

/** Faylni yuboradi; video uchun Range (bo'lib yuklash) qo'llab-quvvatlanadi. */
function sendFile(req, res, file, cache = 'public, max-age=300') {
  const { size } = fs.statSync(file);
  const headers = { 'Content-Type': typeOf(file), 'Accept-Ranges': 'bytes', 'Cache-Control': cache };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    end = Math.min(end, size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// Telegram fayllarini keshlash
// ---------------------------------------------------------------------------

function createFileCache(api, token) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const known = new Map();
  const inflight = new Map();

  const findOnDisk = (h) => {
    const hit = fs.readdirSync(CACHE_DIR).find((f) => f.startsWith(h + '.'));
    return hit ? path.join(CACHE_DIR, hit) : null;
  };

  async function download(fileId, h) {
    const f = await api.getFile(fileId);
    if (!f.file_path) throw new Error('file_path yo\'q');
    const r = await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
    if (!r.ok) throw new Error(`Yuklab bo'lmadi: ${r.status}`);
    const ext = path.extname(f.file_path) || '.jpg';
    const file = path.join(CACHE_DIR, h + ext.toLowerCase());
    fs.writeFileSync(file + '.part', Buffer.from(await r.arrayBuffer()));
    fs.renameSync(file + '.part', file);
    return file;
  }

  return async function get(fileId) {
    const h = hashOf(fileId);
    if (known.has(h)) return known.get(h);
    const disk = findOnDisk(h);
    if (disk) {
      known.set(h, disk);
      return disk;
    }
    if (!inflight.has(h)) {
      inflight.set(h, download(fileId, h).finally(() => inflight.delete(h)));
    }
    const file = await inflight.get(h);
    known.set(h, file);
    return file;
  };
}

// ---------------------------------------------------------------------------
// API ma'lumotlari
// ---------------------------------------------------------------------------

function barbersPayload() {
  const date = today();
  const now = toHHMM(nowMinutes());
  return db.activeBarbers()
    .filter((b) => b.latitude != null && b.longitude != null)
    .map((b) => {
      const work = db.getWorkDay(b.id, date);
      const free = work ? buildSlots(b, work, date).filter((s) => s.status === 'free').length : 0;
      return {
        id: b.id,
        name: b.name,
        salon: b.salon_name,
        experience: b.experience,
        price: b.price,
        address: b.address,
        phone: b.phone,
        slotMinutes: b.slot_minutes,
        lat: b.latitude,
        lon: b.longitude,
        photo: b.photo_file_id ? `media/barber/${b.id}?v=${hashOf(b.photo_file_id).slice(0, 8)}` : null,
        work: work ? { start: work.start_time, end: work.end_time } : null,
        openNow: Boolean(work && work.end_time > now && work.start_time <= now),
        free,
      };
    });
}

const adsPayload = () =>
  db.listAds().map((a) => ({ id: a.id, type: a.type, title: a.title, link: a.link, src: `media/ad/${a.id}?v=${hashOf(a.file_id).slice(0, 8)}` }));

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function startWebServer({ api, token, botUsername, port = 3000 }) {
  const getFile = createFileCache(api, token);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;

      if (p === '/api/config') return json(res, { bot: botUsername, today: today(), tomorrow: tomorrow() });
      if (p === '/api/barbers') return json(res, barbersPayload());
      if (p === '/api/ads') return json(res, adsPayload());

      // Bitta sartaroshning bugungi/ertangi vaqtlari
      let m = /^\/api\/barber\/(\d+)\/slots$/.exec(p);
      if (m) {
        const b = db.getBarber(Number(m[1]));
        const date = url.searchParams.get('date');
        if (!b || !b.is_active) return json(res, { message: 'Sartarosh topilmadi' }, 404);
        if (date !== today() && date !== tomorrow()) return json(res, { message: "Faqat bugun va ertaga" }, 400);
        const work = db.getWorkDay(b.id, date);
        const slots = buildSlots(b, work, date)
          .filter((s) => s.status !== 'past')
          .map((s) => ({ time: s.time, free: s.status === 'free' }));
        return json(res, { date, label: `${dayLabel(date)}, ${prettyDate(date)}`, work: work ? { start: work.start_time, end: work.end_time } : null, slots });
      }

      // --- Telegram orqali kirgan foydalanuvchi uchun ---
      if (p.startsWith('/api/me') || p === '/api/book') {
        const tgUser = verifyInitData(String(req.headers.authorization ?? '').replace(/^tma /, ''), token);
        if (!tgUser) return json(res, { message: "Mini app'ni Telegram ichida oching" }, 401);
        db.touchUser(tgUser);
        const user = db.getUser(tgUser.id);

        if (p === '/api/me' && req.method === 'GET') {
          const bookings = upcomingFor(user.id).map((k) => ({
            id: k.id, barberId: k.barber_id, salon: k.salon_name, barber: k.barber_name, address: k.address,
            lat: k.latitude, lon: k.longitude, phone: k.barber_phone,
            date: k.date, label: `${dayLabel(k.date)}, ${prettyDate(k.date)}`, time: k.time, status: k.status,
          }));
          return json(res, { id: user.id, name: user.name, hasPhone: Boolean(user.phone), role: user.role, isBarber: Boolean(db.getBarber(user.id)), bookings });
        }

        if (p === '/api/book' && req.method === 'POST') {
          if (!user.phone) return json(res, { code: 'phone', message: 'Navbat olish uchun telefon raqamingizni ulang' }, 409);
          const body = await readJson(req);
          const barber = db.getBarber(Number(body.barberId));
          const r = await requestBooking(api, { barber, user, date: String(body.date), time: String(body.time) });
          if (r.error) return json(res, { message: r.error, refresh: Boolean(r.refresh) }, 409);
          return json(res, { ok: true, id: r.id });
        }

        m = /^\/api\/me\/bookings\/(\d+)\/cancel$/.exec(p);
        if (m && req.method === 'POST') {
          const r = await cancelByClient(api, Number(m[1]), user.id);
          if (r.error) return json(res, { message: r.error }, 409);
          return json(res, { ok: true });
        }
        return notFound(res);
      }

      m = /^\/media\/(barber|ad)\/(\d+)$/.exec(p);
      if (m) {
        const row = m[1] === 'barber' ? db.getBarber(Number(m[2])) : db.getAd(Number(m[2]));
        const fileId = row?.photo_file_id ?? row?.file_id;
        if (!fileId) return notFound(res);
        try {
          return sendFile(req, res, await getFile(fileId), 'public, max-age=86400');
        } catch (e) {
          console.error('Media xatosi:', e.description || e.message);
          return notFound(res);
        }
      }

      // Statik fayllar (public/)
      const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
      const file = path.resolve(PUBLIC_DIR, rel);
      if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound(res);
      return sendFile(req, res, file, 'no-cache');
    } catch (e) {
      console.error('Web xatosi:', e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  server.listen(port, () => console.log(`🌐 Mini app: http://localhost:${port}`));
  return server;
}

export { MAX_TG_FILE };

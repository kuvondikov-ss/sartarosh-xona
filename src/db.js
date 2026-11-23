import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || 'data/bot.db';
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,          -- Telegram user id
  role        TEXT,                         -- 'barber' | 'client'
  name        TEXT,
  username    TEXT,
  phone       TEXT,
  last_lat    REAL,
  last_lon    REAL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS barbers (
  id            INTEGER PRIMARY KEY REFERENCES users(id),
  name          TEXT NOT NULL,
  salon_name    TEXT NOT NULL,
  experience    INTEGER NOT NULL DEFAULT 0,
  photo_file_id TEXT,
  latitude      REAL,
  longitude     REAL,
  address       TEXT,
  phone         TEXT,
  price         TEXT,
  slot_minutes  INTEGER NOT NULL DEFAULT 30,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS work_days (
  barber_id   INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,                -- YYYY-MM-DD
  start_time  TEXT NOT NULL,                -- HH:MM
  end_time    TEXT NOT NULL,                -- HH:MM
  PRIMARY KEY (barber_id, date)
);

CREATE TABLE IF NOT EXISTS bookings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  barber_id     INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  client_id     INTEGER NOT NULL REFERENCES users(id),
  client_name   TEXT,
  client_phone  TEXT,
  date          TEXT NOT NULL,
  time          TEXT NOT NULL,
  duration      INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected | cancelled | expired
  reminded      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- Bitta vaqtga ikki kishi navbat ololmasligi uchun
CREATE UNIQUE INDEX IF NOT EXISTS ux_booking_slot
  ON bookings(barber_id, date, time) WHERE status IN ('pending', 'accepted');
CREATE INDEX IF NOT EXISTS ix_booking_client ON bookings(client_id, date);
CREATE INDEX IF NOT EXISTS ix_booking_barber ON bookings(barber_id, date);
CREATE INDEX IF NOT EXISTS ix_booking_status ON bookings(status, date);

-- Mini app tepasidagi reklama roliklari (admin bot orqali qo'shadi)
CREATE TABLE IF NOT EXISTS ads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,                -- 'photo' | 'video'
  file_id     TEXT NOT NULL,
  title       TEXT,
  link        TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);
`);

const cache = new Map();
const q = (sql) => {
  let st = cache.get(sql);
  if (!st) {
    st = db.prepare(sql);
    cache.set(sql, st);
  }
  return st;
};

// ---------- users ----------

export function touchUser(from) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
  q(`INSERT INTO users (id, name, username) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username,
       name = COALESCE(users.name, excluded.name)`).run(from.id, name, from.username ?? null);
}

export const getUser = (id) => q('SELECT * FROM users WHERE id = ?').get(id);
export const setRole = (id, role) => q('UPDATE users SET role = ? WHERE id = ?').run(role, id);
export const setUserPhone = (id, phone) => q('UPDATE users SET phone = ? WHERE id = ?').run(phone, id);
export const setUserLocation = (id, lat, lon) =>
  q('UPDATE users SET last_lat = ?, last_lon = ? WHERE id = ?').run(lat, lon, id);

// ---------- barbers ----------

export const getBarber = (id) => q('SELECT * FROM barbers WHERE id = ?').get(id);

export function saveBarber(b) {
  q(`INSERT INTO barbers (id, name, salon_name, experience, photo_file_id, latitude, longitude,
                          address, phone, price, slot_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, salon_name = excluded.salon_name,
       experience = excluded.experience, photo_file_id = excluded.photo_file_id,
       latitude = excluded.latitude, longitude = excluded.longitude, address = excluded.address,
       phone = excluded.phone, price = excluded.price, slot_minutes = excluded.slot_minutes,
       is_active = 1`).run(
    b.id, b.name, b.salon_name, b.experience, b.photo_file_id ?? null,
    b.location?.latitude ?? null, b.location?.longitude ?? null,
    b.address ?? null, b.phone ?? null, b.price ?? null, b.slot_minutes,
  );
}

const EDITABLE = new Set(['name', 'salon_name', 'experience', 'photo_file_id', 'address', 'phone', 'price', 'slot_minutes', 'is_active']);

export function updateBarber(id, field, value) {
  if (field === 'location') {
    q('UPDATE barbers SET latitude = ?, longitude = ? WHERE id = ?').run(value.latitude, value.longitude, id);
    return;
  }
  if (!EDITABLE.has(field)) throw new Error(`Noma'lum maydon: ${field}`);
  q(`UPDATE barbers SET ${field} = ? WHERE id = ?`).run(value, id);
}

/** Sartaroshlar ro'yxati: bugun ishlayotganlar birinchi. */
export function listBarbers({ date, nowHHMM, search = null, limit = 8, offset = 0 }) {
  const like = search ? `%${search}%` : null;
  const where = `b.is_active = 1 AND (?1 IS NULL OR b.name LIKE ?1 OR b.salon_name LIKE ?1 OR b.address LIKE ?1)`;
  const total = q(`SELECT COUNT(*) AS n FROM barbers b WHERE ${where}`).get(like).n;
  const rows = q(`
    SELECT b.*, w.start_time, w.end_time
    FROM barbers b
    LEFT JOIN work_days w ON w.barber_id = b.id AND w.date = ?2
    WHERE ${where}
    ORDER BY (w.end_time IS NOT NULL AND w.end_time > ?3) DESC, b.salon_name COLLATE NOCASE
    LIMIT ?4 OFFSET ?5`).all(like, date, nowHHMM, limit, offset);
  return { total, rows };
}

export function barbersWithLocation(date) {
  return q(`
    SELECT b.*, w.start_time, w.end_time
    FROM barbers b
    LEFT JOIN work_days w ON w.barber_id = b.id AND w.date = ?
    WHERE b.is_active = 1 AND b.latitude IS NOT NULL`).all(date);
}

// ---------- work days ----------

export const getWorkDay = (barberId, date) =>
  q('SELECT * FROM work_days WHERE barber_id = ? AND date = ?').get(barberId, date);

export const setWorkDay = (barberId, date, start, end) =>
  q(`INSERT INTO work_days (barber_id, date, start_time, end_time) VALUES (?, ?, ?, ?)
     ON CONFLICT(barber_id, date) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time`)
    .run(barberId, date, start, end);

export const setWorkEnd = (barberId, date, end) =>
  q('UPDATE work_days SET end_time = ? WHERE barber_id = ? AND date = ?').run(end, barberId, date);

// ---------- bookings ----------

export const ACTIVE = ['pending', 'accepted'];

export const getBooking = (id) => q('SELECT * FROM bookings WHERE id = ?').get(id);

export const activeBookingsForDate = (barberId, date) =>
  q(`SELECT * FROM bookings WHERE barber_id = ? AND date = ? AND status IN ('pending','accepted')
     ORDER BY time`).all(barberId, date);

/** Yangi navbat. Vaqt band bo'lsa null qaytaradi. */
export function createBooking(b) {
  try {
    const r = q(`INSERT INTO bookings (barber_id, client_id, client_name, client_phone, date, time, duration)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(b.barber_id, b.client_id, b.client_name, b.client_phone, b.date, b.time, b.duration);
    return Number(r.lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return null;
    throw e;
  }
}

/** Holatni faqat ruxsat etilgan eski holatdan o'zgartiradi (ikki marta bosilishdan himoya). */
export function transition(id, fromStatuses, to) {
  const ph = fromStatuses.map(() => '?').join(',');
  const r = q(`UPDATE bookings SET status = ?, updated_at = datetime('now')
               WHERE id = ? AND status IN (${ph})`).run(to, id, ...fromStatuses);
  return r.changes > 0;
}

export const clientActiveWithBarber = (clientId, barberId, date) =>
  q(`SELECT * FROM bookings WHERE client_id = ? AND barber_id = ? AND date = ?
     AND status IN ('pending','accepted')`).get(clientId, barberId, date);

export const clientUpcoming = (clientId, fromDate) =>
  q(`SELECT k.*, b.salon_name, b.name AS barber_name, b.address, b.latitude, b.longitude, b.phone AS barber_phone
     FROM bookings k JOIN barbers b ON b.id = k.barber_id
     WHERE k.client_id = ? AND k.date >= ? AND k.status IN ('pending','accepted')
     ORDER BY k.date, k.time`).all(clientId, fromDate);

export const dueReminders = (date) =>
  q(`SELECT k.*, b.salon_name, b.name AS barber_name, b.address
     FROM bookings k JOIN barbers b ON b.id = k.barber_id
     WHERE k.status = 'accepted' AND k.reminded = 0 AND k.date = ?`).all(date);

export const markReminded = (id) => q('UPDATE bookings SET reminded = 1 WHERE id = ?').run(id);

export const stalePending = (date, nowHHMM) =>
  q(`SELECT * FROM bookings WHERE status = 'pending' AND (date < ? OR (date = ? AND time <= ?))`)
    .all(date, date, nowHHMM);

// ---------- sartarosh bo'lish huquqi ----------

if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'barber_allowed'").get()) {
  db.exec('ALTER TABLE users ADD COLUMN barber_allowed INTEGER NOT NULL DEFAULT 0');
  // Oldin ro'yxatdan o'tgan sartaroshlar huquqini saqlab qoladi
  db.exec('UPDATE users SET barber_allowed = 1 WHERE id IN (SELECT id FROM barbers)');
}
db.exec(`
CREATE TABLE IF NOT EXISTS invites (
  code        TEXT PRIMARY KEY,
  created_by  INTEGER NOT NULL,
  used_by     INTEGER,
  created_at  TEXT DEFAULT (datetime('now')),
  used_at     TEXT
);
CREATE TABLE IF NOT EXISTS access_requests (
  user_id     INTEGER PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  created_at  TEXT DEFAULT (datetime('now'))
);
`);

export const isBarberAllowed = (id) => Boolean(q('SELECT barber_allowed FROM users WHERE id = ?').get(id)?.barber_allowed);
export const setBarberAllowed = (id, allowed) =>
  q('UPDATE users SET barber_allowed = ? WHERE id = ?').run(allowed ? 1 : 0, id);

export const createInvite = (code, adminId) => q('INSERT INTO invites (code, created_by) VALUES (?, ?)').run(code, adminId);
/** Taklifni ishlatadi: true — muvaffaqiyatli, false — topilmadi yoki ishlatilgan. */
export const useInvite = (code, userId) =>
  q(`UPDATE invites SET used_by = ?, used_at = datetime('now') WHERE code = ? AND used_by IS NULL`).run(userId, code).changes > 0;
export const unusedInvites = () => q('SELECT * FROM invites WHERE used_by IS NULL ORDER BY created_at DESC').all();
export const deleteInvite = (code) => q('DELETE FROM invites WHERE code = ? AND used_by IS NULL').run(code).changes > 0;

export const getAccessRequest = (userId) => q('SELECT * FROM access_requests WHERE user_id = ?').get(userId);
export const saveAccessRequest = (userId, status) =>
  q(`INSERT INTO access_requests (user_id, status) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, created_at = datetime('now')`).run(userId, status);
/** Faqat kutilayotgan so'rovni hal qiladi (ikki admin bir vaqtda bosganda himoya). */
export const resolveAccessRequest = (userId, status) =>
  q(`UPDATE access_requests SET status = ? WHERE user_id = ? AND status = 'pending'`).run(status, userId).changes > 0;

export const allBarbers = () =>
  q(`SELECT b.*, u.username, u.barber_allowed FROM barbers b JOIN users u ON u.id = b.id ORDER BY b.created_at`).all();

// ---------- foydalanuvchi qadamlari ----------

db.exec(`CREATE TABLE IF NOT EXISTS states (
  user_id    INTEGER PRIMARY KEY,
  step       TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
)`);
export const getStateRow = (userId) => q('SELECT step, data FROM states WHERE user_id = ?').get(userId);
export const saveStateRow = (userId, step, data) =>
  q(`INSERT INTO states (user_id, step, data) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET step = excluded.step, data = excluded.data, updated_at = datetime('now')`).run(userId, step, data);
export const deleteStateRow = (userId) => q('DELETE FROM states WHERE user_id = ?').run(userId);

// ---------- mini app ----------

export const activeBarbers = () => q('SELECT * FROM barbers WHERE is_active = 1').all();

// ---------- ads ----------

export const addAd = (type, fileId, title, link) =>
  Number(q('INSERT INTO ads (type, file_id, title, link) VALUES (?, ?, ?, ?)').run(type, fileId, title, link).lastInsertRowid);
export const listAds = () => q('SELECT * FROM ads WHERE active = 1 ORDER BY id DESC').all();
export const getAd = (id) => q('SELECT * FROM ads WHERE id = ?').get(id);
export const deleteAd = (id) => q('UPDATE ads SET active = 0 WHERE id = ?').run(id).changes > 0;

export const stats = () => ({
  barbers: q('SELECT COUNT(*) AS n FROM barbers').get().n,
  clients: q("SELECT COUNT(*) AS n FROM users WHERE role = 'client'").get().n,
  bookings: q('SELECT COUNT(*) AS n FROM bookings').get().n,
});

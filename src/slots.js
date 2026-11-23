import * as db from './db.js';
import { today, nowMinutes, toMin, toHHMM } from './time.js';

/**
 * Sartaroshning berilgan kundagi vaqtlari.
 * status: free (bo'sh) | pending (tasdiq kutilmoqda) | booked (band) | past (o'tib ketgan)
 */
export function buildSlots(barber, work, date) {
  if (!work) return [];
  const step = barber.slot_minutes;
  const start = toMin(work.start_time);
  const end = toMin(work.end_time);
  const bookings = db.activeBookingsForDate(barber.id, date).map((b) => ({
    ...b,
    from: toMin(b.time),
    to: toMin(b.time) + b.duration,
  }));
  const isToday = date === today();
  const now = nowMinutes();

  const out = [];
  for (let t = start; t + step <= end; t += step) {
    const hit = bookings.find((b) => b.from < t + step && t < b.to);
    let status = 'free';
    if (hit) status = hit.status === 'accepted' ? 'booked' : 'pending';
    else if (isToday && t <= now) status = 'past';
    out.push({ time: toHHMM(t), status, booking: hit ?? null });
  }
  return out;
}

export const freeSlots = (barber, work, date) => buildSlots(barber, work, date).filter((s) => s.status === 'free');

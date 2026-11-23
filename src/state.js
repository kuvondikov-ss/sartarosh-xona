// Foydalanuvchining hozirgi qadami (ro'yxatdan o'tish, vaqt kiritish va h.k.).
// Bazada saqlanadi — bot qayta ishga tushsa ham jarayon davom etadi.
import { getStateRow, saveStateRow, deleteStateRow } from './db.js';

export function getState(userId) {
  const row = getStateRow(userId);
  if (!row) return undefined;
  try {
    return { step: row.step, data: JSON.parse(row.data) };
  } catch {
    return undefined;
  }
}

export const setState = (userId, step, data = {}) => saveStateRow(userId, step, JSON.stringify(data));
export const clearState = (userId) => deleteStateRow(userId);

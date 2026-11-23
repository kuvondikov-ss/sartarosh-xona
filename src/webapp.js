// Mini app'ning hozirgi https manzili: .env dagi WEBAPP_URL yoki avtomatik tunnel manzili.
let current = null;

/** .env da qat'iy berilgan manzil (Telegram faqat https qabul qiladi). */
export const fixedAppUrl = () => {
  const u = process.env.WEBAPP_URL?.trim();
  return u && u.startsWith('https://') ? u.replace(/\/+$/, '') : null;
};

export const getAppUrl = () => current ?? fixedAppUrl();
export const setAppUrl = (url) => {
  current = url;
};

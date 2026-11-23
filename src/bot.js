import { run } from '@grammyjs/runner';
import { createBot } from './app.js';
import { startScheduler } from './handlers/bookings.js';
import { startWebServer } from './web.js';
import { startTunnel } from './tunnel.js';
import { fixedAppUrl, setAppUrl } from './webapp.js';

const token = process.env.BOT_TOKEN;
if (!token || token.includes('your-token')) {
  console.error("❌ BOT_TOKEN topilmadi. .env faylini yarating va @BotFather bergan tokenni yozing (README.md ga qarang).");
  process.exit(1);
}

const bot = createBot(token);

await bot.init();
await bot.api.deleteWebhook();
await bot.api.setMyCommands([
  { command: 'start', description: 'Bosh menyu' },
  { command: 'role', description: 'Rolni almashtirish (sartarosh / mijoz)' },
  { command: 'help', description: 'Yordam' },
]);

const port = Number(process.env.PORT || 3000);
startWebServer({ api: bot.api, token, botUsername: bot.botInfo.username, port });

// Chat pastidagi "Menu" tugmasi -> mini app
async function applyAppUrl(url) {
  setAppUrl(url);
  const text = process.env.MENU_BUTTON_TEXT?.trim() || '✂️ SartaroshXona';
  await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text, web_app: { url } } })
    .catch((e) => console.error("Menu tugmasi o'rnatilmadi:", e.description || e.message));
  console.log(`📱 Mini app Telegramda ochiladi: ${url}`);
}

let stopTunnel = null;
if (fixedAppUrl()) {
  await applyAppUrl(fixedAppUrl());
} else if (process.env.TUNNEL !== 'off') {
  console.log('🔗 Mini app uchun https tunnel ochilmoqda (localhost.run)...');
  stopTunnel = startTunnel(port, applyAppUrl);
} else {
  console.log("ℹ️ WEBAPP_URL berilmagan va TUNNEL=off — mini app Telegramda ochilmaydi.");
}

const timer = startScheduler(bot);
// Internet uzilsa ham to'xtamasdan qayta ulanaveradi
const runner = run(bot, { runner: { maxRetryTime: Infinity, retryInterval: 'exponential' } });
console.log(`✅ @${bot.botInfo.username} ishga tushdi`);

const stop = () => {
  clearInterval(timer);
  stopTunnel?.();
  const done = runner.isRunning() ? runner.stop() : Promise.resolve();
  Promise.resolve(done).finally(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

// Bepul https tunnel (localhost.run, SSH orqali) — mini app'ni Telegramdan ochish uchun.
// Manzil vaqti-vaqti bilan o'zgaradi; har o'zgarganda onUrl chaqiriladi.
import { spawn } from 'node:child_process';

const URL_RE = /https:\/\/[a-z0-9-]+(?:\.app)?\.lhr\.life/;

export function startTunnel(port, onUrl) {
  let child = null;
  let stopped = false;
  let delay = 2000;
  let last = null;

  const start = () => {
    child = spawn(
      'ssh',
      [
        '-T',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'ExitOnForwardFailure=yes',
        '-R', `80:localhost:${port}`,
        'nokey@localhost.run',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );

    const onData = (buf) => {
      const m = buf.toString().match(URL_RE);
      if (m && m[0] !== last) {
        last = m[0];
        delay = 2000;
        Promise.resolve(onUrl(last)).catch((e) => console.error('Tunnel manzilini qo\'llashda xato:', e));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (e) => {
      stopped = true;
      console.error("❌ Tunnel ishga tushmadi (kompyuterda ssh yo'qmi?):", e.message);
    });
    child.on('close', () => {
      if (stopped) return;
      console.log(`🔁 Tunnel uzildi, ${Math.round(delay / 1000)} soniyadan keyin qayta ulanadi...`);
      setTimeout(start, delay);
      delay = Math.min(delay * 2, 60000);
    });
  };

  start();
  return () => {
    stopped = true;
    child?.kill();
  };
}

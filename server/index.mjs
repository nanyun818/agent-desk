import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createStore } from './store.mjs';
import { createApp } from './app.mjs';
import { APP_VERSION } from './version.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store = createStore(), app = createApp(store);
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Run npm run build first.');
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
const preferred = Number(process.env.PORT || 4317);
let runningServer;
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  app.locals.abortRequests();
  runningServer?.close(() => { store.close(); process.exit(0); });
  setTimeout(() => { runningServer?.closeAllConnections(); store.close(); process.exit(0); }, 5000).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);
process.on('message', message => { if (message?.type === 'shutdown') shutdown(); });
if (process.send) process.once('disconnect', shutdown);
function listen(port) {
  const server = app.listen(port, '127.0.0.1', error => {
    if (error) return;
    runningServer = server;
    fs.writeFileSync(path.join(store.directory, 'runtime.json'), JSON.stringify({ pid: process.pid, port, root }), { mode: 0o600 });
    console.log(`Agent Desk: http://127.0.0.1:${port}`);
    process.send?.({ type: 'ready', app: 'agent-desk', version: APP_VERSION, port, pid: process.pid });
  });
  server.on('error', error => { if (error.code === 'EADDRINUSE' && port < preferred + 20) listen(port + 1); else { console.error(error.message); process.exitCode = 1; } });
}
listen(preferred);

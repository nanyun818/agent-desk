const { app, BrowserWindow, Menu, shell, dialog, Tray, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const createCompanion = require('./companion.cjs');

app.setName('Agent Desk');
app.setAppUserModelId('local.agentdesk.desktop');
let window, backendProcess, backendOrigin, companion, tray, quitting = false;
const root = path.dirname(__dirname);
const dataDirectory = process.env.AGENT_DESK_DATA_DIR || path.join(process.env.LOCALAPPDATA, 'AgentDesk');
if (process.env.AGENT_DESK_DATA_DIR) {
  const profile = path.join(dataDirectory, 'desktop-profile');
  fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
}
const smokeFile = process.env.AGENT_DESK_SMOKE_FILE;
function openMain() { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } }
function updateTray() {
  if (!tray || !companion) return;
  const state = companion.state();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Agent Desk · 桃铃', enabled: false }, { label: '打开工作台', click: openMain },
    { label: '显示桃铃', type: 'checkbox', checked: state.enabled, click: item => companion.setEnabled(item.checked) },
    { type: 'separator' }, { role: 'quit', label: '退出 Agent Desk' },
  ]));
}

function external(url) {
  try { if (['https:', 'http:'].includes(new URL(url).protocol)) shell.openExternal(url); } catch {}
}

async function reuseBackend() {
  try {
    const runtime = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'runtime.json'), 'utf8'));
    if (!Number.isInteger(runtime.port) || runtime.port < 1024 || runtime.port > 65535) return null;
    const origin = `http://127.0.0.1:${runtime.port}`;
    const response = await fetch(origin + '/api/bootstrap', { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    const info = await response.json();
    if (info.app === 'agent-desk' && info.processId === runtime.pid && info.version === app.getVersion() && path.resolve(info.dataDirectory).toLowerCase() === path.resolve(dataDirectory).toLowerCase()) return origin;
  } catch {}
  return null;
}

async function startBackend() {
  const reusable = await reuseBackend();
  if (reusable) return reusable;
  const backendRoot = app.isPackaged ? path.join(process.resourcesPath, 'backend') : root;
  const node = app.isPackaged ? path.join(process.resourcesPath, 'runtime', 'node.exe') : process.env.AGENT_DESK_NODE || path.join(process.env.ProgramFiles, 'nodejs', 'node.exe');
  fs.mkdirSync(dataDirectory, { recursive: true });
  const log = fs.openSync(path.join(dataDirectory, 'desktop-engine.log'), 'a');
  backendProcess = fork(path.join(backendRoot, 'server', 'index.mjs'), [], {
    execPath: node, execArgv: [], cwd: backendRoot,
    env: { ...process.env, AGENT_DESK_DATA_DIR: dataDirectory },
    windowsHide: true, stdio: ['ignore', log, log, 'ipc'],
  });
  fs.closeSync(log);
  backendProcess.on('error', () => {});
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { backendProcess?.kill(); reject(new Error('本地服务启动超时，请查看数据目录中的 desktop-engine.log')); }, 25000);
    backendProcess.once('error', error => { clearTimeout(timer); reject(error); });
    backendProcess.once('exit', code => { clearTimeout(timer); reject(new Error(`本地服务已退出（${code}），请检查 desktop-engine.log`)); });
    backendProcess.on('message', message => {
      if (message?.type === 'ready' && message.app === 'agent-desk' && message.version === app.getVersion()) { clearTimeout(timer); resolve(`http://127.0.0.1:${message.port}`); }
    });
  });
}

async function createWindow() {
  const icon = app.isPackaged ? path.join(process.resourcesPath, 'agent-desk.png') : path.join(root, 'build', 'agent-desk.png');
  window = new BrowserWindow({
    title: 'Agent Desk · 桃铃', width: 1440, height: 960, minWidth: 900, minHeight: 620,
    backgroundColor: '#ffffff', icon, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (backendOrigin && new URL(url).origin !== backendOrigin) { event.preventDefault(); external(url); } });
  const clipboardAllowed = (webContents, permission) => {
    try { return permission === 'clipboard-sanitized-write' && new URL(webContents.getURL()).origin === backendOrigin; } catch { return false; }
  };
  window.webContents.session.setPermissionCheckHandler((webContents, permission) => clipboardAllowed(webContents, permission));
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => callback(clipboardAllowed(webContents, permission)));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '打开数据目录', click: () => shell.openPath(dataDirectory) }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '视图', submenu: [{ role: 'reload', label: '刷新' }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' }, { type: 'separator' }, { id: 'taoling-visible', label: '显示桃铃桌宠', type: 'checkbox', checked: true, click: item => companion?.setEnabled(item.checked) }] },
    { label: '帮助', submenu: [{ label: `Agent Desk ${app.getVersion()}`, enabled: false }] },
  ]));
  backendOrigin = await startBackend();
  const assets = app.isPackaged ? path.join(process.resourcesPath, 'backend', 'dist', 'mascot') : path.join(root, 'public', 'mascot');
  companion = createCompanion({ dataDirectory, assets, getMain: () => window, getOrigin: () => backendOrigin, openMain, openExternal: external, onChange: state => { const item = Menu.getApplicationMenu()?.getMenuItemById('taoling-visible'); if (item) item.checked = state.enabled; updateTray(); } });
  await window.loadURL(backendOrigin);
  window.show();
  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 20, height: 20 }));
  tray.setToolTip('桃铃 · Agent Desk'); tray.on('double-click', openMain); updateTray();
  companion.start();
  if (smokeFile) fs.writeFileSync(smokeFile, JSON.stringify({ pid: process.pid, origin: backendOrigin, version: app.getVersion(), packaged: app.isPackaged, ownsBackend: Boolean(backendProcess), backendPid: backendProcess?.pid || null }));
  window.on('closed', () => { window = null; if (!quitting) app.quit(); });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(createWindow).catch(error => { dialog.showErrorBox('Agent Desk 启动失败', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting) return;
    quitting = true; companion?.dispose(); companion = null; tray?.destroy(); tray = null;
    if (!backendProcess) return;
    if (backendProcess.exitCode !== null) { backendProcess = null; return; }
    event.preventDefault();
    const child = backendProcess; backendProcess = null;
    const exited = once(child, 'exit').catch(() => {});
    if (child.connected) child.send({ type: 'shutdown' });
    Promise.race([exited, new Promise(resolve => setTimeout(resolve, 6500))]).finally(() => { if (child.exitCode === null) child.kill(); app.exit(0); });
  });
}

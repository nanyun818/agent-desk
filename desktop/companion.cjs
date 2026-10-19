const { BrowserWindow, Menu, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { normalizePet, petBounds, authorizedMain, dragPoint } = require('./companion-state.cjs');

module.exports = function createCompanion({ dataDirectory, assets, getMain, getOrigin, openMain, openExternal, onChange }) {
  const statePath = path.join(dataDirectory, 'companion.json');
  const html = path.join(__dirname, 'companion.html');
  let settings;
  try { settings = normalizePet(JSON.parse(fs.readFileSync(statePath, 'utf8'))); } catch { settings = normalizePet(); }
  let pet, quick, disposed = false, status = 'idle', statusTimer, moveTimer, bodyDrag;
  const thinkingSources = new Set();
  const handlers = [];
  const state = () => ({ enabled: settings.enabled, size: settings.size, motion: settings.motion, pats: settings.pats, status });
  const persist = () => {
    fs.mkdirSync(dataDirectory, { recursive: true });
    const temp = statePath + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(settings), { mode: 0o600 }); fs.renameSync(temp, statePath);
  };
  function publish() {
    const value = state(), main = getMain();
    if (main && !main.isDestroyed()) main.webContents.send('taoling:changed', value);
    if (pet && !pet.isDestroyed()) pet.webContents.send('taoling:changed', value);
    onChange?.(value);
  }
  function area() {
    return settings.x === null || settings.y === null ? screen.getPrimaryDisplay().workArea : screen.getDisplayNearestPoint({ x: settings.x, y: settings.y }).workArea;
  }
  function place() { if (pet && !pet.isDestroyed()) pet.setBounds(petBounds(settings, area())); }
  function finishBodyDrag() {
    if (!bodyDrag) return;
    bodyDrag = null; clearTimeout(moveTimer);
    if (pet && !pet.isDestroyed()) {
      const [x, y] = pet.getPosition();
      const work = screen.getDisplayNearestPoint({ x, y }).workArea;
      pet.setBounds(petBounds({ ...settings, x, y }, work));
      [settings.x, settings.y] = pet.getPosition(); persist();
    }
  }
  function dragBody(value) {
    if (!pet || pet.isDestroyed() || !pet.isVisible()) return false;
    if (value?.phase === 'end') { finishBodyDrag(); return true; }
    const point = dragPoint(value?.point);
    if (value.phase === 'start') { bodyDrag = { point, bounds: pet.getBounds() }; return true; }
    if (value.phase !== 'move') throw new Error('Unknown drag phase');
    if (!bodyDrag) return false;
    const work = screen.getDisplayNearestPoint(point).workArea;
    const safe = petBounds({ ...settings, x: bodyDrag.bounds.x + point.x - bodyDrag.point.x, y: bodyDrag.bounds.y + point.y - bodyDrag.point.y }, work);
    // setPosition can grow frameless windows through repeated Windows DPI rounding.
    // Always supply the configured size, never the window's previously rounded size.
    pet.setBounds(safe); return true;
  }
  function setStatus(value) {
    if (!['idle', 'thinking', 'done', 'error', 'greeting', 'petted'].includes(value)) throw new Error('Invalid companion status');
    clearTimeout(statusTimer); status = value; publish();
    if (['done', 'error', 'greeting', 'petted'].includes(value)) statusTimer = setTimeout(() => { status = thinkingSources.size ? 'thinking' : 'idle'; publish(); }, value === 'petted' ? 1600 : value === 'greeting' ? 3500 : 7000);
    return state();
  }
  function reportStatus(source, value) {
    if (!['idle', 'thinking', 'done', 'error'].includes(value)) throw new Error('Invalid status');
    if (value === 'thinking') thinkingSources.add(source); else thinkingSources.delete(source);
    return setStatus(thinkingSources.size ? 'thinking' : value);
  }
  function pat() {
    if (settings.pats < Number.MAX_SAFE_INTEGER) settings.pats++;
    persist(); return setStatus('petted');
  }
  function openChat() {
    if (disposed) return;
    if (quick && !quick.isDestroyed()) { if (quick.isMinimized()) quick.restore(); quick.show(); quick.focus(); return; }
    const work = area(), anchor = pet && !pet.isDestroyed() ? pet.getBounds() : petBounds(settings, work);
    const width = Math.min(420, work.width), height = Math.min(660, work.height);
    const x = Math.max(work.x, Math.min(anchor.x - width - 10, work.x + work.width - width));
    const y = Math.max(work.y, Math.min(anchor.y + anchor.height - height, work.y + work.height - height));
    quick = new BrowserWindow({ title: '桃铃 · 随手聊', x, y, width, height, minWidth: Math.min(360, width), minHeight: Math.min(440, height), show: false, alwaysOnTop: true, backgroundColor: '#fcf9fb', icon: path.join(assets, 'taoling-icon.png'), webPreferences: { preload: path.join(__dirname, 'quick-chat-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    quick.setMenu(null);
    quick.webContents.setWindowOpenHandler(({ url }) => { openExternal?.(url); return { action: 'deny' }; });
    quick.webContents.on('will-navigate', event => event.preventDefault());
    quick.on('close', event => { if (!disposed) { event.preventDefault(); quick.hide(); } });
    quick.webContents.on('render-process-gone', () => { thinkingSources.delete('quick'); quick.destroy(); quick = null; setStatus('error'); });
    quick.loadURL(getOrigin() + '/?companion=chat').then(() => { if (!disposed && quick && !quick.isDestroyed()) { quick.show(); quick.focus(); } }).catch(error => { console.error('Quick chat load failed:', error.message); quick?.destroy(); quick = null; setStatus('error'); });
  }
  function setEnabled(value) {
    if (typeof value !== 'boolean') throw new Error('Expected boolean');
    if (!value) finishBodyDrag();
    settings.enabled = value; persist();
    if (value) { if (!pet) create(); else pet.showInactive(); } else pet?.hide();
    publish(); return state();
  }
  function setSize(value) {
    if (!Number.isInteger(value) || value < 140 || value > 300) throw new Error('Companion size must be 140–300');
    finishBodyDrag(); settings.size = value; place(); persist(); publish(); return state();
  }
  function setMotion(value) { if (typeof value !== 'boolean') throw new Error('Expected boolean'); settings.motion = value; persist(); publish(); return state(); }
  function menu() {
    Menu.buildFromTemplate([
      { label: '桃铃 · 桌面伙伴', enabled: false },
      { label: '和桃铃聊聊', click: openChat },
      { label: '摸摸猫猫头', click: pat },
      { label: '打开 Agent Desk', click: openMain },
      { type: 'separator' },
      { label: '放大', enabled: settings.size < 300, click: () => setSize(Math.min(300, settings.size + 20)) },
      { label: '缩小', enabled: settings.size > 140, click: () => setSize(Math.max(140, settings.size - 20)) },
      { label: '轻动效果', type: 'checkbox', checked: settings.motion, click: item => setMotion(item.checked) },
      { type: 'separator' },
      { label: '隐藏桃铃', click: () => setEnabled(false) },
    ]).popup({ window: pet });
  }
  function create() {
    if (disposed || pet) return;
    const bounds = petBounds(settings, area());
    pet = new BrowserWindow({ ...bounds, title: '桃铃 · Mini', transparent: true, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, hasShadow: false, show: false, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'companion-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: 'taoling-pet', zoomFactor: 1 } });
    pet.setMenu(null);
    pet.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    pet.webContents.on('will-navigate', event => event.preventDefault());
    pet.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    pet.webContents.session.setPermissionCheckHandler(() => false);
    pet.on('close', event => { if (!disposed) { event.preventDefault(); setEnabled(false); } });
    pet.on('moved', () => {
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => {
        if (!pet || pet.isDestroyed()) return;
        const [x, y] = pet.getPosition(); settings.x = x; settings.y = y;
        const safe = petBounds(settings, area()); settings.x = safe.x; settings.y = safe.y;
        if (x !== safe.x || y !== safe.y) { pet.setBounds(safe); [settings.x, settings.y] = pet.getPosition(); }
        persist();
      }, 180);
    });
    pet.loadFile(html).then(() => { if (settings.enabled && !disposed) pet.showInactive(); }).catch(error => { console.error('Companion load failed:', error.message); settings.enabled = false; publish(); });
  }
  const isMain = event => authorizedMain(event, getMain(), getOrigin());
  const isQuick = event => authorizedMain(event, quick, getOrigin()) && new URL(event.senderFrame.url).searchParams.get('companion') === 'chat';
  const isPet = event => pet && !pet.isDestroyed() && event.sender === pet.webContents && event.senderFrame === pet.webContents.mainFrame && event.senderFrame.url === pathToFileURL(html).href;
  function handle(channel, authorize, fn) {
    ipcMain.handle(channel, (event, value) => { if (!authorize(event)) throw new Error('Untrusted companion IPC sender'); return fn(value); }); handlers.push(channel);
  }
  handle('taoling:state', isMain, state);
  handle('taoling:enabled', isMain, setEnabled);
  handle('taoling:size', isMain, setSize);
  handle('taoling:motion', isMain, setMotion);
  handle('taoling:status', isMain, value => reportStatus('main', value));
  handle('taoling:chat-status', isQuick, value => reportStatus('quick', value));
  handle('taoling:chat-action', isQuick, action => {
    if (action === 'hide') { quick.hide(); return null; }
    if (action === 'open') { openMain(); return null; }
    throw new Error('Unknown quick chat action');
  });
  handle('taoling:pet-config', isPet, () => ({ state: state(), image: pathToFileURL(path.join(assets, 'taoling-mini.png')).href, happyImage: pathToFileURL(path.join(assets, 'taoling-mini-happy.png')).href, icons: Object.fromEntries(['menu', 'close', 'open', 'greet', 'chat', 'drag', 'hand'].map(name => [name, pathToFileURL(path.join(assets, name + '.svg')).href])) }));
  handle('taoling:pet-drag', isPet, dragBody);
  handle('taoling:pet-action', isPet, action => {
    if (action === 'hide') return setEnabled(false);
    if (action === 'menu') { menu(); return null; }
    if (action === 'open') { openMain(); return null; }
    if (action === 'greet') return setStatus('greeting');
    if (action === 'pat') return pat();
    if (action === 'chat') { openChat(); return null; }
    throw new Error('Unknown companion action');
  });
  const displayChange = () => { finishBodyDrag(); place(); };
  screen.on('display-metrics-changed', displayChange); screen.on('display-removed', displayChange);
  return {
    start() { if (settings.enabled) create(); publish(); }, state, setEnabled, setSize, setMotion, setStatus,
    dispose() { disposed = true; clearTimeout(statusTimer); clearTimeout(moveTimer); screen.removeListener('display-metrics-changed', displayChange); screen.removeListener('display-removed', displayChange); for (const channel of handlers) ipcMain.removeHandler(channel); if (quick && !quick.isDestroyed()) quick.destroy(); quick = null; if (pet && !pet.isDestroyed()) { const [x, y] = pet.getPosition(); settings.x = x; settings.y = y; persist(); pet.destroy(); } pet = null; },
  };
};

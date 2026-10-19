const DEFAULT_PET = Object.freeze({ enabled: true, size: 190, motion: true, x: null, y: null, pats: 0 });
function normalizePet(value = {}) {
  const size = Number.isFinite(value.size) ? Math.round(Math.min(300, Math.max(140, value.size))) : DEFAULT_PET.size;
  return { enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_PET.enabled, size, motion: typeof value.motion === 'boolean' ? value.motion : DEFAULT_PET.motion, x: Number.isFinite(value.x) ? Math.round(value.x) : null, y: Number.isFinite(value.y) ? Math.round(value.y) : null, pats: Number.isSafeInteger(value.pats) && value.pats >= 0 ? value.pats : 0 };
}
function petBounds(settings, area) {
  const width = Math.min(settings.size + 32, area.width), height = Math.min(settings.size + 86, area.height);
  const x = settings.x ?? area.x + area.width - width - 28, y = settings.y ?? area.y + area.height - height - 18;
  return { x: Math.round(Math.min(Math.max(area.x, x), area.x + area.width - width)), y: Math.round(Math.min(Math.max(area.y, y), area.y + area.height - height)), width, height };
}
function authorizedMain(event, window, origin) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
  try { return new URL(event.senderFrame.url).origin === origin; } catch { return false; }
}
function dragPoint(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || Math.abs(value.x) > 10000000 || Math.abs(value.y) > 10000000) throw new Error('Invalid drag coordinates');
  return { x: Math.round(value.x), y: Math.round(value.y) };
}
module.exports = { DEFAULT_PET, normalizePet, petBounds, authorizedMain, dragPoint };

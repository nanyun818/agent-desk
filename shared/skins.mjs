export const SKIN_FORMAT = 'agent-desk-skin';
export const BUILTIN_SKINS = [
  { id: 'taoling', name: '桃铃 · 午后小憩', subtitle: '暖光全景 · 桃桃', appearance: 'light', layout: 'standard', wallpaper: '/wallpapers/taoling-catnap.webp', seeds: { accent: '#a84270', secondary: '#287b74', surface: '#f8eff3', text: '#352a33' } },
  { id: 'anime-rin', name: '凛 · 机能工坊', subtitle: '二次元 · 银白青', appearance: 'light', layout: 'character', wallpaper: '/wallpapers/anime-rin.webp', seeds: { accent: '#207b85', secondary: '#b65d53', surface: '#edf5f6', text: '#21333b' } },
  { id: 'alpine', name: '云岫', subtitle: '山湖 · 通透', appearance: 'light', wallpaper: '/wallpapers/alpine.webp', seeds: { accent: '#206c61', secondary: '#c59854', surface: '#edf4f2', text: '#202d31' } },
  { id: 'studio', name: '留白', subtitle: '纸白 · 专注', appearance: 'light', seeds: { accent: '#286e62', secondary: '#aa7650', surface: '#f3f5f6', text: '#252c32' } },
  { id: 'graphite', name: '墨夜', subtitle: '石墨 · 琥珀', appearance: 'dark', seeds: { accent: '#e6b66f', secondary: '#79c8b7', surface: '#202123', text: '#eeeff0' } },
  { id: 'rose', name: '花信', subtitle: '柔粉 · 银灰', appearance: 'light', seeds: { accent: '#a63f70', secondary: '#4f8e90', surface: '#f7f0f4', text: '#352b33' } },
  { id: 'glacier', name: '琉光', subtitle: '冰青 · 机能', appearance: 'light', seeds: { accent: '#247b88', secondary: '#8a586c', surface: '#e7f5f7', text: '#21353a' } },
  { id: 'terminal', name: '终端', subtitle: '字符 · 极简', appearance: 'dark', seeds: { accent: '#7bd9aa', secondary: '#e0ad78', surface: '#1c2220', text: '#e1ede5' } },
  // Pure color seed data adapted under MIT; see THIRD_PARTY_NOTICES.md.
  { id: 'classic-blue', name: '经典水晶蓝', subtitle: 'Harness 配色适配', appearance: 'light', source: 'HeiGeAi · MIT', seeds: { accent: '#1e6eb5', secondary: '#0b3c6d', surface: '#c3d5e6', text: '#1a1a1a' } },
  { id: 'classic-pink', name: '经典水晶粉', subtitle: 'Harness 配色适配', appearance: 'light', source: 'HeiGeAi · MIT', seeds: { accent: '#c8447e', secondary: '#d98bb0', surface: '#f6e2ec', text: '#2b1020' } },
];
export const DEFAULT_APPEARANCE = { skinId: 'taoling', mode: 'light', density: 'comfortable', fontSize: 14, accent: '', wallpaper: { type: 'skin' }, opacity: 84, blur: 0, glassBlur: 0, dim: 0, customSkins: [] };
const colorPattern = /^#[0-9a-f]{6}$/i;
export const isColor = value => typeof value === 'string' && colorPattern.test(value);
const rgb = color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
export function mix(a, b, ratio) { return '#' + rgb(a).map((v, i) => Math.round(v * (1 - ratio) + rgb(b)[i] * ratio).toString(16).padStart(2, '0')).join(''); }
export function luminance(color) { const c = rgb(color).map(v => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; }
export function contrast(a, b) { const l = [luminance(a), luminance(b)].sort((x, y) => y - x); return (l[0] + .05) / (l[1] + .05); }
export function readable(color, background, minimum = 4.5) {
  if (contrast(color, background) >= minimum) return color;
  const target = contrast('#ffffff', background) > contrast('#17191c', background) ? '#ffffff' : '#17191c';
  for (let step = 1; step <= 100; step++) { const next = mix(color, target, step / 100); if (contrast(next, background) >= minimum) return next; }
  return target;
}
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function normalizeSkin(input) {
  if (!object(input)) throw new Error('皮肤包必须是 JSON 对象');
  if (input.format && (input.format !== SKIN_FORMAT || input.version !== 1)) throw new Error('不支持此皮肤包版本');
  const raw = input.format ? input.skin : input;
  if (!object(raw) || !object(raw.seeds)) throw new Error('需要 Agent Desk 皮肤包或 Harness seeds 配色 JSON');
  if (['script', 'scripts', 'css', 'html', 'javascript', 'tokens'].some(key => Object.hasOwn(raw, key))) throw new Error('不接受脚本、CSS 或可执行插件，只支持配色数据');
  const name = typeof raw.name === 'string' ? raw.name : raw.name?.zh || raw.name?.en;
  if (typeof name !== 'string' || !name.trim() || name.length > 50) throw new Error('皮肤名称需要 1–50 个字符');
  const seeds = {};
  for (const key of ['accent', 'secondary', 'surface', 'text']) { if (!isColor(raw.seeds[key])) throw new Error(`配色 ${key} 需要 #RRGGBB 格式`); seeds[key] = raw.seeds[key].toLowerCase(); }
  if (!['light', 'dark'].includes(raw.appearance)) throw new Error('皮肤 appearance 需要 light 或 dark');
  if (raw.layout !== undefined && !['standard', 'character', 'mascot'].includes(raw.layout)) throw new Error('不支持此皮肤布局');
  return { name: name.trim(), appearance: raw.appearance, seeds, ...(raw.layout ? { layout: raw.layout } : {}) };
}
export function normalizeAppearance(input) {
  if (!object(input)) throw new Error('外观配置无效');
  const customSkins = input.customSkins || [];
  if (!Array.isArray(customSkins) || customSkins.length > 24) throw new Error('最多保存 24 套自定义皮肤');
  const skins = customSkins.map(skin => {
    if (!/^user-[a-z0-9-]{1,60}$/.test(skin.id || '')) throw new Error('自定义皮肤 ID 无效');
    return { ...normalizeSkin(skin), id: skin.id, subtitle: '自定义配色' };
  });
  if (new Set(skins.map(s => s.id)).size !== skins.length) throw new Error('自定义皮肤 ID 重复');
  if (![...BUILTIN_SKINS, ...skins].some(s => s.id === input.skinId)) throw new Error('皮肤不存在');
  if (!['light', 'dark', 'system'].includes(input.mode) || !['comfortable', 'compact'].includes(input.density)) throw new Error('外观模式无效');
  const value = { skinId: input.skinId, mode: input.mode, density: input.density, customSkins: skins };
  for (const [key, min, max] of [['fontSize', 13, 18], ['opacity', 70, 100], ['blur', 0, 16], ['dim', 0, 60]]) {
    if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw new Error(`${key} 超出有效范围`);
    value[key] = input[key];
  }
  value.glassBlur = input.glassBlur ?? DEFAULT_APPEARANCE.glassBlur;
  if (!Number.isInteger(value.glassBlur) || value.glassBlur < 0 || value.glassBlur > 30) throw new Error('玻璃模糊度超出有效范围');
  if (input.accent && !isColor(input.accent)) throw new Error('强调色无效');
  value.accent = input.accent || '';
  if (!object(input.wallpaper) || !['skin', 'none', 'custom'].includes(input.wallpaper.type)) throw new Error('壁纸类型无效');
  value.wallpaper = { type: input.wallpaper.type };
  if (input.wallpaper.type === 'custom') {
    if (typeof input.wallpaper.dataURL !== 'string' || input.wallpaper.dataURL.length > 2800000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(input.wallpaper.dataURL)) throw new Error('仅支持不超过 2 MB 的 PNG、JPEG 或 WebP 壁纸');
    value.wallpaper.dataURL = input.wallpaper.dataURL;
    value.wallpaper.name = typeof input.wallpaper.name === 'string' ? input.wallpaper.name.slice(0, 100) : '自定义壁纸';
  }
  return value;
}
export function resolveSkin(settings) { return [...BUILTIN_SKINS, ...(settings.customSkins || [])].find(s => s.id === settings.skinId) || BUILTIN_SKINS[0]; }
export function skinTokens(skin, dark, accentOverride = '') {
  const seed = skin.seeds;
  const surface = dark ? mix('#1b1c1e', seed.surface, skin.appearance === 'dark' ? .55 : .04) : mix('#ffffff', seed.surface, .25);
  const sidebar = dark ? mix(surface, '#000000', .15) : mix('#f2f4f6', seed.surface, .28);
  const text = readable(dark ? '#e5e7eb' : seed.text, surface, 10);
  const accent = readable(accentOverride || seed.accent, surface, 4.5);
  const muted = readable(mix(text, surface, .43), surface, 4.5);
  const line = mix(text, surface, .85), soft = dark ? mix(surface, '#ffffff', .045) : mix(surface, '#e3e8ec', .35);
  return { surface, sidebar, text, muted, line, soft, accent, secondary: readable(seed.secondary, surface), onAccent: contrast('#ffffff', accent) >= contrast('#141619', accent) ? '#ffffff' : '#141619', selected: mix(surface, accent, dark ? .17 : .09), code: dark ? mix(surface, '#000000', .23) : '#f1f3f6' };
}
export function wallpaperUrl(settings) { return settings.wallpaper.type === 'none' ? '' : settings.wallpaper.type === 'custom' ? settings.wallpaper.dataURL : resolveSkin(settings).wallpaper || ''; }
export function exportSkin(settings) { const skin = resolveSkin(settings); return { format: SKIN_FORMAT, version: 1, skin: { name: skin.name, appearance: skin.appearance, ...(skin.layout ? { layout: skin.layout } : {}), seeds: { ...skin.seeds, ...(settings.accent ? { accent: settings.accent } : {}) } }, wallpaper: settings.wallpaper.type === 'custom' ? settings.wallpaper : { type: 'none' } }; }

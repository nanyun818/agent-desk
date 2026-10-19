import { DEFAULT_APPEARANCE, normalizeAppearance } from '../shared/skins.mjs';
import { now } from './store.mjs';

function checked(value) {
  const data = normalizeAppearance(value);
  if (data.wallpaper.type === 'custom') {
    const [header, content] = data.wallpaper.dataURL.split(',');
    const bytes = Buffer.from(content, 'base64');
    const valid = header.includes('image/png') ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : header.includes('image/jpeg') ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid || bytes.length > 2097152) throw new Error('壁纸内容或文件大小无效');
  }
  return data;
}
export function readAppearance(store) {
  const saved = store.get('settings', 'appearance');
  if (saved) { try { return checked(saved.value); } catch {} }
  return structuredClone(DEFAULT_APPEARANCE);
}
export function saveAppearance(store, input) {
  let value; try { value = checked(input); } catch (error) { error.status = 400; throw error; }
  store.put('settings', { id: 'appearance', value, updatedAt: now() }); return value;
}

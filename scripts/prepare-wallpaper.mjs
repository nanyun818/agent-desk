import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (!process.argv[2]) throw new Error('Pass the generated wallpaper path.');
const name = process.argv[3] || 'alpine';
if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid wallpaper name.');
await fs.mkdir(path.join(root, 'public', 'wallpapers'), { recursive: true });
await sharp(process.argv[2]).resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 90 }).toFile(path.join(root, 'public', 'wallpapers', name + '.webp'));
console.log('Original wallpaper prepared.');

import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [scene, happy] = process.argv.slice(2);
if (!scene || !happy) throw new Error('Pass the warm studio and happy mini source image paths.');
await sharp(scene).resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 91 }).toFile(path.join(root, 'public/wallpapers/taoling-catnap.webp'));
await sharp(happy).resize({ height: 512, withoutEnlargement: true }).png().toFile(path.join(root, 'public/mascot/taoling-mini-happy.png'));
console.log('Full-window catnap wallpaper and transparent head-pat expression prepared.');

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MoreHorizontal, X, ArrowUpRight, Heart, MessageCircle, Grip, Hand } from 'lucide-react';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [standing, avatar] = process.argv.slice(2);
if (!standing || !avatar) throw new Error('Pass the approved standing illustration and avatar image paths.');
const target = path.join(root, 'public', 'mascot');
await fs.mkdir(target, { recursive: true });
await sharp(standing).resize({ height: 1920, withoutEnlargement: true }).webp({ quality: 91 }).toFile(path.join(root, 'public', 'wallpapers', 'taoling.webp'));
await sharp(avatar).resize(512, 512, { fit: 'contain', background: '#f7edf1' }).webp({ quality: 93 }).toFile(path.join(target, 'taoling-avatar.webp'));
await sharp(avatar).resize(256, 256, { fit: 'contain', background: '#f7edf1' }).png().toFile(path.join(target, 'taoling-icon.png'));
await sharp(path.join(root, 'design', 'mascot', 'pink-maid-concept-01', 'mini-pet.png')).resize({ height: 512, withoutEnlargement: true }).png().toFile(path.join(target, 'taoling-mini.png'));
for (const [name, icon] of [['menu', MoreHorizontal], ['close', X], ['open', ArrowUpRight], ['greet', Heart], ['chat', MessageCircle], ['drag', Grip], ['hand', Hand]]) await fs.writeFile(path.join(target, name + '.svg'), renderToStaticMarkup(React.createElement(icon, { size: 18, color: '#614450', strokeWidth: 1.8 })));
console.log('Taoling brand, illustration and transparent mini assets prepared.');

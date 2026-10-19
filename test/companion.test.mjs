import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createBodyGesture } from '../desktop/body-gesture.mjs';
const require = createRequire(import.meta.url);
const { normalizePet, petBounds, authorizedMain, dragPoint } = require('../desktop/companion-state.cjs');

test('body gesture distinguishes click jitter, dragging, returning to origin and cancellation', () => {
  const gesture = createBodyGesture();
  assert.equal(gesture.begin({ pointerId: 1, x: 100, y: 200 }), true);
  assert.equal(gesture.move({ pointerId: 1, x: 103, y: 202 }).dragging, false);
  assert.deepEqual(gesture.finish(1), { dragged: false, cancelled: false });
  gesture.begin({ pointerId: 1, x: 100, y: 200 });
  assert.equal(gesture.move({ pointerId: 1, x: 106, y: 200 }).started, true);
  assert.equal(gesture.move({ pointerId: 1, x: 100, y: 200 }).dragging, true);
  assert.deepEqual(gesture.finish(1), { dragged: true, cancelled: false });
  gesture.begin({ pointerId: 1, x: -100, y: 0 });
  assert.equal(gesture.move({ pointerId: 2, x: 500, y: 500 }), null);
  assert.equal(gesture.finish(2), null);
  assert.deepEqual(gesture.finish(1, true), { dragged: false, cancelled: true });
  assert.equal(gesture.pointerId, null);
  assert.equal(gesture.begin({ pointerId: 1, x: Infinity, y: 0 }), false);
});

test('drag IPC accepts finite signed coordinates and rejects unsafe values', () => {
  assert.deepEqual(dragPoint({ x: -800.4, y: 100.8 }), { x: -800, y: 101 });
  for (const value of [null, {}, { x: NaN, y: 0 }, { x: Infinity, y: 0 }, { x: '20', y: 30 }, { x: 10000001, y: 0 }]) assert.throws(() => dragPoint(value), /coordinates/);
});

test('companion preferences whitelist fields, clamp dimensions and ignore invalid saved data', () => {
  assert.deepEqual(normalizePet({ size: Infinity, x: 'evil', y: NaN, enabled: 'yes', motion: false, executable: 'untrusted' }), { enabled: true, size: 190, motion: false, x: null, y: null, pats: 0 });
  assert.equal(normalizePet({ size: 9000 }).size, 300); assert.equal(normalizePet({ size: -100 }).size, 140);
});
test('head pat counts preserve valid totals and reject corrupt counters', () => {
  assert.equal(normalizePet({ pats: 123 }).pats, 123);
  for (const pats of [-1, 1.3, '99', Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(normalizePet({ pats }).pats, 0);
});
test('companion bounds remain inside primary and negative-coordinate monitor work areas', () => {
  for (const area of [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -1280, y: -100, width: 1280, height: 720 }, { x: 0, y: 0, width: 200, height: 180 }]) {
    for (const point of [{ x: -99999, y: 99999 }, { x: null, y: null }, { x: 99999, y: -99999 }]) {
      const box = petBounds(normalizePet({ ...point, size: 300 }), area);
      assert.ok(box.x >= area.x && box.y >= area.y);
      assert.ok(box.x + box.width <= area.x + area.width && box.y + box.height <= area.y + area.height);
    }
  }
});
test('companion main bridge rejects other windows, frames and remote origins', () => {
  const frame = { url: 'http://127.0.0.1:4317/' }, contents = { mainFrame: frame }, window = { isDestroyed: () => false, webContents: contents };
  assert.equal(authorizedMain({ sender: contents, senderFrame: frame }, window, 'http://127.0.0.1:4317'), true);
  assert.equal(authorizedMain({ sender: {}, senderFrame: frame }, window, 'http://127.0.0.1:4317'), false);
  assert.equal(authorizedMain({ sender: contents, senderFrame: { ...frame } }, window, 'http://127.0.0.1:4317'), false);
  frame.url = 'https://untrusted.example/';
  assert.equal(authorizedMain({ sender: contents, senderFrame: frame }, window, 'http://127.0.0.1:4317'), false);
});
test('Taoling mini and standing art preserve transparency and avatar is a square brand asset', async () => {
  const mini = await sharp(fileURLToPath(new URL('../public/mascot/taoling-mini.png', import.meta.url))).metadata();
  const art = await sharp(fileURLToPath(new URL('../public/wallpapers/taoling.webp', import.meta.url))).metadata();
  const avatar = await sharp(fileURLToPath(new URL('../public/mascot/taoling-icon.png', import.meta.url))).metadata();
  assert.equal(mini.hasAlpha, true); assert.equal(art.hasAlpha, true); assert.equal(avatar.width, avatar.height);
  const happy = await sharp(fileURLToPath(new URL('../public/mascot/taoling-mini-happy.png', import.meta.url))).metadata();
  const scene = await sharp(fileURLToPath(new URL('../public/wallpapers/taoling-catnap.webp', import.meta.url))).metadata();
  assert.equal(happy.hasAlpha, true); assert.ok(scene.width / scene.height > 1.7);
});

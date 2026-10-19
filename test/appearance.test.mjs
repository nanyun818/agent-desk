import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BUILTIN_SKINS, DEFAULT_APPEARANCE, normalizeAppearance, normalizeSkin, skinTokens, contrast, exportSkin } from '../shared/skins.mjs';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { readAppearance } from '../server/appearance.mjs';

test('all built-in skins meet text, muted, accent and button contrast in both schemes', () => {
  assert.equal(BUILTIN_SKINS.length, 10);
  for (const skin of BUILTIN_SKINS) for (const dark of [false, true]) for (const accent of ['', '#fffffe', '#000001']) {
    const t = skinTokens(skin, dark, accent);
    assert.ok(contrast(t.text, t.surface) >= 10, skin.id + ' text');
    assert.ok(contrast(t.muted, t.surface) >= 4.5, skin.id + ' muted');
    assert.ok(contrast(t.accent, t.surface) >= 4.5, skin.id + ' accent');
    assert.ok(contrast(t.onAccent, t.accent) >= 4.5, skin.id + ' button');
  }
});

test('Harness seed JSON imports data only and Agent Desk palettes round-trip', () => {
  const skin = normalizeSkin({ id: 'qq-2008', name: { zh: 'Test pink' }, appearance: 'light', seeds: BUILTIN_SKINS.at(-1).seeds, font: 'untrusted font', background: 'https://untrusted.example/bg.svg' });
  assert.deepEqual(Object.keys(skin).sort(), ['appearance', 'name', 'seeds']);
  assert.equal(skin.name, 'Test pink');
  assert.deepEqual(normalizeSkin(exportSkin(DEFAULT_APPEARANCE)).seeds, BUILTIN_SKINS[0].seeds);
  assert.equal(normalizeSkin(exportSkin(DEFAULT_APPEARANCE)).layout, 'standard');
  assert.throws(() => normalizeSkin({ ...skin, layout: 'javascript:alert(1)' }), /布局/);
  assert.throws(() => normalizeSkin({ ...skin, script: 'alert(1)' }), /脚本/);
  assert.throws(() => normalizeSkin({ ...skin, seeds: { ...skin.seeds, accent: 'url(https://untrusted.example/)' } }), /RRGGBB/);
  assert.throws(() => normalizeSkin({ format: 'agent-desk-skin', version: 2, skin }), /版本/);
  assert.throws(() => normalizeSkin({ tokens: { color: '#fff' } }), /seeds/);
});

test('appearance rejects unsafe assets, unknown themes, bounds and duplicate IDs', () => {
  assert.deepEqual(normalizeAppearance(DEFAULT_APPEARANCE), DEFAULT_APPEARANCE);
  for (const dataURL of ['https://untrusted.example/wallpaper.png', 'file:///C:/secret', 'data:image/svg+xml;base64,PHN2Zz4=']) assert.throws(() => normalizeAppearance({ ...DEFAULT_APPEARANCE, wallpaper: { type: 'custom', dataURL } }));
  assert.throws(() => normalizeAppearance({ ...DEFAULT_APPEARANCE, skinId: '../x' }));
  assert.throws(() => normalizeAppearance({ ...DEFAULT_APPEARANCE, opacity: 20 }));
  const custom = { ...normalizeSkin(BUILTIN_SKINS[1]), id: 'user-test' };
  assert.throws(() => normalizeAppearance({ ...DEFAULT_APPEARANCE, customSkins: [custom, custom] }), /重复/);
});

test('appearance API persists in the local database and validates wallpaper magic without exposing provider secrets', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-desk-appearance-'));
  const store = createStore(directory), app = createApp(store, { noExternalCredentials: true });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close();
    const target = path.resolve(directory); if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('agent-desk-appearance-')) throw Error('Invalid cleanup target');
    await fs.rm(target, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api`, boot = await (await fetch(base + '/bootstrap')).json();
  const headers = { 'Content-Type': 'application/json', 'x-agent-token': boot.token };
  assert.equal((await fetch(base + '/appearance')).status, 403);
  assert.equal((await fetch(base + '/appearance', { headers: { ...headers, origin: 'https://untrusted.example' } })).status, 403);
  const request = body => fetch(base + '/appearance', { method: 'PUT', headers, body: JSON.stringify(body) });
  const original = await (await fetch(base + '/appearance', { headers })).json();
  assert.deepEqual(original, DEFAULT_APPEARANCE);
  const value = { ...original, skinId: 'graphite', mode: 'dark', opacity: 81, fontSize: 17 };
  assert.equal((await request(value)).status, 200);
  const secondStore = createStore(directory); assert.deepEqual(readAppearance(secondStore), value); secondStore.close();
  const malicious = { ...value, wallpaper: { type: 'custom', dataURL: 'data:image/png;base64,' + Buffer.from('<svg onload="alert(1)">').toString('base64') } };
  assert.equal((await request(malicious)).status, 400);
  assert.deepEqual(readAppearance(store), value);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6EegAAAAASUVORK5CYII=';
  assert.equal((await request({ ...value, wallpaper: { type: 'custom', name: 'local.png', dataURL: png } })).status, 200);
  store.put('provider', { id: 'private-test', secret: store.encrypt('never-export-this-key') });
  const result = await (await fetch(base + '/appearance', { headers })).text();
  assert.ok(!result.includes('never-export-this-key')); assert.ok(!result.includes('secret'));
});

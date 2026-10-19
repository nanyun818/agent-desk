import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(process.env.AGENT_DESK_PLAYWRIGHT, 'package.json'));
const { _electron } = require('playwright-core');
const data = await fs.mkdtemp(path.join(root, 'output/playwright/size-diagnostic-'));
const env = { ...process.env, AGENT_DESK_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
const desktop = await _electron.launch({ executablePath: process.argv[2], env });
try {
  const main = await desktop.firstWindow();
  await main.getByRole('button', { name: '外观与皮肤', exact: true }).waitFor();
  let pet;
  for (let n = 0; n < 50 && !pet; n++) { pet = desktop.windows().find(win => win.url().endsWith('/companion.html')); if (!pet) await new Promise(resolve => setTimeout(resolve, 100)); }
  await pet.waitForFunction(() => document.getElementById('portrait').naturalWidth > 200);
  await main.evaluate(() => window.agentDeskDesktop.setCompanionMotion(false));
  const snapshot = () => desktop.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.getTitle() === '桃铃 · Mini');
    return { bounds: win.getBounds(), content: win.getContentBounds(), zoom: win.webContents.getZoomFactor(), monitors: screen.getAllDisplays().map(display => ({ bounds: display.bounds, scale: display.scaleFactor })) };
  });
  const verify = process.argv.includes('--verify');
  const trace = [await snapshot()];
  for (const size of verify ? [140, 190, 230, 300] : [190]) {
  await main.evaluate(value => window.agentDeskDesktop.setCompanionSize(value), size);
  for (let i = 0; i < (verify ? 20 : 12); i++) {
    const b = await pet.locator('#chat-body').boundingBox(), x = b.x + b.width * .5, y = b.y + b.height * .82;
    await pet.mouse.move(x, y); await pet.mouse.down();
    await pet.mouse.move(x + (i % 2 ? 35 : -35), y - 12, { steps: 8 }); await pet.mouse.up();
    await pet.waitForFunction(() => document.getElementById('pet').dataset.dragging !== 'yes');
    const current = await snapshot(); trace.push({ configuredSize: size, ...current });
    if (verify) {
      assert.equal(current.zoom, 1);
      assert.ok(Math.abs(current.content.width - (size + 32)) <= 2, 'Dragging must not accumulate window width.');
      assert.ok(Math.abs(current.content.height - (size + 86)) <= 2, 'Dragging must not accumulate window height.');
      assert.equal((await main.evaluate(() => window.agentDeskDesktop.getCompanionState())).size, size);
      assert.equal(desktop.windows().some(win => win.url().includes('companion=chat')), false);
    }
  }
  }
  console.log(verify ? JSON.stringify({ passed: true, drags: trace.length - 1, sizes: [140, 190, 230, 300], monitors: trace[0].monitors, maximumSizeError: Math.max(...trace.slice(1).map(item => Math.max(Math.abs(item.content.width - item.configuredSize - 32), Math.abs(item.content.height - item.configuredSize - 86)))) }, null, 2) : JSON.stringify(trace, null, 2));
  await fs.writeFile(path.join(data, 'size-trace.json'), JSON.stringify(trace, null, 2));
} finally { await desktop.close(); }

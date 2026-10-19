import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stage = path.join(root, '.desktop-stage'), backend = path.join(stage, 'backend'), runtime = path.join(stage, 'runtime');
if (Number(process.versions.node.split('.')[0]) < 24 || process.platform !== 'win32') throw new Error('Windows Node.js 24+ is required for this Windows build.');
for (const directory of [backend, runtime, path.join(root, 'build')]) await fs.mkdir(directory, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const dependencyNames = ['@anthropic-ai/sdk', 'diff', 'express', 'ignore', 'openai'];
const dependencies = Object.fromEntries(dependencyNames.map(name => [name, manifest.dependencies[name]]));
await fs.writeFile(path.join(backend, 'package.json'), JSON.stringify({ name: 'agent-desk-engine', version: manifest.version, private: true, type: 'module', dependencies }, null, 2));
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
execFileSync(process.execPath, [npmCli, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: backend, stdio: 'inherit', windowsHide: true });
for (const name of ['server', 'dist', 'shared']) {
  const target = path.resolve(backend, name);
  if (path.dirname(target) !== path.resolve(root, '.desktop-stage', 'backend')) throw new Error('Invalid desktop staging path.');
  await fs.rm(target, { recursive: true, force: true });
}
await fs.cp(path.join(root, 'server'), path.join(backend, 'server'), { recursive: true });
await fs.cp(path.join(root, 'shared'), path.join(backend, 'shared'), { recursive: true });
await fs.cp(path.join(root, 'dist'), path.join(backend, 'dist'), { recursive: true });
await fs.copyFile(path.join(root, 'LICENSE'), path.join(backend, 'LICENSE'));
await fs.copyFile(path.join(root, 'ASSETS.md'), path.join(backend, 'ASSETS.md'));
await fs.copyFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(backend, 'THIRD_PARTY_NOTICES.md'));
await fs.copyFile(process.execPath, path.join(runtime, 'node.exe'));
const licenseUrl = `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`;
const licensePath = path.join(runtime, 'NODE-LICENSE.txt');
try {
  const licenseResponse = await fetch(licenseUrl, { signal: AbortSignal.timeout(15000) });
  if (!licenseResponse.ok) throw new Error('Unable to retrieve the bundled Node.js license.');
  await fs.writeFile(licensePath, await licenseResponse.text());
} catch {
  // Windows' downloader also supports the user's system proxy configuration.
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; Invoke-WebRequest -UseBasicParsing -Uri ${quote(licenseUrl)} -OutFile ${quote(licensePath)} -TimeoutSec 30`], { stdio: 'inherit', windowsHide: true, timeout: 40000 });
}
const png = await sharp(path.join(root, 'public', 'mascot', 'taoling-icon.png')).resize(256, 256).png().toBuffer();
await fs.writeFile(path.join(root, 'build', 'agent-desk.png'), png);
await fs.writeFile(path.join(root, 'build', 'agent-desk.ico'), await pngToIco(png));
console.log('Desktop assets and standalone backend prepared.');

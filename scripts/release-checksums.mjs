import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.resolve(process.argv[2] || path.join(root, 'release'));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const name = `Agent-Desk-Setup-${version}-x64.exe`;
const installer = path.join(directory, name);
if (!(await stat(installer)).isFile()) throw new Error('Installer is not a regular file.');
const hash = createHash('sha256');
for await (const chunk of createReadStream(installer)) hash.update(chunk);
await writeFile(path.join(directory, 'SHA256SUMS.txt'), `${hash.digest('hex')}  ${name}\n`);
console.log(`SHA256SUMS.txt generated for ${name}`);

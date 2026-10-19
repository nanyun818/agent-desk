import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const sections = [];
const pending = ['react', 'react-dom', 'lucide-react', 'react-markdown', 'remark-gfm'].map(name => `node_modules/${name}`);
const visited = new Set();
function dependencyLocation(location, name) {
  let base = location;
  for (;;) {
    const candidate = path.posix.join(base, 'node_modules', name);
    if (lock.packages[candidate]) return candidate;
    if (!base) throw new Error(`Cannot resolve license dependency ${name} from ${location}`);
    base = base.replace(/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+$/, '');
  }
}
while (pending.length) {
  const location = pending.shift();
  if (visited.has(location)) continue;
  visited.add(location);
  const entry = lock.packages[location];
  const directory = path.join(root, location);
  let names;
  try { names = await readdir(directory); } catch (error) {
    if (error.code === 'ENOENT' && entry.optional) continue;
    throw error;
  }
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  for (const name of Object.keys(manifest.dependencies || {})) pending.push(dependencyLocation(location, name));
  const licenseFiles = names.filter(name => /^(?:licen[cs]e|copying)(?:[._-].*)?$/i.test(name)).sort();
  if (!licenseFiles.length) throw new Error(`Missing license text for ${manifest.name}`);
  const texts = await Promise.all(licenseFiles.map(async name => `${name}\n${await readFile(path.join(directory, name), 'utf8')}`));
  sections.push(`${manifest.name} ${manifest.version} (${manifest.license || entry.license || 'see license text'})\n${texts.join('\n')}`);
}
await writeFile(path.join(root, 'dist', 'THIRD_PARTY_LICENSES.txt'), sections.join('\n\n' + '='.repeat(72) + '\n\n'));
console.log(`Collected license texts for ${sections.length} frontend dependencies.`);

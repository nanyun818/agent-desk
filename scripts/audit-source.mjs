import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
if (!files.length) throw new Error('No tracked source files to audit.');
const forbidden = /(^|\/)(node_modules|\.data|\.desktop-stage|output|release|build|dist|\.playwright-cli)(\/|$)|(^|\/)\.env(?:\.|$)|\.(?:db|sqlite3?|key|pem|pfx|exe|blockmap)$/i;
const secrets = /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const privatePath = /[A-Z]:\\{1,2}Users\\{1,2}[^\\\s"']+\\|\/(?:Users|home)\/[^/\s"']+\//i;
const findings = [];
let bytes = 0;
for (const name of files) {
  const fullPath = path.join(root, name);
  const info = await stat(fullPath);
  bytes += info.size;
  if (forbidden.test(name) && name !== '.env.example') findings.push(`${name}: private/generated file type`);
  if (info.size > 20 * 1024 * 1024) findings.push(`${name}: unexpectedly large source file`);
  if (!/\.(?:png|webp|jpg|jpeg|ico)$/i.test(name)) {
    const source = await readFile(fullPath, 'utf8');
    if (secrets.test(source)) findings.push(`${name}: possible credential (value hidden)`);
    if (privatePath.test(source)) findings.push(`${name}: personal absolute filesystem path`);
  }
}
if (findings.length) throw new Error(`Public source audit failed:\n${findings.join('\n')}`);
console.log(`Public source audit passed: ${files.length} tracked files, ${bytes} bytes. Pattern checks are not a complete security review.`);

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import ignore from 'ignore';
import { createTwoFilesPatch } from 'diff';
import { id, now } from './store.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const OMIT = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.data', '.codex', '.claude', '.ssh', 'coverage']);
const sensitive = relative => relative.split('/').some(part => OMIT.has(part) || /^\.env(?:\.|$)/i.test(part) || /^(?:credentials|secrets)(?:\.|$)/i.test(part) || /\.(pem|key|pfx|sqlite|db)$/i.test(part));
const inside = (root, target) => { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };

export async function projectRoot(project) {
  if (!project?.path) throw new Error('请先为项目设置本地文件夹');
  const root = await fs.realpath(project.path);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('项目路径不是文件夹');
  const forbidden = [path.parse(root).root, os.homedir(), process.env.WINDIR, process.env.ProgramFiles].filter(Boolean).map(x => path.resolve(x).toLowerCase());
  if (forbidden.includes(root.toLowerCase())) throw new Error('请选择具体的项目文件夹');
  return root;
}

async function safePath(root, relative) {
  if (!relative || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(x => !x || x === '.' || x === '..') || path.isAbsolute(relative) || sensitive(relative)) throw new Error('快照包含无效文件路径');
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error('文件超出了项目目录');
  let ancestor = target;
  while (true) {
    try {
      const stat = await fs.lstat(ancestor);
      if (stat.isSymbolicLink() || !inside(root, await fs.realpath(ancestor))) throw new Error('快照不能经过符号链接');
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); }
  }
  return target;
}

async function readFile(root, relative) {
  const target = await safePath(root, relative);
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('文件类型或大小不适合快照');
    const bytes = await fs.readFile(target);
    return { path: relative, exists: true, hash: hash(bytes), content: bytes.toString('base64'), size: bytes.length };
  } catch (error) { if (error.code === 'ENOENT') return { path: relative, exists: false, hash: 'missing', size: 0 }; throw error; }
}

export async function takeSnapshot(project, name = '手动快照') {
  const root = await projectRoot(project), files = [], ignored = ignore();
  try { ignored.add(await fs.readFile(path.join(root, '.gitignore'), 'utf8')); } catch {}
  let totalBytes = 0;
  async function walk(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink() || sensitive(relative) || ignored.ignores(relative + (entry.isDirectory() ? '/' : ''))) continue;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
      else if (entry.isFile()) {
        const file = await readFile(root, relative);
        totalBytes += file.size;
        if (files.length >= 500 || totalBytes > 30 * 1024 * 1024) throw new Error('快照上限为 500 个文件 / 30 MB，请缩小项目范围或调整 .gitignore');
        files.push(file);
      }
    }
  }
  await walk(root);
  if (!files.length) throw new Error('项目中没有可快照的文件');
  return { id: id(), projectId: project.id, root, name: name.slice(0, 100), createdAt: now(), updatedAt: now(), files, totalBytes };
}

export const snapshotMeta = snapshot => { const { files, ...meta } = snapshot; return { ...meta, fileCount: files.length }; };

export async function previewSnapshot(project, snapshot) {
  const root = await projectRoot(project);
  if (snapshot.projectId !== project.id || root.toLowerCase() !== snapshot.root.toLowerCase()) throw new Error('快照与当前项目路径不一致');
  const changes = [], currentFiles = [];
  for (const file of snapshot.files) {
    const current = await readFile(root, file.path);
    currentFiles.push(current);
    if (current.hash === file.hash) continue;
    const before = Buffer.from(current.content || '', 'base64'), after = Buffer.from(file.content || '', 'base64');
    const binary = before.includes(0) || after.includes(0);
    changes.push({ path: file.path, action: !file.exists ? 'delete' : current.exists ? 'modify' : 'create', beforeSize: current.size, afterSize: file.size, binary, patch: binary || before.length + after.length > 30000 ? '' : createTwoFilesPatch(file.path, file.path, before.toString('utf8'), after.toString('utf8'), '当前文件', snapshot.name, { context: 3 }) });
  }
  const digest = hash(JSON.stringify(currentFiles.map(file => [file.path, file.hash])));
  return { digest, changes, currentFiles, root };
}

async function writeFile(root, file) {
  const target = await safePath(root, file.path);
  if (!file.exists) { await fs.rm(target, { force: true }); return; }
  const bytes = Buffer.from(file.content, 'base64');
  if (hash(bytes) !== file.hash) throw new Error('快照文件校验失败');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await safePath(root, file.path);
  const temporary = target + '.agent-desk-' + id() + '.tmp';
  try {
    let mode = 0o644;
    try { mode = (await fs.stat(target)).mode; } catch {}
    await fs.writeFile(temporary, bytes, { mode, flag: 'wx' });
    await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }); }
}

export async function restoreSnapshot(project, snapshot, digest, store) {
  const preview = await previewSnapshot(project, snapshot);
  if (digest !== preview.digest) throw new Error('文件在预览后发生了变化，请重新预览');
  if (!preview.changes.length) throw new Error('没有需要恢复的文件');
  const changed = new Set(preview.changes.map(file => file.path));
  const undo = { id: id(), projectId: project.id, root: preview.root, name: `恢复前 · ${snapshot.name}`, createdAt: now(), updatedAt: now(), files: preview.currentFiles.filter(file => changed.has(file.path)) };
  undo.totalBytes = undo.files.reduce((sum, file) => sum + file.size, 0);
  store.put('snapshot', undo);
  const written = [];
  try {
    for (const file of snapshot.files.filter(file => changed.has(file.path))) {
      const expected = preview.currentFiles.find(x => x.path === file.path);
      if ((await readFile(preview.root, file.path)).hash !== expected.hash) throw new Error('恢复过程中检测到外部文件修改');
      await writeFile(preview.root, file); written.push(file);
    }
  } catch (error) {
    let conflicts = 0;
    for (const file of written.reverse()) {
      try { if ((await readFile(preview.root, file.path)).hash === file.hash) await writeFile(preview.root, undo.files.find(x => x.path === file.path)); else conflicts++; } catch { conflicts++; }
    }
    throw new Error(error.message + (conflicts ? '；部分文件出现并发修改，恢复前快照已保留' : '；已撤销本次已完成的写入'));
  }
  return { restored: written.length, undo: snapshotMeta(undo) };
}

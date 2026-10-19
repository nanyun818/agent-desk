import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { now } from './store.mjs';

const text = value => typeof value === 'string' ? value : Array.isArray(value) ? value.filter(x => ['text', 'input_text', 'output_text'].includes(x.type)).map(x => x.text || '').join('\n') : '';
const clean = value => String(value || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const internal = value => /^<(?:external_codex_apps_open_page|send_user_message_question_reply|local-command-caveat|local-command-stdout|command-name|task-notification|environment_context)[\s>]/.test(value) || value.startsWith('Another Claude session sent a message:');
const readableTitle = value => {
  const request = value.match(/## My request(?: for Codex)?:\s*([\s\S]*)/i)?.[1] || value;
  return request.replace(/<image[\s\S]*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 80);
};

export function parseTranscript(source, raw, file = '') {
  const rows = raw.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  let sourceId = '', cwd = '', model = '', title = '', updatedAt = '', customTitle = '';
  const messages = [];
  const hasCodexItems = rows.some(x => x.type === 'response_item' && x.payload?.type === 'message');
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], payload = row.payload || {};
    sourceId ||= source === 'claude' ? row.sessionId : row.type === 'session_meta' ? payload.id : '';
    cwd ||= row.cwd || (row.type === 'session_meta' ? payload.cwd : '');
    if (row.type === 'turn_context') model = payload.model || model;
    if (row.type === 'custom-title' && row.customTitle) customTitle = row.customTitle;
    if (row.timestamp) updatedAt = row.timestamp;
    let role, content, tools = [];
    if (source === 'claude' && ['user', 'assistant'].includes(row.type) && row.message && !row.isSidechain) {
      role = row.message.role || row.type;
      content = clean(text(row.message.content));
      model = row.message.model || model;
      tools = Array.isArray(row.message.content) ? row.message.content.filter(x => x.type === 'tool_use').map(x => x.name).filter(Boolean) : [];
    } else if (source === 'codex' && row.type === 'response_item' && payload.type === 'message' && ['user', 'assistant'].includes(payload.role)) {
      role = payload.role; content = clean(text(payload.content));
    } else if (source === 'codex' && !hasCodexItems && row.type === 'event_msg' && ['user_message', 'agent_message'].includes(payload.type)) {
      role = payload.type === 'user_message' ? 'user' : 'assistant'; content = clean(payload.message);
    }
    if (role && (content || tools.length) && !internal(content || '')) {
      messages.push({ id: row.uuid || hash(file + index), role, content: (content || '').slice(0, 100000), tools, model, createdAt: row.timestamp || now(), status: 'complete' });
      if (role === 'user' && content && !title && !/^(?:claude|codex|gemini)(?:\s+--?[\w=-]+)+\s*$/.test(content)) title = readableTitle(content);
    }
  }
  if (!sourceId || !messages.length) return null;
  return { id: `import:${source}:${sourceId}`, source, sourceId, sourceFile: file, cwd, title: customTitle || title || '未命名会话', model, messages, readOnly: true, pinned: false, createdAt: messages[0].createdAt, updatedAt: updatedAt || messages.at(-1).createdAt };
}

export async function importHistory(store, roots = { claude: path.join(os.homedir(), '.claude', 'projects'), codex: path.join(os.homedir(), '.codex', 'sessions') }) {
  let imported = 0, skipped = 0, bytes = 0;
  const issues = [], files = [], codexTitles = new Map(), claudeIndexes = new Map();
  if (roots.codex) {
    try {
      const index = await fs.readFile(path.join(roots.codex, '..', 'session_index.jsonl'), 'utf8');
      for (const line of index.split(/\r?\n/)) { try { const row = JSON.parse(line); if (row.id && row.thread_name) codexTitles.set(row.id, row.thread_name); } catch {} }
    } catch {}
  }
  async function walk(directory, source, depth = 0) {
    if (depth > 10 || files.length >= 1200) return;
    let entries; try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= 1200) break;
      if (entry.isSymbolicLink() || entry.name === 'subagents') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full, source, depth + 1);
      else if (entry.name.endsWith('.jsonl')) files.push({ file: full, source });
    }
  }
  for (const [source, directory] of Object.entries(roots)) await walk(directory, source);
  for (const { file, source } of files) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > 30 * 1024 * 1024 || bytes + stat.size > 160 * 1024 * 1024) { skipped++; continue; }
      bytes += stat.size;
      const session = parseTranscript(source, await fs.readFile(file, 'utf8'), file);
      if (!session) { skipped++; continue; }
      const previous = store.get('session', session.id);
      if (previous?.importMtime === stat.mtimeMs && previous?.importerVersion === 2) { skipped++; continue; }
      if (source === 'codex' && codexTitles.has(session.sourceId)) session.title = codexTitles.get(session.sourceId);
      if (source === 'claude') {
        const indexPath = path.join(path.dirname(file), 'sessions-index.json');
        if (!claudeIndexes.has(indexPath)) {
          try { claudeIndexes.set(indexPath, JSON.parse(await fs.readFile(indexPath, 'utf8')).entries || []); } catch { claudeIndexes.set(indexPath, []); }
        }
        const entry = claudeIndexes.get(indexPath).find(x => x.sessionId === session.sourceId);
        if (entry?.customTitle || entry?.summary) session.title = entry.customTitle || entry.summary;
      }
      const projectId = session.cwd ? `project:${hash(session.cwd.toLowerCase())}` : 'inbox';
      if (!store.get('project', projectId)) store.put('project', { id: projectId, name: path.basename(session.cwd) || session.cwd, path: session.cwd, createdAt: now(), updatedAt: now() });
      store.put('session', { ...session, projectId, pinned: previous?.pinned || false, archived: previous?.archived || false, title: previous?.renamed ? previous.title : session.title, renamed: previous?.renamed || false, importMtime: stat.mtimeMs, importerVersion: 2 });
      imported++;
    } catch { issues.push(path.basename(file)); }
  }
  return { imported, skipped, errors: issues.length, limited: files.length >= 1200 || bytes >= 160 * 1024 * 1024 };
}

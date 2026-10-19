import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const defaultDataDir = process.env.AGENT_DESK_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'AgentDesk');

export function createStore(directory = defaultDataDir) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, 'desk.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS documents(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE INDEX IF NOT EXISTS documents_kind_updated ON documents(kind,updated DESC)');
  const get = db.prepare('SELECT data FROM documents WHERE kind=? AND id=?');
  const list = db.prepare('SELECT data FROM documents WHERE kind=? ORDER BY updated DESC');
  const put = db.prepare('INSERT INTO documents VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,updated=excluded.updated');
  const keyPath = path.join(directory, 'vault.key');
  if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  const key = fs.readFileSync(keyPath);
  return {
    directory,
    get: (kind, key) => { const row = get.get(kind, key); return row ? JSON.parse(row.data) : null; },
    list: kind => list.all(kind).map(row => JSON.parse(row.data)),
    sessionList({ query = '', projectId = '', source = '', archived = false } = {}) {
      const rows = db.prepare(`SELECT json_remove(data,'$.messages') AS data,
        json_array_length(data,'$.messages') AS messageCount,
        COALESCE((SELECT substr(json_extract(value,'$.content'),1,500) FROM json_each(documents.data,'$.messages') WHERE json_extract(value,'$.role')='user' ORDER BY CAST(key AS INTEGER) DESC LIMIT 1),'') AS preview
        FROM documents WHERE kind='session'
        AND COALESCE(json_extract(data,'$.archived'),0)=?
        AND (?='' OR json_extract(data,'$.projectId')=?)
        AND (?='' OR json_extract(data,'$.source')=?)
        AND (?='' OR instr(lower(data),lower(?))>0)
        ORDER BY COALESCE(json_extract(data,'$.pinned'),0) DESC,updated DESC`).all(Number(archived), projectId, projectId, source, source, query, query);
      return rows.map(row => ({ ...JSON.parse(row.data), messageCount: row.messageCount, preview: row.preview }));
    },
    put(kind, value) { put.run(kind, value.id, JSON.stringify(value), value.updatedAt || now()); return value; },
    remove: (kind, key) => db.prepare('DELETE FROM documents WHERE kind=? AND id=?').run(kind, key),
    transaction(fn) { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
    },
    decrypt(value) {
      const bytes = Buffer.from(value, 'base64');
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8');
    },
    close: () => db.close(),
  };
}

export function seed(store) {
  if (!store.get('project', 'inbox')) store.put('project', { id: 'inbox', name: '个人工作区', path: '', color: '#337462', createdAt: now(), updatedAt: now() });
  const presets = [
    { id: 'openai', name: 'OpenAI · GPT', protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1', models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'], envKey: 'OPENAI_API_KEY', thinking: true, color: '#2b7565' },
    { id: 'anthropic', name: 'Anthropic · Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'], envKey: 'ANTHROPIC_API_KEY', thinking: false, color: '#b37a55' },
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-flash', 'deepseek-v4-pro'], envKey: 'DEEPSEEK_API_KEY', thinking: true, color: '#4c67dd' },
    { id: 'kimi', name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2.6'], envKey: 'MOONSHOT_API_KEY', thinking: true, color: '#272a2b' },
    { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo'], envKey: 'DASHSCOPE_API_KEY', thinking: false, color: '#8253b8' },
  ];
  for (const preset of presets) if (!store.get('provider', preset.id)) store.put('provider', { ...preset, requiresKey: true, createdAt: now(), updatedAt: now() });
  for (const session of store.list('session')) {
    let changed = false;
    for (const message of session.messages || []) if (message.status === 'streaming') { message.status = 'interrupted'; changed = true; }
    if (changed) store.put('session', session);
  }
}

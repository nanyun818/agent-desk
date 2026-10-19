import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { id, now, seed } from './store.mjs';
import { importHistory } from './importers.mjs';
import { takeSnapshot, snapshotMeta, previewSnapshot, restoreSnapshot } from './snapshots.mjs';
import { PROTOCOLS, protocolOf, providerClient, listProviderModels, streamProvider, isProviderError } from './providers.mjs';
import { APP_VERSION } from './version.mjs';
import { readAppearance, saveAppearance } from './appearance.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const string = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const required = (value, label, max) => { const result = string(value, max); if (!result) throw fail(`${label}不能为空`); return result; };
const previewText = value => (value.match(/## My request(?: for Codex)?:\s*([\s\S]*)/i)?.[1] || value).replace(/\s+/g, ' ').slice(0, 120);
const officialBases = { deepseek: 'https://api.deepseek.com', kimi: 'https://api.moonshot.cn/v1', qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1' };

function validateBase(value) {
  let url; try { url = new URL(value); } catch { throw fail('API 地址无效'); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw fail('远程 API 需要 HTTPS，本地接口可使用 HTTP');
  return url.href.replace(/\/$/, '');
}

export function createApp(store, options = {}) {
  seed(store);
  const app = express(), token = randomBytes(32).toString('hex'), active = new Map(), locks = new Set();
  let importBusy = false;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return res.status(403).json({ error: '仅允许本机访问' });
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return res.status(403).json({ error: '请求来源不匹配' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    next();
  });
  app.use('/api/appearance', express.json({ limit: '3mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.path === '/bootstrap' && req.method === 'GET') return next();
    if (req.headers['x-agent-token'] !== token) return res.status(403).json({ error: '请刷新工作台后重试' });
    next();
  });
  const get = (kind, key) => { const result = store.get(kind, key); if (!result) throw fail('记录不存在', 404); return result; };
  async function credentials(provider) {
    if (provider.secret) return { key: store.decrypt(provider.secret), source: '本地密钥库' };
    if (provider.id === 'deepseek' && provider.baseUrl === officialBases.deepseek && !options.noExternalCredentials) {
      try {
        const settings = JSON.parse(await fs.readFile(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
        if (new URL(settings.env?.ANTHROPIC_BASE_URL).hostname === 'api.deepseek.com' && settings.env?.ANTHROPIC_AUTH_TOKEN) return { key: settings.env.ANTHROPIC_AUTH_TOKEN, source: 'Claude Code 配置' };
      } catch {}
    }
    const key = provider.envKey && !options.noExternalCredentials ? process.env[provider.envKey] || (provider.id === 'kimi' ? process.env.KIMI_API_KEY : '') : '';
    return { key: key || '', source: key ? '环境变量' : '' };
  }
  async function publicProvider(provider) {
    const { secret, ...value } = provider, auth = await credentials(provider);
    return { ...value, protocol: protocolOf(provider), configured: Boolean(auth.key) || !provider.requiresKey, credentialSource: auth.source };
  }
  async function clientFor(provider) {
    const auth = await credentials(provider);
    if (provider.requiresKey && !auth.key) throw fail(`请先配置 ${provider.name} 的 API Key`);
    return providerClient(provider, auth.key);
  }
  async function projectLock(projectId, fn) {
    if (locks.has(projectId)) throw fail('项目正在处理文件，请稍后重试', 409);
    locks.add(projectId); try { return await fn(); } finally { locks.delete(projectId); }
  }

  app.get('/api/bootstrap', async (_req, res) => res.json({ app: 'agent-desk', token, version: APP_VERSION, processId: process.pid, providers: await Promise.all(store.list('provider').map(publicProvider)), projects: store.list('project'), dataDirectory: store.directory }));
  app.get('/api/appearance', (_req, res) => res.json(readAppearance(store)));
  app.put('/api/appearance', (req, res) => res.json(saveAppearance(store, req.body)));
  app.get('/api/projects', (_req, res) => res.json(store.list('project')));
  app.post('/api/projects', async (req, res) => {
    let directory = string(req.body.path, 1500);
    if (directory) { try { directory = await fs.realpath(directory); if (!(await fs.stat(directory)).isDirectory()) throw Error(); } catch { throw fail('本地项目文件夹不存在'); } }
    const existing = directory && store.list('project').find(x => x.path.toLowerCase() === directory.toLowerCase());
    if (existing) return res.json(existing);
    res.status(201).json(store.put('project', { id: id(), name: required(req.body.name, '项目名称'), path: directory, createdAt: now(), updatedAt: now() }));
  });
  app.get('/api/providers', async (_req, res) => res.json(await Promise.all(store.list('provider').map(publicProvider))));
  app.post('/api/providers', async (req, res) => {
    const previous = req.body.id ? get('provider', req.body.id) : null;
    const baseUrl = validateBase(required(req.body.baseUrl, 'API 地址', 1500));
    const models = (Array.isArray(req.body.models) ? req.body.models : []).map(x => string(x, 150)).filter(Boolean).slice(0, 100);
    if (!models.length) throw fail('至少填写一个模型 ID');
    const baseChanged = previous && previous.baseUrl !== baseUrl;
    const protocol = req.body.protocol || previous?.protocol || 'chat-completions';
    if (!PROTOCOLS.includes(protocol)) throw fail('不支持该 API 协议');
    const provider = { id: previous?.id || id(), name: required(req.body.name, '服务商名称'), baseUrl, models: [...new Set(models)], color: previous?.color || '#487e76', thinking: Boolean(req.body.thinking), requiresKey: req.body.requiresKey !== false, createdAt: previous?.createdAt || now(), updatedAt: now(), envKey: baseChanged ? '' : previous?.envKey || '', secret: baseChanged ? '' : previous?.secret || '' };
    provider.protocol = protocol;
    if (string(req.body.apiKey, 4000)) provider.secret = store.encrypt(string(req.body.apiKey, 4000));
    if (req.body.clearKey) { provider.secret = ''; provider.envKey = ''; }
    store.put('provider', provider); res.json(await publicProvider(provider));
  });
  app.post('/api/providers/:id/models', async (req, res) => {
    const provider = get('provider', req.params.id), client = await clientFor(provider);
    const models = await listProviderModels(provider, client);
    if (!models.length) throw fail('接口没有返回模型列表');
    store.put('provider', { ...provider, models, updatedAt: now() }); res.json({ models });
  });

  app.get('/api/sessions', (req, res) => {
    const query = string(req.query.q, 200).toLowerCase(), projectId = string(req.query.projectId), source = string(req.query.source);
    res.json(store.sessionList({ query, projectId, source, archived: req.query.archived === 'true' }).map(session => ({ ...session, preview: previewText(session.preview) })));
  });
  app.post('/api/sessions', (req, res) => {
    const projectId = req.body.projectId || 'inbox'; get('project', projectId);
    const provider = get('provider', req.body.providerId || 'deepseek');
    res.status(201).json(store.put('session', { id: id(), projectId, title: string(req.body.title) || '新对话', source: 'app', providerId: provider.id, model: string(req.body.model, 150) || provider.models[0], messages: [], pinned: false, readOnly: false, createdAt: now(), updatedAt: now() }));
  });
  app.get('/api/sessions/:id', (req, res) => res.json(get('session', req.params.id)));
  app.patch('/api/sessions/:id', (req, res) => {
    const session = get('session', req.params.id);
    if ('title' in req.body) { session.title = required(req.body.title, '对话名称'); session.renamed = true; }
    for (const key of ['pinned', 'archived']) if (typeof req.body[key] === 'boolean') session[key] = req.body[key];
    if (!session.readOnly && !active.has(session.id)) {
      if (req.body.providerId) { get('provider', req.body.providerId); session.providerId = req.body.providerId; }
      if (req.body.model) session.model = string(req.body.model, 150);
    }
    res.json(store.put('session', session));
  });
  app.post('/api/sessions/:id/branch', (req, res) => {
    const original = get('session', req.params.id);
    const index = original.messages.findIndex(x => x.id === req.body.messageId);
    if (index < 0) throw fail('分支起点不存在');
    const provider = store.get('provider', original.providerId) || get('provider', 'deepseek');
    const messages = original.messages.slice(0, index + (req.body.include === false ? 0 : 1)).filter(x => x.status !== 'streaming').map(x => ({ ...x, id: id(), status: 'complete' }));
    res.status(201).json(store.put('session', { id: id(), projectId: original.projectId, source: 'app', title: `${original.title.slice(0, 60)} · 分支`, providerId: provider.id, model: original.source === 'app' ? original.model : provider.models[0], messages, parentId: original.id, branchPoint: req.body.messageId, readOnly: false, createdAt: now(), updatedAt: now() }));
  });
  app.get('/api/sessions/:id/export', (req, res) => {
    const session = get('session', req.params.id);
    res.type('text/markdown').send(`# ${session.title}\n\n${session.messages.map(m => `## ${m.role === 'user' ? '用户' : '助手'}\n\n${m.content}`).join('\n\n---\n\n')}`);
  });
  app.post('/api/sessions/:id/stop', (req, res) => { active.get(req.params.id)?.abort(); res.json({ stopped: true }); });
  app.post('/api/sessions/:id/chat', async (req, res) => {
    const session = get('session', req.params.id);
    if (session.readOnly) throw fail('请先从 CLI 历史创建工作台分支');
    if (active.has(session.id)) throw fail('当前对话正在生成', 409);
    const provider = get('provider', req.body.providerId || session.providerId), client = await clientFor(provider);
    const model = string(req.body.model, 150) || session.model;
    if (req.body.regenerate) {
      if (session.messages.at(-1)?.role !== 'user') throw fail('没有待重新生成的用户消息');
    } else {
      const content = required(req.body.content, '消息', 60000);
      session.messages.push({ id: id(), role: 'user', content, createdAt: now(), status: 'complete' });
      if (session.title === '新对话') session.title = content.replace(/\s+/g, ' ').slice(0, 48);
    }
    const history = session.messages.filter(x => x.content && x.status !== 'error').map(({ role, content }) => ({ role, content }));
    if (history.reduce((sum, x) => sum + x.content.length, 0) > 800000) throw fail('对话超过当前工作台的请求长度上限，请新建分支并缩短上下文');
    const assistant = { id: id(), role: 'assistant', content: '', reasoning: '', model, providerId: provider.id, createdAt: now(), status: 'streaming' };
    session.messages.push(assistant); session.model = model; session.providerId = provider.id; session.updatedAt = now();
    store.put('session', session);
    const controller = new AbortController(); active.set(session.id, controller);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders();
    const send = (event, data) => { if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    let finished = false, lastSaved = Date.now();
    const persist = () => {
      const latest = store.get('session', session.id);
      for (const key of ['title', 'renamed', 'pinned', 'archived']) if (latest && key in latest) session[key] = latest[key];
      store.put('session', session);
    };
    res.on('close', () => { if (!finished) controller.abort(); });
    send('start', { sessionId: session.id, user: req.body.regenerate ? null : session.messages.at(-2), assistant });
    try {
      const stream = streamProvider({ provider, client, model, history, thinking: Boolean(req.body.thinking), signal: controller.signal });
      for await (const delta of stream) {
        if (delta.content) assistant.content += delta.content;
        if (delta.reasoning) assistant.reasoning += delta.reasoning;
        if (delta.usage) assistant.usage = { ...assistant.usage, ...delta.usage };
        if (delta.finishReason) assistant.finishReason = delta.finishReason;
        if (delta.content || delta.reasoning) send('delta', { content: delta.content || '', reasoning: delta.reasoning || '' });
        if (Date.now() - lastSaved > 750) { persist(); lastSaved = Date.now(); }
      }
      assistant.status = controller.signal.aborted ? 'cancelled' : 'complete';
      if (assistant.finishReason === 'length') assistant.warning = '本次输出达到长度上限，可发送消息继续';
    } catch (error) {
      assistant.status = controller.signal.aborted ? 'cancelled' : 'error';
      if (!controller.signal.aborted) {
        const status = Number(error.status) || 0;
        assistant.error = ({ 401: 'API Key 无效或与接口不匹配', 402: '服务商账户余额不足', 403: '没有该模型的访问权限', 404: '模型 ID 或 API 地址不存在', 429: '请求频率或额度受限，请稍后重试' })[status] || (status ? `模型接口返回 HTTP ${status}` : '模型连接中断或超时，请检查接口与网络');
      }
    } finally {
      session.updatedAt = now(); persist(); active.delete(session.id); finished = true;
      send('done', session); res.end();
    }
  });

  app.post('/api/import', async (_req, res) => {
    if (importBusy) throw fail('历史记录正在导入', 409);
    importBusy = true; try { res.json(await importHistory(store, options.importRoots)); } finally { importBusy = false; }
  });
  app.get('/api/tasks', (req, res) => res.json(store.list('task').filter(x => !req.query.projectId || x.projectId === req.query.projectId)));
  app.post('/api/tasks', (req, res) => {
    const projectId = req.body.projectId || 'inbox'; get('project', projectId);
    if (req.body.sessionId && get('session', req.body.sessionId).projectId !== projectId) throw fail('任务和对话需要属于同一项目');
    res.status(201).json(store.put('task', { id: id(), title: required(req.body.title, '任务名称', 300), projectId, sessionId: req.body.sessionId || null, status: 'todo', createdAt: now(), updatedAt: now() }));
  });
  app.patch('/api/tasks/:id', (req, res) => {
    const task = get('task', req.params.id);
    if (req.body.title !== undefined) task.title = required(req.body.title, '任务名称', 300);
    if (['todo', 'doing', 'done'].includes(req.body.status)) task.status = req.body.status;
    task.updatedAt = now(); res.json(store.put('task', task));
  });
  app.delete('/api/tasks/:id', (req, res) => { store.remove('task', req.params.id); res.json({ ok: true }); });
  app.get('/api/projects/:id/snapshots', (req, res) => res.json(store.list('snapshot').filter(x => x.projectId === req.params.id).map(snapshotMeta)));
  app.post('/api/projects/:id/snapshots', async (req, res) => res.status(201).json(await projectLock(req.params.id, async () => snapshotMeta(store.put('snapshot', await takeSnapshot(get('project', req.params.id), string(req.body.name) || '手动快照'))))));
  app.get('/api/snapshots/:id/preview', async (req, res) => {
    const snapshot = get('snapshot', req.params.id), preview = await previewSnapshot(get('project', snapshot.projectId), snapshot);
    res.json({ snapshot: snapshotMeta(snapshot), digest: preview.digest, changes: preview.changes });
  });
  app.post('/api/snapshots/:id/restore', async (req, res) => {
    const snapshot = get('snapshot', req.params.id);
    res.json(await projectLock(snapshot.projectId, () => restoreSnapshot(get('project', snapshot.projectId), snapshot, req.body.digest, store)));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use((error, _req, res, _next) => {
    const status = error.status || (isProviderError(error) ? 502 : 400);
    res.status(status).json({ error: isProviderError(error) ? `模型接口连接失败（HTTP ${error.status || '超时'}）` : error.type === 'entity.parse.failed' ? '请求格式无效' : error.message || '操作失败' });
  });
  app.locals.abortRequests = () => { for (const controller of active.values()) controller.abort(); };
  return app;
}

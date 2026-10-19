import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createStore, seed } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { parseTranscript, importHistory } from '../server/importers.mjs';
import { takeSnapshot, previewSnapshot, restoreSnapshot } from '../server/snapshots.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-desk-test-'));
  const store = createStore(path.join(directory, 'data')); seed(store);
  t.after(async () => { store.close(); const checked = path.resolve(directory); if (path.dirname(checked) !== path.resolve(os.tmpdir()) || !path.basename(checked).startsWith('agent-desk-test-')) throw Error('Invalid cleanup target'); await fs.rm(checked, { recursive: true, force: true }); });
  return { directory, store };
}
async function listen(app, t) {
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function apiFixture(t) {
  const fixtureValue = await fixture(t);
  const base = await listen(createApp(fixtureValue.store, { noExternalCredentials: true, importRoots: {} }), t);
  const bootstrap = await (await fetch(base + '/api/bootstrap')).json();
  const request = async (url, method = 'GET', body) => {
    const response = await fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json', 'x-agent-token': bootstrap.token }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
  };
  return { ...fixtureValue, base, bootstrap, request };
}

test('vault encrypts and restores API keys without plaintext storage', async t => {
  const { store } = await fixture(t), encrypted = store.encrypt('private-test-key');
  assert.notEqual(encrypted, 'private-test-key'); assert.equal(store.decrypt(encrypted), 'private-test-key');
});

test('API rejects missing token and cross-origin requests', async t => {
  const { base, bootstrap } = await apiFixture(t);
  assert.equal((await fetch(base + '/api/sessions')).status, 403);
  assert.equal((await fetch(base + '/api/sessions', { headers: { 'x-agent-token': bootstrap.token, Origin: 'https://other.example' } })).status, 403);
});

test('conversation branching, full-text lookup, tasks, and persistence preserve the original', async t => {
  const { request, store } = await apiFixture(t);
  const session = await request('/sessions', 'POST', { title: 'Original conversation' });
  session.messages = [{ id: 'u1', role: 'user', content: 'needle in the history', status: 'complete' }, { id: 'a1', role: 'assistant', content: 'old answer', status: 'complete' }]; store.put('session', session);
  const branch = await request(`/sessions/${session.id}/branch`, 'POST', { messageId: 'a1', include: false });
  assert.equal(branch.parentId, session.id); assert.equal(branch.messages.length, 1); assert.notEqual(branch.messages[0].id, 'u1');
  assert.equal((await request(`/sessions/${session.id}`)).messages.length, 2);
  assert.equal((await request('/sessions?q=needle')).length, 2);
  const task = await request('/tasks', 'POST', { title: 'Verify branch', projectId: 'inbox', sessionId: branch.id });
  await request(`/tasks/${task.id}`, 'PATCH', { status: 'done' });
  assert.equal((await request('/tasks'))[0].status, 'done');
  await request(`/sessions/${session.id}`, 'PATCH', { archived: true });
  assert.equal((await request('/sessions')).length, 1); assert.equal((await request('/sessions?archived=true')).length, 1);
});

test('provider secrets never appear in responses; endpoint changes discard old credentials', async t => {
  const { request, store } = await apiFixture(t);
  const provider = await request('/providers', 'POST', { name: 'Private', baseUrl: 'https://example.com/v1', models: ['test'], apiKey: 'private-secret-value' });
  assert.equal(provider.configured, true); assert.ok(!JSON.stringify(provider).includes('private-secret-value')); assert.ok(!JSON.stringify(store.get('provider', provider.id)).includes('private-secret-value'));
  const changed = await request('/providers', 'POST', { ...provider, baseUrl: 'https://different.example/v1' });
  assert.equal(changed.configured, false);
});

test('OpenAI-compatible SSE streams into a durable conversation', async t => {
  const { request, base, bootstrap, store } = await apiFixture(t);
  let received;
  const mock = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    received = JSON.parse(raw); res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ id: 'test', choices: [{ delta: { content: 'Hello' }, index: 0 }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ id: 'test', choices: [{ delta: { content: ' world' }, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  mock.listen(0, '127.0.0.1'); await new Promise(resolve => mock.once('listening', resolve)); t.after(() => new Promise(resolve => mock.close(resolve)));
  const provider = await request('/providers', 'POST', { name: 'Mock', baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, models: ['test-model'], requiresKey: false });
  const session = await request('/sessions', 'POST', { providerId: provider.id });
  const response = await fetch(`${base}/api/sessions/${session.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-agent-token': bootstrap.token }, body: JSON.stringify({ content: 'Hello', providerId: provider.id, model: 'test-model' }) });
  const streamed = await response.text(); assert.ok(streamed.includes('event: delta')); assert.ok(streamed.includes('event: done'));
  assert.equal(store.get('session', session.id).messages.at(-1).content, 'Hello world'); assert.equal(store.get('session', session.id).messages.at(-1).status, 'complete'); assert.equal(received.model, 'test-model');
});

test('OpenAI Responses uses /responses, avoids remote response storage, and streams text plus usage', async t => {
  const { request, base, bootstrap, store } = await apiFixture(t);
  let received, requestPath;
  const mock = http.createServer(async (req, res) => {
    requestPath = req.url; let raw = ''; for await (const chunk of req) raw += chunk; received = JSON.parse(raw);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const event of [
      { type: 'response.reasoning_summary_text.delta', delta: 'Short reasoning' },
      { type: 'response.output_text.delta', delta: 'GPT reply' },
      { type: 'response.completed', response: { id: 'resp-test', usage: { input_tokens: 7, output_tokens: 3 } } },
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  mock.listen(0, '127.0.0.1'); await new Promise(resolve => mock.once('listening', resolve)); t.after(() => new Promise(resolve => mock.close(resolve)));
  const provider = await request('/providers', 'POST', { name: 'GPT mock', protocol: 'openai-responses', baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, models: ['gpt-test'], requiresKey: false, thinking: true });
  const session = await request('/sessions', 'POST', { providerId: provider.id });
  const response = await fetch(`${base}/api/sessions/${session.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-agent-token': bootstrap.token }, body: JSON.stringify({ content: 'test', thinking: true }) });
  assert.ok((await response.text()).includes('event: done'));
  const assistant = store.get('session', session.id).messages.at(-1);
  assert.equal(requestPath, '/v1/responses'); assert.equal(received.store, false); assert.equal(received.input[0].role, 'user'); assert.equal(received.reasoning.effort, 'high'); assert.ok(received.instructions);
  assert.equal(assistant.content, 'GPT reply'); assert.equal(assistant.reasoning, 'Short reasoning'); assert.equal(assistant.usage.output_tokens, 3); assert.equal(assistant.status, 'complete');
});

test('Anthropic Messages uses x-api-key and system field with native stream events', async t => {
  const previousToken = process.env.ANTHROPIC_AUTH_TOKEN;
  process.env.ANTHROPIC_AUTH_TOKEN = 'unrelated-provider-test-token';
  t.after(() => { if (previousToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN; else process.env.ANTHROPIC_AUTH_TOKEN = previousToken; });
  const { request, base, bootstrap, store } = await apiFixture(t);
  let received, headers, requestPath;
  const mock = http.createServer(async (req, res) => {
    requestPath = req.url; headers = req.headers; let raw = ''; for await (const chunk of req) raw += chunk; received = JSON.parse(raw);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const event of [
      { type: 'message_start', message: { id: 'msg-test', usage: { input_tokens: 9, output_tokens: 0 } } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Claude reasoning' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Claude reply' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
      { type: 'message_stop' },
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  mock.listen(0, '127.0.0.1'); await new Promise(resolve => mock.once('listening', resolve)); t.after(() => new Promise(resolve => mock.close(resolve)));
  const provider = await request('/providers', 'POST', { name: 'Claude mock', protocol: 'anthropic', baseUrl: `http://127.0.0.1:${mock.address().port}`, models: ['claude-test'], apiKey: 'anthropic-test-secret' });
  const session = await request('/sessions', 'POST', { providerId: provider.id });
  const response = await fetch(`${base}/api/sessions/${session.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-agent-token': bootstrap.token }, body: JSON.stringify({ content: 'test' }) });
  await response.text(); const assistant = store.get('session', session.id).messages.at(-1);
  assert.equal(requestPath, '/v1/messages'); assert.equal(headers['x-api-key'], 'anthropic-test-secret'); assert.equal(Boolean(headers.authorization), false); assert.ok(headers['anthropic-version']);
  assert.equal(received.messages[0].role, 'user'); assert.ok(received.system); assert.equal(received.thinking, undefined);
  assert.equal(assistant.content, 'Claude reply'); assert.equal(assistant.reasoning, 'Claude reasoning'); assert.equal(assistant.usage.input_tokens, 9); assert.equal(assistant.usage.output_tokens, 4); assert.equal(assistant.status, 'complete');
});

test('a failed Responses stream remains an error and retains partial text', async t => {
  const { request, base, bootstrap, store } = await apiFixture(t);
  const mock = http.createServer(async (req, res) => {
    for await (const _ of req) {}
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('event: response.output_text.delta\ndata: ' + JSON.stringify({ type: 'response.output_text.delta', delta: 'Partial' }) + '\n\n');
    res.end('event: response.failed\ndata: ' + JSON.stringify({ type: 'response.failed', response: { error: { code: 'server_error' } } }) + '\n\n');
  });
  mock.listen(0, '127.0.0.1'); await new Promise(resolve => mock.once('listening', resolve)); t.after(() => new Promise(resolve => mock.close(resolve)));
  const provider = await request('/providers', 'POST', { name: 'Failed response', protocol: 'openai-responses', baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, models: ['test'], requiresKey: false });
  const session = await request('/sessions', 'POST', { providerId: provider.id });
  const response = await fetch(`${base}/api/sessions/${session.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-agent-token': bootstrap.token }, body: JSON.stringify({ content: 'test' }) });
  await response.text(); const assistant = store.get('session', session.id).messages.at(-1);
  assert.equal(assistant.content, 'Partial'); assert.equal(assistant.status, 'error'); assert.ok(assistant.error);
});

test('official presets use separate credential names and legacy providers retain chat protocol', async t => {
  const { request, bootstrap } = await apiFixture(t);
  const gpt = bootstrap.providers.find(x => x.id === 'openai'), claude = bootstrap.providers.find(x => x.id === 'anthropic');
  assert.equal(gpt.protocol, 'openai-responses'); assert.equal(gpt.envKey, 'OPENAI_API_KEY'); assert.equal(gpt.configured, false);
  assert.equal(claude.protocol, 'anthropic'); assert.equal(claude.envKey, 'ANTHROPIC_API_KEY'); assert.equal(claude.configured, false);
  const existing = await request('/providers', 'POST', { name: 'Legacy', baseUrl: 'https://legacy.example/v1', models: ['legacy'], requiresKey: false });
  assert.equal(existing.protocol, 'chat-completions');
});

test('standalone backend reports the real fallback port and exits when its desktop IPC disconnects', async t => {
  const { directory } = await fixture(t);
  const occupied = http.createServer((_req, res) => res.end('occupied')); occupied.listen(0, '127.0.0.1'); await once(occupied, 'listening');
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const child = fork(fileURLToPath(new URL('../server/index.mjs', import.meta.url)), [], { execArgv: [], env: { ...process.env, AGENT_DESK_DATA_DIR: path.join(directory, 'engine'), PORT: String(occupied.address().port) }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const timeout = setTimeout(() => child.kill(), 10000); t.after(() => clearTimeout(timeout));
  const [ready] = await once(child, 'message'); assert.equal(ready.type, 'ready'); assert.notEqual(ready.port, occupied.address().port);
  const response = await fetch(`http://127.0.0.1:${ready.port}/api/bootstrap`); const boot = await response.json();
  assert.equal(boot.processId, child.pid); assert.equal(path.resolve(boot.dataDirectory), path.resolve(directory, 'engine'));
  const exited = once(child, 'exit'); child.disconnect(); const [code] = await exited; assert.equal(code, 0);
});

test('Claude and Codex importers parse text while tolerating partial JSONL', () => {
  const claude = parseTranscript('claude', [JSON.stringify({ sessionId: 'abc', cwd: '/project', type: 'user', message: { role: 'user', content: 'hello' } }), JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'deepseek-flash', content: [{ type: 'text', text: 'answer' }, { type: 'tool_use', name: 'Read' }] } }), '{incomplete'].join('\n'));
  assert.equal(claude.messages.length, 2); assert.deepEqual(claude.messages[1].tools, ['Read']);
  const codex = parseTranscript('codex', [JSON.stringify({ type: 'session_meta', payload: { id: 'codex-id', cwd: '/code' } }), JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'duplicate' } }), JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'task' }] } })].join('\n'));
  assert.equal(codex.messages.length, 1); assert.equal(codex.messages[0].content, 'task');
});

test('stopping a stream saves its partial reply and preserves a concurrent rename', async t => {
  const { request, base, bootstrap, store } = await apiFixture(t);
  const mock = http.createServer(async (req, res) => {
    for await (const _ of req) {}
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ id: 'slow', choices: [{ delta: { content: 'partial reply' }, index: 0 }] }) + '\n\n');
    const timer = setTimeout(() => res.end('data: [DONE]\n\n'), 10000);
    res.on('close', () => clearTimeout(timer));
  });
  mock.listen(0, '127.0.0.1'); await new Promise(resolve => mock.once('listening', resolve));
  t.after(() => new Promise(resolve => { mock.closeAllConnections(); mock.close(resolve); }));
  const provider = await request('/providers', 'POST', { name: 'Slow mock', baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, models: ['slow'], requiresKey: false });
  const session = await request('/sessions', 'POST', { providerId: provider.id });
  const response = await fetch(`${base}/api/sessions/${session.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-agent-token': bootstrap.token }, body: JSON.stringify({ content: 'start' }) });
  const reader = response.body.getReader(); let stream = '';
  while (!stream.includes('event: delta')) { const part = await reader.read(); assert.equal(part.done, false); stream += new TextDecoder().decode(part.value); }
  await request(`/sessions/${session.id}`, 'PATCH', { title: 'Renamed during streaming', pinned: true });
  await request(`/sessions/${session.id}/stop`, 'POST', {});
  while (!(await reader.read()).done) {}
  const saved = store.get('session', session.id);
  assert.equal(saved.title, 'Renamed during streaming'); assert.equal(saved.pinned, true);
  assert.equal(saved.messages.at(-1).content, 'partial reply'); assert.equal(saved.messages.at(-1).status, 'cancelled');
});

test('import is idempotent and never changes transcript files', async t => {
  const { directory, store } = await fixture(t), history = path.join(directory, 'history'); await fs.mkdir(history);
  const content = JSON.stringify({ sessionId: 'immutable-id', cwd: directory, type: 'user', message: { role: 'user', content: 'immutable conversation' } });
  const file = path.join(history, 'session.jsonl'); await fs.writeFile(file, content);
  assert.equal((await importHistory(store, { claude: history })).imported, 1); assert.equal((await importHistory(store, { claude: history })).imported, 0); assert.equal(await fs.readFile(file, 'utf8'), content);
});

test('imported titles skip CLI notifications and extract the actual request', () => {
  const raw = [
    { type: 'session_meta', payload: { id: 'human-title', cwd: '/project' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# Files mentioned by the user:\n## notes.txt\n## My request:\nBuild a useful workspace' }] } },
  ].map(x => JSON.stringify(x)).join('\n');
  const session = parseTranscript('codex', raw);
  assert.equal(session.title, 'Build a useful workspace'); assert.equal(session.messages.length, 1);
});

test('snapshot restore detects stale previews, preserves unrelated new files, and offers undo', async t => {
  const { directory, store } = await fixture(t), project = { id: 'files', path: path.join(directory, 'project') }; await fs.mkdir(project.path);
  await fs.writeFile(path.join(project.path, 'index.txt'), 'original'); await fs.writeFile(path.join(project.path, '.env'), 'secret');
  const snapshot = await takeSnapshot(project); assert.equal(snapshot.files.length, 1);
  await fs.writeFile(path.join(project.path, 'index.txt'), 'changed'); const preview = await previewSnapshot(project, snapshot);
  await fs.writeFile(path.join(project.path, 'index.txt'), 'changed again');
  await assert.rejects(restoreSnapshot(project, snapshot, preview.digest, store), /预览/);
  await fs.writeFile(path.join(project.path, 'extra.txt'), 'unrelated');
  const fresh = await previewSnapshot(project, snapshot), result = await restoreSnapshot(project, snapshot, fresh.digest, store);
  assert.equal(await fs.readFile(path.join(project.path, 'index.txt'), 'utf8'), 'original'); assert.equal(await fs.readFile(path.join(project.path, 'extra.txt'), 'utf8'), 'unrelated');
  const undo = store.get('snapshot', result.undo.id), undoPreview = await previewSnapshot(project, undo); await restoreSnapshot(project, undo, undoPreview.digest, store);
  assert.equal(await fs.readFile(path.join(project.path, 'index.txt'), 'utf8'), 'changed again');
});

test('undo of a restored missing file removes only that newly restored file', async t => {
  const { directory, store } = await fixture(t), project = { id: 'missing', path: path.join(directory, 'project') }; await fs.mkdir(project.path);
  const file = path.join(project.path, 'lost.txt'); await fs.writeFile(file, 'restore me'); const snapshot = await takeSnapshot(project); await fs.unlink(file);
  const preview = await previewSnapshot(project, snapshot), result = await restoreSnapshot(project, snapshot, preview.digest, store);
  assert.equal(await fs.readFile(file, 'utf8'), 'restore me');
  const undo = store.get('snapshot', result.undo.id), undoPreview = await previewSnapshot(project, undo); await restoreSnapshot(project, undo, undoPreview.digest, store); await assert.rejects(fs.access(file));
});

test('snapshots reject path traversal and symbolic-link escapes', async t => {
  const { directory } = await fixture(t), project = { id: 'safe', path: path.join(directory, 'project') }; await fs.mkdir(project.path);
  const snapshot = { projectId: project.id, root: await fs.realpath(project.path), files: [{ path: '../outside.txt' }] };
  await assert.rejects(previewSnapshot(project, snapshot), /路径/);
  const external = path.join(directory, 'outside'); await fs.mkdir(external); await fs.writeFile(path.join(external, 'secret.txt'), 'outside');
  await fs.symlink(external, path.join(project.path, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(previewSnapshot(project, { ...snapshot, files: [{ path: 'link/secret.txt' }] }), /链接/);
});

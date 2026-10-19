import React, { useEffect, useRef, useState } from 'react';
import { Plus, X, ArrowUpRight, Send, Square, Loader2, AlertCircle, Sparkles, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from './api.mjs';
import { applyAppearance } from './Appearance.jsx';
import './quick-chat.css';

const sessionKey = 'agent-desk.companion-session';
const modelKey = 'agent-desk.companion-model';
const draftKey = 'agent-desk.companion-draft';
const label = model => model === 'deepseek-flash' ? 'DeepSeek V4.1 Flash' : model;
function Tool({ icon: Glyph, title, ...props }) { return <button type="button" className="icon-button" aria-label={title} title={title} {...props}><Glyph size={17} /></button>; }
export default function QuickChat() {
  const [ready, setReady] = useState(false), [providers, setProviders] = useState([]), [recent, setRecent] = useState([]);
  const [selection, setSelection] = useState(''), [session, setSession] = useState(null), [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState(() => localStorage.getItem(draftKey) || ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef(null), scroll = useRef(null), locked = useRef(false), nearBottom = useRef(true);
  const stopRequested = useRef(false), activeId = useRef(null);
  const options = providers.flatMap(provider => provider.models.map(model => ({ provider, model, key: JSON.stringify([provider.id, model]) })));
  const chosen = options.find(item => item.key === selection);
  const refresh = async () => { const rows = await api('/sessions'); setRecent(rows.filter(item => item.source === 'app' && !item.readOnly)); localStorage.setItem('agent-desk.sessions-changed', String(Date.now())); };
  const status = value => window.taolingChat?.status(value).catch(() => {});
  async function boot() {
    setError('');
    try {
      const data = await api('/bootstrap'); setProviders(data.providers);
      const appearance = await api('/appearance'); applyAppearance(appearance, matchMedia('(prefers-color-scheme: dark)').matches);
      const available = data.providers.flatMap(provider => provider.models.map(model => ({ key: JSON.stringify([provider.id, model]), provider })));
      const saved = localStorage.getItem(modelKey);
      setSelection(available.find(item => item.key === saved)?.key || available.find(item => item.provider.id === 'deepseek' && item.provider.configured)?.key || available.find(item => item.provider.configured)?.key || available[0]?.key || '');
      await refresh();
      const previous = localStorage.getItem(sessionKey);
      if (previous) {
        try {
          const value = await api('/sessions/' + encodeURIComponent(previous));
          if (!value.readOnly && !value.archived && value.source === 'app') { setSession(value); const key = JSON.stringify([value.providerId, value.model]); if (available.some(item => item.key === key)) setSelection(key); }
          else localStorage.removeItem(sessionKey);
        } catch { localStorage.removeItem(sessionKey); }
      }
      setReady(true); input.current?.focus();
    } catch (problem) { setError(problem.message); }
  }
  useEffect(() => { document.title = '桃铃 · 随手聊'; boot(); }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const sync = async () => {
      if (locked.current) return;
      try {
        const [models, rows, current] = await Promise.all([api('/providers'), api('/sessions'), session?.id ? api('/sessions/' + encodeURIComponent(session.id)) : null]);
        if (active && !locked.current) { setProviders(models); setRecent(rows.filter(item => item.source === 'app' && !item.readOnly)); if (current) setSession(current); }
      } catch (problem) { if (active) setError(problem.message); }
    };
    window.addEventListener('focus', sync);
    return () => { active = false; window.removeEventListener('focus', sync); };
  }, [ready, session?.id]);
  useEffect(() => { localStorage.setItem(draftKey, draft); }, [draft]);
  useEffect(() => { if (selection) localStorage.setItem(modelKey, selection); }, [selection]);
  useEffect(() => { if (nearBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [session?.messages?.at(-1)?.content, session?.messages?.at(-1)?.reasoning, session?.id]);
  async function openRecent(id) {
    if (locked.current) return;
    setError('');
    if (!id) { setSession(null); localStorage.removeItem(sessionKey); input.current?.focus(); return; }
    try { const value = await api('/sessions/' + encodeURIComponent(id)); setSession(value); localStorage.setItem(sessionKey, id); const key = JSON.stringify([value.providerId, value.model]); if (options.some(item => item.key === key)) setSelection(key); nearBottom.current = true; } catch (problem) { setError(problem.message); }
  }
  function fullWorkspace(models = false) {
    if (models) localStorage.setItem('agent-desk.open-view', 'models');
    else if (session) localStorage.setItem('agent-desk.open-session', session.id);
    window.taolingChat?.openMain().catch(problem => setError(problem.message));
  }
  async function send(event) {
    event.preventDefault();
    const content = draft.trim(); if (locked.current || !content || !chosen?.provider.configured) return;
    locked.current = true; stopRequested.current = false; activeId.current = session?.id || null; setBusy(true); setError(''); status('thinking'); nearBottom.current = true;
    let current = session, resultStatus = 'idle';
    try {
      if (!current) {
        current = await api('/sessions', { method: 'POST', body: { projectId: 'inbox', providerId: chosen.provider.id, model: chosen.model } });
        setSession(current); localStorage.setItem(sessionKey, current.id);
      }
      activeId.current = current.id;
      if (stopRequested.current) return;
      const response = await api(`/sessions/${encodeURIComponent(current.id)}/chat`, { method: 'POST', raw: true, body: { content, providerId: chosen.provider.id, model: chosen.model, thinking } });
      setDraft('');
      if (stopRequested.current) await api(`/sessions/${encodeURIComponent(current.id)}/stop`, { method: 'POST' });
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', completed = false;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n'); buffer = blocks.pop();
        for (const block of blocks) {
          const event = block.split('\n').find(line => line.startsWith('event: '))?.slice(7);
          const raw = block.split('\n').find(line => line.startsWith('data: '))?.slice(6); if (!raw) continue;
          const payload = JSON.parse(raw);
          if (event === 'start') setSession(previous => ({ ...previous, messages: [...previous.messages, ...(payload.user ? [payload.user] : []), payload.assistant] }));
          if (event === 'delta') setSession(previous => ({ ...previous, messages: previous.messages.map((item, index) => index === previous.messages.length - 1 ? { ...item, content: item.content + payload.content, reasoning: (item.reasoning || '') + payload.reasoning } : item) }));
          if (event === 'done') { completed = true; setSession(payload); const last = payload.messages.at(-1); resultStatus = last.status === 'complete' ? 'done' : last.error ? 'error' : 'idle'; if (last.error) setError(last.error); }
        }
      }
      if (!completed) throw new Error('连接已中断，已保存的内容仍在会话中');
    } catch (problem) {
      setError(problem.message); resultStatus = 'error';
      if (current) { try { const saved = await api('/sessions/' + encodeURIComponent(current.id)); setSession(saved); if (!saved.messages.length) setDraft(content); } catch {} }
    } finally {
      locked.current = false; activeId.current = null; setBusy(false); status(resultStatus);
      try { await refresh(); } catch (problem) { setError(problem.message); }
      input.current?.focus();
    }
  }
  async function stop() { stopRequested.current = true; if (activeId.current) { try { await api(`/sessions/${encodeURIComponent(activeId.current)}/stop`, { method: 'POST' }); } catch (problem) { setError(problem.message); } } }
  return <main className="quick-chat">
    <header className="quick-heading"><img src="/mascot/taoling-avatar.webp" alt="桃铃" /><div><h1>桃铃 · 随手聊</h1><span>{busy ? '正在回复…' : chosen ? label(chosen.model) : '准备中…'}</span></div><nav><Tool icon={Plus} title="新对话" disabled={busy || !ready} onClick={() => openRecent('')} /><Tool icon={ArrowUpRight} title="在工作台打开" onClick={() => fullWorkspace()} /><Tool icon={X} title="收起快捷对话" onClick={() => window.taolingChat?.close()} /></nav></header>
    <div className="quick-history"><select aria-label="继续最近的对话" value={recent.some(item => item.id === session?.id) ? session.id : ''} disabled={busy || !ready} onChange={event => openRecent(event.target.value)}><option value="">新对话</option>{recent.slice(0, 80).map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select><Tool icon={RefreshCw} title="刷新最近对话" disabled={busy || !ready} onClick={() => refresh().catch(problem => setError(problem.message))} /></div>
    {error && <div className="quick-error" role="alert"><AlertCircle size={15} /><span>{error}</span><Tool icon={X} title="关闭错误" onClick={() => setError('')} /></div>}
    <div className="quick-messages" ref={scroll} onScroll={event => { const el = event.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {!ready ? <div className="quick-empty">{error ? <button className="button" onClick={boot}><RefreshCw size={16} />重试</button> : <Loader2 className="spin" size={22} />}</div> : !session?.messages.length ? <div className="quick-empty"><img src="/mascot/taoling-avatar.webp" alt="" /><h2>今天想聊点什么？</h2>{chosen && !chosen.provider.configured && <button className="button" onClick={() => fullWorkspace(true)}>配置模型</button>}</div> : session.messages.map(message => <article key={message.id} className={`quick-message ${message.role}`}><div className="quick-byline">{message.role === 'user' ? '你' : label(message.model || session.model)}{['cancelled', 'interrupted'].includes(message.status) && <span>已中断</span>}</div>{message.reasoning && <details className="reasoning"><summary><Sparkles size={13} />思考过程</summary><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.reasoning}</ReactMarkdown></div></details>}<div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: props => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{message.content}</ReactMarkdown>{message.status === 'streaming' && <span className="stream-caret" />}</div>{message.warning && <p className="message-warning">{message.warning}</p>}</article>)}
    </div>
    <form className="quick-composer" onSubmit={send}><textarea ref={input} aria-label="快捷对话消息" placeholder="和我说说吧…" rows={3} maxLength={60000} value={draft} disabled={!ready} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} /><div className="quick-compose-tools"><select aria-label="快捷对话模型" value={selection} disabled={busy || !ready} onChange={event => setSelection(event.target.value)}>{options.map(item => <option value={item.key} key={item.key}>{item.provider.name} / {label(item.model)}{item.provider.configured ? '' : ' · 未配置'}</option>)}</select>{chosen?.provider.thinking && <label className="quick-thinking" title="深度思考"><input type="checkbox" aria-label="深度思考" checked={thinking} onChange={event => setThinking(event.target.checked)} disabled={busy} /><Sparkles size={15} /></label>}{busy ? <Tool icon={Square} title="停止回复" onClick={stop} /> : <button type="submit" className="quick-send icon-button" aria-label="发送快捷消息" title="发送" disabled={!ready || !draft.trim() || !chosen?.provider.configured}><Send size={18} /></button>}</div></form>
  </main>;
}

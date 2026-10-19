import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Search, Plus, Folder, FolderOpen, MessageSquare, ListTodo, Settings2, ChevronDown, ChevronRight, PanelRight, PanelLeft, Pin, Archive, GitBranch, Copy, Download, RotateCcw, Send, Square, X, Check, CheckCircle2, Circle, Clock3, Camera, Loader2, RefreshCw, ExternalLink, MoreHorizontal, Pencil, ArrowLeft, Server, Trash2, Menu, Sparkles, Terminal, AlertCircle, HardDrive, KeyRound } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './style.css';
import Appearance, { applyAppearance } from './Appearance.jsx';
import { DEFAULT_APPEARANCE, wallpaperUrl, resolveSkin } from '../shared/skins.mjs';
import './themes.css';
import { Palette } from 'lucide-react';
import { api } from './api.mjs';
import QuickChat from './QuickChat.jsx';
const stamp = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const size = bytes => bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const sourceName = source => ({ claude: 'Claude CLI', codex: 'Codex CLI', app: '工作台' })[source] || source;
const statusNames = { todo: '待办', doing: '进行中', done: '已完成' };
const modelName = model => ({ 'deepseek-flash': 'DeepSeek V4.1 Flash', 'deepseek-v4-pro': 'DeepSeek V4 Pro', 'kimi-k2.5': 'Kimi K2.5', 'qwen-plus': 'Qwen Plus', 'qwen-turbo': 'Qwen Turbo' })[model] || model;

function IconButton({ icon: Icon, title, children, className = '', ...props }) { return <button type="button" className={`icon-button ${className}`} title={title} aria-label={title} {...props}><Icon size={17} />{children}</button>; }
function Modal({ title, children, close, wide = false }) {
  useEffect(() => { const handler = event => { if (event.key === 'Escape') close(); }; window.addEventListener('keydown', handler); const previous = document.activeElement; return () => { window.removeEventListener('keydown', handler); previous?.focus(); }; }, [close]);
  const box = useRef(null);
  useEffect(() => { const target = box.current?.querySelector('input,textarea,select') || box.current?.querySelector('button'); target?.focus(); }, []);
  function trap(event) {
    if (event.key !== 'Tab') return;
    const nodes = [...box.current.querySelectorAll('input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled),a[href]')], first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section ref={box} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? 'wide' : ''}`} onKeyDown={trap}><header><h2>{title}</h2><IconButton icon={X} title="关闭" onClick={close} /></header>{children}</section></div>;
}

function ProviderForm({ provider, save, close, run }) {
  const [form, setForm] = useState({ name: provider?.name || '', protocol: provider?.protocol || 'chat-completions', baseUrl: provider?.baseUrl || '', models: provider?.models.join('\n') || '', apiKey: '', requiresKey: provider?.requiresKey !== false, thinking: provider?.thinking || false });
  const [saving, setSaving] = useState(false);
  const field = (name, value) => setForm(previous => ({ ...previous, [name]: value }));
  return <Modal title={provider ? `配置 ${provider.name}` : '添加模型服务商'} close={close}><form onSubmit={event => { event.preventDefault(); setSaving(true); run(async () => { await save({ ...form, id: provider?.id, models: form.models.split(/[\n,，]+/).map(x => x.trim()).filter(Boolean) }); close(); }).finally(() => setSaving(false)); }}>
    <label>服务商名称<input required value={form.name} onChange={event => field('name', event.target.value)} placeholder="服务商名称" /></label>
    <label>API 协议<select aria-label="API 协议" value={form.protocol} onChange={event => field('protocol', event.target.value)}><option value="chat-completions">Chat Completions 兼容接口</option><option value="openai-responses">OpenAI Responses · GPT</option><option value="anthropic">Anthropic Messages · Claude</option></select></label>
    <label>API Base URL<input required type="url" value={form.baseUrl} onChange={event => field('baseUrl', event.target.value)} placeholder="https://api.example.com/v1" /></label>
    <label>API Key<input type="password" autoComplete="new-password" value={form.apiKey} onChange={event => field('apiKey', event.target.value)} placeholder={provider?.configured ? '已配置，留空保留现有密钥' : '输入 API Key'} /></label>
    <label>模型 ID<textarea required rows={3} value={form.models} onChange={event => field('models', event.target.value)} placeholder="deepseek-flash" /></label>
    <label className="check-line"><input type="checkbox" checked={form.requiresKey} onChange={event => field('requiresKey', event.target.checked)} />接口需要 API Key</label>
    <label className="check-line"><input type="checkbox" checked={form.thinking} onChange={event => field('thinking', event.target.checked)} />支持可选推理设置</label>
    <footer><button type="button" className="button" onClick={close}>取消</button><button className="button primary" disabled={saving}>{saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}保存</button></footer>
  </form></Modal>;
}

function App() {
  const [ready, setReady] = useState(false), [providers, setProviders] = useState([]), [projects, setProjects] = useState([]), [sessions, setSessions] = useState([]), [tasks, setTasks] = useState([]);
  const [appearance, setAppearance] = useState(DEFAULT_APPEARANCE), [previewAppearance, setPreviewAppearance] = useState(null), [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const visibleAppearance = previewAppearance || appearance;
  const characterSkin = ['character', 'mascot'].includes(resolveSkin(visibleAppearance).layout) && Boolean(wallpaperUrl(visibleAppearance));
  useEffect(() => { const media = matchMedia('(prefers-color-scheme: dark)'), change = event => setSystemDark(event.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => { applyAppearance(visibleAppearance, systemDark); }, [visibleAppearance, systemDark]);
  const [view, setView] = useState('chat'), [projectId, setProjectId] = useState(''), [session, setSession] = useState(null), [query, setQuery] = useState(''), [source, setSource] = useState(''), [archived, setArchived] = useState(false);
  const [selectedModel, setSelectedModel] = useState(['deepseek', 'deepseek-flash']), [thinking, setThinking] = useState(false), [draft, setDraft] = useState(''), [taskDraft, setTaskDraft] = useState('');
  const [busy, setBusy] = useState(''), [importing, setImporting] = useState(false), [error, setError] = useState(''), [toast, setToast] = useState(''), [modal, setModal] = useState(null), [snapshots, setSnapshots] = useState([]), [snapshotBusy, setSnapshotBusy] = useState(false);
  const [showDetail, setShowDetail] = useState(window.innerWidth >= 1250), [mobileNav, setMobileNav] = useState(false), [mobileList, setMobileList] = useState(false), [dataDirectory, setDataDirectory] = useState('');
  useEffect(() => { if (appearance.skinId === 'taoling' || ['character', 'mascot'].includes(resolveSkin(appearance).layout)) setShowDetail(false); }, [appearance.skinId]);
  const wasGenerating = useRef(false);
  useEffect(() => {
    const desktop = window.agentDeskDesktop; if (!desktop) return;
    const status = busy ? 'thinking' : error ? 'error' : wasGenerating.current && session?.messages.at(-1)?.status === 'complete' ? 'done' : 'idle';
    wasGenerating.current = Boolean(busy);
    desktop.setCompanionStatus(status).catch(() => {});
  }, [busy, error]);
  const scrollRef = useRef(null), draftRef = useRef(null), currentRef = useRef(null), scrollNearBottom = useRef(true);
  currentRef.current = session?.id;
  const activeProject = projects.find(x => x.id === (session?.projectId || projectId)) || projects.find(x => x.id === 'inbox');
  const projectTasks = tasks.filter(x => x.projectId === activeProject?.id);
  const modelOptions = providers.flatMap(provider => provider.models.map(model => ({ provider, model })));
  const selectedProvider = providers.find(x => x.id === selectedModel[0]);
  const counts = { all: sessions.length, tasks: tasks.filter(x => x.status !== 'done').length };
  const run = async fn => { setError(''); try { return await fn(); } catch (problem) { setError(problem.message); return null; } };
  const notify = message => setToast(message);
  const loadProviders = async () => setProviders(await api('/providers'));
  const loadSessions = async () => { const params = new URLSearchParams({ q: query, projectId, source, archived: String(archived) }); setSessions(await api('/sessions?' + params)); };
  const loadTasks = async () => setTasks(await api('/tasks'));
  const loadProjects = async () => setProjects(await api('/projects'));
  const openSession = async item => {
    const value = await api('/sessions/' + encodeURIComponent(item.id)); setSession(value); setView('chat'); setDraft(''); setMobileList(false); scrollNearBottom.current = true;
    localStorage.setItem('agent-desk.session', value.id);
    if (value.source === 'app') setSelectedModel([value.providerId, value.model]);
  };
  useEffect(() => { (async () => {
    try {
      const boot = await api('/bootstrap'); setProviders(boot.providers); setProjects(boot.projects); setDataDirectory(boot.dataDirectory);
      setAppearance(await api('/appearance'));
      const initialSessions = await api('/sessions'); setSessions(initialSessions); setTasks(await api('/tasks')); setReady(true);
      const previous = localStorage.getItem('agent-desk.session');
      if (initialSessions.some(x => x.id === previous)) await openSession({ id: previous });
    } catch (problem) { setError(problem.message); }
  })(); }, []);
  useEffect(() => {
    if (!ready) return;
    const resume = () => run(async () => {
      await loadSessions();
      if (localStorage.getItem('agent-desk.open-view') === 'models') { localStorage.removeItem('agent-desk.open-view'); setView('models'); return; }
      const requested = localStorage.getItem('agent-desk.open-session');
      if (requested) { localStorage.removeItem('agent-desk.open-session'); await openSession({ id: requested }); }
      else if (!busy && currentRef.current) setSession(await api('/sessions/' + encodeURIComponent(currentRef.current)));
    });
    window.addEventListener('focus', resume);
    const changed = event => { if (['agent-desk.open-session', 'agent-desk.open-view'].includes(event.key) && event.newValue) resume(); else if (event.key === 'agent-desk.sessions-changed') run(loadSessions); };
    window.addEventListener('storage', changed);
    return () => { window.removeEventListener('focus', resume); window.removeEventListener('storage', changed); };
  }, [ready, busy, query, projectId, source, archived]);
  useEffect(() => { if (!ready) return; const timer = setTimeout(() => run(loadSessions), 180); return () => clearTimeout(timer); }, [query, projectId, source, archived, ready]);
  useEffect(() => { if (!activeProject?.id || !ready) return; let cancelled = false; api(`/projects/${encodeURIComponent(activeProject.id)}/snapshots`).then(value => { if (!cancelled) setSnapshots(value); }).catch(problem => setError(problem.message)); return () => { cancelled = true; }; }, [activeProject?.id, ready]);
  useEffect(() => { if (scrollNearBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [session?.id, session?.messages?.at(-1)?.content, session?.messages?.at(-1)?.reasoning]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);

  async function createSession() {
    const value = await api('/sessions', { method: 'POST', body: { projectId: projectId || activeProject?.id || 'inbox', providerId: selectedModel[0], model: selectedModel[1] } });
    setSession(value); setView('chat'); setDraft(''); setMobileNav(false); setMobileList(false); localStorage.setItem('agent-desk.session', value.id); await loadSessions(); return value;
  }
  async function patchSession(values) {
    const value = await api('/sessions/' + encodeURIComponent(session.id), { method: 'PATCH', body: values }); setSession(value); await loadSessions(); return value;
  }
  async function selectModel(value) {
    const parsed = JSON.parse(value); setSelectedModel(parsed);
    if (session && !session.readOnly && !busy) await patchSession({ providerId: parsed[0], model: parsed[1] });
  }
  async function branch(message, include = true, regenerate = false, editedText = '') {
    const value = await api(`/sessions/${encodeURIComponent(session.id)}/branch`, { method: 'POST', body: { messageId: message.id, include } });
    setSession(value); setSelectedModel([value.providerId, value.model]); setView('chat'); setMobileList(false); scrollNearBottom.current = true; localStorage.setItem('agent-desk.session', value.id); await loadSessions();
    if (regenerate) await sendMessage(value, true); else if (editedText) { setDraft(editedText); draftRef.current?.focus(); }
    else notify('已创建分支，原对话已保留');
  }
  async function sendMessage(target, regenerate = false) {
    if (busy) return;
    const content = draft.trim(); if (!regenerate && !content) return;
    setBusy(target?.id || 'new'); setError('');
    let current = target;
    try {
      if (!current) current = await createSession();
      const response = await api(`/sessions/${encodeURIComponent(current.id)}/chat`, { method: 'POST', raw: true, body: { content, model: regenerate ? current.model : selectedModel[1], providerId: regenerate ? current.providerId : selectedModel[0], thinking, regenerate } });
      setBusy(current.id); setDraft(''); scrollNearBottom.current = true;
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n'); buffer = blocks.pop();
        for (const block of blocks) {
          const event = block.split('\n').find(x => x.startsWith('event: '))?.slice(7), data = block.split('\n').find(x => x.startsWith('data: '))?.slice(6);
          if (!data) continue; const payload = JSON.parse(data);
          if (event === 'start') setSession(previous => previous?.id === current.id ? { ...previous, messages: [...previous.messages, ...(payload.user ? [payload.user] : []), payload.assistant] } : previous);
          if (event === 'delta') setSession(previous => previous?.id === current.id ? { ...previous, messages: previous.messages.map((message, index) => index === previous.messages.length - 1 ? { ...message, content: message.content + payload.content, reasoning: (message.reasoning || '') + payload.reasoning } : message) } : previous);
          if (event === 'done') { setSession(previous => previous?.id === current.id ? payload : previous); if (payload.messages.at(-1)?.error) setError(payload.messages.at(-1).error); }
        }
      }
    } catch (problem) {
      setError(problem.message);
      if (current) { try { const saved = await api('/sessions/' + encodeURIComponent(current.id)); setSession(previous => previous?.id === current.id ? saved : previous); if (!saved.messages.length) setDraft(content); } catch {} }
    } finally { setBusy(''); await run(loadSessions); }
  }
  async function importSessions() {
    setImporting(true); try { const result = await api('/import', { method: 'POST', body: {} }); await Promise.all([loadSessions(), loadProjects()]); notify(`导入 ${result.imported} 个会话，跳过 ${result.skipped} 个${result.errors ? `，${result.errors} 个文件读取失败` : ''}${result.limited ? '（达到本次扫描上限）' : ''}`); } finally { setImporting(false); }
  }
  async function addTask(event) {
    event.preventDefault(); if (!taskDraft.trim()) return;
    await api('/tasks', { method: 'POST', body: { title: taskDraft, projectId: activeProject?.id || 'inbox', sessionId: session?.id || null } }); setTaskDraft(''); await loadTasks();
  }
  async function taskStatus(task, status) {
    setTasks(previous => previous.map(item => item.id === task.id ? { ...item, status } : item));
    try { await api('/tasks/' + task.id, { method: 'PATCH', body: { status } }); }
    catch (problem) { await loadTasks(); throw problem; }
  }
  async function newSnapshot(name) {
    setSnapshotBusy(true); try { await api(`/projects/${encodeURIComponent(activeProject.id)}/snapshots`, { method: 'POST', body: { name } }); setSnapshots(await api(`/projects/${encodeURIComponent(activeProject.id)}/snapshots`)); setModal(null); notify('文件快照已保存'); } finally { setSnapshotBusy(false); }
  }
  async function previewSnapshot(snapshot) { setSnapshotBusy(true); try { setModal({ type: 'restore', value: await api(`/snapshots/${snapshot.id}/preview`), confirmed: false }); } finally { setSnapshotBusy(false); } }
  async function restoreFiles() {
    setSnapshotBusy(true); try { const result = await api(`/snapshots/${modal.value.snapshot.id}/restore`, { method: 'POST', body: { digest: modal.value.digest } }); setModal(null); setSnapshots(await api(`/projects/${encodeURIComponent(activeProject.id)}/snapshots`)); notify(`已恢复 ${result.restored} 个文件，恢复前快照已保存`); } finally { setSnapshotBusy(false); }
  }
  async function exportSession() { const response = await api(`/sessions/${encodeURIComponent(session.id)}/export`, { raw: true }), url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = session.title.replace(/[<>:"/\\|?*]/g, '_') + '.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function copyResume() {
    if (!/^[a-zA-Z0-9-]+$/.test(session.sourceId)) throw new Error('会话 ID 无效');
    const quoted = value => "'" + value.replace(/'/g, "''") + "'";
    await navigator.clipboard.writeText(`Set-Location -LiteralPath ${quoted(session.cwd)}; ${session.source === 'codex' ? 'codex resume' : 'claude --resume'} ${quoted(session.sourceId)}`); notify('CLI 恢复命令已复制');
  }
  function chooseProject(value) { setProjectId(value); setSession(null); setView('chat'); setMobileNav(false); }

  if (!ready && !error) return <div className="loading"><img src="/mascot/taoling-avatar.webp" alt="桃铃" /><Loader2 className="spin" size={22} /></div>;
  return <><div className="app-wallpaper" aria-hidden="true">{wallpaperUrl(visibleAppearance) && <img src={wallpaperUrl(visibleAppearance)} alt="" />}<div /></div><div className="app-shell">
    {(mobileNav || mobileList) && <div className="drawer-scrim" onClick={() => { setMobileNav(false); setMobileList(false); }} />}
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setView('chat'); }}><img src="/mascot/taoling-avatar.webp" alt="桃铃" /><span>Agent Desk<small>桃铃 · 本地工作台</small></span></a>
      <button className="button primary new-chat" onClick={() => run(createSession)} disabled={Boolean(busy)}><Plus size={18} /><span>新建对话</span></button>
      <nav aria-label="主导航">
        <button className={view === 'chat' ? 'nav-item active' : 'nav-item'} onClick={() => { setView('chat'); setMobileNav(false); }}><MessageSquare size={17} /><span>会话</span><span className="count">{counts.all}</span></button>
        <button className={view === 'tasks' ? 'nav-item active' : 'nav-item'} onClick={() => { setView('tasks'); setMobileNav(false); }}><ListTodo size={17} /><span>任务</span><span className="count">{counts.tasks}</span></button>
        <button className={view === 'models' ? 'nav-item active' : 'nav-item'} onClick={() => { setView('models'); setMobileNav(false); }}><Server size={17} /><span>模型服务</span></button>
      </nav>
      <div className="sidebar-label"><span>项目</span><IconButton icon={Plus} title="添加项目" onClick={() => setModal({ type: 'project' })} /></div>
      <div className="project-list"><button className={`project-item ${!projectId ? 'selected' : ''}`} onClick={() => chooseProject('')}><FolderOpen size={16} /><span>全部项目</span></button>{projects.map(project => <button className={`project-item ${projectId === project.id ? 'selected' : ''}`} key={project.id} onClick={() => chooseProject(project.id)} title={project.path || project.name}><Folder size={16} /><span>{project.name}</span></button>)}</div>
      <div className="sidebar-bottom"><button className={`nav-item ${view === 'appearance' ? 'active' : ''}`} onClick={() => { setView('appearance'); setMobileNav(false); }}><Palette size={17} /><span>外观与皮肤</span><span className="skin-nav-dot" /></button><button className="nav-item" onClick={() => run(importSessions)} disabled={importing}>{importing ? <Loader2 size={17} className="spin" /> : <Download size={17} />}<span>{importing ? '正在导入…' : '导入 CLI 历史'}</span></button><div className="local-status" title={dataDirectory}><span className="status-dot" />本地存储<small>v0.5</small></div></div>
    </aside>

    {view === 'chat' && <aside className={`session-list ${mobileList ? 'mobile-open' : ''}`}>
      <header className="list-heading"><h2>会话记录</h2><IconButton icon={RefreshCw} title="刷新会话" onClick={() => run(loadSessions)} /></header>
      <div className="search-box"><Search size={16} /><input aria-label="搜索对话记录" placeholder="搜索对话记录" value={query} onChange={event => setQuery(event.target.value)} />{query && <IconButton icon={X} title="清除搜索" onClick={() => setQuery('')} />}</div>
      <div className="list-filters"><select aria-label="会话来源" value={source} onChange={event => setSource(event.target.value)}><option value="">全部来源</option><option value="app">工作台</option><option value="claude">Claude CLI</option><option value="codex">Codex CLI</option></select><label title="显示已归档会话"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />归档</label></div>
      <div className="session-items">{sessions.length ? sessions.map(item => <button key={item.id} className={`session-item ${session?.id === item.id ? 'selected' : ''}`} onClick={() => run(() => openSession(item))}><div className="session-title">{item.parentId ? <GitBranch size={14} /> : <MessageSquare size={14} />}<strong>{item.title}</strong>{item.pinned && <Pin size={13} />}</div><p>{item.preview || '尚无消息'}</p><div className="session-meta"><span className={`source-badge ${item.source}`}>{sourceName(item.source)}</span><time>{stamp(item.updatedAt)}</time></div></button>) : <div className="empty-list"><Search size={25} /><p>{query ? '没有匹配的记录' : '还没有会话记录'}</p><button className="text-button" onClick={() => run(importSessions)} disabled={importing}>导入 CLI 历史</button></div>}</div>
      <div className="list-foot">{sessions.length} 个会话 <span>·</span> {projects.length} 个项目</div>
    </aside>}

    <main className="main-area" data-view={view}>
      <div className="mobile-toolbar"><IconButton icon={Menu} title="打开导航" onClick={() => setMobileNav(true)} /><span>Agent Desk</span>{view === 'chat' && <IconButton icon={PanelLeft} title="会话列表" onClick={() => setMobileList(true)} />}</div>
      {error && <div className="error-banner" role="alert"><AlertCircle size={16} /><span>{error}</span><IconButton icon={X} title="关闭错误提示" onClick={() => setError('')} /></div>}
      {view === 'chat' && <div className="conversation-layout"><section className="conversation">
        <header className="conversation-header"><div className="conversation-heading"><div className="eyebrow">{activeProject?.name || '个人工作区'} {session?.source && <><span>/</span>{sourceName(session.source)}</>}</div><h1>{session?.title || '工作台'}</h1></div><div className="header-actions">{session && <><IconButton icon={Pencil} title="重命名对话" onClick={() => setModal({ type: 'rename', text: session.title })} /><IconButton icon={Pin} title={session.pinned ? '取消置顶' : '置顶对话'} className={session.pinned ? 'is-active' : ''} onClick={() => run(() => patchSession({ pinned: !session.pinned }))} /><IconButton icon={Download} title="导出 Markdown" onClick={() => run(exportSession)} /><IconButton icon={Archive} title={session.archived ? '取消归档' : '归档对话'} onClick={() => run(() => patchSession({ archived: !session.archived }))} /></>}<IconButton icon={PanelRight} title="项目详情" onClick={() => setShowDetail(!showDetail)} /></div></header>
        {session?.parentId && <button className="branch-origin" onClick={() => run(() => openSession({ id: session.parentId }))}><GitBranch size={14} /><span>分支会话</span><span className="muted">查看原对话</span><ChevronRight size={14} /></button>}
        {characterSkin && <div className="character-banner"><img src={wallpaperUrl(visibleAppearance)} alt="皮肤角色插画" /><span>{resolveSkin(visibleAppearance).name}</span></div>}
        <div className="messages" ref={scrollRef} onScroll={event => { const el = event.currentTarget; scrollNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }}>
          {!session?.messages.length ? <div className="conversation-empty"><img src="/mascot/taoling-avatar.webp" alt="桃铃" /><h2>{session ? '新对话' : 'Agent Desk'}</h2><div className="empty-state-label"><span className="status-dot" />{selectedProvider?.configured ? modelName(selectedModel[1]) : '等待配置模型'}</div><div className="empty-actions"><button className="button" onClick={() => run(importSessions)} disabled={importing}><Download size={16} />导入历史</button><button className="button" onClick={() => setView('models')}><Settings2 size={16} />模型设置</button></div></div> : session.messages.map((message, index) => <article className={`message ${message.role}`} key={message.id}>
            <div className="message-avatar">{message.role === 'user' ? '我' : <img src="/mascot/taoling-avatar.webp" alt="助手" />}</div><div className="message-body"><div className="message-byline"><strong>{message.role === 'user' ? '你' : modelName(message.model || session.model || '助手')}</strong><time>{stamp(message.createdAt)}</time>{['cancelled', 'interrupted'].includes(message.status) && <span className="muted">已中断</span>}</div>
              {message.reasoning && <details className="reasoning"><summary><Sparkles size={13} />思考过程</summary><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.reasoning}</ReactMarkdown></div></details>}
              <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: props => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{message.content}</ReactMarkdown>{message.status === 'streaming' && <span className="stream-caret" />}</div>
              {message.tools?.length > 0 && <details className="tools"><summary><Terminal size={13} />{message.tools.length} 次工具调用</summary><code>{message.tools.join(' · ')}</code></details>}
              {message.error && <p className="message-error"><AlertCircle size={14} />{message.error}</p>}
              {message.warning && <p className="message-warning"><AlertCircle size={14} />{message.warning}</p>}
              <div className="message-actions"><IconButton icon={Copy} title="复制消息" onClick={() => run(async () => { await navigator.clipboard.writeText(message.content); notify('消息已复制'); })} /><IconButton icon={GitBranch} title="从此处分支" disabled={Boolean(busy)} onClick={() => run(() => branch(message))} />{message.role === 'user' && <IconButton icon={Pencil} title="修改并分支" disabled={Boolean(busy)} onClick={() => setModal({ type: 'edit', message, text: message.content })} />}{message.role === 'assistant' && index === session.messages.length - 1 && <IconButton icon={RotateCcw} title="重新生成（保留原分支）" disabled={Boolean(busy)} onClick={() => run(() => branch(message, false, true))} />}<IconButton icon={ListTodo} title="加入任务" onClick={() => run(async () => { await api('/tasks', { method: 'POST', body: { title: message.content.replace(/\s+/g, ' ').slice(0, 160) || '新任务', projectId: session.projectId, sessionId: session.id } }); await loadTasks(); notify('已加入项目任务'); })} /></div>
            </div></article>)}
        </div>
        {session?.readOnly ? <div className="imported-composer"><span className="source-badge">{sourceName(session.source)}</span><button className="button" onClick={() => run(copyResume)}><Copy size={15} />复制 CLI 恢复命令</button><button className="button primary" disabled={!session.messages.length || Boolean(busy)} onClick={() => run(() => branch(session.messages.at(-1)))}><GitBranch size={15} />分支到工作台</button></div> : <form className="composer-wrap" onSubmit={event => { event.preventDefault(); sendMessage(session); }}><div className="composer"><textarea ref={draftRef} aria-label="消息" placeholder="发送消息…" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy) sendMessage(session); } }} rows={3} /><div className="composer-toolbar"><select className="model-select" aria-label="选择模型" disabled={Boolean(busy)} value={JSON.stringify(selectedModel)} onChange={event => run(() => selectModel(event.target.value))}>{modelOptions.map(({ provider, model }) => <option key={JSON.stringify([provider.id, model])} value={JSON.stringify([provider.id, model])}>{provider.name} / {modelName(model)}</option>)}</select>{selectedProvider?.thinking && <label className="thinking-toggle"><input type="checkbox" checked={thinking} onChange={event => setThinking(event.target.checked)} /><Sparkles size={14} /><span>深度思考</span></label>}<div className="composer-spacer" />{busy ? <IconButton className="send-button stop" icon={Square} title="停止生成" onClick={() => run(() => api(`/sessions/${encodeURIComponent(busy)}/stop`, { method: 'POST', body: {} }))} /> : <button className="send-button" aria-label="发送消息" title="发送消息" disabled={!draft.trim() || !selectedProvider?.configured}><Send size={18} /></button>}</div></div><div className="composer-status"><span><span className={`status-dot ${busy ? 'working' : ''}`} />{busy ? '正在生成' : selectedProvider?.configured ? '已连接配置' : '模型未配置'}</span><span>{session?.messages.length || 0} 条消息 · 本地记录</span></div></form>}
      </section>
      {showDetail && <aside className="detail-panel"><header><h2>项目详情</h2><IconButton icon={X} title="关闭项目详情" onClick={() => setShowDetail(false)} /></header><div className="project-context"><FolderOpen size={20} /><strong>{activeProject?.name}</strong><small title={activeProject?.path}>{activeProject?.path || '未绑定本地文件夹'}</small></div><div className="section-heading"><h3>任务</h3><span>{projectTasks.filter(x => x.status === 'done').length}/{projectTasks.length}</span></div><form className="task-input" onSubmit={event => run(() => addTask(event))}><input aria-label="新任务" placeholder="添加任务" value={taskDraft} onChange={event => setTaskDraft(event.target.value)} /><IconButton icon={Plus} title="添加任务" type="submit" disabled={!taskDraft.trim()} /></form><div className="mini-tasks">{projectTasks.slice(0, 20).map(task => <div className={`mini-task ${task.status}`} key={task.id}><input type="checkbox" aria-label={`完成 ${task.title}`} checked={task.status === 'done'} onChange={() => run(() => taskStatus(task, task.status === 'done' ? 'todo' : 'done'))} /><span>{task.title}</span><select aria-label={`${task.title} 状态`} value={task.status} onChange={event => run(() => taskStatus(task, event.target.value))}>{Object.entries(statusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>)}{!projectTasks.length && <p className="subtle-empty">暂无任务</p>}</div><div className="section-heading snapshot-heading"><h3>文件快照</h3><IconButton icon={Camera} title={activeProject?.path ? '创建文件快照' : '需要绑定本地项目文件夹'} disabled={!activeProject?.path || snapshotBusy} onClick={() => setModal({ type: 'snapshot', text: `快照 ${stamp(new Date())}` })} /></div><div className="snapshot-list">{snapshots.map(snapshot => <button key={snapshot.id} className="snapshot-item" onClick={() => run(() => previewSnapshot(snapshot))} disabled={snapshotBusy}><span className="snapshot-tick" /><span><strong>{snapshot.name}</strong><small>{stamp(snapshot.createdAt)} · {snapshot.fileCount} 个文件</small></span><RotateCcw size={14} /></button>)}{!snapshots.length && <p className="subtle-empty">暂无快照</p>}</div></aside>}
      {characterSkin && <div className="character-stage" aria-hidden="true"><img src={wallpaperUrl(visibleAppearance)} alt="" /><span>{resolveSkin(visibleAppearance).name}</span></div>}
      </div>}

      {view === 'models' && <section className="workspace-page"><header className="page-heading"><div><div className="eyebrow">连接</div><h1>模型服务</h1></div><button className="button primary" onClick={() => setModal({ type: 'provider' })}><Plus size={16} />添加服务商</button></header><div className="provider-table">{providers.map(provider => <div className="provider-row" key={provider.id}><div className="provider-monogram" style={{ color: provider.color }}>{provider.name.slice(0, 1)}</div><div className="provider-description"><h2>{provider.name}<span className={`connection-badge ${provider.configured ? 'connected' : ''}`}>{provider.configured ? '已配置' : '未配置'}</span></h2><div className="provider-url">{provider.baseUrl}</div><div className="provider-models">{provider.models.map(model => <code key={model}>{model}</code>)}</div>{provider.credentialSource && <small><KeyRound size={12} />{provider.credentialSource}</small>}</div><div className="provider-actions"><IconButton icon={RefreshCw} title={`获取 ${provider.name} 模型列表`} disabled={!provider.configured} onClick={() => run(async () => { const result = await api(`/providers/${provider.id}/models`, { method: 'POST', body: {} }); await loadProviders(); notify(`已获取 ${result.models.length} 个模型`); })} /><button className="button" onClick={() => setModal({ type: 'provider', provider })}><Settings2 size={15} />配置</button></div></div>)}</div><div className="storage-row"><HardDrive size={18} /><div><strong>本地数据库</strong><code>{dataDirectory}</code></div></div></section>}

      {view === 'tasks' && <section className="workspace-page"><header className="page-heading"><div><div className="eyebrow">{projectId ? projects.find(x => x.id === projectId)?.name : '全部项目'}</div><h1>任务</h1></div><button className="button primary" onClick={() => setModal({ type: 'task', text: '' })}><Plus size={16} />新建任务</button></header><div className="task-board">{Object.entries(statusNames).map(([status, name]) => { const items = tasks.filter(task => task.status === status && (!projectId || task.projectId === projectId)); const StatusIcon = { todo: Circle, doing: Clock3, done: CheckCircle2 }[status]; return <section className={`task-column ${status}`} key={status}><header><StatusIcon size={16} /><h2>{name}</h2><span>{items.length}</span></header>{items.map(task => <article className="task-card" key={task.id}><h3>{task.title}</h3><small>{projects.find(x => x.id === task.projectId)?.name}</small><div><select aria-label={`${task.title} 状态`} value={task.status} onChange={event => run(() => taskStatus(task, event.target.value))}>{Object.entries(statusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{task.sessionId && <IconButton icon={MessageSquare} title="打开关联对话" onClick={() => run(() => openSession({ id: task.sessionId }))} />}<IconButton icon={Trash2} title="删除任务" onClick={() => run(async () => { await api(`/tasks/${task.id}`, { method: 'DELETE' }); await loadTasks(); })} /></div></article>)}{!items.length && <div className="board-empty">暂无任务</div>}</section>; })}</div></section>}
      {view === 'appearance' && <Appearance value={appearance} preview={setPreviewAppearance} notify={notify} save={async next => { const saved = await api('/appearance', { method: 'PUT', body: next }); setAppearance(saved); return saved; }} />}
    </main>
    {toast && <div className="toast" role="status"><CheckCircle2 size={17} />{toast}</div>}

    {modal?.type === 'provider' && <ProviderForm provider={modal.provider} close={() => setModal(null)} run={run} save={async value => { await api('/providers', { method: 'POST', body: value }); await loadProviders(); notify('模型配置已保存'); }} />}
    {modal?.type === 'project' && <Modal title="新建项目" close={() => setModal(null)}><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); run(async () => { const value = await api('/projects', { method: 'POST', body: { name: form.get('name'), path: form.get('path') } }); await loadProjects(); chooseProject(value.id); setModal(null); }); }}><label>项目名称<input name="name" required placeholder="项目名称" /></label><label>本地文件夹<input name="path" placeholder="C:\Projects\my-project" /></label><footer><button className="button primary"><Plus size={16} />创建项目</button></footer></form></Modal>}
    {['rename', 'edit', 'snapshot', 'task'].includes(modal?.type) && <Modal title={{ rename: '重命名对话', edit: '修改消息并创建分支', snapshot: '创建文件快照', task: '新建任务' }[modal.type]} close={() => setModal(null)}><form onSubmit={event => { event.preventDefault(); run(async () => { if (modal.type === 'rename') { await patchSession({ title: modal.text }); setModal(null); } if (modal.type === 'edit') { await branch(modal.message, false, false, modal.text); setModal(null); } if (modal.type === 'snapshot') await newSnapshot(modal.text); if (modal.type === 'task') { await api('/tasks', { method: 'POST', body: { title: modal.text, projectId: projectId || activeProject?.id || 'inbox', sessionId: session?.id || null } }); await loadTasks(); setModal(null); } }); }}><label>{{ rename: '对话名称', edit: '消息', snapshot: '快照名称', task: '任务名称' }[modal.type]}{modal.type === 'edit' ? <textarea required rows={6} value={modal.text} onChange={event => setModal({ ...modal, text: event.target.value })} /> : <input required value={modal.text} onChange={event => setModal({ ...modal, text: event.target.value })} />}</label><footer><button className="button" type="button" onClick={() => setModal(null)}>取消</button><button className="button primary" disabled={snapshotBusy}>{snapshotBusy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}确认</button></footer></form></Modal>}
    {modal?.type === 'restore' && <Modal title="预览文件恢复" wide close={() => { if (!snapshotBusy) setModal(null); }}><div className="restore-body"><div className="restore-meta"><strong>{modal.value.snapshot.name}</strong><code>{modal.value.snapshot.root}</code><span>{modal.value.changes.length} 个文件有变化</span></div><div className="patch-list">{modal.value.changes.map(change => <details key={change.path}><summary><span className={`file-action ${change.action}`}>{{ modify: 'M', create: 'A', delete: 'D' }[change.action]}</span><code>{change.path}</code><small>{size(change.beforeSize)} → {size(change.afterSize)}</small></summary>{change.patch ? <pre>{change.patch}</pre> : <p className="muted">{change.binary ? '二进制文件' : '文件内容较大，不显示逐行差异'}</p>}</details>)}{!modal.value.changes.length && <p className="subtle-empty">当前文件与快照一致</p>}</div>{modal.value.changes.length > 0 && <div className="restore-confirmation"><p>恢复前会保存可撤销快照。未纳入快照的新文件不会删除。</p><label className="check-line"><input type="checkbox" checked={modal.confirmed} onChange={event => setModal({ ...modal, confirmed: event.target.checked })} />确认恢复以上 {modal.value.changes.length} 个文件</label></div>}</div><footer><button className="button" onClick={() => setModal(null)} disabled={snapshotBusy}>取消</button><button className="button danger" disabled={!modal.confirmed || snapshotBusy} onClick={() => run(restoreFiles)}>{snapshotBusy ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />}恢复这些文件</button></footer></Modal>}
  </div></>;
}

createRoot(document.getElementById('root')).render(new URLSearchParams(location.search).get('companion') === 'chat' ? <QuickChat /> : <App />);

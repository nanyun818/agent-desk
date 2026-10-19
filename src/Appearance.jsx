import React, { useEffect, useRef, useState } from 'react';
import { Palette, Sun, Moon, Monitor, Check, Download, Upload, RotateCcw, ImagePlus, ImageOff, X, Loader2, Trash2, SlidersHorizontal, CheckCircle2 } from 'lucide-react';
import { BUILTIN_SKINS, DEFAULT_APPEARANCE, normalizeSkin, normalizeAppearance, resolveSkin, skinTokens, wallpaperUrl, exportSkin } from '../shared/skins.mjs';

export function applyAppearance(settings, systemDark) {
  const dark = settings.mode === 'dark' || settings.mode === 'system' && systemDark;
  const tokens = skinTokens(resolveSkin(settings), dark, settings.accent);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty('--ui-' + name, value);
  root.style.setProperty('--ui-panel', hexAlpha(tokens.surface, settings.opacity));
  root.style.setProperty('--ui-sidebar-panel', hexAlpha(tokens.sidebar, settings.opacity));
  root.style.setProperty('--ui-font-size', settings.fontSize + 'px');
  root.style.setProperty('--wallpaper-blur', settings.blur + 'px');
  root.style.setProperty('--glass-blur', settings.glassBlur + 'px');
  root.style.setProperty('--wallpaper-dim', settings.dim / 100);
  root.dataset.colorScheme = dark ? 'dark' : 'light';
  root.dataset.skin = settings.skinId;
  root.dataset.layout = ['character', 'mascot'].includes(resolveSkin(settings).layout) && wallpaperUrl(settings) ? 'character' : 'standard';
  root.dataset.artFit = resolveSkin(settings).layout === 'mascot' ? 'contain' : 'cover';
  root.dataset.density = settings.density;
  root.dataset.wallpaper = wallpaperUrl(settings) ? 'yes' : 'no';
  root.style.colorScheme = dark ? 'dark' : 'light';
}
function hexAlpha(hex, opacity) { return hex + Math.round(opacity / 100 * 255).toString(16).padStart(2, '0'); }
function Icon({ icon: Glyph, title, ...props }) { return <button type="button" className="icon-button" title={title} aria-label={title} {...props}><Glyph size={17} /></button>; }
function SkinPreview({ skin, active = false }) {
  const dark = skin.appearance === 'dark', t = skinTokens(skin, dark);
  return <div className={`skin-preview ${active ? 'large' : ''} ${['character', 'mascot'].includes(skin.layout) ? 'character' : ''} ${skin.layout === 'mascot' ? 'cutout' : ''}`} style={{ '--preview-surface': t.surface, '--preview-sidebar': t.sidebar, '--preview-accent': t.accent, '--preview-line': t.line, backgroundColor: t.sidebar }}>
    {skin.wallpaper && <img src={skin.wallpaper} alt="" loading="lazy" />}
    <div className="preview-nav"><span /><i /><i /><i /></div><div className="preview-list"><i /><i /><i /></div><div className="preview-chat"><div className="preview-top" /><div className="preview-answer"><i /><i /><i /></div><div className="preview-input"><span /></div></div>
  </div>;
}
export default function Appearance({ value, preview, save, notify }) {
  const [draft, setDraft] = useState(value), [tab, setTab] = useState('builtin'), [saving, setSaving] = useState(false), [working, setWorking] = useState(false), [problem, setProblem] = useState('');
  const [companion, setCompanion] = useState(null);
  useEffect(() => {
    const desktop = window.agentDeskDesktop; if (!desktop) return;
    let active = true;
    desktop.getCompanionState().then(state => { if (active) setCompanion(state); }).catch(error => { if (active) setProblem(error.message); });
    const unsubscribe = desktop.onCompanionState(state => { if (active) setCompanion(state); });
    return () => { active = false; unsubscribe(); };
  }, []);
  async function petChange(action, next) { try { const state = await window.agentDeskDesktop[action](next); setCompanion(state); } catch (error) { setProblem(error.message); } }
  const fileInput = useRef(null), packageInput = useRef(null);
  const saved = useRef(value); saved.current = value;
  useEffect(() => { preview(draft); }, [draft]);
  useEffect(() => () => preview(null), []);
  const skin = resolveSkin(draft), dirty = JSON.stringify(draft) !== JSON.stringify(value);
  const skins = tab === 'builtin' ? BUILTIN_SKINS : draft.customSkins;
  const field = (name, next) => setDraft(previous => ({ ...previous, [name]: next }));
  function selectSkin(item) {
    setDraft(previous => ({ ...previous, skinId: item.id, mode: item.appearance, accent: '', wallpaper: previous.wallpaper.type === 'custom' ? previous.wallpaper : { type: 'skin' }, ...(item.id === 'taoling' ? { wallpaper: { type: 'skin' }, opacity: 84, blur: 0, glassBlur: 0, dim: 0 } : ['character', 'mascot'].includes(item.layout) ? { wallpaper: { type: 'skin' }, opacity: item.layout === 'mascot' ? 96 : 94, blur: 0, glassBlur: 0, dim: 0 } : {}) }));
  }
  async function persist() {
    setSaving(true); setProblem('');
    try { const next = await save(normalizeAppearance(draft)); setDraft(next); notify('外观已保存'); } catch (error) { setProblem(error.message); } finally { setSaving(false); }
  }
  async function uploadImage(file) {
    if (!file) return;
    setWorking(true); setProblem('');
    let bitmap;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('请选择不超过 20 MB 的 PNG、JPEG 或 WebP 图片');
      bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 64000000) throw new Error('图片像素过大，请使用较小的图片');
      const ratio = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataURL = canvas.toDataURL('image/webp', .82);
      if (dataURL.length > 2800000) throw new Error('压缩后壁纸仍大于 2 MB，请选择较小的图片');
      field('wallpaper', { type: 'custom', dataURL, name: file.name });
    } catch (error) { setProblem(error.message); } finally { bitmap?.close(); setWorking(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function importPackage(file) {
    if (!file) return;
    setProblem('');
    try {
      if (file.size > 3 * 1024 * 1024) throw new Error('皮肤包不能超过 3 MB');
      const input = JSON.parse(await file.text()), normalized = normalizeSkin(input);
      if (draft.customSkins.length >= 24) throw new Error('最多保存 24 套自定义皮肤');
      const id = 'user-' + crypto.randomUUID();
      const next = normalizeAppearance({ ...draft, skinId: id, accent: '', customSkins: [...draft.customSkins, { ...normalized, id }], wallpaper: input.format && input.wallpaper?.type === 'custom' ? input.wallpaper : { type: 'none' } });
      setDraft(next); setTab('custom'); notify('皮肤包已导入预览');
    } catch (error) { setProblem(error instanceof SyntaxError ? '无法读取 JSON 皮肤包' : error.message); } finally { if (packageInput.current) packageInput.current.value = ''; }
  }
  async function downloadPackage() {
    setProblem('');
    try {
      const data = exportSkin(draft);
      if (draft.wallpaper.type === 'skin' && wallpaperUrl(draft)) {
        const response = await fetch(wallpaperUrl(draft)); if (!response.ok) throw new Error('无法导出壁纸');
        const blob = await response.blob();
        const dataURL = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
        data.wallpaper = { type: 'custom', dataURL, name: skin.name + '.webp' };
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `${skin.name.replace(/[<>:"/\\|?*]/g, '_')}.agent-desk-skin.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setProblem(error.message || '导出失败'); }
  }
  function removeSkin(id) { setDraft(previous => ({ ...previous, skinId: previous.skinId === id ? 'studio' : previous.skinId, customSkins: previous.customSkins.filter(item => item.id !== id) })); }
  return <section className="workspace-page appearance-page">
    <header className="page-heading"><div><div className="eyebrow"><Palette size={13} />个性化</div><h1>外观与皮肤</h1></div><div className="appearance-tools"><Icon icon={Upload} title="导入皮肤包" onClick={() => packageInput.current?.click()} /><Icon icon={Download} title="导出当前皮肤" onClick={downloadPackage} /><Icon icon={RotateCcw} title="恢复默认外观" onClick={() => { setDraft({ ...structuredClone(DEFAULT_APPEARANCE), customSkins: draft.customSkins }); setProblem(''); }} /></div></header>
    <input className="visually-hidden" ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择壁纸文件" onChange={event => uploadImage(event.target.files[0])} />
    <input className="visually-hidden" ref={packageInput} type="file" accept=".json,application/json" aria-label="选择皮肤包文件" onChange={event => importPackage(event.target.files[0])} />
    {problem && <div className="appearance-error" role="alert"><span>{problem}</span><Icon icon={X} title="关闭外观错误" onClick={() => setProblem('')} /></div>}
    <div className="appearance-layout"><div className="skin-library">
      <div className="appearance-section-heading"><div className="segmented" role="tablist" aria-label="皮肤来源"><button role="tab" aria-selected={tab === 'builtin'} onClick={() => setTab('builtin')}>精选皮肤<span>{BUILTIN_SKINS.length}</span></button><button role="tab" aria-selected={tab === 'custom'} onClick={() => setTab('custom')}>我的皮肤<span>{draft.customSkins.length}</span></button></div></div>
      <div className="skin-grid">{skins.map(item => <article className={`skin-card ${draft.skinId === item.id ? 'chosen' : ''}`} key={item.id}><button className="skin-choice" aria-label={`选择皮肤 ${item.name}`} aria-pressed={draft.skinId === item.id} onClick={() => selectSkin(item)}><SkinPreview skin={item} /><div className="skin-caption"><span><strong>{item.name}</strong><small>{item.subtitle || '自定义配色'}</small></span><span className="skin-check">{draft.skinId === item.id && <Check size={14} />}</span></div></button>{item.id.startsWith('user-') && <div className="skin-delete"><Icon icon={Trash2} title={`删除皮肤 ${item.name}`} onClick={() => removeSkin(item.id)} /></div>}</article>)}</div>
      {!skins.length && <div className="skin-empty"><Palette size={24} /><span>暂无自定义皮肤</span><button className="button" onClick={() => packageInput.current?.click()}><Upload size={15} />导入皮肤包</button></div>}
      <section className="appearance-section"><div className="appearance-section-heading"><h2>壁纸</h2><span className="appearance-caption">{draft.wallpaper.type === 'custom' ? draft.wallpaper.name : draft.wallpaper.type === 'none' ? '无壁纸' : '随皮肤'}</span></div>
        <div className="wallpaper-controls"><div className="wallpaper-thumbnail">{wallpaperUrl(draft) ? <img src={wallpaperUrl(draft)} alt="当前壁纸" /> : <ImageOff size={22} />}</div><div className="wallpaper-actions"><button className="button" disabled={working} onClick={() => fileInput.current?.click()}>{working ? <Loader2 size={15} className="spin" /> : <ImagePlus size={15} />}导入壁纸</button><div className="wallpaper-modes"><button className="text-button" aria-pressed={draft.wallpaper.type === 'skin'} onClick={() => field('wallpaper', { type: 'skin' })}>随皮肤</button><button className="text-button" aria-pressed={draft.wallpaper.type === 'none'} onClick={() => field('wallpaper', { type: 'none' })}>无壁纸</button></div></div></div>
        <Range label="界面不透明度" value={draft.opacity} min={70} max={100} suffix="%" onChange={v => field('opacity', v)} />
        <Range label="玻璃模糊" value={draft.glassBlur} min={0} max={30} suffix="px" onChange={v => field('glassBlur', v)} />
        <Range label="背景压暗" value={draft.dim} min={0} max={60} suffix="%" disabled={!wallpaperUrl(draft)} onChange={v => field('dim', v)} />
        <Range label="背景模糊" value={draft.blur} min={0} max={16} suffix="px" disabled={!wallpaperUrl(draft)} onChange={v => field('blur', v)} />
      </section>
    </div><aside className="appearance-inspector"><div className="appearance-current"><SkinPreview skin={{ ...skin, ...(draft.wallpaper.type === 'custom' ? { wallpaper: draft.wallpaper.dataURL } : draft.wallpaper.type === 'none' ? { wallpaper: '' } : {}) }} active /><div><span className="appearance-caption">当前皮肤</span><strong>{skin.name}</strong><span className="appearance-caption">{skin.source || (skin.id.startsWith('user-') ? '本地皮肤包' : 'Agent Desk 原创')}</span></div></div>
      {companion && <section className="appearance-section companion-settings"><h2>桌面伙伴</h2><div className="companion-profile"><img src="/mascot/taoling-mini.png" alt="桃铃 mini" /><div><strong>桃铃<small>桃桃 / Taoling</small></strong><label className="check-line"><input type="checkbox" checked={companion.enabled} onChange={event => petChange('setCompanionEnabled', event.target.checked)} />显示桃铃桌宠</label><label className="check-line"><input type="checkbox" checked={companion.motion} onChange={event => petChange('setCompanionMotion', event.target.checked)} />轻动效果</label></div></div><Range label="桌宠大小" value={companion.size} min={140} max={300} suffix="px" onChange={v => petChange('setCompanionSize', v)} /></section>}
      <section className="appearance-section"><h2>明暗模式</h2><div className="segmented mode-segmented" role="group" aria-label="明暗模式">{[['light', Sun, '浅色'], ['dark', Moon, '深色'], ['system', Monitor, '系统']].map(([mode, Glyph, title]) => <button key={mode} aria-pressed={draft.mode === mode} onClick={() => field('mode', mode)}><Glyph size={14} />{title}</button>)}</div></section>
      <section className="appearance-section"><div className="appearance-section-heading"><h2>强调色</h2><button className="text-button" onClick={() => field('accent', '')}>重置</button></div><div className="accent-swatches">{[skin.seeds.accent, '#278579', '#3c73b0', '#a8466f', '#a3672c', '#6c6990'].filter((v, i, all) => all.indexOf(v) === i).map(color => <button className="color-swatch" key={color} style={{ background: color }} title={`强调色 ${color}`} aria-label={`强调色 ${color}`} aria-pressed={(draft.accent || skin.seeds.accent) === color} onClick={() => field('accent', color)}>{(draft.accent || skin.seeds.accent) === color && <Check size={12} />}</button>)}<label className="custom-color" title="自定义强调色"><SlidersHorizontal size={14} /><input type="color" aria-label="自定义强调色" value={draft.accent || skin.seeds.accent} onChange={event => field('accent', event.target.value)} /></label></div></section>
      <section className="appearance-section"><h2>排版</h2><div className="density-row"><span>界面密度</span><div className="segmented" role="group" aria-label="界面密度"><button aria-pressed={draft.density === 'comfortable'} onClick={() => field('density', 'comfortable')}>舒适</button><button aria-pressed={draft.density === 'compact'} onClick={() => field('density', 'compact')}>紧凑</button></div></div><Range label="对话字号" value={draft.fontSize} min={13} max={18} suffix="px" onChange={v => field('fontSize', v)} /></section>
    </aside></div>
    <footer className="appearance-savebar"><span><CheckCircle2 size={15} />{dirty ? '预览中 · 未保存' : '外观已保存'}</span><div><button className="button" disabled={!dirty || saving} onClick={() => { setDraft(saved.current); setProblem(''); }}>取消更改</button><button className="button primary" disabled={!dirty || saving || working} onClick={persist}>{saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}保存外观</button></div></footer>
  </section>;
}
function Range({ label, value, min, max, suffix, onChange, disabled = false }) { return <label className={`appearance-range ${disabled ? 'disabled' : ''}`}><span>{label}<output>{value}{suffix}</output></span><input type="range" min={min} max={max} step={1} value={value} disabled={disabled} aria-label={label} onChange={event => onChange(Number(event.target.value))} /></label>; }

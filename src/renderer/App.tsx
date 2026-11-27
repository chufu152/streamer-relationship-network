import { useEffect, useRef, useState } from 'react';
import { useProjectSession } from './useProjectSession';
import { addPerson, deletePerson, setPersonPhoto, validateName } from '../shared/operations';
import { GraphCanvas } from './GraphCanvas';
import { Modal } from './Modal';
import { processPhoto } from './photo';
import { fitPeople, toWorld, zoomAt } from '../shared/geometry';
import { connectPeople } from '../shared/relationships';
import { RelationshipEditor } from './RelationshipEditor';

type Connection = 'preview' | 'connecting' | 'connected' | 'failed';

function NetworkMark() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m8 7 8 4M7 9l2 8m7-4-5 5" /><circle cx="6" cy="6" r="3" /><circle cx="18" cy="12" r="3" /><circle cx="10" cy="20" r="2.5" /></svg>;
}

export function App() {
  const [photoBusy, setPhotoBusy] = useState(false);
  const [message, setMessage] = useState('');
  const { project, revision, savedRevision, path, saving, transitioning, updateProject, saveProject, changeProject } = useProjectSession(window.desktop, setMessage, photoBusy);
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [relationshipId, setRelationshipId] = useState<string | null>(null);
  const [connectTarget, setConnectTarget] = useState('');
  const editingRelationship = project.relationships.find((relation) => relation.id === relationshipId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [connection, setConnection] = useState<Connection>(window.desktop ? 'connecting' : 'preview');
  const workspace = useRef<HTMLElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const editingPerson = project.people.find((person) => person.id === editingId);

  useEffect(() => {
    let active = true;
    if (window.desktop) void window.desktop.getAppInfo().then(
      () => { if (active) setConnection('connected'); },
      () => { if (active) setConnection('failed'); },
    );
    return () => { active = false; };
  }, []);

  // The window title carries what the in-page toolbar shows: which file is open and whether it is dirty.
  useEffect(() => {
    document.title = (path ? `${revision !== savedRevision ? '● ' : ''}${path.split(/[\\/]/).at(-1)} — ` : '') + '人物交际网';
  }, [path, revision, savedRevision]);

  // Keyboard refinements: F2 renames the selected person, arrow keys nudge it (Shift = 1 px).
  // They only apply while the focus is inside the canvas area, never while a dialog is open.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || transitioning) return;
      const target = event.target as HTMLElement | null;
      if (!target || !target.closest('main') || !selectedId) return;
      if (event.key === 'F2') { event.preventDefault(); editPerson(selectedId); return; }
      const step = event.shiftKey ? 1 : 10;
      const deltas: Record<string, { x: number; y: number } | undefined> = {
        ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
      };
      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();
      updateProject((current) => ({ ...current, people: current.people.map((person) => person.id === selectedId ? { ...person, x: person.x + delta.x / current.viewport.zoom, y: person.y + delta.y / current.viewport.zoom } : person) }));
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  async function switchProject(action: 'new' | 'open') {
    if (await changeProject(action)) { setSelectedId(null); setEditingId(null); setRelationshipId(null); setName(''); }
  }

  function editPerson(id: string) {
    const person = project.people.find((item) => item.id === id)!;
    setSelectedId(id); setEditingId(id); setRelationshipId(null); setConnectTarget(''); setDraftName(person.name); setConfirmDelete(false); setMessage('');
  }

  function add() {
    if (composing.current) return;
    try {
      const rect = workspace.current!.getBoundingClientRect();
      const next = addPerson(project, name, toWorld({ x: rect.width / 2, y: (rect.height - 70) / 2 }, project.viewport));
      updateProject(() => next); setName(''); setMessage('');
      setSelectedId(next.people.at(-1)!.id); nameInput.current?.focus();
    } catch (error) { setMessage((error as Error).message); }
  }

  async function upload(file: File) {
    const id = editingId!;
    setPhotoBusy(true); setMessage('正在处理照片…');
    try {
      const asset = await processPhoto(file);
      updateProject((current) => setPersonPhoto(current, id, asset)); setMessage('照片已更新，尚未保存到文件');
    } catch (error) { setMessage((error as Error).message); }
    finally { setPhotoBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  function connect(source: string, target: string) {
    try {
      const result = connectPeople(project, source, target);
      setEditingId(null);
      if (result.created) { updateProject(() => result.project); setMessage('关系已创建；右键连线设置方向和名称，尚未保存到文件'); }
      else { setRelationshipId(result.relationshipId); setMessage(''); }
    } catch (error) { setMessage((error as Error).message); }
  }

  function zoom(factor: number) {
    const rect = workspace.current!.getBoundingClientRect();
    updateProject((current) => ({ ...current, viewport: zoomAt(current.viewport, current.viewport.zoom * factor, { x: rect.width / 2, y: (rect.height - 70) / 2 }) }));
  }

  function fit() {
    const rect = workspace.current!.getBoundingClientRect();
    const result = fitPeople(project.people, rect.width, rect.height - 70);
    updateProject((current) => ({ ...current, viewport: result.viewport }));
    setMessage(result.limited ? '已缩小到 25%，人物过于分散，请平移查看或移动人物后重试' : '');
  }

  const connectionLabel = { preview: '浏览器预览', connecting: '正在连接桌面环境…', connected: '桌面环境已连接', failed: '桌面连接失败，请重新启动应用' }[connection];

  return (
    <div className="app-shell" inert={transitioning} aria-busy={saving || transitioning}>
      <header className="toolbar">
        <div className="identity"><span className="brand-mark"><NetworkMark /></span><span className="brand-name">人物交际网</span><span className="toolbar-divider" aria-hidden="true" />
          <div className="project-heading"><span className="project-title" title={path || project.title}>{path ? path.split(/[\\/]/).at(-1) : project.title}</span><span className="project-state">{transitioning ? '正在处理…' : saving ? '正在保存…' : revision !== savedRevision ? '未保存' : path ? '已保存' : '空白项目'}</span></div>
        </div>
        <nav className="file-actions" aria-label="项目文件">
          <button type="button" disabled={!window.desktop || saving || photoBusy} onClick={() => void switchProject('new')}>新建</button><button type="button" disabled={!window.desktop || saving || photoBusy} onClick={() => void switchProject('open')}>打开</button><button type="button" disabled={!window.desktop || saving || photoBusy} onClick={() => void saveProject(true)}>另存为</button>
          <button className="save-button" type="button" disabled={!window.desktop || saving || photoBusy} onClick={() => void saveProject()}>保存<span className="shortcut" aria-hidden="true">Ctrl S</span></button>
        </nav>
      </header>
      <main ref={workspace} className="workspace" aria-label="人物关系画布">
        <GraphCanvas project={project} selectedId={selectedId} onSelect={setSelectedId} onEditPerson={editPerson}
          onMove={(id, point) => updateProject((current) => ({ ...current, people: current.people.map((person) => person.id === id ? { ...person, ...point } : person) }))}
          onViewport={(viewport) => updateProject((current) => ({ ...current, viewport }))}
          onConnect={connect} onEditRelationship={(id) => { setRelationshipId(id); setEditingId(null); setMessage(''); }} />
        {!project.people.length && <div className="empty-state"><h1>从第一个人物开始</h1><p>在下方输入名字，添加第一个人物。</p><span className="empty-note">右键人物或点击“编辑人物”，为他们添加照片。</span></div>}
        {selectedId && <div className="selection-tools"><button onClick={() => editPerson(selectedId)}>编辑人物</button></div>}
        <div className="canvas-footer">
          <p className="graph-count" aria-label="画布统计"><span>{project.people.length} 人物</span><span className="count-divider" aria-hidden="true" /><span>{project.relationships.length} 关系</span></p>
          <div className="zoom-controls" role="group" aria-label="画布视图">
            <button type="button" disabled={project.viewport.zoom <= 0.25} onClick={() => zoom(1 / 1.2)} aria-label="缩小"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10" /></svg></button><span className="zoom-value">{Math.round(project.viewport.zoom * 100)}%</span>
            <button type="button" disabled={project.viewport.zoom >= 2} onClick={() => zoom(1.2)} aria-label="放大"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10M10 5v10" /></svg></button><span className="zoom-divider" aria-hidden="true" /><button type="button" onClick={fit} className="fit-button">适应全部</button>
          </div>
        </div>
      </main>
      <footer className="bottom-bar">
        <div className="environment" role={connection === 'failed' ? 'alert' : 'status'}><span className={`connection-dot ${connection}`} aria-hidden="true" /><span>{connectionLabel}</span></div>
        <form className="person-form" onSubmit={(event) => { event.preventDefault(); add(); }}>
          <label htmlFor="person-name" className="sr-only">人物姓名</label><input ref={nameInput} id="person-name" name="person-name" type="text" placeholder="输入人物姓名" value={name} onChange={(event) => setName(event.target.value)}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={(event) => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing)) event.preventDefault(); }} aria-describedby="stage-notice" autoComplete="off" />
          <button type="submit" className="add-button">添加人物</button>
        </form><span id="stage-notice" className="stage-notice">长按人物移动 · 滚轮平移 · Ctrl + 滚轮缩放 · 方向键微调</span>
      </footer>
      {message && <div className={`toast ${editingId || relationshipId ? 'in-dialog' : ''}`} role="alert">{message}</div>}
      {editingPerson && <Modal title="编辑人物" onClose={() => { if (!photoBusy) setEditingId(null); }}>
        <form onSubmit={(event) => { event.preventDefault(); try { const value = validateName(draftName); updateProject((current) => ({ ...current, people: current.people.map((person) => person.id === editingId ? { ...person, name: value } : person) })); setEditingId(null); setMessage(''); } catch (error) { setMessage((error as Error).message); } }}>
          <label className="field-label" htmlFor="edit-name">人物姓名</label><input id="edit-name" data-autofocus value={draftName} onChange={(event) => setDraftName(event.target.value)} disabled={photoBusy} />
          <p className="field-hint">支持重名，最多 40 个字符。人物身份不会因改名而改变。</p>
          <div className="photo-actions"><button type="button" disabled={photoBusy} onClick={() => fileInput.current?.click()}>{photoBusy ? '正在处理…' : editingPerson.photoAssetId ? '更换照片' : '上传照片'}</button>
            {editingPerson.photoAssetId && <button type="button" disabled={photoBusy} onClick={() => updateProject((current) => setPersonPhoto(current, editingPerson.id, null))}>移除照片</button>}
            <input ref={fileInput} aria-label="选择人物照片" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
          </div><p className="field-hint">PNG、JPEG、WebP，最大 10 MiB。照片更换会立即应用。</p>
          <label htmlFor="connect-target" className="field-label">连接到人物</label>
          <div className="connect-actions"><select id="connect-target" value={connectTarget} onChange={(event) => setConnectTarget(event.target.value)} disabled={photoBusy}>
            <option value="">选择另一个人物</option>{project.people.filter((person) => person.id !== editingId).map((person) => <option key={person.id} value={person.id}>{person.name} · {person.id.slice(0, 8)}</option>)}
          </select><button type="button" disabled={!connectTarget || photoBusy} onClick={() => connect(editingPerson.id, connectTarget)}>创建关系</button></div>
          <div className="related-list">{project.relationships.filter((relation) => relation.sourceId === editingId || relation.targetId === editingId).map((relation) => {
            const other = project.people.find((person) => person.id === (relation.sourceId === editingId ? relation.targetId : relation.sourceId))!;
            return <button type="button" key={relation.id} disabled={photoBusy} onClick={() => { setRelationshipId(relation.id); setEditingId(null); }}>{relation.label || '未命名关系'} · {other.name} · {other.id.slice(0, 8)}</button>;
          })}</div>
          {message && <p className="dialog-message" role="status">{message}</p>}
          {confirmDelete ? <div className="delete-confirm"><p>删除「{editingPerson.name}」及 {project.relationships.filter((relation) => relation.sourceId === editingId || relation.targetId === editingId).length} 条关联关系？</p><button type="button" className="danger" onClick={() => { updateProject((current) => deletePerson(current, editingPerson.id)); setEditingId(null); setSelectedId(null); }}>确认删除</button><button type="button" onClick={() => setConfirmDelete(false)}>保留人物</button></div>
            : <button type="button" className="text-danger" disabled={photoBusy} onClick={() => setConfirmDelete(true)}>删除人物</button>}
          <div className="modal-actions"><button type="button" disabled={photoBusy} onClick={() => setEditingId(null)}>取消</button><button className="primary" disabled={photoBusy}>应用姓名</button></div>
        </form>
      </Modal>}
      {editingRelationship && <RelationshipEditor key={editingRelationship.id} project={project} relationship={editingRelationship} busy={saving} message={message}
        onClose={() => { if (!saving) setRelationshipId(null); }}
        onApply={async (direction, label) => {
          updateProject((current) => ({ ...current, relationships: current.relationships.map((relation) => relation.id === relationshipId ? { ...relation, direction, label } : relation) }));
          if (window.desktop) { if (await saveProject()) setRelationshipId(null); }
          else { setRelationshipId(null); setMessage('关系已应用；请在桌面应用中保存到本地文件'); }
        }}
        onDelete={() => { updateProject((current) => ({ ...current, relationships: current.relationships.filter((relation) => relation.id !== relationshipId) })); setRelationshipId(null); }} />}
    </div>
  );
}

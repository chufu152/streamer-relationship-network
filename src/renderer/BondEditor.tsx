import { useMemo, useState } from 'react';
import { BOND_COLORS, type NetworkProject } from '../shared/project';
import { Modal } from './Modal';

export function BondEditor({ project, bondId, onClose, onCreate, onRename, onToggleMember, onSetColor, onDelete }: {
  project: NetworkProject; bondId: string | null;
  onClose: () => void;
  onCreate: (id: string, name: string) => void;
  onRename: (bondId: string, name: string) => void;
  onToggleMember: (bondId: string, personId: string) => void;
  onSetColor: (bondId: string, color: string) => void;
  onDelete: (bondId: string) => void;
}) {
  const [name, setName] = useState('');
  const [draftName, setDraftName] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [currentId, setCurrentId] = useState<string | null>(bondId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const photos = useMemo(() => new Map(project.assets.map((asset) => [asset.id, `data:image/webp;base64,${asset.dataBase64}`] as const)), [project.assets]);
  const bond = project.bonds.find((item) => item.id === currentId) ?? null;
  function submit() {
    try {
      if (bond) { onRename(bond.id, draftName ?? bond.name); setDraftName(null); setError(''); }
      else { const id = crypto.randomUUID(); onCreate(id, name); setCurrentId(id); setName(''); setError(''); }
    } catch (cause) { setError((cause as Error).message); }
  }
  function remove() {
    if (!currentId) return;
    onDelete(currentId);
    setCurrentId(null); setConfirmDelete(false);
  }
  return <Modal title="羁绊" onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <label className="field-label" htmlFor="bond-name">羁绊名</label>
      <div className="bond-create">
        <input id="bond-name" data-autofocus value={bond ? draftName ?? bond.name : name} onChange={(event) => bond ? setDraftName(event.target.value) : setName(event.target.value)} placeholder={bond ? '修改后点击“修改名称”应用' : '例如：家人、同事'} />
        <button type="submit" className="primary">{bond ? '修改名称' : '新建羁绊'}</button>
      </div>
      {error && <p className="dialog-message" role="alert">{error}</p>}
      {bond ? <>
        <div className="bond-colors" role="group" aria-label="虚线颜色">
          <span className="field-label">虚线颜色</span>
          {BOND_COLORS.map((color) => <button type="button" key={color} aria-label={`虚线颜色 ${color}`} aria-pressed={bond.color.toLowerCase() === color} className={`bond-color ${bond.color.toLowerCase() === color ? 'is-active' : ''}`} style={{ background: color }} onClick={() => onSetColor(bond.id, color)} />)}
        </div>
        <div className="bond-current">
          <span className="bond-current-name">{bond.name}</span><span className="bond-current-count">{bond.memberIds.length} 名成员</span>
          {confirmDelete ? <span className="delete-confirm"><span>确认删除羁绊？人物保留。</span><button type="button" className="danger" onClick={remove}>确认删除</button><button type="button" onClick={() => setConfirmDelete(false)}>保留羁绊</button></span>
            : <button type="button" className="text-danger" onClick={() => setConfirmDelete(true)}>删除羁绊</button>}
        </div>
        {project.people.length
          ? <div className="bond-member-grid">{project.people.map((person) => {
              const asset = person.photoAssetId ? photos.get(person.photoAssetId) : undefined;
              const member = bond.memberIds.includes(person.id);
              return <button type="button" key={person.id} aria-pressed={member} className={`bond-member ${member ? 'is-member' : ''}`}
                title={member ? `点击把 ${person.name} 移出羁绊` : `点击把 ${person.name} 加入羁绊`}
                onClick={() => onToggleMember(bond.id, person.id)}>
                {asset ? <img src={asset} alt="" draggable={false} /> : <span className="bond-member-initial" aria-hidden="true">{Array.from(person.name)[0] ?? '?'}</span>}
                <span className="bond-member-name">{person.name}</span>
              </button>;
            })}</div>
        : <p className="field-hint">画布还没有人物：先在底部输入姓名添加人物，再回来把他们加入羁绊。</p>}
      </> : <p className="field-hint">输入羁绊名并点击“新建羁绊”，然后在下方把已有人物加入或移出。建好后左上角会出现羁绊徽标，点击徽标可随时回来修改。</p>}
      <div className="modal-actions"><button type="button" onClick={onClose}>完成</button></div>
    </form>
  </Modal>;
}

import { useState } from 'react';
import { relationshipSchema, type Direction, type NetworkProject, type Relationship } from '../shared/project';
import { Modal } from './Modal';

export function RelationshipEditor({ project, relationship, message, onApply, onDelete, onClose }: {
  project: NetworkProject; relationship: Relationship; message: string;
  onApply: (direction: Direction, label: string) => void; onDelete: () => void; onClose: () => void;
}) {
  const [direction, setDirection] = useState(relationship.direction);
  const [label, setLabel] = useState(relationship.label);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const source = project.people.find((person) => person.id === relationship.sourceId)!;
  const target = project.people.find((person) => person.id === relationship.targetId)!;
  return <Modal title="编辑关系" onClose={onClose}>
    <form onSubmit={(event) => {
      event.preventDefault();
      const parsed = relationshipSchema.shape.label.safeParse(label.trim());
      if (!parsed.success) { setError('关系名称最多 40 个字符'); return; }
      onApply(direction, parsed.data);
    }}>
      <fieldset className="editor-fields">
      <p className="field-hint endpoint-names">A：{source.name} · {source.id.slice(0, 8)}<br />B：{target.name} · {target.id.slice(0, 8)}</p>
      <fieldset className="direction-options"><legend>箭头方向</legend>
        {([['forward', 'A → B'], ['reverse', 'A ← B'], ['both', 'A ↔ B']] as const).map(([value, text]) => <label key={value}><input type="radio" name="direction" value={value} checked={direction === value} onChange={() => setDirection(value)} />{text}</label>)}
      </fieldset>
      <p className="field-hint">A、B 固定对应上述人物，不随画布左右位置改变。</p>
      <label htmlFor="relationship-label" className="field-label">关系名称</label>
      <input id="relationship-label" data-autofocus value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：朋友、同事（可留空）" />
      {error && <p className="dialog-message" role="alert">{error}</p>}
      {deleting ? <div className="delete-confirm"><p>确认删除这条关系？人物将保留。</p><button type="button" className="danger" onClick={onDelete}>确认删除关系</button><button type="button" onClick={() => setDeleting(false)}>保留关系</button></div>
        : <button type="button" className="text-danger" onClick={() => setDeleting(true)}>删除关系</button>}
      <p className="field-hint">{window.desktop ? '保存只把这条关系的方向和名称应用到画布；写入本地文件请使用顶部的“保存”或 Ctrl S。' : '浏览器仅供预览；在桌面应用中可保存到本地文件。'}</p>
      {message && <p className="dialog-message" role="status">{message}</p>}
      <div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button className="primary">保存</button></div>
      </fieldset>
    </form>
  </Modal>;
}

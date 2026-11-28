import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasGestures } from './useCanvasGestures';
import { GraphEdges } from './GraphEdges';
import type { Point, Viewport } from '../shared/geometry';
import type { NetworkProject, Person } from '../shared/project';

export type CanvasProps = {
  project: NetworkProject;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEditPerson: (id: string) => void;
  onMove: (id: string, point: Point) => void;
  onViewport: (viewport: Viewport) => void;
  onConnect: (source: string, target: string) => void;
  onEditRelationship: (id: string) => void;
  onDeleteBond: (id: string) => void;
  onDeleteEdge: (id: string) => void;
  onEditBond: (id: string) => void;
  onDropFile: (file: File) => void;
};

export const PersonNode = memo(function PersonNode({ person, photo, selected, onSelect, onEdit }: {
  person: Person; photo?: string; selected: boolean; onSelect: (id: string) => void; onEdit: (id: string) => void;
}) {
  return (
    <button type="button" className={`person-node ${photo ? 'has-photo' : ''} ${selected ? 'is-selected' : ''}`}
      style={{ left: person.x, top: person.y }} data-person-id={person.id} aria-label={`人物 ${person.name}`}
      title={person.name} onClick={() => onSelect(person.id)} onDoubleClick={() => onEdit(person.id)}
      onContextMenu={(event) => { event.preventDefault(); onSelect(person.id); onEdit(person.id); }}>
      {photo ? <><img src={photo} alt="" draggable={false} /><span className="photo-name">{person.name}</span></>
        : <span className="person-oval">{person.name}</span>}
    </button>
  );
});

export function GraphCanvas({ project, selectedId, onSelect, onEditPerson, onMove, onViewport, onConnect, onEditRelationship, onDeleteBond, onDeleteEdge, onEditBond, onDropFile }: CanvasProps) {
  const surface = useRef<HTMLDivElement>(null);
  const [hoverBondId, setHoverBondId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [bondMenu, setBondMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const { preview, targetId, panning, handlers } = useCanvasGestures(surface, project, onMove, onViewport, onSelect, onConnect);
  // A drag re-renders the canvas on every frame. Node and edge props keep their identity unless that
  // person or relationship changed: a photo's data URL is built once per asset, not once per frame,
  // and the stable callbacks read the latest handlers instead of changing identity on every render.
  const photos = useMemo(() => new Map(project.assets.map((asset) => [asset.id, `data:image/webp;base64,${asset.dataBase64}`] as const)), [project.assets]);
  const latest = useRef({ onSelect, onEditPerson });
  useEffect(() => { latest.current = { onSelect, onEditPerson }; });
  const selectPerson = useCallback((id: string) => latest.current.onSelect(id), []);
  const editPerson = useCallback((id: string) => latest.current.onEditPerson(id), []);
  // Hovering a bond's dashed enclosure and pressing Delete removes that bond (people are kept).
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || !hoverBondId) return;
      if (document.querySelector('dialog[open]')) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input,textarea,select') || target.isContentEditable)) return;
      event.preventDefault();
      onDeleteBond(hoverBondId);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [hoverBondId, onDeleteBond]);
  // A right-click on the dashed enclosure opens a small 编辑/删除 menu at the cursor.
  useEffect(() => {
    if (!bondMenu) return;
    const pointerdown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.bond-menu')) return;
      setBondMenu(null);
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') setBondMenu(null); };
    document.addEventListener('pointerdown', pointerdown, true);
    window.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('pointerdown', pointerdown, true); window.removeEventListener('keydown', keydown); };
  }, [bondMenu]);
  const people = project.people.map((person) => preview?.id === person.id ? { ...person, ...preview.point } : person);
  // Dashed elliptical enclosure per bond (>= 2 members): follows members live, including the drag preview.
  const regions = project.bonds.map((bond) => {
    const members = people.filter((person) => bond.memberIds.includes(person.id));
    if (members.length < 2) return null;
    let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
    for (const person of members) {
      const halfWidth = (person.photoAssetId ? 80 : 128) / 2;
      const halfHeight = person.photoAssetId ? 40 : 32;
      left = Math.min(left, person.x - halfWidth); right = Math.max(right, person.x + halfWidth);
      top = Math.min(top, person.y - halfHeight); bottom = Math.max(bottom, person.y + halfHeight);
    }
    const pad = 26;
    const width = right - left + pad * 2; const height = bottom - top + pad * 2;
    return { id: bond.id, name: bond.name, color: bond.color, cx: left - pad + width / 2, cy: top - pad + height / 2, rx: width / 2, ry: height / 2 };
  }).filter((region): region is NonNullable<typeof region> => region !== null);
  const { panX, panY, zoom } = project.viewport;
  return <>
    <div ref={surface} className={`graph-surface ${panning ? 'is-panning' : ''} ${dropActive ? 'is-drop-target' : ''}`} data-testid="graph-surface" {...handlers}
      onDragOver={(event) => { event.preventDefault(); setDropActive(true); }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => { event.preventDefault(); setDropActive(false); const file = event.dataTransfer.files[0]; if (file) onDropFile(file); }}>
      <div className="graph-world" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}>
        <svg className="bond-regions" aria-hidden="true">
          {regions.map((region) => <g key={region.id}>
            <ellipse className="bond-region-outline" cx={region.cx} cy={region.cy} rx={region.rx} ry={region.ry} fill={region.color} fillOpacity={0.05} stroke={region.color} strokeDasharray="12 9" strokeWidth={hoverBondId === region.id ? 3.5 : 2} />
            <ellipse className="bond-region-hit" cx={region.cx} cy={region.cy} rx={region.rx} ry={region.ry} fill="none" stroke="transparent" strokeWidth={16} tabIndex={0}
              onPointerEnter={() => setHoverBondId(region.id)} onPointerLeave={() => setHoverBondId((current) => current === region.id ? null : current)}
              onContextMenu={(event) => { event.preventDefault(); setBondMenu({ id: region.id, x: Math.min(event.clientX, window.innerWidth - 140), y: Math.min(event.clientY, window.innerHeight - 110) }); }}
              onKeyDown={(event) => { if (event.key === 'Delete') { event.preventDefault(); onDeleteBond(region.id); } }} />
            <text className="bond-region-label" x={region.cx} y={region.cy - region.ry + 24} textAnchor="middle" fill={region.color}>{region.name}</text>
          </g>)}
        </svg>
        <GraphEdges people={people} relationships={project.relationships} zoom={zoom} onEdit={onEditRelationship} onDeleteEdge={onDeleteEdge} />
        {people.map((person) => <PersonNode key={person.id} person={person} photo={person.photoAssetId ? photos.get(person.photoAssetId) : undefined}
          selected={selectedId === person.id || targetId === person.id} onSelect={selectPerson} onEdit={editPerson} />)}
      </div>
      {targetId && <div className="drop-hint" role="status">释放以创建关系；原人物位置保持不变</div>}
    </div>
    {bondMenu && <div className="bond-menu" style={{ left: bondMenu.x, top: bondMenu.y }} role="menu" aria-label="羁绊操作">
      <button type="button" role="menuitem" onClick={() => { setBondMenu(null); onEditBond(bondMenu.id); }}>编辑</button>
      <button type="button" role="menuitem" className="danger" onClick={() => { setBondMenu(null); onDeleteBond(bondMenu.id); }}>删除</button>
    </div>}
  </>;
}

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
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

export function GraphCanvas({ project, selectedId, onSelect, onEditPerson, onMove, onViewport, onConnect, onEditRelationship }: CanvasProps) {
  const surface = useRef<HTMLDivElement>(null);
  const { preview, targetId, panning, handlers } = useCanvasGestures(surface, project, onMove, onViewport, onSelect, onConnect);
  // A drag re-renders the canvas on every frame. Node and edge props keep their identity unless that
  // person or relationship changed: a photo's data URL is built once per asset, not once per frame,
  // and the stable callbacks read the latest handlers instead of changing identity on every render.
  const photos = useMemo(() => new Map(project.assets.map((asset) => [asset.id, `data:image/webp;base64,${asset.dataBase64}`] as const)), [project.assets]);
  const latest = useRef({ onSelect, onEditPerson });
  useEffect(() => { latest.current = { onSelect, onEditPerson }; });
  const selectPerson = useCallback((id: string) => latest.current.onSelect(id), []);
  const editPerson = useCallback((id: string) => latest.current.onEditPerson(id), []);
  const people = project.people.map((person) => preview?.id === person.id ? { ...person, ...preview.point } : person);
  const { panX, panY, zoom } = project.viewport;
  return (
    <div ref={surface} className={`graph-surface ${panning ? 'is-panning' : ''}`} data-testid="graph-surface" {...handlers}>
      <div className="graph-world" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}>
      <GraphEdges people={people} relationships={project.relationships} zoom={zoom} onEdit={onEditRelationship} />
      {people.map((person) => <PersonNode key={person.id} person={person} photo={person.photoAssetId ? photos.get(person.photoAssetId) : undefined}
        selected={selectedId === person.id || targetId === person.id} onSelect={selectPerson} onEdit={editPerson} />)}
      </div>
      {targetId && <div className="drop-hint" role="status">释放以创建关系；原人物位置保持不变</div>}
    </div>
  );
}

import { memo, useRef } from 'react';
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
  person: Person; photo?: string; selected: boolean; onSelect: () => void; onEdit: () => void;
}) {
  return (
    <button type="button" className={`person-node ${photo ? 'has-photo' : ''} ${selected ? 'is-selected' : ''}`}
      style={{ left: person.x, top: person.y }} data-person-id={person.id} aria-label={`人物 ${person.name}`}
      title={person.name} onClick={onSelect} onDoubleClick={onEdit}
      onContextMenu={(event) => { event.preventDefault(); onSelect(); onEdit(); }}>
      {photo ? <><img src={photo} alt="" draggable={false} /><span className="photo-name">{person.name}</span></>
        : <span className="person-oval">{person.name}</span>}
    </button>
  );
});

export function GraphCanvas({ project, selectedId, onSelect, onEditPerson, onMove, onViewport, onConnect, onEditRelationship }: CanvasProps) {
  const surface = useRef<HTMLDivElement>(null);
  const { preview, targetId, panning, handlers } = useCanvasGestures(surface, project, onMove, onViewport, onSelect, onConnect);
  const people = project.people.map((person) => preview?.id === person.id ? { ...person, ...preview.point } : person);
  const { panX, panY, zoom } = project.viewport;
  return (
    <div ref={surface} className={`graph-surface ${panning ? 'is-panning' : ''}`} data-testid="graph-surface" {...handlers}>
      <div className="graph-world" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}>
      <GraphEdges people={people} relationships={project.relationships} zoom={zoom} onEdit={onEditRelationship} />
      {people.map((person) => {
        const asset = project.assets.find((item) => item.id === person.photoAssetId);
        return <PersonNode key={person.id} person={person} photo={asset ? `data:image/webp;base64,${asset.dataBase64}` : undefined}
          selected={selectedId === person.id || targetId === person.id} onSelect={() => onSelect(person.id)} onEdit={() => onEditPerson(person.id)} />;
      })}
      </div>
      {targetId && <div className="drop-hint" role="status">释放以创建关系；原人物位置保持不变</div>}
    </div>
  );
}

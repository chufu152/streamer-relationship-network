import { memo, useRef } from 'react';
import { useCanvasGestures } from './useCanvasGestures';
import type { Point, Viewport } from '../shared/geometry';
import type { NetworkProject, Person } from '../shared/project';

export type CanvasProps = {
  project: NetworkProject;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEditPerson: (id: string) => void;
  onMove: (id: string, point: Point) => void;
  onViewport: (viewport: Viewport) => void;
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

export function GraphCanvas({ project, selectedId, onSelect, onEditPerson, onMove, onViewport }: CanvasProps) {
  const surface = useRef<HTMLDivElement>(null);
  const { preview, panning, handlers } = useCanvasGestures(surface, project, onMove, onViewport, onSelect);
  const { panX, panY, zoom } = project.viewport;
  return (
    <div ref={surface} className={`graph-surface ${panning ? 'is-panning' : ''}`} data-testid="graph-surface" {...handlers}>
      <div className="graph-world" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}>
      {project.people.map((original) => {
        const person = preview?.id === original.id ? { ...original, ...preview.point } : original;
        const asset = project.assets.find((item) => item.id === person.photoAssetId);
        return <PersonNode key={person.id} person={person} photo={asset ? `data:image/webp;base64,${asset.dataBase64}` : undefined}
          selected={selectedId === person.id} onSelect={() => onSelect(person.id)} onEdit={() => onEditPerson(person.id)} />;
      })}
      </div>
    </div>
  );
}

import { memo } from 'react';
import type { NetworkProject, Person } from '../shared/project';

export type CanvasProps = {
  project: NetworkProject;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEditPerson: (id: string) => void;
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

export function GraphCanvas({ project, selectedId, onSelect, onEditPerson }: CanvasProps) {
  return (
    <div className="graph-surface" data-testid="graph-surface" onClick={(event) => { if (event.target === event.currentTarget) onSelect(null); }}>
      {project.people.map((person) => {
        const asset = project.assets.find((item) => item.id === person.photoAssetId);
        return <PersonNode key={person.id} person={person} photo={asset ? `data:image/webp;base64,${asset.dataBase64}` : undefined}
          selected={selectedId === person.id} onSelect={() => onSelect(person.id)} onEdit={() => onEditPerson(person.id)} />;
      })}
    </div>
  );
}

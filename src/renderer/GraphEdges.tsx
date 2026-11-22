import { lineEndpoints } from '../shared/geometry';
import type { Person, Relationship } from '../shared/project';

export function GraphEdges({ people, relationships, zoom, onEdit }: {
  people: Person[]; relationships: Relationship[]; zoom: number; onEdit: (id: string) => void;
}) {
  const byId = new Map(people.map((person) => [person.id, person]));
  return <svg className="graph-edges" aria-label="关系连线">
    <defs><marker id="arrow-end" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={7 / zoom} markerHeight={7 / zoom} orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 9 5 1 9" fill="none" stroke="#62686e" strokeWidth="1.5" /></marker></defs>
    {relationships.map((relation) => {
      const source = byId.get(relation.sourceId)!;
      const target = byId.get(relation.targetId)!;
      const endpoints = lineEndpoints(source, target);
      if (!endpoints) return null;
      const { start, end } = endpoints;
      const path = `M${start.x} ${start.y} L${end.x} ${end.y}`;
      const x = (start.x + end.x) / 2; const y = (start.y + end.y) / 2;
      const description = `${source.name} ${relation.direction === 'forward' ? '→' : relation.direction === 'reverse' ? '←' : '↔'} ${target.name}${relation.label ? `：${relation.label}` : ''}`;
      return <g key={relation.id} data-relationship-id={relation.id} role="button" tabIndex={0} aria-label={`关系 ${description}`} className="relationship"
        onClick={() => onEdit(relation.id)} onContextMenu={(event) => { event.preventDefault(); onEdit(relation.id); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdit(relation.id); } }}>
        <path d={path} fill="none" stroke="#929ba3" strokeWidth={1.5 / zoom}
          markerStart={relation.direction !== 'forward' ? 'url(#arrow-end)' : undefined} markerEnd={relation.direction !== 'reverse' ? 'url(#arrow-end)' : undefined} />
        <path className="edge-hit" d={path} fill="none" stroke="transparent" strokeWidth={16 / zoom} />
        {relation.label && <text x={x} y={y} dy="-7" textAnchor="middle" className="edge-label">{relation.label}</text>}
        <title>{description}</title>
      </g>;
    })}
  </svg>;
}

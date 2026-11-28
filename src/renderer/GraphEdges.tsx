import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { lineEndpoints } from '../shared/geometry';
import type { Person, Relationship } from '../shared/project';

// Memoised per relationship: while one person is dragged, only the edges attached to it are recomputed.
const Edge = memo(function Edge({ relation, source, target, zoom, hovered, onHover, onEdit, onDeleteEdge }: {
  relation: Relationship; source: Person; target: Person; zoom: number; hovered: boolean;
  onHover: (id: string | null) => void; onEdit: (id: string) => void; onDeleteEdge: (id: string) => void;
}) {
  const endpoints = lineEndpoints(source, target);
  if (!endpoints) return null;
  const { start, end } = endpoints;
  const path = `M${start.x} ${start.y} L${end.x} ${end.y}`;
  const x = (start.x + end.x) / 2; const y = (start.y + end.y) / 2;
  const description = `${source.name} ${relation.direction === 'forward' ? '→' : relation.direction === 'reverse' ? '←' : '↔'} ${target.name}${relation.label ? `：${relation.label}` : ''}`;
  return <g data-relationship-id={relation.id} role="button" tabIndex={0} aria-label={`关系 ${description}`}
    className={`relationship ${hovered ? 'is-hovered' : ''}`}
    onPointerEnter={() => onHover(relation.id)} onPointerLeave={() => onHover(null)}
    onClick={() => onEdit(relation.id)} onContextMenu={(event) => { event.preventDefault(); onEdit(relation.id); }}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEdit(relation.id); }
      else if (event.key === 'Delete') { event.preventDefault(); onDeleteEdge(relation.id); }
    }}>
    <path className="edge-line" d={path} fill="none" stroke="#929ba3" strokeWidth={1.5 / zoom}
      markerStart={relation.direction !== 'forward' ? 'url(#arrow-end)' : undefined} markerEnd={relation.direction !== 'reverse' ? 'url(#arrow-end)' : undefined} />
    <path className="edge-hit" d={path} fill="none" stroke="transparent" strokeWidth={16 / zoom} />
    {relation.label && <text x={x} y={y} dy="-7" textAnchor="middle" className="edge-label">{relation.label}</text>}
    <title>{description}</title>
  </g>;
});

export function GraphEdges({ people, relationships, zoom, onEdit, onDeleteEdge }: {
  people: Person[]; relationships: Relationship[]; zoom: number; onEdit: (id: string) => void; onDeleteEdge: (id: string) => void;
}) {
  const byId = new Map(people.map((person) => [person.id, person]));
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null);
  const latest = useRef({ onEdit, onDeleteEdge });
  useEffect(() => { latest.current = { onEdit, onDeleteEdge }; });
  const edit = useCallback((id: string) => latest.current.onEdit(id), []);
  const deleteEdge = useCallback((id: string) => latest.current.onDeleteEdge(id), []);
  // Hovering a line and pressing Delete removes that relationship (the editor keeps its confirmation).
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || !hoverEdgeId) return;
      if (document.querySelector('dialog[open]')) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input,textarea,select') || target.isContentEditable)) return;
      event.preventDefault();
      deleteEdge(hoverEdgeId);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [hoverEdgeId, deleteEdge]);
  return <svg className="graph-edges" aria-label="关系连线">
    <defs><marker id="arrow-end" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={7 / zoom} markerHeight={7 / zoom} orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 9 5 1 9" fill="none" stroke="#62686e" strokeWidth="1.5" /></marker></defs>
    {relationships.map((relation) => <Edge key={relation.id} relation={relation} source={byId.get(relation.sourceId)!} target={byId.get(relation.targetId)!} zoom={zoom} hovered={hoverEdgeId === relation.id} onHover={setHoverEdgeId} onEdit={edit} onDeleteEdge={deleteEdge} />)}
  </svg>;
}

import type { NetworkProject, Person } from './project';

export type Point = { x: number; y: number };
export type Viewport = NetworkProject['viewport'];

export function toWorld(point: Point, view: Viewport): Point {
  return { x: (point.x - view.panX) / view.zoom, y: (point.y - view.panY) / view.zoom };
}

export function zoomAt(view: Viewport, requested: number, anchor: Point): Viewport {
  const zoom = Math.min(2, Math.max(0.25, requested));
  const world = toWorld(anchor, view);
  return { zoom, panX: anchor.x - world.x * zoom, panY: anchor.y - world.y * zoom };
}

export function fitPeople(people: Person[], width: number, height: number): { viewport: Viewport; limited: boolean } {
  if (!people.length) return { viewport: { panX: 0, panY: 0, zoom: 1 }, limited: false };
  const left = Math.min(...people.map((person) => person.x - 80));
  const right = Math.max(...people.map((person) => person.x + 80));
  const top = Math.min(...people.map((person) => person.y - 48));
  const bottom = Math.max(...people.map((person) => person.y + 80));
  const desired = Math.min((width - 60) / (right - left), (height - 60) / (bottom - top), 1);
  const zoom = Math.max(0.25, desired);
  return { viewport: { zoom, panX: width / 2 - (left + right) / 2 * zoom, panY: height / 2 - (top + bottom) / 2 * zoom }, limited: desired < 0.25 };
}

export function insidePerson(point: Point, person: Person): boolean {
  const rx = person.photoAssetId ? 40 : 64;
  const ry = person.photoAssetId ? 40 : 32;
  return ((point.x - person.x) / rx) ** 2 + ((point.y - person.y) / ry) ** 2 <= 1;
}

export function lineEndpoints(source: Person, target: Person): { start: Point; end: Point } | null {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const ux = dx / length;
  const uy = dy / length;
  const distance = (person: Person) => 1 / Math.sqrt((ux / (person.photoAssetId ? 40 : 64)) ** 2 + (uy / (person.photoAssetId ? 40 : 32)) ** 2) + 4;
  const from = distance(source);
  const to = distance(target);
  if (length <= from + to) return null;
  return { start: { x: source.x + ux * from, y: source.y + uy * from }, end: { x: target.x - ux * to, y: target.y - uy * to } };
}

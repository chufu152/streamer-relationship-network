import { expect, it } from 'vitest';
import { fitPeople, insidePerson, lineEndpoints, toWorld, zoomAt } from '../../src/shared/geometry';
import type { Person } from '../../src/shared/project';

const person = (x: number, y: number, photo = false): Person => ({ id: crypto.randomUUID(), name: '人物', x, y, photoAssetId: photo ? crypto.randomUUID() : null });

it.each([0.25, 1, 2])('preserves pointer anchor at zoom %s', (zoom) => {
  const viewport = { panX: 78, panY: -40, zoom };
  const anchor = { x: 350, y: 260 };
  const before = toWorld(anchor, viewport);
  const after = toWorld(anchor, zoomAt(viewport, zoom * 1.2, anchor));
  expect(after.x).toBeCloseTo(before.x);
  expect(after.y).toBeCloseTo(before.y);
});

it('fits normal projects and reports the minimum zoom limit', () => {
  expect(fitPeople([], 900, 500).viewport.zoom).toBe(1);
  expect(fitPeople([person(0, 0), person(400, 200)], 900, 500).limited).toBe(false);
  const result = fitPeople([person(-100000, 0), person(100000, 0)], 900, 500);
  expect(result.limited).toBe(true); expect(result.viewport.zoom).toBe(0.25);
});

it('tests the figure only, not its name or rectangular corners', () => {
  expect(insidePerson({ x: 63, y: 31 }, person(0, 0))).toBe(false);
  expect(insidePerson({ x: 30, y: 0 }, person(0, 0, true))).toBe(true);
  expect(insidePerson({ x: 0, y: 60 }, person(0, 0, true))).toBe(false);
});

it('clips lines to ellipse/circle boundaries and suppresses short edges', () => {
  expect(lineEndpoints(person(0, 0), person(200, 0))).toEqual({ start: { x: 68, y: 0 }, end: { x: 132, y: 0 } });
  expect(lineEndpoints(person(0, 0, true), person(200, 0, true))).toEqual({ start: { x: 44, y: 0 }, end: { x: 156, y: 0 } });
  expect(lineEndpoints(person(0, 0), person(0, 0))).toBeNull();
  expect(lineEndpoints(person(0, 0), person(30, 0))).toBeNull();
});

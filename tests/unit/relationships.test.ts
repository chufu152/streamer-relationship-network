import { expect, it } from 'vitest';
import { connectPeople } from '../../src/shared/relationships';
import { createEmptyProject } from '../../src/shared/project';

it('uses fixed identities and deduplicates reversed connections', () => {
  const project = createEmptyProject();
  project.people = ['人物甲', '人物乙'].map((name, index) => ({ id: crypto.randomUUID(), name, x: index * 200, y: 0, photoAssetId: null }));
  const [a, b] = project.people;
  const connected = connectPeople(project, a.id, b.id);
  expect(connected.created).toBe(true);
  expect(connected.project.relationships[0].direction).toBe('both');
  const repeated = connectPeople(connected.project, b.id, a.id);
  expect(repeated.created).toBe(false);
  expect(repeated.relationshipId).toBe(connected.relationshipId);
  expect(repeated.project.relationships).toHaveLength(1);
  expect(() => connectPeople(project, a.id, a.id)).toThrow();
  expect(() => connectPeople(project, a.id, crypto.randomUUID())).toThrow();
});

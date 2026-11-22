import { expect, it } from 'vitest';
import { addPerson } from '../../src/shared/operations';
import { createEmptyProject } from '../../src/shared/project';

it('refuses the 201st person without modifying the project', () => {
  const project = createEmptyProject();
  project.people = Array.from({ length: 200 }, (_, index) => ({ id: crypto.randomUUID(), name: `人物${index}`, x: index * 150, y: 0, photoAssetId: null }));
  expect(() => addPerson(project, '额外人物', { x: 0, y: 0 })).toThrow('200');
  expect(project.people).toHaveLength(200);
});

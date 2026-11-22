import { describe, expect, it } from 'vitest';
import { addPerson, deletePerson, setPersonPhoto, validateName } from '../../src/shared/operations';
import { createEmptyProject, type PhotoAsset } from '../../src/shared/project';

describe('people operations', () => {
  it('trims names, preserves duplicate identities, and avoids existing positions', () => {
    let project = addPerson(createEmptyProject(), ' 人物甲 ', { x: 300, y: 200 });
    project = addPerson(project, '人物甲', { x: 300, y: 200 });
    expect(project.people[0].name).toBe('人物甲');
    expect(project.people[0].id).not.toBe(project.people[1].id);
    expect(project.people[0].x).not.toBe(project.people[1].x);
  });
  it('rejects empty and long names', () => {
    expect(() => validateName('  ')).toThrow();
    expect(() => validateName('人'.repeat(41))).toThrow();
    expect(validateName('人'.repeat(40))).toHaveLength(40);
  });
  it('removes obsolete photos and cascades relationships on delete', () => {
    let project = addPerson(createEmptyProject(), '人物甲', { x: 0, y: 0 });
    project = addPerson(project, '人物乙', { x: 100, y: 100 });
    const id = project.people[0].id;
    const asset: PhotoAsset = { id: crypto.randomUUID(), width: 1, height: 1, mimeType: 'image/webp', dataBase64: 'AAAA' };
    project = setPersonPhoto(project, id, asset);
    project = setPersonPhoto(project, id, { ...asset, id: crypto.randomUUID() });
    expect(project.assets).toHaveLength(1);
    project.relationships.push({ id: crypto.randomUUID(), sourceId: id, targetId: project.people[1].id, direction: 'both', label: '' });
    project = deletePerson(project, id);
    expect(project.people).toHaveLength(1);
    expect(project.assets).toHaveLength(0);
    expect(project.relationships).toHaveLength(0);
  });
});

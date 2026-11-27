import { describe, expect, it } from 'vitest';
import { addPerson, createBond, deleteBond, deletePerson, gatherBondMembers, renameBond, setBondColor, setPersonPhoto, toggleBondMember, validateName } from '../../src/shared/operations';
import { BOND_COLORS, createEmptyProject, type PhotoAsset } from '../../src/shared/project';

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

describe('bond operations', () => {
  it('creates trimmed bonds and rejects empty, long and overflowing names/counts', () => {
    let project = addPerson(createEmptyProject(), '人物甲', { x: 0, y: 0 });
    project = createBond(project, ' 家人 ');
    expect(project.bonds[0].name).toBe('家人');
    expect(project.bonds[0].memberIds).toHaveLength(0);
    expect(() => createBond(project, '   ')).toThrow(/羁绊名/);
    expect(() => createBond(project, '人'.repeat(41))).toThrow(/羁绊名/);
    let full = createEmptyProject();
    for (let index = 0; index < 50; index++) full = createBond(full, `羁绊${index}`);
    expect(() => createBond(full, '再多一个')).toThrow(/羁绊最多/);
  });
  it('keeps an explicitly provided bond id', () => {
    const id = crypto.randomUUID();
    const project = createBond(createEmptyProject(), '家人', id);
    expect(project.bonds[0].id).toBe(id);
  });
  it('toggles membership, cascades person deletion and deletes bonds', () => {
    let project = addPerson(createEmptyProject(), '人物甲', { x: 0, y: 0 });
    project = addPerson(project, '人物乙', { x: 1, y: 1 });
    project = createBond(project, '家人');
    const bondId = project.bonds[0].id;
    project = toggleBondMember(project, bondId, project.people[0].id);
    expect(project.bonds[0].memberIds).toEqual([project.people[0].id]);
    project = toggleBondMember(project, bondId, project.people[0].id);
    expect(project.bonds[0].memberIds).toHaveLength(0);
    project = toggleBondMember(project, bondId, project.people[1].id);
    project = deletePerson(project, project.people[1].id);
    expect(project.bonds[0].memberIds).toHaveLength(0);
    project = deleteBond(project, bondId);
    expect(project.bonds).toHaveLength(0);
  });
  it('assigns palette colours, renames and recolours bonds', () => {
    let project = createBond(createEmptyProject(), '家人');
    expect(BOND_COLORS).toContain(project.bonds[0].color);
    project = renameBond(project, project.bonds[0].id, '  亲友  ');
    expect(project.bonds[0].name).toBe('亲友');
    expect(() => renameBond(project, project.bonds[0].id, '   ')).toThrow(/羁绊名/);
    project = setBondColor(project, project.bonds[0].id, '#b03a2e');
    expect(project.bonds[0].color).toBe('#b03a2e');
    expect(() => setBondColor(project, project.bonds[0].id, 'red')).toThrow(/颜色/);
  });
  it('gathers bond members into a compact grid and leaves non-members alone', () => {
    let project = addPerson(createEmptyProject(), '人物甲', { x: 0, y: 0 });
    project = addPerson(project, '人物乙', { x: 500, y: 400 });
    project = addPerson(project, '人物丙', { x: 900, y: 0 });
    project = createBond(project, '家人');
    project = toggleBondMember(project, project.bonds[0].id, project.people[0].id);
    project = toggleBondMember(project, project.bonds[0].id, project.people[1].id);
    project = gatherBondMembers(project, project.bonds[0].id);
    const [a, b, c] = project.people;
    expect(a.x).toBe(175); expect(a.y).toBe(200);
    expect(b.x).toBe(325); expect(b.y).toBe(200);
    expect(c.x).toBe(900); expect(c.y).toBe(0);
    project = toggleBondMember(project, project.bonds[0].id, project.people[0].id);
    expect(project.people[0].x).toBe(175);
  });
});

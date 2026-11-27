import { describe, expect, it } from 'vitest';
import { createEmptyProject, personSchema, photoAssetSchema, projectSchema, PROJECT_LIMITS } from '../../src/shared/project';

function populatedProject() {
  const project = createEmptyProject();
  project.people = ['人物甲', '人物乙'].map((name) => ({
    id: crypto.randomUUID(), name, x: 240, y: 160, photoAssetId: null,
  }));
  project.relationships = [{
    id: crypto.randomUUID(),
    sourceId: project.people[0].id,
    targetId: project.people[1].id,
    direction: 'forward',
    label: '同事',
  }];
  return project;
}

describe('project schema', () => {
  it('creates independent, valid empty projects', () => {
    const first = createEmptyProject();
    const second = createEmptyProject();
    expect(projectSchema.parse(first)).toEqual(first);
    expect(second.id).not.toBe(first.id);
    expect(first.people).not.toBe(second.people);
  });

  it('round-trips a complete JSON structure', () => {
    const project = populatedProject();
    expect(projectSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });

  it.each(['forward', 'reverse', 'both'] as const)('accepts direction %s', (direction) => {
    const project = populatedProject();
    project.relationships[0].direction = direction;
    expect(projectSchema.safeParse(project).success).toBe(true);
  });

  it('allows duplicate names but rejects duplicate IDs', () => {
    const project = populatedProject();
    project.people[1].name = project.people[0].name;
    expect(projectSchema.safeParse(project).success).toBe(true);
    project.people[1].id = project.people[0].id;
    expect(projectSchema.safeParse(project).success).toBe(false);
  });

  it.each(['', '   ', ' 人物甲', '人'.repeat(41)])('rejects invalid name %j', (name) => {
    expect(personSchema.safeParse({ ...populatedProject().people[0], name }).success).toBe(false);
  });

  it('counts Unicode code points rather than UTF-16 code units', () => {
    const name = String.fromCodePoint(0x20000).repeat(40);
    expect(personSchema.safeParse({ ...populatedProject().people[0], name }).success).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite coordinates %s', (x) => {
    expect(personSchema.safeParse({ ...populatedProject().people[0], x }).success).toBe(false);
  });

  it('rejects self-connections, missing endpoints, and reversed duplicate pairs', () => {
    const project = populatedProject();
    const relationship = project.relationships[0];
    project.relationships.push({ ...relationship, id: crypto.randomUUID(), sourceId: relationship.targetId, targetId: relationship.sourceId });
    expect(projectSchema.safeParse(project).success).toBe(false);
    project.relationships.pop();
    relationship.targetId = relationship.sourceId;
    expect(projectSchema.safeParse(project).success).toBe(false);
    relationship.targetId = crypto.randomUUID();
    expect(projectSchema.safeParse(project).success).toBe(false);
  });

  it('rejects missing photo references', () => {
    const project = populatedProject();
    project.people[0].photoAssetId = crypto.randomUUID();
    expect(projectSchema.safeParse(project).success).toBe(false);
  });

  it('accepts bonds and rejects broken references, duplicate members and duplicate ids', () => {
    const project = populatedProject();
    project.bonds = [{ id: crypto.randomUUID(), name: '家人', memberIds: [project.people[0].id, project.people[1].id] }];
    expect(projectSchema.safeParse(project).success).toBe(true);
    project.bonds[0].memberIds.push(crypto.randomUUID());
    expect(projectSchema.safeParse(project).success).toBe(false);
    project.bonds[0].memberIds = [project.people[0].id, project.people[0].id];
    expect(projectSchema.safeParse(project).success).toBe(false);
    project.bonds.push({ ...project.bonds[0] });
    expect(projectSchema.safeParse(project).success).toBe(false);
  });

  it('defaults missing bonds to an empty array so older files stay readable', () => {
    const legacy = JSON.parse(JSON.stringify(populatedProject()));
    delete legacy.bonds;
    expect(projectSchema.parse(legacy).bonds).toEqual([]);
  });

  it('rejects unsupported versions and unknown fields', () => {
    expect(projectSchema.safeParse({ ...createEmptyProject(), schemaVersion: 2 }).success).toBe(false);
    expect(projectSchema.safeParse({ ...createEmptyProject(), executable: 'unexpected' }).success).toBe(false);
  });

  it('rejects invalid zoom and over-limit node counts', () => {
    const project = populatedProject();
    project.viewport.zoom = 0;
    expect(projectSchema.safeParse(project).success).toBe(false);
    project.viewport.zoom = 1;
    project.people = Array.from({ length: PROJECT_LIMITS.people + 1 }, () => ({ ...project.people[0], id: crypto.randomUUID() }));
    project.relationships = [];
    expect(projectSchema.safeParse(project).success).toBe(false);
  });

  it('bounds photo metadata and compressed bytes independently', () => {
    const asset = { id: crypto.randomUUID(), mimeType: 'image/webp', width: 512, height: 512, dataBase64: 'AAAA' };
    expect(photoAssetSchema.safeParse(asset).success).toBe(true);
    expect(photoAssetSchema.safeParse({ ...asset, width: 513 }).success).toBe(false);
    expect(photoAssetSchema.safeParse({ ...asset, height: 256 }).success).toBe(false);
    expect(photoAssetSchema.safeParse({ ...asset, dataBase64: 'not base64' }).success).toBe(false);
    const dataBase64 = Buffer.alloc(PROJECT_LIMITS.assetBytes + 1).toString('base64');
    expect(photoAssetSchema.safeParse({ ...asset, dataBase64 }).success).toBe(false);
  });
});

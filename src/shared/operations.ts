import { personSchema, PROJECT_LIMITS, type NetworkProject, type PhotoAsset } from './project';

export function validateName(value: string): string {
  const name = value.trim();
  const result = personSchema.shape.name.safeParse(name);
  if (!result.success) throw new Error(result.error.issues[0].message);
  return name;
}

export function addPerson(project: NetworkProject, value: string, center: { x: number; y: number }): NetworkProject {
  if (project.people.length >= PROJECT_LIMITS.people) throw new Error('首版最多支持 200 个人物');
  const name = validateName(value);
  let position = center;
  for (let i = 0; i <= project.people.length * 12; i++) {
    const ring = Math.ceil(Math.sqrt(i));
    const angle = i * 2.399963;
    position = { x: center.x + Math.cos(angle) * ring * 90, y: center.y + Math.sin(angle) * ring * 70 };
    if (!project.people.some((person) => Math.abs(person.x - position.x) < 155 && Math.abs(person.y - position.y) < 125)) break;
  }
  return { ...project, people: [...project.people, { id: crypto.randomUUID(), name, ...position, photoAssetId: null }] };
}

export function removeUnusedAssets(project: NetworkProject): NetworkProject {
  const used = new Set(project.people.map((person) => person.photoAssetId));
  return { ...project, assets: project.assets.filter((asset) => used.has(asset.id)) };
}

export function deletePerson(project: NetworkProject, id: string): NetworkProject {
  return removeUnusedAssets({ ...project,
    people: project.people.filter((person) => person.id !== id),
    relationships: project.relationships.filter((relation) => relation.sourceId !== id && relation.targetId !== id),
  });
}

export function setPersonPhoto(project: NetworkProject, id: string, asset: PhotoAsset | null): NetworkProject {
  if (!project.people.some((person) => person.id === id)) return project;
  return removeUnusedAssets({ ...project,
    people: project.people.map((person) => person.id === id ? { ...person, photoAssetId: asset?.id ?? null } : person),
    assets: asset ? [...project.assets, asset] : project.assets,
  });
}

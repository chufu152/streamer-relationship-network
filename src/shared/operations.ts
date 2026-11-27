import { BOND_COLORS, bondSchema, personSchema, PROJECT_LIMITS, type NetworkProject, type Person, type PhotoAsset } from './project';

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
    bonds: project.bonds.map((bond) => ({ ...bond, memberIds: bond.memberIds.filter((member) => member !== id) })),
  });
}

export function createBond(project: NetworkProject, rawName: string, id: string = crypto.randomUUID()): NetworkProject {
  if (project.bonds.length >= PROJECT_LIMITS.bonds) throw new Error(`羁绊最多 ${PROJECT_LIMITS.bonds} 个`);
  const name = rawName.trim();
  if (!bondSchema.shape.name.safeParse(name).success) throw new Error('羁绊名不能为空、超过 40 个字符或包含首尾空白');
  const color = BOND_COLORS[project.bonds.length % BOND_COLORS.length];
  return { ...project, bonds: [...project.bonds, { id, name, memberIds: [], color }] };
}

export function renameBond(project: NetworkProject, id: string, rawName: string): NetworkProject {
  const name = rawName.trim();
  if (!bondSchema.shape.name.safeParse(name).success) throw new Error('羁绊名不能为空、超过 40 个字符或包含首尾空白');
  return { ...project, bonds: project.bonds.map((bond) => bond.id === id ? { ...bond, name } : bond) };
}

export function setBondColor(project: NetworkProject, id: string, color: string): NetworkProject {
  if (!bondSchema.shape.color.safeParse(color).success) throw new Error('羁绊颜色无效');
  return { ...project, bonds: project.bonds.map((bond) => bond.id === id ? { ...bond, color } : bond) };
}

export function gatherBondMembers(project: NetworkProject, bondId: string): NetworkProject {
  const bond = project.bonds.find((item) => item.id === bondId);
  if (!bond || bond.memberIds.length === 0) return project;
  const byId = new Map(project.people.map((person) => [person.id, person]));
  const members = bond.memberIds.map((member) => byId.get(member)).filter((person): person is Person => person !== undefined);
  if (members.length === 0) return project;
  // Compact rows of four around the members' current centroid, so the group forms where they already are.
  const columns = Math.min(4, members.length);
  const rows = Math.ceil(members.length / columns);
  const centroidX = members.reduce((sum, person) => sum + person.x, 0) / members.length;
  const centroidY = members.reduce((sum, person) => sum + person.y, 0) / members.length;
  const moved = new Map(members.map((person, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return [person.id, { x: centroidX + (column - (columns - 1) / 2) * 150, y: centroidY + (row - (rows - 1) / 2) * 130 }] as const;
  }));
  return { ...project, people: project.people.map((person) => moved.has(person.id) ? { ...person, ...moved.get(person.id)! } : person) };
}

export function deleteBond(project: NetworkProject, id: string): NetworkProject {
  return { ...project, bonds: project.bonds.filter((bond) => bond.id !== id) };
}

export function toggleBondMember(project: NetworkProject, bondId: string, personId: string): NetworkProject {
  return { ...project, bonds: project.bonds.map((bond) => bond.id !== bondId ? bond : {
    ...bond,
    memberIds: bond.memberIds.includes(personId)
      ? bond.memberIds.filter((member) => member !== personId)
      : [...bond.memberIds, personId],
  }) };
}

export function setPersonPhoto(project: NetworkProject, id: string, asset: PhotoAsset | null): NetworkProject {
  if (!project.people.some((person) => person.id === id)) return project;
  return removeUnusedAssets({ ...project,
    people: project.people.map((person) => person.id === id ? { ...person, photoAssetId: asset?.id ?? null } : person),
    assets: asset ? [...project.assets, asset] : project.assets,
  });
}

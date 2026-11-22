import { PROJECT_LIMITS, type NetworkProject } from './project';

export function connectPeople(project: NetworkProject, sourceId: string, targetId: string): { project: NetworkProject; relationshipId: string; created: boolean } {
  if (sourceId === targetId) throw new Error('不能连接人物自己');
  if (![sourceId, targetId].every((id) => project.people.some((person) => person.id === id))) throw new Error('关系人物不存在');
  const existing = project.relationships.find((relation) => (relation.sourceId === sourceId && relation.targetId === targetId) || (relation.sourceId === targetId && relation.targetId === sourceId));
  if (existing) return { project, relationshipId: existing.id, created: false };
  if (project.relationships.length >= PROJECT_LIMITS.relationships) throw new Error('首版最多支持 400 条关系');
  const relationship = { id: crypto.randomUUID(), sourceId, targetId, direction: 'both' as const, label: '' };
  return { project: { ...project, relationships: [...project.relationships, relationship] }, relationshipId: relationship.id, created: true };
}

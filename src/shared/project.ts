import { z } from 'zod';

export const PROJECT_LIMITS = {
  people: 200,
  relationships: 400,
  bonds: 50,
  nameCodePoints: 40,
  assetBytes: 256 * 1024,
  fileBytes: 80 * 1024 * 1024,
  photoSide: 512,
} as const;

const label = z.string().refine((value) => value.length <= PROJECT_LIMITS.nameCodePoints * 2
  && Array.from(value).length <= PROJECT_LIMITS.nameCodePoints, {
  message: '文字不能超过 40 个字符',
});
const name = label.refine((value) => value.trim().length > 0 && value === value.trim(), {
  message: '姓名不能为空或包含首尾空白',
});

export const personSchema = z.strictObject({
  id: z.uuid(),
  name,
  x: z.number(),
  y: z.number(),
  photoAssetId: z.uuid().nullable(),
});

export const relationshipSchema = z.strictObject({
  id: z.uuid(),
  sourceId: z.uuid(),
  targetId: z.uuid(),
  direction: z.enum(['forward', 'reverse', 'both']),
  label: label.refine((value) => value === value.trim(), '关系名称不能包含首尾空白'),
});

export const BOND_COLORS = ['#293e50', '#b03a2e', '#1e8449', '#2874a6', '#7d3c98', '#b9770e', '#148f77', '#c2185b', '#5a6a1a', '#5d6d7e'] as const;

export const bondSchema = z.strictObject({
  id: z.uuid(),
  name,
  memberIds: z.array(z.uuid()).max(PROJECT_LIMITS.people),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#293e50'),
});

export const photoAssetSchema = z.strictObject({
  id: z.uuid(),
  mimeType: z.literal('image/webp'),
  width: z.number().int().min(1).max(PROJECT_LIMITS.photoSide),
  height: z.number().int().min(1).max(PROJECT_LIMITS.photoSide),
  dataBase64: z.string().min(4).max(Math.ceil(PROJECT_LIMITS.assetBytes / 3) * 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    .refine((value) => value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0) <= PROJECT_LIMITS.assetBytes,
      '照片压缩数据超过 256 KiB'),
}).refine((asset) => asset.width === asset.height, '头像必须为正方形');

export const projectSchema = z.strictObject({
  format: z.literal('streamer-relationship-network'),
  schemaVersion: z.literal(1),
  id: z.uuid(),
  title: z.string().trim().min(1).max(100),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  viewport: z.strictObject({
    panX: z.number(),
    panY: z.number(),
    zoom: z.number().min(0.25).max(2),
  }),
  people: z.array(personSchema).max(PROJECT_LIMITS.people),
  relationships: z.array(relationshipSchema).max(PROJECT_LIMITS.relationships),
  assets: z.array(photoAssetSchema).max(PROJECT_LIMITS.people),
  bonds: z.array(bondSchema).max(PROJECT_LIMITS.bonds).default([]),
}).superRefine((project, context) => {
  for (const key of ['people', 'relationships', 'assets', 'bonds'] as const) {
    const ids = new Set<string>();
    project[key].forEach((item, index) => {
      if (ids.has(item.id)) context.addIssue({ code: 'custom', path: [key, index, 'id'], message: 'ID 重复' });
      ids.add(item.id);
    });
  }

  const people = new Set(project.people.map((person) => person.id));
  const assets = new Set(project.assets.map((asset) => asset.id));
  const pairs = new Set<string>();
  project.people.forEach((person, index) => {
    if (person.photoAssetId !== null && !assets.has(person.photoAssetId)) {
      context.addIssue({ code: 'custom', path: ['people', index, 'photoAssetId'], message: '照片资产不存在' });
    }
  });
  project.relationships.forEach((relationship, index) => {
    const { sourceId, targetId } = relationship;
    if (!people.has(sourceId) || !people.has(targetId)) {
      context.addIssue({ code: 'custom', path: ['relationships', index], message: '关系端点不存在' });
    }
    if (sourceId === targetId) {
      context.addIssue({ code: 'custom', path: ['relationships', index], message: '不能连接自己' });
    }
    const pair = [sourceId, targetId].sort().join(':');
    if (pairs.has(pair)) context.addIssue({ code: 'custom', path: ['relationships', index], message: '关系重复' });
    pairs.add(pair);
  });
  project.bonds.forEach((bond, index) => {
    const members = new Set<string>();
    bond.memberIds.forEach((memberId, memberIndex) => {
      if (!people.has(memberId)) context.addIssue({ code: 'custom', path: ['bonds', index, 'memberIds', memberIndex], message: '羁绊成员不存在' });
      if (members.has(memberId)) context.addIssue({ code: 'custom', path: ['bonds', index, 'memberIds', memberIndex], message: '羁绊成员重复' });
      members.add(memberId);
    });
  });
});

export type Person = z.infer<typeof personSchema>;
export type Relationship = z.infer<typeof relationshipSchema>;
export type Bond = z.infer<typeof bondSchema>;
export type PhotoAsset = z.infer<typeof photoAssetSchema>;
export type NetworkProject = z.infer<typeof projectSchema>;
export type Direction = Relationship['direction'];

export function createEmptyProject(): NetworkProject {
  const now = new Date().toISOString();
  return {
    format: 'streamer-relationship-network',
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: '未命名关系网',
    createdAt: now,
    updatedAt: now,
    viewport: { panX: 0, panY: 0, zoom: 1 },
    people: [],
    relationships: [],
    bonds: [],
    assets: [],
  };
}

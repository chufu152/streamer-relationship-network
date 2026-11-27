import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readProjectFile, writeProjectFile } from '../../src/main/project-files';
import { createEmptyProject, PROJECT_LIMITS, type NetworkProject } from '../../src/shared/project';

// Real, browser-encoded 512 x 512 solid-colour WebP, not a forged image header.
const WEBP = 'UklGRkIEAABXRUJQVlA4WAoAAAAgAAAA/wEA/wEASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggVAIAANA6AJ0BKgACAAI/cbjZZbSvK6cgCAKQLglpbuF3W0QAAnsA99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D4PtdpUCyXa8XJyHvtk5D32ych77ZOQ99snIe+3Mv09snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D325l+ntk5D32ych77ZOQ+hfS7Xi5OQ99snIe+2TnERcnRTIe+2TkPfbJyH0L6Xa8XJyHvtk5D32yc4iLk5D32ych77ZOQ99uZfp7ZOQ99snIe+2TkPoX0u14uTkPfbJyHvtk5xEXJyHvtk5D32ych77cy/T2ych77ZOQ99snIfQvpdrxcnIe+2TkPfbJziIuTkPfbJyHvtk5D325l+ntk5D32ych77ZOQ+hfS7Xi5OQ99snIe+2TnERcnIe+2TkPfbJyHvtzL9PbJyHvtk5D32ych9C+l2vFych77ZOQ99snOIi5OQ99snIe+2TkPfbmX6e2TkPfbJyHvtk5D6F9LteLk5D32ych70gAP7/T5/4NzTvz7/vfffV4JXLZECW0I5oQAIvEhIZIzjMQYYgwxBhiAEAAAEhHW6WIMMQYYgBAAAAOBbjQbDEGGIDxfsAAAA4BBhiDCrhhQgAAAYAgwxAeIgwoQAAALwQYVcMMQYUIAAAF4IDxEGGIMKEAAAA';

function populatedProject(): NetworkProject {
  const project = createEmptyProject();
  project.title = '人物关系网';
  project.viewport = { panX: -128.5, panY: 230, zoom: 0.75 };
  project.assets = [{ id: randomUUID(), mimeType: 'image/webp', width: 512, height: 512, dataBase64: WEBP }];
  project.people = ['人物甲', '人物乙', '人物丙'].map((name, index) => ({
    id: randomUUID(), name, x: index * 180 - 90, y: index * 60.5,
    photoAssetId: index === 0 ? project.assets[0].id : null,
  }));
  project.bonds = [{ id: randomUUID(), name: '家人', memberIds: [project.people[0].id], color: '#293e50' }];
  project.relationships = (['forward', 'reverse', 'both'] as const).map((direction, index) => ({
    id: randomUUID(), sourceId: project.people[index].id, targetId: project.people[(index + 1) % 3].id,
    direction, label: ['同事', '朋友', '亲属'][index],
  }));
  return project;
}

function ioError(code = 'EIO'): NodeJS.ErrnoException {
  return Object.assign(new Error('injected I/O failure'), { code });
}

let directory: string;
let target: string;

beforeEach(async () => {
  // Windows tmpdir() may use an 8.3 alias; compare and inject faults using canonical paths.
  directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'network-project-files-')));
  target = join(directory, 'project.srn');
});

afterEach(async () => {
  vi.restoreAllMocks();
  // This entire directory was created by this test, never a user/project directory.
  await fs.rm(directory, { recursive: true, force: true });
});

async function seedExisting() {
  const original = populatedProject();
  const originalBytes = JSON.stringify(original, null, 2) + '\n';
  const backupBytes = JSON.stringify({ ...original, title: '更早的备份' });
  await fs.writeFile(target, originalBytes);
  await fs.writeFile(`${target}.bak`, backupBytes);
  await fs.writeFile(join(directory, 'unknown.tmp'), 'do not touch');
  return { original, originalBytes, backupBytes, next: { ...original, title: '新的版本' } };
}

async function expectNoOwnedTemps() {
  expect((await fs.readdir(directory)).sort()).toEqual(['project.srn', 'project.srn.bak', 'unknown.tmp']);
  expect(await fs.readFile(join(directory, 'unknown.tmp'), 'utf8')).toBe('do not touch');
}

describe('project file reads and validation', () => {
  it('round-trips people, real photos, all directions, labels and viewport', async () => {
    const project = populatedProject();
    await writeProjectFile(target, project);
    expect(await readProjectFile(target)).toEqual(project);
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual(project);
    expect(await fs.readdir(directory)).toEqual(['project.srn']);
  });

  it('rejects valid image headers with corrupt compressed pixels', async () => {
    const project = populatedProject();
    const bytes = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v02aAA=', 'base64');
    bytes.fill(255, 30);
    project.assets[0] = { ...project.assets[0], width: 1, height: 1, dataBase64: bytes.toString('base64') };
    await fs.writeFile(target, JSON.stringify(project));
    await expect(readProjectFile(target)).rejects.toThrow(/照片.*损坏/);
    await expect(writeProjectFile(join(directory, 'new.srn'), project)).rejects.toThrow(/照片.*损坏/);
  });

  it('accepts an empty project', async () => {
    const project = createEmptyProject();
    await writeProjectFile(target, project);
    expect(await readProjectFile(target)).toEqual(project);
  });

  it.each(['', '{broken', 'null', '[]', '{}'])('rejects malformed or invalid JSON %j', async (contents) => {
    await fs.writeFile(target, contents);
    await expect(readProjectFile(target)).rejects.toThrow(/无法打开项目.*(?:JSON|格式)/);
  });

  it('rejects malformed UTF-8 rather than replacing bytes in names', async () => {
    const json = Buffer.from(JSON.stringify(createEmptyProject()));
    const index = json.indexOf(Buffer.from('未命名'));
    json[index] = 0xff;
    await fs.writeFile(target, json);
    await expect(readProjectFile(target)).rejects.toThrow(/UTF-8 JSON/);
  });

  it('explicitly refuses future versions for both reads and writes', async () => {
    const future = { ...populatedProject(), schemaVersion: 2 };
    await fs.writeFile(target, JSON.stringify(future));
    await expect(readProjectFile(target)).rejects.toThrow(/更新版本.*不支持.*升级/);
    await expect(writeProjectFile(join(directory, 'new.srn'), future)).rejects.toThrow(/更新版本.*不支持/);
    expect(await fs.readdir(directory)).toEqual(['project.srn']);
  });

  const invalidProjects: [string, (project: NetworkProject) => void][] = [
    ['missing photo reference', (project) => { project.people[0].photoAssetId = randomUUID(); }],
    ['missing relationship endpoint', (project) => { project.relationships[0].targetId = randomUUID(); }],
    ['too many people', (project) => {
      project.people = Array.from({ length: PROJECT_LIMITS.people + 1 }, () => ({ ...project.people[0], id: randomUUID() }));
      project.relationships = [];
    }],
    ['oversized asset', (project) => { project.assets[0].dataBase64 = Buffer.alloc(PROJECT_LIMITS.assetBytes + 1).toString('base64'); }],
    ['fake WebP bytes', (project) => { project.assets[0].dataBase64 = 'AAAA'; }],
    ['false photo dimensions', (project) => { project.assets[0].width = project.assets[0].height = 256; }],
    ['invalid unreferenced asset', (project) => { project.assets.push({ ...project.assets[0], id: randomUUID(), dataBase64: 'AAAA' }); }],
    ['broken bond reference', (project) => { project.bonds[0].memberIds[0] = randomUUID(); }],
  ];

  it.each(invalidProjects)('validates %s on both input paths', async (_name, invalidate) => {
    const project = populatedProject();
    invalidate(project);
    await fs.writeFile(target, JSON.stringify(project));
    await expect(readProjectFile(target)).rejects.toThrow(/项目.*(?:无效|限制)/);
    const open = vi.spyOn(fs, 'open');
    await expect(writeProjectFile(join(directory, 'new.srn'), project)).rejects.toThrow(/项目.*(?:无效|限制)/);
    expect(open).not.toHaveBeenCalled();
    expect(await fs.readdir(directory)).toEqual(['project.srn']);
  });

  it('rejects files above 80 MiB before reading their contents', async () => {
    await fs.writeFile(target, '{}');
    await fs.truncate(target, PROJECT_LIMITS.fileBytes + 1);
    const read = vi.spyOn(fs, 'readFile');
    await expect(readProjectFile(target)).rejects.toThrow(/80 MiB/);
    expect(read).not.toHaveBeenCalled();
  });

  it('checks the actual buffer size even if stat originally reported a small file', async () => {
    await fs.writeFile(target, JSON.stringify(createEmptyProject()));
    vi.spyOn(fs, 'readFile').mockResolvedValueOnce(Buffer.alloc(PROJECT_LIMITS.fileBytes + 1));
    await expect(readProjectFile(target)).rejects.toThrow(/80 MiB/);
  });

  it('accepts a file at exactly the 80 MiB boundary', async () => {
    const project = createEmptyProject();
    await fs.writeFile(target, JSON.stringify(project));
    const bytes = Buffer.alloc(PROJECT_LIMITS.fileBytes, 0x20);
    bytes.write(JSON.stringify(project));
    vi.spyOn(fs, 'readFile').mockResolvedValueOnce(bytes);
    await expect(readProjectFile(target)).resolves.toEqual(project);
  });

  it('checks serialized UTF-8 byte size before creating any files', async () => {
    // Normal schema limits are tighter than 80 MiB. Mock serialization to exercise the final guard.
    const stringify = vi.spyOn(JSON, 'stringify').mockReturnValueOnce('人'.repeat(Math.floor(PROJECT_LIMITS.fileBytes / 3) + 1));
    const open = vi.spyOn(fs, 'open');
    await expect(writeProjectFile(target, createEmptyProject())).rejects.toThrow(/80 MiB/);
    stringify.mockRestore();
    expect(open).not.toHaveBeenCalled();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('reports missing files, directories and access errors in Chinese', async () => {
    await expect(readProjectFile(target)).rejects.toThrow(/不存在/);
    await expect(readProjectFile(directory)).rejects.toThrow(/不能打开文件夹/);
    vi.spyOn(fs, 'stat').mockRejectedValueOnce(ioError('EACCES'));
    await expect(readProjectFile(target)).rejects.toThrow(/访问权限/);
    await expect(writeProjectFile(join(directory, 'missing', 'file.srn'), createEmptyProject())).rejects.toThrow(/不存在/);
  });
});

describe('safe project replacement', () => {
  it('keeps exact previous bytes in .bak and rotates only a valid backup', async () => {
    const { original, originalBytes, next } = await seedExisting();
    await writeProjectFile(target, next);
    expect(await fs.readFile(`${target}.bak`, 'utf8')).toBe(originalBytes);
    expect(await readProjectFile(`${target}.bak`)).toEqual(original);
    expect(await readProjectFile(target)).toEqual(next);
    const nextBytes = await fs.readFile(target);
    await writeProjectFile(target, { ...next, title: '第三版' });
    expect(await fs.readFile(`${target}.bak`)).toEqual(nextBytes);
    await expectNoOwnedTemps();
  });

  it('prepares a backup when none exists yet', async () => {
    const project = populatedProject();
    await fs.writeFile(target, JSON.stringify(project));
    await writeProjectFile(target, { ...project, title: '第二版' });
    expect(await readProjectFile(`${target}.bak`)).toEqual(project);
    expect((await fs.readdir(directory)).sort()).toEqual(['project.srn', 'project.srn.bak']);
  });

  it.each(['broken', 'future', 'photo', 'oversized'] as const)('refuses to overwrite an invalid %s target and suggests Save As', async (kind) => {
    const project = populatedProject();
    if (kind === 'photo') project.assets[0].dataBase64 = 'AAAA';
    const bytes = kind === 'broken' ? '{broken' : JSON.stringify(kind === 'future' ? { ...project, schemaVersion: 99 } : project);
    await fs.writeFile(target, bytes);
    if (kind === 'oversized') await fs.truncate(target, PROJECT_LIMITS.fileBytes + 1);
    const open = vi.spyOn(fs, 'open');
    await expect(writeProjectFile(target, populatedProject())).rejects.toThrow(/拒绝覆盖.*另存为/);
    expect(open).not.toHaveBeenCalled();
    if (kind === 'oversized') expect((await fs.stat(target)).size).toBe(PROJECT_LIMITS.fileBytes + 1);
    else expect(await fs.readFile(target, 'utf8')).toBe(bytes);
    expect(await fs.readdir(directory)).toEqual(['project.srn']);
  });

  it('does not replace an unknown .bak or delete unrelated temporary files', async () => {
    const { originalBytes, next } = await seedExisting();
    await fs.writeFile(`${target}.bak`, 'unrelated backup');
    await expect(writeProjectFile(target, next)).rejects.toThrow(/备份.*停止替换.*另存为/);
    expect(await fs.readFile(target, 'utf8')).toBe(originalBytes);
    expect(await fs.readFile(`${target}.bak`, 'utf8')).toBe('unrelated backup');
    await expectNoOwnedTemps();
  });

  it('does not overwrite directories', async () => {
    await fs.mkdir(target);
    await fs.writeFile(join(target, 'unrelated'), 'keep');
    await expect(writeProjectFile(target, populatedProject())).rejects.toThrow(/另存为/);
    expect(await fs.readFile(join(target, 'unrelated'), 'utf8')).toBe('keep');
    expect(await fs.readdir(directory)).toEqual(['project.srn']);
  });

  it('exclusively writes UUID temp files in the target directory, then flushes and closes before renaming', async () => {
    const { next } = await seedExisting();
    const realOpen = fs.open.bind(fs);
    const opened: { path: string; write: ReturnType<typeof vi.fn>; sync: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
    const open = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...args);
      opened.push({ path: String(args[0]), write: vi.spyOn(handle, 'writeFile'), sync: vi.spyOn(handle, 'sync'), close: vi.spyOn(handle, 'close') });
      return handle;
    });
    const rename = vi.spyOn(fs, 'rename');
    await writeProjectFile(target, next);
    expect(open).toHaveBeenCalledTimes(2);
    for (const [index, record] of opened.entries()) {
      expect(dirname(record.path)).toBe(directory);
      expect(basename(record.path)).toMatch(/^\.project\.srn(?:\.bak)?\.[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.tmp$/);
      expect(open.mock.calls[index].slice(1)).toEqual(['wx', 0o600]);
      expect(record.write.mock.invocationCallOrder[0]).toBeLessThan(record.sync.mock.invocationCallOrder[0]);
      expect(record.sync.mock.invocationCallOrder[0]).toBeLessThan(record.close.mock.invocationCallOrder[0]);
      expect(record.close.mock.invocationCallOrder[0]).toBeLessThan(rename.mock.invocationCallOrder[0]);
    }
    expect(opened[0].path).not.toBe(opened[1].path);
    expect(rename.mock.calls).toEqual([[opened[1].path, `${target}.bak`], [opened[0].path, target]]);
    await expectNoOwnedTemps();
  });

  it.each([
    [1, 'open'], [1, 'writeFile'], [1, 'sync'], [1, 'close'],
    [2, 'open'], [2, 'writeFile'], [2, 'sync'], [2, 'close'],
  ] as const)('preserves originals and cleans owned temps when stage %i %s fails', async (stage, operation) => {
    const { originalBytes, backupBytes, next } = await seedExisting();
    const realOpen = fs.open.bind(fs);
    let calls = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const fail = ++calls === stage;
      if (fail && operation === 'open') throw ioError('EACCES');
      const handle = await realOpen(...args);
      if (fail && operation === 'writeFile') {
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
          await write('partial bytes');
          throw ioError('ENOSPC');
        });
      } else if (fail && operation === 'sync') {
        vi.spyOn(handle, 'sync').mockRejectedValueOnce(ioError());
      } else if (fail && operation === 'close') {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); throw ioError(); });
      }
      return handle;
    });
    const rename = vi.spyOn(fs, 'rename');
    await expect(writeProjectFile(target, next)).rejects.toThrow(stage === 2 ? /备份.*停止替换/ : /无法保存项目/);
    expect(rename).not.toHaveBeenCalled();
    expect(await fs.readFile(target, 'utf8')).toBe(originalBytes);
    expect(await fs.readFile(`${target}.bak`, 'utf8')).toBe(backupBytes);
    await expectNoOwnedTemps();
    vi.restoreAllMocks();
    // Failure, including close failure, must release the per-target save lock.
    await expect(writeProjectFile(target, next)).resolves.toBeUndefined();
  });

  it.each(['backup', 'target'] as const)('keeps the original when %s rename fails without unlinking it', async (destination) => {
    const { originalBytes, backupBytes, next } = await seedExisting();
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === (destination === 'backup' ? `${target}.bak` : target)) throw ioError('EPERM');
      await realRename(from, to);
    });
    const unlink = vi.spyOn(fs, 'unlink');
    await expect(writeProjectFile(target, next)).rejects.toThrow(/无法保存项目.*(?:备份|访问权限)/);
    expect(await fs.readFile(target, 'utf8')).toBe(originalBytes);
    expect(await fs.readFile(`${target}.bak`, 'utf8')).toBe(destination === 'backup' ? backupBytes : originalBytes);
    for (const [path] of unlink.mock.calls) expect(String(path)).toMatch(/\.[0-9a-f-]{36}\.tmp$/);
    await expectNoOwnedTemps();
  });

  it('cleans a failed first save without creating a target or backup', async () => {
    await fs.writeFile(join(directory, 'unknown.tmp'), 'keep');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(ioError('EPERM'));
    await expect(writeProjectFile(target, populatedProject())).rejects.toThrow(/访问权限/);
    expect(await fs.readdir(directory)).toEqual(['unknown.tmp']);
    expect(await fs.readFile(join(directory, 'unknown.tmp'), 'utf8')).toBe('keep');
  });

  it('does not delete a colliding temporary file that it did not create', async () => {
    const { originalBytes, backupBytes, next } = await seedExisting();
    const realOpen = fs.open.bind(fs);
    let collision = '';
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      collision = String(args[0]);
      await fs.writeFile(collision, 'belongs to another call', { flag: 'wx' });
      return realOpen(...args);
    });
    const unlink = vi.spyOn(fs, 'unlink');
    await expect(writeProjectFile(target, next)).rejects.toThrow(/名称冲突/);
    expect(unlink).not.toHaveBeenCalled();
    expect(await fs.readFile(collision, 'utf8')).toBe('belongs to another call');
    expect(await fs.readFile(target, 'utf8')).toBe(originalBytes);
    expect(await fs.readFile(`${target}.bak`, 'utf8')).toBe(backupBytes);
  });

  it('rejects concurrent saves to the same resolved target but allows independent targets', async () => {
    const project = populatedProject();
    const snapshot = structuredClone(project);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const realOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return realOpen(...args);
    });
    const saving = writeProjectFile(target, project);
    try {
      await started;
      project.title = '保存开始之后的修改';
      await expect(writeProjectFile(`${directory}/./project.srn`, project)).rejects.toThrow(/正在保存/);
      // A rejected call must not release the first caller's lock.
      await expect(writeProjectFile(target, project)).rejects.toThrow(/正在保存/);
      const other = join(directory, 'other.srn');
      await writeProjectFile(other, project);
      expect(await readProjectFile(other)).toEqual(project);
    } finally {
      release();
      await saving;
    }
    expect(await readProjectFile(target)).toEqual(snapshot);
    await writeProjectFile(target, project);
    expect(await readProjectFile(target)).toEqual(project);
    expect(await readProjectFile(`${target}.bak`)).toEqual(snapshot);
  });

  it('revalidates a target that changed outside this process before replacing it', async () => {
    await writeProjectFile(target, populatedProject());
    const external = populatedProject();
    await fs.writeFile(target, JSON.stringify(external));
    await fs.writeFile(join(directory, 'unknown.tmp'), 'do not touch');
    await writeProjectFile(target, { ...populatedProject(), title: '覆盖外部修改' });
    expect((await readProjectFile(target)).title).toBe('覆盖外部修改');
    expect((await readProjectFile(`${target}.bak`)).title).toBe(external.title);
    await expectNoOwnedTemps();
  });

  it('still refuses a target corrupted outside this process after an earlier save', async () => {
    await writeProjectFile(target, populatedProject());
    await fs.writeFile(target, '{broken');
    const open = vi.spyOn(fs, 'open');
    await expect(writeProjectFile(target, populatedProject())).rejects.toThrow(/拒绝覆盖.*另存为/);
    expect(open).not.toHaveBeenCalled();
    expect(await fs.readFile(target, 'utf8')).toBe('{broken');
    expect(await fs.readdir(directory)).toEqual(['project.srn']);
  });
});

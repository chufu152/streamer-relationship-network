import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { basename, dirname, join, resolve } from 'node:path';
import { validatePhotoAsset } from '../shared/photo';
import { projectSchema, PROJECT_LIMITS, type NetworkProject } from '../shared/project';

class ProjectFileError extends Error {}

// Main/UI also lock saves; this guard protects direct callers of the service.
const activeSaves = new Set<string>();

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function failureReason(error: unknown): string {
  if (error instanceof ProjectFileError) return error.message;
  if (hasCode(error, 'ENOENT')) return '文件或所在文件夹不存在';
  if (hasCode(error, 'ENOSPC')) return '磁盘空间不足，请释放空间后重试';
  if (hasCode(error, 'EACCES') || hasCode(error, 'EPERM') || hasCode(error, 'EBUSY')) {
    return '没有访问权限，或文件被其他程序占用，请检查后重试';
  }
  if (hasCode(error, 'EISDIR') || hasCode(error, 'ENOTDIR')) return '请选择有效的项目文件路径';
  if (hasCode(error, 'EEXIST')) return '临时文件名称冲突，请重试';
  return '文件操作失败，请检查路径、磁盘空间和访问权限后重试';
}

function checkSize(size: number): void {
  if (size > PROJECT_LIMITS.fileBytes) throw new ProjectFileError('项目文件不能超过 80 MiB');
}

function validateProject(input: unknown): NetworkProject {
  if (typeof input === 'object' && input !== null && 'schemaVersion' in input
    && typeof input.schemaVersion === 'number' && input.schemaVersion > projectSchema.shape.schemaVersion.value) {
    throw new ProjectFileError('此项目由更新版本创建，当前版本不支持，请升级应用后再打开或保存');
  }
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    throw new ProjectFileError('项目格式或数据无效，请检查必填字段、容量限制以及照片和关系引用');
  }
  for (const [index, asset] of parsed.data.assets.entries()) {
    try {
      validatePhotoAsset(asset);
    } catch (error) {
      throw new ProjectFileError(`第 ${index + 1} 个照片资产无效，请重新导入静态 WebP 照片`, { cause: error });
    }
  }
  return parsed.data;
}

async function decodeProjectPhotos(project: NetworkProject): Promise<void> {
  for (const asset of project.assets) {
    try {
      await sharp(Buffer.from(asset.dataBase64, 'base64'), { limitInputPixels: PROJECT_LIMITS.photoSide ** 2, failOn: 'warning' }).raw().toBuffer();
    } catch { throw new ProjectFileError('照片像素数据无效或已损坏，请重新导入照片'); }
  }
}

async function readValidatedFile(path: string): Promise<{ bytes: Buffer; project: NetworkProject }> {
  const metadata = await fs.stat(path);
  if (!metadata.isFile()) throw new ProjectFileError('请选择项目文件，不能打开文件夹或特殊文件');
  checkSize(metadata.size);
  const bytes = await fs.readFile(path);
  // A file may grow between stat and readFile; never trust the first size check alone.
  checkSize(bytes.byteLength);
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new ProjectFileError('项目文件不是有效的 UTF-8 JSON，文件可能已损坏', { cause: error });
  }
  const project = validateProject(input);
  await decodeProjectPhotos(project);
  return { bytes, project };
}

export async function readProjectFile(path: string): Promise<NetworkProject> {
  try {
    return (await readValidatedFile(path)).project;
  } catch (error) {
    throw new Error(`无法打开项目：${failureReason(error)}`, { cause: error });
  }
}

async function existingProjectBytes(path: string): Promise<Buffer | undefined> {
  let metadata;
  try {
    metadata = await fs.lstat(path);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  }
  // Never follow a writable target/backup symlink into an unrelated file.
  if (!metadata.isFile()) throw new ProjectFileError('目标不是普通项目文件，请另存为');
  try {
    return (await readValidatedFile(path)).bytes;
  } catch (error) {
    throw new ProjectFileError(`目标文件无法确认为有效项目，拒绝覆盖，请另存为。${failureReason(error)}`, { cause: error });
  }
}

async function stageFile(target: string, data: string | Buffer, ownedTemps: Set<string>): Promise<string> {
  const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  const handle = await fs.open(temp, 'wx', 0o600);
  // Only successful exclusive creation establishes ownership (not merely choosing a name).
  ownedTemps.add(temp);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temp;
}

export async function writeProjectFile(path: string, input: unknown): Promise<void> {
  const ownedTemps = new Set<string>();
  let acquiredLock: string | undefined;
  try {
    // Take an immutable, validated JSON snapshot before the first asynchronous operation.
    const project = validateProject(input);
    const json = JSON.stringify(project);
    checkSize(Buffer.byteLength(json, 'utf8'));
    await decodeProjectPhotos(project);

    const absolute = resolve(path);
    const target = join(await fs.realpath(dirname(absolute)), basename(absolute));
    const lockKey = process.platform === 'win32' ? target.toLowerCase() : target;
    if (activeSaves.has(lockKey)) throw new ProjectFileError('此项目正在保存，请等待完成后重试');
    activeSaves.add(lockKey);
    acquiredLock = lockKey;

    const previous = await existingProjectBytes(target);
    const temp = await stageFile(target, json, ownedTemps);
    if (previous !== undefined) {
      try {
        const backup = `${target}.bak`;
        // Valid backups can be rotated, but never overwrite an unknown file or symlink.
        await existingProjectBytes(backup);
        const backupTemp = await stageFile(backup, previous, ownedTemps);
        await fs.rename(backupTemp, backup);
        ownedTemps.delete(backupTemp);
      } catch (error) {
        throw new ProjectFileError(`无法准备项目备份，已停止替换并保留原文件。${failureReason(error)}`, { cause: error });
      }
    }
    // In particular, do NOT unlink the original to work around a Windows rename failure.
    await fs.rename(temp, target);
    ownedTemps.delete(temp);
  } catch (error) {
    throw new Error(`无法保存项目：${failureReason(error)}`, { cause: error });
  } finally {
    try {
      for (const temp of ownedTemps) {
        try {
          await fs.unlink(temp);
        } catch {
          // Best effort if permissions/locks also prevent cleanup; preserve the primary error.
          // No directory scans, original deletion, or cleanup of another call's temporary files.
        }
      }
    } finally {
      if (acquiredLock !== undefined) activeSaves.delete(acquiredLock);
    }
  }
}

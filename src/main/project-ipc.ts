import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { extname, join } from 'node:path';
import { FILE_CHANNELS, type DesktopFileApi, type FileResult } from '../shared/file-contracts';
import { projectSchema } from '../shared/project';
import { readProjectFile, writeProjectFile } from './project-files';

// Shared even across window recreation: an in-flight operation must finish first.
let busy = false;
const busyMessage = '正在处理文件或对话框，请等待完成后重试。';

function projectFileName(title: string): string {
  let name = Array.from(title)
    .map((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      || /[<>:"/\\|?*]/u.test(character) ? '_' : character)
    .slice(0, 60)
    .join('')
    .trim()
    .replace(/[. ]+$/u, '');
  if (!name) name = '未命名关系网';
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[. ]|$)/iu.test(name)) name = `_${name}`;
  return `${name}.srn`;
}

async function withFileLock<T>(operation: () => Promise<FileResult<T>>): Promise<FileResult<T>> {
  if (busy) return { status: 'error', message: busyMessage };
  busy = true;
  try {
    return await operation();
  } catch (error) {
    // The file service supplies user-facing Chinese errors; native dialog errors may not.
    const message = error instanceof Error && /^(?:无法打开项目：|无法保存项目：)/u.test(error.message)
      ? error.message
      : '文件操作失败，请检查文件访问权限、磁盘空间后重试。';
    return { status: 'error', message };
  } finally {
    busy = false;
  }
}

export function registerProjectIpc(window: BrowserWindow, rendererUrl: string): void {
  const contents = window.webContents;
  let currentPath: string | undefined;
  let allowClose = false;

  function requestError(event: IpcMainInvokeEvent, args: unknown[], count: number): string | undefined {
    if (window.isDestroyed() || contents.isDestroyed() || event.sender !== contents
      || event.senderFrame !== contents.mainFrame || event.senderFrame?.url !== rendererUrl) {
      return '请求来源无效，请重新打开应用后重试。';
    }
    if (args.length !== count) return '请求参数无效，请重试。';
    return undefined;
  }

  ipcMain.handle(FILE_CHANNELS.openProject, async (event, ...args: unknown[]): ReturnType<DesktopFileApi['openProject']> => {
    const error = requestError(event, args, 0);
    if (error) return { status: 'error', message: error };
    return withFileLock(async (): ReturnType<DesktopFileApi['openProject']> => {
      const selection = await dialog.showOpenDialog(window, {
        title: '打开项目',
        properties: ['openFile'],
        filters: [{ name: '人物交际网项目及备份', extensions: ['srn', 'bak'] }],
      });
      if (selection.canceled || selection.filePaths.length === 0 || window.isDestroyed()) {
        return { status: 'cancelled' };
      }
      if (selection.filePaths.length !== 1) return { status: 'error', message: '请只选择一个项目文件。' };
      const path = selection.filePaths[0];
      const project = await readProjectFile(path);
      if (window.isDestroyed()) return { status: 'cancelled' };
      // Display the selected backup path, but require Save As on the next save.
      currentPath = extname(path).toLowerCase() === '.bak' ? undefined : path;
      return { status: 'ok', value: { project, path } };
    });
  });

  ipcMain.handle(FILE_CHANNELS.saveProject, async (event, ...args: unknown[]): ReturnType<DesktopFileApi['saveProject']> => {
    const error = requestError(event, args, 2);
    if (error) return { status: 'error', message: error };
    const saveAs = args[1];
    if (typeof saveAs !== 'boolean') return { status: 'error', message: '保存参数无效，请重试。' };
    return withFileLock(async (): ReturnType<DesktopFileApi['saveProject']> => {
      const parsed = projectSchema.safeParse(args[0]);
      if (!parsed.success) return { status: 'error', message: '项目数据无效，请检查项目内容后重试。' };
      let path = currentPath;
      if (path === undefined || saveAs) {
        const selection = await dialog.showSaveDialog(window, {
          title: '保存项目',
          defaultPath: join(app.getPath('documents'), projectFileName(parsed.data.title)),
          filters: [{ name: '人物交际网项目', extensions: ['srn'] }],
        });
        if (selection.canceled || !selection.filePath || window.isDestroyed()) return { status: 'cancelled' };
        path = selection.filePath;
      }
      await writeProjectFile(path, parsed.data);
      currentPath = path;
      return { status: 'ok', value: { path } };
    });
  });

  ipcMain.handle(FILE_CHANNELS.resetProject, async (event, ...args: unknown[]): ReturnType<DesktopFileApi['resetProject']> => {
    const error = requestError(event, args, 0);
    if (error) return { status: 'error', message: error };
    return withFileLock(async () => {
      currentPath = undefined;
      return { status: 'ok', value: null };
    });
  });

  ipcMain.handle(FILE_CHANNELS.confirmUnsaved, async (event, ...args: unknown[]): ReturnType<DesktopFileApi['confirmUnsaved']> => {
    if (requestError(event, args, 0) || busy) return 'cancel';
    busy = true;
    try {
      const result = await dialog.showMessageBox(window, {
        type: 'question',
        title: '保存更改',
        message: '是否保存对当前项目的更改？',
        detail: '不保存将丢失尚未保存的更改。',
        buttons: ['保存', '不保存', '取消'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (window.isDestroyed()) return 'cancel';
      return result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel';
    } catch {
      // This API has no error variant: fail closed without discarding any changes.
      return 'cancel';
    } finally {
      busy = false;
    }
  });

  ipcMain.handle(FILE_CHANNELS.approveClose, async (event, ...args: unknown[]): ReturnType<DesktopFileApi['approveClose']> => {
    const error = requestError(event, args, 0);
    if (error) throw new Error(error);
    if (busy) throw new Error(busyMessage);
    allowClose = true;
    window.close();
  });

  window.on('close', (event) => {
    if (allowClose) return;
    event.preventDefault();
    if (!contents.isDestroyed() && contents.mainFrame.url === rendererUrl) {
      contents.send(FILE_CHANNELS.closeRequested);
    }
  });

  window.once('closed', () => {
    for (const channel of [
      FILE_CHANNELS.openProject,
      FILE_CHANNELS.saveProject,
      FILE_CHANNELS.resetProject,
      FILE_CHANNELS.confirmUnsaved,
      FILE_CHANNELS.approveClose,
    ]) ipcMain.removeHandler(channel);
  });
}

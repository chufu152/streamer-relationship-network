import { app, BrowserWindow, ipcMain, Menu, session } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_INFO_CHANNEL, type AppInfo } from '../shared/contracts';
import { isAllowedResource, validateDevelopmentUrl } from './security';

const developmentUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  ? validateDevelopmentUrl(process.env.ELECTRON_RENDERER_URL)
  : undefined;
const rendererFile = join(__dirname, '../renderer/index.html');
const rendererUrl = developmentUrl ?? pathToFileURL(rendererFile).href;
let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    title: '人物交际网',
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  const window = mainWindow;
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { mainWindow = null; });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  if (developmentUrl) await window.loadURL(developmentUrl);
  else await window.loadFile(rendererFile);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  void app.whenReady().then(async () => {
    app.setName('人物交际网');
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !isAllowedResource(details.url, rendererUrl, Boolean(developmentUrl)) });
    });
    ipcMain.handle(APP_INFO_CHANNEL, (event, ...args: unknown[]): AppInfo => {
      if (!mainWindow || event.sender !== mainWindow.webContents
        || event.senderFrame !== mainWindow.webContents.mainFrame
        || event.senderFrame.url !== rendererUrl || args.length > 0) {
        throw new Error('Untrusted IPC request');
      }
      return { name: app.getName(), version: app.getVersion(), platform: process.platform };
    });
    await createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
  }).catch((error: unknown) => {
    console.error('Application startup failed', error);
    app.exit(1);
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

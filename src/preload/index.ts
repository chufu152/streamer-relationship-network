import { contextBridge, ipcRenderer } from 'electron';
import { APP_INFO_CHANNEL, type AppInfo, type DesktopApi } from '../shared/contracts';

const api: DesktopApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL) as Promise<AppInfo>,
};

contextBridge.exposeInMainWorld('desktop', Object.freeze(api));

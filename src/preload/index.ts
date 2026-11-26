import { contextBridge, ipcRenderer } from 'electron';
import { FILE_CHANNELS } from '../shared/file-contracts';
import { APP_INFO_CHANNEL, type AppInfo, type DesktopApi } from '../shared/contracts';

const api: DesktopApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL) as Promise<AppInfo>,
  openProject: () => ipcRenderer.invoke(FILE_CHANNELS.openProject),
  saveProject: (project, saveAs) => ipcRenderer.invoke(FILE_CHANNELS.saveProject, project, saveAs),
  resetProject: () => ipcRenderer.invoke(FILE_CHANNELS.resetProject),
  confirmUnsaved: () => ipcRenderer.invoke(FILE_CHANNELS.confirmUnsaved),
  approveClose: () => ipcRenderer.invoke(FILE_CHANNELS.approveClose),
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(FILE_CHANNELS.closeRequested, listener);
    return () => ipcRenderer.removeListener(FILE_CHANNELS.closeRequested, listener);
  },
};

contextBridge.exposeInMainWorld('desktop', Object.freeze(api));

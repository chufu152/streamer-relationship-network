import type { NetworkProject } from './project';

export const FILE_CHANNELS = {
  openProject: 'file:open-project',
  saveProject: 'file:save-project',
  resetProject: 'file:reset-project',
  confirmUnsaved: 'file:confirm-unsaved',
  closeRequested: 'file:close-requested',
  approveClose: 'file:approve-close',
} as const;

export type FileResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export type DesktopFileApi = {
  openProject: () => Promise<FileResult<{ project: NetworkProject; path: string }>>;
  saveProject: (project: NetworkProject, saveAs: boolean) => Promise<FileResult<{ path: string }>>;
  resetProject: () => Promise<FileResult<null>>;
  confirmUnsaved: () => Promise<'save' | 'discard' | 'cancel'>;
  onCloseRequested: (callback: () => void) => () => void;
  approveClose: () => Promise<void>;
};

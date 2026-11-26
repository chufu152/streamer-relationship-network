import type { DesktopFileApi } from './file-contracts';

export const APP_INFO_CHANNEL = 'app:get-info';

export type AppInfo = {
  name: string;
  version: string;
  platform: string;
};

export type DesktopApi = DesktopFileApi & {
  getAppInfo: () => Promise<AppInfo>;
};

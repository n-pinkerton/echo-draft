import type {
  AppVersionResult,
  UpdateCheckResult,
  UpdateInfoResult,
  UpdateResult,
  UpdateStatusResult,
} from "../electron";

export interface ElectronAPIUpdates {
  // Update operations
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdate: () => Promise<UpdateResult>;
  installUpdate: () => Promise<UpdateResult>;
  getAppVersion: () => Promise<AppVersionResult>;
  getUpdateStatus: () => Promise<UpdateStatusResult>;
  getUpdateInfo: () => Promise<UpdateInfoResult | null>;

  // Update event listeners
  onUpdateAvailable: (callback: (event: any, info: any) => void) => () => void;
  onUpdateNotAvailable: (callback: (event: any, info: any) => void) => () => void;
  onUpdateDownloaded: (callback: (event: any, info: any) => void) => () => void;
  onUpdateDownloadProgress: (callback: (event: any, progressObj: any) => void) => () => void;
  onUpdateError: (callback: (event: any, error: any) => void) => () => void;
}


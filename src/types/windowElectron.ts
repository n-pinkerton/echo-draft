import type { ElectronAPI } from "./electronApi/ElectronAPI";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    api?: {
      sendDebugLog: (message: string) => void;
    };
  }
}

export {};


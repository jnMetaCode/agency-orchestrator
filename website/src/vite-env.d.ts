/// <reference types="vite/client" />

interface AoDesktopStorageStatus {
  activeDir: string;
  defaultDir: string;
  source: "default" | "settings" | "environment";
  canChange: boolean;
}

interface Window {
  /** Electron preload bridge；普通浏览器 / 官网中不存在。 */
  aoDesktop?: {
    storageStatus: () => Promise<AoDesktopStorageStatus>;
    chooseDataDir: (lang?: "zh" | "en") => Promise<{ ok: boolean; canceled?: boolean; error?: string; restarting?: boolean; status?: AoDesktopStorageStatus }>;
    resetDataDir: (lang?: "zh" | "en") => Promise<{ ok: boolean; canceled?: boolean; error?: string; restarting?: boolean; status?: AoDesktopStorageStatus }>;
    openDataDir: () => Promise<{ ok: boolean; error?: string }>;
  };
}

// Minimal, capability-scoped bridge for desktop-only settings.
// The website build also runs in normal browsers, where window.aoDesktop is absent.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aoDesktop", {
  storageStatus: () => ipcRenderer.invoke("ao-desktop:storage-status"),
  chooseDataDir: (lang) => ipcRenderer.invoke("ao-desktop:choose-data-dir", lang === "en" ? "en" : "zh"),
  resetDataDir: (lang) => ipcRenderer.invoke("ao-desktop:reset-data-dir", lang === "en" ? "en" : "zh"),
  openDataDir: () => ipcRenderer.invoke("ao-desktop:open-data-dir"),
});

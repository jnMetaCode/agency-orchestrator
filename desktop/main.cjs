// Agency Orchestrator — Electron desktop shell.
// Launches the existing Node backend (web/server.js) using Electron's bundled
// Node (ELECTRON_RUN_AS_NODE), then opens a native window onto the local UI.
// No system Node install required.
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");

const ROOT = app.isPackaged ? path.join(process.resourcesPath, "app") : path.resolve(__dirname, "..");
const PORT = process.env.AO_DESKTOP_PORT || "8799";
const BASE = `http://127.0.0.1:${PORT}/`;
let backend = null;

function startBackend() {
  const serverPath = path.join(ROOT, "web", "server.js");
  backend = spawn(process.execPath, [serverPath], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1", // run the backend (and its engine children) as plain Node
      AO_NODE: process.execPath, // engine binary the server should spawn
      AO_DATA_DIR: app.getPath("userData"), // writable dir for outputs / keys (bundle is read-only)
      PORT,
      HOST: "127.0.0.1",
    },
    stdio: "inherit",
  });
  backend.on("exit", () => {
    backend = null;
  });
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}api/health`, (r) => {
      r.resume();
      resolve(r.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitHealth(timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await ping()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 600,
    title: "Agency Orchestrator",
    backgroundColor: "#0b0e14",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });
  // Open external links in the system browser, not inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL(`${BASE}studio`);
}

app.whenReady().then(async () => {
  startBackend();
  const ok = await waitHealth();
  if (!ok) console.error("[desktop] backend did not become healthy in time");
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => {
  try {
    backend && backend.kill();
  } catch {
    /* noop */
  }
});

// Agency Orchestrator — Electron desktop shell.
// Launches the existing Node backend (web/server.js) using Electron's bundled
// Node (ELECTRON_RUN_AS_NODE), then opens a native window onto the local UI.
// No system Node install required.
const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");

const ROOT = app.isPackaged ? path.join(process.resourcesPath, "app") : path.resolve(__dirname, "..");
const DEFAULT_PORT = Number(process.env.AO_DESKTOP_PORT || 8799);
let port = DEFAULT_PORT; // 实际端口在启动时确定（可能因占用而顺延）
let backend = null;
let mainWindow = null;
// 引擎日志/退出现场：打包后的 app 没有终端，启动失败时这是唯一可排查的信息
// （群反馈只看到"启动失败"没法定位的根因——之前 stdio:"inherit" 输出全丢）。
let logStream = null;
let logPath = "";
let stderrTail = "";
let backendExit = null;

const base = () => `http://127.0.0.1:${port}/`;
const studioUrl = () => {
  // 中文优先产品：桌面默认中文（即便 macOS 系统语言是英文）。英文仍可在界面右上角切换，
  // 切换后由 localStorage 记住。AO_DESKTOP_LANG=en 可显式覆盖为英文。
  const lang = String(process.env.AO_DESKTOP_LANG || "").toLowerCase().startsWith("en") ? "en" : "zh";
  return `${base()}studio?lang=${lang}`;
};

// 启动中 / 失败时显示的本地页面（data URL，不依赖后端，避免后端没起来时白屏）。
function splashHtml(message, spinner = true) {
  const dot = spinner
    ? `<div class="s"></div>`
    : `<div style="font-size:34px;line-height:1">⚠️</div>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{height:100%;margin:0}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
       background:#0b0e14;color:#e5e7eb;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif}
  .b{display:grid;place-items:center;width:56px;height:56px;border-radius:14px;background:#7c5cff;
     color:#fff;font-weight:800;font-size:24px}
  .s{width:22px;height:22px;border:3px solid #2a2f3a;border-top-color:#7c5cff;border-radius:50%;
     animation:r .8s linear infinite}
  @keyframes r{to{transform:rotate(360deg)}}
  .m{color:#9aa3b2;max-width:420px;text-align:center;padding:0 24px}
</style></head><body>
  <div class="b">ao</div>${dot}
  <div class="m">${message}</div>
</body></html>`);
}

// GUI apps launched from Finder/Dock inherit the minimal launchd PATH
// (/usr/bin:/bin:/usr/sbin:/sbin), NOT the user's shell PATH. So CLI providers
// installed in homebrew / ~/.local/bin / npm-global (claude, codex, gemini…) are
// invisible to the spawned engine → "找不到 claude / 连不上本地 CLI" (issue #41).
// Rebuild a usable PATH: the login shell's PATH (best effort) + common bin dirs.
function resolvedPath() {
  const parts = [];
  if (process.platform !== "win32") {
    // Ask the login shell for its PATH (covers nvm/asdf/custom installs).
    try {
      const shellBin = process.env.SHELL || "/bin/zsh";
      const out = execFileSync(shellBin, ["-lic", "printf %s \"$PATH\""], {
        timeout: 4000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (out) parts.push(out);
    } catch {
      /* shell probe failed — fall back to curated dirs below */
    }
    const home = os.homedir();
    parts.push(
      "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
      path.join(home, ".local/bin"),
      path.join(home, ".npm-global/bin"),
      path.join(home, ".bun/bin"),
      path.join(home, ".deno/bin"),
      path.join(home, ".cargo/bin"),
    );
  }
  if (process.env.PATH) parts.push(process.env.PATH);
  // de-dupe, preserve order, drop empties
  const seen = new Set();
  const sep = process.platform === "win32" ? ";" : ":";
  return parts
    .join(sep)
    .split(sep)
    .filter((p) => p && !seen.has(p) && seen.add(p))
    .join(sep);
}

// 找一个可用端口：从首选端口起顺延，避免端口被占用时后端 bind 失败导致整个 app 白屏。
function findFreePort(start, tries = 20) {
  return new Promise((resolve, reject) => {
    let p = start;
    let left = tries;
    const tryOne = () => {
      const srv = net.createServer();
      srv.once("error", () => {
        srv.close();
        if (--left <= 0) return reject(new Error("no free port near " + start));
        p += 1;
        tryOne();
      });
      srv.once("listening", () => srv.close(() => resolve(p)));
      srv.listen(p, "127.0.0.1");
    };
    tryOne();
  });
}

// ── pure helpers（test/desktop-helpers.ts 按这两行标记把它们抠出来单测；打包只带 main.cjs，所以不拆文件）──
// >>> pure-helpers
/**
 * 只有 http(s) / mailto 才交给系统打开。模型产出和社区模板里的链接是不可信输入：
 * `file:///…`、`smb://…`、各种自定义协议（`vscode://`、`ms-msdt:` 这类有过真实漏洞）点一下就会
 * 调起本机的处理程序。
 */
function isSafeExternalUrl(raw) {
  try {
    const u = new URL(String(raw));
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:";
  } catch {
    return false;
  }
}

/**
 * engine.log 只追加、从不清理——常驻开着的桌面版会把它写到几百 MB。启动时超过上限就轮转成
 * engine.log.1（只留一份旧的），正在排查的那次运行的日志不会因此丢。
 */
function rotateLogIfLarge(fsMod, file, maxBytes) {
  try {
    if (fsMod.statSync(file).size <= maxBytes) return false;
    fsMod.renameSync(file, file + ".1");
    return true;
  } catch {
    return false; // 文件还不存在 / 改名失败：都不该挡住启动
  }
}
// <<< pure-helpers

function startBackend() {
  const serverPath = path.join(ROOT, "web", "server.js");
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, "engine.log");
    rotateLogIfLarge(fs, logPath, 5 * 1024 * 1024);
    try { logStream && logStream.end(); } catch { /* noop */ }
    logStream = fs.createWriteStream(logPath, { flags: "a" });
    logStream.write(`\n===== boot ${new Date().toISOString()} port=${port} =====\n`);
  } catch {
    logStream = null;
  }
  backendExit = null;
  stderrTail = "";
  backend = spawn(process.execPath, [serverPath], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1", // run the backend (and its engine children) as plain Node
      AO_NODE: process.execPath, // engine binary the server should spawn
      AO_DATA_DIR: app.getPath("userData"), // writable dir for outputs / keys (bundle is read-only)
      PATH: resolvedPath(), // so CLI providers (claude/codex/gemini) are found (issue #41)
      PORT: String(port),
      HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const feed = (chunk, isErr) => {
    const text = chunk.toString();
    // stderr 末尾 2KB 常驻内存——启动失败对话框直接把崩溃原因摆到用户眼前
    if (isErr) stderrTail = (stderrTail + text).slice(-2000);
    try { logStream && logStream.write(text); } catch { /* noop */ }
  };
  backend.stdout.on("data", (c) => feed(c, false));
  backend.stderr.on("data", (c) => feed(c, true));
  backend.on("exit", (code, signal) => {
    backendExit = { code, signal };
    try { logStream && logStream.write(`===== engine exit code=${code} signal=${signal || ""} =====\n`); } catch { /* noop */ }
    backend = null;
  });
}

function stopBackend() {
  try {
    backend && backend.kill();
  } catch {
    /* noop */
  }
  backend = null;
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get(`${base()}api/health`, (r) => {
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

async function waitHealth(timeoutMs = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await ping()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// ── 更新检查：启动后静默查 GitHub 最新 desktop-v* release，有新版弹一次提示 ──
// 不做静默自动更新（需要签名/更新服务器），只提示 + 一键跳转下载页——旧版本没有
// 任何更新入口，用户根本不知道有新版。AO_DESKTOP_NO_UPDATE_CHECK=1 可关闭。
const RELEASES_API = "https://api.github.com/repos/jnMetaCode/agency-orchestrator/releases?per_page=30";
function semverNewer(a, b) {
  // a > b ? 比较 "0.2.7" 风格；解析失败按不更新处理
  const pa = String(a).split(".").map((n) => parseInt(n, 10));
  const pb = String(b).split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x !== y) return x > y;
  }
  return false;
}
let updateChecked = false; // 每次进程只查一次——关窗再开（复用引擎路径）不重复弹
async function checkForUpdate(win) {
  if (process.env.AO_DESKTOP_NO_UPDATE_CHECK === "1" || updateChecked) return;
  updateChecked = true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(RELEASES_API, {
      signal: ctrl.signal,
      headers: { "user-agent": "agency-orchestrator-desktop", accept: "application/vnd.github+json" },
    });
    clearTimeout(timer);
    if (!r.ok) return;
    const releases = await r.json();
    const latest = (Array.isArray(releases) ? releases : []).find(
      (rel) => rel && !rel.draft && !rel.prerelease && /^desktop-v\d/.test(rel.tag_name || ""),
    );
    if (!latest) return;
    const latestVer = latest.tag_name.replace(/^desktop-v/, "");
    if (!semverNewer(latestVer, app.getVersion())) return;
    if (win.isDestroyed()) return;
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      title: "Agency Orchestrator",
      message: `发现新版本 v${latestVer}（当前 v${app.getVersion()}）`,
      detail: latest.name && latest.name !== latest.tag_name ? latest.name : "包含最新功能与修复，建议更新。",
      buttons: ["前往下载", "本次忽略"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0 && isSafeExternalUrl(latest.html_url)) shell.openExternal(latest.html_url);
  } catch {
    /* 离线/被墙/接口限流 → 静默跳过，绝不打扰启动 */
  }
}

// 启动引擎并把窗口指向 Studio；失败时给出可重试的原生对话框，而不是静默白屏。
async function boot(win) {
  win.loadURL(splashHtml("正在启动本地引擎…"));
  // 引擎还活着且健康（macOS 关窗不退出、从 Dock 再次打开 / 双击二次启动聚焦）→ 直接复用。
  // 以前这里无条件重新找空闲端口：自家健康引擎占着 8799，新窗口被顺延到 8800，又因
  // backend 非空跳过启动，最后去 ping 一个没人监听的端口 → 必然"启动失败"。这就是
  // 大量用户反馈"关掉后再打开必报错、重装（=完全退出）才能好"的根因。
  if (backend && (await ping())) {
    win.loadURL(studioUrl());
    checkForUpdate(win);
    return;
  }
  if (backend) stopBackend(); // 进程还在但不健康 → 杀掉重来，别留半死的占着端口
  try {
    port = await findFreePort(DEFAULT_PORT);
  } catch {
    /* 极端情况下找不到空闲端口，仍尝试默认端口 */
    port = DEFAULT_PORT;
  }
  startBackend();
  const ok = await waitHealth();
  if (win.isDestroyed()) return; // 用户在启动期间关掉了窗口
  if (ok) {
    win.loadURL(studioUrl());
    // 引擎就绪后再查更新，不挡启动路径
    setTimeout(() => checkForUpdate(win), 3000);
    return;
  }
  // 引擎没起来：把真实原因（进程崩溃 vs 等待超时）+ 崩溃输出 + 日志路径摆出来，
  // 而不是笼统怪"端口被占用"（端口本就自动顺延，几乎不可能是它）。
  const crashed = !!backendExit;
  win.loadURL(splashHtml(crashed ? "本地引擎启动后异常退出。" : "本地引擎未能就绪（等待超时）。", false));
  const tail = stderrTail.trim().split("\n").filter(Boolean).slice(-4).join("\n");
  const detail =
    (crashed
      ? `引擎进程启动后退出（代码 ${backendExit.code ?? "?"}${backendExit.signal ? " / " + backendExit.signal : ""}）。`
      : `等待引擎就绪超时（已自动选用空闲端口 ${port}）。`) +
    (tail ? `\n\n最近错误输出：\n${tail}` : "") +
    (logPath ? `\n\n完整日志：${logPath}` : "") +
    `\n\n提示：端口无需手动修改（从 ${DEFAULT_PORT} 起自动顺延）；如需固定端口，启动前设置环境变量 AO_DESKTOP_PORT。`;
  for (;;) {
    const { response } = await dialog.showMessageBox(win, {
      type: "error",
      title: "Agency Orchestrator",
      message: crashed ? "本地引擎启动后异常退出" : "本地引擎启动超时",
      detail,
      buttons: ["重试", "打开日志", "退出"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 1) {
      if (logPath) shell.showItemInFolder(logPath);
      continue; // 看完日志回到对话框，用户再决定重试/退出
    }
    if (response === 0) {
      stopBackend();
      await boot(win);
    } else {
      app.quit();
    }
    return;
  }
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
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  // Open external links in the system browser, not inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // 没带 target=_blank 的外链会让**应用窗口自己**跳走：Studio 没了，用户也回不来（没有地址栏）。
  // 站内导航照常；站外的拦下，安全的交给系统浏览器。
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(base()) || url.startsWith("data:text/html")) return; // data: = 启动/报错用的 splash 页
    event.preventDefault();
    if (isSafeExternalUrl(url)) shell.openExternal(url);
  });
  // Studio 加载失败（偶发：引擎刚好还没就绪）→ 短暂重试几次再放弃。
  let reloadTries = 0;
  win.webContents.on("did-fail-load", (_e, code, _desc, failedUrl) => {
    // -3 = ERR_ABORTED（正常的导航打断），忽略；只对真正的连接失败重试。
    if (code === -3 || !failedUrl.startsWith(base())) return;
    if (reloadTries++ < 5) {
      setTimeout(() => {
        if (!win.isDestroyed()) win.loadURL(studioUrl());
      }, 600);
    }
  });
  win.webContents.on("did-finish-load", () => {
    if (win.webContents.getURL().startsWith(base())) reloadTries = 0;
  });
  boot(win);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已有实例在运行：直接退出，避免第二个后端抢占端口。
  app.quit();
} else {
  app.on("second-instance", () => {
    // 用户再次启动 → 聚焦已有窗口，而不是开新的。
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("quit", stopBackend);
}

# 代码签名 / Code Signing

桌面客户端目前是**未签名版**。本文说明各平台不签名的后果、要彻底去掉系统提示需要什么、以及怎么在发布流程里启用签名。

> TL;DR：**不签名也能用**——Mac 跑一条 `xattr` 命令，Windows 点「仍要运行」。
> 嫌麻烦完全可以不装桌面版，直接用**网页版**（见文末）。

---

## 不签名时用户看到什么

| 平台 | 提示 | 用户怎么绕过 | 严重程度 |
|---|---|---|---|
| **macOS** | 「"Agency Orchestrator"已损坏，无法打开」 | 拖进「应用程序」后终端跑 `sudo xattr -cr "/Applications/Agency Orchestrator.app"` | 硬拦，最影响体验 |
| **Windows** | 「Windows 已保护你的电脑」(SmartScreen) | 「更多信息」→「仍要运行」 | 软提示，一次点击即可 |
| **Linux** | 无 | —— | 无 |

结论：**Mac 最该先签**（硬拦），Windows 可以等有量再说。

---

## macOS 公证（Notarization）

去掉「已损坏」提示需要 **Apple 开发者账号（$99/年）** + 签名 + 公证。

需要准备：
1. 加入 [Apple Developer Program](https://developer.apple.com/programs/)（$99/年）。
2. 创建 **Developer ID Application** 证书，导出为 `.p12`。
3. 生成 **App-Specific Password**（用于公证）。

启用步骤：
1. 去掉 `desktop/package.json` 里 mac 的 `"identity": null`（让 electron-builder 真正签名）。
2. 在仓库 **Settings → Secrets and variables → Actions** 添加：
   - `CSC_LINK` — `.p12` 证书的 base64（`base64 -i cert.p12 | pbcopy`）
   - `CSC_KEY_PASSWORD` — `.p12` 密码
   - `APPLE_ID` — Apple 账号邮箱
   - `APPLE_APP_SPECIFIC_PASSWORD` — App 专用密码
   - `APPLE_TEAM_ID` — 团队 ID

`.github/workflows/release-desktop.yml` 已透传以上 env：**填了就自动签名+公证，没填就出未签名版**，流程无需改动。

---

## Windows 代码签名

去掉 SmartScreen 提示需要**一张代码签名证书**（要花钱），而且 2023-06 起证书必须存在硬件/云 HSM 里，不能再直接用 `.pfx`。三条路：

| 方案 | 成本 | 即时去警告？ | 备注 |
|---|---|---|---|
| **OV 证书**(DigiCert/Sectigo 等) | ~$100–400/年 | ❌ 要靠下载量攒 SmartScreen 声誉 | 需企业主体 + 硬件令牌 |
| **EV 证书** | ~$300–600+/年 | ✅ 一发布即无警告 | 需企业主体 + 硬件令牌，最贵 |
| **Azure Trusted Signing** | ~$10/月 | 逐步建立 | **最省**，可在 CI 自动签；要求公司满 3 年或走个人核验 |

启用思路：用所选服务在 CI 里对 `desktop/release/*.exe` 签名（electron-builder 支持 `signtool` / 自定义 sign hook 或 Azure Trusted Signing action），再上传到 Release。当前 workflow 未接 Windows 签名，需要时再加一步。

---

## 优先级建议

1. **先 macOS 公证**（硬拦，体验最差，$99/年固定）。
2. **Windows 看量再说**，要做优先 **Azure Trusted Signing**（最便宜、能 CI）。
3. Linux 不用签。

在那之前，未签名版配合上面的绕过说明完全够用。

---

## 不想装？用网页版

桌面客户端只是把网页 Studio 包成原生 App。**不装也行**，两种网页方式都没有任何签名提示：

- **本地网页 Studio（推荐，功能完整）**
  ```bash
  npm i -g agency-orchestrator
  ao web
  ```
  浏览器打开即用，功能和桌面版完全一样，API key 只存本机。

- **公开演示站（零安装体验）**
  打开 [ao.aiolaola.com](https://ao.aiolaola.com)，演示模式，**请勿填真实 API key**。

三条路任选其一：网页演示站（体验）→ `ao web`（本地完整）→ 桌面客户端（免命令行）。

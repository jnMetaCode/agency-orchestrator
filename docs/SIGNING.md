# 代码签名 / Code Signing

桌面客户端目前是**未签名版**。本文说明各平台不签名的后果、要彻底去掉系统提示需要什么、以及怎么在发布流程里启用签名。

> TL;DR：**不签名也能用**——Mac 跑一条 `xattr` 命令（跑完记得**再双击一次**，命令不会自动打开 App，
> 旧弹窗也不会自己消失，很容易误判成没生效），Windows 点「仍要运行」。
> 嫌麻烦完全可以不装桌面版，直接用**网页版**（见文末）。

---

## 不签名时用户看到什么

| 平台 | 提示 | 用户怎么绕过 | 严重程度 |
|---|---|---|---|
| **macOS** | 「"Agency Orchestrator"已损坏，无法打开」或「无法检查其是否包含恶意软件」 | 拖进「应用程序」后终端跑 `sudo xattr -cr "/Applications/Agency Orchestrator.app"` | 硬拦，最影响体验 |
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

启用步骤（**无需改任何代码**——`desktop/electron-builder.config.cjs` 检测到证书自动切真签名+公证，
afterSign 的 ad-hoc 重签也会自动跳过）：
1. 在仓库 **Settings → Secrets and variables → Actions** 添加：
   - `CSC_LINK` — `.p12` 证书的 base64（`base64 -i cert.p12 | pbcopy`）
   - `CSC_KEY_PASSWORD` — `.p12` 密码
   - `APPLE_ID` — Apple 账号邮箱
   - `APPLE_APP_SPECIFIC_PASSWORD` — App 专用密码
   - `APPLE_TEAM_ID` — 团队 ID

`.github/workflows/release-desktop.yml` 已透传以上 env：**填了就自动签名+公证（Hardened Runtime + entitlements 已备好），没填就出未签名版**，流程无需改动。填完 Secrets 后推下一个 `desktop-v*` tag 即生效；CI 日志里 `[signing]` 一行会说明走了哪条分支。

---

## Windows 代码签名

Windows 签名用于证明发布者身份并验证文件完整性。它**不保证立即消除 SmartScreen 警告**；新发布者仍需要积累信誉。EV 证书也不再享有立即跳过警告的待遇。

| 方案 | 费用与条件 | 当前评估 |
|---|---|---|
| **SignPath Foundation** | 符合条件的开源项目可申请免费签名，需审核、来源验证与人工批准 | 维护者已于 2026-10-21 手动提交，**等待审核、未获批**；见 [申请材料与差距](SIGNPATH.md) |
| **OV 代码签名证书** | 微软给出的参考价 $150–300/年；硬件令牌 / 云 HSM、服务和地区费用另核 | 先向证书商确认申请主体与地区是否支持，再决定购买 |
| **EV 证书** | 通常更贵，审核更严格 | 不应仅为消除 SmartScreen 警告购买 |
| **Azure Artifact Signing**（原 Trusted Signing） | 约 $9.99/月；目前个人主体仅美国、加拿大，组织主体限美国、加拿大、欧盟、英国 | 澳门个人不在当前所列支持范围；不是改 Apple ID 地区就能开通 |
| **Microsoft Store MSIX** | 商店审核后由微软重新签名，无需单独购买签名证书 | 需要适配 MSIX 与商店发布；当前 EXE 安装包不自动享受这一机制 |

价格、地区和可用性以实际申请及服务商最新说明为准。普通公开代码签名证书私钥有硬件 / 云 HSM 保管要求，不能假设拿到一个软件 `.pfx` 就能直接在 CI 使用。

当前 workflow **尚未接入 Windows 签名**。接入时必须明确应用 EXE、安装包和卸载程序的签名范围，并在最终签名之后生成校验文件和 blockmap，验签失败不得发布签名版本。

来源：[微软签名方案对比](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)、[SignPath 条件](https://signpath.org/terms.html)。

---

## 优先级建议

1. **先 macOS 公证**（硬拦，体验最差，$99/年固定）。
2. **Windows 先评估 SignPath 开源免费申请**，审核通过再接入；不符合时再比较适用地区的商业证书或商店方案。
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

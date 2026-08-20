// electron-builder afterSign 钩子：对 mac .app 做一次完整的 ad-hoc 重签。
//
// 背景：未签名（无 Apple 证书）构建走 `mac.identity: null`，但 electron-builder 25.x 产出的
// ad-hoc 签名是残缺的（`codesign --verify` 报 "code has no resources but signature indicates
// they must be present"），导致在 Apple 芯片 Mac 上被 AMFI 内核层 SIGKILL——用户"装了打不开"。
// 这里在打包签名后强制 `codesign --force --deep --sign -` 重签整包（含所有 Helper/Framework），
// 生成合法的 _CodeSignature，让未签名版也能在 arm64 上正常启动（首次仍需右键打开/去隔离，属正常）。
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  // 真证书签名（CSC_LINK 存在）时绝不能 ad-hoc 重签——`codesign --force --sign -`
  // 会把 Developer ID 签名整个替换成 ad-hoc，公证与 Gatekeeper 全白做。
  if (process.env.CSC_LINK) {
    console.log("[afterSign] 检测到证书签名，跳过 ad-hoc 重签（重签会毁掉 Developer ID 签名）");
    return;
  }
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`[afterSign] ad-hoc 重签整包: ${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  // 校验：残缺签名会在此抛错，让构建早失败而不是发出装不上的包
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=1", appPath], { stdio: "inherit" });
  console.log(`[afterSign] ad-hoc 签名有效 ✅`);
};

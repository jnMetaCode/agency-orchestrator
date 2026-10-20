# 桌面发布完整性验证

桌面 workflow 位于 `.github/workflows/release-desktop.yml`。构建与公开发布分开执行，避免某个平台失败后，其他平台先把缺包版本设为 latest。

## 流程

1. 三个平台都从目标 `refs/tags/desktop-v<version>` 检出；手动触发的 tag 必须与该源码中的 `desktop/package.json` 版本一致。
2. 原有前端、安装包内容检查通过后，运行 `scripts/verify-desktop-release.mjs stage`。只收集本平台安装包和可选 blockmap，生成 SHA-256 与包含 tag、版本、源码 SHA、workflow run ID 的清单。
3. 每个平台上传独立的当前运行 artifact。构建 job 只有读仓库权限，不创建 Release。
4. `publish` 依赖整个构建矩阵成功；下载当前运行产物，验证三平台、两个 mac 文件名架构、文件非空、完整来源信息、大小和 SHA-256。
5. 仅验证后的新目录进入上传。已有同名 Release（包括草稿）时停止；没有时先上传草稿，上传成功才公开并标记 latest。

这些检查验证产物完整性与来源一致性，不代替代码签名、公证、安装包实际运行验收或二进制架构检查。签名说明见 [SIGNING.md](./SIGNING.md)。

## 失败与重跑

- 构建、上传 workflow artifact 或整体验证失败：不创建公开 Release，已有 latest 不受这些步骤影响。
- 同一次 workflow 仅重跑失败平台时，成功平台的 artifact 可复用，必须与当前 tag、SHA 和 run ID 一致；产物保留 7 天，过期后须重新构建全部平台。
- 草稿上传失败或公开步骤失败：可能留下同名草稿。重跑会明确停止，须先人工检查草稿和已上传资产，再决定处理方式。流程不自动删除已有 Release 或覆盖资产。
- 已公开的同名 Release 不能由本流程静默重发。如修复已发布安装包，应审阅原因并规划新的版本。
- 手动运行旧 tag：该 tag 源码中也必须包含当前验证脚本，否则构建失败；不要使用新 workflow 配旧源码凑包。

## 本地验证

运行 `npm run test:desktop-release`。测试使用临时目录和虚构安装包，覆盖缺平台/架构、空文件、版本/来源不匹配、同大小篡改、校验清单损坏、目录遍历、符号链接、流程依赖及已有 Release/API 错误处理。测试不访问 GitHub、不签名、不发版。

workflow 的真实下载、上传、草稿转公开和三平台安装仍需 GitHub Actions 与桌面环境验收。本地 YAML 解析与脚本测试不能宣称这些远端操作已经通过。

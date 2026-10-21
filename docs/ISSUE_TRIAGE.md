# Issue 处理与验收（2026-10-21）

以可复现的行为和发布产物为准；自动化替身通过不等于真实服务商调用通过。

| Issue | 优先级 | 当前结论 | 完成条件 |
| --- | --- | --- | --- |
| #196 Hermes 超长提示词 | P1 | main 已修复：超出 argv 上限时使用官方 query-file stdin 协议，普通请求保持旧协议；Windows 专项 CI 已通过 | 回归与 Windows CI 通过，发布包含修复的新版本；旧 Hermes 明确提示升级 |
| #194 Windows dsh 静默空输出 | P1 | 0.4.13 已发布运行时选择修复；真实 Windows + Electron 桥接四条路径均通过 | 外部 Node 自动选择、显式指定、无兼容 Node、无效指定四条路径通过；真实 dsh 账号调用仍需用户验证 |
| #44 目录设置与资源体积 | P2 | 0.4.13 已有数据目录设置、Windows 安装目录选择、可选语言资源排除 | 新增临时目录 IPC/文件系统集成测试已通过：切换持久化、重启调用、取消、恢复默认、权限失败、角色库安装/离线重试/损坏清理；迁移提示已补 role-libraries。Windows CI 已通过；真实 npm 韩语库 1.0.1 下载并读取 187 个角色，更换应用路径仍可识别。真实原生界面验收尚待完成，测试中的原生对话框与重启使用替身，不宣称真实 GUI 已通过 |
| #91 读取本地项目并执行计划 | P2 | 原画布保存问题已修；剩余是项目执行能力，不应以文本生成冒充项目实际完成 | 已记录当前连接器禁用工具和临时目录的边界，以及 [最小执行流程与验收条件](PROJECT_EXECUTION.md)；项目根目录授权、审批、执行、停止和真实结果验证仍待开发 |
| #66 macOS 公证与 Windows 签名 | P2 | 已能构建全部平台，签名、公证仍未完成 | macOS 待开发者证书；Windows [SignPath 申请](SIGNPATH.md)已由维护者手动提交，等待审核；获批并接入后验证实际签名。不能把未签名可安装记为完成 |
| #104 LongHorizon-Harness 建议 | P3 | 待架构评估，非阻塞缺陷 | 已核对上游 MIT 许可与固定源码版本，形成 [差距与实验方案](PROJECT_EXECUTION.md)；未复制代码、未引入依赖，实验和集成仍待实现 |

## 已关闭

- #189：`LANG_LIBS` 引用错误已修复并随正式版发布。
- #190：Windows 安装包缺失已解决；0.4.13 官方 EXE、blockmap 与校验文件已生成，下载校验通过。
- #193 已合并；#192 的改动已被现有资源库实现取代，按重复关闭。

## 验证记录

- 修复提交：`7da1489`。本地 `npm test`、构建及测试类型检查通过。
- [Windows 专项 CI](https://github.com/jnMetaCode/agency-orchestrator/actions/runs/39540022743/job/119025394277) 通过，包含真实 Electron 运行时桥接和 Hermes 协议测试。
- 此轮未发新版本；#196 保持打开等待发布，#194 保留真实 dsh 账号调用的验证边界。

## 验证范围

- Hermes 回归使用真实子进程替身，检查 77.9KB 量级、多字节、多行和特殊字符输入完整性，以及失败协议不得当作成功结果；不消耗模型额度。
- Windows CI 使用真实 Electron 与系统 Node，CLI 入口使用本地替身验证启动路径，不宣称已调用真实 dsh 服务。
- 现有已发布版本不会因源码更新自动获得 Hermes 修复，需安装后续正式版本。

Hermes 协议依据：[官方 CLI 文档](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/cli-commands.md)。

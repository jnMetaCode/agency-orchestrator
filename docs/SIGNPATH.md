# SignPath 免费 Windows 签名申请评估

核对日期：2026-10-21。状态：**申请准备中，未提交、未获批、未启用签名**。

## 结论

值得向 SignPath Foundation 提交申请，但目前只能判断基础条件较好，不能保证接纳。免费方案使用签发给 SignPath Foundation 的证书，不是颁发给维护者个人的证书，也不适用于 Apple 公证。

| 条件 | 仓库证据 / 剩余工作 |
| --- | --- |
| 开源许可 | 根目录 Apache-2.0；内置 `agency-agents` 为 MIT。本地按打包排除规则初筛 191 条依赖记录，许可证元数据均可识别（其中 7 条采用旧式 licenses 数组）。尚须审查完整 Windows 包、授权文本和第三方二进制，不能把元数据初筛当成完整许可审计 |
| 持续维护与公开信誉 | 公开仓库、提交和 Issue 记录；2026-10-21 GitHub API 显示 2,391 stars、314 forks。这是申请证据，不是通过门槛或安全认证 |
| 已发布可执行程序 | `desktop-v0.4.13` 已提供正式 Windows EXE 和校验文件 |
| 可验证构建 | `.github/workflows/release-desktop.yml` 从 tag 构建，校验源码 SHA、run ID、全部平台和哈希后发布；尚未接入 SignPath 的构建来源验证 |
| 政策和职责 | 见 [Code signing policy](CODE_SIGNING_POLICY.md)，当前政策明确未签名状态；维护者需确认角色和 MFA |
| 隐私 | 见 [联网与数据说明](PRIVACY.md)。存在自动更新、供应商清单、远程字体请求；不能声明所有网络访问均由用户显式触发 |
| 特殊功能审查 | AI 可生成代码，工作流可调用本地 CLI；角色库包含安全相关文本。须向审核方说明实际可执行功能，核实“不包含黑客工具”的要求，不能只凭 AI 工具分类断言符合 |
| 人工审批 | 免费基金会证书要求每次签名发布人工批准；接入后必须在签名成功、验签并重新生成校验文件后才允许公开发布 |

## 官方申请表：可直接使用的英文材料

- Project Name: Agency Orchestrator
- Repository URL: https://github.com/jnMetaCode/agency-orchestrator
- Homepage URL: https://github.com/jnMetaCode/agency-orchestrator （README 包含 Code signing policy 链接）
- Download URL: https://github.com/jnMetaCode/agency-orchestrator/releases
- Privacy Policy URL: https://github.com/jnMetaCode/agency-orchestrator/blob/main/docs/PRIVACY.md
- Wikipedia URL: 留空，无已核实的英文维基条目。
- Tagline: An open-source desktop and command-line application for coordinating AI roles through configurable workflows.
- Category: 选择表单中最接近开发工具 / 生产力的选项，不伪造表单不存在的类别。
- Maintainer Type: 由维护者确认个人或组织，不以 GitHub 用户名推断公司主体。
- Build System: GitHub Actions.
- Primary Discovery Channel / exact source: 如实选择 AI assistant / ChatGPT（以表单现有选项为准）。
- First Name / Last Name / Email: **等待维护者提供，不从 Git 提交信息猜测或擅自公开**。
- Company Name: 仅在确有适用组织时填写。

Description:

> Agency Orchestrator is an Apache-2.0 licensed application that lets users compose and run workflows with specialized AI roles. It provides a local web interface, an Electron desktop application, and a command-line interface. Users choose their model API providers or locally installed AI command-line tools. Workflow definitions and run artifacts are managed locally; prompts and attachments are sent to the providers selected for each task. We are applying for code signing of our Windows desktop application and installer built in our public GitHub Actions workflow.

Reputation:

> The project is publicly maintained at https://github.com/jnMetaCode/agency-orchestrator and had 2,391 GitHub stars and 314 forks when checked on 2026-10-21. Public source history, issues, release artifacts, and CI runs are available for review. The Windows installer is published at https://github.com/jnMetaCode/agency-orchestrator/releases/tag/desktop-v0.4.13 . Our release process builds from a version tag and verifies artifact hashes and build provenance before publication. These figures describe public adoption and do not imply a security audit or existing code-signing approval.

Additional disclosure for review:

> We have not yet been accepted by SignPath Foundation and our current Windows releases are unsigned. The application can invoke user-selected local AI CLIs and workflow tools. It also performs update/catalog requests and loads external fonts; these behaviors are disclosed in our privacy documentation. Please advise whether additional consent controls or changes to our packaged components are required before acceptance. We will not apply the Foundation's signature to upstream executables as if we authored them. Our proposed signing policy is linked from the repository README.

## 提交前仍需确认

1. 联系人姓名、申请邮箱、维护者类型；GitHub 与未来 SignPath 账号启用 MFA。
2. 维护者阅读并同意官方 Code of Conduct，以及表单的必要个人信息处理条款。可选营销通讯不默认勾选。
3. 下载页目前不能宣称“已由 SignPath 提供签名”。官方表单要求下载页提及基金会，申请时应说明尚待批准；批准后加入规定致谢并配置签名。
4. 审核方如要求联网告知、安装时隐私展示或关闭选项，先完成产品改动再启用签名，不能只靠一份文档宣布满足。
5. 表单含 reCAPTCHA，若触发挑战由账号持有人在浏览器完成，不绕过验证。

## 获批后的接入顺序

1. 配置 SignPath 项目、GitHub 构建来源、产物规则、测试 / 正式签名策略与人工审批人。
2. 先在独立测试流程验证 Electron 应用 EXE、NSIS 安装包和卸载程序的签名范围；让 SignPath 确认打包顺序和上游组件处理，不能只签最外层后声称所有内容已签名。
3. 验证 Windows Authenticode 签名、发布者与时间戳；签名改变字节，必须重新生成 SHA256 和 blockmap，并保留来源校验。
4. 签名拒绝、超时或验签失败应阻止该签名版本发布；不自动降级为未签名包。
5. 在 README、政策和下载页加入要求的基金会致谢，再发布新版本。不得覆盖现有不可变发布资产。

## 来源

- [官方申请表](https://signpath.org/apply.html)（已用浏览器只读打开核对实际字段，未提交）
- [官方申请条件](https://signpath.org/terms.html)
- [微软 Windows 签名方案说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)

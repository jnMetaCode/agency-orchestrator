# SignPath 免费 Windows 签名申请评估

更新日期：2026-10-21。状态：**维护者已手动提交申请，等待审核；未获批、未启用签名**。

维护者提供页面回执：`Form submitted` / `Thank you, we'll be in touch soon.`。这确认表单已提交，不代表审核通过、账号已激活或已取得证书。请勿重复申请。具体联系人信息和私有过程记录不进入公开仓库。

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

## 申请参考材料（不等同于最终提交内容存档）

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
- First Name / Last Name / Email: 由维护者提供，具体联系信息保存在本地私有申请材料中，不提交公开仓库。官方服务条款 2.2 未要求免费账号必须提供真名；若用 GitHub 昵称，必须明确其为公开昵称，不冒充法定姓名。
- Company Name: 仅在确有适用组织时填写。

Description:

> Agency Orchestrator is an Apache-2.0 licensed application that lets users compose and run workflows with specialized AI roles. It provides a local web interface, an Electron desktop application, and a command-line interface. Users choose their model API providers or locally installed AI command-line tools. Workflow definitions and run artifacts are managed locally; prompts and attachments are sent to the providers selected for each task. We are applying for code signing of our Windows desktop application and installer built in our public GitHub Actions workflow.

Reputation:

> The project is publicly maintained at https://github.com/jnMetaCode/agency-orchestrator and had 2,391 GitHub stars and 314 forks when checked on 2026-10-21. Public source history, issues, release artifacts, and CI runs are available for review. The Windows installer is published at https://github.com/jnMetaCode/agency-orchestrator/releases/tag/desktop-v0.4.13 . Our release process builds from a version tag and verifies artifact hashes and build provenance before publication. These figures describe public adoption and do not imply a security audit or existing code-signing approval.

Additional disclosure for review:

> We have not yet been accepted by SignPath Foundation and our current Windows releases are unsigned. The application can invoke user-selected local AI CLIs and workflow tools. It also performs update/catalog requests and loads external fonts; these behaviors are disclosed in our privacy documentation. Please advise whether additional consent controls or changes to our packaged components are required before acceptance. We will not apply the Foundation's signature to upstream executables as if we authored them. Our proposed signing policy is linked from the repository README.

## 提交条件与后续跟踪

1. 联系人信息及条款同意已由维护者提供；GitHub MFA 已由维护者确认开启，未来 SignPath 账号也须启用 MFA。
2. 维护者已确认同意官方条款及必要个人信息处理。可选营销通讯不默认勾选。
3. 下载页目前不能宣称“已由 SignPath 提供签名”。官方表单要求下载页提及基金会，申请时应说明尚待批准；批准后加入规定致谢并配置签名。
4. 审核方如要求联网告知、安装时隐私展示或关闭选项，先完成产品改动再启用签名，不能只靠一份文档宣布满足。
5. 官方 [服务条款](https://signpath.io/terms-of-service) 2.3 不允许自动化注册账号；此表单会创建用户账号，因此工具只准备、预填材料，最终提交与账号注册由维护者在浏览器完成。若触发 reCAPTCHA，也由维护者完成，不绕过验证。

等待审核期间查看申请邮箱的收件箱与垃圾邮件；如收到身份、仓库权限、隐私、构建来源或签名范围补充要求，先核对邮件来源再处理。不推测审批时限，不发送尚未授权的跟进邮件。此前 CAPTCHA 报障草稿不再作为待发送事项。

## 获批后的接入顺序

1. 配置 SignPath 项目、GitHub 构建来源、产物规则、测试 / 正式签名策略与人工审批人。
2. 先在独立测试流程验证 Electron 应用 EXE、NSIS 安装包和卸载程序的签名范围；让 SignPath 确认打包顺序和上游组件处理，不能只签最外层后声称所有内容已签名。
3. 验证 Windows Authenticode 签名、发布者与时间戳；签名改变字节，必须重新生成 SHA256 和 blockmap，并保留来源校验。
4. 签名拒绝、超时或验签失败应阻止该签名版本发布；不自动降级为未签名包。
5. 在 README、政策和下载页加入要求的基金会致谢，再发布新版本。不得覆盖现有不可变发布资产。

## 来源

- [官方申请表](https://signpath.org/apply.html)（工具核对并准备材料，维护者手动提交成功）
- [官方申请条件](https://signpath.org/terms.html)
- [微软 Windows 签名方案说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)

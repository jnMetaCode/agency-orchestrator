# Contributing to Agency Orchestrator

感谢你对本项目的关注！欢迎通过以下方式参与贡献。

## 贡献方式

### 提交 Bug 报告
- 使用 [GitHub Issues](https://github.com/jnMetaCode/agency-orchestrator/issues) 提交
- 包含：工作流 YAML、错误信息、Node.js 版本、操作系统

### 提交工作流模板
- 在 `workflows/` 目录中添加新的 YAML 工作流
- 确保所引用的角色在 [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) 中存在
- 运行 `ao validate your-workflow.yaml` 确认无误

### 投稿到「社区模板」（不用发版，全体用户 Studio 里直接可见）
你的工作流也可以不进仓库、直接被收录进 Studio 工作流页的「社区模板」分区，所有已安装用户（含老版本）一键导入即用：

1. 把工作流 YAML 放在任意公开可访问的 **https 地址**（推荐 GitHub 仓库，用 **commit-SHA 固定链接**而不是分支链接——收录后内容不可再变）
2. 开一个 Issue，标题带 `[社区模板]`，附上：模板名、一句话描述、YAML 链接、`shasum -a 256` 的内容哈希，以及一次真实运行的效果说明（贴 `ao report` 分享页更佳）
3. 我们审核后收录进远程清单（导入时引擎会校验结构与 sha256，内容与收录时不符会被拒绝）

收录标准：`ao validate` 通过、角色引用真实存在、任务描述具体可复现、不含任何收集用户数据的行为。

### 新增供应商（provider）

先分清是哪一类，登记点不同：

- **API 供应商（OpenAI 兼容 / Anthropic 协议）**：在 `src/connectors/api-providers.ts` 的 `API_PROVIDERS` / `ANTHROPIC_PROVIDERS`
  加一条即可被引擎认识（`factory.ts` 按表路由，不用改）。要让 Studio 也认识，还要：`web/server.js` 的 `KEY_ENV`、
  `website/src/lib/studio.ts` 的 `API_PROVIDERS`（展示名 / 预设 / 模型建议）、`website/src/i18n/translations.ts`；
  赞助商另加 `src/utils/sponsor-guide.ts`、`website/public/providers-manifest.json`（旧版免升级靠它）。
  最后跑 `npm run build && node scripts/sync-schema-providers.mjs` 同步编辑器补全候选——`test/workflow-schema.ts` 对不上会红。
  对照最近一次接入（`git log --all --oneline | grep -i packycode`）看全部登记点。
- **本机 CLI 供应商**：在 `src/connectors/` 写连接器（多数可继承 `cli-base.ts`），`factory.ts` 加分支，
  `src/providers/detect.ts` 的 `CLI_PROVIDER_IDS` 与 `CLI_PROVIDER_BINS` 各加一条（**别处不要再抄名单**，
  `test/detect-providers.ts` 会拦）。参考 `dsh-cli` 的接入提交。
- **视频供应商**：`VIDEO_PROVIDERS`（`api-providers.ts`），一家一个 `shape` 适配器在 `src/connectors/video.ts`。

每类都要加测试，且**端点靠探不靠抄**：用 `ao doctor --media-probe` / 真 key 核实过再写进注册表。

### 跑测试

```bash
npm run build                 # 有 5 个测试直接 import dist/，先构建
npm run build:studio          # web-server 测试要 website/dist（否则 SPA 路由那条 503）
npm test                      # 全量（先 typecheck 测试文件，再按 package.json 里的顺序跑）
npx tsx test/<文件>.ts        # 只跑一个
```

新增 `test/*.ts` 后要在 `package.json` 的 `test` 链里登记，否则不会被跑到。

### 改进代码
- Fork 仓库并创建功能分支
- 确保 `npm test` 全部通过
- 提交 Pull Request

## 开发环境

```bash
git clone https://github.com/jnMetaCode/agency-orchestrator.git
cd agency-orchestrator
npm install
npm run dev    # TypeScript watch mode
npm test       # 运行测试
```

## 代码规范

- TypeScript strict mode
- ESM（所有 import 使用 `.js` 扩展名）
- 中文注释，英文 API

## 提交规范

```
feat: 新增 Zhipu connector
fix: 修复可选输入模板崩溃
docs: 更新 README 示例
```

## License

贡献内容将按 Apache-2.0 许可证发布。

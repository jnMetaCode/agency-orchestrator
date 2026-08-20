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

### 新增 LLM Connector
- 在 `src/connectors/` 中实现 `LLMConnector` 接口
- 在 `src/index.ts` 的 `run()` 函数中注册 provider
- 添加对应的测试

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

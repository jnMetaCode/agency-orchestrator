/**
 * CodeBuddy / WorkBuddy CLI Connector
 * 通过本地 `codebuddy` CLI 调用，直接用腾讯 CodeBuddy / WorkBuddy 会员额度，无需 API key
 *
 * 安装（任选其一）:
 *   - npm install -g @tencent-ai/codebuddy-code
 *   - 装了 WorkBuddy 桌面版（macOS）就已经自带：
 *     /Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy
 *     （不在 PATH 上，AO 会自动到这里找，见 utils/bin-lookup.ts）
 * 认证: 终端跑一次 `codebuddy` 按提示登录（WorkBuddy 已登录的机器直接可用）
 *
 * 命令行形态与 Claude Code 逐项对齐（实测 2.103.3）：`-p -` 读 stdin、`--output-format json`、
 * `--system-prompt-file`、`--tools ""`、`--effort`、`--model`。差异只有两处：
 *   - 没有 `--no-session-persistence`（会话会记到 ~/.codebuddy/projects/，无害）
 *   - JSON 输出是整段对话的数组，最后一个元素才是 `type:"result"`（claude-code.ts 的
 *     parseResultJson 已兼容）
 * 模型 id 来自 `codebuddy --help`（auto / glm-5.1 / kimi-k2.5 / minimax-m2.7 / deepseek-v3-2-volc …），
 * 不指定就是 auto —— 与 Claude Code 一样，YAML 里 model 留空即可。
 */
import { ClaudeCodeConnector } from './claude-code.js';

export class CodeBuddyCLIConnector extends ClaudeCodeConnector {
  constructor() {
    super({
      command: 'codebuddy',
      displayName: 'CodeBuddy / WorkBuddy CLI',
      installHint: 'npm install -g @tencent-ai/codebuddy-code（或安装 WorkBuddy 桌面版，自带）',
      providerId: 'codebuddy-cli',
    });
  }
}

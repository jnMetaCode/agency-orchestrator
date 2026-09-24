/**
 * AO 目录解析（issue #20）
 *
 * 默认行为不变：不设 AO_HOME 时，产物仍写到执行目录下的 ao-output/ao-workflows（向后兼容）。
 * 设了 AO_HOME 后，这些默认目录统一落到 $AO_HOME 下，避免在不同目录跑 ao 把文件写得到处都是。
 * 也可用更细的 AO_OUTPUT_DIR / AO_WORKFLOWS_DIR 单独指定。
 *
 * 注：团队 / 提示词 / 版本检查一直就放在 ~/.ao（见 cli/team.ts、cli/prompt.ts、utils/version-check.ts）。
 */
import { homedir } from 'node:os';
import { join, resolve, relative } from 'node:path';

/** 全局基目录：显式 AO_HOME 优先；未设则返回 null（= 沿用 cwd 相对路径，保持旧行为）。 */
export function aoHome(): string | null {
  if (process.env.AO_HOME) return resolve(process.env.AO_HOME);
  return null;
}

/** ~/.ao —— 团队 / 提示词等用户级资产的固定位置（与 AO_HOME 无关，始终在家目录）。 */
export function aoUserDir(): string {
  return join(homedir(), '.ao');
}

/** 运行产物目录：AO_OUTPUT_DIR > $AO_HOME/ao-output > 'ao-output'（cwd 相对）。 */
export function defaultOutputDir(): string {
  if (process.env.AO_OUTPUT_DIR) return resolve(process.env.AO_OUTPUT_DIR);
  const h = aoHome();
  return h ? join(h, 'ao-output') : 'ao-output';
}

/**
 * 生成的工作流保存目录：AO_WORKFLOWS_DIR > $AO_HOME/ao-workflows > fallback。
 * fallback 是各调用点原本的默认值（compose 用 'workflows'，team-run 用 'ao-workflows'），
 * 不设任何 env 时维持原行为。
 */
export function defaultWorkflowsDir(fallback: string): string {
  if (process.env.AO_WORKFLOWS_DIR) return resolve(process.env.AO_WORKFLOWS_DIR);
  const h = aoHome();
  return h ? join(h, 'ao-workflows') : fallback;
}

/**
 * 打印给用户**照抄**的路径。
 *
 * 一律 `relative(cwd, p)` 的老写法，在文件不在 cwd 底下时会打出
 * `../../../../../private/tmp/…/fail.yaml` 这种五层回退链——难读、容易抄错，
 * 而且用户一 cd 就失效（失败后的「从失败处继续」正是最该能原样照抄的一条命令）。
 * 规则：在 cwd 底下才用相对路径，否则用绝对路径；含空格的整体加引号。
 */
export function displayPath(p: string): string {
  const rel = relative(process.cwd(), p);
  const pick = !rel || rel.startsWith('..') ? p : rel;
  // 只按"有没有空白"决定要不要引号：Windows 路径里的反斜杠不能动，引号里它就是字面量
  return /\s/.test(pick) ? `"${pick.replace(/"/g, '\\"')}"` : pick;
}

/**
 * ao run --watch — 终端实时进度显示
 */

export interface ProgressEvent {
  type: 'step_start' | 'step_done' | 'step_skip' | 'step_error';
  stepId: string;
  role: string;
  elapsed?: number;
  total: number;
  completed: number;
}

export type ProgressCallback = (event: ProgressEvent) => void;

interface StepState {
  id: string;
  role: string;
  status: 'waiting' | 'running' | 'done' | 'error' | 'skipped';
  elapsed?: number;
}

const ICONS = {
  waiting: '⏳',
  running: '🔄',
  done: '✅',
  error: '❌',
  skipped: '⏩',
} as const;

/**
 * 创建 watch 渲染器，返回 ProgressCallback
 * @param workflowName 工作流名称
 * @param stepIds 全部步骤 id 列表
 * @param roles 全部步骤角色列表
 */
export function createWatchRenderer(
  workflowName: string,
  stepIds: string[],
  roles: string[],
): ProgressCallback {
  const states: StepState[] = stepIds.map((id, i) => ({
    id,
    role: formatRoleShort(roles[i]),
    status: 'waiting',
  }));

  const startTime = Date.now();
  let lastLineCount = 0;
  let lastPlainLine = '';   // 非 TTY 下用它去重，别把同一行刷一万遍

  function formatRoleShort(role: string): string {
    const parts = role.split('/');
    return parts[parts.length - 1].slice(0, 28);
  }

  function render(): void {
    // 非 TTY（`ao run --watch 2> run.log`、CI、被别的程序管道接走）：光标上移/清行这些转义码
    // 会原样写进日志，把它糊成一片。这时改成一行一条的纯文本进度，信息不丢、也不脏。
    if (!process.stderr.isTTY) {
      const done = states.filter((x) => x.status === 'done' || x.status === 'skipped').length;
      const running = states.filter((x) => x.status === 'running').map((x) => x.id).join(', ');
      const line = `  [${done}/${states.length}] ${((Date.now() - startTime) / 1000).toFixed(0)}s${running ? ` · 进行中: ${running}` : ''}`;
      if (line !== lastPlainLine) {
        process.stderr.write(`${line}\n`);
        lastPlainLine = line;
      }
      return;
    }
    // 清除之前的输出
    if (lastLineCount > 0) {
      process.stderr.write(`\x1b[${lastLineCount}A`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const completed = states.filter(s => s.status === 'done' || s.status === 'skipped').length;
    const total = states.length;
    const barWidth = 20;
    const filled = Math.round((completed / total) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

    const lines: string[] = [];
    const boxWidth = 52;
    const title = ` ${workflowName} `;
    const padLen = Math.max(0, boxWidth - 2 - title.length);

    lines.push(`┌─${title}${'─'.repeat(padLen)}┐`);

    for (const s of states) {
      const icon = ICONS[s.status];
      const elapsedStr = s.elapsed ? `${(s.elapsed / 1000).toFixed(0)}s` : s.status === 'running' ? 'running' : 'waiting';
      const idPad = s.id.slice(0, 18).padEnd(18);
      const line = `│ ${icon} ${idPad} ${elapsedStr.padEnd(10)} │`;
      lines.push(line);
    }

    lines.push(`│${''.padEnd(boxWidth - 2)}│`);
    const progressContent = `Progress: ${bar} ${completed}/${total}  ${elapsed}s`;
    const progressPad = Math.max(0, boxWidth - 4 - progressContent.length);
    lines.push(`│ ${progressContent}${''.padEnd(progressPad)} │`);
    lines.push(`└${'─'.repeat(boxWidth - 2)}┘`);

    // 写到 stderr 避免与正常输出混合
    for (const line of lines) {
      process.stderr.write(`\x1b[2K${line}\n`);
    }

    lastLineCount = lines.length;
  }

  // 初始渲染
  render();

  return (event: ProgressEvent) => {
    const state = states.find(s => s.id === event.stepId);
    if (!state) return;

    switch (event.type) {
      case 'step_start':
        state.status = 'running';
        break;
      case 'step_done':
        state.status = 'done';
        state.elapsed = event.elapsed;
        break;
      case 'step_skip':
        state.status = 'skipped';
        break;
      case 'step_error':
        state.status = 'error';
        state.elapsed = event.elapsed;
        break;
    }

    render();
  };
}

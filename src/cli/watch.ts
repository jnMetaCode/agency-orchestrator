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
/** 终端显示宽度：CJK / 全角 / emoji 占 2 列，其余 1 列。`String.length` 对中文标题会少算一半。 */
export function dispWidth(str: string): number {
  let n = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0) ?? 0;
    const wide = (cp >= 0x1100 && cp <= 0x115f)
      || cp === 0x2329 || cp === 0x232a
      || (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f)
      || (cp >= 0xac00 && cp <= 0xd7a3)
      || (cp >= 0xf900 && cp <= 0xfaff)
      || (cp >= 0xfe30 && cp <= 0xfe6f)
      || (cp >= 0xff00 && cp <= 0xff60)
      || (cp >= 0xffe0 && cp <= 0xffe6)
      || (cp >= 0x1f300 && cp <= 0x1f64f)
      || (cp >= 0x1f900 && cp <= 0x1f9ff);
    n += wide ? 2 : 1;
  }
  return n;
}

/** 按显示宽度右填充 */
function padDisp(str: string, width: number): string {
  return str + ' '.repeat(Math.max(0, width - dispWidth(str)));
}

/** 按显示宽度截断（不会把一个宽字符切一半） */
function clipDisp(str: string, width: number): string {
  let out = '', n = 0;
  for (const ch of str) {
    const w = dispWidth(ch);
    if (n + w > width) break;
    out += ch; n += w;
  }
  return out;
}

/** 一整行：`│ 内容…… │`，总显示宽度恰好 boxWidth */
function boxRow(content: string, boxWidth: number): string {
  return `│ ${padDisp(clipDisp(content, boxWidth - 4), boxWidth - 4)} │`;
}

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
    // 一律按**显示宽度**排版：以前用 String.length，中文标题（每字 2 列）把顶边撑出去、
    // 步骤行又比边框短 16 列，整个框是歪的；emoji 同理。
    // 标题也要按显示宽度截断：名字太长时 padLen 被 clamp 到 0，顶边就被撑出框外
    const title = ` ${clipDisp(workflowName, boxWidth - 5)} `;
    lines.push(`┌─${title}${'─'.repeat(Math.max(0, boxWidth - 3 - dispWidth(title)))}┐`);

    for (const s of states) {
      const icon = ICONS[s.status];
      const elapsedStr = s.elapsed ? `${(s.elapsed / 1000).toFixed(0)}s` : s.status === 'running' ? 'running' : 'waiting';
      lines.push(boxRow(`${icon} ${padDisp(clipDisp(s.id, 22), 22)} ${elapsedStr}`, boxWidth));
    }

    lines.push(boxRow('', boxWidth));
    lines.push(boxRow(`Progress: ${bar} ${completed}/${total}  ${elapsed}s`, boxWidth));
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

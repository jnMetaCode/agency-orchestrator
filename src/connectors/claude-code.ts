/**
 * Claude Code CLI Connector
 * 通过本地 `claude` CLI 调用，直接使用 Claude Max/Pro 订阅额度，无需 API key
 *
 * 安装: npm install -g @anthropic-ai/claude-code
 * 认证: claude 登录后自动使用订阅额度
 *
 * 关键: 使用 --output-format json 而非 text
 * text 格式在管道模式下有缓冲问题，长输出（>1000 字）会导致子进程挂起
 * json 格式一次性输出完整结果，包含 usage 等元数据
 */
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMConnector, LLMResult, LLMConfig } from '../types.js';

export class ClaudeCodeConnector implements LLMConnector {
  async chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult> {
    const timeout = config.timeout || 600_000;  // 默认 10 分钟

    // 用临时文件传系统 prompt（避免命令行过长）
    let systemPromptFile: string | undefined;
    if (systemPrompt) {
      systemPromptFile = join(tmpdir(), `ao-sysprompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
      writeFileSync(systemPromptFile, systemPrompt, 'utf-8');
    }

    // 使用 json 格式：text 格式在管道中会缓冲挂起
    const args = ['-p', '-', '--output-format', 'json', '--tools', '', '--effort', 'low', '--no-session-persistence'];
    if (systemPromptFile) {
      args.push('--system-prompt-file', systemPromptFile);
    }
    if (config.model && config.model !== 'claude-code') {
      args.push('--model', config.model);
    }

    try {
      return await this._exec(args, userMessage, timeout);
    } finally {
      if (systemPromptFile) {
        try { unlinkSync(systemPromptFile); } catch {}
      }
    }
  }

  private _exec(args: string[], stdinData: string, timeout: number): Promise<LLMResult> {
    return new Promise<LLMResult>((resolve, reject) => {
      const child = spawn('claude', args, {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      let stdout = '';
      let stderr = '';
      let killed = false;
      let receivedBytes = 0;
      let lastProgressTime = 0;

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
      }, timeout);

      child.stdout!.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        receivedBytes += chunk.length;
        const now = Date.now();
        if (now - lastProgressTime > 10_000) {
          lastProgressTime = now;
          const kb = (receivedBytes / 1024).toFixed(1);
          process.stderr.write(`  📡 已接收 ${kb}KB...\n`);
        }
      });
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      child.stdin!.on('error', () => {});
      child.stdin!.write(stdinData);
      child.stdin!.end();

      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          reject(new Error(
            '找不到 claude 命令，请先安装 Claude Code CLI\n' +
            '安装: npm install -g @anthropic-ai/claude-code\n' +
            '参考: https://github.com/jnMetaCode/agency-orchestrator#llm-配置'
          ));
        } else {
          reject(new Error(`Claude Code CLI 调用失败: ${err.message}`));
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        if (killed) {
          reject(new Error(`Claude Code CLI 超时 (${timeout / 1000}s)，可在 YAML 中设置 timeout 增加等待时间`));
          return;
        }

        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`Claude Code CLI 调用失败 (exit ${code}): ${stderr.slice(0, 500)}`));
          return;
        }

        // 解析 JSON 响应
        try {
          const json = JSON.parse(stdout);

          if (json.is_error) {
            reject(new Error(`Claude Code CLI 错误: ${json.result?.slice(0, 300) || 'unknown error'}`));
            return;
          }

          const content = (json.result || '').trim();
          if (!content) {
            reject(new Error(`Claude Code CLI 返回空内容`));
            return;
          }

          // 从 JSON 中提取真实 usage
          const usage = json.usage || json.modelUsage || {};
          resolve({
            content,
            usage: {
              input_tokens: usage.input_tokens || usage.inputTokens || 0,
              output_tokens: usage.output_tokens || usage.outputTokens || 0,
            },
          });
        } catch {
          // JSON 解析失败，回退到原始文本
          const content = stdout.trim();
          if (!content) {
            reject(new Error(`Claude Code CLI 返回空内容，stderr: ${stderr.slice(0, 500)}`));
            return;
          }

          // 检测 API 错误
          if (content.length < 500) {
            const apiErrorPattern = /^API Error:|^ECONNRESET|^ETIMEDOUT|^ECONNREFUSED|^Unable to connect|^socket hang up/im;
            if (apiErrorPattern.test(content)) {
              reject(new Error(`Claude Code CLI API 错误: ${content.slice(0, 300)}`));
              return;
            }
          }

          resolve({
            content,
            usage: { input_tokens: 0, output_tokens: 0 },
          });
        }
      });
    });
  }
}

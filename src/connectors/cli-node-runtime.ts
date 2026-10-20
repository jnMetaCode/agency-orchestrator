import { isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';

export interface CLINodeRuntime { file: string; version: string; electron: boolean; }
export type NodeCapabilityProbe = (file: string, env: NodeJS.ProcessEnv) => boolean;

/** Node 23 and 24.0/24.1 do not contain the import.meta.main backport. */
export function supportsImportMetaMain(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:$|[+-])/.exec(version);
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  return major === 22 && minor >= 18 || major === 24 && minor >= 2 || major > 24;
}

/** No CLI, prompts or credentials are passed to this bounded capability probe. */
export const probeNodeCapability: NodeCapabilityProbe = (file, env) => {
  try {
    const probeEnv = Object.fromEntries(Object.entries(env).filter(([key, value]) =>
      /^(path|systemroot|windir|temp|tmp|tmpdir|home|userprofile|lang|lc_all)$/i.test(key) && value !== undefined));
    const result = execFileSync(file, ['--input-type=module', '-e',
      'process.stdout.write(typeof import.meta.main === "boolean" ? "supported" : "unsupported")'], {
      env: probeEnv, timeout: 3000, maxBuffer: 4096, windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return result.toString().trim() === 'supported';
  } catch { return false; }
};

/** Explicit override is authoritative; an invalid override must not silently fall back. */
export function selectCLINodeRuntime(
  current: CLINodeRuntime,
  env: NodeJS.ProcessEnv,
  pathNode?: string | null,
  probe: NodeCapabilityProbe = probeNodeCapability,
): CLINodeRuntime {
  const explicit = env.AO_CLI_NODE_PATH?.trim();
  if (explicit) {
    if (explicit === current.file && current.electron) throw new Error('AO_CLI_NODE_PATH 必须指向外部 Node，不能指向 Electron 可执行文件');
    if (isAbsolute(explicit) && probe(explicit, env)) return { file: explicit, version: 'probed', electron: false };
    throw new Error('AO_CLI_NODE_PATH 无法运行或不支持 import.meta.main；请指定兼容 Node 可执行文件的完整路径（不含引号或参数）');
  }
  if (supportsImportMetaMain(current.version)) return current;
  if (pathNode && pathNode !== current.file && probe(pathNode, env)) {
    return { file: pathNode, version: 'probed', electron: false };
  }
  throw new Error(`dsh 的入口需要 import.meta.main，但 AO 引擎 Node ${current.version}${current.electron ? '（Electron 内置）' : ''} 不支持，且未找到兼容的外部 Node。请安装 Node 22.x ≥22.18 或 ≥24.2（不含 Node 23），或设置 AO_CLI_NODE_PATH 指向兼容 Node。尚未启动 dsh。`);
}

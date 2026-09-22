// 给 tsconfig.test.json 用的最小声明：测试里 import 这个纯 JS 模块。真正的契约由 test/web-data-dir.ts 钉。
export function isInstalledPackage(root: string): boolean;
export function resolveDataDir(root: string, env?: NodeJS.ProcessEnv, deps?: Record<string, unknown>): string;
export function migrateLegacyData(root: string, dataDir: string, deps?: Record<string, unknown>): string[];

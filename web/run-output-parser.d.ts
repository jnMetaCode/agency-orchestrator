// 给 tsconfig.test.json 用的最小声明：测试里 import 这个纯 JS 模块。真正的契约由 test/run-output-parser.ts 钉。
export function matchStepFailed(raw: string): string | null;
export function matchStepSkipped(raw: string): string | null;
export function matchRunSummary(raw: string): { ok: boolean; text: string } | null;
export function matchSkippedTail(raw: string): string[] | null;
export function createRunOutputParser(opts: { send: (type: string, data: unknown) => void; runId: string; resolveOutputDir?: (p: string) => string }): { parseLine: (raw: string) => void };

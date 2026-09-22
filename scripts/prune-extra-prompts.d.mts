// 给 tsconfig.test.json 用的最小声明：test/creative-*.ts import 这个脚本的纯函数。
export const RULES: [string, RegExp][];
export function isStyleOrColorContext(text: string, index: number, word: string): boolean;
export function isNegativeContext(text: string, index: number): boolean;
export function violation(item: { title?: string; prompt?: string }): { name: string; word: string } | null;

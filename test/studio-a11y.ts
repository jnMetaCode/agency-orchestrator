/**
 * Studio 弹层的键盘与读屏基本功（源码契约）。
 *
 * 这些弹层此前只是 `fixed inset-0` 的 div：读屏不知道是对话框、Tab 会跑到被遮住的按钮上、
 * Esc 有的关有的不关。修的时候统一挂 `useDialog`（website/src/components/ui/use-dialog.ts）。
 * 这里钉的是「以后新加的弹层不会漏」——真实行为（焦点进入 / Tab 不出圈 / Esc 关闭）用无头浏览器
 * 在开发时核对过，跑真浏览器不进这条测试链（太重）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; }
}

const dirs = ['website/src/components/studio', 'website/src/components/ui'];
const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.tsx')).map((f) => join(d, f)));

// 这些不是对话框：ChatPanel / RolesPicker 是内嵌面板，InstallPrompt / RoleDetail 自己早就写了 role=dialog
const SELF_MANAGED = ['InstallPrompt.tsx', 'RoleDetail.tsx'];
const NOT_A_DIALOG = ['ChatPanel.tsx', 'RolesPicker.tsx'];

console.log('\n─── 弹层必须是对话框 ───');
const overlays = files.filter((f) => /className="fixed inset-0|className={cn\("fixed inset-0/.test(readFileSync(f, 'utf-8')));
assert(overlays.length >= 8, `扫到 ${overlays.length} 个全屏弹层`);
for (const f of overlays) {
  const base = f.split('/').pop()!;
  if (NOT_A_DIALOG.includes(base)) continue;
  const src = readFileSync(f, 'utf-8');
  assert(/role="dialog"/.test(src) && /aria-modal="true"/.test(src) && /aria-label=/.test(src),
    `${base} 声明 role="dialog" + aria-modal + aria-label`);
  if (SELF_MANAGED.includes(base)) continue;
  assert(/useDialog\(/.test(src), `${base} 用 useDialog（初始焦点 / Tab 陷阱 / 焦点归还）`);
}

console.log('\n─── useDialog 自身的约束 ───');
{
  const h = readFileSync('website/src/components/ui/use-dialog.ts', 'utf-8');
  assert(/addEventListener\("keydown", onKey, true\)/.test(h), 'Esc/Tab 在捕获阶段处理（先于组件自己的 window 监听）');
  assert(/removeEventListener\("keydown", onKey, true\)/.test(h), '卸载时摘掉监听，不留全局副作用');
  assert(/escRef\.current = onEscape/.test(h), 'onEscape 走 ref：行内箭头函数每次渲染都变，进依赖会让初始焦点被反复抢回去');
  assert(/previous !== document\.body/.test(h), '焦点归还跳过 body（打开时原按钮被重渲染掉的情况不假装还原）');
  assert(!/console\.log/.test(h), '不留调试日志');
}

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
process.exit(failed > 0 ? 1 : 0);

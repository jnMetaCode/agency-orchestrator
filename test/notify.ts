/**
 * notify.ts 测试：webhook 推送的文案与各平台消息体适配（纯函数）+ 无效地址不炸。
 */
import { buildNotifyText, buildNotifyPayload, sendNotify } from '../src/notify.js';

let passed = 0, failed = 0;
function assert(c: boolean, m: string): void { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } }

console.log('\n─── notify ───');

const S = { name: '每日简报', success: true, duration: '182.1s', completedSteps: 5, totalSteps: 5, excerpt: '今日要点……' };

// ── 文案 ──
const text = buildNotifyText(S);
assert(text.includes('AO 工作流「每日简报」完成'), '成功文案含名称与状态');
assert(text.includes('5/5 步') && text.includes('182.1s'), '含步数与耗时');
assert(text.includes('今日要点'), '含产出节选');
assert(text.includes('AO'), '固定含 "AO"（钉钉关键词安全设置用）');
const failText = buildNotifyText({ ...S, success: false, completedSteps: 3 });
assert(failText.includes('⚠️') && failText.includes('部分完成') && failText.includes('3/5'), '失败文案如实说部分完成');
const longText = buildNotifyText({ ...S, excerpt: 'x'.repeat(500) });
assert(longText.includes('…') && longText.length < 500, '超长节选被截断');
// cron 里同时跑好几条时，"ao report last" 指的是哪一条说不清——有存档目录就报确切的那条
assert(text.includes('ao report last'), '没给目录时沿用 last');
const withDir = buildNotifyText({ ...S, outputDir: '/data/ao-output/每日简报-2026-09-24T08-00-00' });
assert(withDir.includes('ao report /data/ao-output/每日简报-2026-09-24T08-00-00'), `给了目录就报确切那条（实际：${withDir.split('\n').pop()}）`);
const spaced = buildNotifyText({ ...S, outputDir: '/data/我的 产出/x' });
assert(spaced.includes('"/data/我的 产出/x"'), `路径含空格要加引号，收件人能直接照抄（实际：${spaced.split('\n').pop()}）`);

// ── 平台适配 ──
const ding = buildNotifyPayload('https://oapi.dingtalk.com/robot/send?access_token=x', S) as any;
assert(ding.msgtype === 'text' && typeof ding.text?.content === 'string', '钉钉：msgtype/text.content');
const feishu = buildNotifyPayload('https://open.feishu.cn/open-apis/bot/v2/hook/x', S) as any;
assert(feishu.msg_type === 'text' && typeof feishu.content?.text === 'string', '飞书：msg_type/content.text');
const wecom = buildNotifyPayload('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x', S) as any;
assert(wecom.msgtype === 'text' && typeof wecom.text?.content === 'string', '企微：msgtype/text.content');
const generic = buildNotifyPayload('https://hooks.slack.com/services/x', S) as any;
assert(typeof generic.text === 'string' && !generic.msgtype, '其他地址：通用 {text}');

// ── 无效地址永不抛错 ──
const bad = await sendNotify('not-a-url', S);
assert(!bad.ok && bad.hint.includes('无效'), '无效 URL 返回失败提示而非抛错');
const badProto = await sendNotify('ftp://example.com/x', S);
assert(!badProto.ok, '非 http(s) 协议拒绝');

console.log(`\n  结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);

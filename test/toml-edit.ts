/**
 * rewriteToml：AO 只改 model_provider / model / [model_providers.<id>]，其余行（注释、空行、键顺序）原样保留；
 * 认不出的写法退回整份重写——但任何情况下 parse 结果都必须与预期一致。
 */
import { parse } from 'smol-toml';
import { isDeepStrictEqual } from 'node:util';
import { rewriteToml } from '../src/utils/toml-edit.js';

let passed = 0, failed = 0;
function assert(ok: boolean, message: string): void {
  if (ok) { passed++; console.log(`  ✅ ${message}`); } else { failed++; console.log(`  ❌ ${message}`); }
}
const relay = { name: 'AO Relay', base_url: 'https://relay.invalid/v1', wire_api: 'responses', requires_openai_auth: true };
/** 调用方的视角：解析 → 改对象 → rewriteToml */
function edit(text: string, change: (doc: any) => void): string {
  const doc = parse(text) as any;
  change(doc);
  const out = rewriteToml(text, doc);
  assert(isDeepStrictEqual(parse(out), parse(rewriteToml('', doc))), '  ↳ 结果与预期文档逐值一致');
  return out;
}
const apply = (doc: any) => {
  doc.model_provider = 'ao-relay'; doc.model = 'relay-model';
  doc.model_providers ??= {}; doc.model_providers['ao-relay'] = relay;
};

console.log('\n─── 保留注释与排版 ───');
const userConfig = `# 我的 Codex 配置
model = "gpt-5"   # 默认模型
approval_policy = "on-request"

# 公司内网网关
[model_providers.corp]
name = "Corp"
base_url = "https://corp.invalid/v1"

[profiles.fast]
model = "gpt-5-mini"
`;
const applied = edit(userConfig, apply);
assert(applied.includes('# 我的 Codex 配置') && applied.includes('# 公司内网网关') && applied.includes('approval_policy = "on-request"'),
  '切换后用户注释和无关行都在');
assert(applied.indexOf('# 公司内网网关') < applied.indexOf('[model_providers.corp]')
  && applied.indexOf('model_provider = "ao-relay"') < applied.indexOf('# 公司内网网关'), '新顶层键插在顶层区，不把表头注释和表拆开');
assert(applied.trimEnd().endsWith('requires_openai_auth = true') && applied.includes('[profiles.fast]\nmodel = "gpt-5-mini"'), '新表追加在末尾，其它表原样');
const restored = edit(applied, doc => {
  doc.model = 'gpt-5'; delete doc.model_provider; delete doc.model_providers['ao-relay'];
});
assert(applied.includes('model = "relay-model"   # 默认模型'), '改写值时行尾注释保留');
assert(restored === userConfig, '切换再切回：与原文逐字一致');

console.log('\n─── 替换已有表、删除表 ───');
const withRelay = `model_provider = "ao-relay"\n\n[model_providers.ao-relay] # AO 写的\nname = "Old"\nbase_url = "https://old.invalid/v1"\n\n# 下一张表的说明\n[model_providers.mine]\nname = "Mine"\n`;
const replaced = edit(withRelay, doc => { doc.model_providers['ao-relay'] = relay; });
assert(replaced.includes('# 下一张表的说明\n[model_providers.mine]') && !replaced.includes('Old'), '原地替换表，下一张表的注释仍贴着它');
const removed = edit(withRelay, doc => { delete doc.model_provider; delete doc.model_providers['ao-relay']; });
assert(removed === '# 下一张表的说明\n[model_providers.mine]\nname = "Mine"\n', `删除表和顶层键，不留多余空行：${JSON.stringify(removed)}`);

console.log('\n─── 边界写法 ───');
const crlf = edit('# c\r\nmodel = "a"\r\n', apply);
assert(crlf.includes('# c\r\n') && !/[^\r]\n/.test(crlf), 'CRLF 文件保持 CRLF');
const quoted = edit('[model_providers."ao-relay"]\nname = "x"\n', doc => { doc.model_providers['ao-relay'] = relay; });
assert(!quoted.includes('name = "x"') && (quoted.match(/ao-relay/g) || []).length === 1, '带引号的表名也能认出，不重复建表');
const created = edit('', apply);
assert(created.includes('model_provider = "ao-relay"'), '空文件：整份生成');
const emptyParent = edit('[model_providers]\n[model_providers.ao-relay]\nname = "x"\n', doc => { delete doc.model_providers; });
assert(!emptyParent.includes('model_providers'), 'AO 建的 model_providers 清空后，空表头一起去掉');

edit('model = "a#b" # note\n', doc => { doc.model = 'c'; });
console.log('\n─── 认不出的写法：退回整份重写，但结果仍正确 ───');
edit('model_providers = { mine = { name = "Mine" } }\n', apply);
edit('model_providers.mine.name = "Mine"\n', apply);
edit('notes = """\n[model_providers.ao-relay]\nname = "fake"\n"""\nmodel_provider = "x"\n', apply);
edit('arr = [\n  [1, 2],\n]\nmodel = "a"\n', apply);
edit('[model_providers.ao-relay]\nname = "x"\n[model_providers.ao-relay.headers]\nk = "v"\n', doc => { delete doc.model_providers['ao-relay']; });
edit('[model_providers.ao-relay.headers]\nk = "v"\n[other]\n[model_providers.ao-relay]\nname = "x"\n', doc => { doc.model_providers['ao-relay'] = relay; });
const other = rewriteToml('# keep?\nmodel = "a"\n', { model: 'a', extra: 1 });
assert(isDeepStrictEqual(parse(other), { model: 'a', extra: 1 }), 'AO 管辖之外的字段也变了：整份重写，值正确');

console.log(`\n  结果: ${passed} 通过, ${failed} 失败\n`);
if (failed) process.exit(1);

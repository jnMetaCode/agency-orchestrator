/** Actual child processes emulate the documented Hermes protocols; no model or credentials needed. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HermesCLIConnector, parseHermesStreamOutput } from '../src/connectors/hermes-cli.js';

const root = mkdtempSync(join(tmpdir(), 'ao-hermes-protocol-'));
const entry = join(root, 'node_modules', 'hermes-fixture', 'index.mjs');
const trace = join(root, 'trace.jsonl');
mkdirSync(join(root, 'node_modules', 'hermes-fixture'), { recursive: true });
writeFileSync(entry, `
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args=process.argv.slice(2), mode=process.env.AO_HERMES_FIXTURE_MODE;
const record=data=>appendFileSync(process.env.AO_HERMES_FIXTURE_TRACE,JSON.stringify({args,mode,...data})+'\\n');
if(args[0]==='-z') { record({transport:'arg'}); console.log('legacy answer'); }
else if(mode==='old') { record({transport:'unsupported'}); console.error('unrecognized arguments: --query-file --format'); process.exit(2); }
else {
 let input=''; process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);
 process.stdin.on('end',()=>{
  const info={sha:createHash('sha256').update(input).digest('hex'),chars:input.length,bytes:Buffer.byteLength(input)};
  record({transport:'stdin',...info});
  console.log(JSON.stringify({type:'text',text:'INCOMPLETE INTERMEDIATE TEXT'}));
  if(mode==='missing')return;
  if(mode==='malformed'){console.log('not JSON');return;}
  console.log(JSON.stringify({type:'result',exit_code:mode==='failed-result'?1:0,text:JSON.stringify(info)}));
  if(mode==='nonzero')process.exitCode=7;
 });
}
`);
for (const name of ['hermes.cmd', 'hermes.CMD']) writeFileSync(join(root, name), '@echo off\r\n"%dp0%\\node_modules\\hermes-fixture\\index.mjs" %*\r\n');
const script = join(root, 'hermes');
writeFileSync(script, '#!' + process.execPath + '\nimport(' + JSON.stringify(entry) + ');\n');
chmodSync(script, 0o700);
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
function run(system: string, user: string, mode = 'ok', platform: NodeJS.Platform = 'win32') {
  const keys = ['PATH', 'PATHEXT', 'AO_HERMES_FIXTURE_MODE', 'AO_HERMES_FIXTURE_TRACE'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
    Object.assign(process.env, { PATH: root, PATHEXT: '.CMD', AO_HERMES_FIXTURE_MODE: mode, AO_HERMES_FIXTURE_TRACE: trace });
    return new HermesCLIConnector().chat(system, user, { provider: 'hermes-cli', model: 'test/model', timeout: 5000 });
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform);
    for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
  }
}
const records = () => readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const full = (system: string, user: string) => system ? `<system>\n${system}\n</system>\n\n${user}` : user;
let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); console.log('  ✓ ' + name); passed++; }
try {
  await test('normal Hermes prompts over 4 KiB retain the legacy -z protocol', async () => {
    const result = await run('role', 'x'.repeat(8000));
    assert.equal(result.content, 'legacy answer');
    assert.equal(records().at(-1).args[0], '-z');
  });
  for (const [system, user] of [['role', 'x'.repeat(79800)], ['角色：', '中文\n"$() & `literal` '.repeat(5000)]]) {
    await test('Windows oversized prompts arrive in full through explicit query-file stdin', async () => {
      const result = await run(system, user);
      const info = JSON.parse(result.content), expected = full(system, user);
      assert.equal(info.sha, createHash('sha256').update(expected).digest('hex'));
      assert.equal(info.bytes, Buffer.byteLength(expected));
      const record = records().at(-1);
      assert.deepEqual(record.args, ['chat', '--query-file', '-', '--oneshot', '--format', 'stream-json', '--model', 'test/model']);
      assert.equal(record.transport, 'stdin');
      assert(!result.content.includes('INTERMEDIATE'));
    });
  }
  if (originalPlatform.value !== 'win32') await test('POSIX oversized prompts also use query-file stdin', async () => {
    const user = 'x'.repeat(110 * 1024), result = await run('', user, 'ok', originalPlatform.value);
    assert.equal(JSON.parse(result.content).sha, createHash('sha256').update(user).digest('hex'));
  });
  await test('older Hermes rejects with an upgrade hint, without retrying or truncating', async () => {
    const before = records().length;
    await assert.rejects(run('', 'x'.repeat(80000), 'old'), /升级 Hermes/);
    assert.equal(records().length, before + 1);
  });
  for (const mode of ['missing', 'malformed', 'failed-result', 'nonzero']) await test('reject incomplete/failed response: ' + mode, async () => {
    await assert.rejects(run('', 'x'.repeat(80000), mode));
  });
  await test('final result text takes precedence over incomplete text deltas', () => {
    assert.equal(parseHermesStreamOutput('{"type":"text","text":"partial"}\n{"type":"result","exit_code":0,"text":"final"}\n'), 'final');
    assert.throws(() => parseHermesStreamOutput('{"type":"result","exit_code":0,"text":"final"}\n{"type":"text","text":"late"}'));
  });
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(`Hermes CLI: ${passed} scenarios passed`);

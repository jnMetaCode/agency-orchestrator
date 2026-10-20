import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { claimInput } from '../web/run-input.js';

const body = { stepId: 'ask', inputRequestId: 'current', text: 'first\nsecond' };
const child = { killed: false, exitCode: null, signalCode: null, stdin: { writable: true } };
const stream = { pendingInput: { ...body } };
assert.equal(claimInput(stream, child, { ...body, inputRequestId: 'old' }).code, 'INPUT_STALE');
assert.equal(claimInput(stream, child, { ...body, stepId: 'other' }).code, 'INPUT_STALE');
assert.equal(claimInput(stream, child, { ...body, text: 'a'.repeat(65537) }).code, 'INPUT_INVALID');
assert.equal(claimInput(stream, child, { runId: 'old-page', text: 'yes' }).code, 'INPUT_REQUEST_REQUIRED');
const result = claimInput(stream, child, body);
assert.equal(result.frame.split('\n').length, 2);
assert.deepEqual(JSON.parse(result.frame), body);
assert.equal(claimInput(stream, child, body).code, 'INPUT_STALE');
assert.equal(claimInput({ pendingInput: body, cancelRequested: true }, child, body).code, 'INPUT_NOT_WAITING');
assert.equal(claimInput({ pendingInput: body }, { ...child, exitCode: 0 }, body).code, 'INPUT_NOT_WAITING');

async function run(wrongToken = false) {
  const script = `
    import { executeDAG } from './dist/core/executor.js';
    import { buildDAG } from './dist/core/dag.js';
    const steps = ['first','second'].map((id,i)=>({id,type:'human_input',role:'',task:'',output:id,...(i?{depends_on:['first']}:{})}));
    const result = await executeDAG(buildDAG({name:'input-test',steps}), {
      connector:{chat(){throw Error('must not call model')}}, agentsDir:'.', llmConfig:{provider:'mock',model:'mock'}, concurrency:1
    });
    console.log('__RESULT__'+JSON.stringify(result));
    process.exit(0);
  `;
  const proc = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, AO_WEB_INPUT: '1', AO_WEB_INPUT_JSON: '1', AO_NON_INTERACTIVE: '0' },
  });
  let output = '', buffer = '', count = 0;
  const ids = new Set();
  const timeout = setTimeout(() => proc.kill('SIGKILL'), 8000);
  proc.stdout.on('data', chunk => {
    output += chunk; buffer += chunk;
    let pos;
    while ((pos = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
      if (!line.startsWith('__AO_INPUT_REQUEST__')) continue;
      const request = JSON.parse(line.slice('__AO_INPUT_REQUEST__'.length));
      count++; ids.add(request.inputRequestId);
      proc.stdin.write(JSON.stringify({ stepId: request.stepId, inputRequestId: wrongToken ? 'stale' : request.inputRequestId, text: count === 1 ? 'first\nsecond' : 'explicit second answer' }) + '\n');
    }
  });
  let stderr = ''; proc.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => { proc.once('error', reject); proc.once('close', resolve); }).finally(() => clearTimeout(timeout));
  const line = output.split('\n').find(line => line.startsWith('__RESULT__'));
  assert.ok(line, `child must finish: ${stderr}`);
  const result = JSON.parse(line.slice('__RESULT__'.length));
  if (wrongToken) {
    assert.equal(count, 1);
    assert.equal(result.steps[0].status, 'failed');
  } else {
    assert.equal(count, 2); assert.equal(ids.size, 2);
    assert.equal(result.steps[0].output, 'first\nsecond');
    assert.equal(result.steps[1].output, 'explicit second answer');
  }
}
await run();
await run(true);
console.log('run input: request binding, duplicate/cancel rejection, multiline child process and stale-token failure passed');

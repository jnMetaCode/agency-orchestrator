/** Execute the real compose route with an injected composer; no port or paid LLM calls. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const libraries = await import(pathToFileURL(resolve('web/role-libraries.js')).href);
const source = readFileSync(new URL('../web/server.js', import.meta.url), 'utf-8');
const start = source.indexOf("app.post('/api/compose',");
const end = source.indexOf('\n// ── Save an edited', start);
assert(start >= 0 && end > start, 'compose route must be found');
const importLine = "const { composeWorkflow } = await import('../dist/cli/compose.js');";
assert(source.slice(start, end).includes(importLine), 'composer injection must match actual route');
const route = source.slice(start, end).replace(importLine, 'const composeWorkflow = injectedComposer;');
const normalize = source.match(/function normalizeRoleLang\(lang\) \{[\s\S]*?\n\}/)?.[0];
const directory = source.match(/function agentsDirFor\(lang\) \{[\s\S]*?\n\}/)?.[0];
assert(normalize && directory, 'actual language and directory selectors must be found');

async function exercise(body: object, installed: string[], ready = true, composerFails = false) {
  let handler: any;
  let options: any;
  let status = 200;
  let payload: any;
  const context = {
    app: { post: (_path: string, fn: any) => { handler = fn; } },
    OPTIONAL_ROLE_LIBRARIES: libraries.OPTIONAL_ROLE_LIBRARIES,
    langLibDir: (id: string) => installed.includes(id) ? `/optional/${id}` : '',
    CUSTOM_AGENTS_DIR: '', AGENTS_DIR: '/builtin/zh', AGENTS_DIR_EN: '/builtin/en',
    existsSync: () => true, mkdirSync: () => {}, COMPOSED_DIR: '/composed',
    composeProviderReady: () => ready,
    buildLLMConfig: (provider: string) => ({ provider }),
    detectUsableCliProviders: () => [], guideSponsors: () => [], getRemoteManifest: async () => ({}),
    DEFAULT_PROVIDER_ID: 'test-provider', process: { env: {} }, console: { log: () => {} },
    injectedComposer: async (input: any) => {
      options = input;
      if (composerFails) throw new Error('composer failed');
      return { savedPath: '/composed/result.yaml', yaml: 'name: test', warnings: [] };
    },
  };
  runInNewContext(`${normalize}\n${directory}\n${route}`, context);
  const response = {
    status: (code: number) => { status = code; return response; },
    json: (value: any) => { payload = value; },
  };
  await handler({ body }, response);
  return { status, payload, options };
}

let passed = 0;
for (const id of ['zh', 'en', ...libraries.OPTIONAL_ROLE_LIBRARIES.map((lib: any) => lib.id)]) {
  const result = await exercise({ description: 'Make a plan', provider: 'test', roleLang: id, lang: 'en', roles: ['engineering/test'], budget: true }, ['zh', 'en'].includes(id) ? [] : [id]);
  assert.equal(result.status, 200, `${id}: route must not throw ReferenceError`);
  assert.equal(result.options.agentsDir, ['zh', 'en'].includes(id) ? `/builtin/${id}` : `/optional/${id}`);
  assert.equal(result.options.agentsDirName, libraries.OPTIONAL_ROLE_LIBRARIES.find((lib: any) => lib.id === id)?.pkg);
  assert.equal(result.options.lang, 'en');
  assert.equal(result.options.budget, true);
  assert.equal(result.options.autoRun, true);
  assert.equal(Array.from(result.options.pinnedRoles).join(','), 'engineering/test');
  assert.equal(result.payload.file, '/composed/result.yaml');
  passed++;
}
for (const id of ['ko', 'unknown']) {
  const result = await exercise({ description: 'Plan', roleLang: id }, []);
  assert.equal(result.status, 200);
  assert.equal(result.options.agentsDir, '/builtin/zh');
  assert.equal(result.options.agentsDirName, undefined);
  passed++;
}
const missingDescription = await exercise({}, []);
assert.equal(missingDescription.status, 400);
assert.equal(missingDescription.options, undefined);
passed++;
const missingCredentials = await exercise({ description: 'Plan' }, [], false);
assert.equal(missingCredentials.status, 400);
assert.equal(missingCredentials.payload.code, 'no_credentials');
assert.equal(missingCredentials.options, undefined);
passed++;
const failedCompose = await exercise({ description: 'Plan' }, [], true, true);
assert.equal(failedCompose.status, 500);
assert.equal(failedCompose.payload.error, 'composer failed');
passed++;
console.log(`Studio compose route: ${passed} scenarios passed`);

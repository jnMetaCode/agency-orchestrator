import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncApixoKey } from '../web/apixo-config.js';
test('changing either APIXO credential updates its sibling, preserving independent endpoints', () => {
  for (const provider of ['apixo', 'apixo-media']) {
    const saved = { apixo: { apiKey: 'old', baseUrl: 'https://llm.apixo.ai' }, 'apixo-media': { apiKey: 'old', baseUrl: 'https://api.apixo.ai/api/v1' } };
    saved[provider].apiKey = 'new';
    syncApixoKey(saved, provider, 'new', false);
    assert.equal(saved.apixo.apiKey, 'new'); assert.equal(saved['apixo-media'].apiKey, 'new');
    assert.notEqual(saved.apixo.baseUrl, saved['apixo-media'].baseUrl);
    delete saved[provider];
    syncApixoKey(saved, provider, '', true);
    assert(!Object.values(saved).some(entry => entry.apiKey));
  }
});

// The server entry must remain parseable: a hashbang is valid only on line one.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('Studio server entry passes Node syntax validation', () => {
  execFileSync(process.execPath, ['--check', fileURLToPath(new URL('../web/server.js', import.meta.url))]);
});

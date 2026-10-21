/** Global configuration inspection only. No CLI execution, network probes or config writes. */
import { openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parse } from 'smol-toml';

const MAX_BYTES = 1024 * 1024;
function readDocument(file, parser) {
  let fd;
  try {
    // O_NONBLOCK also prevents an unexpected FIFO from blocking the local server.
    fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) return { configuration: 'unreadable' };
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0, n;
    while (length <= MAX_BYTES && (n = readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += n;
    if (length > MAX_BYTES) return { configuration: 'unreadable' };
    let doc;
    try { doc = parser(bytes.subarray(0, length).toString('utf8')); }
    catch { return { configuration: 'invalid' }; }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { configuration: 'invalid' };
    return { configuration: 'present', doc, fingerprint: createHash('sha256').update(bytes.subarray(0, length)).digest('hex') };
  } catch (error) {
    return { configuration: error?.code === 'ENOENT' ? 'missing' : 'unreadable' };
  } finally { if (fd !== undefined) closeSync(fd); }
}

// Never return userinfo, paths, queries or fragments: URLs can carry credentials.
function endpointOrigin(value) {
  if (value === undefined || value === '') return {};
  if (typeof value !== 'string') return { endpointInvalid: true };
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return { endpointInvalid: true };
    return { endpointOrigin: url.origin };
  } catch { return { endpointInvalid: true }; }
}
function label(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  // These are labels, not credential fields. Bound them and mask common accidental key pastes.
  return value.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_./+-]{8,}/gi, '[redacted]').slice(0, 160);
}

export function readToolStatuses({ claudeDir, codexDir, installed = [], claudeOwnership, codexOwnership }) {
  function inspect(id, file, parser, select, ownership) {
    const { doc, configuration, fingerprint } = readDocument(file, parser);
    const base = { id, installed: installed.includes(id), configuration, management: 'unknown', recoveryPending: false, conflict: false };
    if (!doc) return base;
    let selected;
    try { selected = select(doc); } catch { return { ...base, configuration: 'invalid' }; }
    let state, ownershipFailed = !ownership;
    try { state = ownership?.(); }
    catch { ownershipFailed = true; }
    if (readDocument(file, parser).fingerprint !== fingerprint) return { ...base, configuration: 'changing' };
    return {
      ...base, ...selected,
      management: ownershipFailed ? 'unknown' : state?.tampered || state?.conflict ? 'changed' : state?.managed ? 'ao-marker' : 'unmarked',
      recoveryPending: !!state?.recoveryPending,
      conflict: !!(state?.tampered || state?.conflict),
    };
  }
  return { checkedAt: new Date().toISOString(), tools: [
    inspect('claude-code', join(claudeDir, 'settings.json'), JSON.parse, doc => {
      if (doc.env !== undefined && (!doc.env || typeof doc.env !== 'object' || Array.isArray(doc.env))) throw Error();
      const env = doc.env || {};
      if ((env.ANTHROPIC_MODEL !== undefined && typeof env.ANTHROPIC_MODEL !== 'string')
        || (doc.model !== undefined && typeof doc.model !== 'string')) throw Error();
      return { ...endpointOrigin(env.ANTHROPIC_BASE_URL), model: label(doc.model), environmentModel: label(env.ANTHROPIC_MODEL) };
    }, claudeOwnership),
    inspect('codex-cli', join(codexDir, 'config.toml'), parse, doc => {
      if (doc.model_provider !== undefined && typeof doc.model_provider !== 'string') throw Error();
      if (doc.model !== undefined && typeof doc.model !== 'string') throw Error();
      const provider = doc.model_provider;
      const providers = doc.model_providers;
      const cfg = provider && providers && Object.hasOwn(providers, provider) ? providers[provider] : undefined;
      return { provider: label(provider), model: label(doc.model), ...endpointOrigin(cfg?.base_url),
        endpointUnresolved: !provider && !!providers && typeof providers === 'object' && Object.keys(providers).length > 0,
        providerMissing: !!provider && provider !== 'openai' && (!cfg || typeof cfg !== 'object') };
    }, codexOwnership),
  ] };
}

export function registerToolStatusRoute(app, options) {
  app.get('/api/tools/status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(readToolStatuses({ ...options, installed: options.detectInstalled() })); }
    catch { res.status(500).json({ code: 'TOOL_STATUS_UNAVAILABLE', error: 'Tool status could not be read' }); }
  });
}

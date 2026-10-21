/** Opaque, expiring confirmation of a source revision and an exact server-resolved target.
 * No secret-bearing snapshot is stored or returned. Tokens are local to this engine process.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export class TargetPreviewError extends Error {
  constructor(required = false) {
    super(required ? '请先预览目标连接后重新确认' : '目标连接或预览已变化/过期，请重新预览并确认');
    this.code = required ? 'TARGET_PREVIEW_REQUIRED' : 'TARGET_PREVIEW_CHANGED';
    this.status = required ? 400 : 409;
  }
}

export function createTargetPreviews({ now = Date.now, ttlMs = 5 * 60_000 } = {}) {
  const key = randomBytes(32);
  const signature = (expires, operation, sourceRevision, target) => createHmac('sha256', key)
    .update(JSON.stringify([expires, operation, sourceRevision,
      Object.keys(target).sort().map(name => [name, target[name] ?? null])])).digest('hex');
  return {
    issue(operation, sourceRevision, target) {
      const expires = now() + ttlMs;
      return { targetRevision: `${expires}.${signature(expires, operation, sourceRevision, target)}`, expiresAt: new Date(expires).toISOString() };
    },
    verify(token, operation, sourceRevision, target) {
      if (typeof token !== 'string' || !token) throw new TargetPreviewError(true);
      const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(token);
      if (!match || Number(match[1]) <= now()) throw new TargetPreviewError();
      const expected = signature(Number(match[1]), operation, sourceRevision, target);
      if (!timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(expected, 'hex'))) throw new TargetPreviewError();
    },
  };
}

// Public preview fields must never include URL credentials, paths, query strings or API keys.
export function claudeTargetSummary(cfg) {
  let endpointOrigin;
  try { const url = new URL(cfg.baseUrl); if (['http:', 'https:'].includes(url.protocol)) endpointOrigin = url.origin; } catch { /* unknown */ }
  const safe = value => typeof value === 'string'
    ? value.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_./+-]{8,}/gi, '[redacted]').slice(0, 160) : undefined;
  return { scope: 'global', provider: safe(cfg.providerId), endpointOrigin,
    model: safe(cfg.model), sonnetModel: safe(cfg.sonnetModel), opusModel: safe(cfg.opusModel), haikuModel: safe(cfg.haikuModel),
    credentialField: cfg.apiKeyField || 'ANTHROPIC_AUTH_TOKEN', hasKey: !!cfg.apiKey };
}

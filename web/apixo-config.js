/** Chat and Generation use different endpoints but share one account credential. */
export function syncApixoKey(saved, provider, apiKey, clearing) {
  if (provider !== 'apixo' && provider !== 'apixo-media') return;
  const sibling = provider === 'apixo' ? 'apixo-media' : 'apixo';
  if (clearing) {
    if (saved[sibling]) delete saved[sibling].apiKey;
  } else if (typeof apiKey === 'string' && apiKey.trim()) {
    saved[sibling] = { ...saved[sibling], apiKey: apiKey.trim() };
  }
}

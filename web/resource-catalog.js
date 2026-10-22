/** Read-only resource discovery. Never starts commands, connects to servers or writes files. */
import { openSync, closeSync, fstatSync, readSync, lstatSync, opendirSync, constants } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { parseSkillFile } from '../dist/skills/loader.js';

const KEY = randomBytes(32);
const FILE_LIMIT = 1024 * 1024, SKILL_LIMIT = 256 * 1024, ITEM_LIMIT = 300;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const mask = value => typeof value === 'string' ? value.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_./+-]{8,}/gi, '[redacted]') : '';
const label = value => mask(value).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 160);
const idFor = value => createHmac('sha256', KEY).update(value).digest('hex');
function read(file, limit = FILE_LIMIT) {
  let fd;
  try {
    if (lstatSync(file).isSymbolicLink()) return { status: 'unreadable' };
    fd = openSync(file, constantsRead());
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) return { status: 'unreadable' };
    const bytes = Buffer.alloc(limit + 1); let length = 0, n;
    while (length <= limit && (n = readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += n;
    if (length > limit) return { status: 'unreadable' };
    return { status: 'present', text: bytes.subarray(0, length).toString('utf8') };
  } catch (e) { return { status: e?.code === 'ENOENT' ? 'missing' : 'unreadable' }; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function constantsRead() { return constants.O_RDONLY | (constants.O_NONBLOCK || 0) | (constants.O_NOFOLLOW || 0); }
function document(file, parser) {
  const result = read(file);
  if (result.status !== 'present') return result;
  try { const doc = parser(result.text); return object(doc) ? { status: 'present', doc } : { status: 'invalid' }; }
  catch { return { status: 'invalid' }; }
}
function origin(value, protocols = ['http:', 'https:']) {
  try { const url = new URL(value); return protocols.includes(url.protocol) ? url.origin : undefined; } catch { return undefined; }
}
function mcpSummary(value, host) {
  if (!object(value)) return { status: 'invalid', transport: 'unknown', configuredState: 'unknown' };
  let transport = 'unknown';
  if (host === 'claude-code') {
    if ((!value.type || value.type === 'stdio') && typeof value.command === 'string' && value.command.trim() && !value.url) transport = 'stdio';
    if (['http', 'streamable-http', 'sse'].includes(value.type) && origin(value.url)) transport = value.type === 'streamable-http' ? 'http' : value.type;
    if (value.type === 'ws' && origin(value.url, ['ws:', 'wss:'])) transport = 'ws';
  } else {
    if (typeof value.command === 'string' && value.command.trim() && !value.url) transport = 'stdio';
    else if (!value.command && origin(value.url)) transport = 'http';
  }
  return {
    status: transport === 'unknown' ? 'unsupported' : 'declared', transport,
    configuredState: host === 'codex-cli' && typeof value.enabled === 'boolean' ? (value.enabled ? 'enabled' : 'disabled') : 'unknown',
    endpointOrigin: transport === 'stdio' ? undefined : origin(value.url, ['http:', 'https:', 'ws:', 'wss:']),
    hasArguments: Array.isArray(value.args) && value.args.length > 0,
    // No commands/args/env/headers/OAuth or raw MCP config is returned, even in details.
    environmentCount: object(value.env) ? Object.keys(value.env).length : 0,
  };
}

export function readResourceCatalog({ skillDirs = [], claudeMcpFile, codexFile }, detailId) {
  const sources = [], items = []; let truncated = false, budget = 8 * FILE_LIMIT;
  const seen = new Set(); let detail;
  const directories = [...new Set(skillDirs)];
  for (const [index, directory] of directories.slice(0, 16).entries()) {
    const sourceId = `skills-${index}`;
    const source = { id: sourceId, kind: 'skill', host: 'ao', status: 'present', skipped: 0 };
    sources.push(source);
    let dir;
    try {
      dir = opendirSync(directory);
      let entry, scanned = 0;
      while ((entry = dir.readSync())) {
        if (++scanned > 600 || items.length >= ITEM_LIMIT || budget <= 0) { truncated = true; source.status = 'partial'; break; }
        if (entry.name.startsWith('.')) continue;
        if (!entry.isDirectory()) { if (entry.isSymbolicLink()) { source.skipped++; source.status = 'partial'; } continue; }
        const reference = entry.name;
        const file = join(directory, reference, 'SKILL.md');
        const result = read(file, SKILL_LIMIT);
        if (result.status === 'missing') continue;
        const id = idFor(`skill\0${directory}\0${reference}`);
        let skill;
        if (result.status === 'present') { budget -= Buffer.byteLength(result.text); skill = parseSkillFile(result.text, reference); }
        const supportedReference = /^[A-Za-z0-9_-]+$/.test(reference);
        const active = result.status === 'present' && supportedReference && !seen.has(reference);
        const item = { id, kind: 'skill', host: 'ao', scope: 'ao-search-path', sourceId,
          name: label(skill?.name || reference), reference: label(reference), description: mask(skill?.description).slice(0, 1024),
          status: result.status === 'present' ? (supportedReference ? 'declared' : 'unsupported') : result.status,
          selection: active ? 'first-match' : seen.has(reference) ? 'shadowed' : 'unknown',
          format: result.status === 'present' ? (/^---\s*\n/.test(result.text) ? 'frontmatter' : 'legacy') : undefined,
        };
        if (active) seen.add(reference);
        items.push(item);
        if (id === detailId) detail = { ...item, body: skill ? mask(skill.body) : undefined };
      }
    } catch (e) { source.status = e?.code === 'ENOENT' ? 'missing' : 'unreadable'; }
    finally { if (dir) dir.closeSync(); }
  }
  if (directories.length > 16) truncated = true;
  for (const [host, file, parser, key] of [
    ['claude-code', claudeMcpFile, JSON.parse, 'mcpServers'], ['codex-cli', codexFile, parse, 'mcp_servers'],
  ]) {
    const sourceId = `mcp-${host}`;
    const result = document(file, parser);
    const source = { id: sourceId, kind: 'mcp', host, status: result.status, skipped: 0 }; sources.push(source);
    if (!result.doc) continue;
    const servers = result.doc[key];
    if (servers === undefined) continue;
    if (!object(servers)) { source.status = 'invalid'; continue; }
    for (const [name, value] of Object.entries(servers)) {
      if (items.length >= ITEM_LIMIT) { source.status = 'partial'; truncated = true; break; }
      const item = { id: idFor(`mcp\0${host}\0${file}\0${name}`), kind: 'mcp', host, scope: 'user', sourceId, name: label(name), ...mcpSummary(value, host) };
      items.push(item);
      if (item.id === detailId) detail = item;
    }
  }
  return detailId ? detail : { checkedAt: new Date().toISOString(), sources, items, truncated };
}

export function registerResourceCatalogRoutes(app, options) {
  const readOptions = () => ({ ...options, skillDirs: options.getSkillDirs() });
  app.get('/api/resources', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(readResourceCatalog(readOptions())); }
    catch { res.status(500).json({ code: 'RESOURCES_UNAVAILABLE', error: 'Resource catalog could not be read' }); }
  });
  app.get('/api/resources/:id', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!/^[a-f0-9]{64}$/.test(req.params.id)) return res.status(404).json({ code: 'RESOURCE_NOT_FOUND', error: 'Resource not found; refresh the catalog' });
    try {
      const item = readResourceCatalog(readOptions(), req.params.id);
      if (!item) return res.status(404).json({ code: 'RESOURCE_NOT_FOUND', error: 'Resource not found; refresh the catalog' });
      res.json(item);
    } catch { res.status(500).json({ code: 'RESOURCES_UNAVAILABLE', error: 'Resource could not be read' }); }
  });
}

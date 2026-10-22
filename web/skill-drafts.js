/** Personal method drafts only: no upstream modification, host installation or execution. */
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { opendirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { withConfigTransaction } from '../dist/utils/config-transaction.js';
import { assertNotSymlink } from '../dist/utils/config-safety.js';
import { readResourceFile } from './resource-catalog.js';
import { createTargetPreviews, TargetPreviewError } from './config-operation-preview.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_BYTES = 256 * 1024;
export class SkillDraftError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status; }
}
const invalid = () => new SkillDraftError('DRAFT_INVALID', 400, '请填写有效的草稿名称和正文（最多 128 KiB），并重新预览');
const changed = () => new SkillDraftError('DRAFT_CHANGED', 409, '草稿已由外部修改，请重新读取后编辑');

export function createSkillDrafts({ directory, resolveSource }) {
  const key = randomBytes(32), previews = createTargetPreviews();
  const paths = id => { if (!UUID.test(id || '')) throw invalid(); assertNotSymlink(directory); const dir = join(directory, id); assertNotSymlink(dir); return { dir, file: join(dir, 'draft.json') }; };
  function snapshot(id) {
    const { dir, file } = paths(id), result = readResourceFile(file, MAX_BYTES);
    if (!['present', 'missing'].includes(result.status)) throw new SkillDraftError('DRAFT_UNAVAILABLE', 409, '草稿无法安全读取，请核对本地数据');
    let record;
    if (result.status === 'present') {
      try { record = JSON.parse(result.text); } catch { throw new SkillDraftError('DRAFT_UNAVAILABLE', 409, '草稿内容异常，请核对本地数据'); }
      if (record?.version !== 1 || record.id !== id || typeof record.name !== 'string' || typeof record.body !== 'string'
        || typeof record.updatedAt !== 'string' || typeof record.sourceName !== 'string' || typeof record.sourceResourceId !== 'string') throw new SkillDraftError('DRAFT_UNAVAILABLE', 409, '草稿结构异常，请核对本地数据');
    }
    const revision = createHmac('sha256', key).update(JSON.stringify([id, result.text ?? null])).digest('hex');
    return { record, revision, pending: existsSync(join(dir, '.ao-config-transaction.json')) };
  }
  const detail = id => { const state = snapshot(id); if (!state.record) throw new SkillDraftError('DRAFT_NOT_FOUND', 404, '未找到草稿，请刷新列表'); return { ...state.record, revision: state.revision, pending: state.pending }; };
  const list = () => {
    let dir; const items = []; let partial = false, skipped = 0;
    try {
      assertNotSymlink(directory); dir = opendirSync(directory); let entry, scanned = 0, budget = 8 * 1024 * 1024;
      while ((entry = dir.readSync())) {
        if (++scanned > 600 || items.length >= 100 || budget <= 0) { partial = true; break; }
        if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
        try { const item = detail(entry.name); budget -= Buffer.byteLength(item.body); const { body, revision, ...summary } = item; items.push(summary); }
        catch { skipped++; partial = true; }
      }
    } catch (e) { if (e?.code !== 'ENOENT') throw e; }
    finally { dir?.closeSync(); }
    return { items: items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), partial, skipped };
  };
  function target(body, id, record) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(body.name)
      || typeof body.body !== 'string' || !body.body.trim() || body.body.includes('\0') || Buffer.byteLength(body.body) > 128 * 1024) throw invalid();
    let sourceName = record?.sourceName || '', sourceResourceId = record?.sourceResourceId || '';
    if (!record && body.sourceResourceId) {
      if (!/^[a-f0-9]{64}$/.test(body.sourceResourceId)) throw invalid();
      const source = resolveSource(body.sourceResourceId);
      if (!source || source.kind !== 'skill' || source.body === undefined) throw new SkillDraftError('DRAFT_SOURCE_CHANGED', 409, '来源不可读取，请刷新资源后重新复制');
      sourceName = source.name; sourceResourceId = body.sourceResourceId;
    }
    const value = { id, name: body.name.trim(), body: body.body, sourceName, sourceResourceId };
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES - 4096) throw invalid();
    return value;
  }
  return {
    list, detail,
    preview(body) {
      const id = body.id || randomUUID(), state = snapshot(id);
      if (body.id && !state.record) throw new SkillDraftError('DRAFT_NOT_FOUND', 404, '未找到草稿，请刷新列表');
      if (body.id && body.expectedRevision !== state.revision) throw changed();
      if (state.pending) throw new SkillDraftError('DRAFT_PENDING', 409, '发现未完成保存，请先核对保存状态');
      const value = target(body, id, state.record);
      return { id, expectedRevision: state.revision, ...previews.issue('skill-draft/save', state.revision, value), before: state.record ? { name: state.record.name, body: state.record.body } : null, after: value };
    },
    save(body) {
      const { dir } = paths(body.id);
      // Reject invalid confirmations before creating a directory or recovering a journal.
      const initial = snapshot(body.id);
      if (body.expectedRevision !== initial.revision) throw changed();
      const initialTarget = target(body, body.id, initial.record);
      previews.verify(body.targetRevision, 'skill-draft/save', body.expectedRevision, initialTarget);
      return withConfigTransaction(dir, ['draft.json'], commit => {
        const state = snapshot(body.id);
        if (body.expectedRevision !== state.revision) throw changed();
        const value = target(body, body.id, state.record);
        previews.verify(body.targetRevision, 'skill-draft/save', body.expectedRevision, value);
        const record = { version: 1, ...value, updatedAt: new Date().toISOString() };
        commit([{ name: 'draft.json', text: JSON.stringify(record, null, 2) + '\n' }]);
        return detail(body.id);
      });
    },
    check(id) {
      const { dir } = paths(id);
      // Explicit result check may recover this draft's interrupted transaction; never another draft.
      if (!existsSync(dir)) return { saved: false };
      return withConfigTransaction(dir, ['draft.json'], () => {
        const state = snapshot(id);
        return state.record ? { saved: true, draft: detail(id) } : { saved: false };
      });
    },
  };
}

export function registerSkillDraftRoutes(app, options) {
  const store = createSkillDrafts(options);
  const handle = action => (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(action(req)); }
    catch (e) {
      if (e instanceof SkillDraftError || e instanceof TargetPreviewError) return res.status(e.status).json({ code: e.code, error: e.message });
      res.status(500).json({ code: 'DRAFT_UNAVAILABLE', error: '无法处理个人草稿，请核对保存状态后重试' });
    }
  };
  app.get('/api/skill-drafts', handle(() => store.list()));
  app.get('/api/skill-drafts/:id', handle(req => store.detail(req.params.id)));
  app.post('/api/skill-drafts/preview', handle(req => store.preview(req.body || {})));
  app.post('/api/skill-drafts/save', handle(req => store.save(req.body || {})));
  app.post('/api/skill-drafts/:id/check', handle(req => store.check(req.params.id)));
}

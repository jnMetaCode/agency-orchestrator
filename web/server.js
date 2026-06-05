#!/usr/bin/env node
/**
 * agency-orchestrator web UI backend
 * - Lists workflows/*.yaml
 * - Spawns `ao run` and streams output via SSE
 * - Browse ao-output/ history and resume from any step
 * Not for production — single-user local tool for testing + demo recording.
 */
import express from 'express';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WORKFLOWS_DIR = join(ROOT, 'workflows');
// Optional extra workflows dir for your own/team workflows, e.g. set
// AO_USER_WORKFLOWS_DIR=marketing/workflows (absolute or ROOT-relative). Off by default.
const USER_WORKFLOWS_DIR = process.env.AO_USER_WORKFLOWS_DIR
  ? resolve(ROOT, process.env.AO_USER_WORKFLOWS_DIR)
  : '';
// User-composed / saved workflows (gitignored). Always writable & runnable.
const COMPOSED_DIR = join(ROOT, 'ao-workflows');
const AGENTS_DIR = join(ROOT, 'node_modules', 'agency-agents-zh');
const OUTPUT_DIR = join(ROOT, 'ao-output');
const CLI = join(ROOT, 'dist', 'cli.js');
const PORT = process.env.PORT || 8088;
// Local single-user tool — bind to loopback by default. Set HOST=0.0.0.0 to expose (not recommended).
const HOST = process.env.HOST || '127.0.0.1';

let PKG_VERSION = '0.0.0';
try { PKG_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version; } catch {}

// Path containment check that resolves `..` and avoids sibling-prefix matches.
function isInside(child, parent) {
  if (!parent) return false;
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p + sep);
}
const ALLOWED_WORKFLOW_DIRS = [WORKFLOWS_DIR, USER_WORKFLOWS_DIR, COMPOSED_DIR].filter(Boolean);

// LLM config for in-process compose; keys are read from env by the connector factory.
function buildLLMConfig(provider) {
  const p = provider || process.env.AO_PROVIDER || 'deepseek';
  const cliProviders = ['claude-code', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli'];
  const model = cliProviders.includes(p) ? undefined
    : p === 'deepseek' ? 'deepseek-chat'
    : p === 'claude' ? 'claude-sonnet-4-20250514'
    : p === 'openai' ? 'gpt-4o'
    : undefined;
  return { provider: p, model, max_tokens: 4096 };
}
// Same as buildLLMConfig but safe to dump to YAML: omit model when undefined
// (CLI providers don't need it; keyed providers get it from buildLLMConfig).
function cleanLLMConfig(provider) {
  const c = buildLLMConfig(provider);
  const out = { provider: c.provider, max_tokens: c.max_tokens };
  if (c.model) out.model = c.model;
  return out;
}
const isAllowedWorkflow = (file) => ALLOWED_WORKFLOW_DIRS.some(d => isInside(file, d));

// ── API key management (local-only) ──────────────────────────────────────────
// Keys pasted in the Studio UI are stored in .local/ (gitignored) and injected
// into this server's process.env. That way BOTH spawned `ao` processes (they
// inherit env) and the in-process compose (factory reads process.env) pick them
// up — no per-call wiring needed. Keys never leave this machine.
const KEYS_FILE = join(ROOT, '.local', 'web-keys.json');
const KEY_ENV = {
  deepseek: { key: 'DEEPSEEK_API_KEY', base: 'DEEPSEEK_BASE_URL' },
  openai: { key: 'OPENAI_API_KEY', base: 'OPENAI_BASE_URL' },
  claude: { key: 'ANTHROPIC_API_KEY', base: null },
};
function readKeys() {
  try { return JSON.parse(readFileSync(KEYS_FILE, 'utf-8')) || {}; } catch { return {}; }
}
function writeKeys(obj) {
  mkdirSync(dirname(KEYS_FILE), { recursive: true });
  writeFileSync(KEYS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
}
function applyKeys(obj) {
  for (const [provider, cfg] of Object.entries(KEY_ENV)) {
    const entry = obj[provider];
    if (!entry) continue;
    if (entry.apiKey) process.env[cfg.key] = entry.apiKey;
    if (cfg.base && entry.baseUrl) process.env[cfg.base] = entry.baseUrl;
  }
}
applyKeys(readKeys());

const WEBSITE_DIST = join(ROOT, 'website', 'dist');
const HAS_NEW_UI = existsSync(join(WEBSITE_DIST, 'index.html'));

const app = express();
app.use(express.json({ limit: '5mb' }));
// Prefer the new React Studio build when present; fall back to the legacy vanilla UI.
if (HAS_NEW_UI) app.use(express.static(WEBSITE_DIST));
app.use(express.static(__dirname));

// Cache: role file -> { name, description, color }
const roleMetaCache = new Map();
function getRoleMeta(role) {
  if (!role) return null;
  if (roleMetaCache.has(role)) return roleMetaCache.get(role);
  const agentsDir = join(ROOT, 'node_modules', 'agency-agents-zh');
  const filePath = join(agentsDir, role + '.md');
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf-8');
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const fm = yaml.load(fmMatch[1]);
        const meta = { name: fm.name || null, description: fm.description || '', color: fm.color || '#888' };
        roleMetaCache.set(role, meta);
        return meta;
      }
      // No frontmatter — try to extract name from first # heading
      const h1 = raw.match(/^#\s+(.+)/m);
      if (h1) {
        const name = h1[1].replace(/[—–\-].*/,'').trim();
        const meta = { name, description: '', color: '#888' };
        roleMetaCache.set(role, meta);
        return meta;
      }
    }
  } catch {}
  roleMetaCache.set(role, null);
  return null;
}

const catEmojiMap = {
  marketing:'📣', 'paid-media':'📺', sales:'🤝', product:'📱',
  'project-management':'📋', testing:'🧪', support:'🛠', 'spatial-computing':'🌐',
  specialized:'⚙️', 'game-development':'🎮', engineering:'💻', design:'🎨',
  academic:'🎓', finance:'💰', hr:'👥', legal:'⚖️', strategy:'🧭', 'supply-chain':'📦',
};

function loadWorkflowMeta(dir, tagPrivate = false) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => {
      try {
        const full = join(dir, f);
        const doc = yaml.load(readFileSync(full, 'utf-8'));
        return {
          file: full,
          filename: f,
          name: doc?.name || f,
          description: doc?.description || '',
          inputs: (doc?.inputs || []).map(i => ({
            name: i.name,
            description: i.description || '',
            required: !!i.required,
            default: i.default,
          })),
          steps: (doc?.steps || []).map(s => {
            let name = s.name;
            let emoji = s.emoji;
            if ((!name || !emoji) && s.role) {
              const rm = getRoleMeta(s.role);
              if (rm) {
                if (!name) name = rm.name;
                if (!emoji) {
                  const cat = s.role.split('/')[0];
                  emoji = catEmojiMap[cat] || '🤖';
                }
              } else if (!emoji) {
                const cat = s.role.split('/')[0];
                emoji = catEmojiMap[cat] || '🤖';
              }
            }
            // If still no Chinese name, try to extract from role filename
            if (!name && s.role) {
              const roleFile = s.role.split('/').pop() || '';
              const roleSuffix = roleFile.replace(/^[a-z]+-/, '');
              // Fallback: readable English from role filename
              name = roleSuffix.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            }
            return { id: s.id, role: s.role, name: name || s.id, emoji: emoji || '🤖' };
          }),
          provider: doc?.llm?.provider,
          private: tagPrivate,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ── Workflow list ──
app.get('/api/workflows', (_req, res) => {
  const all = [
    ...loadWorkflowMeta(WORKFLOWS_DIR, false),
    ...(USER_WORKFLOWS_DIR ? loadWorkflowMeta(USER_WORKFLOWS_DIR, true) : []),
    ...(existsSync(COMPOSED_DIR) ? loadWorkflowMeta(COMPOSED_DIR, true) : []),
  ];
  res.json(all);
});

// ── History: list past runs ──
app.get('/api/runs', (_req, res) => {
  if (!existsSync(OUTPUT_DIR)) return res.json([]);
  const runs = readdirSync(OUTPUT_DIR)
    .filter(d => {
      const metaPath = join(OUTPUT_DIR, d, 'metadata.json');
      return existsSync(metaPath);
    })
    .map(d => {
      try {
        const metaPath = join(OUTPUT_DIR, d, 'metadata.json');
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        const stat = statSync(join(OUTPUT_DIR, d));
        const ts = d.match(/(\d{4}-\d{2}-\d{2}T[\d-]+)$/)?.[1]?.replace(/-/g, (m, i) => i > 9 ? ':' : m) || '';
        return {
          id: d,
          name: meta.name,
          success: meta.success,
          duration: meta.totalDuration,
          tokens: meta.totalTokens,
          stepCount: meta.steps?.length || 0,
          completedCount: meta.steps?.filter(s => s.status === 'completed').length || 0,
          timestamp: ts,
          mtime: stat.mtimeMs,
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  res.json(runs);
});

// ── History: get single run details ──
app.get('/api/runs/:id', (req, res) => {
  const runDir = join(OUTPUT_DIR, req.params.id);
  const metaPath = join(runDir, 'metadata.json');
  if (!existsSync(metaPath)) return res.status(404).json({ error: 'run not found' });

  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    const stepsDir = join(runDir, 'steps');
    const steps = (meta.steps || []).map((s, i) => {
      const filename = `${i + 1}-${s.id}.md`;
      const filePath = join(stepsDir, filename);
      let content = '';
      if (existsSync(filePath)) {
        content = readFileSync(filePath, 'utf-8');
        // Strip the header line (> emoji **name** | ...)
        const headerEnd = content.indexOf('\n---\n');
        if (headerEnd >= 0) content = content.slice(headerEnd + 5).trim();
      }
      return { ...s, content };
    });
    res.json({ ...meta, dir: req.params.id, steps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── YAML preview ──
app.get('/api/workflows/yaml', (req, res) => {
  const file = req.query.file;
  if (!file || typeof file !== 'string') return res.status(400).json({ error: 'invalid file' });
  const resolved = resolve(file);
  if (!isAllowedWorkflow(resolved)) return res.status(403).json({ error: 'file outside allowed dirs' });
  if (!existsSync(resolved)) return res.status(404).json({ error: 'file not found' });
  res.type('text/yaml').send(readFileSync(resolved, 'utf-8'));
});

// ── Run workflow (with optional resume) ──
app.post('/api/run', (req, res) => {
  const { file, inputs, provider, resume, fromStep } = req.body || {};
  if (!file || typeof file !== 'string') {
    return res.status(400).json({ error: 'invalid workflow file' });
  }
  const resolvedFile = resolve(file);
  if (!isAllowedWorkflow(resolvedFile)) {
    return res.status(403).json({ error: 'file outside allowed dirs' });
  }
  if (!existsSync(resolvedFile)) {
    return res.status(404).json({ error: 'workflow file not found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (type, data) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const args = [CLI, 'run', resolvedFile];
  if (provider) {
    args.push('--provider', provider);
    // Keyed providers (deepseek/openai/claude) require a model. A bare --provider
    // override clears the YAML model → API 400. Supply the matching model too.
    const m = cleanLLMConfig(provider).model;
    if (m) args.push('--model', m);
  }
  if (resume) {
    args.push('--resume', resume === true ? 'last' : resume);
    if (fromStep) args.push('--from', fromStep);
  }
  for (const [k, v] of Object.entries(inputs || {})) {
    if (v !== '' && v !== undefined && v !== null) {
      args.push('-i', `${k}=${v}`);
    }
  }

  send('start', { cmd: `ao run ${args.slice(2).join(' ')}`, resume: !!resume, fromStep });

  // Parse CLI output into structured events
  let lineBuffer = '';
  let currentStepId = null;

  function parseLine(raw) {
    const clean = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '').trim();
    if (!clean) return;

    // Step start: "⏳ emoji name 执行中 ..."
    const startMatch = clean.match(/^⏳\s+(\S+)\s+(.+?)\s+执行中/);
    if (startMatch) {
      const [, emoji, name] = startMatch;
      send('step-start', { emoji, name });
      return;
    }

    // Step header: "── [N/M] emoji name (id) ──"
    const headerMatch = clean.match(/── \[(\d+)\/(\d+)\] (\S+)\s+(.+?)\s+\((\S+)\) ──/);
    if (headerMatch) {
      const [, cur, total, emoji, name, id] = headerMatch;
      currentStepId = id;
      send('step-header', { cur: +cur, total: +total, emoji, name, id });
      return;
    }

    // Step done: "完成 | 22.5s | 695 tokens".
    // NOTE: the step's CONTENT is printed AFTER this line, so we must keep
    // currentStepId set here — clearing it would drop the whole step body.
    const metaMatch = clean.match(/^完成\s*\|\s*(.+)/);
    if (metaMatch && currentStepId) {
      send('step-done', { id: currentStepId, meta: metaMatch[1] });
      return;
    }

    // Workflow summary: "完成: 5/5 步 | ..." — end of all step output.
    if (/完成:\s*\d+\/\d+\s*步/.test(clean)) {
      send('workflow-summary', { text: clean });
      currentStepId = null;
      return;
    }

    // Trailing footer after the summary — never part of a step body.
    if (/^详细输出[:：]/.test(clean) || /^💡/.test(clean) || /^可选步骤/.test(clean) || /^steps[:：]/i.test(clean)) {
      currentStepId = null;
      return;
    }

    // Pure separator lines (=====) — skip, but keep attributing to the step.
    if (/^={3,}$/.test(clean)) return;

    // Step content (printed after the "完成 | meta" line, until the next header)
    if (currentStepId) {
      const stripped = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/^\s{0,4}/, '');
      if (!/^⏳.*\.\.\.\s*\d+s/.test(clean)) {
        send('step-content', { id: currentStepId, text: stripped });
      }
    }
  }

  console.log('[run]', 'node', args.join(' '));
  const child = spawn('node', args, {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  child.stdout.on('data', chunk => {
    const text = chunk.toString();
    send('stdout', { text });
    // Also parse into structured events
    lineBuffer += text;
    let idx;
    while ((idx = lineBuffer.indexOf('\n')) >= 0) {
      parseLine(lineBuffer.slice(0, idx));
      lineBuffer = lineBuffer.slice(idx + 1);
    }
  });
  child.stderr.on('data', chunk => {
    send('stderr', { text: chunk.toString() });
  });

  child.on('exit', (code, signal) => {
    if (lineBuffer.trim()) parseLine(lineBuffer);
    console.log('[exit]', code, signal);
    send('done', { code, signal });
    res.end();
  });
  child.on('error', err => {
    console.log('[error]', err.message);
    send('error', { message: err.message });
    res.end();
  });

  let finished = false;
  child.on('exit', () => { finished = true; });
  res.on('close', () => {
    if (!finished && !child.killed) {
      console.log('[abort] client closed');
      child.kill('SIGTERM');
    }
  });
});

// ── Roles / Agents ──
function loadRoles() {
  const agentsDir = join(ROOT, 'node_modules', 'agency-agents-zh');
  if (!existsSync(agentsDir)) return [];

  const categoryNames = {
    marketing: '市场营销', 'paid-media': '付费媒体', sales: '销售', product: '产品',
    'project-management': '项目管理', testing: '质量测试', support: '运营支持',
    'spatial-computing': '空间计算', specialized: '专业服务', 'game-development': '游戏开发',
    engineering: '工程开发', design: '设计', academic: '学术研究', finance: '财务金融',
    hr: '人力资源', legal: '法务', strategy: '战略', 'supply-chain': '供应链',
  };

  const roles = [];
  for (const cat of readdirSync(agentsDir)) {
    const catDir = join(agentsDir, cat);
    try { if (!statSync(catDir).isDirectory()) continue; } catch { continue; }
    const files = readdirSync(catDir).filter(f => f.endsWith('.md'));
    for (const f of files) {
      try {
        const raw = readFileSync(join(catDir, f), 'utf-8');
        const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) continue;
        const fm = yaml.load(fmMatch[1]);
        roles.push({
          id: f.replace('.md', ''),
          category: cat,
          categoryName: categoryNames[cat] || cat,
          name: fm.name || f.replace('.md', ''),
          description: fm.description || '',
          color: fm.color || '#888',
        });
      } catch {}
    }
  }
  return roles;
}

let rolesCache = null;
app.get('/api/roles', (_req, res) => {
  if (!rolesCache) rolesCache = loadRoles();
  res.json(rolesCache);
});

app.get('/api/roles/:category/:id', (req, res) => {
  const agentsDir = join(ROOT, 'node_modules', 'agency-agents-zh');
  const filePath = join(agentsDir, req.params.category, req.params.id + '.md');
  if (!isInside(filePath, agentsDir) || !existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  const raw = readFileSync(filePath, 'utf-8');
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  const fm = fmMatch ? yaml.load(fmMatch[1]) : {};
  const body = fmMatch ? raw.slice(fmMatch[0].length).trim() : raw;
  res.json({ id: req.params.id, category: req.params.category, name: fm.name || req.params.id, description: fm.description || '', color: fm.color || '#888', content: body });
});

// ── Run single role ──
app.post('/api/run-role', (req, res) => {
  const { role, task, provider } = req.body || {};
  if (!role || !task) return res.status(400).json({ error: 'role and task required' });

  // Build a temp single-step workflow. Top-level llm is required; keyed providers
  // (deepseek/openai/claude) also require a model — buildLLMConfig fills it.
  const wfDoc = {
    name: `专家咨询: ${role.split('/').pop()}`,
    agents_dir: 'agency-agents-zh',
    llm: cleanLLMConfig(provider),
    steps: [{ id: 'consult', role, task, output: 'result' }],
  };

  const tmpFile = join(tmpdir(), `ao-role-${Date.now()}.yaml`);
  writeFileSync(tmpFile, yaml.dump(wfDoc, { lineWidth: -1 }), 'utf-8');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (type, data) => { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };

  // Don't pass --provider here: the temp workflow already bakes a full llm block
  // (provider + model). A bare --provider override would drop the model and the
  // API call would 400 with "missing field model".
  const args = [CLI, 'run', tmpFile];

  send('start', { cmd: `ao run (${role})`, task });

  let lineBuffer = '';
  let collecting = false;
  let content = '';

  function parseLine(raw) {
    const clean = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '').trim();
    if (!clean) return;

    // Step header
    if (/── \[\d+\/\d+\]/.test(clean)) { collecting = true; return; }
    // Step done
    if (/^完成\s*\|/.test(clean)) { send('step-done', { meta: clean.replace(/^完成\s*\|\s*/, '') }); return; }
    // Workflow summary
    if (/完成:\s*\d+\/\d+\s*步/.test(clean)) return;
    // Collect content
    if (collecting) {
      if (/^⏳/.test(clean)) return;
      const stripped = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/^\s{0,4}/, '');
      content += stripped + '\n';
      send('content', { text: stripped });
    }
  }

  console.log('[run-role]', role, task.slice(0, 60));
  const child = spawn('node', args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0' } });

  child.stdout.on('data', chunk => {
    const text = chunk.toString();
    send('stdout', { text });
    lineBuffer += text;
    let idx;
    while ((idx = lineBuffer.indexOf('\n')) >= 0) { parseLine(lineBuffer.slice(0, idx)); lineBuffer = lineBuffer.slice(idx + 1); }
  });
  child.stderr.on('data', chunk => send('stderr', { text: chunk.toString() }));
  child.on('exit', (code, signal) => {
    if (lineBuffer.trim()) parseLine(lineBuffer);
    send('done', { code, signal, content });
    res.end();
    try { unlinkSync(tmpFile); } catch {}
  });
  child.on('error', err => { send('error', { message: err.message }); res.end(); try { unlinkSync(tmpFile); } catch {} });

  let finished = false;
  child.on('exit', () => { finished = true; });
  res.on('close', () => { if (!finished && !child.killed) { child.kill('SIGTERM'); try { unlinkSync(tmpFile); } catch {} } });
});

// ── Compose a workflow from picked roles (LLM orchestrates the chosen cast) ──
app.post('/api/compose', async (req, res) => {
  const { description, roles, name, provider } = req.body || {};
  if (!description || typeof description !== 'string') return res.status(400).json({ error: 'description required' });
  if (!Array.isArray(roles) || roles.length === 0) return res.status(400).json({ error: 'at least one role required' });
  try {
    mkdirSync(COMPOSED_DIR, { recursive: true });
    const { composeWorkflow } = await import('../dist/cli/compose.js');
    const trimmedName = name && String(name).trim() ? String(name).trim() : undefined;
    const result = await composeWorkflow({
      description,
      agentsDir: AGENTS_DIR,
      llmConfig: buildLLMConfig(provider),
      pinnedRoles: roles.map(String),
      outputName: trimmedName,
      saveDir: COMPOSED_DIR,
      lang: 'zh',
    });
    res.json({ file: result.savedPath, yaml: result.yaml, warnings: result.warnings || [] });
  } catch (err) {
    console.log('[compose] error', err?.message);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// ── Save an edited / manually assembled workflow YAML into the user dir ──
app.post('/api/workflows/save', (req, res) => {
  const { name, yaml: yamlText } = req.body || {};
  if (!yamlText || typeof yamlText !== 'string') return res.status(400).json({ error: 'yaml required' });
  let doc;
  try { doc = yaml.load(yamlText); } catch (e) { return res.status(400).json({ error: 'invalid YAML: ' + e.message }); }
  if (!doc || !Array.isArray(doc.steps) || doc.steps.length === 0) {
    return res.status(400).json({ error: 'YAML must contain a non-empty steps array' });
  }
  const safe = String(name || doc.name || 'workflow')
    .replace(/[^一-鿿a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workflow';
  mkdirSync(COMPOSED_DIR, { recursive: true });
  let file = join(COMPOSED_DIR, `${safe}.yaml`);
  let i = 2;
  while (existsSync(file)) { file = join(COMPOSED_DIR, `${safe}-${i}.yaml`); i++; }
  if (!isInside(file, COMPOSED_DIR)) return res.status(400).json({ error: 'bad path' });
  writeFileSync(file, yamlText.endsWith('\n') ? yamlText : yamlText + '\n', 'utf-8');
  res.json({ file });
});

// ── Key config: report which providers have a key (never returns the key) ──
app.get('/api/config', (_req, res) => {
  const saved = readKeys();
  const providers = {};
  for (const [provider, cfg] of Object.entries(KEY_ENV)) {
    providers[provider] = {
      hasKey: !!(saved[provider]?.apiKey || process.env[cfg.key]),
      fromEnv: !saved[provider]?.apiKey && !!process.env[cfg.key],
      baseUrl: saved[provider]?.baseUrl || (cfg.base ? process.env[cfg.base] : '') || '',
      supportsBaseUrl: !!cfg.base,
    };
  }
  res.json({ providers, defaultProvider: process.env.AO_PROVIDER || 'deepseek' });
});

app.post('/api/config', (req, res) => {
  const { provider, apiKey, baseUrl } = req.body || {};
  if (!provider || !KEY_ENV[provider]) return res.status(400).json({ error: 'unknown provider' });
  const saved = readKeys();
  const cfg = KEY_ENV[provider];
  if (typeof apiKey === 'string' && apiKey.trim() === '' && baseUrl == null) {
    // explicit clear
    delete saved[provider];
    delete process.env[cfg.key];
    if (cfg.base) delete process.env[cfg.base];
  } else {
    saved[provider] = saved[provider] || {};
    if (typeof apiKey === 'string' && apiKey.trim()) saved[provider].apiKey = apiKey.trim();
    if (typeof baseUrl === 'string') saved[provider].baseUrl = baseUrl.trim();
  }
  writeKeys(saved);
  applyKeys(saved);
  res.json({ ok: true });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, version: PKG_VERSION }));

// SPA fallback: serve the React app for any non-API, non-asset route.
if (HAS_NEW_UI) {
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(join(WEBSITE_DIST, 'index.html'));
  });
}

app.listen(PORT, HOST, () => {
  const ui = HAS_NEW_UI ? 'Web Studio' : 'web UI (legacy)';
  console.log(`🌐 agency-orchestrator ${ui}: http://${HOST}:${PORT}`);
});

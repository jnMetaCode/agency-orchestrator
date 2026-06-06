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
// Writable data dir. In dev this is the repo root; in the packaged desktop app
// the bundle is read-only, so the Electron shell passes AO_DATA_DIR (userData)
// and we redirect all writes (outputs, composed workflows, keys) there.
const DATA_DIR = process.env.AO_DATA_DIR ? resolve(process.env.AO_DATA_DIR) : ROOT;
// User-composed / saved workflows (gitignored). Always writable & runnable.
const COMPOSED_DIR = join(DATA_DIR, 'ao-workflows');
const AGENTS_DIR = join(ROOT, 'node_modules', 'agency-agents-zh');
const OUTPUT_DIR = join(DATA_DIR, 'ao-output');
const CLI = join(ROOT, 'dist', 'cli.js');
// Node binary used to spawn the engine. Plain `node` normally; in the packaged
// Electron app there is no `node` on PATH, so the desktop shell passes AO_NODE
// (Electron's own binary, run with ELECTRON_RUN_AS_NODE=1 inherited via env).
const NODE_BIN = process.env.AO_NODE || 'node';
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

const CLI_PROVIDERS = ['claude-code', 'gemini-cli', 'copilot-cli', 'codex-cli', 'openclaw-cli', 'hermes-cli'];
// LLM config: provider + (model/base_url where the runtime needs them). Reads any
// per-provider overrides the user saved in the Studio (model name, custom base_url).
// Already YAML-safe (no undefined fields) — used for compose, run args and run-role.
function buildLLMConfig(provider) {
  const p = provider || process.env.AO_PROVIDER || 'deepseek';
  const cfg = { provider: p, max_tokens: 4096 };
  if (CLI_PROVIDERS.includes(p)) return cfg; // local CLI: no model/key/base needed
  let saved = {};
  try { saved = readKeys()[p] || {}; } catch {}
  const defModel = p === 'deepseek' ? 'deepseek-chat'
    : p === 'claude' ? 'claude-sonnet-4-20250514'
    : p === 'openai' ? 'gpt-4o'
    : undefined; // ollama / custom: model must come from saved config
  const model = saved.model || defModel;
  if (model) cfg.model = model;
  const defBase = p === 'ollama' ? (saved.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434') : undefined;
  const base = saved.baseUrl || defBase;
  if (base) cfg.base_url = base;
  return cfg;
}
const cleanLLMConfig = buildLLMConfig;
const isAllowedWorkflow = (file) => ALLOWED_WORKFLOW_DIRS.some(d => isInside(file, d));

// ── API key management (local-only) ──────────────────────────────────────────
// Keys pasted in the Studio UI are stored in .local/ (gitignored) and injected
// into this server's process.env. That way BOTH spawned `ao` processes (they
// inherit env) and the in-process compose (factory reads process.env) pick them
// up — no per-call wiring needed. Keys never leave this machine.
const KEYS_FILE = join(DATA_DIR, '.local', 'web-keys.json');
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
  if (obj.ollama?.baseUrl) process.env.OLLAMA_BASE_URL = obj.ollama.baseUrl;
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
  const { file, inputs, provider, resume, fromStep, feedback } = req.body || {};
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
    // A bare --provider override clears the YAML model/base → supply them so
    // keyed providers (deepseek/openai), ollama and custom endpoints all work.
    const llm = cleanLLMConfig(provider);
    if (llm.model) args.push('--model', llm.model);
    if (llm.base_url) args.push('--base-url', llm.base_url);
  }
  if (resume) {
    args.push('--resume', resume === true ? 'last' : resume);
    if (fromStep) args.push('--from', fromStep);
  }
  // 对话式返工：把某一步的修改意见交回给该专家在原稿基础上重做。
  // --feedback 在 CLI 侧会自动隐含 --resume last（未显式 resume 时），并要求 --from。
  if (feedback && typeof feedback === 'string' && feedback.trim()) {
    if (fromStep && !resume) args.push('--from', fromStep);
    args.push('--feedback', feedback);
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

  console.log('[run]', NODE_BIN, args.join(' '));
  const child = spawn(NODE_BIN, args, {
    cwd: DATA_DIR,
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
  const child = spawn(NODE_BIN, args, { cwd: DATA_DIR, env: { ...process.env, FORCE_COLOR: '0' } });

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

// ── Usage / cost stats: aggregate token usage from ao-output metadata ──
app.get('/api/usage', (_req, res) => {
  const byDay = {};
  const byRole = {};
  let totalRuns = 0, totalInput = 0, totalOutput = 0, firstDate = null, lastDate = null;
  try {
    if (existsSync(OUTPUT_DIR)) {
      for (const d of readdirSync(OUTPUT_DIR, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const metaPath = join(OUTPUT_DIR, d.name, 'metadata.json');
        if (!existsSync(metaPath)) continue;
        let m;
        try { m = JSON.parse(readFileSync(metaPath, 'utf-8')); } catch { continue; }
        const inTok = m?.totalTokens?.input || 0;
        const outTok = m?.totalTokens?.output || 0;
        totalRuns++; totalInput += inTok; totalOutput += outTok;
        const dm = d.name.match(/(\d{4}-\d{2}-\d{2})T\d{2}-\d{2}-\d{2}$/);
        let day;
        try { day = dm ? dm[1] : new Date(statSync(metaPath).mtimeMs).toISOString().slice(0, 10); }
        catch { day = '未知'; }
        if (!byDay[day]) byDay[day] = { date: day, input: 0, output: 0, runs: 0 };
        byDay[day].input += inTok; byDay[day].output += outTok; byDay[day].runs++;
        if (day !== '未知') {
          if (!firstDate || day < firstDate) firstDate = day;
          if (!lastDate || day > lastDate) lastDate = day;
        }
        for (const s of (m.steps || [])) {
          const role = s.role || s.id;
          if (!byRole[role]) byRole[role] = { role, name: s.agentName || role, runs: 0, input: 0, output: 0 };
          byRole[role].runs++;
          byRole[role].input += s?.tokens?.input || 0;
          byRole[role].output += s?.tokens?.output || 0;
        }
      }
    }
  } catch (e) { return res.status(500).json({ error: e?.message || String(e) }); }
  res.json({
    totalRuns, totalInput, totalOutput, totalTokens: totalInput + totalOutput,
    byDay: Object.values(byDay).sort((a, b) => (a.date < b.date ? -1 : 1)),
    byRole: Object.values(byRole).sort((a, b) => (b.input + b.output) - (a.input + a.output)).slice(0, 12),
    firstDate, lastDate,
  });
});

// ── Key config: report which providers have a key (never returns the key) ──
app.get('/api/config', (_req, res) => {
  const saved = readKeys();
  const providers = {};
  for (const [provider, cfg] of Object.entries(KEY_ENV)) {
    providers[provider] = {
      family: 'api',
      hasKey: !!(saved[provider]?.apiKey || process.env[cfg.key]),
      fromEnv: !saved[provider]?.apiKey && !!process.env[cfg.key],
      baseUrl: saved[provider]?.baseUrl || (cfg.base ? process.env[cfg.base] : '') || '',
      model: saved[provider]?.model || '',
      supportsBaseUrl: !!cfg.base,
    };
  }
  providers.ollama = {
    family: 'local',
    baseUrl: saved.ollama?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: saved.ollama?.model || '',
    configured: !!saved.ollama?.model,
  };
  res.json({ providers, cli: CLI_PROVIDERS, defaultProvider: process.env.AO_PROVIDER || 'deepseek' });
});

app.post('/api/config', (req, res) => {
  const { provider, apiKey, baseUrl, model } = req.body || {};
  const isKeyed = !!KEY_ENV[provider];
  if (!provider || (!isKeyed && provider !== 'ollama')) return res.status(400).json({ error: 'unknown provider' });
  const saved = readKeys();
  // explicit clear (empty apiKey for keyed / empty model for ollama, nothing else)
  const clearing = isKeyed
    ? (typeof apiKey === 'string' && apiKey.trim() === '' && baseUrl == null && model == null)
    : (typeof model === 'string' && model.trim() === '' && baseUrl == null);
  if (clearing) {
    delete saved[provider];
    if (isKeyed) { delete process.env[KEY_ENV[provider].key]; if (KEY_ENV[provider].base) delete process.env[KEY_ENV[provider].base]; }
    else delete process.env.OLLAMA_BASE_URL;
  } else {
    saved[provider] = saved[provider] || {};
    if (typeof apiKey === 'string' && apiKey.trim()) saved[provider].apiKey = apiKey.trim();
    if (typeof baseUrl === 'string') saved[provider].baseUrl = baseUrl.trim();
    if (typeof model === 'string') saved[provider].model = model.trim();
  }
  writeKeys(saved);
  applyKeys(saved);
  res.json({ ok: true });
});

// ── Test a provider's key with a minimal real API call ──
app.post('/api/test-provider', async (req, res) => {
  const { provider } = req.body || {};
  if (!provider || (!KEY_ENV[provider] && provider !== 'ollama')) return res.status(400).json({ ok: false, error: 'unknown provider' });
  const key = provider === 'ollama' ? 'n/a' : process.env[KEY_ENV[provider].key];
  if (!key) return res.json({ ok: false, error: '未设置 API key' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  const t0 = Date.now();
  try {
    if (provider === 'ollama') {
      const base = (readKeys().ollama?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
      const r = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
      if (!r.ok) return res.json({ ok: false, error: `HTTP ${r.status}` });
      const j = await r.json().catch(() => ({}));
      const n = Array.isArray(j.models) ? j.models.length : 0;
      return res.json({ ok: true, latencyMs: Date.now() - t0, note: `${n} 个本地模型` });
    }
    let r;
    if (provider === 'claude') {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-3-5-haiku-20241022', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
    } else {
      const saved = readKeys()[provider] || {};
      const base = (provider === 'deepseek'
        ? (saved.baseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1')
        : (saved.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')).replace(/\/$/, '');
      const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';
      r = await fetch(`${base}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
    }
    const latencyMs = Date.now() - t0;
    if (!r.ok) {
      const txt = (await r.text().catch(() => '')).slice(0, 200);
      return res.json({ ok: false, error: `HTTP ${r.status} ${txt}` });
    }
    return res.json({ ok: true, latencyMs });
  } catch (e) {
    return res.json({ ok: false, error: e?.name === 'AbortError' ? '超时（12s）' : (e?.message || String(e)) });
  } finally {
    clearTimeout(timer);
  }
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

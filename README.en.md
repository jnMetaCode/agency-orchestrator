# Agency Orchestrator

**English** | [中文](./README.md)

> **Multi-agent workflows in YAML — 186 ready-to-use AI roles, zero code required**

[![CI](https://github.com/jnMetaCode/agency-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/jnMetaCode/agency-orchestrator/actions)
[![npm version](https://img.shields.io/npm/v/agency-orchestrator)](https://www.npmjs.com/package/agency-orchestrator)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

> If you find this useful, please give it a **Star** — it helps others discover this project and motivates continued development.

---

## What Is This?

A lightweight engine that orchestrates multiple AI agents to collaborate on complex tasks. You define the workflow in YAML — which roles, what tasks, what order — and the engine handles parallel execution, variable passing, retries, and output management.

**No Python. No framework boilerplate. Just YAML.**

```yaml
steps:
  - id: analyze
    role: "product/product-manager"          # 186 built-in roles
    task: "Analyze this PRD:\n\n{{prd_content}}"
    output: requirements

  - id: tech_review
    role: "engineering/engineering-software-architect"
    task: "Evaluate feasibility:\n\n{{requirements}}"
    depends_on: [analyze]                    # auto DAG detection
```

### vs CrewAI / LangGraph

| | CrewAI | LangGraph | **Agency Orchestrator** |
|---|--------|-----------|---------------------|
| Language | Python | Python | **YAML (zero code)** |
| Roles | Write your own | Write your own | **186 ready-to-use** |
| Dependencies | pip + LiteLLM + dozens | pip + LangChain | **npm + 2 deps** |
| Models | LiteLLM | LangChain | **Native: DeepSeek, Claude, OpenAI, Ollama** |
| Parallelism | Manager mode | Manual graph | **Auto DAG detection** |
| Branching | None | Manual | **Condition expressions** |
| Loops | None | Manual | **Declarative loop/exit** |
| Resume | None | Checkpointers | **Built-in `--resume` + `--from`** |
| Price | Open-source + $25-99/mo cloud | Open-source | **Completely free** |

## Quick Start

### Fastest: Zero-Config Demo

```bash
npx agency-orchestrator demo
```

See 4 AI roles collaborate on a story in 5 seconds — no API key needed. Then optionally run with a real LLM.

### Option A: Inside Any AI Coding Tool (No API key needed)

Your AI coding tool's built-in LLM serves as the execution engine:

```bash
git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git

# Auto-detect and install workflow-runner for your tools
./scripts/install.sh                       # auto-detect
./scripts/install.sh --tool cursor         # or specify
```

Then tell your AI: `Run workflows/story-creation.yaml with premise="A time travel story"`

### Option B: CLI Mode (API key required)

```bash
npm install agency-orchestrator
npx ao init                    # download 186 AI roles
export DEEPSEEK_API_KEY=your-key
npx ao run workflows/story-creation.yaml --input premise="A time travel story"
```

## Demo: 4 AI Roles Write a Complete Story in 2 Minutes

```
$ ao run workflows/story-creation.yaml -i "premise=A programmer discovers AI replies with things it shouldn't know"

  Workflow: Short Story Creation
  Steps: 4 | Concurrency: 2 | Model: deepseek-chat
──────────────────────────────────────────────────

  ── [1/4] story_structure (Narratologist) ──
  Done | 14.9s | 1,919 tokens

  ── [2/4] character_design (Psychologist) ──            ← parallel
  Done | 65.5s | 4,016 tokens

  ── [3/4] conflict_design (Narrative Designer) ──       ← parallel
  Done | 65.5s | 3,607 tokens

  ── [4/4] write_story (Content Creator) ──
  Done | 33.9s | 5,330 tokens

==================================================
  Completed: 4/4 steps | 114.3s | 14,872 tokens
==================================================
```

Steps 2 and 3 run **in parallel** (auto-detected from DAG dependencies). Four specialized AI roles collaborate to produce a complete suspense short story.

## How It Works

```yaml
name: "Product Requirements Review"
agents_dir: "agency-agents-zh"

llm:
  provider: "deepseek"       # or: claude, openai, ollama
  model: "deepseek-chat"

concurrency: 2

inputs:
  - name: prd_content
    required: true

steps:
  - id: analyze
    role: "product/product-manager"
    task: "Analyze this PRD and extract core requirements:\n\n{{prd_content}}"
    output: requirements

  - id: tech_review
    role: "engineering/engineering-software-architect"
    task: "Evaluate technical feasibility:\n\n{{requirements}}"
    output: tech_report
    depends_on: [analyze]

  - id: design_review
    role: "design/design-ux-researcher"
    task: "Evaluate UX risks:\n\n{{requirements}}"
    output: design_report
    depends_on: [analyze]

  - id: summary
    role: "product/product-manager"
    task: "Synthesize feedback:\n\n{{tech_report}}\n\n{{design_report}}"
    depends_on: [tech_review, design_review]
```

The engine automatically:
1. Parses YAML → builds a **DAG** (directed acyclic graph)
2. Detects parallelism — `tech_review` and `design_review` run concurrently
3. Passes outputs between steps via `{{variables}}`
4. Loads role definitions from [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) as system prompts
5. Retries on failure (exponential backoff)
6. Saves all outputs to `ao-output/`

```
analyze ──→ tech_review  ──→ summary
         └→ design_review ──┘
          (parallel)
```

## Features

### AI Workflow Composer

Describe your workflow in one sentence — AI selects the right roles, designs the DAG, and generates a ready-to-run YAML:

```bash
ao compose "PR code review covering security and performance"
```

The AI will:
1. Select matching roles from 186 available (e.g., Code Reviewer, Security Engineer, Performance Benchmarker)
2. Design the DAG (3-way parallel → summary)
3. Generate complete YAML with variable passing and task descriptions
4. Save to `workflows/` — ready to `ao run`

Supports `--provider` and `--model` flags (default: DeepSeek).

### Condition Branching

```yaml
- id: tech_path
  role: "engineering/engineering-sre"
  task: "Technical evaluation: {{requirements}}"
  depends_on: [classify]
  condition: "{{job_type}} contains technical"

- id: biz_path
  role: "marketing/marketing-social-media-strategist"
  task: "Business evaluation: {{requirements}}"
  depends_on: [classify]
  condition: "{{job_type}} contains business"

- id: summary
  depends_on: [tech_path, biz_path]
  depends_on_mode: "any_completed"  # proceeds when ANY upstream completes
```

Supported operators: `contains`, `equals`, `not_contains`, `not_equals`.

### Loop Iteration

```yaml
- id: write_draft
  role: "marketing/marketing-content-creator"
  task: "Write article: {{topic}}"
  output: draft

- id: brand_review
  role: "design/design-brand-guardian"
  task: "Review brand compliance: {{draft}}"
  output: review_result
  depends_on: [write_draft]
  loop:
    back_to: write_draft
    max_iterations: 3
    exit_condition: "{{review_result}} contains approved"
```

When the exit condition is not met, execution loops back to `back_to`. The `{{_loop_iteration}}` variable tracks the current round.

### Resume & Iterate

**Problem**: After `ao run` completes, all step outputs are lost. To tweak the final story, you'd have to re-run everything from scratch.

**Solution**: `--resume` reloads previous outputs. `--from` specifies where to restart.

```bash
# Round 1: Normal run
ao run workflows/story-creation.yaml -i premise="A time travel story"

# Round 2: Characters feel flat — re-run from character_design
ao run workflows/story-creation.yaml --resume last --from character_design

# Round 3: Only rewrite the final prose
ao run workflows/story-creation.yaml --resume last --from write_story

# Round 4: Go back to a specific version
ao run workflows/story-creation.yaml --resume ao-output/<dir>/ --from write_story
```

Each round creates a new timestamped output directory. All versions are preserved.

| Scenario | Command |
|----------|---------|
| First run | `ao run workflow.yaml -i key=value` |
| Re-run from a step | `ao run workflow.yaml --resume last --from <step-id>` |
| Re-run only failed steps | `ao run workflow.yaml --resume last` |
| Resume specific version | `ao run workflow.yaml --resume ao-output/<dir>/ --from <step-id>` |

## Supported LLMs

| Provider | Config | Env Variable |
|----------|--------|-------------|
| **DeepSeek** | `provider: "deepseek"` | `DEEPSEEK_API_KEY` |
| **Claude** | `provider: "claude"` | `ANTHROPIC_API_KEY` |
| **OpenAI** | `provider: "openai"` | `OPENAI_API_KEY` |
| **Ollama** (local) | `provider: "ollama"` | None needed |

All providers support custom `base_url` and `api_key`, compatible with any OpenAI-compatible API (Zhipu, Moonshot, etc.).

## CLI Reference

```bash
ao demo                              # Zero-config multi-agent demo
ao init                              # Download 186 AI roles
ao init --workflow                    # Interactive workflow creator
ao compose "description"             # AI-powered workflow generation
ao run <workflow.yaml> [options]      # Execute workflow
ao validate <workflow.yaml>           # Validate without running
ao plan <workflow.yaml>               # Show execution plan (DAG)
ao explain <workflow.yaml>            # Explain execution plan in natural language
ao roles                             # List all available roles
ao serve                             # Start MCP Server (for Claude Code / Cursor)
```

| Option | Description |
|--------|-------------|
| `--input key=value` | Pass input variables |
| `--input key=@file` | Read variable value from file |
| `--output dir` | Output directory (default `ao-output/`) |
| `--resume <dir\|last>` | Resume from previous run |
| `--from <step-id>` | With `--resume`, restart from a specific step |
| `--watch` | Real-time terminal progress display |
| `--quiet` | Quiet mode |

## MCP Server Mode

AI coding tools (Claude Code, Cursor, etc.) can invoke workflow operations directly via the MCP protocol:

```bash
ao serve              # Start MCP stdio server
ao serve --verbose    # With debug logging
```

Claude Code (`settings.json`):

```json
{
  "mcpServers": {
    "agency-orchestrator": {
      "command": "npx",
      "args": ["agency-orchestrator", "serve"]
    }
  }
}
```

Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "agency-orchestrator": {
      "command": "npx",
      "args": ["agency-orchestrator", "serve"]
    }
  }
}
```

6 tools available: `run_workflow`, `validate_workflow`, `list_workflows`, `plan_workflow`, `compose_workflow`, `list_roles`.

## YAML Schema

### Workflow

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Workflow name |
| `agents_dir` | string | Yes | Path to role definitions directory |
| `llm.provider` | string | Yes | `claude` / `deepseek` / `openai` / `ollama` |
| `llm.model` | string | Yes | Model name |
| `llm.max_tokens` | number | No | Default 4096 |
| `llm.timeout` | number | No | Step timeout in ms (default 120000) |
| `llm.retry` | number | No | Retry count (default 3) |
| `concurrency` | number | No | Max parallel steps (default 2) |
| `inputs` | array | No | Input variable definitions |
| `steps` | array | Yes | Workflow steps |

### Step

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique step identifier |
| `role` | string | Yes | Role path (e.g. `"engineering/engineering-sre"`) |
| `task` | string | Yes | Task description, supports `{{variables}}` |
| `output` | string | No | Output variable name |
| `depends_on` | string[] | No | Dependent step IDs |
| `depends_on_mode` | string | No | `"all"` (default) or `"any_completed"` |
| `condition` | string | No | Condition expression; step skipped if not met |
| `type` | string | No | `"approval"` for human approval gate |
| `prompt` | string | No | Prompt text for approval nodes |
| `loop` | object | No | Loop config |
| `loop.back_to` | string | No | Step ID to loop back to |
| `loop.max_iterations` | number | No | Max loop rounds (1-10) |
| `loop.exit_condition` | string | No | Exit condition expression |

## Programmatic API

```typescript
import { run } from 'agency-orchestrator';

const result = await run('workflow.yaml', {
  prd_content: 'Your PRD here...',
});

console.log(result.success);     // true/false
console.log(result.totalTokens); // { input: 1234, output: 5678 }
```

## Integrations

Works with **14 AI coding tools** — install with one command:

```bash
./scripts/install.sh                       # auto-detect installed tools
./scripts/install.sh --tool copilot        # or specify one
```

| Tool | Config Location | Install Command | Docs |
|------|----------------|----------------|------|
| **Claude Code** | Skill mode | `npx superpowers-zh` | [Guide](./integrations/claude-code/) |
| **GitHub Copilot** | `.github/copilot-instructions.md` | `--tool copilot` | [Guide](./integrations/copilot/) |
| **Cursor** | `.cursor/rules/` | `--tool cursor` | [Guide](./integrations/cursor/) |
| **Windsurf** | `.windsurfrules` | `--tool windsurf` | [Guide](./integrations/windsurf/) |
| **Kiro** | `.kiro/steering/` | `--tool kiro` | [Guide](./integrations/kiro/) |
| **Trae** | `.trae/rules/` | `--tool trae` | [Guide](./integrations/trae/) |
| **Aider** | `CONVENTIONS.md` | `--tool aider` | [Guide](./integrations/aider/) |
| **Gemini CLI** | `GEMINI.md` | `--tool gemini-cli` | [Guide](./integrations/gemini-cli/) |
| **Codex CLI** | `.codex/instructions.md` | `--tool codex` | [Guide](./integrations/codex/) |
| **OpenCode** | `.opencode/instructions.md` | `--tool opencode` | [Guide](./integrations/opencode/) |
| **Qwen Code** | `.qwen/rules/` | `--tool qwen` | [Guide](./integrations/qwen/) |
| **DeerFlow 2.0** | `skills/custom/` | `--tool deerflow` | [Guide](./integrations/deerflow/) |
| **Antigravity** | `AGENTS.md` | `--tool antigravity` | [Guide](./integrations/antigravity/) |
| **OpenClaw** | Skill mode | `--tool openclaw` | [Guide](./integrations/openclaw/) |

## Workflow Templates (20+)

### Dev Workflows

| Template | Roles | Description |
|----------|-------|-------------|
| `dev/pr-review.yaml` | Code Reviewer, Security Engineer, Performance Benchmarker | PR review (3-way parallel → summary) |
| `dev/tech-debt-audit.yaml` | Architect, Code Reviewer, Test Analyst, Sprint Prioritizer | Tech debt audit (parallel → prioritize) |
| `dev/api-doc-gen.yaml` | Tech Writer, API Tester | API doc generation (analyze → validate → finalize) |
| `dev/readme-i18n.yaml` | Content Creator, Tech Writer | README internationalization |
| `dev/security-audit.yaml` | Security Engineer, Threat Detection Engineer | Security audit (parallel → report) |
| `dev/release-checklist.yaml` | SRE, Performance Benchmarker, Security Engineer, PM | Release Go/No-Go decision |

### Data / Design / Ops Workflows

| Template | Roles | Description |
|----------|-------|-------------|
| `data/data-pipeline-review.yaml` | Data Engineer, DB Optimizer, Data Analyst | Data pipeline review |
| `data/dashboard-design.yaml` | Data Analyst, UX Researcher, UI Designer | Dashboard design |
| `design/requirement-to-plan.yaml` | PM, Architect, Project Manager | Requirements → tech design → task breakdown |
| `design/ux-review.yaml` | UX Researcher, Accessibility Auditor, UX Architect | UX review |
| `ops/incident-postmortem.yaml` | Incident Commander, SRE, PM | Incident postmortem |
| `ops/sre-health-check.yaml` | SRE, Performance Benchmarker, Infra Ops | SRE health check (3-way parallel) |

### General Workflows

| Template | Roles | Description |
|----------|-------|-------------|
| `product-review.yaml` | PM, Architect, UX Researcher | Product requirements review |
| `content-pipeline.yaml` | Strategist, Creator, Growth Hacker | Content creation pipeline |
| `story-creation.yaml` | Narratologist, Psychologist, Narrative Designer, Creator | Collaborative fiction (4 roles) |
| `department-collab/code-review.yaml` | Code Reviewer, Security Engineer | Code review (review loop) |
| `department-collab/hiring-pipeline.yaml` | HR, Tech Interviewer, Biz Interviewer | Hiring pipeline |
| `department-collab/content-publish.yaml` | Content Creator, Brand Guardian | Content publishing (review loop) |
| `department-collab/incident-response.yaml` | SRE, Security Engineer, Backend Architect | Incident response |
| `department-collab/marketing-campaign.yaml` | Strategist, Creator, Approver | Marketing campaign (human approval) |

## Output Structure

Each run saves to `ao-output/<name>-<timestamp>/`:

```
ao-output/product-review-2026-03-22/
├── summary.md          # Final step output
├── steps/
│   ├── 1-analyze.md
│   ├── 2-tech_review.md
│   ├── 3-design_review.md
│   └── 4-summary.md
└── metadata.json       # Timing, token usage, step states
```

## Ecosystem

| Project | Description |
|---------|-------------|
| [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) | 186 AI role definitions — the role library for this engine |
| [superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) | AI coding superpowers — 20 skills for Claude Code / Cursor |
| [shellward](https://github.com/jnMetaCode/shellward) | AI agent security middleware — prompt injection detection, DLP, command safety |

## Roadmap

- [x] **v0.1** — YAML workflows, DAG engine, 4 LLM connectors, CLI, streaming output
- [x] **v0.2** — Condition branching, loop iteration, human approval, Resume, 5 department-collab templates
- [x] **v0.3** — 9 AI tool integrations, 20+ workflow templates, `ao explain`, `ao init --workflow`, `--watch` mode
- [x] **v0.4** — MCP Server mode (`ao serve`), 14 AI tool integrations, one-command installer
- [ ] **v0.5** — Web UI, visual DAG editor, English role support, workflow marketplace

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome!

## License

[Apache-2.0](./LICENSE)

# Agency Orchestrator

**English** | [中文](./README.md)

> **One sentence in, a full plan out — multiple AI roles collaborate automatically.**

[![CI](https://github.com/jnMetaCode/agency-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/jnMetaCode/agency-orchestrator/actions)
[![npm version](https://img.shields.io/npm/v/agency-orchestrator)](https://www.npmjs.com/package/agency-orchestrator)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

**One sentence → full plan · 179 expert AI roles · Zero-code YAML · 9 LLM providers · 6 need no API key**

> **Note:** `ao compose --run` auto-detects your language. For English input, it uses [agency-agents](https://github.com/msitarzewski/agency-agents) (217 English roles). Use `ao init --lang en` to download the English role library. The 32 built-in workflow templates are currently in Chinese — English templates coming in v0.6.

> If you find this useful, please **Star** it — helps others discover the project.

<p align="center">
  <img src="./demo.gif" alt="ao compose --run demo" width="700">
</p>

---

## One Sentence, Full Result

```bash
ao compose "I'm a programmer looking to start a side hustle with AI content, target $3K/month, give me a complete plan" --run
```

5 AI roles collaborate automatically:

```
  Workflow: Programmer AI Side Hustle Plan
  Steps: 5 | Model: claude-code
  Roles: 🔭 Trend Researcher | 📱 Platform Analyst | 💰 Financial Planner | ✍️ Content Strategist | 📋 Execution Planner
──────────────────────────────────────────────────

  ✅ 🔭 Trend Researcher   31.3s  → 6 niches compared by competition/ceiling/AI leverage
  ✅ 📱 Platform Analyst    32.0s  → 6 platforms scored, recommends "YouTube + Newsletter" combo
  ✅ 💰 Financial Planner   31.8s  → $3K/mo breakdown: course $1,800 + community $600 + consulting $600
  ✅ ✍️ Content Strategist   44.6s  → 20 topics + 4 headline formulas + content SOP
  ✅ 📋 Execution Planner   42.2s  → 90-day action plan, day-by-day

==================================================
  Done: 5/5 steps | 182.1s | 6,493 tokens
==================================================
```

**No code. No config. No role selection.** One sentence → AI auto-decomposes the task → matches roles from 179 experts → executes as DAG → outputs a complete plan.

### What Can You Build

```bash
ao compose "Analyze the feasibility of building an AI budgeting app" --run        # Startup feasibility
ao compose "Compare Cursor, Windsurf, and Copilot — give me a recommendation" --run  # Tech comparison
ao compose "Write a deep-dive article on AI Agent trends" --run                    # Long-form writing
ao compose "Plan an AI education startup with $15K budget" --run                   # Business plan
ao compose "PR code review covering security and performance" --run                # Code review
ao compose "Design a pricing strategy for a SaaS product" --run                    # Pricing analysis
```

Each scenario auto-matches a different combination of AI roles.

---

## Why Agency Orchestrator

Chatting with one AI gives you one perspective. But any real decision needs product, engineering, finance, and marketing perspectives...

**Agency Orchestrator = multiple AI experts working in parallel, then synthesized. One person vs. a whole team.**

| | ChatGPT / Claude | CrewAI / LangGraph | **Agency Orchestrator** |
|---|--------|-----------|---------------------|
| Roles | 1 generalist | Write your own | **179 expert roles** |
| Usage | Chat | Write Python | **One sentence / YAML** |
| API key | — | Required | **6 providers need none** |
| Dependencies | — | pip + dozens of packages | **npm + 2 deps** |
| Parallelism | — | Manual graph | **Auto DAG detection** |
| Price | Subscription | Open-source + API fees | **Completely free** |

## Get Started in 3 Steps

### Step 1: Install

```bash
npm install -g agency-orchestrator
```

### Step 2: One sentence, go

```bash
# Use your existing Claude subscription (no API key needed)
ao compose "Analyze the feasibility of building an AI budgeting app" --run --provider claude-code

# Or use DeepSeek ($2 lasts forever)
export DEEPSEEK_API_KEY="your-key"
ao compose "Analyze the feasibility of building an AI budgeting app" --run
```

### Step 3: Use built-in templates or integrate with AI coding tools

```bash
# 32 built-in workflow templates
ao run workflows/一人公司全员大会.yaml --input idea="AI-powered resume builder for job seekers"
ao run workflows/dev/pr-review.yaml --input code=@src/main.ts
ao run workflows/story-creation.yaml -i premise="A programmer discovers AI knows things it shouldn't"
```

Also works inside Cursor / Claude Code — just say "run a workflow." Supports **14 AI coding tools** ([integration guides](./integrations/)).

## More Real Demos

```
$ ao compose "Analyze startup opportunities in short-form video" --run

  Workflow: Short-Form Video Startup Opportunity Analysis
  Steps: 6 | Concurrency: 2 | Model: deepseek-chat
  Roles: 👔 CEO | 📊 Market Researcher | 🔍 User Researcher | 🧭 Product Manager | 📣 Marketing Lead | 💰 CFO
──────────────────────────────────────────────────

  ✅ 👔 CEO              12.7s   → Strategic direction & target user positioning
  ✅ 📊 Market Researcher 45.2s   → 700M DAU data, competitive landscape analysis
  ✅ 🔍 User Researcher   38.1s   → User personas, pain points, willingness to pay
  ✅ 🧭 Product Manager   41.3s   → MVP feature list, content matrix, monetization paths
  ✅ 📣 Marketing Lead    35.6s   → Cold start plan, ad strategy, user funnel
  ✅ 💰 CFO              28.4s   → $200K startup, $550K first-year revenue, break-even analysis

==================================================
  Done: 6/6 steps | 233.0s | 65,191 tokens
==================================================
```

Of the 6 roles, Market Researcher and User Researcher **run in parallel** (auto-detected from DAG dependencies).

## How It Works

```yaml
name: "Product Requirements Review"
agents_dir: "agency-agents-zh"

llm:
  provider: "deepseek"          # No API key: claude-code / gemini-cli / copilot-cli / codex-cli / ollama
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

## 9 LLM Providers — 6 Need No API Key

**Already paying for one of these? You're ready to go:**

| You have... | Provider config | Install CLI | Cost to you |
|------------|----------------|-------------|-------------|
| Claude Max/Pro ($20/mo) | `provider: "claude-code"` | `npm i -g @anthropic-ai/claude-code` | **$0 extra** |
| Google Account | `provider: "gemini-cli"` | `npm i -g @google/gemini-cli` | **Free** (1000 req/day, Gemini 2.5 Pro) |
| GitHub Copilot ($10/mo) | `provider: "copilot-cli"` | `npm i -g @github/copilot` | **$0 extra** |
| ChatGPT Plus/Pro ($20/mo) | `provider: "codex-cli"` | `npm i -g @openai/codex` | **$0 extra** |
| OpenClaw account | `provider: "openclaw-cli"` | `npm i -g openclaw` | **$0 extra** |
| A computer | `provider: "ollama"` | [ollama.ai](https://ollama.ai) | **Free** (local models) |

**Or use traditional API keys:**

| Provider | Config | Env Variable |
|----------|--------|-------------|
| DeepSeek | `provider: "deepseek"` | `DEEPSEEK_API_KEY` |
| Claude API | `provider: "claude"` | `ANTHROPIC_API_KEY` |
| OpenAI | `provider: "openai"` | `OPENAI_API_KEY` |

All API providers support custom `base_url` and `api_key`, compatible with any OpenAI-compatible API.

## CLI Reference

```bash
ao demo                              # Zero-config multi-agent demo
ao init                              # Download 179 Chinese AI roles
ao init --lang en                    # Download 217 English AI roles
ao init --workflow                    # Interactive workflow creator
ao compose "description"             # AI-powered workflow generation
ao compose "description" --run       # Generate AND execute in one command
ao run <workflow.yaml> [options]      # Execute workflow
ao validate <workflow.yaml>          # Validate without running
ao plan <workflow.yaml>              # Show execution plan (DAG)
ao explain <workflow.yaml>           # Explain execution plan in natural language
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

### AI Workflow Composer

Describe your workflow in one sentence — AI selects the right roles, designs the DAG, and generates a ready-to-run YAML:

```bash
ao compose "PR code review covering security and performance"
```

The AI will:
1. Select matching roles from 179 available (e.g., Code Reviewer, Security Engineer, Performance Benchmarker)
2. Design the DAG (3-way parallel → summary)
3. Generate complete YAML with variable passing and task descriptions
4. Save to `workflows/` — ready to `ao run`

Add `--run` to generate and execute in one command. Supports `--provider` and `--model` flags (default: DeepSeek).

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
| `llm.provider` | string | Yes | `claude-code` / `gemini-cli` / `copilot-cli` / `codex-cli` / `openclaw-cli` / `ollama` / `claude` / `deepseek` / `openai` |
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

## Workflow Templates (32)

### Dev Workflows (7)

| Template | Roles | Description |
|----------|-------|-------------|
| `dev/tech-design-review.yaml` | Architect, Backend Architect, Security Engineer, Code Reviewer | **Tech design review** (design → parallel review → verdict) |
| `dev/pr-review.yaml` | Code Reviewer, Security Engineer, Performance Benchmarker | PR review (3-way parallel → summary) |
| `dev/tech-debt-audit.yaml` | Architect, Code Reviewer, Test Analyst, Sprint Prioritizer | Tech debt audit (parallel → prioritize) |
| `dev/api-doc-gen.yaml` | Tech Writer, API Tester | API doc generation (analyze → validate → finalize) |
| `dev/readme-i18n.yaml` | Content Creator, Tech Writer | README internationalization |
| `dev/security-audit.yaml` | Security Engineer, Threat Detection Engineer | Security audit (parallel → report) |
| `dev/release-checklist.yaml` | SRE, Performance Benchmarker, Security Engineer, PM | Release Go/No-Go decision |

### Marketing Workflows (3)

| Template | Roles | Description |
|----------|-------|-------------|
| `marketing/competitor-analysis.yaml` | Trend Researcher, Analyst, SEO Specialist, Executive Summary | **Competitor analysis** (research → parallel analysis → summary) |
| `marketing/xiaohongshu-content.yaml` | Xiaohongshu Expert, Creator, Visual Storyteller, Operator | **Xiaohongshu content** (topic → parallel creation → optimize) |
| `marketing/seo-content-matrix.yaml` | SEO Specialist, Strategist, Content Creator | **SEO content matrix** (keywords → strategy → batch generate → review) |

### Data / Design / Ops Workflows (7)

| Template | Roles | Description |
|----------|-------|-------------|
| `data/data-pipeline-review.yaml` | Data Engineer, DB Optimizer, Data Analyst | Data pipeline review |
| `data/dashboard-design.yaml` | Data Analyst, UX Researcher, UI Designer | Dashboard design |
| `design/requirement-to-plan.yaml` | PM, Architect, Project Manager | Requirements → tech design → task breakdown |
| `design/ux-review.yaml` | UX Researcher, Accessibility Auditor, UX Architect | UX review |
| `ops/incident-postmortem.yaml` | Incident Commander, SRE, PM | Incident postmortem |
| `ops/sre-health-check.yaml` | SRE, Performance Benchmarker, Infra Ops | SRE health check (3-way parallel) |
| `ops/weekly-report.yaml` | Meeting Assistant, Content Creator, Executive Summary | **Weekly/monthly report** (organize → highlights → finalize) |

### Strategy / Legal / HR Workflows (3)

| Template | Roles | Description |
|----------|-------|-------------|
| `strategy/business-plan.yaml` | Trend Researcher, Financial Forecaster, PM, Executive Summary | **Business plan** (market → parallel analysis → integrate) |
| `legal/contract-review.yaml` | Contract Reviewer, Legal Compliance | **Contract review** (clause analysis → compliance → opinion) |
| `hr/interview-questions.yaml` | Recruiter, Psychologist, Backend Architect | **Interview questions** (dimensions → parallel design → scorecard) |

### General Workflows (12)

| Template | Roles | Description |
|----------|-------|-------------|
| `product-review.yaml` | PM, Architect, UX Researcher | Product requirements review |
| `content-pipeline.yaml` | Strategist, Creator, Growth Hacker | Content creation pipeline |
| `story-creation.yaml` | Narratologist, Psychologist, Narrative Designer, Creator | Collaborative fiction (4 roles) |
| `ai-opinion-article.yaml` | Trend Researcher, Narrative Designer, Psychologist, Creator | AI opinion long-form article |
| `department-collab/code-review.yaml` | Code Reviewer, Security Engineer | Code review (review loop) |
| `department-collab/hiring-pipeline.yaml` | HR, Tech Interviewer, Biz Interviewer | Hiring pipeline |
| `department-collab/content-publish.yaml` | Content Creator, Brand Guardian | Content publishing (review loop) |
| `department-collab/incident-response.yaml` | SRE, Security Engineer, Backend Architect | Incident response |
| `department-collab/marketing-campaign.yaml` | Strategist, Creator, Approver | Marketing campaign (human approval) |
| `department-collab/ceo-org-delegation.yaml` | CEO, Engineering/Marketing/Product/HR Leads | **CEO org delegation** (decide → parallel depts → summary) |
| `一人公司全员大会.yaml` | CEO, Market Researcher, User Researcher, PM, Marketing Lead, CFO | **One-person company all-hands** (CEO → 6 depts parallel → decision) |
| `ai-startup-launch.yaml` | CEO, PM, Architect, Marketing Lead, Finance Advisor | **SaaS product launch decision** (CEO → 4 depts parallel → launch plan) |

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

```
Your AI subscription ──→ agency-orchestrator ──→ 396 expert roles collaborate ──→ quality output
                              │                  (179 Chinese + 217 English)
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
      14 AI Coding Tools    CLI Mode        MCP Server
      (Cursor/Claude Code   (automation/    (Claude Code/
       /Copilot/...)        CI/CD)          Cursor direct)
```

| Project | Description |
|---------|-------------|
| [agency-agents](https://github.com/msitarzewski/agency-agents) | 217 English AI role definitions by [@msitarzewski](https://github.com/msitarzewski) — the English role library for this engine |
| [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) | 179 Chinese AI role definitions — the Chinese role library for this engine |
| [ai-coding-guide](https://github.com/jnMetaCode/ai-coding-guide) | AI coding tools field guide — 66 Claude Code tips + 9 tools best practices + copyable config templates |
| [superpowers-zh](https://github.com/jnMetaCode/superpowers-zh) | AI coding superpowers — 20 skills for Claude Code / Cursor |
| [shellward](https://github.com/jnMetaCode/shellward) | AI agent security middleware — prompt injection detection, DLP, command safety |

## Roadmap

- [x] **v0.1** — YAML workflows, DAG engine, 4 LLM connectors, CLI, streaming output
- [x] **v0.2** — Condition branching, loop iteration, human approval, Resume, 5 department-collab templates
- [x] **v0.3** — 9 AI tool integrations, 20+ workflow templates, `ao explain`, `ao init --workflow`, `--watch` mode
- [x] **v0.4** — MCP Server mode (`ao serve`), 14 AI tool integrations, one-command installer, 32 workflow templates, **9 LLM providers (6 need no API key: Claude Code / Gemini / Copilot / Codex / OpenClaw / Ollama)**
- [x] **v0.5** — `ao compose --run` one-sentence-to-result, real-time streaming, smart retry (exponential backoff), per-step model override, agent identity
- [ ] **v0.6** — Web UI, visual DAG editor, English workflow templates, workflow marketplace

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome!

## License

[Apache-2.0](./LICENSE)

# `ao demo` + Polished Workflows — Design Spec

## Goal

Let users see multi-agent collaboration in action within 3 minutes of install, with zero configuration. Then guide them to run real workflows with their own LLM.

## Architecture

Two-phase demo command (`ao demo`) that first replays a mock workflow execution with pre-written content, then detects available LLMs and offers a real run. Alongside this, polish 3 flagship workflows (story-creation, pr-review, product-review) with optimized prompts and bundled example inputs.

## Scope

### In scope
- New `ao demo` CLI command with mock replay + LLM detection + optional real run
- New `src/cli/demo.ts` module
- `examples/` directory with sample inputs for 3 flagship workflows
- Prompt optimization for 3 flagship workflows
- CLI help text updates

### Out of scope
- Web UI
- New agent roles
- New tool integrations
- Core engine changes (exception: adding `llmOverride` option to `run()`)

---

## Part 1: `ao demo` Command

### User Flow

```
$ ao demo

  🎬 Agency Orchestrator Demo
  ──────────────────────────────────

  Phase 1: Mock Demo (no API key needed)

  Workflow: Short Story Creation
  Premise: "一个程序员发现 AI 的回复里有不该知道的事"
  Steps: 4 | Roles: Narratologist, Psychologist, Narrative Designer, Content Creator
  ──────────────────────────────────

  ── [1/4] story_structure (叙事学家) ──
  Done | 1.5s | mock

  ── [2/4] character_design (心理学家) ──        ← parallel
  ── [3/4] conflict_design (叙事设计师) ──       ← parallel
  Done | 2.0s | mock

  ── [4/4] write_story (内容创作者) ──
  Done | 1.5s | mock

  ══════════════════════════════════
  ✅ 4 roles collaborated | 5.0s
  ══════════════════════════════════

  📖 Story preview:
  ────────────
  (200-300 character pre-written story excerpt)

  ──────────────────────────────────
  Phase 2: Run with real AI?

  Detected:
    ✅ DEEPSEEK_API_KEY set
    ❌ Ollama not running
    ❌ OPENAI_API_KEY not set

  Run real version with DeepSeek? (y/N)
```

### Technical Design

#### New file: `src/cli/demo.ts`

**Exports:**
- `runDemo(): Promise<void>` — main entry point

**Internal structure:**
1. `printDemoHeader()` — prints workflow info
2. `replayMockSteps()` — simulates 4-step execution with delays
3. `detectAvailableLLMs()` — checks env vars + Ollama connection
4. `promptRealRun()` — asks user, then calls existing `run()` from `src/index.ts`

**Mock data:** Pre-written Chinese content for each of the 4 steps, embedded as string constants in `demo.ts`. Content should be high-quality — this is the first impression.

**Delays:**
- Step 1 (story_structure): 1.5s
- Steps 2+3 (character_design + conflict_design, parallel): 2.0s total
- Step 4 (write_story): 1.5s
- Total mock runtime: ~5 seconds

**LLM detection logic:**
1. Check `DEEPSEEK_API_KEY` env var → DeepSeek available
2. Check `ANTHROPIC_API_KEY` env var → Claude available
3. Check `OPENAI_API_KEY` env var → OpenAI available
4. HTTP GET `http://localhost:11434/api/tags` (Ollama health check, **2-second timeout**) → Ollama available
5. Present results with ✅/❌ indicators

**Workflow path resolution:**
- Resolve `workflows/story-creation.yaml` relative to the **package installation directory** using `import.meta.url`, not relative to `process.cwd()`. This ensures `ao demo` works whether the package is installed globally, locally, or run via npx.

**LLM provider override:**
- The bundled `story-creation.yaml` hardcodes `provider: "deepseek"`. When the user picks a different provider in Phase 2, the demo must override the LLM config at runtime.
- Add an optional `llmOverride?: Partial<LLMConfig>` parameter to the `run()` function options. This is a small, backward-compatible engine change that's also useful beyond the demo (e.g., `ao run workflow.yaml --provider claude`).

**Phase 2 interaction:**
- If `process.stdin.isTTY` is false (piped input, CI), skip Phase 2 and print: "Run `ao run workflows/story-creation.yaml` to try with a real LLM."
- If no LLM detected: show setup instructions and exit
- If one LLM detected: ask to run with that provider
- If multiple detected: let user pick
- User input: `readline` from Node built-ins for y/N prompt
- On "y": call `run()` with resolved workflow path, built-in premise, and `llmOverride` for the selected provider

#### CLI integration: `src/cli.ts`

- Add `case 'demo':` to main switch → `handleDemo()`
- Add `'demo'` to `knownCmds` array for typo detection
- Add demo to help text

---

## Part 2: 3 Polished Workflows

### Selection criteria
- Diverse audiences: creative (story), developer (PR review), PM (product review)
- All showcase DAG parallelism
- All already exist and work

### Workflow 1: `workflows/story-creation.yaml`

**Current state:** Working, 4 steps, premise input.

**Improvements:**
- Add default premise in workflow inputs (so it runs without `--input`)
- Optimize each step's `task` prompt for consistent, high-quality output
- Add `output: story` to the final `write_story` step (currently missing)
- Ensure output variable names are clear

### Workflow 2: `workflows/dev/pr-review.yaml`

**Current state:** 3-way parallel (code quality + security + performance) → summary.

**Improvements:**
- Optimize task prompts to produce structured output (score + issues + suggestions format)
- Add example input: `examples/sample-code-for-review.md` — a realistic code snippet with intentional issues

### Workflow 3: `workflows/product-review.yaml`

**Current state:** Analyze → tech review + design review (parallel) → summary.

**Improvements:**
- Optimize task prompts for actionable output
- Add example input: `examples/sample-prd.md` — a realistic PRD document

### New directory: `examples/`

```
examples/
├── sample-premise.txt              # Story premise for story-creation
├── sample-code-for-review.md       # Code snippet for pr-review
└── sample-prd.md                   # PRD document for product-review
```

Each example file should be realistic and demonstrate the workflow's value when used as input.

### README updates

After implementation, update both README.md and README.zh-CN.md:
- Add `ao demo` to Quick Start section (before current Option A/B)
- Add `ao demo` to CLI Reference
- Mention example inputs in workflow template table

---

## Testing

### Unit tests for `ao demo`
- `test/demo.ts`:
  - `detectAvailableLLMs()` returns correct results based on env vars
  - Mock replay completes without errors
  - LLM selection logic picks correct provider

### Existing tests
- Existing workflow tests (`test/e2e.ts`) already cover the 3 flagship workflows via MockConnector
- No changes needed to existing tests

---

## File Changes Summary

| Action | File |
|--------|------|
| Create | `src/cli/demo.ts` |
| Create | `examples/sample-premise.txt` |
| Create | `examples/sample-code-for-review.md` |
| Create | `examples/sample-prd.md` |
| Create | `test/demo.ts` |
| Modify | `src/cli.ts` (add demo command) |
| Modify | `src/index.ts` (add llmOverride option to run()) |
| Modify | `workflows/story-creation.yaml` (prompt optimization) |
| Modify | `workflows/dev/pr-review.yaml` (prompt optimization) |
| Modify | `workflows/product-review.yaml` (prompt optimization) |
| Modify | `README.md` (add ao demo) |
| Modify | `README.zh-CN.md` (add ao demo) |

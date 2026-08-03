# Agency Orchestrator — Project Context

This is a multi-agent workflow orchestrator. Users define AI collaboration workflows in YAML, and the engine executes them with automatic DAG parallelism, variable passing, and retry logic.

## Key Commands

```bash
ao run <workflow.yaml> [options]      # Execute workflow
ao run <workflow.yaml> --resume last --from <step-id>  # Re-run from a specific step
ao validate <workflow.yaml>           # Validate without running
ao plan <workflow.yaml>               # Show DAG execution plan
ao doctor [--fix] [--no-probe]        # Self-check provider/creds/endpoint reachability/CLI/system Claude Code; --fix repairs a hijacked ~/.claude (fake token / relay base_url); --no-probe skips the live endpoint probe (a 1-token request)
ao roles                              # List all 267 available roles
ao install --tool claude-code         # Install bundled roles into a coding tool (claude-code/cursor/copilot/gemini-cli/qwen/opencode); --lang zh|en, --category, --dry-run
ao run <workflow.yaml> --compare      # Run workflow + single-shot baseline + blind judge → side-by-side verdict (productized eval)
ao team save <workflow.yaml>          # Save a role line-up as a reusable team (Loadout)
ao team list / show / rm              # Manage saved teams (stored in ~/.ao/teams)
ao run --team <name> "task"           # Run a new task with a saved team (locked line-up)
ao prompt optimize "<prompt>"         # AI-optimize a prompt (--mode system|user, --save)
ao prompt test / list / show / rm / garden  # Prompt Lab: test / manage / starter templates
ao skills [name]                      # List / view methodology skills (superpowers-zh) for step `skill:`
```

## Skills (methodology playbooks)

A step can carry `skill: "<name>"` (or `skills: [..]`) — the methodology body is injected into that
step's system prompt at run time (`src/skills/loader.ts`, applied in `core/executor.ts`). Content
comes from the `superpowers-zh` dependency (`node_modules/superpowers-zh/skills/<name>/SKILL.md`);
override the source dir with `AO_SKILLS_DIR`. Missing skills are skipped (warn), never fatal.

## Prompt Lab

`src/cli/prompt.ts` — optimize (system/user meta-prompt that yields a *better prompt*, not the
answer), test (run a prompt on a sample), `scoreOutputs` (LLM judge ranks candidates). Stored as
`~/.ao/prompts/*.prompt.json` (override with `AO_PROMPTS_DIR`), shared between the `ao prompt` CLI
and the Studio "Prompts" tab (`/api/prompt/*` in `web/server.js`).

## Teams / Loadouts

A "team" is a saved, named set of roles decoupled from any task — `src/cli/team.ts`.
`ao run --team` = `composeWorkflow({ pinnedRoles })` with the catalog locked to the team's
roles. Teams persist as `~/.ao/teams/*.team.yaml` (override dir with `AO_TEAMS_DIR`) and are
**shared between the CLI and the web Studio** (`GET/POST/DELETE /api/teams` in `web/server.js`).
Bring-your-own roles: `AO_AGENTS_DIR=/path` overrides the built-in catalog everywhere.

## My Roles (user-built, additive)

`~/.ao/roles/<id>.md` (override dir with `AO_USER_ROLES_DIR`) holds user-created roles — referenced
as `my/<id>` in workflows. Unlike `AO_AGENTS_DIR` (which *replaces* the catalog), these are
**merged on top** of the built-in library: `loadAgent` falls back to the user dir for `my/*`
(`src/agents/loader.ts`), so run/compose/validate/`ao roles` all resolve them. Studio: "角色组队 →
我的" tab has create/delete UI (`POST/DELETE /api/roles/my` in `web/server.js`); the Prompt
Generator's system mode has "存为我的角色" to turn a generated system prompt into a role. Role
favorites (☆常用, localStorage) mirror the workflow-card star.

## Resume — Iterative Optimization

After `ao run` completes, all step outputs are saved to `ao-output/<name>-<timestamp>/`. Users can iterate on any step without re-running the entire workflow.

### When to suggest `--resume`

After a workflow finishes, **always tell the user they can iterate**:

> Workflow complete. Outputs saved to `ao-output/<dir>/`.
>
> To improve a specific step, use:
> ```
> ao run <workflow.yaml> --resume last --from <step-id>
> ```
> This reuses all upstream outputs and only re-runs from that step forward.

### When the user says things like:

- "Characters feel flat" → suggest `--resume last --from character_design`
- "Rewrite the ending" → suggest `--resume last --from write_story`
- "The tech review missed something" → suggest `--resume last --from tech_review`
- "Start over from scratch" → just run without `--resume`

### `--feedback` — revise in place vs. regenerate

`--resume --from <step>` re-runs a step **from scratch**. When the user has a *specific note* ("ending too flat", "budget too high") rather than wanting a blank redo, use `--feedback`: it hands the expert its **previous output + the note** so it edits the draft instead of rewriting:

```
ao run <workflow.yaml> --from <step-id> --feedback "你的具体意见"
```

`--feedback` implies `--resume last` when `--resume` is omitted. It requires `--from`. Downstream steps re-run automatically with the revised output.

### Reading previous outputs

Before suggesting changes, read the actual outputs:

1. Check `ao-output/` for the latest run directory
2. Read `metadata.json` to see step IDs and states
3. Read individual step files in `steps/` to understand what was produced
4. Then suggest which step to re-run and why

## Workflow YAML Format

```yaml
name: "Workflow Name"
agents_dir: "agency-agents-zh"

llm:
  provider: "deepseek"    # or: claude, openai, ollama
  model: "deepseek-chat"

concurrency: 2

inputs:
  - name: variable_name
    required: true

steps:
  - id: step_id
    role: "category/role-name"       # from agency-agents-zh
    task: "Task with {{variables}}"
    acceptance: "1. checkable condition…"  # optional: injected at prompt tail; output auto-verified against it after the step runs (fail → one auto-rework round); judge anchor in --compare
    verify: false                    # optional: opt this step out of acceptance auto-verify (top-level `verify: false` disables whole workflow; CLI --verify/--no-verify overrides; default on)
    output: output_variable
    skill: "test-driven-development" # optional: inject a methodology playbook (see `ao skills`)
    depends_on: [other_step]         # DAG dependency
    condition: "{{var}} contains X"  # conditional branching
    loop:                            # iterative loop
      back_to: step_id
      max_iterations: 3
      exit_condition: "{{var}} contains approved"
```

## Role Directory

Roles are in `agency-agents-zh/` (or `node_modules/agency-agents-zh/`). Each role is a `.md` file with frontmatter + system prompt. Use `ao roles` to list all 267 roles.

## Project Structure

- `src/` — TypeScript source (core engine, connectors, CLI)
- `workflows/` — Built-in workflow templates
- `test/` — Unit and E2E tests
- `integrations/` — Guides for Claude Code, Cursor, OpenClaw
- `ao-output/` — Workflow execution outputs (gitignored)

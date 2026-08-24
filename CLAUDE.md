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
ao report [dir|last]                  # Render a run into a shareable single-file HTML (default: latest run → <run>/report.html)
ao run <wf> --notify <webhook>        # Push result to DingTalk/Feishu/WeCom/generic webhook when done (AO_NOTIFY_URL also works; cron-friendly)
ao run <wf> --export pptx             # Export outputs as PPTX (also docx/pdf/xlsx/skill/plan); pandoc preferred, pptxgenjs fallback
ao run <wf> -i photo=@img.png         # Image inputs auto-become vision input (data-URI protocol, src/utils/vision.ts); needs a vision-capable API model; CLI providers strip+warn
```

## Community Templates (remote manifest)

`providers-manifest.json` (website repo, served from ao.aiolaola.com) carries `communityTemplates` —
curated-only import (URL must be listed; optional `sha256` verified). Endpoints in `web/server.js`:
`GET /api/community/templates`, `POST /api/community/import` (engine-validated, saved to 我的工作流).
Contribution flow documented in CONTRIBUTING.md. Listing/de-listing needs only a website push, no release.
NOTE: manifest `relayPresets` that duplicate built-ins are NOT redundant — old versions rely on them
(contract test enforces; do not remove).

## Release Pipeline (all automatic)

Push `v*` tag → npm (Trusted Publishing/OIDC) + Docker (waits for npm version to appear — race guard).
Push `desktop-v*` tag → 3-platform desktop builds. macOS signing auto-activates when CSC_LINK etc.
secrets are set (`desktop/electron-builder.config.cjs` branches on cert presence; afterSign skips ad-hoc
re-sign for real certs). CI-only steps must be rehearsed locally before committing (see memory:
dangling .bin symlinks broke a mac build once).

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
  # base_url: optional custom endpoint. For `provider: claude` this points the native
  # Anthropic SDK at an Anthropic-protocol relay (e.g. https://api.aicodemirror.com/api/claudecode).
  # Do NOT include /v1 — the client appends /v1/messages itself (`ao doctor` flags it if you do).

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

  - id: cover                        # text-to-image step: task IS the image prompt
    type: image                      # no role needed; requires an OpenAI-compatible API provider
    task: "Generate a poster for {{copy_text}}"
    image:
      model: "gpt-image-2"           # REQUIRED — image model ids are vendor-specific, never guessed
      size: "1024x1024"              # optional; also: quality, background
    output: cover_img                # variable = markdown image ref; PNG saved to <run>/assets/
    depends_on: [some_step]

  - id: promo                        # text-to-video step: task IS the video prompt
    type: video                      # no role needed; needs a VIDEO provider (own registry)
    task: "A tabby cat jumps onto the windowsill"
    video:
      provider: "metaso"             # optional if llm.provider is already a video provider
      model: "MiniMax-H3"            # REQUIRED — never guessed
      resolution: "768P"             # optional; passed through verbatim (vendor-specific tiers)
      duration: 5                    # seconds — billed per second, never inflated by the engine
      ratio: "16:9"
    output: promo_mp4                # variable = markdown link; mp4 saved to <run>/assets/
```

Image steps try the OpenAI Images API (`/images/generations`) first and automatically fall
back to the Responses API + `image_generation` tool (LanoX-style). PNG lands in
`ao-output/<run>/assets/`, Studio renders it inline via `GET /api/runs/:id/assets/:file`.

Video steps are **async**: create task → poll → download. Providers live in a separate
`VIDEO_PROVIDERS` table (`src/connectors/api-providers.ts`) because they are neither
OpenAI-compatible nor Anthropic-protocol — currently MetaSota (MiniMax-H3). Gotcha found by
probing: its query endpoint ignores `task_id` and returns **all** of the account's tasks, so
the connector filters by id (`src/connectors/video.ts`). A workflow whose steps are *all*
image/video needs neither `llm.model` nor a text connector.

## Media Prompt Libraries (two sources, don't merge them)

- **Image prompts**: `website/src/content/creative-prompts.json` — 229 curated items (CC BY 4.0,
  per-item author, **the only ones with SEO static pages**) plus `creative-prompts-extra.json` —
  1,349 more (CC BY 4.0 + MIT, regenerate with `scripts/import-creative-extra.mjs`). The extra pool
  is **lazy-loaded on an explicit click** (2MB) and is deliberately kept out of the sitemap.
  Browsable at `/creative` with one-click generation via `POST /api/image/generate`.
- **Video prompts** live in the **sister repo** `ai-shortfilm-prompts` (22 genre templates + 6 reusable
  building blocks, its own site at prompts.aiolaola.com). AO only *consumes* them: run
  `npm --prefix website run sync:video-prompts` to refresh `website/src/content/video-prompts.json`
  from that repo's `templates/index.json` (generated there by `scripts/gen_index.py`).
  **Never hand-edit the synced file**, and never add video prompts to `agency-agents-zh` — that
  library holds *roles* (a person with a system prompt), not content.
- The two are different shapes: an image item is one finished prompt; a video item is a template
  (variable table + 5-part body), so the Creative Library renders them with different cards.
- A third pool exists: `video-prompts-community.json` (49 finished English singles from
  `awesome_sora2_prompt`, MIT, via `scripts/import-video-community.mjs`). Imports **drop prompts
  naming real people or IP** — same rule the 视频提示词工程师 role follows — and the UI says the
  filter is best-effort rather than pretending it is exhaustive.
- No SEO pages for video prompts yet — the same text under two domains dilutes each other, so the
  canonical decision (ao.aiolaola.com vs prompts.aiolaola.com) has to be made first.

## Role Directory

Roles are in `agency-agents-zh/` (or `node_modules/agency-agents-zh/`). Each role is a `.md` file with frontmatter + system prompt. Use `ao roles` to list all 267 roles.

## Project Structure

- `src/` — TypeScript source (core engine, connectors, CLI)
- `workflows/` — Built-in workflow templates
- `test/` — Unit and E2E tests
- `integrations/` — Guides for Claude Code, Cursor, OpenClaw
- `ao-output/` — Workflow execution outputs (gitignored)

# Agency Orchestrator — Project Context

This is a multi-agent workflow orchestrator. Users define AI collaboration workflows in YAML, and the engine executes them with automatic DAG parallelism, variable passing, and retry logic.

## Key Commands

```bash
ao run <workflow.yaml> [options]      # Execute workflow
ao run <workflow.yaml> --resume last --from <step-id>  # Re-run from a specific step
ao validate <workflow.yaml>           # Validate without running
ao plan <workflow.yaml>               # Show DAG execution plan + media spend preview (N clips × seconds × tier × vendor; estimated from input defaults)
ao doctor [--fix] [--no-probe] [--media-probe]  # Self-check provider/creds/endpoint reachability/CLI/system Claude Code; --fix repairs a hijacked ~/.claude (fake token / relay base_url); --no-probe skips the live endpoint probe (a 1-token request); --media-probe (old alias: --video-probe) checks every keyed OpenAI-compatible relay for **video / image / speech** endpoints at zero cost (invalid probe body + a control path; see src/media/probe-video.ts) — speech matters because `type: tts` otherwise fails only after the paid image/video steps already ran
ao roles                              # List all 276 available roles
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
ao run <wf> -i docs=@./materials     # Directory input = knowledge source: text files (md/txt/csv/json/yaml/html/code) concatenated as `## 文件: <path>` sections (src/utils/docs-dir.ts); skips binaries/hidden/node_modules; pdf/docx are skipped WITH a warning (convert via pandoc first); 400KB total / 200KB per-file cap, truncation is announced. Studio never expands @ (AO_NO_AT_FILE=1)
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
step's system prompt at run time (`src/skills/loader.ts`, applied in `core/executor.ts`). Missing
skills are skipped (warn), never fatal.

Skills are resolved from **several dirs, merged by name** (same-name: earlier dir wins) —
`AO_SKILLS_DIR` > `./skills` > `superpowers-zh` (the dependency, 20 skills) > this package's own
`ao-skills/`. It must stay a merge, not first-dir-wins: under the old single-dir rule, adding one
bundled dir made all 20 superpowers skills vanish. `AO_SKILLS_DIR` is still an *override* — it just
no longer empties the rest.

`ao-skills/shortfilm-prompt` is ours: the 5-part cinematic video-prompt methodology, adapted from
the sister repo `ai-shortfilm-prompts` (MIT, same author). The upstream `SKILL.md` is an
**interactive** Claude Code skill (it asks via AskUserQuestion, `Read`s template files); AO steps
have no tools, so injecting it verbatim makes the model ask questions instead of writing a prompt.
Keep the AO copy single-turn — `test/skills.ts` pins that.

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
verify_llm: { provider: "agnes", model: "agnes-2.0-flash" }   # optional: which model acts as the acceptance reviewer (default: the text provider).
                                                              # Image/video acceptance needs a vision-capable API model and DeepSeek can't see images — set this
                                                              # (or CLI --verify-provider/--verify-model) instead of hand-adding `llm:` to every media step. Step-level `llm:` still wins.

inputs:
  - name: variable_name
    required: true
  - name: tts_voice
    show_when: "{{narration}} contains 配旁白"   # optional: same syntax as step.condition, may reference other INPUTS only.
                                                # False → Studio hides it and the CLI does not count it as a missing required input.

steps:
  - id: step_id
    role: "category/role-name"       # from agency-agents-zh
    task: "Task with {{variables}}"
    acceptance: "1. checkable condition…"  # optional: injected at prompt tail; output auto-verified against it after the step runs (fail → one auto-rework round); judge anchor in --compare
    assert:                          # optional mechanical check (core/assert.ts) — no model, no network, no tokens.
      contains: ["【声音】"]          #   模型审内容，脚本审结构：emits_files / min_bytes / max_bytes / contains / matches.
      max_bytes: 900                 #   Fail → one targeted rework, then the step FAILS (unlike acceptance). Use it to stop
                                     #   a bad prompt *before* a per-second video step spends money.
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
      provider: "lanox"              # optional — image provider; defaults to llm.provider. When set, the text provider's base_url/api_key are NOT carried over (same rule as video.provider)
      model: "gpt-image-2"           # REQUIRED — image model ids are vendor-specific, never guessed
      size: "1024x1024"              # optional; also: quality, background
    acceptance: "1. 画面里只有一个人物  2. 没有文字或水印"   # optional: VISUAL acceptance — the text provider (must support vision) looks at the PNG and checks each item; fail → one regeneration with the unmet items appended as hard constraints (costs one more image; `ao plan` says so) → re-check. CLI/ollama providers can't see images → skipped with a warning, never faked. `assert` is NOT allowed on image steps (it counts text structure).
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
      image: "{{cover_img}}"          # optional image-to-video first frame: public URL, an upstream image step's output, or a local path. Vendors mostly accept public URLs only — APIMart uploads local files automatically (POST /v1/uploads/images, 72h); Agnes takes a JSON data URI (`mode: keyframe` + `first_frame`, verified 2026-08-28; multipart is rejected); MetaSota has no upload, local files fail with a clear error
      ratio: "16:9"
      rework: false                  # optional: regenerate once when acceptance fails (default false — video is billed per second; the default only reports ⚠️)
    acceptance: "1. 画面里有一只猫  2. 没有文字或水印"   # optional: 3 frames (start/mid/end, local ffmpeg) go to the vision-capable text provider; judges still frames only — write visible hard conditions, not motion/sound. No ffmpeg → skipped with a warning.
    output: promo_mp4                # variable = markdown link; mp4 saved to <run>/assets/

  - id: vo1                          # text-to-speech step: task IS the text to speak
    type: tts                        # no role needed; OpenAI-compatible POST {base}/audio/speech
    task: "{{narration1}}"
    tts:
      provider: "openai"             # optional — defaults to llm.provider (same rule as image/video)
      model: "gpt-4o-mini-tts"       # REQUIRED — never guessed
      voice: "nova"                  # REQUIRED — voice ids are vendor-specific, never guessed
      speed: 1.0                     # optional; also: format (mp3 default), instructions
    output: vo1_audio                # variable = markdown audio link; file saved to <run>/assets/

  - id: film                         # concat step: stitch clips + all post-production, with local ffmpeg (no vendor cost)
    type: concat                     # no role/task; needs ffmpeg on PATH (or AO_FFMPEG); `ao doctor` reports it
    concat:
      inputs: ["{{shot1_mp4}}", "{{shot2_mp4}}"]   # upstream video outputs, in order
      size: "1280x720"               # optional; defaults to first clip's size. Clips are normalized (scale/pad/fps, silent audio if missing) then concatenated
      voiceover: ["{{vo1_audio}}", ""]             # optional, one per input ("" = no narration on that clip). Mixed OVER the clip's own audio, never replacing it
      clip_volume: 0.3               # the clip's OWN audio. Default 0.3 with narration, 1.0 without
      subtitles: ["第一镜的字幕", ""]                # optional, one per input; timed by each clip's REAL duration, split by punctuation
      subtitle_style: { size: 22 }   # optional: font / size / color / outline / margin (ffmpeg force_style)
      bgm: "/path/bgm.mp3"           # optional: looped to fill the film, 2s fade-out at the end
      bgm_volume: 0.25               # default 0.25 — sits under the voice
    output: film_mp4
    depends_on: [shot1, shot2]
```

**Media spend is shown before it is spent.** `src/media/preflight.ts` (`summarizeMediaSpend`) is a pure
function shared by the `ao run` header, `ao plan`, and the Studio live view (engine prints a
`__AO_PREFLIGHT__{json}` line under `AO_WEB_INPUT=1` → SSE `preflight`). Quantities only, never prices —
we don't hold vendors' price lists. Conditions that reference only inputs are decided up front; ones
that reference upstream output are marked "视条件" and counted as running (overestimate, never under).

Post-production rules that are load-bearing:
- **Video models already produce audio.** Veo3 / Sora2 / MiniMax-H3 output sound with the picture, and
  it is often full *dialogue*, not just ambience. So narration is mixed **over** the clip's own track,
  never replacing it, and how far to duck that track is `clip_volume` (0.3 by default when a voiceover
  is present) — because only the author knows whether the generated dialogue is the performance or noise.
  Check the raw clip before adding narration at all.
- **Clip duration is what the user paid for — it is never stretched or trimmed to fit narration.**
  Voiceover longer than its clip is truncated *with a loud warning* telling the author to shorten the
  line or lengthen that shot.
- **Burning subtitles needs an ffmpeg built with libass** (the `subtitles` filter). Plenty of builds
  lack it — Homebrew's did on the dev machine. When it is missing the engine still delivers the film
  and attaches the subtitles as a **soft track** (mov_text), saying exactly what is missing and how to
  fix it; it never silently drops them, and never wastes clips that were already paid for.
  `ao doctor` reports burn capability up front.
- A concat input that renders empty (upstream failed/skipped) is a **hard error**, never a silently
  shorter film.
- Optional voiceover is wired with `condition:` on the tts steps plus `depends_on_mode: any_completed`
  on the concat step — with the default `all`, skipped tts steps would skip the concat too and the
  paid-for clips would never be stitched.

Image steps try the OpenAI Images API (`/images/generations`) first and automatically fall
back to the Responses API + `image_generation` tool (LanoX-style). PNG lands in
`ao-output/<run>/assets/`, Studio renders it inline via `GET /api/runs/:id/assets/:file`.

Video steps are **async**: create task → poll → download. Providers live in a separate
`VIDEO_PROVIDERS` table (`src/connectors/api-providers.ts`) because they are neither
OpenAI-compatible nor Anthropic-protocol — currently **MetaSota** (MiniMax-H3) and **APIMart**
(Sora2 / VEO3 / Kling / Hailuo …). Each vendor's paths, body fields and status words are wildly
different, so `video.ts` keeps one adapter per `shape` and the main flow stays vendor-agnostic:
MetaSota posts `content:[{type,text}]` to `v2/video_generation` and polls a **list** endpoint that
ignores `task_id` (so the connector filters by id — otherwise concurrent steps swap videos);
APIMart posts `prompt` + `aspect_ratio` to `v1/videos/generations` and polls `v1/tasks/{id}` (per-model field names in `models[].fields`: Kling uses `mode`, Wan/PixVerse/Grok use `size`, MiniMax family uses `first_frame_image`). A third shape, **`openai-videos`** (OpenAI's official Videos API: `POST /videos` → `GET /videos/{id}` → authenticated `GET /videos/{id}/content`, image via multipart `input_reference`), is what many relays actually expose — any OpenAI-compatible provider not in `VIDEO_PROVIDERS` is tried with it automatically; `ao doctor --video-probe` finds which relays have it at zero cost.
APIMart is deliberately in **both** tables — one `APIMART_API_KEY` covers chat, `type: image` and
`type: video` — so `/api/config` only marks *video-only* providers as `family: 'video'`. A workflow whose steps are *all*
image/video needs neither `llm.model` nor a text connector.

## Volcengine (火山方舟) notes

Two providers now: `volcengine` (pay-as-you-go, `ARK_API_KEY`) and `volcengine-plan` (Agent Plan, `ARK_PLAN_API_KEY`, base `/api/plan/v3`) — so "text/images on the plan, video pay-as-you-go" can coexist on one machine. Two credential modes, **different base URLs**: pay-as-you-go keys use `https://ark.cn-beijing.volces.com/api/v3`; Agent Plan keys must use
`…/api/plan/v3` (set `VOLCENGINE_BASE_URL`) — hitting `/api/v3` with a plan key bills extra. Verified 2026-08-26: images work on both
(`doubao-seedream-5-0-260128` pay-as-you-go, `doubao-seedream-5.0-lite` on Medium; Seedream 5 needs ≥3.69 MP → use `size: "2k"`);
video (`/contents/generations/tasks`, Ark's own shape, no adapter yet) is **Large-plan-or-pay-as-you-go only** — Medium returns
`UnsupportedModel`. Model ids come from `GET /api/v3/models`, never guessed.

## Style Library

`src/media/styles.ts` — 15 presets (真人 13 / 3D / 2D), each = Chinese name + an English prompt suffix (camera,
lens, film stock, grade, light — same register as the 5-part video methodology). A workflow input with
`source: styles` renders as a grouped dropdown in Studio; **the engine expands the chosen id/name into
"名（EN）: suffix" before the run** (`expandStyle` in `src/index.ts`), so CLI `-i style=霓虹赛博电影` and
Studio behave the same and a free-text description passes through untouched. `sample` (example image)
stays empty until generated — never ship a placeholder pretending to be a sample.

## Media Prompt Libraries (two sources, don't merge them)

- **Image prompts**: `website/src/content/creative-prompts.json` — 229 curated items (CC BY 4.0,
  per-item author, **the only ones with SEO static pages**) plus `creative-prompts-extra.json` —
  1,282 more (CC BY 4.0 + MIT, regenerate with `scripts/import-creative-extra.mjs`). The extra pool
  is **lazy-loaded per category** — `scripts/split-creative-extra.mjs` (auto-run by website `predev`/`prebuild`,
  output `website/src/content/creative-extra/` is gitignored) slices it into 11 category chunks; clicking a
  category chip loads only that chunk, "load all" pulls every chunk (2MB raw, ~640KB gzipped). The pool is
  deliberately kept out of the sitemap.
  Browsable at `/creative` with one-click generation via `POST /api/image/generate`.
- **Video prompts** live in the **sister repo** `ai-shortfilm-prompts` (22 genre templates + 6 reusable
  building blocks, its own site at prompts.aiolaola.com). AO only *consumes* them: run
  `npm --prefix website run sync:video-prompts` to refresh `website/src/content/video-prompts.json`
  from that repo's `templates/index.json` (generated there by `scripts/gen_index.py`).
  **Never hand-edit the synced file**, and never add video prompts to `agency-agents-zh` — that
  library holds *roles* (a person with a system prompt), not content.
- The two are different shapes: an image item is one finished prompt; a video item is a template
  (variable table + 5-part body), so the Creative Library renders them with different cards.
- Re-import recipe (order matters): `import-creative-extra.mjs` → `prune-extra-prompts.mjs`
  (drops prompts naming real people, using an IP character as the subject, or explicit content —
  **and deliberately keeps** negative-prompt mentions like "no gore", makeup terms like "nude lips",
  and style words like "Pixar-style"; `test/creative-prune.ts` pins exactly those non-hits) →
  `translate-extra-titles.mjs` (re-import wipes `titleZh`, so translation always comes last).
- **Titles/descriptions in the extra pools are English** (the sources are English). `scripts/translate-extra-titles.mjs`
  fills `titleZh`/`descZh` via the local `claude` CLI in resumable batches — run it after any re-import,
  otherwise Chinese users cannot search those items (the prompt body itself always stays in the source
  language: that is what the model consumes).
- **Video previews**: 17 community items carry an external sample clip (OpenAI's Sora showcase CDN and
  Twitter CDN); the card loads them **only on click** (some are 17–48MB). The 22 genre templates have
  **no sample yet** — no open-source library ships licensed, self-hosted example videos, so the clean
  path is generating our own: `scripts/gen-video-previews.mjs` fills each template's variable table into
  its 5-part body, renders via `type: video`, ffmpeg-shrinks it, and writes the local path back.
  It is a **dry run by default** (it spends real money: ~¥9.9 for all 22 at 768P×5s) — pass `--yes`.
- A third pool exists: `video-prompts-community.json` (47 finished English singles from
  `awesome_sora2_prompt`, MIT, via `scripts/import-video-community.mjs`). Imports **drop prompts
  naming real people or IP** — same rule the 视频提示词工程师 role follows — and the UI says the
  filter is best-effort rather than pretending it is exhaustive.
- No SEO pages for video prompts yet — the same text under two domains dilutes each other, so the
  canonical decision (ao.aiolaola.com vs prompts.aiolaola.com) has to be made first.

## Role Directory

Roles are in `agency-agents-zh/` (or `node_modules/agency-agents-zh/`). Each role is a `.md` file with frontmatter + system prompt. Use `ao roles` to list all 276 roles.

## Project Structure

- `src/` — TypeScript source (core engine, connectors, CLI)
- `workflows/` — Built-in workflow templates
- `test/` — Unit and E2E tests
- `integrations/` — Guides for Claude Code, Cursor, OpenClaw
- `ao-output/` — Workflow execution outputs (gitignored)

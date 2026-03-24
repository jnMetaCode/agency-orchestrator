# Agency Orchestrator — Project Context

This is a multi-agent workflow orchestrator. Users define AI collaboration workflows in YAML, and the engine executes them with automatic DAG parallelism, variable passing, and retry logic.

## Key Commands

```bash
ao run <workflow.yaml> [options]      # Execute workflow
ao run <workflow.yaml> --resume last --from <step-id>  # Re-run from a specific step
ao validate <workflow.yaml>           # Validate without running
ao plan <workflow.yaml>               # Show DAG execution plan
ao roles                              # List all 186 available roles
```

## Resume — Iterative Optimization

After `ao run` completes, all step outputs are saved to `.ao-output/<name>-<timestamp>/`. Users can iterate on any step without re-running the entire workflow.

### When to suggest `--resume`

After a workflow finishes, **always tell the user they can iterate**:

> Workflow complete. Outputs saved to `.ao-output/<dir>/`.
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

### Reading previous outputs

Before suggesting changes, read the actual outputs:

1. Check `.ao-output/` for the latest run directory
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
    output: output_variable
    depends_on: [other_step]         # DAG dependency
    condition: "{{var}} contains X"  # conditional branching
    loop:                            # iterative loop
      back_to: step_id
      max_iterations: 3
      exit_condition: "{{var}} contains approved"
```

## Role Directory

Roles are in `agency-agents-zh/` (or `node_modules/agency-agents-zh/`). Each role is a `.md` file with frontmatter + system prompt. Use `ao roles` to list all 186 roles.

## Project Structure

- `src/` — TypeScript source (core engine, connectors, CLI)
- `workflows/` — Built-in workflow templates
- `test/` — Unit and E2E tests
- `integrations/` — Guides for Claude Code, Cursor, OpenClaw
- `.ao-output/` — Workflow execution outputs (gitignored)

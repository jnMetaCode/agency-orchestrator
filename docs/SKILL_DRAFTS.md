# Personal method draft storage (Unreleased)

The draft storage API is implemented; the Studio editor is not connected yet.
This is a personal text draft, not an installed Skill bundle. Saving does not
change the original Skill, copy scripts/assets, enable an MCP server, execute
commands, or attach the draft to a task. No usage tracking is added.

Drafts live under `<AO data directory>/.local/skill-drafts/<UUID>/draft.json`.
They are ordinary local text and may contain user-entered sensitive information;
there is no encryption. File writes use the existing configuration transaction
lock, journal recovery, atomic replacement, mode 0600 and at most five backups
per draft. Operating-system permission semantics differ on Windows.

## API

All responses use `Cache-Control: no-store` and the existing Studio request guard.

- `GET /api/skill-drafts`: bounded metadata list, without method bodies or revision tokens.
- `GET /api/skill-drafts/:id`: body, revision and pending-journal indicator.
- `POST /api/skill-drafts/preview`: name/body plus optional source resource ID;
  editing requires ID and current `expectedRevision`. Returns before/after text,
  ID, expected revision and an exact-content confirmation valid for five minutes.
  This request creates no directories or files.
- `POST /api/skill-drafts/save`: submit preview ID, exact target fields,
  `expectedRevision` and `targetRevision`. Invalid confirmations are rejected
  before directory creation. The source revision and target are checked again
  under the transaction lock. External changes produce 409 without overwrite.
- `POST /api/skill-drafts/:id/check`: explicit result check that may recover this
  draft's interrupted transaction. Missing drafts do not create directories.

A lost save response must be checked using the same draft ID. A successful save
cannot be replayed using the old revision. Tokens are process-local: restarting
requires a fresh read and preview. A check returning an existing draft does not
prove that its content matches an earlier request; clients must compare it.

Names are limited to 80 characters and nonempty text to 128 KiB. Reads are bounded
and reject symbolic-link files. Lists are capped at 100 drafts, 600 scanned entries
and an 8 MiB body budget, with an explicit partial flag. Symlink checks do not
provide isolation against a hostile local process swapping parent directories.
Source resource IDs are session-local provenance, not permanent upstream IDs.

## Remaining work

The editor must invalidate confirmation after changes, show before/after text,
retain unsaved input on conflicts and distinguish unknown save results from
success. Browser acceptance tests and interrupted-transaction fixture tests remain
before calling the complete draft editing feature ready.

Run `npm run test:skill-drafts` and `npm run test:resources` for current storage and
resource regression checks. Tests use temporary directories and no paid APIs.

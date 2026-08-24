# `company/` — additions by Agency Orchestrator

The rest of `agency-agents/` is the upstream English role library
([msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents), MIT), vendored here so
the npm package ships with English roles out of the box. **This directory is not upstream's.** It is
kept separate precisely so an upstream sync never has to untangle whose file is whose.

| File | Origin |
|---|---|
| `chief-financial-officer.md` | Upstream (`specialized/chief-financial-officer.md`), copied verbatim — MIT |
| `chief-of-staff.md` | Upstream (`specialized/specialized-chief-of-staff.md`), moved here for departmental parity — MIT |
| `chief-executive-officer.md` | Agency Orchestrator original |
| `chief-technology-officer.md` | Agency Orchestrator original |
| `chief-product-officer.md` | Agency Orchestrator original |
| `chief-marketing-officer.md` | Agency Orchestrator original |
| `chief-operating-officer.md` | Agency Orchestrator original |

The five originals are English editions of the roles written for the Chinese library
(`agency-agents-zh`, `company/`), so the two libraries stay in step: a Chinese user and an English
user reaching for "the CEO" get the same persona and the same rules.

**Why a `company/` directory at all**: the C-suite used to sit inside `specialized/` — 58 assorted
specialists with a CEO buried among them. Nobody browsing the library found them, and nothing
signalled that this project supports a full "one-person company" executive layer. Two roles moved
here still resolve from their old paths: the engine falls back across categories by filename
(`src/agents/loader.ts`), warns once, and points at the new location.

**Upstream sync**: when refreshing the vendored library, replace everything *except* this directory,
then re-check that `chief-financial-officer.md` still matches upstream (it is the one file here that
should track upstream rather than us).

# Agency Orchestrator Desktop 0.4.12

- Enable ShengSuanYun LoomLoom batch image generation with the official image template.
- Accept the current flat row request format and restore completed task status and image results.
- Hide unavailable cost amounts and allow generation after successful validation.
- Keep generation history visible while selecting prompts, and retry progress queries after network errors.
- Share single-image defaults with Studio without adding model controls to the Creative Library header.
- Bundle built-in Chinese and English roles; install additional official language libraries on demand.

The macOS arm64 ZIP contains the complete signed app bundle. Unzip it and move Agency Orchestrator.app into Applications. This build uses an ad-hoc signature and has not been notarized by Apple. Existing app data is retained when replacing the application.

Batch tests, frontend type checking/build, app signature verification, frontend payload verification, and desktop payload verification passed. Actual upstream responses confirmed two completed image tasks. Installer generation and upload require the release workflow or a local terminal with the required access.

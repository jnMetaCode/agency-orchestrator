# Privacy and network behavior

This document describes the current local desktop application and local Studio (`ao web`) as reviewed on 2026-10-21. The public demonstration website is a separate deployment. This is an implementation disclosure, not a claim that SignPath has approved the application.

## Local data and selected services

Configuration, saved credentials, workflow definitions, logs and run artifacts are stored on the user's computer. Some configuration and recovery files contain plaintext credentials; local storage does not imply encryption. Data directories and backup files should be protected accordingly.

When the user runs an AI task, prompts, relevant attachments and prior-step outputs are transmitted to the provider configured for that task, or passed to a selected locally installed CLI. API credentials authenticate requests to the configured endpoint. Those services and CLI tools have their own privacy practices. A local CLI can itself communicate with external services; selecting a CLI does not imply offline processing.

Generated media may be downloaded from provider-supplied URLs. Role-library installation and other user-requested tools may access package registries or third-party services. Workflows that invoke tools can read, write or transmit data according to those tools and the workflow configuration.

## Background and interface requests

| Request | Purpose / data involved | Current control |
| --- | --- | --- |
| GitHub releases API | Desktop update checks; ordinary request metadata such as IP address and user-agent is visible to GitHub | Set `AO_DESKTOP_NO_UPDATE_CHECK=1` before launch |
| `ao.aiolaola.com/providers-manifest.json` | Provider, sponsor and community-template metadata; fetched by the local server at startup and cached | `AO_MANIFEST_URL` changes the source; a dedicated UI disable switch is not currently provided |
| `models.dev` and configured provider catalogs | Model metadata when relevant catalog features are used | `AO_MODELS_DEV_URL` changes the models.dev source; provider endpoints depend on configuration |
| Google Fonts | The shared interface includes remote font stylesheet/resources | No dedicated in-app font-network disable switch currently exists |
| npm registry | Package/version metadata and user-requested package installation | Depends on the invoked feature and package-manager configuration |

The catalog/update implementations do not intentionally attach task prompts or API keys to those metadata requests. This is distinct from normal task requests to the user-configured model endpoint. Network services can observe routine connection metadata even when requests do not contain task content.

The local interface does not initialize GA4/GTM analytics scripts on localhost under its normal JavaScript-enabled operation. The public website does initialize analytics on configured public hostnames. The shared HTML also contains a GTM `noscript` iframe, which can make a request when JavaScript is disabled; it is not an unconditional no-tracking guarantee for every browser configuration.

## Configuration changes and removal

User-selected relay/configuration operations can modify local AI-tool configuration. Review the confirmation and recovery information before applying them. Changing a data directory does not automatically move or erase the previous directory. Uninstalling the desktop application may leave configuration, backups and run artifacts on disk; users can remove those separately when no longer needed.

## Scope and follow-up

We have not completed a comprehensive audit of every dependency or user-supplied workflow. A future signed release must be checked against its actual bundled components. Additional installation-time notice and controls for nonessential network access may be needed for SignPath acceptance; publishing this document alone does not complete that work.

Implementation references: [desktop update check](../desktop/main.cjs), [local server metadata requests](../web/server.js), [shared interface HTML](../website/index.html), [signing application assessment](SIGNPATH.md).

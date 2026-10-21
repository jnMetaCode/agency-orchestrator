# Code signing policy

Status (2026-10-21): Windows releases are currently **unsigned**. The maintainer manually submitted a SignPath Foundation application and reported the form success confirmation. Review is pending. No application approval, certificate, signing service sponsorship, or signed release is claimed.

## Responsibilities

- Current repository maintainer and release operator: [jnMetaCode](https://github.com/jnMetaCode).
- Proposed signing approver: the repository maintainer, subject to confirmation and SignPath enrollment. No external signing approver has been appointed.
- External pull requests must be reviewed by the maintainer, especially changes to dependencies, build scripts, workflows, and signing configuration.
- Before enabling Foundation signing, all relevant maintainers and approvers must enable MFA on GitHub and SignPath. The maintainer has confirmed GitHub MFA; SignPath MFA remains to be enabled when account access is available.

## Proposed signed release process

Builds originate from this public repository and a version tag using GitHub Actions. A future SignPath integration must verify artifact origin, require manual approval for each signed release, and verify signatures before publication. Checksums and update metadata must describe the final signed bytes. Signing failures must block publication of a release advertised as signed.

We will sign only our own eligible application and installer artifacts. Bundled upstream executables must not be represented as software authored by this project; handling must comply with SignPath's approved artifact policy. Existing published assets will not be overwritten to retrofit signatures.

After approval, this policy and the relevant download pages will be updated with the exact Foundation attribution and actual signing roles. Until then, users should treat Windows downloads as unsigned and verify their source and published checksums. A checksum proves integrity relative to that checksum, not publisher identity.

## Privacy and application behavior

See [Privacy and network behavior](PRIVACY.md). Local prompts, attachments and configured credentials are used by the selected AI providers or local tools. Automatic catalog/update requests and external UI resources are disclosed separately; this project does not claim the application is completely offline by default.

## Reporting

Report project signing or release integrity concerns through [GitHub issues](https://github.com/jnMetaCode/agency-orchestrator/issues). Do not include credentials or private project files in public reports. For any future Foundation-signed artifact, the Foundation also provides its own reporting contact in its [terms](https://signpath.org/terms.html).

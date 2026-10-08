#!/bin/bash
set -eu
cd "$(dirname "$0")"
trap 'status=$?; if [ "$status" -ne 0 ]; then printf "\n发布未完成，请保留上方错误。按回车关闭。\n"; read -r; fi' EXIT
release_tag='desktop-v0.4.12'
release_zip='desktop/release-local/Agency-Orchestrator-0.4.12-arm64.zip'
test -s "$release_zip"
if ! gh auth status; then gh auth login --hostname github.com --web; fi
git add .gitignore desktop/package.json desktop/package-lock.json package.json package-lock.json \
  web/server.js web/role-libraries.js website/src/components/studio/RolesPicker.tsx \
  website/src/i18n/translations.ts website/src/lib/studio.ts website/src/pages/CreativeLibrary.tsx \
  install-local-app.command docs/releases/desktop-v0.4.12.md publish-local-desktop.command
if ! git diff --cached --quiet; then
  git commit -m 'release: desktop 0.4.12 with batch history and optional role libraries'
fi
git push origin HEAD
if ! git rev-parse --verify "refs/tags/$release_tag" >/dev/null 2>&1; then git tag "$release_tag"; fi
git push origin "$release_tag"
if gh release view "$release_tag" --repo jnMetaCode/agency-orchestrator >/dev/null 2>&1; then
  gh release upload "$release_tag" "$release_zip" --repo jnMetaCode/agency-orchestrator --clobber
else
  gh release create "$release_tag" "$release_zip" --repo jnMetaCode/agency-orchestrator \
    --verify-tag --title 'Agency Orchestrator Desktop 0.4.12' \
    --notes-file docs/releases/desktop-v0.4.12.md --latest
fi
printf '\n源码和 arm64 ZIP 已发布；desktop-v 标签已触发标准安装包构建。\n'
gh release view "$release_tag" --repo jnMetaCode/agency-orchestrator --web

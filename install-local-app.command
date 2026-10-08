#!/bin/bash
set -eu
cd "$(dirname "$0")"
source_app="$PWD/desktop/release-local/mac-arm64/Agency Orchestrator.app"
target_app='/Applications/Agency Orchestrator.app'
staging_app="/Applications/.Agency-Orchestrator-install-$$.app"
trap 'status=$?; if [ "$status" -ne 0 ]; then printf "\n安装失败，请保留错误信息。按回车关闭。\n"; read -r; fi' EXIT
test -d "$source_app"
codesign --verify --deep --strict "$source_app"
printf '请先退出旧的 Agency Orchestrator App，再按回车安装新版。\n'
read -r
ditto "$source_app" "$staging_app"
codesign --verify --deep --strict "$staging_app"
if [ -d "$target_app" ]; then
  backup_app="/Applications/Agency Orchestrator.backup-$(date +%Y%m%d-%H%M%S)-$$.app"
  mv "$target_app" "$backup_app"
  printf '旧版已备份：%s\n' "$backup_app"
fi
if ! mv "$staging_app" "$target_app"; then
  if [ -n "${backup_app:-}" ]; then mv "$backup_app" "$target_app"; fi
  exit 1
fi
printf '新版已安装，正在打开…\n'
open "$target_app"

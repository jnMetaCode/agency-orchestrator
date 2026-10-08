#!/bin/bash
cd "$(dirname "$0")" || exit 1
node scripts/diagnose-batch.mjs
printf '\n请复制上方诊断结果。按回车关闭。\n'
read -r

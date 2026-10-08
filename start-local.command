#!/bin/bash
cd "$(dirname "$0")" || exit 1
project_dir="$PWD"
for server_port in 8088 8089 8090 8092; do
server_pids=$(lsof -tiTCP:"$server_port" -sTCP:LISTEN 2>/dev/null)
for server_pid in $server_pids; do
  server_command=$(ps -p "$server_pid" -o command=)
  case "$server_command" in
    *"$project_dir/web/server.js"*)
      printf '停止旧版本地服务（PID %s）…\n' "$server_pid"
      kill -TERM "$server_pid" || exit 1
      for attempt in {1..50}; do
        if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
        sleep 0.1
      done
      ;;
    *)
      printf '%s 端口被其他程序占用，未停止该程序。\n' "$server_port"
      if [ "$server_port" = 8092 ]; then
        read -r
        exit 1
      fi
      ;;
  esac
done
done
printf '批量适配器版本：2026-10-08-run-results-v4\n启动地址：http://127.0.0.1:8092\n'
AO_SSY_BATCH_ENABLED=1 AO_SSY_BATCH_BASE_URL=https://loomloom.shengsuanyun.com/loom/v1 node dist/cli.js web --port 8092
status=$?
if [ "$status" -ne 0 ]; then
  printf '\n启动失败，请保留此窗口查看错误。按回车退出。\n'
  read -r
fi

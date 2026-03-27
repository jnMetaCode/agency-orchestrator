#!/usr/bin/env bash
#
# install.sh -- 将工作流执行器安装到本地 AI 工具中
#
# 将 integrations/ 中的 workflow-runner 指令文件复制到各工具的配置目录，
# 让 AI 工具理解如何执行 YAML 多角色工作流。
#
# 用法：
#   ./scripts/install.sh [--tool <name>] [--help]
#
# 支持的工具：
#   claude-code    -- 复制 CLAUDE.md 到项目根目录
#   copilot        -- 复制到 .github/copilot-instructions.md
#   cursor         -- 复制到 .cursor/rules/
#   kiro           -- 复制到 .kiro/steering/
#   trae           -- 复制到 .trae/rules/
#   openclaw       -- 复制 README.md 到项目
#   opencode       -- 复制到 .opencode/instructions.md
#   aider          -- 复制 CONVENTIONS.md 到项目根目录
#   windsurf       -- 复制 .windsurfrules 到项目根目录
#   antigravity    -- 复制 AGENTS.md 到项目根目录
#   gemini-cli     -- 复制 GEMINI.md 到项目根目录
#   qwen           -- 复制到 .qwen/rules/
#   codex          -- 复制到 .codex/instructions.md
#   deerflow       -- 复制 SKILL.md 到项目
#   all            -- 安装所有已检测到的工具（默认）

set -euo pipefail

# --- 颜色 ---
if [[ -t 1 ]]; then
  C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[0;31m'
  C_CYAN=$'\033[0;36m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_GREEN=''; C_YELLOW=''; C_RED=''; C_CYAN=''; C_BOLD=''; C_DIM=''; C_RESET=''
fi

ok()     { printf "${C_GREEN}[OK]${C_RESET}  %s\n" "$*"; }
warn()   { printf "${C_YELLOW}[!!]${C_RESET}  %s\n" "$*"; }
err()    { printf "${C_RED}[ERR]${C_RESET} %s\n" "$*" >&2; }
header() { printf "\n${C_BOLD}%s${C_RESET}\n" "$*"; }
dim()    { printf "${C_DIM}%s${C_RESET}\n" "$*"; }

# --- 路径 ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INTEGRATIONS="$REPO_ROOT/integrations"
PROJECT_DIR="${PWD}"

ALL_TOOLS=(claude-code copilot cursor kiro trae openclaw opencode aider windsurf antigravity gemini-cli qwen codex deerflow)

# --- 用法 ---
usage() {
  sed -n '3,/^[^#]/{ /^#/s/^# \{0,1\}//p; }' "$0"
  exit 0
}

# --- 工具检测 ---
detect_claude_code() { command -v claude >/dev/null 2>&1 || [[ -d "${HOME}/.claude" ]]; }
detect_copilot()     { command -v code >/dev/null 2>&1 || [[ -d "${HOME}/.github" ]] || [[ -d "${HOME}/.copilot" ]]; }
detect_cursor()      { command -v cursor >/dev/null 2>&1 || [[ -d "${HOME}/.cursor" ]]; }
detect_kiro()        { command -v kiro >/dev/null 2>&1 || [[ -d "${HOME}/.kiro" ]]; }
detect_trae()        { command -v trae >/dev/null 2>&1 || [[ -d "${HOME}/.trae" ]]; }
detect_openclaw()    { command -v openclaw >/dev/null 2>&1 || [[ -d "${HOME}/.openclaw" ]]; }
detect_opencode()    { command -v opencode >/dev/null 2>&1 || [[ -d "${HOME}/.config/opencode" ]]; }
detect_aider()       { command -v aider >/dev/null 2>&1; }
detect_windsurf()    { command -v windsurf >/dev/null 2>&1 || [[ -d "${HOME}/.codeium" ]]; }
detect_antigravity() { [[ -d "${HOME}/.gemini/antigravity" ]]; }
detect_gemini_cli()  { command -v gemini >/dev/null 2>&1 || [[ -d "${HOME}/.gemini" ]]; }
detect_qwen()        { command -v qwen >/dev/null 2>&1 || [[ -d "${HOME}/.qwen" ]]; }
detect_codex()       { command -v codex >/dev/null 2>&1 || [[ -d "${HOME}/.codex" ]]; }
detect_deerflow()    { command -v deerflow >/dev/null 2>&1 || [[ -d "${HOME}/.deerflow" ]]; }

is_detected() {
  case "$1" in
    claude-code) detect_claude_code ;;
    copilot)     detect_copilot     ;;
    cursor)      detect_cursor      ;;
    kiro)        detect_kiro        ;;
    trae)        detect_trae        ;;
    openclaw)    detect_openclaw    ;;
    opencode)    detect_opencode    ;;
    aider)       detect_aider       ;;
    windsurf)    detect_windsurf    ;;
    antigravity) detect_antigravity ;;
    gemini-cli)  detect_gemini_cli  ;;
    qwen)        detect_qwen        ;;
    codex)       detect_codex       ;;
    deerflow)    detect_deerflow    ;;
    *)           return 1 ;;
  esac
}

tool_label() {
  case "$1" in
    claude-code) printf "%-14s  %s" "Claude Code"  "(CLAUDE.md)"                   ;;
    copilot)     printf "%-14s  %s" "Copilot"      "(.github/copilot-instructions.md)" ;;
    cursor)      printf "%-14s  %s" "Cursor"       "(.cursor/rules/)"              ;;
    kiro)        printf "%-14s  %s" "Kiro"         "(.kiro/steering/)"             ;;
    trae)        printf "%-14s  %s" "Trae"         "(.trae/rules/)"               ;;
    openclaw)    printf "%-14s  %s" "OpenClaw"     "(README.md)"                   ;;
    opencode)    printf "%-14s  %s" "OpenCode"     "(.opencode/instructions.md)"   ;;
    aider)       printf "%-14s  %s" "Aider"        "(CONVENTIONS.md)"              ;;
    windsurf)    printf "%-14s  %s" "Windsurf"     "(.windsurfrules)"              ;;
    antigravity) printf "%-14s  %s" "Antigravity"  "(AGENTS.md)"                   ;;
    gemini-cli)  printf "%-14s  %s" "Gemini CLI"   "(GEMINI.md)"                   ;;
    qwen)        printf "%-14s  %s" "Qwen Code"    "(.qwen/rules/)"               ;;
    codex)       printf "%-14s  %s" "Codex CLI"    "(.codex/instructions.md)"      ;;
    deerflow)    printf "%-14s  %s" "DeerFlow"     "(SKILL.md)"                    ;;
  esac
}

# --- 复制辅助函数 ---
copy_file() {
  local src="$1" dest="$2"
  if [[ -f "$dest" ]]; then
    warn "$(basename "$dest") 已存在，跳过。删除后重试或手动追加内容。"
    return 0
  fi
  cp "$src" "$dest"
}

copy_to_dir() {
  local src="$1" dest_dir="$2" filename="$3"
  mkdir -p "$dest_dir"
  cp "$src" "$dest_dir/$filename"
}

# --- 安装器 ---

install_claude_code() {
  local src="$INTEGRATIONS/claude-code"
  [[ -d "$src" ]] || { err "integrations/claude-code 不存在"; return 1; }
  ok "Claude Code: 请参考 $src/README.md 配置"
}

install_copilot() {
  local src="$INTEGRATIONS/copilot/copilot-instructions.md"
  local dest="$PROJECT_DIR/.github/copilot-instructions.md"
  [[ -f "$src" ]] || { err "integrations/copilot/copilot-instructions.md 不存在"; return 1; }
  mkdir -p "$PROJECT_DIR/.github"
  copy_file "$src" "$dest"
  ok "Copilot: workflow-runner -> $dest"
}

install_cursor() {
  local src="$INTEGRATIONS/cursor/workflow-runner.mdc"
  [[ -f "$src" ]] || { err "integrations/cursor/workflow-runner.mdc 不存在"; return 1; }
  copy_to_dir "$src" "$PROJECT_DIR/.cursor/rules" "workflow-runner.mdc"
  ok "Cursor: workflow-runner -> .cursor/rules/"
}

install_kiro() {
  local src="$INTEGRATIONS/kiro/ao-workflow-runner.md"
  [[ -f "$src" ]] || { err "integrations/kiro/ao-workflow-runner.md 不存在"; return 1; }
  copy_to_dir "$src" "$PROJECT_DIR/.kiro/steering" "ao-workflow-runner.md"
  ok "Kiro: workflow-runner -> .kiro/steering/"
}

install_trae() {
  local src="$INTEGRATIONS/trae/ao-workflow-runner.md"
  [[ -f "$src" ]] || { err "integrations/trae/ao-workflow-runner.md 不存在"; return 1; }
  copy_to_dir "$src" "$PROJECT_DIR/.trae/rules" "ao-workflow-runner.md"
  ok "Trae: workflow-runner -> .trae/rules/"
}

install_openclaw() {
  local src="$INTEGRATIONS/openclaw"
  [[ -d "$src" ]] || { err "integrations/openclaw 不存在"; return 1; }
  ok "OpenClaw: 请参考 $src/README.md 配置"
}

install_opencode() {
  local src="$INTEGRATIONS/opencode/instructions.md"
  [[ -f "$src" ]] || { err "integrations/opencode/instructions.md 不存在"; return 1; }
  mkdir -p "$PROJECT_DIR/.opencode"
  copy_file "$src" "$PROJECT_DIR/.opencode/instructions.md"
  ok "OpenCode: workflow-runner -> .opencode/instructions.md"
}

install_aider() {
  local src="$INTEGRATIONS/aider/CONVENTIONS.md"
  [[ -f "$src" ]] || { err "integrations/aider/CONVENTIONS.md 不存在"; return 1; }
  copy_file "$src" "$PROJECT_DIR/CONVENTIONS.md"
  ok "Aider: workflow-runner -> CONVENTIONS.md"
}

install_windsurf() {
  local src="$INTEGRATIONS/windsurf/.windsurfrules"
  [[ -f "$src" ]] || { err "integrations/windsurf/.windsurfrules 不存在"; return 1; }
  copy_file "$src" "$PROJECT_DIR/.windsurfrules"
  ok "Windsurf: workflow-runner -> .windsurfrules"
}

install_antigravity() {
  local src="$INTEGRATIONS/antigravity/AGENTS.md"
  [[ -f "$src" ]] || { err "integrations/antigravity/AGENTS.md 不存在"; return 1; }
  copy_file "$src" "$PROJECT_DIR/AGENTS.md"
  ok "Antigravity: workflow-runner -> AGENTS.md"
}

install_gemini_cli() {
  local src="$INTEGRATIONS/gemini-cli/GEMINI.md"
  [[ -f "$src" ]] || { err "integrations/gemini-cli/GEMINI.md 不存在"; return 1; }
  copy_file "$src" "$PROJECT_DIR/GEMINI.md"
  ok "Gemini CLI: workflow-runner -> GEMINI.md"
}

install_qwen() {
  local src="$INTEGRATIONS/qwen/ao-workflow-runner.md"
  [[ -f "$src" ]] || { err "integrations/qwen/ao-workflow-runner.md 不存在"; return 1; }
  copy_to_dir "$src" "$PROJECT_DIR/.qwen/rules" "ao-workflow-runner.md"
  ok "Qwen Code: workflow-runner -> .qwen/rules/"
}

install_codex() {
  local src="$INTEGRATIONS/codex/instructions.md"
  [[ -f "$src" ]] || { err "integrations/codex/instructions.md 不存在"; return 1; }
  mkdir -p "$PROJECT_DIR/.codex"
  copy_file "$src" "$PROJECT_DIR/.codex/instructions.md"
  ok "Codex CLI: workflow-runner -> .codex/instructions.md"
}

install_deerflow() {
  local src="$INTEGRATIONS/deerflow"
  [[ -d "$src" ]] || { err "integrations/deerflow 不存在"; return 1; }
  if [[ -f "$src/SKILL.md" ]]; then
    local dest="${DEERFLOW_SKILLS_DIR:-$PROJECT_DIR/skills/custom}/ao-workflow-runner"
    mkdir -p "$dest"
    cp "$src/SKILL.md" "$dest/SKILL.md"
    ok "DeerFlow: workflow-runner -> $dest/SKILL.md"
  else
    ok "DeerFlow: 请参考 $src/README.md 配置"
  fi
}

install_tool() {
  case "$1" in
    claude-code) install_claude_code ;;
    copilot)     install_copilot     ;;
    cursor)      install_cursor      ;;
    kiro)        install_kiro        ;;
    trae)        install_trae        ;;
    openclaw)    install_openclaw    ;;
    opencode)    install_opencode    ;;
    aider)       install_aider       ;;
    windsurf)    install_windsurf    ;;
    antigravity) install_antigravity ;;
    gemini-cli)  install_gemini_cli  ;;
    qwen)        install_qwen        ;;
    codex)       install_codex       ;;
    deerflow)    install_deerflow    ;;
  esac
}

# --- 入口 ---
main() {
  local tool="all"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --tool)   tool="${2:?'--tool 需要一个值'}"; shift 2 ;;
      --help|-h) usage ;;
      *)        err "未知选项: $1"; usage ;;
    esac
  done

  header "Agency Orchestrator — 工作流执行器安装"
  dim "  安装 workflow-runner 指令到 AI 编程工具"
  printf "\n"

  if [[ "$tool" != "all" ]]; then
    local valid=false t
    for t in "${ALL_TOOLS[@]}"; do [[ "$t" == "$tool" ]] && valid=true && break; done
    if ! $valid; then
      err "未知工具 '$tool'。可选: ${ALL_TOOLS[*]}"
      exit 1
    fi
  fi

  SELECTED_TOOLS=()

  if [[ "$tool" != "all" ]]; then
    SELECTED_TOOLS=("$tool")
  else
    local t
    for t in "${ALL_TOOLS[@]}"; do
      if is_detected "$t" 2>/dev/null; then
        SELECTED_TOOLS+=("$t")
        printf "  ${C_GREEN}[*]${C_RESET}  %s  ${C_DIM}已检测到${C_RESET}\n" "$(tool_label "$t")"
      else
        printf "  ${C_DIM}[ ]  %s  未找到${C_RESET}\n" "$(tool_label "$t")"
      fi
    done
  fi

  if [[ ${#SELECTED_TOOLS[@]} -eq 0 ]]; then
    warn "未选择或检测到任何工具。"
    printf "\n"
    dim "  提示: 使用 --tool <名称> 强制安装指定工具。"
    dim "  可选: ${ALL_TOOLS[*]}"
    exit 0
  fi

  printf "\n"

  local installed=0 t
  for t in "${SELECTED_TOOLS[@]}"; do
    install_tool "$t"
    (( installed++ )) || true
  done

  printf "\n"
  ok "完成！已安装 $installed 个工具的 workflow-runner。"
  printf "\n"
  dim "  接下来安装 186 个 AI 角色:"
  dim "    git clone --depth 1 https://github.com/jnMetaCode/agency-agents-zh.git"
  dim "  然后复制工作流模板:"
  dim "    cp -r workflows/ your-project/workflows/"
  printf "\n"
}

main "$@"

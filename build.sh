#!/usr/bin/env bash
#
# deQRCode 构建脚本（macOS / Linux）
#
# 用法:
#   ./build.sh                     构建 Firefox 版本（默认）
#   ./build.sh --browser chrome    构建 Chrome / Edge 版本
#   ./build.sh --browser all       依次构建两个版本（dist 最终为最后一个）
#   ./build.sh --package           构建并打包到 ./artifacts/<browser>/
#   ./build.sh --skip-install      跳过依赖安装
#   ./build.sh --skip-tests        跳过单元测试
#   ./build.sh --eval              额外运行识别率评测门禁
#   ./build.sh --no-lint           跳过 web-ext lint
#   ./build.sh --clean             构建前清空 dist 与 artifacts
#   ./build.sh --help              显示帮助
#
set -euo pipefail

BROWSER="firefox"
DO_INSTALL=1
DO_TESTS=1
DO_EVAL=0
DO_LINT=1
DO_PACKAGE=0
DO_CLEAN=0

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'

info()  { printf '%s[build]%s %s\n' "$BLUE" "$RESET" "$*"; }
ok()    { printf '%s[ ok ]%s %s\n' "$GREEN" "$RESET" "$*"; }
warn()  { printf '%s[warn]%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail()  { printf '%s[fail]%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

usage() {
  sed -n '3,15p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -b|--browser) BROWSER="${2:-}"; shift 2 ;;
    --browser=*) BROWSER="${1#*=}"; shift ;;
    --skip-install) DO_INSTALL=0; shift ;;
    --skip-tests) DO_TESTS=0; shift ;;
    --eval) DO_EVAL=1; shift ;;
    --no-lint) DO_LINT=0; shift ;;
    -p|--package) DO_PACKAGE=1; shift ;;
    --clean) DO_CLEAN=1; shift ;;
    -h|--help) usage ;;
    *) fail "未知参数: $1（使用 --help 查看用法）" ;;
  esac
done

[[ "$BROWSER" == "firefox" || "$BROWSER" == "chrome" || "$BROWSER" == "all" ]] \
  || fail "--browser 只支持 firefox | chrome | all，当前: $BROWSER"

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
info "工作目录: $(pwd)"

# 1) Node 版本检查
command -v node >/dev/null 2>&1 || fail "未找到 node，请先安装 Node >= 18"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "${NODE_MAJOR:-0}" -ge 18 ]] || fail "Node 版本过低（当前 $(node -v)），需要 >= 18"
ok "Node $(node -v)"

# 2) 依赖安装
if [[ "$DO_INSTALL" -eq 1 ]]; then
  info "安装依赖…"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  ok "依赖就绪"
else
  warn "跳过依赖安装"
  [[ -d node_modules ]] || fail "node_modules 不存在，请去掉 --skip-install"
fi

VERSION="$(node -p 'require("./package.json").version')"
info "版本: $VERSION"

# 3) 清理
if [[ "$DO_CLEAN" -eq 1 ]]; then
  info "清理 dist 与 artifacts"
  rm -rf dist artifacts
fi

# 4) 静态资源：图标缺失时生成
if [[ -f icons/48.png && -f icons/96.png && -f icons/128.png ]]; then
  ok "图标已存在"
else
  info "生成占位图标…（如需自定义请替换 icons/*.png 后重新构建）"
  npm run icons
  ok "图标已生成"
fi

# 5) 单元测试
if [[ "$DO_TESTS" -eq 1 ]]; then
  info "运行单元测试…"
  npm test
  ok "单元测试通过"
fi

# 6) 识别率评测门禁
if [[ "$DO_EVAL" -eq 1 ]]; then
  info "运行识别率评测…"
  npm run eval
  ok "识别率门禁通过"
fi

# 7) 构建 + lint + 打包
build_one() {
  local target="$1"
  info "构建 $target 版本…"
  npm run "build:${target}"
  ok "构建完成 -> dist/"

  if [[ "$DO_LINT" -eq 1 ]]; then
    if [[ "$target" == "firefox" ]]; then
      info "运行 web-ext lint…"
      npm run lint
      ok "lint 通过"
    else
      warn "Chrome 版本跳过 web-ext lint（该工具面向 Firefox）"
    fi
  fi

  if [[ "$DO_PACKAGE" -eq 1 ]]; then
    local out="artifacts/${target}"
    # Firefox 分发包用 .xpi，Chrome/Edge 用 .zip（两者都是同构的 zip 包）
    local ext="zip"
    [[ "$target" == "firefox" ]] && ext="xpi"
    mkdir -p "$out"
    info "打包到 $out …"
    node node_modules/web-ext/bin/web-ext.js build \
      --source-dir ./dist \
      --artifacts-dir "$out" \
      --filename "deqrcode-${VERSION}-${target}.${ext}" \
      --overwrite-dest
    ok "打包完成 -> $out/"
  fi
}

if [[ "$BROWSER" == "all" ]]; then
  build_one firefox
  build_one chrome
else
  build_one "$BROWSER"
fi

ok "全部完成（browser=${BROWSER}, version=${VERSION}）"

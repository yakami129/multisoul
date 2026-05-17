#!/usr/bin/env bash
# publish-ios.sh — 一键构建并提交 iOS 到 TestFlight
#
# 用法：
#   ./scripts/publish-ios.sh              # 构建 + 提交
#   ./scripts/publish-ios.sh --build-only # 只构建，不提交
#   ./scripts/publish-ios.sh --submit-only # 只提交最新构建

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BUILD_ONLY=false
SUBMIT_ONLY=false

for arg in "$@"; do
  case $arg in
    --build-only)  BUILD_ONLY=true ;;
    --submit-only) SUBMIT_ONLY=true ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

# ── 颜色输出 ──────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[publish-ios]${NC} $*"; }
warn()    { echo -e "${YELLOW}[publish-ios]${NC} $*"; }
die()     { echo -e "${RED}[publish-ios] 错误：${NC}$*" >&2; exit 1; }

# ── 前置检查 ──────────────────────────────────────────────────
info "检查依赖..."

command -v eas  >/dev/null 2>&1 || die "未找到 eas-cli，请先运行: npm install -g eas-cli"
command -v node >/dev/null 2>&1 || die "未找到 node"

# 检查 EAS 登录状态
if ! eas whoami >/dev/null 2>&1; then
  warn "未登录 EAS，正在引导登录..."
  eas login
fi

info "当前 EAS 用户: $(eas whoami)"

# ── 切换到 mobile 目录 ────────────────────────────────────────
cd "$MOBILE_DIR"
info "工作目录: $MOBILE_DIR"
info "生成 Mermaid 静态资产..."
node scripts/generate-mermaid-asset.mjs

# 读取当前版本号
VERSION=$(node -p "require('./app.json').expo.version")
info "当前版本: $VERSION"

# ── 构建 ──────────────────────────────────────────────────────
if [ "$SUBMIT_ONLY" = false ]; then
  info "开始构建 iOS production 包（约 15-20 分钟）..."
  eas build --platform ios --profile production --non-interactive
  info "构建完成"
fi

# ── 提交 ──────────────────────────────────────────────────────
if [ "$BUILD_ONLY" = false ]; then
  info "提交到 TestFlight..."
  eas submit --platform ios --profile production --latest --non-interactive
  info "提交完成，苹果审核通常需要几小时到 1 天"
  info "查看状态: https://appstoreconnect.apple.com"
fi

info "全部完成 ✓  版本: $VERSION"

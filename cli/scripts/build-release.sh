#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"

# 从 Cargo.toml 读取版本号
VERSION=$(grep '^version' "$CLI_DIR/Cargo.toml" | head -1 | sed 's/.*"\(.*\)".*/\1/')

# 确定目标平台：优先使用环境变量，否则自动检测
if [ -n "${TARGET_PLATFORM:-}" ]; then
    PLATFORM="$TARGET_PLATFORM"
    TARGET_FLAG=(--target "$PLATFORM")
    BINARY_DIR="target/$PLATFORM/release"
else
    OS="$(uname -s)"
    ARCH="$(uname -m)"
    case "$OS" in
        Darwin)
            case "$ARCH" in
                arm64)  PLATFORM="aarch64-apple-darwin" ;;
                x86_64) PLATFORM="x86_64-apple-darwin" ;;
                *) echo "错误: 不支持的 macOS 架构: $ARCH"; exit 1 ;;
            esac
            ;;
        Linux)
            case "$ARCH" in
                x86_64) PLATFORM="x86_64-unknown-linux-gnu" ;;
                *) echo "错误: 不支持的 Linux 架构: $ARCH"; exit 1 ;;
            esac
            ;;
        *) echo "错误: 不支持的操作系统: $OS"; exit 1 ;;
    esac
    TARGET_FLAG=()
    BINARY_DIR="target/release"
fi

echo "=== msctl 发布构建 ==="
echo "版本:   $VERSION"
echo "平台:   $PLATFORM"
echo ""

# 进入 CLI 目录并构建
cd "$CLI_DIR"
echo "正在构建 release 版本..."
if [ ${#TARGET_FLAG[@]} -gt 0 ]; then
    cargo build --release "${TARGET_FLAG[@]}"
else
    cargo build --release
fi

# 打包为 tar.gz
BINARY="$BINARY_DIR/msctl"
PACKAGE_NAME="msctl-${VERSION}-${PLATFORM}.tar.gz"
PACKAGE_PATH="$CLI_DIR/$PACKAGE_NAME"

echo "正在打包: $PACKAGE_NAME"
tar -czf "$PACKAGE_PATH" -C "$BINARY_DIR" msctl

echo ""
echo "✓ 构建完成"
echo "打包文件: $PACKAGE_PATH"

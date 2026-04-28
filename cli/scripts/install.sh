#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# MultiSoul CLI (msctl) 一键安装脚本
# 用法: curl -fsSL https://.../install.sh | bash
# ============================================================

# ---- 颜色定义 ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ---- 配置 ----
GITHUB_REPO="${GITHUB_REPO:-yakami129/multisoul}"
BASE_URL="https://github.com/${GITHUB_REPO}/releases/download"
MSCTL_VERSION="${MSCTL_VERSION:-latest}"
MSCTL_INSTALL_DIR="${MSCTL_INSTALL_DIR:-}"
BINARY_NAME="msctl"

# ---- 工具函数 ----
info()    { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }

github_curl() {
    local token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
    local args=(-fsSL)
    if [ -n "$token" ]; then
        args+=(
            -H "Authorization: Bearer ${token}"
            -H "X-GitHub-Api-Version: 2022-11-28"
        )
    fi
    curl "${args[@]}" "$@"
}

# ---- 平台检测 ----
detect_platform() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        Darwin)
            case "$arch" in
                arm64) echo "aarch64-apple-darwin" ;;
                x86_64) echo "x86_64-apple-darwin" ;;
                *) error "不支持的 macOS 架构: $arch"; exit 1 ;;
            esac
            ;;
        Linux)
            case "$arch" in
                x86_64) echo "x86_64-unknown-linux-gnu" ;;
                *) error "不支持的 Linux 架构: $arch"; exit 1 ;;
            esac
            ;;
        *)
            error "不支持的操作系统: $os"
            exit 1
            ;;
    esac
}

resolve_version() {
    if [ "$MSCTL_VERSION" != "latest" ]; then
        echo "$MSCTL_VERSION"
        return
    fi

    if command -v curl >/dev/null 2>&1; then
        github_curl "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
            | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
            | head -1
        return
    fi

    error "需要 curl 来解析 latest 版本"
    exit 1
}

install_dir() {
    if [ -n "$MSCTL_INSTALL_DIR" ]; then
        echo "$MSCTL_INSTALL_DIR"
    elif [ -d "$HOME/.local/bin" ]; then
        echo "$HOME/.local/bin"
    else
        echo "/usr/local/bin"
    fi
}

# ---- 下载与安装 ----
download_and_install() {
    local version platform archive url tmp_dir target_dir target_bin
    version="$(resolve_version)"
    if [ -z "$version" ]; then
        error "无法解析发布版本"
        exit 1
    fi
    platform="$(detect_platform)"
    archive="msctl-${version#v}-${platform}.tar.gz"
    url="${BASE_URL}/${version}/${archive}"
    tmp_dir="$(mktemp -d)"
    target_dir="$(install_dir)"
    target_bin="${target_dir}/${BINARY_NAME}"

    info "下载 ${url}"
    github_curl "$url" -o "${tmp_dir}/${archive}"
    tar -xzf "${tmp_dir}/${archive}" -C "$tmp_dir"

    mkdir -p "$target_dir"
    if [ -w "$target_dir" ]; then
        cp "${tmp_dir}/msctl-${version#v}-${platform}/${BINARY_NAME}" "$target_bin"
    else
        warn "${target_dir} 需要管理员权限"
        sudo cp "${tmp_dir}/msctl-${version#v}-${platform}/${BINARY_NAME}" "$target_bin"
    fi
    chmod +x "$target_bin"
    rm -rf "$tmp_dir"
    success "已安装到 ${target_bin}"
}

# ---- 验证安装 ----
verify_installation() {
    local target_bin
    target_bin="$(install_dir)/${BINARY_NAME}"
    "$target_bin" --version
}

# ---- 主流程 ----
main() {
    if ! command -v curl >/dev/null 2>&1; then
        error "请先安装 curl"
        exit 1
    fi

    download_and_install
    verify_installation
}

main "$@"

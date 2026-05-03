#!/usr/bin/env bash
# R12 · iOS Info.plist 权限声明守护
# 检查 mobile/package.json 中安装的 Expo 权限模块，
# 确认 mobile/ios/MultiSoul/Info.plist 里声明了对应的 NSXxxUsageDescription。
#
# 用法：
#   bash scripts/check-ios-permissions.sh           # 全量（CI）
#   bash scripts/check-ios-permissions.sh --staged  # 仅在 staged 含相关文件时跑（pre-commit）
#
# 维护：新增需要权限的 Expo 模块时，在下方 MAPPINGS 中追加一行，格式：
#   "expo-module-name:NSXxxUsageDescription[,NsYyyUsageDescription]"

set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
PACKAGE_JSON="$repo_root/mobile/package.json"
INFO_PLIST="$repo_root/mobile/ios/MultiSoul/Info.plist"

# --staged 模式：仅当 staged 文件含 mobile/package.json 或 mobile/ios/** 时才运行
if [[ "${1:-}" == "--staged" ]]; then
  staged=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
  if ! echo "$staged" | grep -qE '^mobile/(package\.json|ios/)'; then
    exit 0
  fi
fi

# 映射表：每行 "expo-module:key1,key2"
MAPPINGS=(
  "expo-image-picker:NSPhotoLibraryUsageDescription"
  "expo-camera:NSCameraUsageDescription"
  "expo-location:NSLocationWhenInUseUsageDescription"
  "expo-media-library:NSPhotoLibraryUsageDescription,NSPhotoLibraryAddUsageDescription"
  "expo-contacts:NSContactsUsageDescription"
  "expo-calendar:NSCalendarsUsageDescription"
  "expo-audio:NSMicrophoneUsageDescription"
)

fail=0

for entry in "${MAPPINGS[@]}"; do
  module="${entry%%:*}"
  keys_str="${entry#*:}"

  # 检查模块是否在 package.json dependencies 或 devDependencies 中
  if ! python3 -c "
import json, sys
d = json.load(open('$PACKAGE_JSON'))
deps = {**d.get('dependencies', {}), **d.get('devDependencies', {})}
sys.exit(0 if '$module' in deps else 1)
" 2>/dev/null; then
    continue
  fi

  # 检查每个必要 key 是否在 Info.plist 中
  IFS=',' read -ra keys <<< "$keys_str"
  for key in "${keys[@]}"; do
    if ! grep -q "<key>${key}</key>" "$INFO_PLIST"; then
      echo "ERROR [R12]: '$module' is installed but Info.plist is missing <key>${key}</key>"
      echo "  Fix: add <key>${key}</key><string>Describe why the app needs this</string> to mobile/ios/MultiSoul/Info.plist"
      fail=1
    fi
  done
done

if [[ $fail -eq 1 ]]; then
  echo ""
  echo "R12 failed. See docs/quality/mechanized-constraints.md §R12 for the full module→key mapping."
  exit 1
fi

exit 0

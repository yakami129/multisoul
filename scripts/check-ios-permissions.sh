#!/usr/bin/env bash
# R12 · iOS Info.plist 权限与后台能力声明守护
# 检查 mobile/package.json 中安装的 Expo 权限模块，
# 确认对应 NSXxxUsageDescription 已声明：
#   - 若存在 mobile/ios/MultiSoul/Info.plist（已 prebuild 并提交），则查 plist；
#   - 否则查 mobile/app.json 的 expo.ios.infoPlist（CNG：ios/ 被 gitignore 的常见情况）。
# 同时禁止声明 MultiSoul 未实际提供的 iOS background audio mode。
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
APP_JSON="$repo_root/mobile/app.json"

key_declared_in_ios_metadata() {
  local key="$1"
  if [[ -f "$INFO_PLIST" ]]; then
    grep -q "<key>${key}</key>" "$INFO_PLIST"
    return $?
  fi
  python3 -c "
import json, sys
key = sys.argv[1]
with open(sys.argv[2], encoding='utf-8') as f:
    d = json.load(f)
info = (d.get('expo') or {}).get('ios') or {}
info_plist = info.get('infoPlist') or {}
val = info_plist.get(key)
sys.exit(0 if isinstance(val, str) and val.strip() else 1)
" "$key" "$APP_JSON"
}

expo_audio_background_modes_disabled() {
  python3 - "$APP_JSON" <<'PY'
import json
import sys

app_json_path = sys.argv[1]
with open(app_json_path, encoding='utf-8') as f:
    data = json.load(f)

plugins = ((data.get('expo') or {}).get('plugins') or [])
for plugin in plugins:
    if plugin == 'expo-audio':
        print("ERROR [R12]: expo-audio config plugin enables background audio by default")
        print('  Fix: replace "expo-audio" with ["expo-audio", {"enableBackgroundPlayback": false, "enableBackgroundRecording": false, ...}]')
        sys.exit(1)

    if isinstance(plugin, list) and plugin and plugin[0] == 'expo-audio':
        options = plugin[1] if len(plugin) > 1 and isinstance(plugin[1], dict) else {}
        playback_disabled = options.get('enableBackgroundPlayback') is False
        recording_disabled = options.get('enableBackgroundRecording') is False
        if not playback_disabled or not recording_disabled:
            print("ERROR [R12]: expo-audio must not declare iOS background audio modes")
            print('  Fix: set both "enableBackgroundPlayback": false and "enableBackgroundRecording": false in mobile/app.json')
            sys.exit(1)
        sys.exit(0)

sys.exit(0)
PY
}

background_audio_declared_in_app_json() {
  python3 - "$APP_JSON" <<'PY'
import json
import sys

with open(sys.argv[1], encoding='utf-8') as f:
    data = json.load(f)

info = ((data.get('expo') or {}).get('ios') or {}).get('infoPlist') or {}
modes = info.get('UIBackgroundModes') or []
sys.exit(0 if isinstance(modes, list) and 'audio' in modes else 1)
PY
}

background_audio_declared_in_info_plist() {
  [[ -f "$INFO_PLIST" ]] || return 1
  python3 - "$INFO_PLIST" <<'PY'
import plistlib
import sys

with open(sys.argv[1], 'rb') as f:
    data = plistlib.load(f)

modes = data.get('UIBackgroundModes') or []
sys.exit(0 if isinstance(modes, list) and 'audio' in modes else 1)
PY
}

# --staged 模式：仅当 staged 文件含 mobile/package.json、mobile/app.json 或 mobile/ios/** 时才运行
if [[ "${1:-}" == "--staged" ]]; then
  staged=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
  if ! echo "$staged" | grep -qE '^mobile/(package\.json|app\.json|ios/)'; then
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
  "expo-speech-recognition:NSMicrophoneUsageDescription,NSSpeechRecognitionUsageDescription"
)

fail=0

if ! expo_audio_background_modes_disabled; then
  fail=1
fi

if background_audio_declared_in_app_json; then
  echo "ERROR [R12]: mobile/app.json declares UIBackgroundModes audio, but MultiSoul does not provide persistent background audio"
  echo '  Fix: remove "audio" from expo.ios.infoPlist.UIBackgroundModes'
  fail=1
fi

if background_audio_declared_in_info_plist; then
  echo "ERROR [R12]: mobile/ios/MultiSoul/Info.plist declares UIBackgroundModes audio, but MultiSoul does not provide persistent background audio"
  echo "  Fix: remove the audio entry from UIBackgroundModes or regenerate ios/ after disabling expo-audio background modes"
  fail=1
fi

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

  # 检查每个必要 key 是否在 Info.plist 或 app.json infoPlist 中
  IFS=',' read -ra keys <<< "$keys_str"
  for key in "${keys[@]}"; do
    if ! key_declared_in_ios_metadata "$key"; then
      echo "ERROR [R12]: '$module' is installed but usage description for '${key}' is missing"
      if [[ -f "$INFO_PLIST" ]]; then
        echo "  Fix: add <key>${key}</key><string>…</string> to mobile/ios/MultiSoul/Info.plist"
      else
        echo "  Fix: add \"${key}\": \"…\" under expo.ios.infoPlist in mobile/app.json (native ios/ is not in repo)"
      fi
      fail=1
    fi
  done
done

if [[ $fail -eq 1 ]]; then
  echo ""
  echo "R12 failed. See docs/quality/mechanized-constraints.md §R12 for iOS metadata constraints."
  exit 1
fi

exit 0

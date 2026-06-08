#!/usr/bin/env bash
# publish-ios-local.sh - Build and submit iOS locally without EAS Build.
#
# Usage:
#   ./scripts/publish-ios-local.sh
#   ./scripts/publish-ios-local.sh --build-only
#   ./scripts/publish-ios-local.sh --submit-only --ipa dist/ios-local/MultiSoul.ipa
#
# Required for submit:
#   APP_STORE_CONNECT_API_KEY_ID=...
#   APP_STORE_CONNECT_API_ISSUER_ID=...
#   APP_STORE_CONNECT_API_KEY_PATH=/absolute/path/AuthKey_XXXX.p8
#
# Versioning (canonical, tracked in git): mobile/app.json
#   - expo.version  -> CFBundleShortVersionString (marketing)
#   - expo.ios.buildNumber -> CFBundleVersion + Xcode CURRENT_PROJECT_VERSION
# Each run increments buildNumber in app.json then syncs expo.ios.infoPlist + versions
# into ios/MultiSoul/Info.plist (ios/ is gitignored; app.json is the source of truth).
#
# Signing: team for export plist is read from ios/MultiSoul.xcodeproj DEVELOPMENT_TEAM.
# Archive passes DEVELOPMENT_TEAM on the CLI when pbxproj omits it; export plist uses TEAM_ID.
# Override with MULTISOUL_IOS_TEAM_ID=<10-char-team> if you fork the app to another org.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_DIR="$MOBILE_DIR/ios"
APP_JSON="${LOCAL_IOS_APP_JSON:-$MOBILE_DIR/app.json}"

BUILD_ONLY=false
SUBMIT_ONLY=false
IPA_PATH=""
SKIP_INSTALL=false
SKIP_PODS=false
USE_XCODE_ACCOUNT="${LOCAL_IOS_USE_XCODE_ACCOUNT:-false}"

for arg in "$@"; do
  case "$arg" in
    --build-only) BUILD_ONLY=true ;;
    --submit-only) SUBMIT_ONLY=true ;;
    --skip-install) SKIP_INSTALL=true ;;
    --skip-pods) SKIP_PODS=true ;;
    --ipa=*) IPA_PATH="${arg#--ipa=}" ;;
    --ipa) echo "Use --ipa=/path/to/app.ipa"; exit 1 ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${GREEN}[publish-ios-local]${NC} $*"; }
warn() { echo -e "${YELLOW}[publish-ios-local]${NC} $*"; }
die()  { echo -e "${RED}[publish-ios-local] error:${NC} $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    die "Missing env var: $name"
  fi
}

ensure_core_simulator_available() {
  local output
  output="$(xcrun simctl list runtimes 2>&1 || true)"
  if echo "$output" | grep -Eq "Unable to locate device set|CoreSimulatorService connection became invalid|Unable to connect to simulator"; then
    die "CoreSimulatorService is unavailable. Open Xcode/Simulator in a normal macOS session or repair Xcode platform runtimes before building locally."
  fi
}

if [ "$BUILD_ONLY" = true ] && [ "$SUBMIT_ONLY" = true ]; then
  die "--build-only and --submit-only cannot be used together"
fi

if [ "$(uname -s)" != "Darwin" ]; then
  die "Local iOS packaging must run on macOS"
fi

WORKSPACE="${LOCAL_IOS_WORKSPACE:-$IOS_DIR/MultiSoul.xcworkspace}"
PROJECT="${LOCAL_IOS_PROJECT:-$IOS_DIR/MultiSoul.xcodeproj}"
USE_PROJECT="${LOCAL_IOS_USE_PROJECT:-false}"
SCHEME="${LOCAL_IOS_SCHEME:-MultiSoul}"
CONFIGURATION="${LOCAL_IOS_CONFIGURATION:-Release}"
BUNDLE_ID="${LOCAL_IOS_BUNDLE_ID:-com.yakami0129.multisoul}"
EXPORT_METHOD="${LOCAL_IOS_EXPORT_METHOD:-app-store-connect}"
DIST_DIR="${LOCAL_IOS_DIST_DIR:-$MOBILE_DIR/dist/ios-local}"
ARCHIVE_PATH="${LOCAL_IOS_ARCHIVE_PATH:-$DIST_DIR/$SCHEME.xcarchive}"
EXPORT_DIR="${LOCAL_IOS_EXPORT_DIR:-$DIST_DIR/export}"
DERIVED_DATA_PATH="${LOCAL_IOS_DERIVED_DATA_PATH:-$DIST_DIR/DerivedData}"
LOG_DIR="$DIST_DIR/logs"
EXPORT_OPTIONS="$DIST_DIR/ExportOptions.plist"
INFO_PLIST="$IOS_DIR/$SCHEME/Info.plist"
PBXPROJ="$IOS_DIR/$SCHEME.xcodeproj/project.pbxproj"

ios_team_from_pbxproj() {
  local proj="$1"
  local v=""
  if [ -f "$proj" ]; then
    v="$(sed -n 's/^[[:space:]]*DEVELOPMENT_TEAM = \(.*\);$/\1/p' "$proj" | head -n1 | tr -d ' 	')"
  fi
  if [ -z "$v" ]; then
    v="2BF8G9AN4L"
  fi
  printf '%s' "$v"
}

TEAM_ID="${MULTISOUL_IOS_TEAM_ID:-$(ios_team_from_pbxproj "$PBXPROJ")}"

prepare_api_key_dir() {
  require_env APP_STORE_CONNECT_API_KEY_ID
  require_env APP_STORE_CONNECT_API_ISSUER_ID
  require_env APP_STORE_CONNECT_API_KEY_PATH

  [ -f "$APP_STORE_CONNECT_API_KEY_PATH" ] || die "API key file not found: $APP_STORE_CONNECT_API_KEY_PATH"

  local expected_name="AuthKey_${APP_STORE_CONNECT_API_KEY_ID}.p8"
  ASC_KEY_DIR="${TMPDIR:-/tmp}/multisoul-asc-keys"
  mkdir -p "$ASC_KEY_DIR"
  cp "$APP_STORE_CONNECT_API_KEY_PATH" "$ASC_KEY_DIR/$expected_name"
  chmod 600 "$ASC_KEY_DIR/$expected_name"
  export API_PRIVATE_KEYS_DIR="$ASC_KEY_DIR"
}

xcode_auth_args=()
prepare_xcode_auth_args() {
  xcode_auth_args=()
  if [ "$USE_XCODE_ACCOUNT" != true ]; then
    require_env APP_STORE_CONNECT_API_KEY_ID
    require_env APP_STORE_CONNECT_API_ISSUER_ID
    require_env APP_STORE_CONNECT_API_KEY_PATH
    [ -f "$APP_STORE_CONNECT_API_KEY_PATH" ] || die "API key file not found: $APP_STORE_CONNECT_API_KEY_PATH"
    xcode_auth_args=(
      -authenticationKeyPath "$APP_STORE_CONNECT_API_KEY_PATH"
      -authenticationKeyID "$APP_STORE_CONNECT_API_KEY_ID"
      -authenticationKeyIssuerID "$APP_STORE_CONNECT_API_ISSUER_ID"
    )
    return
  fi

  if [ -n "${APP_STORE_CONNECT_API_KEY_ID:-}" ] || \
     [ -n "${APP_STORE_CONNECT_API_ISSUER_ID:-}" ] || \
     [ -n "${APP_STORE_CONNECT_API_KEY_PATH:-}" ]; then
    require_env APP_STORE_CONNECT_API_KEY_ID
    require_env APP_STORE_CONNECT_API_ISSUER_ID
    require_env APP_STORE_CONNECT_API_KEY_PATH
    [ -f "$APP_STORE_CONNECT_API_KEY_PATH" ] || die "API key file not found: $APP_STORE_CONNECT_API_KEY_PATH"
    xcode_auth_args=(
      -authenticationKeyPath "$APP_STORE_CONNECT_API_KEY_PATH"
      -authenticationKeyID "$APP_STORE_CONNECT_API_KEY_ID"
      -authenticationKeyIssuerID "$APP_STORE_CONNECT_API_ISSUER_ID"
    )
  fi
}

run_xcodebuild_archive() {
  local args=(archive)
  if [ "$USE_PROJECT" = true ]; then
    args+=(-project "$PROJECT")
  else
    args+=(-workspace "$WORKSPACE")
  fi
  args+=(
    -scheme "$SCHEME"
    -configuration "$CONFIGURATION"
    -destination "generic/platform=iOS"
    -archivePath "$ARCHIVE_PATH"
    -derivedDataPath "$DERIVED_DATA_PATH"
    -allowProvisioningUpdates
    CODE_SIGN_STYLE=Automatic
    # Ensure archive has an explicit team when project.pbxproj omits DEVELOPMENT_TEAM.
    DEVELOPMENT_TEAM="$TEAM_ID"
    PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID"
  )
  if [ "${#xcode_auth_args[@]}" -gt 0 ]; then
    args+=("${xcode_auth_args[@]}")
  fi
  xcodebuild "${args[@]}"
}

run_xcodebuild_export() {
  local args=(
    -exportArchive
    -archivePath "$ARCHIVE_PATH"
    -exportPath "$EXPORT_DIR"
    -exportOptionsPlist "$EXPORT_OPTIONS"
    -allowProvisioningUpdates
  )
  if [ "${#xcode_auth_args[@]}" -gt 0 ]; then
    args+=("${xcode_auth_args[@]}")
  fi
  xcodebuild "${args[@]}"
}

read_marketing_version() {
  node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const v=j.expo&&j.expo.version;if(!v)process.exit(1);process.stdout.write(String(v));" "$APP_JSON"
}

read_build_number() {
  node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const b=j.expo&&j.expo.ios&&j.expo.ios.buildNumber;if(b==null||String(b).trim()==='')process.exit(2);process.stdout.write(String(b).trim());" "$APP_JSON"
}

app_json_set_ios_build_number() {
  local val="$1"
  APP_JSON="$APP_JSON" NEXT_IOS_BUILD="$val" node -e "const fs=require('fs');const p=process.env.APP_JSON;const v=String(process.env.NEXT_IOS_BUILD);const j=JSON.parse(fs.readFileSync(p,'utf8'));if(!j.expo)j.expo={};if(!j.expo.ios)j.expo.ios={};j.expo.ios.buildNumber=v;fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"
}

sync_native_ios_info_plist_from_app_json() {
  [ -f "$INFO_PLIST" ] || return 0
  APP_JSON="$APP_JSON" INFO_PLIST="$INFO_PLIST" node <<'NODE'
const fs = require('fs');
const { execFileSync } = require('child_process');

const appJson = JSON.parse(fs.readFileSync(process.env.APP_JSON, 'utf8'));
const infoPlist = appJson.expo?.ios?.infoPlist;
if (!infoPlist || typeof infoPlist !== 'object') process.exit(0);

const plist = process.env.INFO_PLIST;
const buddy = '/usr/libexec/PlistBuddy';

function keyExists(key) {
  try {
    execFileSync(buddy, ['-c', `Print :${key}`, plist], { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function setValue(key, value) {
  if (typeof value === 'boolean') {
    const boolVal = value ? 'true' : 'false';
    if (keyExists(key)) {
      execFileSync(buddy, ['-c', `Set :${key} ${boolVal}`, plist]);
    } else {
      execFileSync(buddy, ['-c', `Add :${key} bool ${boolVal}`, plist]);
    }
    return;
  }
  if (typeof value === 'string') {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    if (keyExists(key)) {
      execFileSync(buddy, ['-c', `Set :${key} "${escaped}"`, plist]);
    } else {
      execFileSync(buddy, ['-c', `Add :${key} string "${escaped}"`, plist]);
    }
  }
}

for (const [key, value] of Object.entries(infoPlist)) {
  setValue(key, value);
}
NODE
}

sync_native_ios_versions_from_app_json() {
  local m b
  m="$(read_marketing_version)"
  b="$(read_build_number)"
  [ -n "$m" ] || die "Missing expo.version in app.json"
  [ -n "$b" ] || die "Missing expo.ios.buildNumber in app.json"
  if [ -f "$INFO_PLIST" ]; then
    sync_native_ios_info_plist_from_app_json
    /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $m" "$INFO_PLIST" \
      || die "PlistBuddy Set CFBundleShortVersionString failed"
    /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $b" "$INFO_PLIST" \
      || die "PlistBuddy Set CFBundleVersion failed"
  fi
  if [ -f "$PBXPROJ" ]; then
    perl -0pi -e "s/CURRENT_PROJECT_VERSION = [^;]+;/CURRENT_PROJECT_VERSION = $b;/g" "$PBXPROJ"
  fi
}

ensure_ios_build_number_in_app_json() {
  [ -f "$APP_JSON" ] || die "Missing app.json (expected at $APP_JSON)"
  if read_build_number >/dev/null 2>&1; then
    return 0
  fi
  local pb=""
  if [ -f "$INFO_PLIST" ]; then
    pb="$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$INFO_PLIST" 2>/dev/null || true)"
  fi
  if [[ "$pb" =~ ^[0-9]+$ ]]; then
    warn "expo.ios.buildNumber missing in app.json; bootstrapping from Info.plist: $pb"
    app_json_set_ios_build_number "$pb"
    return 0
  fi
  die "Set expo.ios.buildNumber in mobile/app.json (git-tracked). Local ios/ is gitignored; build numbers must not live only in Info.plist."
}

increment_build_number() {
  local current next
  ensure_ios_build_number_in_app_json
  sync_native_ios_versions_from_app_json
  current="$(read_build_number)"
  if ! [[ "$current" =~ ^[0-9]+$ ]]; then
    die "expo.ios.buildNumber must be numeric for local auto-increment, got: $current"
  fi
  next="$((current + 1))"
  info "Incrementing iOS build number in app.json from $current to $next"
  app_json_set_ios_build_number "$next"
  sync_native_ios_versions_from_app_json
}

write_export_options() {
  mkdir -p "$DIST_DIR"
  cat > "$EXPORT_OPTIONS" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>$EXPORT_METHOD</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>$TEAM_ID</string>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>uploadBitcode</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
EOF
}

build_ipa() {
  require_cmd node
  require_cmd pnpm
  require_cmd pod
  require_cmd xcodebuild
  require_cmd xcrun

  [ -d "$IOS_DIR" ] || die "Missing iOS project: $IOS_DIR"
  if [ "$USE_PROJECT" = true ]; then
    [ -d "$PROJECT" ] || die "Missing project: $PROJECT"
  else
    [ -d "$WORKSPACE" ] || die "Missing workspace: $WORKSPACE"
  fi
  [ -f "$APP_JSON" ] || die "Missing app.json: $APP_JSON"
  [ -f "$INFO_PLIST" ] || die "Missing Info.plist: $INFO_PLIST"
  [ -f "$PBXPROJ" ] || die "Missing Xcode project file: $PBXPROJ"

  mkdir -p "$DIST_DIR" "$EXPORT_DIR" "$LOG_DIR"

  info "Working directory: $MOBILE_DIR"
  info "Version: $(read_marketing_version)"
  info "iOS team for export plist: $TEAM_ID (from Xcode project; set MULTISOUL_IOS_TEAM_ID to override)"
  prepare_xcode_auth_args
  ensure_core_simulator_available
  increment_build_number
  info "Build number: $(read_build_number)"

  cd "$MOBILE_DIR"
  if [ "$SKIP_INSTALL" = false ]; then
    info "Installing JavaScript dependencies"
    CI=true pnpm install --frozen-lockfile
  else
    warn "Skipping pnpm install"
  fi
  info "Generating Mermaid static asset"
  node scripts/generate-mermaid-asset.mjs

  if [ "$SKIP_PODS" = false ]; then
    info "Installing CocoaPods"
    (cd "$IOS_DIR" && pod install)
  else
    warn "Skipping pod install"
  fi

  write_export_options

  info "Archiving $SCHEME"
  set -o pipefail
  run_xcodebuild_archive | tee "$LOG_DIR/archive.log"

  info "Exporting ipa"
  rm -rf "$EXPORT_DIR"
  mkdir -p "$EXPORT_DIR"
  run_xcodebuild_export | tee "$LOG_DIR/export.log"

  IPA_PATH="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' -print -quit)"
  [ -n "$IPA_PATH" ] || die "No ipa found in $EXPORT_DIR"
  info "IPA: $IPA_PATH"
}

submit_ipa() {
  require_cmd xcrun
  prepare_api_key_dir
  mkdir -p "$LOG_DIR"

  if [ -z "$IPA_PATH" ]; then
    IPA_PATH="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' -print -quit || true)"
  fi
  [ -n "$IPA_PATH" ] || die "Missing ipa path. Pass --ipa=/path/to/app.ipa or build first."
  [ -f "$IPA_PATH" ] || die "IPA not found: $IPA_PATH"

  info "Uploading IPA to App Store Connect"
  local upload_log="$LOG_DIR/upload.log"
  set +e
  xcrun altool --upload-app \
    --type ios \
    --file "$IPA_PATH" \
    --apiKey "$APP_STORE_CONNECT_API_KEY_ID" \
    --apiIssuer "$APP_STORE_CONNECT_API_ISSUER_ID" \
    2>&1 | tee "$upload_log"
  local upload_status="${PIPESTATUS[0]}"
  set -e

  if [ "$upload_status" -ne 0 ] || grep -Eq "ERROR:|Failed to upload|ENTITY_ERROR" "$upload_log"; then
    die "Upload failed. See log: $upload_log"
  fi

  info "Upload submitted. Check TestFlight processing in App Store Connect."
}

info "Checking local iOS packaging environment"
require_cmd xcodebuild
require_cmd xcrun
xcodebuild -version

if [ "$SUBMIT_ONLY" = false ]; then
  build_ipa
fi

if [ "$BUILD_ONLY" = false ]; then
  submit_ipa
fi

info "Done"

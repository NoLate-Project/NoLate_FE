#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLATFORM="${1:-all}"

IOS_SDK_VERSION="${TMAP_IOS_SDK_VERSION:-3.7}"
ANDROID_SDK_VERSION="${TMAP_ANDROID_SDK_VERSION:-3.7}"
ANDROID_VSM_VERSION="2.0.14"
DOWNLOAD_ORIGIN="https://tmapapi.tmapmobility.com"

case "$PLATFORM" in
  all|ios|android) ;;
  *)
    echo "Usage: $0 [all|ios|android]" >&2
    exit 2
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to install the TMAP SDK." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to parse the TMAP download response." >&2
  exit 1
fi
if ! command -v unzip >/dev/null 2>&1; then
  echo "unzip is required to install the TMAP SDK." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nolate-tmap-sdk.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

download_sdk() {
  local encoded_name="$1"
  local destination="$2"
  local response_file="$WORK_DIR/presigned.json"
  local signed_url

  curl --fail --silent --show-error --location \
    "$DOWNLOAD_ORIGIN/presigned-url/$encoded_name" \
    --output "$response_file"
  signed_url="$(node -e '
    const fs = require("fs");
    const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (typeof payload.url !== "string" || payload.url.length === 0) process.exit(1);
    process.stdout.write(payload.url);
  ' "$response_file")"
  curl --fail --silent --show-error --location --retry 3 \
    "$signed_url" \
    --output "$destination"
}

install_ios() {
  local vendor_dir="$PROJECT_DIR/modules/nolate-tmap/ios/Vendor"
  local version_file="$vendor_dir/.tmap-sdk-version"
  local expected_version="ios-$IOS_SDK_VERSION"

  if [[ -f "$version_file" ]] && [[ "$(<"$version_file")" == "$expected_version" ]] \
    && [[ -d "$vendor_dir/TMapSDK.xcframework" ]] \
    && [[ -d "$vendor_dir/VSMSDK.xcframework" ]]; then
    echo "TMAP iOS SDK $IOS_SDK_VERSION is already installed."
    return
  fi
  if ! command -v xcodebuild >/dev/null 2>&1; then
    echo "xcodebuild is required to assemble the TMAP iOS XCFramework." >&2
    exit 1
  fi

  local archive="$WORK_DIR/tmap-ios.zip"
  local unpacked="$WORK_DIR/tmap-ios"
  download_sdk "%5BiOS_VSM%5DTmapSDK_${IOS_SDK_VERSION}.zip" "$archive"
  mkdir -p "$unpacked"
  unzip -q "$archive" -d "$unpacked"

  local simulator_framework
  local device_framework
  local vsm_xcframework
  simulator_framework="$(find "$unpacked" -path '*개발(시뮬레이터)/TMapSDK.framework' -type d -print -quit)"
  device_framework="$(find "$unpacked" -path '*배포(디바이스)/TMapSDK.framework' -type d -print -quit)"
  vsm_xcframework="$(find "$unpacked" -path '*개발(시뮬레이터)/VSMSDK.xcframework' -type d -print -quit)"

  if [[ -z "$simulator_framework" || -z "$device_framework" || -z "$vsm_xcframework" ]]; then
    echo "The TMAP iOS archive does not contain the expected frameworks." >&2
    exit 1
  fi

  mkdir -p "$vendor_dir"
  rm -rf "$vendor_dir/TMapSDK.xcframework" "$vendor_dir/VSMSDK.xcframework"
  xcodebuild -create-xcframework \
    -framework "$device_framework" \
    -framework "$simulator_framework" \
    -output "$vendor_dir/TMapSDK.xcframework" >/dev/null
  cp -R "$vsm_xcframework" "$vendor_dir/VSMSDK.xcframework"
  printf '%s\n' "$expected_version" > "$version_file"
  echo "Installed TMAP iOS SDK $IOS_SDK_VERSION."
}

install_android() {
  local libs_dir="$PROJECT_DIR/modules/nolate-tmap/android/libs"
  local version_file="$libs_dir/.tmap-sdk-version"
  local expected_version="android-$ANDROID_SDK_VERSION-vsm-$ANDROID_VSM_VERSION"

  if [[ -f "$version_file" ]] && [[ "$(<"$version_file")" == "$expected_version" ]] \
    && [[ -f "$libs_dir/tmap-sdk-${ANDROID_SDK_VERSION}.aar" ]] \
    && [[ -f "$libs_dir/vsm-tmap-sdk-v2-eaa-${ANDROID_VSM_VERSION}.aar" ]]; then
    echo "TMAP Android SDK $ANDROID_SDK_VERSION is already installed."
    return
  fi

  local archive="$WORK_DIR/tmap-android.zip"
  local unpacked="$WORK_DIR/tmap-android"
  download_sdk "%5BAndroid%5DTMapVSMSDK_${ANDROID_SDK_VERSION}.zip" "$archive"
  mkdir -p "$unpacked"
  unzip -q "$archive" -d "$unpacked"

  local tmap_aar
  local vsm_aar
  tmap_aar="$(find "$unpacked" -path "*/lib/tmap-sdk-${ANDROID_SDK_VERSION}.aar" -type f -print -quit)"
  vsm_aar="$(find "$unpacked" -path "*/lib/vsm-tmap-sdk-v2-eaa-${ANDROID_VSM_VERSION}.aar" -type f -print -quit)"

  if [[ -z "$tmap_aar" || -z "$vsm_aar" ]]; then
    echo "The TMAP Android archive does not contain the expected AAR files." >&2
    exit 1
  fi

  mkdir -p "$libs_dir"
  find "$libs_dir" -maxdepth 1 -type f -name 'tmap-sdk-*.aar' -delete
  find "$libs_dir" -maxdepth 1 -type f -name 'vsm-tmap-sdk-*.aar' -delete
  cp "$tmap_aar" "$libs_dir/tmap-sdk-${ANDROID_SDK_VERSION}.aar"
  cp "$vsm_aar" "$libs_dir/vsm-tmap-sdk-v2-eaa-${ANDROID_VSM_VERSION}.aar"
  printf '%s\n' "$expected_version" > "$version_file"
  echo "Installed TMAP Android SDK $ANDROID_SDK_VERSION."
}

if [[ "$PLATFORM" == "all" || "$PLATFORM" == "ios" ]]; then
  install_ios
fi
if [[ "$PLATFORM" == "all" || "$PLATFORM" == "android" ]]; then
  install_android
fi

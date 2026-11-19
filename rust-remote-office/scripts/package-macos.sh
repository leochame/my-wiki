#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ "$(uname -s)" != Darwin ]]; then
    echo "Run this script on macOS with Xcode Command Line Tools installed." >&2
    exit 1
fi
cargo build --release --locked
task_app_path="dist/Rust Remote Office.app"
task_target_dir="${CARGO_TARGET_DIR:-target}"
mkdir -p "$task_app_path/Contents/MacOS"
cp "$task_target_dir/release/rust-remote-office" "$task_app_path/Contents/MacOS/"
cp packaging/macos/Info.plist "$task_app_path/Contents/Info.plist"
codesign --force --sign - "$task_app_path"
echo "Built $task_app_path (local ad-hoc signature; not notarized)."

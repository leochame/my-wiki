#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT_ROOT="$(cd "${ROOT_DIR}/.." && pwd)"
WEB_DIR="${ROOT_DIR}/web"
SERVER_DIR="${ROOT_DIR}/server"
BIN_PATH="${SERVER_DIR}/target/release/mywiki-studio-server"

MODE="${1:-run}"

build_web() {
  echo "[MyWiki Studio] Building frontend..."
  npm --prefix "${WEB_DIR}" run build
}

build_server() {
  echo "[MyWiki Studio] Building Rust backend (release)..."
  cargo build --release --manifest-path "${SERVER_DIR}/Cargo.toml"
}

if [[ "${MODE}" == "--check" ]]; then
  build_web
  echo "[MyWiki Studio] Running Rust tests..."
  cargo test --manifest-path "${SERVER_DIR}/Cargo.toml"
  exit 0
fi

if [[ "${MODE}" == "--rebuild" || ! -d "${WEB_DIR}/dist" ]]; then
  build_web
fi

if [[ "${MODE}" == "--rebuild" || ! -x "${BIN_PATH}" ]]; then
  build_server
fi

export MYWIKI_VAULT_ROOT="${MYWIKI_VAULT_ROOT:-${VAULT_ROOT}}"
export MYWIKI_STUDIO_PORT="${MYWIKI_STUDIO_PORT:-8790}"

echo "[MyWiki Studio] Vault: ${MYWIKI_VAULT_ROOT}"
echo "[MyWiki Studio] Starting server at http://127.0.0.1:${MYWIKI_STUDIO_PORT}"
exec "${BIN_PATH}"

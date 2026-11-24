#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/northstar"
ENV_FILE="${NORTHSTAR_ENV_FILE:-$ENV_DIR/runtime.env}"
MODE="${1:-run}"

case "$MODE" in
  --init-env)
    mkdir -p "$ENV_DIR"
    chmod 700 "$ENV_DIR"
    if [[ -f "$ENV_FILE" ]]; then
      echo "已存在外部配置文件：${ENV_FILE}（未覆盖）"
    else
      cp "$ROOT_DIR/.env.example" "$ENV_FILE"
      chmod 600 "$ENV_FILE"
      echo "已生成外部配置文件模板：${ENV_FILE}（权限 600）"
      echo "请用本地编辑器填入真实凭证，不要提交到 Vault。"
    fi
    exit 0
    ;;
  --check)
    echo "==> 检查前端构建"
    (cd "$ROOT_DIR/web" && npm run build)
    echo "==> 运行 Rust 后端测试"
    (cd "$ROOT_DIR/server" && cargo test)
    if [[ -f "$ENV_FILE" ]]; then
      echo "==> 外部配置文件已就绪：${ENV_FILE}"
    else
      echo "==> 提示：尚未创建 ${ENV_FILE}，可运行 ./scripts/start.sh --init-env 初始化模板"
    fi
    exit 0
    ;;
  --rebuild|run)
    if [[ "$MODE" == "--rebuild" || ! -d "$ROOT_DIR/web/dist" ]]; then
      echo "==> 构建前端静态资源"
      (cd "$ROOT_DIR/web" && npm run build)
    fi
    if [[ -f "$ENV_FILE" ]]; then
      echo "==> 后端将自动加载外部配置：${ENV_FILE}"
    else
      echo "==> 未检测到 ${ENV_FILE}，将以纸上无凭证模式启动（可先运行 ./scripts/start.sh --init-env）"
    fi
    export RUST_LOG="${RUST_LOG:-info}"
    cd "$ROOT_DIR/server"
    exec cargo run
    ;;
  *)
    echo "用法: $0 [run | --rebuild | --init-env | --check]" >&2
    exit 1
    ;;
esac

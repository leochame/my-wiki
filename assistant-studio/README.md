# MyWiki Studio

`MyWiki Studio` 是为本地 `my-wiki` 知识库打造的个人助理、文档写作、内置阅读器与 ACP/CLI 智能体工作台。

## 架构与隔离边界

- **独立端口**：`http://127.0.0.1:8790`（与 Northstar 投研平台 `http://127.0.0.1:8787` 物理隔离，互不影响）。
- **双源持久化**：
  - **文档型内容 → 本地 Vault Markdown**：笔记、写作草稿、阅读归档（`worth-reading/reading-notes/`）、期限任务（`task/by-task/T-*.md`）与长期待办（`task/TODO.md`）均以原子写入落盘到对应文件夹，保留 YAML front matter 与 `[[wikilinks]]`。
  - **结构化数据 → 独立 SQLite**：`~/.local/share/my-wiki-assistant/assistant.sqlite3`，存储 FTS5 全文索引、双链图谱、任务缓存、脚本执行日志、RSS/OPML 订阅源与已读/星标状态、内置阅读器正文缓存与摘录、ACP/CLI 会话与流式事件。
- **Vault 安全保护**：拒绝写入 `papers/**/source/`、`.git/`、`.agentero/`、`trading-platform/`、`assistant-studio/` 等受保护路径。

## 启动与校验

```bash
# 编译检查 + 后端单元测试
./assistant-studio/scripts/start.sh --check

# 首次编译并启动（默认监听 http://127.0.0.1:8790）
./assistant-studio/scripts/start.sh --rebuild

# 快速启动（已编译）
./assistant-studio/scripts/start.sh
```

## ACP / CLI 支持

- **Claude Code**：直接使用本机 `claude` CLI 流式输出并自动 `--resume` 绑定多轮会话。
- **Claude Code (ACP)**：安装 `claude-code-acp` 后自动识别并通过标准 ACP JSON-RPC 2.0 `stdio` 驱动。
- **Gemini CLI (ACP)**：安装 `gemini` CLI 后自动识别并通过 `gemini --acp` 驱动。
- **Codex CLI**：自动识别本机 `codex` CLI。

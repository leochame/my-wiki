# Northstar Research & Portfolio Terminal

React / TypeScript 前端 + Rust / Axum 后端。外部 API 仅接入**长桥 OpenAPI**（实时行情与多周期 K 线）与**长桥 Agent CLI**（AI 投研与个股情报）；持仓与实时盈亏基于**本地账本 + 长桥实时估值**，并内置**官方 RSS/Atom 财经媒体自动跟踪**。

## 核心能力

- **长桥实时行情与 K 线**：支持 `1m / 5m / 15m / 30m / 60m / 日K / 周K / 月K` 蜡烛图 + MA5/10/20 + 成交量 + 持仓成本参考线 + 折线切换；自选支持 `.US`、`.HK` 与前导 `.` 指数代码（如 `.VIX.US`），批量拉取中英文全称、交易所与实时涨跌幅。
- **本地持仓账本与实时盈亏**：支持录入/编辑/删除持仓与可用现金（USD），由长桥实时报价每 15 秒刷新市值、仓位占比、今日盈亏与累计盈亏，后台每 5 分钟自动记账至 SQLite 并绘制总资产与累计盈亏曲线。
- **长桥 AI 投研 & 财经媒体聚合**：接入本地 `longbridge` CLI（对话、市场温度、估值/资金流、财报 KPI、长桥个股资讯与 SEC 公告），并每 10 分钟自动拉取 Bloomberg / Reuters / WSJ / NYT / FT / AP / Fed / SEC / Morgan Stanley 等官方 RSS/Atom 订阅源。

## 运行

```bash
cd trading-platform

# 初始化 Vault 之外的本机配置文件（~/.config/northstar/runtime.env，权限 600）
./scripts/start.sh --init-env

# 构建并启动服务（默认 http://127.0.0.1:8787，自动加载 runtime.env）
./scripts/start.sh

# 完整构建与测试检查
./scripts/start.sh --check
```

## 接口清单

| 接口 | 行为 |
| --- | --- |
| `GET /api/health` | 长桥 OpenAPI 就绪状态、缺失项与 `runtime.env` 加载状态 |
| `GET /api/account` | 本地持仓账本总览（长桥实时估值） |
| `PUT /api/portfolio/cash` | 设置可用现金（USD） |
| `POST /api/portfolio/positions` / `DELETE .../{symbol}` | 录入、更新或删除持仓 |
| `GET /api/portfolio/history` / `POST /api/portfolio/snapshot` | 查询实时盈亏快照历史 / 立即记一笔快照 |
| `GET /api/watchlist` / `POST` / `DELETE .../{symbol}` | 维护自选标的（支持 `.US` / `.HK` / 指数） |
| `GET /api/watchlist/snapshots` | 批量获取自选标的中英文全称、交易所、最新价与昨收 |
| `GET /api/quotes/{symbol}` | 长桥单标的实时报价与中英文全称 |
| `GET /api/candles/{symbol}?period=5m&count=96` | 长桥多周期 K 线 |
| `GET /api/agent/status` / `POST .../login` / `GET .../list` / `POST .../chat` / `GET .../intel/{symbol}` | 长桥 Agent CLI 状态、授权、对话与个股投研情报 |
| `GET /api/media/feed` / `POST /api/media/refresh` / `POST / PATCH / DELETE /api/media/sources` | 官方财经媒体 RSS/Atom 聚合与订阅管理 |

## 存储与凭证边界

- SQLite 默认位于 `~/.local/share/northstar/terminal.sqlite3`（可用 `NORTHSTAR_DATABASE_PATH` 覆盖）。
- 长桥 OpenAPI 凭证读取自 `~/.config/northstar/runtime.env`（`chmod 600`），长桥 Agent OAuth 凭证由本地 `longbridge` CLI 管理。所有真实凭证均保存在本 Vault 之外，不写入仓库或 SQLite。

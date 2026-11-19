# Northstar Trading Terminal

React / TypeScript 前端 + Rust / Axum 后端。行情来自长桥，嘉信作为可配置的美股交易执行通道。当前默认纸上交易。

## 数据状态

- **资产、今日盈亏、购买力、风险和持仓：尚未实现券商账户读取，界面显示空状态。**
- **自选：默认空，由用户添加证券代码，保存在服务端 SQLite。没有自动选股或股票推荐。**
- **行情：只读取长桥真实响应；未授权返回 503，界面明确显示未配置，不会生成演示报价或走势。**
- **纸上订单：校验参数后接受并持久保存到 SQLite，未模拟撮合，不代表成交。重启后可恢复。**
- **实盘：需单独配置嘉信 Token、账户哈希及确认码。本项目未完成实盘端到端联调，也未实现 OAuth 授权和自动刷新。**

UI 使用自有 React 组件和 CSS 变量，参考 shadcn/ui、tweakcn、React Bits，以及 Manus / Linear / Vercel 的公开设计。默认暖白主题，可切换深色；侧栏和页面分别适配桌面、平板与手机。详情见 [设计说明](docs/DESIGN.md)。

前端包含总览、市场与交易、自选、资产与持仓、订单记录、连接设置六个独立视图。支持 `⌘/Ctrl K` 搜索跳转、订单方向/代码筛选与 CSV 导出。字体在构建中本地打包。

## 运行

```bash
# 终端一：Rust API，默认 http://127.0.0.1:8787
cd trading-platform/server
TRADING_MODE=paper RUST_LOG=info cargo run

# 终端二：前端 http://localhost:5173，/api 代理至 8787
cd trading-platform/web
npm ci
npm run dev
```

8080 在当前主机上已被其他服务占用，因此这里使用 8787。

生产页面由 Rust 提供：

```bash
cd trading-platform/web
npm run build
cd ../server
TRADING_MODE=paper RUST_LOG=info cargo run
```

打开 <http://127.0.0.1:8787>。`PORT` 可覆盖后端端口，修改后同步调整 `web/vite.config.ts` 的代理。

本次工作使用的隔离工具链位于 `/var/tmp/northstar-cargo` 和 `/var/tmp/northstar-rustup`，没有修改全局 PATH。当前会话可以通过以下方式调用：

```bash
RUSTUP_HOME=/var/tmp/northstar-rustup CARGO_HOME=/var/tmp/northstar-cargo /var/tmp/northstar-cargo/bin/cargo run
```

## 接口与检查

| 接口 | 行为 |
| --- | --- |
| `GET /api/health` | 服务、SQLite、行情配置、执行模式、账户接入状态 |
| `GET /api/quotes/{symbol}` | 长桥报价，使用 `AAPL.US` / `700.HK` 格式 |
| `GET /api/candles/{symbol}?count=63` | 日 K 线，最多 1000 条 |
| `POST /api/orders/preview` | 校验并保存预览，返回 10 分钟内有效的 `preview_id`，不会下单 |
| `POST /api/orders` | 携带 `preview_id` 确认相同参数；同一预览重复请求不会重复下单 |
| `GET /api/orders` | 已保存的订单及提交结果（纸上/实盘明确区分） |

```bash
cd web && npm run build
cd ../server && cargo test
curl http://127.0.0.1:8787/api/health
```

额外接口：`GET /api/watchlist`、`POST /api/watchlist`（`{"symbol":"用户选择的代码"}`）、`DELETE /api/watchlist/{symbol}`。

## SQLite 存储

默认数据库位于 `$XDG_DATA_HOME/northstar/terminal.sqlite3`，未设置 XDG 时使用 `~/.local/share/northstar/terminal.sqlite3`。用 `NORTHSTAR_DATABASE_PATH` 指定其他路径；实际数据库不放在本 Vault。

- `watchlist`：用户添加的证券代码和添加时间。
- `order_previews`：不含确认码的订单参数快照、模式、创建时间和过期时间。
- `orders`：对应预览、纸上/实盘模式、状态、提交时间和券商返回结果。

使用 SQLite WAL 和事务；同一预览只能建立一笔订单。实盘网络超时会记录为 `unknown`，不会自动重发。密钥、Token、确认码均不写入数据库。测试使用独立的临时库，不写入实际用户库。

后端校验正数金额与数量、方向、订单类型；嘉信路由会将 `.US` 后缀转换为嘉信证券代码，并拒绝港股。前端编辑订单后使旧预览失效，防止重复点击提交。

## 凭证配置

真实凭证必须放在 Vault 之外，例如 `~/.config/northstar/runtime.env`，仅在服务端进程中加载。`.env.example` 只包含变量名称和空白占位，不要在本 Vault 中填入真实值。

- 长桥：`LONGBRIDGE_APP_KEY`、`LONGBRIDGE_APP_SECRET`、`LONGBRIDGE_ACCESS_TOKEN`。
- 嘉信：`SCHWAB_ACCESS_TOKEN`、`SCHWAB_ACCOUNT_HASH`。
- 实盘开关：`TRADING_MODE=live`，并设置非空 `LIVE_ORDER_CONFIRMATION`；每笔实盘委托需提供相同确认码。

## 当前边界

尚未实现账户授权界面、资产/持仓读取、成交同步、订单成交/撤销查询、WebSocket 推送及完整风控。页面只显示已接入的实际数据，不会填入虚构资产或交易记录。旧 `app/` Python 原型保留供迁移参考，当前前后端使用 Rust 服务。

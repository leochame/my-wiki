import { useState, type ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Clock3,
  Compass,
  Download,
  ExternalLink,
  FileCheck2,
  FolderOpen,
  Layers,
  Link2,
  Loader2,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Trash2,
  Wallet,
} from "lucide-react";
import type { OrderEntry } from "../types";
import {
  RANGES,
  displayTime,
  money,
  type Workspace,
} from "../hooks/useWorkspace";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from "./ui";
import { PriceChart } from "./Chart";

export function NorthStar({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20 2.5 23.7 15.3 37.5 20 23.7 24.7 20 37.5 16.3 24.7 2.5 20 16.3 15.3 20 2.5Z"
        fill="currentColor"
      />
      <path
        d="m29 7.5 1.1 3.5 3.4 1.1-3.4 1.1-1.1 3.3-1.1-3.3-3.4-1.1 3.4-1.1L29 7.5Z"
        fill="var(--accent)"
      />
    </svg>
  );
}

export function EmptyArtwork({
  variant = "market",
}: {
  variant?: "market" | "watchlist" | "orders" | "portfolio";
}) {
  const Icon =
    variant === "market"
      ? Compass
      : variant === "watchlist"
        ? Star
        : variant === "orders"
          ? FileCheck2
          : Wallet;
  return (
    <div className={`empty-art empty-art-${variant}`} aria-hidden="true">
      <div className="art-orbit" />
      <div className="art-dot art-dot-one" />
      <div className="art-dot art-dot-two" />
      <div className="art-paper art-paper-back">
        <div />
        <div />
        <div />
      </div>
      <div className="art-paper art-paper-front">
        <Icon size={27} strokeWidth={1.35} />
        <span />
        <span />
      </div>
      <span className="art-spark">
        <NorthStar size={18} />
      </span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  children,
  compact = false,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "empty-state-compact" : ""}`}>
      {icon}
      <h3>{title}</h3>
      <p>{description}</p>
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}

export function AccountSummary({ onConnect }: { onConnect: () => void }) {
  return (
    <section className="account-summary" aria-label="账户概览">
      <div className="account-summary-heading">
        <span>
          <Wallet size={15} />
          账户概览
        </span>
        <button className="text-button" onClick={onConnect}>
          账户待接入 <ArrowUpRight size={13} />
        </button>
      </div>
      <div className="metrics">
        {[
          { label: "总资产", unit: "USD" },
          { label: "今日盈亏", unit: "USD" },
          { label: "可用资金", unit: "USD" },
          { label: "持仓数量", unit: "标的" },
        ].map((item) => (
          <div className="metric" key={item.label}>
            <span>
              {item.label}
              <small>{item.unit}</small>
            </span>
            <strong className="metric-value">—</strong>
            <p>等待账户数据</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MarketPanel({
  workspace: w,
  onAdd,
  onConnect,
  expanded = false,
}: {
  workspace: Workspace;
  onAdd: () => void;
  onConnect: () => void;
  expanded?: boolean;
}) {
  const previous = w.quote?.previous_close
    ? Number(w.quote.previous_close)
    : null;
  const last = w.quote ? Number(w.quote.last) : null;
  const change =
    last !== null && previous !== null && previous > 0
      ? ((last - previous) / previous) * 100
      : null;
  let title = "你的下一份关注，从这里开始";
  let description = "添加你关注的股票或 ETF，在一个地方查看报价与走势。";
  if (w.connection === "offline") {
    title = "暂时无法连接服务";
    description = "请检查工作台连接，再重新获取行情。";
  } else if (w.symbol) {
    title = w.marketError
      ? "这次没能取得行情"
      : w.loading
        ? "正在获取行情"
        : !w.quoteConfigured
          ? "连接行情，开始观察市场"
          : "尚无可展示的行情";
    description =
      w.marketError ||
      (w.loading
        ? "正在向长桥请求实际报价和历史数据。"
        : !w.quoteConfigured
          ? `${w.symbol} 已在你的自选中。连接长桥后即可查看真实数据。`
          : "当前数据源未返回该标的的走势。");
  }
  return (
    <Card className={`market-panel ${expanded ? "market-panel-expanded" : ""}`}>
      <CardHeader>
        <div className="panel-title">
          <span className="panel-marker" />
          <CardTitle>市场观察</CardTitle>
          <Badge>{w.quote ? "Longbridge" : "等待数据"}</Badge>
        </div>
        <div className="range-tabs" aria-label="走势时间范围">
          {(Object.keys(RANGES) as Array<keyof typeof RANGES>).map((value) => (
            <button
              key={value}
              aria-pressed={w.range === value}
              className={w.range === value ? "range-active" : ""}
              onClick={() => w.setRange(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </CardHeader>
      <div className="market-focus">
        <button className="focus-symbol" onClick={onAdd}>
          <span
            className={`ticker-icon ${w.symbol ? "" : "ticker-placeholder"}`}
          >
            {w.symbol ? w.symbol.charAt(0) : <Plus size={17} />}
          </span>
          <span>
            <strong>{w.symbol || "选择一个标的"}</strong>
            <small>
              {w.symbol
                ? `${w.currency} · ${w.symbol.endsWith(".HK") ? "香港市场" : "美国市场"}`
                : "从你的自选列表开始"}
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="focus-price">
          <strong>{last === null ? "—" : money(last, w.currency)}</strong>
          {change !== null && (
            <span className={change >= 0 ? "positive" : "negative"}>
              {change >= 0 ? (
                <ArrowUpRight size={13} />
              ) : (
                <ArrowDownRight size={13} />
              )}
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}%
            </span>
          )}
        </div>
      </div>
      {w.candles.length ? (
        <div className="chart-wrap">
          <PriceChart candles={w.candles} currency={w.currency} />
        </div>
      ) : (
        <div className="market-empty">
          <EmptyState
            title={title}
            description={description}
            icon={
              w.loading ? (
                <Loader2 className="spin loading-icon" size={32} />
              ) : (
                <EmptyArtwork />
              )
            }
          >
            <Button
              variant="outline"
              size="sm"
              onClick={
                !w.symbol
                  ? onAdd
                  : w.marketError || w.connection === "offline"
                    ? () => void w.refresh()
                    : onConnect
              }
            >
              {!w.symbol ? (
                <>
                  <Plus size={14} />
                  添加自选标的
                </>
              ) : w.marketError || w.connection === "offline" ? (
                "重新获取"
              ) : (
                <>
                  连接长桥 <ArrowUpRight size={14} />
                </>
              )}
            </Button>
          </EmptyState>
        </div>
      )}
      <div className="market-stats">
        <div>
          <span>开盘</span>
          <strong>
            {w.quote?.open ? money(Number(w.quote.open), w.currency) : "—"}
          </strong>
        </div>
        <div>
          <span>最高</span>
          <strong>
            {w.quote?.high ? money(Number(w.quote.high), w.currency) : "—"}
          </strong>
        </div>
        <div>
          <span>最低</span>
          <strong>
            {w.quote?.low ? money(Number(w.quote.low), w.currency) : "—"}
          </strong>
        </div>
        <div>
          <span>成交量</span>
          <strong>{w.quote?.volume?.toLocaleString() ?? "—"}</strong>
        </div>
      </div>
      <div className="market-footnote">
        <span
          className={`status-dot ${w.quote ? "status-dot-positive" : ""}`}
        />
        {w.quote?.timestamp
          ? `长桥 · ${displayTime(w.quote.timestamp)}（北京时间）`
          : "接入行情后显示实际报价 · 不生成示例走势"}
        <span>日线</span>
      </div>
    </Card>
  );
}

export function OrderTicket({
  workspace: w,
  onAdd,
}: {
  workspace: Workspace;
  onAdd: () => void;
}) {
  return (
    <Card className="order-ticket">
      <CardHeader>
        <CardTitle>交易委托</CardTitle>
        <Badge tone={w.live ? "negative" : "warning"}>
          <span
            className={`status-dot ${w.live ? "status-dot-negative" : "status-dot-amber"}`}
          />
          {w.live ? "实盘交易" : "纸上交易"}
        </Badge>
      </CardHeader>
      <div className="ticket-body">
        <button className="order-security" onClick={onAdd}>
          <span className="ticker-icon ticker-small">
            {w.symbol.charAt(0) || <Plus size={15} />}
          </span>
          <span>
            <strong>{w.symbol || "选择交易标的"}</strong>
            <small>{w.symbol ? w.currency : "从自选中选择或添加"}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="side-toggle" aria-label="交易方向">
          <button
            className={w.side === "buy" ? "side-buy-active" : ""}
            onClick={() => w.setSide("buy")}
            disabled={w.busy}
            aria-pressed={w.side === "buy"}
          >
            买入
          </button>
          <button
            className={w.side === "sell" ? "side-sell-active" : ""}
            onClick={() => w.setSide("sell")}
            disabled={w.busy}
            aria-pressed={w.side === "sell"}
          >
            卖出
          </button>
        </div>
        <label className="field-label">
          订单类型
          <Select
            value={w.orderType}
            onChange={(event) =>
              w.setOrderType(event.target.value as "market" | "limit")
            }
            disabled={w.busy}
          >
            <option value="limit">限价单</option>
            <option value="market">市价单</option>
          </Select>
        </label>
        <div className="ticket-fields">
          <label className="field-label">
            数量
            <span className="input-affix">
              <Input
                inputMode="decimal"
                value={w.quantity}
                placeholder="0"
                onChange={(event) => w.setQuantity(event.target.value)}
                disabled={w.busy}
              />
              <span>股</span>
            </span>
          </label>
          {w.orderType === "limit" && (
            <label className="field-label">
              限价
              <span className="input-affix">
                <Input
                  inputMode="decimal"
                  value={w.limitPrice}
                  placeholder="0.00"
                  onChange={(event) => w.setLimitPrice(event.target.value)}
                  disabled={w.busy}
                />
                <span>{w.currency}</span>
              </span>
            </label>
          )}
        </div>
        {w.orderType === "market" && (
          <div className="field-hint">
            <CircleHelp size={13} />
            市价委托以实际成交价格为准。
          </div>
        )}
        <div className="ticket-total">
          <span>
            预计金额<small>未含交易费用</small>
          </span>
          <strong>{w.estimate}</strong>
        </div>
        {w.pending && (
          <div className="preview-box" role="status">
            <div>
              <CheckCheck size={15} />
              <strong>订单已预览</strong>
              <span>10 分钟内有效</span>
            </div>
            <p>
              {w.pending.preview.symbol} · {w.side === "buy" ? "买入" : "卖出"}{" "}
              {w.pending.preview.quantity} 股
            </p>
            {w.pending.preview.warnings.map((warning) => (
              <small key={warning}>{warning}</small>
            ))}
          </div>
        )}
        {w.pending && w.live && (
          <label className="field-label">
            实盘确认码
            <Input
              type="password"
              autoComplete="off"
              value={w.confirmation}
              onChange={(event) => w.setConfirmation(event.target.value)}
              disabled={w.busy}
            />
          </label>
        )}
        {w.orderError && (
          <div className="inline-error" role="alert">
            <CircleAlert size={15} />
            <span>{w.orderError}</span>
          </div>
        )}
        <Button
          className="ticket-submit"
          variant={w.pending && w.side === "sell" ? "danger" : "primary"}
          onClick={w.pending ? w.confirmOrder : w.previewOrder}
          disabled={
            w.busy ||
            !w.validOrder ||
            (!!w.pending &&
              (!w.pending.preview.executable || (w.live && !w.confirmation)))
          }
        >
          {w.busy ? (
            <>
              <Loader2 size={15} className="spin" />
              正在处理
            </>
          ) : w.pending ? (
            <>
              {w.live ? "确认提交实盘" : "确认纸上订单"}
              <ArrowRight size={15} />
            </>
          ) : (
            <>
              预览订单
              <ArrowRight size={15} />
            </>
          )}
        </Button>
        {w.pending && (
          <button
            className="text-button cancel-preview"
            onClick={w.cancelPreview}
            disabled={w.busy}
          >
            返回编辑参数
          </button>
        )}
        <p className="ticket-disclaimer">
          <ShieldCheck size={13} />
          {w.live
            ? "实盘委托可能产生真实成交。"
            : "纸上交易仅记录委托，不向券商发送。"}
        </p>
      </div>
      <div className="ticket-bottom">
        <LockKeyhole size={13} />
        {w.live ? "Schwab 执行" : "确认后保存至本地工作台"}
      </div>
    </Card>
  );
}

export function WatchlistPanel({
  workspace: w,
  onAdd,
  onTrade,
  expanded = false,
}: {
  workspace: Workspace;
  onAdd: () => void;
  onTrade: (symbol: string) => void;
  expanded?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = w.watchlist.filter((symbol) =>
    symbol.includes(query.trim().toUpperCase()),
  );
  return (
    <Card className={`watchlist-panel ${expanded ? "expanded-panel" : ""}`}>
      <CardHeader>
        <div className="panel-title">
          <Star size={16} />
          <CardTitle>我的自选</CardTitle>
          <span className="count-label">{w.watchlist.length}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onAdd}>
          <Plus size={14} />
          添加
        </Button>
      </CardHeader>
      {(expanded || w.watchlist.length > 4) && (
        <div className="list-toolbar">
          <Search size={15} />
          <Input
            aria-label="筛选自选"
            placeholder="搜索我的自选"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
      {w.watchlist.length ? (
        <div className="watchlist-items">
          {filtered.length ? (
            filtered.map((symbol) => (
              <div
                className={`watch-row ${w.symbol === symbol ? "watch-row-selected" : ""}`}
                key={symbol}
              >
                <button
                  className="watch-select"
                  onClick={() => onTrade(symbol)}
                >
                  <span className="security-avatar">{symbol.charAt(0)}</span>
                  <span className="security-name">
                    <strong>{symbol.replace(/\.(US|HK)$/, "")}</strong>
                    <small>
                      {symbol.endsWith(".HK") ? "港股" : "美股"} · {symbol}
                    </small>
                  </span>
                  <span className="watch-price">
                    <strong>
                      {w.quote?.symbol === symbol
                        ? money(
                            Number(w.quote.last),
                            symbol.endsWith(".HK") ? "HKD" : "USD",
                          )
                        : "—"}
                    </strong>
                    <small>
                      {w.quote?.symbol === symbol ? "Longbridge" : "查看行情"}
                    </small>
                  </span>
                </button>
                <button
                  className="icon-button remove-symbol"
                  aria-label={`移除 ${symbol}`}
                  onClick={() => void w.removeSymbol(symbol)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          ) : (
            <EmptyState
              compact
              title="没有匹配的自选"
              description="试试其他代码，或添加新的关注标的。"
            />
          )}
        </div>
      ) : (
        <EmptyState
          compact
          title="好决策，从自己的关注列表开始"
          description="这里留给你关心的公司与资产，没有预设推荐。"
          icon={<EmptyArtwork variant="watchlist" />}
        >
          <button className="text-button" onClick={onAdd}>
            添加第一个标的 <ArrowRight size={14} />
          </button>
        </EmptyState>
      )}
      <div className="panel-footer">
        <LockKeyhole size={12} />
        <span>仅保存你主动添加的标的</span>
      </div>
    </Card>
  );
}

const statusLabels: Record<string, string> = {
  accepted: "已接受 · 未成交",
  submitted: "已提交 · 待核查",
  submitting: "提交中",
  rejected: "已拒绝",
  unknown: "结果未知",
};
function exportOrders(orders: OrderEntry[]) {
  const cell = (value: string) =>
    `"${value.replace(/"/g, '""').replace(/^[=+@-]/, "'$&")}"`;
  const header = [
    "时间",
    "证券",
    "方向",
    "数量",
    "类型",
    "限价",
    "模式",
    "状态",
    "订单编号",
  ];
  const rows = orders.map((order) => [
    order.created_at,
    order.symbol,
    order.side,
    order.quantity,
    order.order_type,
    order.limit_price ?? "",
    order.mode,
    order.status,
    order.order_id,
  ]);
  const blob = new Blob(
    [
      "\uFEFF",
      [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8;" },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "northstar-orders.csv";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function OrdersPanel({
  workspace: w,
  expanded = false,
  onViewAll,
}: {
  workspace: Workspace;
  expanded?: boolean;
  onViewAll?: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const filtered = [...w.orders]
    .reverse()
    .filter(
      (order) =>
        (filter === "all" || order.side === filter) &&
        `${order.symbol} ${order.order_id}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    );
  const displayed = expanded ? filtered : filtered.slice(0, 4);
  return (
    <Card className={`orders-panel ${expanded ? "expanded-panel" : ""}`}>
      <CardHeader>
        <div className="panel-title">
          <Clock3 size={16} />
          <CardTitle>{expanded ? "全部委托" : "最近委托"}</CardTitle>
          <span className="count-label">{w.orders.length}</span>
        </div>
        {expanded ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportOrders(filtered)}
            disabled={!filtered.length}
          >
            <Download size={14} />
            导出 CSV
          </Button>
        ) : (
          <button className="text-button" onClick={onViewAll}>
            查看全部 <ArrowUpRight size={13} />
          </button>
        )}
      </CardHeader>
      {expanded && (
        <div className="orders-toolbar">
          <div className="segment-tabs" aria-label="订单方向筛选">
            {[
              { id: "all", label: "全部" },
              { id: "buy", label: "买入" },
              { id: "sell", label: "卖出" },
            ].map((item) => (
              <button
                aria-pressed={filter === item.id}
                key={item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="table-search">
            <Search size={14} />
            <Input
              aria-label="搜索订单"
              placeholder="搜索证券或订单编号"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
      )}
      {displayed.length ? (
        <div className="table-scroll">
          <table className="orders-table">
            <thead>
              <tr>
                <th>标的 / 方向</th>
                <th>数量 / 限价</th>
                <th>状态</th>
                {expanded && <th>时间（北京）</th>}
              </tr>
            </thead>
            <tbody>
              {displayed.map((order) => (
                <tr key={order.order_id}>
                  <td>
                    <span className="order-row-symbol">{order.symbol}</span>
                    <small
                      className={order.side === "buy" ? "positive" : "negative"}
                    >
                      {order.side === "buy" ? "买入" : "卖出"} ·{" "}
                      {order.mode === "paper" ? "纸上" : "实盘"}
                    </small>
                  </td>
                  <td>
                    <strong>{order.quantity} 股</strong>
                    <small>
                      {order.order_type === "limit"
                        ? `限价 ${order.limit_price}`
                        : "市价单"}
                    </small>
                  </td>
                  <td>
                    <Badge
                      tone={
                        order.status === "rejected" ||
                        order.status === "unknown"
                          ? "negative"
                          : "neutral"
                      }
                    >
                      {statusLabels[order.status] ?? order.status}
                    </Badge>
                  </td>
                  {expanded && (
                    <td>
                      <time>{displayTime(order.created_at)}</time>
                      <small className="order-id" title={order.order_id}>
                        {order.order_id}
                      </small>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          compact
          title={
            w.orders.length ? "没有匹配的委托" : "每一笔委托，都会留有记录"
          }
          description={
            w.orders.length
              ? "调整筛选条件查看其他记录。"
              : "完成第一笔订单预览与确认后，在这里查看状态。"
          }
          icon={<EmptyArtwork variant="orders" />}
        />
      )}
      <div className="panel-footer">
        <FileCheck2 size={12} />
        <span>纸上委托与实盘委托明确区分 · 已持久保存</span>
      </div>
    </Card>
  );
}

export function Connections({ workspace: w }: { workspace: Workspace }) {
  const [details, setDetails] = useState(false);
  return (
    <div className="connections-view">
      <div className="connection-grid">
        <Card className="provider-card">
          <div className="provider-logo longbridge-logo">
            <Layers size={25} />
          </div>
          <div className="provider-heading">
            <h2>长桥 Longbridge</h2>
            <Badge tone={w.quoteConfigured ? "positive" : "warning"}>
              {w.quoteConfigured ? "已配置" : "待连接"}
            </Badge>
          </div>
          <p>实时报价与历史 K 线，让每一次观察都有数据来源。</p>
          <div className="provider-features">
            <span>
              <Check size={13} />
              美股与港股行情
            </span>
            <span>
              <Check size={13} />
              历史日线
            </span>
          </div>
          <a
            className="ui-button ui-button-outline ui-button-md"
            href="https://open.longbridge.com/docs/getting-started"
            target="_blank"
            rel="noreferrer"
          >
            查看长桥接入文档
            <ExternalLink size={13} />
          </a>
        </Card>
        <Card className="provider-card">
          <div className="provider-logo schwab-logo">schwab</div>
          <div className="provider-heading">
            <h2>嘉信 Schwab</h2>
            <Badge>账户待接入</Badge>
          </div>
          <p>连接账户后查看资产与持仓，授权后使用美股交易通道。</p>
          <div className="provider-features">
            <span>
              <CircleAlert size={13} />
              账户与持仓查询尚未接入
            </span>
            <span>
              <ShieldCheck size={13} />
              当前{w.live ? "实盘" : "纸上"}模式
            </span>
          </div>
          <a
            className="ui-button ui-button-outline ui-button-md"
            href="https://developer.schwab.com/products/trader-api--individual"
            target="_blank"
            rel="noreferrer"
          >
            前往嘉信开发者平台
            <ExternalLink size={13} />
          </a>
        </Card>
      </div>
      <Card className="connection-status-card">
        <CardHeader>
          <CardTitle>工作台状态</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void w.refresh()}
            disabled={w.refreshing}
          >
            {w.refreshing && <Loader2 size={13} className="spin" />}重新检查
          </Button>
        </CardHeader>
        <div className="connection-status-row">
          <span>
            <Link2 size={15} />
            本地服务
          </span>
          <Badge tone={w.connection === "online" ? "positive" : "negative"}>
            {w.connection === "online"
              ? "已连接"
              : w.connection === "checking"
                ? "正在检查"
                : "未连接"}
          </Badge>
        </div>
        <div className="connection-status-row">
          <span>
            <FolderOpen size={15} />
            自选与订单记录
          </span>
          <Badge tone={w.connection === "online" ? "positive" : "neutral"}>
            {w.connection === "online" && w.health?.storage === "sqlite"
              ? "持久保存已启用"
              : "等待连接"}
          </Badge>
        </div>
        <div className="connection-status-row">
          <span>
            <ShieldCheck size={15} />
            交易模式
          </span>
          <Badge tone={w.live ? "negative" : "warning"}>
            {w.health
              ? w.live
                ? "实盘交易"
                : "纸上交易 · 不向券商发送"
              : "等待检查"}
          </Badge>
        </div>
      </Card>
      <div className="config-details">
        <button
          className="config-disclosure"
          onClick={() => setDetails(!details)}
          aria-expanded={details}
        >
          <SlidersHorizontal size={15} />
          本机接入配置说明
          <ChevronDown size={15} className={details ? "rotate" : ""} />
        </button>
        {details && (
          <div className="config-content">
            <p>
              真实凭证放在此 Vault 之外，仅由服务端读取。界面不存储 API 密钥。
            </p>
            <dl>
              <div>
                <dt>长桥行情</dt>
                <dd>
                  LONGBRIDGE_APP_KEY
                  <br />
                  LONGBRIDGE_APP_SECRET
                  <br />
                  LONGBRIDGE_ACCESS_TOKEN
                </dd>
              </div>
              <div>
                <dt>嘉信交易</dt>
                <dd>
                  SCHWAB_ACCESS_TOKEN
                  <br />
                  SCHWAB_ACCOUNT_HASH
                </dd>
              </div>
            </dl>
            <p>
              完成本机配置后重启后端，再点击“重新检查”。嘉信账户查询和自动授权尚未实现。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Command,
  Compass,
  LayoutGrid,
  Link2,
  Loader2,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Sun,
  Wallet,
  X,
  Clock3,
} from "lucide-react";
import {
  AccountSummary,
  Connections,
  EmptyArtwork,
  EmptyState,
  MarketPanel,
  NorthStar,
  OrderTicket,
  OrdersPanel,
  WatchlistPanel,
} from "./components/WorkspacePanels";
import { Modal } from "./components/Modal";
import { Badge, Button, Card } from "./components/ui";
import { errorMessage, useWorkspace } from "./hooks/useWorkspace";

const NAVIGATION = [
  { id: "overview", label: "总览", caption: "Overview", icon: LayoutGrid },
  {
    id: "market",
    label: "市场与交易",
    caption: "Market & trade",
    icon: Compass,
  },
  { id: "watchlist", label: "我的自选", caption: "Watchlist", icon: Star },
  { id: "portfolio", label: "资产与持仓", caption: "Portfolio", icon: Wallet },
  { id: "orders", label: "订单记录", caption: "Orders", icon: Clock3 },
  {
    id: "connections",
    label: "连接设置",
    caption: "Connections",
    icon: Settings2,
  },
] as const;
type View = (typeof NAVIGATION)[number]["id"];
const VIEW_COPY: Record<View, { heading: string; description: string }> = {
  overview: {
    heading: "投资决策，从清晰开始。",
    description: "你的市场、资产与每一次决定，在这里有序展开。",
  },
  market: {
    heading: "留意市场，专注当下。",
    description: "在观察与行动之间，留一次认真审阅的空间。",
  },
  watchlist: {
    heading: "你的关注，自成一页。",
    description: "把值得持续观察的公司与资产，收进自己的列表。",
  },
  portfolio: {
    heading: "看清资产的全貌。",
    description: "账户、持仓与盈亏，等待真实数据接入。",
  },
  orders: {
    heading: "每一次决定，都有记录。",
    description: "回看已提交的委托，了解它们的实际状态。",
  },
  connections: {
    heading: "让数据各就其位。",
    description: "行情来自长桥，交易通道由嘉信提供。",
  },
};
const currentView = (): View =>
  NAVIGATION.find((item) => `#${item.id}` === window.location.hash)?.id ??
  "overview";
function App() {
  const w = useWorkspace();
  const [view, setView] = useState<View>(currentView);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("northstar.theme") === "dark"
        ? "dark"
        : "light";
    } catch {
      return "light";
    }
  });
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [dialog, setDialog] = useState<"symbol" | "command" | "help" | null>(
    null,
  );
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [symbolInput, setSymbolInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [connectionHintDismissed, setConnectionHintDismissed] = useState(false);
  const selectedNav = NAVIGATION.find((item) => item.id === view)!;
  const modeLabel = !w.health
    ? "检查交易模式"
    : w.live
      ? "实盘交易"
      : "纸上交易";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#191a19" : "#faf9f6");
    try {
      localStorage.setItem("northstar.theme", theme);
    } catch {
      /* Browsing can continue without saved preferences. */
    }
  }, [theme]);
  useEffect(() => {
    const listener = () => setView(currentView());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setDialog("command");
      }
      if (event.key === "Escape") setMobileNav(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    setMobileNav(false);
  }, [view]);
  useEffect(() => {
    if (!mobileNav) return;
    const previous = document.body.style.overflow;
    const previousFocus = document.activeElement;
    const main = mainRef.current;
    main?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || document.querySelector("dialog[open]")) return;
      const items = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not(:disabled)",
        ) ?? [],
      ).filter((item) => item.getClientRects().length > 0);
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = previous;
      main?.removeAttribute("inert");
      window.removeEventListener("keydown", trap);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [mobileNav]);

  const navigate = (next: View) => {
    window.location.hash = next;
    setView(next);
    setDialog(null);
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const openSymbol = () => {
    setSymbolInput("");
    setAddError("");
    setDialog("symbol");
  };
  const tradeSymbol = (symbol: string) => {
    w.setSymbol(symbol);
    navigate("market");
  };
  const addSymbol = async () => {
    if (adding) return;
    setAdding(true);
    setAddError("");
    try {
      await w.addSymbol(symbolInput);
      setDialog(null);
    } catch (error) {
      setAddError(errorMessage(error));
    } finally {
      setAdding(false);
    }
  };
  const completedSteps =
    Number(w.watchlist.length > 0) +
    Number(w.quoteConfigured) +
    Number(w.orders.length > 0);
  const date = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  const connect = () => navigate("connections");

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        跳到主要内容
      </a>
      {mobileNav && (
        <button
          className="mobile-scrim"
          onClick={() => setMobileNav(false)}
          aria-label="关闭导航"
        />
      )}
      <aside
        ref={sidebarRef}
        className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}
        aria-label="工作台侧栏"
      >
        <div className="brand-row">
          <a
            href="#overview"
            onClick={() => navigate("overview")}
            className="brand"
            aria-label="Northstar 总览"
          >
            <NorthStar size={29} />
            <span>
              northstar<span className="brand-period">.</span>
            </span>
          </a>
          <button
            className="icon-button sidebar-collapse"
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} />
            ) : (
              <PanelLeftClose size={16} />
            )}
          </button>
          <button
            className="icon-button mobile-close"
            aria-label="关闭导航"
            onClick={() => setMobileNav(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button
          className="workspace-switcher"
          onClick={connect}
          title="个人工作台连接设置"
        >
          <span className="workspace-avatar">L</span>
          <span className="workspace-copy">
            <strong>个人工作台</strong>
            <span>Personal workspace</span>
          </span>
          <ChevronDown size={13} />
        </button>
        <button
          className="sidebar-search"
          onClick={() => {
            setQuery("");
            setDialog("command");
          }}
          title="搜索或跳转"
        >
          <Search size={16} />
          <span>搜索或跳转</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav className="side-nav" aria-label="主导航">
          <span className="nav-section-label">工作空间</span>
          {NAVIGATION.slice(0, 5).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              title={label}
              aria-label={label}
              aria-current={view === id ? "page" : undefined}
              className={`nav-item ${view === id ? "nav-item-active" : ""}`}
              onClick={() => navigate(id)}
            >
              <Icon size={17} strokeWidth={1.65} />
              <span>{label}</span>
              {id === "watchlist" && w.watchlist.length > 0 && (
                <small>{w.watchlist.length}</small>
              )}
              {view === id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-watching">
          <div className="sidebar-section-heading">
            <span>最近关注</span>
            <button
              className="icon-button"
              onClick={openSymbol}
              aria-label="添加自选"
            >
              <Plus size={14} />
            </button>
          </div>
          {w.watchlist.length ? (
            w.watchlist.slice(0, 5).map((symbol) => (
              <button
                className="sidebar-security"
                key={symbol}
                onClick={() => tradeSymbol(symbol)}
              >
                <span className="small-square" />
                {symbol}
                <ArrowUpRight size={12} />
              </button>
            ))
          ) : (
            <button className="sidebar-empty" onClick={openSymbol}>
              <span className="dashed-plus">
                <Plus size={13} />
              </span>
              <span>留一个位置，给你的关注</span>
            </button>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-divider" />
          <button
            className={`nav-item ${view === "connections" ? "nav-item-active" : ""}`}
            onClick={connect}
            title="连接设置"
          >
            <Settings2 size={17} />
            <span>连接设置</span>
            {!w.quoteConfigured && <span className="attention-dot" />}
          </button>
          <button
            className="nav-item"
            onClick={() => setDialog("help")}
            title="使用指南"
          >
            <BookOpen size={17} />
            <span>使用指南</span>
            <ArrowUpRight size={13} />
          </button>
          <div className="sidebar-status">
            <span
              className={`status-dot ${w.connection === "online" ? "status-dot-positive" : ""}`}
            />
            <span>
              {w.connection === "online"
                ? "工作台已连接"
                : w.connection === "checking"
                  ? "正在检查连接"
                  : "工作台离线"}
            </span>
            <button
              className="icon-button"
              aria-label={`切换至${theme === "light" ? "深色" : "浅色"}主题`}
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
            </button>
          </div>
          <button
            className="user-row"
            onClick={() => setDialog("help")}
            title="本地工作台"
          >
            <span className="user-avatar">L</span>
            <span>
              <strong>Longchang</strong>
              <small>本地个人空间</small>
            </span>
            <Badge>个人版</Badge>
          </button>
        </div>
      </aside>
      <main
        ref={mainRef}
        tabIndex={-1}
        className="main-content"
        id="main-content"
      >
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(!mobileNav)}
              aria-label="打开导航"
              aria-expanded={mobileNav}
            >
              <Menu size={19} />
            </button>
            <span className="topbar-workspace">工作空间</span>
            <ChevronRight size={12} className="breadcrumb-chevron" />
            <span className="topbar-page">{selectedNav.label}</span>
          </div>
          <div className="topbar-right">
            <span className="topbar-local">
              <ShieldCheck size={13} />
              私人工作台
            </span>
            <span className="toolbar-divider" />
            <Badge tone={w.live ? "negative" : "warning"}>
              <span
                className={`status-dot ${w.live ? "status-dot-negative" : "status-dot-amber"}`}
              />
              {modeLabel}
            </Badge>
            <button
              className="icon-button"
              title="刷新数据"
              aria-label="刷新数据"
              disabled={w.refreshing}
              onClick={() => void w.refresh()}
            >
              <RefreshCw size={15} className={w.refreshing ? "spin" : ""} />
            </button>
          </div>
        </header>
        <div className={`content-wrap view-${view}`}>
          <section className="page-heading">
            <div>
              <div className="page-eyebrow">
                <span>{selectedNav.caption}</span>
                <span className="eyebrow-rule" />
                <span>{date}</span>
              </div>
              <h1>{VIEW_COPY[view].heading}</h1>
              <p>{VIEW_COPY[view].description}</p>
            </div>
            <div className="heading-actions">
              {view === "overview" ||
              view === "market" ||
              view === "watchlist" ? (
                <Button onClick={openSymbol}>
                  <Plus size={15} />
                  添加自选
                </Button>
              ) : view === "orders" ? (
                <Button variant="outline" onClick={() => navigate("market")}>
                  前往交易 <ArrowUpRight size={14} />
                </Button>
              ) : view === "portfolio" ? (
                <Button onClick={connect}>
                  <Link2 size={14} />
                  查看账户接入
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => void w.refresh()}
                  disabled={w.refreshing}
                >
                  <RefreshCw size={14} className={w.refreshing ? "spin" : ""} />
                  检查连接
                </Button>
              )}
            </div>
          </section>
          {w.connection === "offline" && (
            <div className="offline-banner" role="alert">
              <CircleAlert size={16} />
              <span>暂时无法连接工作台，当前信息可能已过期。</span>
              <button onClick={() => void w.refresh()}>
                重新连接 <ArrowRight size={13} />
              </button>
            </div>
          )}
          {view === "overview" && (
            <>
              <AccountSummary onConnect={connect} />
              {!connectionHintDismissed && !w.quoteConfigured && (
                <div className="setup-banner">
                  <div className="setup-banner-icon">
                    <Link2 size={17} />
                  </div>
                  <div>
                    <strong>准备好，连接你的市场。</strong>
                    <p>接入长桥行情，查看你关注的标的与真实走势。</p>
                  </div>
                  <button className="text-button" onClick={connect}>
                    设置连接
                    <ArrowRight size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="暂时收起连接提示"
                    onClick={() => setConnectionHintDismissed(true)}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              <div className="section-heading">
                <div>
                  <h2>你的市场工作区</h2>
                  <span>观察 · 审阅 · 执行</span>
                </div>
                <button
                  className="text-button"
                  onClick={() => navigate("market")}
                >
                  进入专注视图 <ArrowUpRight size={14} />
                </button>
              </div>
              <div className="trading-grid">
                <MarketPanel
                  workspace={w}
                  onAdd={openSymbol}
                  onConnect={connect}
                />
                <OrderTicket workspace={w} onAdd={openSymbol} />
              </div>
              <div className="bottom-grid">
                <WatchlistPanel
                  workspace={w}
                  onAdd={openSymbol}
                  onTrade={tradeSymbol}
                />
                <OrdersPanel
                  workspace={w}
                  onViewAll={() => navigate("orders")}
                />
              </div>
              {completedSteps < 3 && (
                <div className="getting-started">
                  <div>
                    <span className="getting-started-kicker">
                      MAKE IT YOURS
                    </span>
                    <h3>把这里，变成你的工作台。</h3>
                    <p>从一个关注的标的开始，按自己的节奏建立交易流程。</p>
                  </div>
                  <div className="setup-steps">
                    {[
                      {
                        label: "添加你的第一个自选",
                        done: w.watchlist.length > 0,
                        action: openSymbol,
                      },
                      {
                        label: "连接行情数据源",
                        done: w.quoteConfigured,
                        action: connect,
                      },
                      {
                        label: "预览一笔纸上委托",
                        done: w.orders.length > 0,
                        action: () => navigate("market"),
                      },
                    ].map((step, index) => (
                      <button key={step.label} onClick={step.action}>
                        <span className={step.done ? "step-done" : ""}>
                          {step.done ? <Check size={13} /> : `0${index + 1}`}
                        </span>
                        {step.label}
                        <ArrowUpRight size={13} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {view === "market" && (
            <div className="trading-grid focus-grid">
              <MarketPanel
                workspace={w}
                onAdd={openSymbol}
                onConnect={connect}
                expanded
              />
              <OrderTicket workspace={w} onAdd={openSymbol} />
            </div>
          )}
          {view === "watchlist" && (
            <WatchlistPanel
              workspace={w}
              onAdd={openSymbol}
              onTrade={tradeSymbol}
              expanded
            />
          )}
          {view === "orders" && <OrdersPanel workspace={w} expanded />}
          {view === "portfolio" && (
            <>
              <AccountSummary onConnect={connect} />
              <Card className="portfolio-panel">
                <div className="portfolio-heading">
                  <h2>我的持仓</h2>
                  <Badge>账户尚未接入</Badge>
                </div>
                <EmptyState
                  title="资产全景，等待真实连接。"
                  description="接入嘉信账户查询后，在这里查看实际持仓、成本与盈亏。未接入时保持为空。"
                  icon={<EmptyArtwork variant="portfolio" />}
                >
                  <Button variant="outline" onClick={connect}>
                    查看接入状态 <ArrowUpRight size={14} />
                  </Button>
                </EmptyState>
              </Card>
            </>
          )}
          {view === "connections" && <Connections workspace={w} />}
          <footer className="page-footer">
            <span className="footer-brand">
              <NorthStar size={15} />
              northstar<span>Stay curious. Invest with clarity.</span>
            </span>
            <span>
              <span
                className={`status-dot ${w.connection === "online" ? "status-dot-positive" : ""}`}
              />
              {w.connection === "online" ? "工作台已连接" : "等待连接"}
              <span className="footer-dot">·</span>北京时间
            </span>
          </footer>
        </div>
      </main>
      {dialog === "symbol" && (
        <Modal
          title="关注，从一个标的开始"
          description="添加你自己选择的股票或 ETF，随时回来继续观察。"
          onClose={() => setDialog(null)}
        >
          <form
            className="symbol-form"
            onSubmit={(event) => {
              event.preventDefault();
              void addSymbol();
            }}
          >
            <label htmlFor="symbol-input">证券代码</label>
            <div className="symbol-search-field">
              <Search size={18} />
              <input
                id="symbol-input"
                autoFocus
                placeholder="例如 AAPL.US 或 700.HK"
                value={symbolInput}
                onChange={(event) => {
                  setSymbolInput(event.target.value);
                  setAddError("");
                }}
                disabled={adding}
                autoComplete="off"
                maxLength={30}
              />
            </div>
            <div className="symbol-format">
              <span>US · 美国市场</span>
              <span>HK · 香港市场</span>
            </div>
            {addError && (
              <p className="inline-error" role="alert">
                <CircleAlert size={14} />
                {addError}
              </p>
            )}
            <Button type="submit" disabled={!symbolInput.trim() || adding}>
              {adding ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Plus size={15} />
              )}
              添加到我的自选
            </Button>
          </form>
          {w.watchlist.length > 0 && (
            <div className="modal-saved">
              <span>已关注的标的</span>
              <div>
                {w.watchlist.map((symbol) => (
                  <button
                    key={symbol}
                    onClick={() => {
                      w.setSymbol(symbol);
                      setDialog(null);
                    }}
                  >
                    <span className="small-square" />
                    {symbol}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="modal-footnote">
            <ShieldCheck size={13} />
            只添加你选择的标的。代码示例不代表推荐。
          </p>
        </Modal>
      )}
      {dialog === "command" && (
        <Modal
          title="搜索与跳转"
          onClose={() => setDialog(null)}
          className="command-modal"
        >
          <div className="command-input">
            <Search size={18} />
            <input
              autoFocus
              placeholder="搜索页面或我的自选…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="command-results">
            <span className="command-section-label">工作空间</span>
            {NAVIGATION.filter((item) =>
              `${item.label} ${item.caption}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            ).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => navigate(id)}>
                <Icon size={16} />
                <span>{label}</span>
                <ArrowRight size={14} />
              </button>
            ))}
            {w.watchlist.length > 0 && (
              <span className="command-section-label">我的自选</span>
            )}
            {w.watchlist
              .filter((symbol) => symbol.includes(query.toUpperCase()))
              .map((symbol) => (
                <button key={symbol} onClick={() => tradeSymbol(symbol)}>
                  <Star size={16} />
                  <span>{symbol}</span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            {query &&
              !NAVIGATION.some((item) =>
                `${item.label} ${item.caption}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              ) &&
              !w.watchlist.some((symbol) =>
                symbol.includes(query.toUpperCase()),
              ) && (
                <div className="command-no-results">
                  没有找到结果
                  <button onClick={openSymbol}>
                    添加新的自选 <Plus size={14} />
                  </button>
                </div>
              )}
          </div>
          <div className="command-footer">
            <kbd>esc</kbd>关闭
            <span>
              <Command size={11} /> K 随时唤起
            </span>
          </div>
        </Modal>
      )}
      {dialog === "help" && (
        <Modal
          title="从容开始，按你的节奏。"
          description="Northstar 是你的个人市场与交易工作空间。"
          onClose={() => setDialog(null)}
        >
          <div className="help-list">
            <div>
              <Star size={19} />
              <span>
                <strong>建立自己的关注列表</strong>
                <p>手动添加证券代码，自选与委托会持久保存。</p>
              </span>
            </div>
            <div>
              <Link2 size={19} />
              <span>
                <strong>连接实际行情</strong>
                <p>行情来自长桥授权。未连接时不会显示示例价格。</p>
              </span>
            </div>
            <div>
              <CheckCheck size={19} />
              <span>
                <strong>审阅，再确认</strong>
                <p>纸上委托只记录参数，不代表真实成交。实盘需额外配置。</p>
              </span>
            </div>
          </div>
          <Button onClick={connect}>
            查看连接设置 <ArrowRight size={14} />
          </Button>
        </Modal>
      )}
      {w.notice && (
        <div
          className={`toast toast-${w.notice.tone}`}
          role={w.notice.tone === "error" ? "alert" : "status"}
        >
          {w.notice.tone === "error" ? (
            <CircleAlert size={17} />
          ) : (
            <Check size={17} />
          )}
          <span>{w.notice.message}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => w.setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
export default App;

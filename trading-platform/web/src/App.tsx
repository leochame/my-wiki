import { useEffect, useState } from "react";
import {
  Check,
  Compass,
  Newspaper,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { AgentHub } from "@/components/AgentHub";
import { Connections } from "@/components/Connections";
import { MarketPanel } from "@/components/MarketPanel";
import { MediaFeed } from "@/components/MediaFeed";
import { AccountStrip, HoldingsQuickCard, PortfolioView } from "@/components/Portfolio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tip, TooltipProvider } from "@/components/ui/tooltip";
import { Watchlist } from "@/components/Watchlist";
import { useWorkspace } from "@/hooks/useWorkspace";
import * as api from "@/lib/api";
import { errorMessage } from "@/lib/format";
import {
  THEME_PRESETS,
  applyTheme,
  type MarketColorMode,
  type ThemePreset,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { AgentStatus, MediaItem } from "@/types";

const TABS = [
  { id: "terminal", label: "行情", icon: Compass },
  { id: "portfolio", label: "持仓", icon: Wallet },
  { id: "news", label: "资讯", icon: Newspaper },
  { id: "agent", label: "AI 投研", icon: Sparkles },
  { id: "connections", label: "连接", icon: Settings2 },
] as const;

type View = (typeof TABS)[number]["id"];

const readHash = (): View =>
  TABS.find((t) => `#${t.id}` === window.location.hash)?.id ?? "terminal";

export default function App() {
  const w = useWorkspace();
  const [view, setView] = useState<View>(readHash);
  const [preset, setPreset] = useState<ThemePreset>(
    () => (localStorage.getItem("northstar.preset") as ThemePreset) || "obsidian",
  );
  const [colorMode, setColorMode] = useState<MarketColorMode>(
    () => (localStorage.getItem("northstar.colors") as MarketColorMode) || "us",
  );

  const [dialog, setDialog] = useState<"symbol" | "command" | null>(null);
  const [symbolInput, setSymbolInput] = useState("");
  const [symbolErr, setSymbolErr] = useState("");
  const [cmdQuery, setCmdQuery] = useState("");
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<{ text: string; key: number } | null>(null);

  const loadAgentStatus = () => {
    void api
      .getAgentStatus()
      .then(setAgentStatus)
      .catch(() => setAgentStatus(null));
  };

  useEffect(() => {
    loadAgentStatus();
  }, []);

  useEffect(() => {
    applyTheme(preset, colorMode);
  }, [preset, colorMode]);

  useEffect(() => {
    const onHash = () => setView(readHash());
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdQuery("");
        setDialog("command");
      }
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const navigate = (next: View) => {
    window.location.hash = next;
    setView(next);
    setDialog(null);
  };

  const openAddModal = () => {
    setSymbolInput("");
    setSymbolErr("");
    setDialog("symbol");
  };

  const openSymbol = (sym: string) => {
    w.setSymbol(sym);
    navigate("terminal");
  };

  const askAgentAboutArticle = (item: MediaItem) => {
    setPendingPrompt({
      text: `请结合当前市场，用中文分析这条来自 ${item.outlet} 的报道：${item.title}（${item.url}）`,
      key: Date.now(),
    });
    navigate("agent");
  };

  const submitSymbol = async (raw?: string) => {
    setSymbolErr("");
    try {
      await w.addSymbol(raw ?? symbolInput);
      setDialog(null);
    } catch (e) {
      setSymbolErr(errorMessage(e));
    }
  };

  const cmdMatches = w.watchlist.filter((sym) => {
    const s = w.snapshots[sym];
    return `${sym} ${s?.name_en ?? ""} ${s?.name_cn ?? ""}`
      .toLowerCase()
      .includes(cmdQuery.trim().toLowerCase());
  });
  const canQuickAdd = /^\.?[A-Z0-9][A-Z0-9.-]*\.(US|HK)$/i.test(cmdQuery.trim()) &&
    !w.watchlist.includes(cmdQuery.trim().toUpperCase());

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        {/* Sticky Topbar */}
        <header className="sticky top-0 z-30 h-12 border-b border-border/80 bg-card/85 backdrop-blur-md">
          <div className="mx-auto flex h-full max-w-[1680px] items-center justify-between gap-2 px-3 sm:px-4">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <button
                onClick={() => navigate("terminal")}
                className="inline-flex items-center gap-1.5 font-semibold text-sm tracking-tight shrink-0 cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 40 40" fill="none" aria-hidden="true">
                  <path
                    d="M20 2.5 23.7 15.3 37.5 20 23.7 24.7 20 37.5 16.3 24.7 2.5 20 16.3 15.3 20 2.5Z"
                    fill="currentColor"
                  />
                </svg>
                <span className="hidden sm:inline">northstar</span>
              </button>

              <nav className="flex items-center gap-0.5" aria-label="主导航">
                {TABS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => navigate(id)}
                    aria-current={view === id ? "page" : undefined}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer",
                      view === id
                        ? "bg-accent text-foreground font-semibold"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                    )}
                  >
                    <Icon size={13} className="hidden sm:inline" />
                    <span>{label}</span>
                    {id === "agent" && agentStatus?.authenticated && (
                      <i className="h-1.5 w-1.5 rounded-full bg-up" />
                    )}
                    {id === "connections" && !w.quoteReady && (
                      <i className="h-1.5 w-1.5 rounded-full bg-warn" />
                    )}
                  </button>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => {
                  setCmdQuery("");
                  setDialog("command");
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background/60 px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
              >
                <Search size={12} />
                <span className="hidden md:inline">搜索</span>
                <kbd className="hidden md:inline font-mono text-[10px] opacity-75">⌘K</kbd>
              </button>

              <Tip label={w.autoRefresh ? "每 15 秒自动刷新报价" : "自动刷新已暂停"}>
                <Badge variant={w.quoteReady ? "up" : "warn"} className="cursor-default">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      w.quoteReady
                        ? w.autoRefresh
                          ? "bg-up animate-pulse"
                          : "bg-up"
                        : "bg-warn",
                    )}
                  />
                  {w.quoteReady ? "长桥实时" : "行情未配"}
                </Badge>
              </Tip>

              <Badge variant="default" className="hidden sm:inline-flex">
                本地账本
              </Badge>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="主题与偏好" title="主题与偏好">
                    <Palette size={14} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 space-y-3">
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-muted-foreground">主题配色</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {THEME_PRESETS.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setPreset(t.id)}
                          className={cn(
                            "flex items-center justify-between rounded-md border px-2 py-1.5 text-xs transition-colors cursor-pointer",
                            preset === t.id
                              ? "border-primary bg-accent/70 font-medium"
                              : "border-border hover:bg-muted/50",
                          )}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <span className="inline-flex -space-x-1">
                              {t.swatch.map((hex) => (
                                <i
                                  key={hex}
                                  className="h-2.5 w-2.5 rounded-full border border-black/20"
                                  style={{ background: hex }}
                                />
                              ))}
                            </span>
                            {t.label}
                          </span>
                          {preset === t.id && <Check size={11} />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-muted-foreground">涨跌习惯</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          ["us", "绿涨红跌 (美股)"],
                          ["cn", "红涨绿跌 (港A)"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          onClick={() => setColorMode(id)}
                          className={cn(
                            "rounded-md border px-2 py-1 text-[11px] transition-colors cursor-pointer",
                            colorMode === id
                              ? "border-primary bg-accent/70 font-medium"
                              : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  <label className="flex items-center justify-between text-xs cursor-pointer">
                    <span>15 秒自动刷新行情</span>
                    <Switch checked={w.autoRefresh} onCheckedChange={w.setAutoRefresh} />
                  </label>
                </PopoverContent>
              </Popover>

              <Tip label="手动刷新">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="刷新"
                  disabled={w.refreshing}
                  onClick={() => void w.refresh()}
                >
                  <RefreshCw size={13} className={w.refreshing ? "animate-spin" : ""} />
                </Button>
              </Tip>
            </div>
          </div>
        </header>

        {/* Workspace */}
        <main className="mx-auto w-full max-w-[1680px] flex-1 px-3 sm:px-4 py-3 space-y-3">
          {w.online === false && (
            <div className="flex items-center justify-between rounded-lg bg-down-soft px-3 py-2 text-xs text-down">
              <span>本地服务离线</span>
              <Button size="xs" variant="outline" onClick={() => void w.refresh()}>
                重连
              </Button>
            </div>
          )}

          {view === "terminal" && (
            <div className="space-y-3 rb-enter">
              <AccountStrip workspace={w} onOpenPortfolio={() => navigate("portfolio")} />
              <div className="grid grid-cols-1 lg:grid-cols-[276px_minmax(0,1fr)] gap-3 items-start">
                <div className="order-2 lg:order-1">
                  <Watchlist
                    workspace={w}
                    onAdd={openAddModal}
                    onSelect={(sym) => w.setSymbol(sym)}
                  />
                </div>
                <div className="order-1 lg:order-2 space-y-3 min-w-0">
                  <MarketPanel
                    workspace={w}
                    onAdd={openAddModal}
                    onConnect={() => navigate("connections")}
                    onOpenAgent={() => navigate("agent")}
                  />
                  <HoldingsQuickCard
                    workspace={w}
                    onSelectSymbol={(sym) => w.setSymbol(sym)}
                    onOpenPortfolio={() => navigate("portfolio")}
                  />
                </div>
              </div>
            </div>
          )}

          {view === "portfolio" && (
            <PortfolioView workspace={w} onSelectSymbol={(sym) => openSymbol(sym)} />
          )}

          {view === "news" && <MediaFeed onAskAgent={askAgentAboutArticle} />}

          {view === "agent" && (
            <AgentHub
              workspace={w}
              agentStatus={agentStatus}
              pendingPrompt={pendingPrompt}
              onConsumedPrompt={() => setPendingPrompt(null)}
              onRefreshStatus={loadAgentStatus}
              onOpenConnections={() => navigate("connections")}
            />
          )}

          {view === "connections" && (
            <Connections
              workspace={w}
              agentStatus={agentStatus}
              onRefreshAgent={loadAgentStatus}
            />
          )}
        </main>

        {/* Add Symbol Dialog */}
        <Dialog open={dialog === "symbol"} onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent title="添加自选">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submitSymbol();
              }}
            >
              <Input
                autoFocus
                placeholder="输入代码，如 AAPL.US、700.HK、.VIX.US"
                value={symbolInput}
                onChange={(e) => {
                  setSymbolInput(e.target.value);
                  setSymbolErr("");
                }}
                maxLength={30}
              />
              {symbolErr && (
                <div className="rounded-md bg-down-soft px-2.5 py-1.5 text-[11px] text-down">
                  {symbolErr}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={!symbolInput.trim()}>
                <Plus size={13} /> 加入自选
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        {/* Command Palette Dialog */}
        <Dialog open={dialog === "command"} onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent title="快速跳转">
            <div className="space-y-2.5">
              <Input
                autoFocus
                placeholder="输入代码、英文/中文名或视图…"
                value={cmdQuery}
                onChange={(e) => setCmdQuery(e.target.value)}
              />
              <div className="max-h-72 overflow-y-auto space-y-0.5">
                {TABS.filter((t) => t.label.includes(cmdQuery.trim())).map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => navigate(id)}
                    className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs hover:bg-accent cursor-pointer"
                  >
                    <span>{label}</span>
                    <span className="text-[11px] text-muted-foreground">视图</span>
                  </button>
                ))}
                {cmdMatches.map((sym) => {
                  const s = w.snapshots[sym];
                  return (
                    <button
                      key={sym}
                      onClick={() => openSymbol(sym)}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs hover:bg-accent cursor-pointer"
                    >
                      <span className="truncate">
                        <b>{sym}</b>{" "}
                        <span className="text-muted-foreground">{s?.name_cn ?? ""}</span>
                      </span>
                      <span className="text-[11px] text-muted-foreground truncate max-w-[160px]">
                        {s?.name_en ?? ""}
                      </span>
                    </button>
                  );
                })}
                {canQuickAdd && (
                  <button
                    onClick={() => void submitSymbol(cmdQuery.trim().toUpperCase())}
                    className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs text-primary hover:bg-accent cursor-pointer"
                  >
                    <span>添加 {cmdQuery.trim().toUpperCase()} 至自选</span>
                    <Plus size={13} />
                  </button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Toast */}
        {w.notice && (
          <div
            role="status"
            className={cn(
              "fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg rb-enter",
              w.notice.tone === "err"
                ? "border-down/40 bg-down-soft text-down"
                : "border-border bg-popover text-popover-foreground",
            )}
          >
            <span>{w.notice.text}</span>
            <button
              onClick={w.clearNotice}
              aria-label="关闭提示"
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

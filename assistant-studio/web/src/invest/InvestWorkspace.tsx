import { useEffect, useState } from "react";
import {
  Compass,
  Newspaper,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AgentHub } from "./AgentHub";
import * as api from "./api";
import { Connections } from "./Connections";
import { errorMessage } from "./format";
import { MarketPanel } from "./MarketPanel";
import { AccountStrip, HoldingsQuickCard, PortfolioView } from "./Portfolio";
import type { AgentStatus } from "./types";
import { useWorkspace } from "./useWorkspace";
import { Watchlist } from "./Watchlist";

const SUB_TABS = [
  { id: "terminal", label: "行情", icon: Compass },
  { id: "portfolio", label: "持仓", icon: Wallet },
  { id: "agent", label: "AI 投研", icon: Sparkles },
  { id: "connections", label: "连接", icon: Settings2 },
] as const;

export type InvestSubView = (typeof SUB_TABS)[number]["id"];

interface InvestWorkspaceProps {
  initialSubView?: InvestSubView;
  initialSymbol?: string | null;
  onConsumeInitialSymbol?: () => void;
  onOpenFinanceFeeds: () => void;
}

export function InvestWorkspace({
  initialSubView = "terminal",
  initialSymbol,
  onConsumeInitialSymbol,
  onOpenFinanceFeeds,
}: InvestWorkspaceProps) {
  const w = useWorkspace();
  const [subView, setSubView] = useState<InvestSubView>(initialSubView);
  const [addOpen, setAddOpen] = useState(false);
  const [symbolInput, setSymbolInput] = useState("");
  const [symbolErr, setSymbolErr] = useState("");
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<{ text: string; key: number } | null>(null);

  useEffect(() => {
    setSubView(initialSubView);
  }, [initialSubView]);

  useEffect(() => {
    if (initialSymbol) {
      w.setSymbol(initialSymbol);
      setSubView("terminal");
      onConsumeInitialSymbol?.();
    }
  }, [initialSymbol, onConsumeInitialSymbol]);

  const loadAgentStatus = () => {
    void api
      .getAgentStatus()
      .then(setAgentStatus)
      .catch(() => setAgentStatus(null));
  };

  useEffect(() => {
    loadAgentStatus();
  }, []);

  const openAddModal = () => {
    setSymbolInput("");
    setSymbolErr("");
    setAddOpen(true);
  };

  const openSymbol = (sym: string) => {
    w.setSymbol(sym);
    setSubView("terminal");
  };

  const submitSymbol = async (raw?: string) => {
    setSymbolErr("");
    try {
      await w.addSymbol(raw ?? symbolInput);
      setAddOpen(false);
    } catch (e) {
      setSymbolErr(errorMessage(e));
    }
  };

  return (
    <div className="w-full pb-4 rb-enter">
      {/* Sub-navigation bar flush against topbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-tight text-foreground shrink-0 pr-1">
            <svg width="15" height="15" viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <path
                d="M20 2.5 23.7 15.3 37.5 20 23.7 24.7 20 37.5 16.3 24.7 2.5 20 16.3 15.3 20 2.5Z"
                fill="currentColor"
              />
            </svg>
            <span>投研终端</span>
          </div>

          <nav className="flex items-center gap-0.5" aria-label="投研子视图">
            {SUB_TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setSubView(id)}
                aria-current={subView === id ? "page" : undefined}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer",
                  subView === id
                    ? "bg-accent text-foreground font-semibold"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <Icon size={13} />
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

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={onOpenFinanceFeeds}
            title="前往已合并的 MyWiki 资讯中心（含 21 家财经媒体源）"
          >
            <Newspaper size={12} /> 财经资讯
          </Button>

          <Tip label={w.autoRefresh ? "每 15 秒自动刷新报价" : "自动刷新已暂停"}>
            <Badge variant={w.quoteReady ? "up" : "warn"} className="cursor-default">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  w.quoteReady ? (w.autoRefresh ? "bg-up animate-pulse" : "bg-up") : "bg-warn",
                )}
              />
              {w.quoteReady ? "长桥实时" : "行情未配"}
            </Badge>
          </Tip>

          <label className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
            <span>自动刷新</span>
            <Switch checked={w.autoRefresh} onCheckedChange={w.setAutoRefresh} />
          </label>

          <Button size="xs" variant="outline" onClick={openAddModal}>
            <Plus size={12} /> 自选
          </Button>

          <Tip label="手动刷新行情与持仓">
            <Button
              variant="ghost"
              size="icon"
              aria-label="刷新投研数据"
              disabled={w.refreshing}
              onClick={() => void w.refresh()}
            >
              <RefreshCw size={13} className={w.refreshing ? "animate-spin" : ""} />
            </Button>
          </Tip>
        </div>
      </div>

      {w.online === false && (
        <div className="flex items-center justify-between rounded-lg bg-down-soft px-3 py-2 text-xs text-down">
          <span>投研模块离线</span>
          <Button size="xs" variant="outline" onClick={() => void w.refresh()}>
            重连
          </Button>
        </div>
      )}

      {subView === "terminal" && (
        <div className="w-full">
          <div className="border-b border-border">
            <AccountStrip workspace={w} onOpenPortfolio={() => setSubView("portfolio")} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[276px_minmax(0,1fr)] gap-px bg-border border-b border-border items-stretch">
            <div className="order-2 lg:order-1 bg-card">
              <Watchlist
                workspace={w}
                onAdd={openAddModal}
                onSelect={(sym) => w.setSymbol(sym)}
              />
            </div>
            <div className="order-1 lg:order-2 flex flex-col gap-px bg-border min-w-0">
              <MarketPanel
                workspace={w}
                onAdd={openAddModal}
                onConnect={() => setSubView("connections")}
                onOpenAgent={() => setSubView("agent")}
              />
              <HoldingsQuickCard
                workspace={w}
                onSelectSymbol={(sym) => w.setSymbol(sym)}
                onOpenPortfolio={() => setSubView("portfolio")}
              />
            </div>
          </div>
        </div>
      )}

      {subView === "portfolio" && (
        <PortfolioView workspace={w} onSelectSymbol={(sym) => openSymbol(sym)} />
      )}

      {subView === "agent" && (
        <AgentHub
          workspace={w}
          agentStatus={agentStatus}
          pendingPrompt={pendingPrompt}
          onConsumedPrompt={() => setPendingPrompt(null)}
          onRefreshStatus={loadAgentStatus}
          onOpenConnections={() => setSubView("connections")}
        />
      )}

      {subView === "connections" && (
        <Connections
          workspace={w}
          agentStatus={agentStatus}
          onRefreshAgent={loadAgentStatus}
        />
      )}

      {/* Add Symbol Dialog */}
      <Dialog open={addOpen} onOpenChange={(open) => !open && setAddOpen(false)}>
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

      {/* Invest Toast */}
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
  );
}

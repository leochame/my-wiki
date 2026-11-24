import { ArrowDownRight, ArrowUpRight, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { PriceChart } from "./Chart";
import { RollingNumber } from "@/components/reactbits/RollingNumber";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tip } from "@/components/ui/tooltip";
import { PERIODS, type Workspace } from "./useWorkspace";
import { compactVol, displayTime, pctText, priceText } from "./format";
import { cn } from "@/lib/utils";
import type { CandlePeriod } from "./types";

export function MarketPanel({
  workspace: w,
  onAdd,
  onConnect,
  onOpenAgent,
}: {
  workspace: Workspace;
  onAdd: () => void;
  onConnect: () => void;
  onOpenAgent?: () => void;
}) {
  const snap = w.snapshots[w.symbol];
  const nameEn = w.quote?.name_en ?? snap?.name_en;
  const nameCn = w.quote?.name_cn ?? snap?.name_cn;
  const exchange = w.quote?.exchange ?? snap?.exchange;

  const last = w.lastPrice;
  const prevRaw = w.quote?.previous_close ?? snap?.previous_close ?? null;
  const prev = prevRaw ? Number(prevRaw) : null;
  const diff = last !== null && prev !== null ? last - prev : null;
  const change = diff !== null && prev !== null && prev > 0 ? (diff / prev) * 100 : null;
  const periodCfg = PERIODS.find((p) => p.id === w.period) ?? PERIODS[5];
  const heldPosition = w.account?.positions.find((p) => p.symbol === w.symbol);
  const costPrice = heldPosition ? Number(heldPosition.average_price) : null;

  return (
    <SpotlightCard>
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-3.5 pt-3 pb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={onAdd}
              className="text-left text-lg font-semibold tracking-tight hover:text-primary transition-colors cursor-pointer"
            >
              {w.symbol || "选择标的"}
            </button>
            {nameCn && <span className="text-xs font-medium text-muted-foreground">{nameCn}</span>}
            {exchange && <Badge variant="outline">{exchange}</Badge>}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
            {[nameEn, w.isIndex ? "指数" : w.currency].filter(Boolean).join(" · ") || "添加自选"}
          </div>
        </div>

        <div className="flex items-baseline gap-2.5 shrink-0">
          <RollingNumber
            value={last}
            format={(n) => priceText(n, w.symbol)}
            className="text-2xl font-semibold tracking-tight"
          />
          {change !== null && diff !== null && (
            <Badge variant={change >= 0 ? "up" : "down"} className="text-xs px-1.5 py-0.5">
              {change >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {diff >= 0 ? "+" : ""}
              {diff.toFixed(2)} ({pctText(change)})
            </Badge>
          )}
        </div>
      </div>

      {/* Period & Mode Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border/80 bg-muted/35 px-3 py-1.5">
        <Tabs value={w.period} onValueChange={(v) => w.setPeriod(v as CandlePeriod)}>
          <TabsList className="bg-transparent p-0 gap-0.5">
            {PERIODS.map((p) => (
              <TabsTrigger key={p.id} value={p.id} className="h-6 px-2 text-[11px]">
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-1.5">
          {onOpenAgent && w.symbol && (
            <Tip label={`用长桥 AI Agent 分析 ${w.symbol}`}>
              <Button variant="outline" size="xs" onClick={onOpenAgent}>
                <Sparkles size={11} className="text-up" /> AI 投研
              </Button>
            </Tip>
          )}
          <Tip label="切换 MA5 / MA10 / MA20 均线">
            <button
              onClick={() => w.setShowMA(!w.showMA)}
              className={cn(
                "h-6 rounded px-2 text-[11px] font-medium transition-colors cursor-pointer",
                w.showMA
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              MA
            </button>
          </Tip>
          <Tabs
            value={w.chartMode}
            onValueChange={(v) => w.setChartMode(v as "candle" | "line")}
          >
            <TabsList>
              <TabsTrigger value="candle" className="h-5 px-2">
                K线
              </TabsTrigger>
              <TabsTrigger value="line" className="h-5 px-2">
                折线
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="px-3.5 py-2.5">
        {w.candles.length > 0 ? (
          <PriceChart
            candles={w.candles}
            symbol={w.symbol}
            mode={w.chartMode}
            intraday={periodCfg.intraday}
            showMA={w.showMA}
            costPrice={costPrice}
          />
        ) : (
          <div className="flex h-[270px] flex-col items-center justify-center gap-2.5 text-xs text-muted-foreground">
            {w.loadingChart ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <>
                <span>
                  {!w.symbol
                    ? "无选中标的"
                    : !w.quoteReady
                      ? "长桥未配置"
                      : w.marketError || "暂无 K 线数据"}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={!w.symbol ? onAdd : !w.quoteReady ? onConnect : () => void w.refresh()}
                >
                  {!w.symbol ? (
                    <>
                      <Plus size={13} /> 添加自选
                    </>
                  ) : !w.quoteReady ? (
                    "配置长桥"
                  ) : (
                    <>
                      <RefreshCw size={13} /> 刷新
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Day Stats Footer */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 border-t border-border/80 bg-muted/20 px-3.5 py-2 text-xs">
        {[
          { k: "今开", v: w.quote?.open ? priceText(Number(w.quote.open), w.symbol) : "—" },
          { k: "最高", v: w.quote?.high ? priceText(Number(w.quote.high), w.symbol) : "—" },
          { k: "最低", v: w.quote?.low ? priceText(Number(w.quote.low), w.symbol) : "—" },
          { k: "昨收", v: prev ? priceText(prev, w.symbol) : "—" },
          { k: "成交量", v: compactVol(w.quote?.volume) },
          { k: "更新", v: w.quote?.timestamp ? displayTime(w.quote.timestamp, true) : "—" },
        ].map((item) => (
          <div key={item.k} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">{item.k}</span>
            <b className="font-medium text-foreground">{item.v}</b>
          </div>
        ))}
      </div>
    </SpotlightCard>
  );
}

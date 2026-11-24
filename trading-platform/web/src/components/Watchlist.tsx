import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, Plus, Search, Trash2 } from "lucide-react";
import { RollingNumber } from "@/components/reactbits/RollingNumber";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import type { Workspace } from "@/hooks/useWorkspace";
import { pctText, priceText } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filter = "all" | "us" | "index" | "held";
type SortMode = "default" | "chgDesc" | "chgAsc";

export function Watchlist({
  workspace: w,
  onAdd,
  onSelect,
}: {
  workspace: Workspace;
  onAdd: () => void;
  onSelect: (symbol: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortMode>("default");

  const heldSet = useMemo(
    () => new Set(w.account?.positions.map((p) => p.symbol) ?? []),
    [w.account],
  );

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const mapped = w.watchlist
      .filter((sym) => {
        if (filter === "index" && !sym.startsWith(".")) return false;
        if (filter === "us" && (sym.startsWith(".") || !sym.endsWith(".US"))) return false;
        if (filter === "held" && !heldSet.has(sym)) return false;
        if (!needle) return true;
        const snap = w.snapshots[sym];
        return `${sym} ${snap?.name_en ?? ""} ${snap?.name_cn ?? ""}`
          .toLowerCase()
          .includes(needle);
      })
      .map((sym) => {
        const snap = w.snapshots[sym];
        const isCur = w.symbol === sym;
        const lastRaw = isCur && w.quote ? w.quote.last : snap?.last ?? null;
        const prevRaw = isCur && w.quote ? w.quote.previous_close : snap?.previous_close ?? null;
        const last = lastRaw ? Number(lastRaw) : null;
        const prev = prevRaw ? Number(prevRaw) : null;
        const pct =
          last !== null && prev !== null && prev > 0 ? ((last - prev) / prev) * 100 : null;
        return {
          sym,
          last,
          pct,
          nameEn: (isCur ? w.quote?.name_en : null) ?? snap?.name_en,
          nameCn: (isCur ? w.quote?.name_cn : null) ?? snap?.name_cn,
        };
      });

    if (sort === "chgDesc") mapped.sort((a, b) => (b.pct ?? -999) - (a.pct ?? -999));
    if (sort === "chgAsc") mapped.sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));
    return mapped;
  }, [w.watchlist, w.snapshots, w.symbol, w.quote, query, filter, sort, heldSet]);

  const cycleSort = () =>
    setSort((cur) => (cur === "default" ? "chgDesc" : cur === "chgDesc" ? "chgAsc" : "default"));

  return (
    <Card className="flex flex-col lg:sticky lg:top-14 lg:max-h-[calc(100vh-146px)]">
      <CardHeader>
        <CardTitle>
          自选 <Badge>{w.watchlist.length}</Badge>
        </CardTitle>
        <div className="flex items-center gap-1">
          <Tip label={sort === "default" ? "按涨跌幅排序" : sort === "chgDesc" ? "涨幅降序" : "跌幅降序"}>
            <Button
              variant={sort === "default" ? "ghost" : "secondary"}
              size="xs"
              onClick={cycleSort}
            >
              <ArrowDownWideNarrow size={12} />
              {sort === "chgDesc" ? "涨↓" : sort === "chgAsc" ? "跌↓" : ""}
            </Button>
          </Tip>
          <Button variant="ghost" size="xs" onClick={onAdd}>
            <Plus size={12} /> 添加
          </Button>
        </div>
      </CardHeader>

      <div className="flex items-center gap-1.5 border-b border-border/70 px-2.5 py-1.5">
        <Search size={12} className="text-muted-foreground shrink-0" />
        <Input
          aria-label="筛选自选"
          placeholder="代码 / 中英文名"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-6 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
      </div>

      <div className="flex items-center gap-1 border-b border-border/70 px-2.5 py-1 text-[11px]">
        {(
          [
            ["all", "全部"],
            ["us", "美股"],
            ["index", "指数"],
            ["held", "持仓"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={cn(
              "rounded px-1.5 py-0.5 transition-colors cursor-pointer",
              filter === id
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border/60">
        {items.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            {w.watchlist.length ? "无匹配标的" : "暂无自选"}
          </div>
        ) : (
          items.map(({ sym, last, pct, nameEn, nameCn }) => {
            const selected = w.symbol === sym;
            const held = heldSet.has(sym);

            return (
              <div
                key={sym}
                className={cn(
                  "group relative flex items-center pr-1 transition-colors hover:bg-muted/45",
                  selected && "bg-accent/70",
                )}
              >
                {selected && <span className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-primary" />}
                <button
                  onClick={() => onSelect(sym)}
                  className="flex flex-1 min-w-0 items-center justify-between gap-2 px-2.5 py-2 text-left cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <b className="text-xs font-semibold tracking-tight text-foreground">
                        {sym.replace(/\.(US|HK)$/, "")}
                      </b>
                      {nameCn && (
                        <span className="truncate text-[11px] text-muted-foreground">{nameCn}</span>
                      )}
                      {held && (
                        <span className="rounded bg-up-soft px-1 text-[9px] font-semibold text-up">
                          持
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground/80">
                      {nameEn ?? sym}
                    </div>
                  </div>

                  <div className="flex flex-col items-end shrink-0 gap-0.5">
                    <RollingNumber
                      value={last}
                      format={(n) => priceText(n, sym)}
                      className="text-xs font-semibold"
                    />
                    <span
                      className={cn(
                        "rounded px-1 text-[10px] font-medium",
                        pct === null
                          ? "text-muted-foreground"
                          : pct >= 0
                            ? "bg-up-soft text-up"
                            : "bg-down-soft text-down",
                      )}
                    >
                      {pct !== null ? pctText(pct) : "—"}
                    </span>
                  </div>
                </button>
                <button
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
                  aria-label={`移除 ${sym}`}
                  onClick={() => void w.removeSymbol(sym)}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

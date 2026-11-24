import { useCallback, useEffect, useState } from "react";
import { Activity, Camera, Edit3, Plus, Trash2 } from "lucide-react";
import { RollingNumber } from "@/components/reactbits/RollingNumber";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Workspace } from "./useWorkspace";
import * as api from "./api";
import { displayTime, errorMessage, money, pctText, signedMoney } from "./format";
import { cn } from "@/lib/utils";
import type { EquitySnapshot, PositionItem } from "./types";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function AccountStrip({
  workspace: w,
  onOpenPortfolio,
}: {
  workspace: Workspace;
  onOpenPortfolio?: () => void;
}) {
  const acc = w.account;
  const cur = acc?.currency ?? "USD";
  const equity = acc ? Number(acc.total_equity) : null;
  const cash = acc ? Number(acc.cash_balance) : null;
  const dayPnl = acc?.day_pnl != null ? Number(acc.day_pnl) : null;
  const dayPct = acc?.day_pnl_pct != null ? Number(acc.day_pnl_pct) : null;
  const openPnl = acc?.unrealized_pnl != null ? Number(acc.unrealized_pnl) : null;
  const openPct = acc?.unrealized_pnl_pct != null ? Number(acc.unrealized_pnl_pct) : null;

  return (
    <SpotlightCard aria-label="账户概览">
      <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-border/70">
        <div className="flex flex-col gap-0.5 px-3.5 py-2.5 border-r md:border-r-0 border-border/70">
          <span className="text-[11px] text-muted-foreground">总资产</span>
          <RollingNumber
            value={equity}
            format={(n) => money(n, cur)}
            className="text-base font-semibold tracking-tight"
          />
          <span className="text-[10px] text-muted-foreground truncate">
            {acc?.account_label ?? "嘉信国际"}
          </span>
        </div>

        <div className="flex flex-col gap-0.5 px-3.5 py-2.5">
          <span className="text-[11px] text-muted-foreground">今日盈亏</span>
          <RollingNumber
            value={dayPnl}
            format={(n) => signedMoney(n, cur)}
            className={cn(
              "text-base font-semibold tracking-tight",
              dayPnl !== null && (dayPnl >= 0 ? "text-up" : "text-down"),
            )}
          />
          <span
            className={cn(
              "text-[10px]",
              dayPct !== null ? (dayPct >= 0 ? "text-up" : "text-down") : "text-muted-foreground",
            )}
          >
            {dayPct !== null ? pctText(dayPct) : "长桥实时估值"}
          </span>
        </div>

        <div className="flex flex-col gap-0.5 px-3.5 py-2.5 border-r md:border-r-0 border-border/70">
          <span className="text-[11px] text-muted-foreground">累计盈亏</span>
          <RollingNumber
            value={openPnl}
            format={(n) => signedMoney(n, cur)}
            className={cn(
              "text-base font-semibold tracking-tight",
              openPnl !== null && (openPnl >= 0 ? "text-up" : "text-down"),
            )}
          />
          <span
            className={cn(
              "text-[10px]",
              openPct !== null ? (openPct >= 0 ? "text-up" : "text-down") : "text-muted-foreground",
            )}
          >
            {openPct !== null ? pctText(openPct) : "—"}
          </span>
        </div>

        <div className="flex flex-col gap-0.5 px-3.5 py-2.5">
          <span className="text-[11px] text-muted-foreground">可用现金</span>
          <RollingNumber
            value={cash}
            format={(n) => money(n, cur)}
            className="text-base font-semibold tracking-tight"
          />
          <span className="text-[10px] text-muted-foreground">
            购买力 {acc ? money(Number(acc.buying_power), cur) : "—"}
          </span>
        </div>

        <div className="col-span-2 md:col-span-1 flex md:flex-col items-center md:items-start justify-between gap-1 px-3.5 py-2.5">
          <div className="flex md:flex-col items-baseline gap-2 md:gap-0.5">
            <span className="text-[11px] text-muted-foreground">持仓</span>
            <b className="text-base font-semibold">{acc?.positions_count ?? 0}</b>
          </div>
          {onOpenPortfolio ? (
            <button
              onClick={onOpenPortfolio}
              className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
            >
              管理持仓 →
            </button>
          ) : (
            <span className="text-[10px] text-muted-foreground">本地账本</span>
          )}
        </div>
      </div>
    </SpotlightCard>
  );
}

export function HoldingsQuickCard({
  workspace: w,
  onSelectSymbol,
  onOpenPortfolio,
}: {
  workspace: Workspace;
  onSelectSymbol: (symbol: string) => void;
  onOpenPortfolio: () => void;
}) {
  const acc = w.account;
  const cur = acc?.currency ?? "USD";
  if (!acc || acc.positions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          持仓监控 <Badge>{acc.positions.length}</Badge>
        </CardTitle>
        <button
          onClick={onOpenPortfolio}
          className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
        >
          盈亏曲线与编辑 →
        </button>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>标的</TableHead>
            <TableHead>股数</TableHead>
            <TableHead>成本 / 现价</TableHead>
            <TableHead>市值 / 占比</TableHead>
            <TableHead>今日盈亏</TableHead>
            <TableHead className="text-right">累计盈亏</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {acc.positions.map((pos) => {
            const dayPnl = pos.day_pnl != null ? Number(pos.day_pnl) : null;
            const openPnl = pos.unrealized_pnl != null ? Number(pos.unrealized_pnl) : null;
            const active = w.symbol === pos.symbol;
            return (
              <TableRow
                key={pos.symbol}
                onClick={() => onSelectSymbol(pos.symbol)}
                className={cn("cursor-pointer", active && "bg-accent/55")}
              >
                <TableCell>
                  <b className="font-semibold">{pos.symbol}</b>
                  {pos.name_cn && (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{pos.name_cn}</span>
                  )}
                </TableCell>
                <TableCell className="font-medium">{pos.quantity}</TableCell>
                <TableCell>
                  <span>{money(Number(pos.average_price), cur)}</span>
                  <span className="mx-1 text-muted-foreground">→</span>
                  <b>{pos.current_price ? money(Number(pos.current_price), cur) : "—"}</b>
                </TableCell>
                <TableCell>
                  <b>{money(Number(pos.market_value), cur)}</b>
                  {pos.weight_pct && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {pos.weight_pct}%
                    </span>
                  )}
                </TableCell>
                <TableCell className={cn(dayPnl !== null && (dayPnl >= 0 ? "text-up" : "text-down"))}>
                  {dayPnl !== null ? signedMoney(dayPnl, cur) : "—"}
                  {pos.day_pnl_pct != null && (
                    <span className="ml-1 text-[10px]">({pctText(Number(pos.day_pnl_pct))})</span>
                  )}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium",
                    openPnl !== null && (openPnl >= 0 ? "text-up" : "text-down"),
                  )}
                >
                  {openPnl !== null ? signedMoney(openPnl, cur) : "—"}
                  {pos.unrealized_pnl_pct != null && (
                    <span className="ml-1 text-[10px]">
                      ({pctText(Number(pos.unrealized_pnl_pct))})
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

export function PortfolioView({
  workspace: w,
  onSelectSymbol,
}: {
  workspace: Workspace;
  onSelectSymbol: (symbol: string) => void;
}) {
  const acc = w.account;
  const cur = acc?.currency ?? "USD";

  const [editingPos, setEditingPos] = useState<Partial<PositionItem> | null>(null);
  const [sym, setSym] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [posNotes, setPosNotes] = useState("");
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);

  const [cashModal, setCashModal] = useState(false);
  const [cashInput, setCashInput] = useState("");

  const [history, setHistory] = useState<EquitySnapshot[]>([]);
  const [histRange, setHistRange] = useState<"1d" | "1w" | "1m" | "all">("1w");
  const [histMetric, setHistMetric] = useState<"equity" | "pnl">("pnl");
  const [recordingSnap, setRecordingSnap] = useState(false);

  const loadHistory = useCallback(() => {
    void api
      .getPortfolioHistory(histRange)
      .then(setHistory)
      .catch(() => {});
  }, [histRange]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, acc?.updated_at]);

  const takeSnapshot = async () => {
    setRecordingSnap(true);
    try {
      await api.recordPortfolioSnapshot();
      loadHistory();
    } finally {
      setRecordingSnap(false);
    }
  };

  const totalEq = acc ? Number(acc.total_equity) : 0;
  const cashVal = acc ? Number(acc.cash_balance) : 0;

  const allocSegments =
    acc && totalEq > 0
      ? [
          ...acc.positions.slice(0, 4).map((p, i) => ({
            label: p.symbol.replace(/\.(US|HK)$/, ""),
            pct: Math.max(0, (Number(p.market_value) / totalEq) * 100),
            color: CHART_COLORS[i % CHART_COLORS.length],
          })),
          ...(cashVal > 0
            ? [{ label: "现金", pct: (cashVal / totalEq) * 100, color: "var(--muted-foreground)" }]
            : []),
        ]
      : [];

  const openPosModal = (pos?: PositionItem) => {
    setFormErr("");
    setEditingPos(pos ?? {});
    setSym(pos?.symbol ?? "");
    setQty(pos?.quantity ?? "");
    setCost(pos?.average_price ?? "");
    setPosNotes(pos?.notes ?? "");
  };

  const submitPosition = async () => {
    setSaving(true);
    setFormErr("");
    try {
      await w.savePosition({ symbol: sym, quantity: qty, avg_cost: cost, notes: posNotes });
      setEditingPos(null);
    } catch (e) {
      setFormErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const submitCash = async () => {
    setSaving(true);
    setFormErr("");
    try {
      await w.saveCash(cashInput);
      setCashModal(false);
    } catch (e) {
      setFormErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const liveHint = sym.trim() ? w.snapshots[sym.trim().toUpperCase()]?.last : null;

  return (
    <div className="flex flex-col gap-px bg-border border-b border-border rb-enter">
      <AccountStrip workspace={w} />

      {allocSegments.length > 0 && (
        <Card className="px-3.5 py-2.5 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>资产分布</span>
            <div className="flex flex-wrap items-center gap-3">
              {allocSegments.map((seg) => (
                <span key={seg.label} className="inline-flex items-center gap-1.5">
                  <i className="h-2 w-2 rounded-full" style={{ background: seg.color }} />
                  <span className="text-foreground font-medium">{seg.label}</span>
                  <span>{seg.pct.toFixed(1)}%</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
            {allocSegments.map((seg) => (
              <div
                key={seg.label}
                style={{ width: `${seg.pct}%`, background: seg.color }}
                className="h-full transition-all duration-300"
              />
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>
              嘉信国际持仓 <Badge>{acc?.positions_count ?? 0}</Badge>
            </CardTitle>
            <Badge variant="default">本地账本 · 长桥实时估值</Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFormErr("");
                setCashInput(acc?.cash_balance ?? "0");
                setCashModal(true);
              }}
            >
              <Edit3 size={12} /> 可用现金
            </Button>
            <Button size="sm" onClick={() => openPosModal()}>
              <Plus size={12} /> 录入持仓
            </Button>
          </div>
        </CardHeader>

        {acc && acc.positions.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>标的</TableHead>
                <TableHead>股数</TableHead>
                <TableHead>成本均价</TableHead>
                <TableHead>现价</TableHead>
                <TableHead>市值 / 占比</TableHead>
                <TableHead>今日盈亏</TableHead>
                <TableHead>累计盈亏</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {acc.positions.map((pos) => {
                const dayPnl = pos.day_pnl != null ? Number(pos.day_pnl) : null;
                const openPnl = pos.unrealized_pnl != null ? Number(pos.unrealized_pnl) : null;
                return (
                  <TableRow key={pos.symbol}>
                    <TableCell>
                      <button
                        className="text-left hover:text-primary cursor-pointer"
                        onClick={() => onSelectSymbol(pos.symbol)}
                      >
                        <b className="font-semibold">{pos.symbol}</b>
                        {pos.name_cn && (
                          <span className="ml-1 text-[11px] text-muted-foreground">
                            {pos.name_cn}
                          </span>
                        )}
                      </button>
                      <div className="text-[10px] text-muted-foreground">
                        {pos.name_en ?? pos.notes ?? pos.asset_type}
                      </div>
                    </TableCell>
                    <TableCell className="font-semibold">{pos.quantity}</TableCell>
                    <TableCell>
                      <div>{money(Number(pos.average_price), cur)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        成本 {money(Number(pos.cost_basis), cur)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {pos.current_price ? money(Number(pos.current_price), cur) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold">{money(Number(pos.market_value), cur)}</div>
                      {pos.weight_pct && (
                        <div className="text-[10px] text-muted-foreground">{pos.weight_pct}%</div>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(dayPnl !== null && (dayPnl >= 0 ? "text-up" : "text-down"))}
                    >
                      <div className="font-medium">
                        {dayPnl !== null ? signedMoney(dayPnl, cur) : "—"}
                      </div>
                      {pos.day_pnl_pct != null && (
                        <div className="text-[10px]">{pctText(Number(pos.day_pnl_pct))}</div>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(openPnl !== null && (openPnl >= 0 ? "text-up" : "text-down"))}
                    >
                      <div className="font-medium">
                        {openPnl !== null ? signedMoney(openPnl, cur) : "—"}
                      </div>
                      {pos.unrealized_pnl_pct != null && (
                        <div className="text-[10px]">{pctText(Number(pos.unrealized_pnl_pct))}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`编辑 ${pos.symbol}`}
                          onClick={() => openPosModal(pos)}
                        >
                          <Edit3 size={12} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`删除 ${pos.symbol}`}
                          onClick={() => void w.removePosition(pos.symbol)}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="flex items-center justify-center gap-3 py-10 text-xs text-muted-foreground">
            <span>暂无持仓</span>
            <Button variant="outline" size="sm" onClick={() => openPosModal()}>
              <Plus size={12} /> 录入嘉信国际持仓
            </Button>
          </div>
        )}
      </Card>

      {/* Real-time Equity & P&L History */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>
              <Activity size={13} className="text-primary" />
              实时盈亏记录 <Badge>{history.length}</Badge>
            </CardTitle>
            <span className="hidden sm:inline text-[10px] text-muted-foreground">
              长桥实时估值 · 每 5 分钟自动记账
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Tabs value={histMetric} onValueChange={(v) => setHistMetric(v as "equity" | "pnl")}>
              <TabsList>
                <TabsTrigger value="pnl" className="h-5 px-2">
                  累计盈亏
                </TabsTrigger>
                <TabsTrigger value="equity" className="h-5 px-2">
                  总资产
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs
              value={histRange}
              onValueChange={(v) => setHistRange(v as "1d" | "1w" | "1m" | "all")}
            >
              <TabsList>
                <TabsTrigger value="1d" className="h-5 px-2">
                  24H
                </TabsTrigger>
                <TabsTrigger value="1w" className="h-5 px-2">
                  7天
                </TabsTrigger>
                <TabsTrigger value="1m" className="h-5 px-2">
                  30天
                </TabsTrigger>
                <TabsTrigger value="all" className="h-5 px-2">
                  全部
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              variant="outline"
              size="xs"
              disabled={recordingSnap}
              onClick={() => void takeSnapshot()}
            >
              <Camera size={11} /> 记一笔
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <EquityCurveChart rows={history} metric={histMetric} currency={cur} />

          {history.length > 0 && (
            <div className="max-h-60 overflow-y-auto rounded-md border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>记录时间</TableHead>
                    <TableHead>总资产</TableHead>
                    <TableHead>持仓市值</TableHead>
                    <TableHead>可用现金</TableHead>
                    <TableHead>今日盈亏</TableHead>
                    <TableHead className="text-right">累计盈亏</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...history]
                    .reverse()
                    .slice(0, 20)
                    .map((row) => {
                      const dPnl = row.day_pnl != null ? Number(row.day_pnl) : null;
                      const uPnl = row.unrealized_pnl != null ? Number(row.unrealized_pnl) : null;
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="text-[11px] text-muted-foreground tabular-nums">
                            {displayTime(row.recorded_at, true)}
                          </TableCell>
                          <TableCell className="font-semibold">
                            {money(Number(row.total_equity), cur)}
                          </TableCell>
                          <TableCell>{money(Number(row.market_value), cur)}</TableCell>
                          <TableCell>{money(Number(row.cash_balance), cur)}</TableCell>
                          <TableCell
                            className={cn(dPnl !== null && (dPnl >= 0 ? "text-up" : "text-down"))}
                          >
                            {dPnl !== null ? signedMoney(dPnl, cur) : "—"}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-medium",
                              uPnl !== null && (uPnl >= 0 ? "text-up" : "text-down"),
                            )}
                          >
                            {uPnl !== null ? signedMoney(uPnl, cur) : "—"}
                            {row.unrealized_pnl_pct != null && (
                              <span className="ml-1 text-[10px]">
                                ({pctText(Number(row.unrealized_pnl_pct))})
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingPos} onOpenChange={(open) => !open && setEditingPos(null)}>
        <DialogContent
          title={editingPos?.symbol ? `编辑持仓 · ${editingPos.symbol}` : "录入嘉信国际持仓"}
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitPosition();
            }}
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>代码（如 NVDA.US）</span>
                {liveHint && <span>长桥现价 ${Number(liveHint).toFixed(2)}</span>}
              </div>
              <Input
                list="watchlist-symbols"
                autoFocus
                placeholder="NVDA.US"
                value={sym}
                onChange={(e) => setSym(e.target.value)}
                disabled={!!editingPos?.symbol || saving}
              />
              <datalist id="watchlist-symbols">
                {w.watchlist
                  .filter((s) => !s.startsWith("."))
                  .map((s) => (
                    <option key={s} value={s} />
                  ))}
              </datalist>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-[11px] text-muted-foreground">持仓股数</span>
                <Input
                  inputMode="decimal"
                  placeholder="10"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1">
                <span className="text-[11px] text-muted-foreground">成本均价 (USD)</span>
                <Input
                  inputMode="decimal"
                  placeholder="150.00"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">备注</span>
              <Input
                placeholder="可选"
                value={posNotes}
                onChange={(e) => setPosNotes(e.target.value)}
                disabled={saving}
              />
            </div>
            {formErr && (
              <div className="rounded-md bg-down-soft px-2.5 py-1.5 text-[11px] text-down">
                {formErr}
              </div>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={saving || !sym.trim() || !qty.trim() || !cost.trim()}
            >
              保存持仓
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cashModal} onOpenChange={setCashModal}>
        <DialogContent title="设置嘉信国际可用现金">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitCash();
            }}
          >
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">可用现金 (USD)</span>
              <Input
                autoFocus
                inputMode="decimal"
                placeholder="50000"
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                disabled={saving}
              />
            </div>
            {formErr && (
              <div className="rounded-md bg-down-soft px-2.5 py-1.5 text-[11px] text-down">
                {formErr}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={saving || !cashInput.trim()}>
              保存
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EquityCurveChart({
  rows,
  metric,
  currency,
}: {
  rows: EquitySnapshot[];
  metric: "equity" | "pnl";
  currency: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center rounded-md border border-dashed border-border/70 text-xs text-muted-foreground">
        暂无盈亏快照，点击右上角「记一笔」或等待系统自动记录
      </div>
    );
  }

  const values = rows.map((r) =>
    metric === "pnl" ? Number(r.unrealized_pnl ?? 0) : Number(r.total_equity),
  );
  const latest = values[values.length - 1];
  const color = metric === "pnl" ? (latest >= 0 ? "var(--up)" : "var(--down)") : "var(--primary)";

  if (rows.length === 1) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/25 px-3.5 py-3 text-xs">
        <span className="text-muted-foreground">
          已记录首条基准快照（{displayTime(rows[0].recorded_at, true)}），后续每 5 分钟自动绘制曲线
        </span>
        <b className={cn("font-semibold", metric === "pnl" && (latest >= 0 ? "text-up" : "text-down"))}>
          {metric === "pnl" ? signedMoney(latest, currency) : money(latest, currency)}
        </b>
      </div>
    );
  }

  const W = 760;
  const H = 148;
  const padL = 8;
  const padR = 68;
  const padT = 14;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let minV = Math.min(...values);
  let maxV = Math.max(...values);
  if (metric === "pnl") {
    minV = Math.min(minV, 0);
    maxV = Math.max(maxV, 0);
  }
  const span = maxV - minV || Math.max(Math.abs(maxV) * 0.05, 1);
  const lo = minV - span * 0.1;
  const hi = maxV + span * 0.1;

  const xOf = (i: number) => padL + (i / (values.length - 1)) * plotW;
  const yOf = (v: number) => padT + ((hi - v) / (hi - lo)) * plotH;

  const points = values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
  const area = `${padL},${padT + plotH} ${points} ${(padL + plotW).toFixed(1)},${padT + plotH}`;
  const zeroY = metric === "pnl" ? yOf(0) : null;
  const activeIdx = hoverIdx !== null && hoverIdx < rows.length ? hoverIdx : values.length - 1;
  const activeRow = rows[activeIdx];
  const activeVal = values[activeIdx];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{displayTime(activeRow.recorded_at, true)}</span>
        <div className="flex items-center gap-3">
          <span>
            总资产 <b className="text-foreground">{money(Number(activeRow.total_equity), currency)}</b>
          </span>
          {activeRow.unrealized_pnl != null && (
            <span>
              累计盈亏{" "}
              <b className={Number(activeRow.unrealized_pnl) >= 0 ? "text-up" : "text-down"}>
                {signedMoney(Number(activeRow.unrealized_pnl), currency)}
              </b>
            </span>
          )}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[148px] w-full select-none overflow-visible"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * W;
          const idx = Math.round(((relX - padL) / plotW) * (values.length - 1));
          setHoverIdx(Math.max(0, Math.min(values.length - 1, idx)));
        }}
      >
        <defs>
          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {[0, 0.5, 1].map((t) => {
          const v = hi - t * (hi - lo);
          const y = padT + t * plotH;
          return (
            <g key={t}>
              <line
                x1={padL}
                x2={padL + plotW}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeOpacity="0.55"
                strokeDasharray="2 3"
              />
              <text
                x={padL + plotW + 6}
                y={y + 3}
                fill="var(--muted-foreground)"
                fontSize="10"
              >
                {metric === "pnl" ? signedMoney(v, currency) : money(v, currency)}
              </text>
            </g>
          );
        })}

        {zeroY !== null && zeroY >= padT && zeroY <= padT + plotH && (
          <line
            x1={padL}
            x2={padL + plotW}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--muted-foreground)"
            strokeOpacity="0.55"
            strokeDasharray="3 3"
          />
        )}

        <polygon points={area} fill="url(#eqGrad)" />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="1.75"
          strokeLinejoin="round"
        />

        <line
          x1={xOf(activeIdx)}
          x2={xOf(activeIdx)}
          y1={padT}
          y2={padT + plotH}
          stroke="var(--muted-foreground)"
          strokeOpacity="0.35"
          strokeDasharray="2 2"
        />
        <circle
          cx={xOf(activeIdx)}
          cy={yOf(activeVal)}
          r="3.5"
          fill={color}
          stroke="var(--card)"
          strokeWidth="1.5"
        />

        <text x={padL} y={H - 4} fill="var(--muted-foreground)" fontSize="10">
          {displayTime(rows[0].recorded_at, true)}
        </text>
        <text
          x={padL + plotW}
          y={H - 4}
          textAnchor="end"
          fill="var(--muted-foreground)"
          fontSize="10"
        >
          {displayTime(rows[rows.length - 1].recorded_at, true)}
        </text>
      </svg>
    </div>
  );
}

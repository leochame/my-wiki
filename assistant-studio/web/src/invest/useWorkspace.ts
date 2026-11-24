import { useCallback, useEffect, useState } from "react";
import * as api from "./api";
import { errorMessage } from "./format";
import type {
  AccountOverview,
  Candle,
  CandlePeriod,
  ChartMode,
  Health,
  Quote,
  WatchlistSnapshot,
} from "./types";

export const PERIODS: Array<{ id: CandlePeriod; label: string; count: number; intraday: boolean }> = [
  { id: "1m", label: "1m", count: 90, intraday: true },
  { id: "5m", label: "5m", count: 96, intraday: true },
  { id: "15m", label: "15m", count: 96, intraday: true },
  { id: "30m", label: "30m", count: 90, intraday: true },
  { id: "60m", label: "60m", count: 80, intraday: true },
  { id: "day", label: "日K", count: 90, intraday: false },
  { id: "week", label: "周K", count: 78, intraday: false },
  { id: "month", label: "月K", count: 60, intraday: false },
];

export function useWorkspace() {
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, WatchlistSnapshot>>({});
  const [symbol, setSymbol] = useState("");
  const [period, setPeriod] = useState<CandlePeriod>("5m");
  const [chartMode, setChartMode] = useState<ChartMode>("candle");
  const [showMA, setShowMA] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(
    () => localStorage.getItem("northstar.autoRefresh") !== "off",
  );

  const [quote, setQuote] = useState<Quote | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [account, setAccount] = useState<AccountOverview | null>(null);

  const [online, setOnline] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingChart, setLoadingChart] = useState(false);
  const [marketError, setMarketError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const notify = useCallback((text: string, tone: "ok" | "err" = "ok") => setNotice({ text, tone }), []);

  useEffect(() => {
    localStorage.setItem("northstar.autoRefresh", autoRefresh ? "on" : "off");
  }, [autoRefresh]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const loadSnapshots = useCallback(async (ready: boolean) => {
    if (!ready) return setSnapshots({});
    const list = await api.getWatchlistSnapshots().catch(() => []);
    setSnapshots(Object.fromEntries(list.map((item) => [item.symbol, item])));
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [h, w, a] = await Promise.all([
        api.getHealth(),
        api.getWatchlist(),
        api.getAccount().catch(() => null),
      ]);
      setHealth(h);
      setWatchlist(w);
      setAccount(a);
      setOnline(true);
      setSymbol((cur) => (w.includes(cur) ? cur : (w[0] ?? "")));
      setReloadTick((n) => n + 1);
      await loadSnapshots(h.longbridge_ready);
    } catch (e) {
      setOnline(false);
      notify(errorMessage(e), "err");
    } finally {
      setRefreshing(false);
    }
  }, [loadSnapshots, notify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let active = true;
    setMarketError("");
    if (!symbol || !online || !health?.longbridge_ready) {
      setQuote(null);
      setCandles([]);
      return;
    }
    const cfg = PERIODS.find((p) => p.id === period) ?? PERIODS[5];
    setLoadingChart(true);
    void Promise.all([api.getQuote(symbol), api.getCandles(symbol, cfg.id, cfg.count)])
      .then(([q, c]) => {
        if (!active) return;
        setQuote(q);
        setCandles(c);
      })
      .catch((e) => {
        if (active) setMarketError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoadingChart(false);
      });
    return () => {
      active = false;
    };
  }, [symbol, period, reloadTick, online, health?.longbridge_ready]);

  // Silent 15s live market & portfolio valuation poll when tab is visible
  useEffect(() => {
    if (!autoRefresh || !online || !health?.longbridge_ready) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadSnapshots(true);
      if (symbol) {
        const cfg = PERIODS.find((p) => p.id === period) ?? PERIODS[5];
        void api.getQuote(symbol).then(setQuote).catch(() => {});
        if (cfg.intraday) {
          void api.getCandles(symbol, cfg.id, cfg.count).then(setCandles).catch(() => {});
        }
      }
      void api.getAccount().then(setAccount).catch(() => {});
    }, 15000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, online, health?.longbridge_ready, symbol, period, loadSnapshots]);

  const quoteReady = !!online && !!health?.longbridge_ready;
  const isIndex = symbol.startsWith(".");
  const currency = symbol.endsWith(".HK") ? "HKD" : "USD";
  const lastPrice = quote
    ? Number(quote.last)
    : snapshots[symbol]?.last
      ? Number(snapshots[symbol].last)
      : null;

  const addSymbol = async (raw: string) => {
    const value = raw.trim().toUpperCase();
    const next = await api.addWatchSymbol(value);
    setWatchlist(next);
    setSymbol(value);
    void loadSnapshots(quoteReady);
    notify(`已关注 ${value}`);
  };

  const removeSymbol = async (value: string) => {
    const next = await api.removeWatchSymbol(value);
    setWatchlist(next);
    if (symbol === value) setSymbol(next[0] ?? "");
    notify(`已移除 ${value}`);
  };

  const saveCash = async (cash: string) => {
    setAccount(await api.setCashBalance(cash));
    notify("可用现金已更新");
  };

  const savePosition = async (pos: {
    symbol: string;
    quantity: string;
    avg_cost: string;
    notes?: string;
  }) => {
    setAccount(await api.upsertPosition(pos));
    notify(`已保存持仓 ${pos.symbol.toUpperCase()}`);
  };

  const removePosition = async (sym: string) => {
    setAccount(await api.deletePosition(sym));
    notify(`已删除持仓 ${sym}`);
  };

  return {
    watchlist,
    snapshots,
    symbol,
    setSymbol,
    period,
    setPeriod,
    chartMode,
    setChartMode,
    showMA,
    setShowMA,
    autoRefresh,
    setAutoRefresh,
    quote,
    candles,
    health,
    account,
    online,
    refreshing,
    loadingChart,
    marketError,
    refresh,
    notice,
    clearNotice: () => setNotice(null),
    quoteReady,
    isIndex,
    currency,
    lastPrice,
    addSymbol,
    removeSymbol,
    saveCash,
    savePosition,
    removePosition,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;

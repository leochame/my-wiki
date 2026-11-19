import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addWatchSymbol,
  getCandles,
  getHealth,
  getOrders,
  getQuote,
  getWatchlist,
  removeWatchSymbol,
  requestPreview,
  submitOrder,
} from "../lib/api";
import type {
  Candle,
  Health,
  OrderEntry,
  OrderPayload,
  OrderType,
  Preview,
  Quote,
  Side,
} from "../types";

export const RANGES = { "1W": 5, "1M": 21, "3M": 63, "1Y": 252 };
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "请求未能完成，请重试";
export const money = (value: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
export const displayTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });

export function useWorkspace() {
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [symbol, setSymbol] = useState("");
  const [range, setRange] = useState<keyof typeof RANGES>("3M");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [connection, setConnection] = useState<
    "checking" | "online" | "offline"
  >("checking");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [marketError, setMarketError] = useState("");
  const [side, setSide] = useState<Side>("buy");
  const [orderType, setOrderType] = useState<OrderType>("limit");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState<{
    preview: Preview;
    payload: OrderPayload;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState<OrderEntry[]>([]);
  const [orderError, setOrderError] = useState("");
  const [notice, setNotice] = useState<{
    message: string;
    tone: "success" | "error";
  } | null>(null);
  const [reload, setReload] = useState(0);
  const submitting = useRef(false);
  const refreshInFlight = useRef(false);
  const payload = useMemo<OrderPayload>(
    () => ({
      symbol,
      side,
      quantity,
      order_type: orderType,
      ...(orderType === "limit" ? { limit_price: limitPrice } : {}),
    }),
    [symbol, side, quantity, orderType, limitPrice],
  );
  const currentPayload = useRef(payload);
  currentPayload.current = payload;
  const notify = useCallback(
    (message: string, tone: "success" | "error" = "success") =>
      setNotice({ message, tone }),
    [],
  );

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      const [nextHealth, nextOrders, nextWatchlist] = await Promise.all([
        getHealth(),
        getOrders(),
        getWatchlist(),
      ]);
      setHealth(nextHealth);
      setOrders(nextOrders);
      setWatchlist(nextWatchlist);
      setConnection("online");
      setSymbol((current) =>
        nextWatchlist.includes(current) ? current : (nextWatchlist[0] ?? ""),
      );
      setReload((current) => current + 1);
    } catch (error) {
      setConnection("offline");
      notify(errorMessage(error), "error");
    } finally {
      setRefreshing(false);
      refreshInFlight.current = false;
    }
  }, [notify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    let active = true;
    setQuote(null);
    setCandles([]);
    setMarketError("");
    setLoading(false);
    if (
      !symbol ||
      connection !== "online" ||
      health?.market_data_provider !== "longbridge"
    )
      return;
    setLoading(true);
    void Promise.all([getQuote(symbol), getCandles(symbol, RANGES[range])])
      .then(([nextQuote, nextCandles]) => {
        if (active) {
          setQuote(nextQuote);
          setCandles(nextCandles);
        }
      })
      .catch((error) => {
        if (active) setMarketError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [symbol, range, reload, connection, health?.market_data_provider]);
  useEffect(() => {
    setPending(null);
    setOrderError("");
    setConfirmation("");
  }, [payload]);
  useEffect(() => {
    setLimitPrice("");
  }, [symbol]);
  useEffect(() => {
    setPending(null);
  }, [health?.trading_mode]);

  const live = health?.trading_mode === "live";
  const quoteConfigured =
    connection === "online" && health?.market_data_provider === "longbridge";
  const validOrder =
    connection === "online" &&
    !!symbol &&
    Number.isFinite(Number(quantity)) &&
    Number(quantity) > 0 &&
    (orderType === "market" ||
      (Number.isFinite(Number(limitPrice)) && Number(limitPrice) > 0));
  const currency = symbol.endsWith(".HK") ? "HKD" : "USD";
  const last = quote ? Number(quote.last) : null;
  const estimatedPrice = orderType === "limit" ? Number(limitPrice) : last;
  const estimate =
    validOrder && estimatedPrice && estimatedPrice > 0
      ? money(Number(quantity) * estimatedPrice, currency)
      : "—";

  const previewOrder = async () => {
    if (!validOrder || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setPending(null);
    setOrderError("");
    const snapshot = JSON.stringify(payload);
    try {
      const preview = await requestPreview(payload);
      if (JSON.stringify(currentPayload.current) === snapshot)
        setPending({
          preview,
          payload: { ...payload, preview_id: preview.preview_id },
        });
    } catch (error) {
      setOrderError(errorMessage(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const confirmOrder = async () => {
    if (!pending || busy || submitting.current) return;
    const { preview_id: _previewId, ...previewedPayload } = pending.payload;
    if (
      JSON.stringify(currentPayload.current) !==
      JSON.stringify(previewedPayload)
    )
      return;
    submitting.current = true;
    setBusy(true);
    setOrderError("");
    try {
      const result = await submitOrder({
        ...pending.payload,
        ...(live ? { confirmation } : {}),
      });
      setPending(null);
      setConfirmation("");
      notify(
        result.mode === "live"
          ? "委托已提交至嘉信，请核查成交状态。"
          : "纸上订单已保存，未向券商发送。 ",
      );
      await refresh();
    } catch (error) {
      setOrderError(errorMessage(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const addSymbol = async (input: string) => {
    const value = input.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.-]*\.(US|HK)$/.test(value) || value.length > 30)
      throw new Error("请输入带市场后缀的证券代码，如 AAPL.US 或 700.HK");
    const next = await addWatchSymbol(value);
    setWatchlist(next);
    setSymbol(value);
    notify(`${value} 已加入自选`);
  };
  const removeSymbol = async (value: string) => {
    try {
      const next = await removeWatchSymbol(value);
      setWatchlist(next);
      if (symbol === value) setSymbol(next[0] ?? "");
      notify(`${value} 已从自选移除`);
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  };

  return {
    watchlist,
    symbol,
    setSymbol,
    range,
    setRange,
    quote,
    candles,
    health,
    connection,
    refreshing,
    refresh,
    loading,
    marketError,
    side,
    setSide,
    orderType,
    setOrderType,
    quantity,
    setQuantity,
    limitPrice,
    setLimitPrice,
    confirmation,
    setConfirmation,
    pending,
    cancelPreview: () => setPending(null),
    busy,
    orders,
    orderError,
    notice,
    setNotice,
    notify,
    live,
    quoteConfigured,
    validOrder,
    currency,
    estimate,
    previewOrder,
    confirmOrder,
    addSymbol,
    removeSymbol,
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;

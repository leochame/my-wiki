import type { Candle, Health, OrderEntry, OrderResult, Preview, Quote, OrderPayload } from "../types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("无法连接服务，请检查后端是否正在运行");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail ?? `请求失败（${response.status}）`);
  if (body === null) throw new Error("服务返回了无效响应");
  return body as T;
}

function post<T>(url: string, payload: unknown): Promise<T> {
  return request<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

export const getHealth = () => request<Health>("/api/health");
export const getQuote = (symbol: string) => request<Quote>(`/api/quotes/${encodeURIComponent(symbol)}`);
export const getCandles = (symbol: string, count: number) => request<Candle[]>(`/api/candles/${encodeURIComponent(symbol)}?count=${count}`);
export const getOrders = () => request<OrderEntry[]>("/api/orders");
export const getWatchlist = () => request<string[]>("/api/watchlist");
export const addWatchSymbol = (symbol: string) => post<string[]>("/api/watchlist", { symbol });
export const removeWatchSymbol = (symbol: string) => request<string[]>(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" });
export const requestPreview = (payload: OrderPayload) => post<Preview>("/api/orders/preview", payload);
export const submitOrder = (payload: OrderPayload) => post<OrderResult>("/api/orders", payload);

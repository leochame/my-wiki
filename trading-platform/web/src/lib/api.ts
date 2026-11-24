import type {
  AccountOverview,
  AgentChatResponse,
  AgentStatus,
  Candle,
  CandlePeriod,
  EquitySnapshot,
  Health,
  LongbridgeAgentInfo,
  MediaFeedResponse,
  Quote,
  SymbolIntel,
  WatchlistSnapshot,
} from "../types";

async function req<T>(url: string, options?: RequestInit, timeoutMs = 15000): Promise<T> {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }).catch(() => {
    throw new Error("无法连接本地服务或请求超时");
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `请求失败 (${res.status})`);
  return body as T;
}

const send = <T>(
  method: "POST" | "PUT" | "PATCH",
  url: string,
  payload?: unknown,
  timeoutMs = 15000,
) =>
  req<T>(
    url,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    },
    timeoutMs,
  );

export const getHealth = () => req<Health>("/api/health");
export const getAccount = () => req<AccountOverview>("/api/account");
export const setCashBalance = (cash_balance: string) =>
  send<AccountOverview>("PUT", "/api/portfolio/cash", { cash_balance });
export const upsertPosition = (payload: {
  symbol: string;
  quantity: string;
  avg_cost: string;
  notes?: string;
}) => send<AccountOverview>("POST", "/api/portfolio/positions", payload);
export const deletePosition = (symbol: string) =>
  req<AccountOverview>(`/api/portfolio/positions/${encodeURIComponent(symbol)}`, {
    method: "DELETE",
  });
export const getPortfolioHistory = (range: "1d" | "1w" | "1m" | "all" = "1w") =>
  req<EquitySnapshot[]>(`/api/portfolio/history?range=${range}`);
export const recordPortfolioSnapshot = () =>
  send<EquitySnapshot[]>("POST", "/api/portfolio/snapshot");

export const getWatchlist = () => req<string[]>("/api/watchlist");
export const getWatchlistSnapshots = () => req<WatchlistSnapshot[]>("/api/watchlist/snapshots");
export const addWatchSymbol = (symbol: string) => send<string[]>("POST", "/api/watchlist", { symbol });
export const removeWatchSymbol = (symbol: string) =>
  req<string[]>(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" });

export const getQuote = (symbol: string) => req<Quote>(`/api/quotes/${encodeURIComponent(symbol)}`);
export const getCandles = (symbol: string, period: CandlePeriod, count: number) =>
  req<Candle[]>(`/api/candles/${encodeURIComponent(symbol)}?period=${period}&count=${count}`);

export const getAgentStatus = () => req<AgentStatus>("/api/agent/status", undefined, 15000);
export const loginAgentWithCode = (auth_code: string) =>
  send<AgentStatus>("POST", "/api/agent/login", { auth_code }, 25000);
export const listAgents = () =>
  req<{ agents: LongbridgeAgentInfo[] }>("/api/agent/list", undefined, 25000);
export const chatWithAgent = (payload: {
  agent_uid: string;
  query: string;
  chat_uid?: string;
  parent_message_id?: string;
}) => send<AgentChatResponse>("POST", "/api/agent/chat", payload, 160000);
export const getSymbolIntel = (symbol: string) =>
  req<SymbolIntel>(`/api/agent/intel/${encodeURIComponent(symbol)}`, undefined, 25000);

export const getMediaFeed = (params?: {
  outlet?: string;
  category?: string;
  lang?: string;
  q?: string;
  limit?: number;
}) => {
  const qs = new URLSearchParams();
  if (params?.outlet) qs.set("outlet", params.outlet);
  if (params?.category) qs.set("category", params.category);
  if (params?.lang) qs.set("lang", params.lang);
  if (params?.q) qs.set("q", params.q);
  if (params?.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return req<MediaFeedResponse>(`/api/media/feed${suffix}`, undefined, 20000);
};
export const refreshMediaFeed = () =>
  send<MediaFeedResponse>("POST", "/api/media/refresh", {}, 30000);
export const addMediaSource = (payload: {
  name: string;
  outlet: string;
  category?: string;
  language?: string;
  feed_url: string;
  site_url?: string;
}) => send<MediaFeedResponse>("POST", "/api/media/sources", payload, 30000);
export const toggleMediaSource = (id: string, enabled: boolean) =>
  send<MediaFeedResponse>("PATCH", `/api/media/sources/${encodeURIComponent(id)}`, { enabled }, 30000);
export const deleteMediaSource = (id: string) =>
  req<MediaFeedResponse>(`/api/media/sources/${encodeURIComponent(id)}`, { method: "DELETE" }, 15000);

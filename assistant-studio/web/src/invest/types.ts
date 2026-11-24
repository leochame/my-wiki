export type CandlePeriod = "1m" | "5m" | "15m" | "30m" | "60m" | "day" | "week" | "month";
export type ChartMode = "candle" | "line";

export interface Health {
  longbridge_ready: boolean;
  longbridge_missing: string[];
  env_file_loaded: boolean;
  env_file_path: string;
}

export interface Quote {
  symbol: string;
  name_en: string | null;
  name_cn: string | null;
  exchange: string | null;
  last: string;
  previous_close: string | null;
  open: string | null;
  high: string | null;
  low: string | null;
  volume: number | null;
  timestamp: string;
}

export interface WatchlistSnapshot {
  symbol: string;
  name_en: string | null;
  name_cn: string | null;
  exchange: string | null;
  last: string | null;
  previous_close: string | null;
  timestamp: string | null;
}

export interface Candle {
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: number | null;
}

export interface PositionItem {
  symbol: string;
  name_en: string | null;
  name_cn: string | null;
  asset_type: string;
  quantity: string;
  average_price: string;
  current_price: string | null;
  market_value: string;
  cost_basis: string;
  day_pnl: string | null;
  day_pnl_pct: string | null;
  unrealized_pnl: string | null;
  unrealized_pnl_pct: string | null;
  weight_pct: string | null;
  notes: string;
}

export interface AccountOverview {
  account_label: string;
  account_type: string;
  currency: string;
  total_equity: string;
  cash_balance: string;
  buying_power: string;
  day_pnl: string | null;
  day_pnl_pct: string | null;
  unrealized_pnl: string | null;
  unrealized_pnl_pct: string | null;
  positions_count: number;
  positions: PositionItem[];
  updated_at: string;
  source: "local_ledger" | string;
}

export interface AgentStatus {
  cli_available: boolean;
  authenticated: boolean;
  status: string;
  dc_region: string | null;
  logged_in_at: number | null;
  packages_count: number;
  detail: string | null;
}

export interface LongbridgeAgentInfo {
  uid: string;
  name: string;
  description: string;
  mode: string;
}

export interface AgentChatResponse {
  chat_uid?: string;
  message_id?: string;
  status?: string;
  answer?: string;
  further_questions?: string[];
  elapsed_time?: number;
  references?: Array<{ title?: string; url?: string; source?: string }>;
}

export interface SymbolIntel {
  symbol: string;
  market_temp: {
    market: string;
    temperature: number | null;
    valuation: number | null;
    sentiment: number | null;
    description: string | null;
  } | null;
  calc: {
    pe?: string;
    pb?: string;
    dps_rate?: string;
    turnover_rate?: string;
    mktcap?: string;
  } | null;
  capital: {
    timestamp?: string;
    capital_in?: { large?: string; medium?: string; small?: string };
    capital_out?: { large?: string; medium?: string; small?: string };
  } | null;
  report: {
    report_txt?: string;
    indicators?: Array<{
      field_name?: string;
      indicator_name?: string;
      indicator_value?: string;
      yoy?: string;
    }>;
  } | null;
  news: Array<{
    id?: string;
    title?: string;
    url?: string;
    published_at?: string;
  }>;
  filings: Array<{
    id?: string;
    title?: string;
    file_name?: string;
    publish_at?: string;
    file_urls?: string[];
  }>;
}

export interface MediaSourceStatus {
  id: string;
  name: string;
  outlet: string;
  category: string;
  language: string;
  feed_url: string;
  site_url: string;
  enabled: boolean;
  added_at: string;
  ok: boolean;
  item_count: number;
  error: string | null;
  fetched_at: string | null;
}

export interface MediaItem {
  id: string;
  source_id: string;
  source_name: string;
  outlet: string;
  category: string;
  language: string;
  title: string;
  url: string;
  summary: string | null;
  published_at: string | null;
}

export interface MediaFeedResponse {
  updated_at: string | null;
  refreshing: boolean;
  sources: MediaSourceStatus[];
  items: MediaItem[];
}

export interface EquitySnapshot {
  id: number;
  recorded_at: string;
  total_equity: string;
  cash_balance: string;
  market_value: string;
  cost_basis: string;
  day_pnl: string | null;
  unrealized_pnl: string | null;
  unrealized_pnl_pct: string | null;
}

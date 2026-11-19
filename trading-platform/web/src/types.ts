export type Side = "buy" | "sell";
export type OrderType = "market" | "limit";

export interface Quote {
  symbol: string;
  last: string;
  previous_close: string | null;
  open: string | null;
  high: string | null;
  low: string | null;
  volume: number | null;
  timestamp: string | null;
  source: string;
}

export interface Candle {
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: number | null;
}

export interface Preview {
  preview_id: string;
  expires_in_seconds: number;
  symbol: string;
  side: Side;
  quantity: string;
  order_type: OrderType;
  limit_price: string | null;
  mode: "paper" | "live";
  executable: boolean;
  warnings: string[];
}

export interface OrderResult {
  order_id: string;
  status: string;
  mode: "paper" | "live";
  provider: string;
  message?: string;
}

export interface Health {
  status: string;
  environment: string;
  trading_mode: "paper" | "live";
  market_data_provider: string;
  execution_provider: string;
  account_data_connected: boolean;
  runtime: string;
  storage: string;
}

export interface OrderPayload {
  symbol: string;
  side: Side;
  quantity: string;
  order_type: OrderType;
  limit_price?: string;
  confirmation?: string;
  preview_id?: string;
}

export interface OrderEntry extends OrderResult {
  symbol: string;
  side: Side;
  quantity: string;
  order_type: OrderType;
  limit_price: string | null;
  created_at: string;
}

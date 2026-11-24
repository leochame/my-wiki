export const money = (value: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export const signedMoney = (value: number, currency = "USD") =>
  `${value > 0 ? "+" : ""}${money(value, currency)}`;

export const priceText = (value: number, symbol: string) =>
  symbol.startsWith(".")
    ? value.toFixed(2)
    : money(value, symbol.endsWith(".HK") ? "HKD" : "USD");

export const pctText = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export const compactVol = (value: number | null | undefined) => {
  if (value == null) return "—";
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
  return value.toLocaleString("en-US");
};

export const displayTime = (value: string, includeSeconds = false) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
  });

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "请求失败";

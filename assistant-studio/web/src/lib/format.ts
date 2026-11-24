export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return String(e || "发生未知错误");
}

export function displayTime(raw?: string | number | null, withSeconds = false): string {
  if (raw == null || raw === "") return "—";
  const d = typeof raw === "number" ? new Date(raw * 1000) : new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

export function moneyUsd(val?: string | number | null): string {
  if (val == null || val === "") return "—";
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

export function signedUsd(val?: string | number | null): string {
  if (val == null || val === "") return "—";
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  const abs = moneyUsd(Math.abs(n));
  return n >= 0 ? `+${abs}` : `-${abs}`;
}

export const AREA_LABELS: Record<string, string> = {
  all: "全部文档",
  writing: "写作",
  notes: "笔记与理财",
  "worth-reading": "阅读",
  task: "任务",
  "career-development": "职业发展",
  memory: "记忆",
  papers: "论文",
  investment: "投资",
  root: "根目录",
};

export const STATUS_LABELS: Record<string, string> = {
  todo: "待办",
  "in-progress": "进行中",
  waiting: "等待中",
  done: "已完成",
  cancelled: "已取消",
};

export const PRIORITY_LABELS: Record<string, string> = {
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低",
};

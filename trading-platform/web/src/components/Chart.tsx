import { useId, useMemo, useState } from "react";
import type { Candle } from "../types";
import { money } from "../hooks/useWorkspace";

function pointsFor(candles: Candle[]) {
  const values = candles.map((candle) => Number(candle.close));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.0001, max - min);
  return {
    min,
    max,
    points: values.map((value, index) => ({
      x: 8 + (index / Math.max(1, values.length - 1)) * 744,
      y: 265 - ((value - min) / range) * 240,
      value,
      candle: candles[index],
    })),
  };
}
export function PriceChart({
  candles,
  currency = "USD",
}: {
  candles: Candle[];
  currency?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, "");
  const chart = useMemo(() => pointsFor(candles), [candles]);
  if (!candles.length) return null;
  const line = chart.points
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`,
    )
    .join(" ");
  const point = active === null ? null : chart.points[active];
  const date = (value: string) =>
    new Date(value).toLocaleDateString("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "numeric",
      day: "numeric",
    });
  return (
    <div
      className="price-chart"
      onMouseLeave={() => setActive(null)}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        setActive(
          Math.min(
            candles.length - 1,
            Math.max(
              0,
              Math.round(
                ((event.clientX - bounds.left) / bounds.width) *
                  (candles.length - 1),
              ),
            ),
          ),
        );
      }}
    >
      <svg
        viewBox="0 0 760 285"
        role="img"
        aria-label={`${currency} 实际价格走势，${date(candles[0].timestamp)} 至 ${date(candles[candles.length - 1].timestamp)}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-line)" stopOpacity=".16" />
            <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[75, 140, 205, 265].map((y) => (
          <line key={y} x1="8" x2="752" y1={y} y2={y} className="chart-grid" />
        ))}
        <path d={`${line} L752,270 L8,270 Z`} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--chart-line)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {point && (
          <>
            <line
              x1={point.x}
              x2={point.x}
              y1="14"
              y2="270"
              className="chart-crosshair"
            />
            <circle cx={point.x} cy={point.y} r="4" className="chart-dot" />
          </>
        )}
      </svg>
      {point && (
        <div
          className="chart-tooltip"
          style={{
            left: `${Math.min(84, Math.max(16, (point.x / 760) * 100))}%`,
          }}
        >
          <strong>{money(point.value, currency)}</strong>
          <span>{date(point.candle.timestamp)}</span>
        </div>
      )}
      <div className="chart-axis">
        <span>{date(candles[0].timestamp)}</span>
        <span>{date(candles[Math.floor(candles.length / 2)].timestamp)}</span>
        <span>{date(candles[candles.length - 1].timestamp)}</span>
      </div>
    </div>
  );
}

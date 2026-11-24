import { useId, useMemo, useState } from "react";
import { compactVol, pctText, priceText } from "@/lib/format";
import type { Candle, ChartMode } from "@/types";

const W = 800;
const PAD_L = 8;
const PAD_R = 68;
const PRICE_TOP = 18;
const PRICE_BOT = 236;
const VOL_TOP = 258;
const VOL_BOT = 304;
const PLOT_W = W - PAD_L - PAD_R;

function calcMA(closes: number[], period: number): Array<number | null> {
  let sum = 0;
  return closes.map((val, i) => {
    sum += val;
    if (i >= period) sum -= closes[i - period];
    return i >= period - 1 ? sum / period : null;
  });
}

function formatBarTime(iso: string, intraday: boolean) {
  const d = new Date(iso);
  return intraday
    ? d.toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : d.toLocaleDateString("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
      });
}

function formatAxisLabel(iso: string, intraday: boolean) {
  const d = new Date(iso);
  return intraday
    ? d.toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : d.toLocaleDateString("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "numeric",
        day: "numeric",
      });
}

function maPath(
  values: Array<number | null>,
  bars: Array<{ x: number }>,
  yOf: (p: number) => number,
) {
  let path = "";
  let drawing = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) {
      drawing = false;
      continue;
    }
    path += `${drawing ? "L" : "M"}${bars[i].x.toFixed(1)},${yOf(v).toFixed(1)} `;
    drawing = true;
  }
  return path.trim();
}

export function PriceChart({
  candles,
  symbol,
  mode,
  intraday,
  showMA = true,
  costPrice,
}: {
  candles: Candle[];
  symbol: string;
  mode: ChartMode;
  intraday: boolean;
  showMA?: boolean;
  costPrice?: number | null;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const gradId = useId().replace(/:/g, "");

  const model = useMemo(() => {
    const parsed = candles.map((c) => ({
      t: c.timestamp,
      o: Number(c.open),
      h: Number(c.high),
      l: Number(c.low),
      c: Number(c.close),
      v: c.volume ?? 0,
    }));
    if (!parsed.length) return null;

    const closes = parsed.map((b) => b.c);
    const ma5 = calcMA(closes, 5);
    const ma10 = calcMA(closes, 10);
    const ma20 = calcMA(closes, 20);

    let highIdx = 0;
    let lowIdx = 0;
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i].h > parsed[highIdx].h) highIdx = i;
      if (parsed[i].l < parsed[lowIdx].l) lowIdx = i;
    }

    let min = parsed[lowIdx].l;
    let max = parsed[highIdx].h;
    const mid = (min + max) / 2;
    if (costPrice && costPrice > 0 && Math.abs(costPrice - mid) / Math.max(mid, 1) <= 0.25) {
      min = Math.min(min, costPrice);
      max = Math.max(max, costPrice);
    }
    const pad = Math.max((max - min) * 0.08, max * 0.002, 0.01);
    min -= pad;
    max += pad;
    const range = Math.max(max - min, 0.0001);
    const maxVol = Math.max(...parsed.map((b) => b.v), 1);

    const step = PLOT_W / Math.max(parsed.length, 1);
    const bodyW = Math.max(2, Math.min(11, step * 0.66));
    const yOf = (price: number) => PRICE_BOT - ((price - min) / range) * (PRICE_BOT - PRICE_TOP);

    const bars = parsed.map((b, i) => {
      const x = PAD_L + i * step + step / 2;
      const up = b.c >= b.o;
      return {
        ...b,
        x,
        up,
        yO: yOf(b.o),
        yC: yOf(b.c),
        yH: yOf(b.h),
        yL: yOf(b.l),
        volH: (b.v / maxVol) * (VOL_BOT - VOL_TOP),
        ma5: ma5[i],
        ma10: ma10[i],
        ma20: ma20[i],
      };
    });

    const ticks = [0, 0.33, 0.67, 1].map((r) => {
      const val = max - r * range;
      return { val, y: yOf(val) };
    });

    return {
      bars,
      min,
      max,
      maxVol,
      bodyW,
      yOf,
      ticks,
      highIdx,
      lowIdx,
      ma5Path: maPath(ma5, bars, yOf),
      ma10Path: maPath(ma10, bars, yOf),
      ma20Path: maPath(ma20, bars, yOf),
    };
  }, [candles, costPrice]);

  if (!model) return null;

  const idx = hoverIdx !== null && hoverIdx < model.bars.length ? hoverIdx : model.bars.length - 1;
  const bar = model.bars[idx];
  const lastBar = model.bars[model.bars.length - 1];
  const prevClose = idx > 0 ? model.bars[idx - 1].c : bar.o;
  const barPct = prevClose > 0 ? ((bar.c - prevClose) / prevClose) * 100 : 0;
  const ampPct = bar.l > 0 ? ((bar.h - bar.l) / bar.l) * 100 : 0;

  const linePath = model.bars
    .map((b, i) => `${i ? "L" : "M"}${b.x.toFixed(1)},${b.yC.toFixed(1)}`)
    .join(" ");
  const firstX = model.bars[0].x;
  const lastX = lastBar.x;
  const midBar = model.bars[Math.floor(model.bars.length / 2)];
  const hiBar = model.bars[model.highIdx];
  const loBar = model.bars[model.lowIdx];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/85">{formatBarTime(bar.t, intraday)}</span>
        <span>
          开 <b className="font-medium text-foreground">{priceText(bar.o, symbol)}</b>
        </span>
        <span>
          高 <b className="font-medium text-foreground">{priceText(bar.h, symbol)}</b>
        </span>
        <span>
          低 <b className="font-medium text-foreground">{priceText(bar.l, symbol)}</b>
        </span>
        <span>
          收{" "}
          <b className={bar.up ? "font-semibold text-up" : "font-semibold text-down"}>
            {priceText(bar.c, symbol)}
          </b>
        </span>
        <span className={barPct >= 0 ? "font-medium text-up" : "font-medium text-down"}>
          {pctText(barPct)}
        </span>
        <span>
          幅 <b className="font-medium text-foreground">{ampPct.toFixed(2)}%</b>
        </span>
        <span>
          量 <b className="font-medium text-foreground">{compactVol(bar.v)}</b>
        </span>
        {showMA && (
          <span className="inline-flex items-center gap-2 ml-auto">
            {bar.ma5 !== null && (
              <span style={{ color: "var(--chart-ma5)" }}>MA5 {bar.ma5.toFixed(2)}</span>
            )}
            {bar.ma10 !== null && (
              <span style={{ color: "var(--chart-ma10)" }}>MA10 {bar.ma10.toFixed(2)}</span>
            )}
            {bar.ma20 !== null && (
              <span style={{ color: "var(--chart-ma20)" }}>MA20 {bar.ma20.toFixed(2)}</span>
            )}
          </span>
        )}
      </div>

      <div
        className="relative select-none cursor-crosshair"
        onMouseLeave={() => setHoverIdx(null)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const relX = ((event.clientX - rect.left) / rect.width) * W;
          const clamped = Math.max(0, Math.min(PLOT_W, relX - PAD_L));
          const next = Math.min(
            model.bars.length - 1,
            Math.max(0, Math.floor((clamped / PLOT_W) * model.bars.length)),
          );
          setHoverIdx(next);
        }}
      >
        <svg viewBox={`0 0 ${W} 308`} className="block w-full h-auto" role="img" aria-label={`${symbol} K线图`}>
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--up)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--up)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {model.ticks.map((tick, i) => (
            <g key={i}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={tick.y}
                y2={tick.y}
                stroke="var(--border)"
                strokeOpacity="0.7"
                strokeWidth="1"
              />
              {Math.abs(tick.y - lastBar.yC) > 12 && (
                <text
                  x={W - PAD_R + 6}
                  y={tick.y + 3}
                  fill="var(--muted-foreground)"
                  fontSize="10"
                >
                  {tick.val.toFixed(tick.val >= 100 ? 1 : 2)}
                </text>
              )}
            </g>
          ))}

          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={VOL_TOP - 6}
            y2={VOL_TOP - 6}
            stroke="var(--border)"
            strokeOpacity="0.7"
            strokeWidth="1"
          />
          <text x={W - PAD_R + 6} y={VOL_TOP + 8} fill="var(--muted-foreground)" fontSize="9">
            {compactVol(model.maxVol)}
          </text>

          {model.bars.map((b, i) => (
            <rect
              key={`v-${i}`}
              x={b.x - model.bodyW / 2}
              y={VOL_BOT - b.volH}
              width={model.bodyW}
              height={Math.max(1, b.volH)}
              fill={b.up ? "var(--up)" : "var(--down)"}
              fillOpacity={hoverIdx === i ? 0.6 : 0.25}
              rx="0.6"
            />
          ))}

          {mode === "line" ? (
            <>
              <path
                d={`${linePath} L${lastX.toFixed(1)},${PRICE_BOT} L${firstX.toFixed(1)},${PRICE_BOT} Z`}
                fill={`url(#${gradId})`}
              />
              <path d={linePath} fill="none" stroke="var(--up)" strokeWidth="1.8" />
            </>
          ) : (
            model.bars.map((b, i) => {
              const top = Math.min(b.yO, b.yC);
              const h = Math.max(1.5, Math.abs(b.yC - b.yO));
              const color = b.up ? "var(--up)" : "var(--down)";
              return (
                <g key={i} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.88}>
                  <line x1={b.x} x2={b.x} y1={b.yH} y2={b.yL} stroke={color} strokeWidth="1.2" />
                  <rect
                    x={b.x - model.bodyW / 2}
                    y={top}
                    width={model.bodyW}
                    height={h}
                    fill={color}
                    rx="0.9"
                  />
                </g>
              );
            })
          )}

          {showMA && (
            <g fill="none" strokeWidth="1.15" opacity="0.88">
              {model.ma5Path && <path d={model.ma5Path} stroke="var(--chart-ma5)" />}
              {model.ma10Path && <path d={model.ma10Path} stroke="var(--chart-ma10)" />}
              {model.ma20Path && <path d={model.ma20Path} stroke="var(--chart-ma20)" />}
            </g>
          )}

          {/* High / Low extreme price markers */}
          <text
            x={Math.min(W - PAD_R - 36, Math.max(PAD_L + 4, hiBar.x - 16))}
            y={Math.max(11, hiBar.yH - 4)}
            fill="var(--muted-foreground)"
            fontSize="9.5"
          >
            {hiBar.h.toFixed(2)}
          </text>
          <text
            x={Math.min(W - PAD_R - 36, Math.max(PAD_L + 4, loBar.x - 16))}
            y={Math.min(PRICE_BOT + 10, loBar.yL + 11)}
            fill="var(--muted-foreground)"
            fontSize="9.5"
          >
            {loBar.l.toFixed(2)}
          </text>

          {/* Last price reference line & pill */}
          <g>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={lastBar.yC}
              y2={lastBar.yC}
              stroke={lastBar.up ? "var(--up)" : "var(--down)"}
              strokeOpacity="0.45"
              strokeDasharray="2 3"
              strokeWidth="1"
            />
            <rect
              x={W - PAD_R + 2}
              y={lastBar.yC - 8}
              width={64}
              height={16}
              rx="3"
              fill={lastBar.up ? "var(--up)" : "var(--down)"}
            />
            <text
              x={W - PAD_R + 7}
              y={lastBar.yC + 3.2}
              fill="#ffffff"
              fontSize="9.5"
              fontWeight="600"
            >
              {lastBar.c.toFixed(2)}
            </text>
          </g>

          {/* Holding cost basis reference line */}
          {costPrice && costPrice >= model.min && costPrice <= model.max && (
            <g>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={model.yOf(costPrice)}
                y2={model.yOf(costPrice)}
                stroke="var(--warn)"
                strokeDasharray="5 3"
                strokeWidth="1.25"
              />
              <rect
                x={PAD_L + 2}
                y={model.yOf(costPrice) - 15}
                width={82}
                height={14}
                rx="3"
                fill="var(--warn)"
              />
              <text
                x={PAD_L + 6}
                y={model.yOf(costPrice) - 5}
                fill="#ffffff"
                fontSize="9"
                fontWeight="600"
              >
                成本 {costPrice.toFixed(2)}
              </text>
            </g>
          )}

          {/* Crosshair */}
          {hoverIdx !== null && (
            <g>
              <line
                x1={bar.x}
                x2={bar.x}
                y1={PRICE_TOP}
                y2={VOL_BOT}
                stroke="var(--muted-foreground)"
                strokeOpacity="0.55"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={bar.yC}
                y2={bar.yC}
                stroke="var(--muted-foreground)"
                strokeOpacity="0.55"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              {mode === "line" && (
                <circle
                  cx={bar.x}
                  cy={bar.yC}
                  r="3.5"
                  fill="var(--up)"
                  stroke="var(--card)"
                  strokeWidth="2"
                />
              )}
            </g>
          )}
        </svg>
      </div>

      <div className="flex items-center justify-between pr-[68px] pl-1 text-[10px] text-muted-foreground">
        <span>{formatAxisLabel(model.bars[0].t, intraday)}</span>
        <span>{formatAxisLabel(midBar.t, intraday)}</span>
        <span>{formatAxisLabel(lastBar.t, intraday)}</span>
      </div>
    </div>
  );
}

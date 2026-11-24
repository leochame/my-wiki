import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function RollingNumber({
  value,
  format,
  className,
  flash = true,
}: {
  value: number | null;
  format: (n: number) => string;
  className?: string;
  flash?: boolean;
}) {
  const [shown, setShown] = useState<number | null>(value);
  const [pulse, setPulse] = useState<"up" | "down" | null>(null);
  const prevRef = useRef<number | null>(value);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (value === null) {
      setShown(null);
      return;
    }
    if (prev === null || prev === value) {
      setShown(value);
      return;
    }

    if (flash) {
      setPulse(value > prev ? "up" : "down");
    }

    const start = performance.now();
    const dur = 260;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(prev + (value - prev) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    const timer = flash ? window.setTimeout(() => setPulse(null), 700) : 0;
    return () => {
      cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
    };
  }, [value, flash]);

  return (
    <span
      className={cn(
        "rounded px-0.5 transition-colors tabular-nums",
        pulse === "up" && "rb-flash-up",
        pulse === "down" && "rb-flash-down",
        className,
      )}
    >
      {shown === null ? "—" : format(shown)}
    </span>
  );
}

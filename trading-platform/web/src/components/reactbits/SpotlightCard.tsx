import { useRef, useState, type HTMLAttributes, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

export function SpotlightCard({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <section
      ref={ref}
      onMouseMove={onMove}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      className={cn(
        "relative rounded-lg border border-border bg-card text-card-foreground shadow-2xs min-w-0 overflow-hidden",
        className,
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: active ? 1 : 0,
          background: `radial-gradient(360px circle at ${pos.x}px ${pos.y}px, var(--spotlight), transparent 72%)`,
        }}
      />
      <div className="relative z-10 flex h-full flex-col flex-1">{children}</div>
    </section>
  );
}

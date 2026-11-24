import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StarBorder({
  active = true,
  color = "var(--up)",
  className,
  children,
}: {
  active?: boolean;
  color?: string;
  className?: string;
  children: ReactNode;
}) {
  if (!active) return <>{children}</>;
  return (
    <div
      className={cn("rb-star-border inline-flex", className)}
      style={{ "--star-color": color } as CSSProperties}
    >
      {children}
    </div>
  );
}

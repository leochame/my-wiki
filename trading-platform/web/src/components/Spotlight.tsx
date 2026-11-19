import { useEffect, useRef } from "react";

export function Spotlight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const move = (event: PointerEvent) => {
      const bounds = node.getBoundingClientRect();
      node.style.setProperty("--spot-x", `${event.clientX - bounds.left}px`);
      node.style.setProperty("--spot-y", `${event.clientY - bounds.top}px`);
    };
    node.addEventListener("pointermove", move);
    return () => node.removeEventListener("pointermove", move);
  }, []);
  return <div className="spotlight" ref={ref} aria-hidden="true" />;
}

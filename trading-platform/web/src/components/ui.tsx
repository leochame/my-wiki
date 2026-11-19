import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger"; size?: "sm" | "md" | "lg" }) {
  return <button className={`ui-button ui-button-${variant} ui-button-${size} ${className}`} {...props} />;
}

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={`ui-card ${className}`} {...props}>{children}</section>;
}

export function CardHeader({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ui-card-header ${className}`} {...props}>{children}</div>;
}

export function CardTitle({ className = "", children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={`ui-card-title ${className}`} {...props}>{children}</h2>;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "positive" | "negative" | "warning" | "blue"; children: ReactNode }) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ui-input ${className}`} {...props} />;
}

export function Select({ className = "", children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`ui-input ui-select ${className}`} {...props}>{children}</select>;
}

export function Divider() {
  return <div className="ui-divider" />;
}

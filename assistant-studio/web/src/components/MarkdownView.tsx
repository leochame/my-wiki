import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Check, Copy } from "lucide-react";

interface MarkdownProps {
  text: string;
  onOpenWikilink?: (target: string) => void;
  onOpenUrl?: (url: string, title?: string) => void;
  className?: string;
}

/**
 * Preprocess Markdown before feeding react-markdown:
 * 1. Strip YAML front matter if present.
 * 2. Convert Obsidian [[target|alias]] wikilinks (outside fenced code blocks) into
 *    markdown links `[alias](wikilink:target)` so they render cleanly everywhere including inside tables.
 */
function preprocessMarkdown(raw: string): string {
  let body = raw.replace(/^\uFEFF/, "");
  if (body.startsWith("---\n") || body.startsWith("---\r\n")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) {
      const nextNl = body.indexOf("\n", end + 4);
      body = nextNl !== -1 ? body.slice(nextNl + 1) : "";
    }
  }

  const lines = body.split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      if (line.trim().startsWith("```")) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
        const [rawTarget, alias] = inner.split("|");
        const cleanTarget = rawTarget.split("#")[0].trim();
        const label = (alias ?? rawTarget).trim();
        return `[${label}](wikilink:${encodeURIComponent(cleanTarget)})`;
      });
    })
    .join("\n");
}

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const lang = (className ?? "").replace(/^language-/, "").trim();
  const codeStr = String(children ?? "").replace(/\n$/, "");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeStr);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-muted/70">
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/90 px-3 py-1 text-[10px] text-muted-foreground">
        <span className="font-mono uppercase">{lang || "code"}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-background/60 hover:text-foreground cursor-pointer"
        >
          {copied ? <Check size={10} className="text-up" /> : <Copy size={10} />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed">
        <code>{codeStr}</code>
      </pre>
    </div>
  );
}

/**
 * Full-featured Markdown renderer for Agent chat & panels:
 * GFM (tables, strikethrough, task lists, nested lists, autolinks) + KaTeX math ($ / $$)
 * + copyable code blocks + clickable Obsidian [[wikilinks]] + in-app Reader links.
 */
export function MarkdownView({ text, onOpenWikilink, onOpenUrl, className }: MarkdownProps) {
  const prepared = preprocessMarkdown(text);

  return (
    <div className={className ? `md-full space-y-2 ${className}` : "md-full space-y-2"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { output: "mathml", throwOnError: false }]]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-base font-semibold tracking-tight text-foreground pt-1">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[13.5px] font-semibold text-foreground border-b border-border/60 pb-1 pt-2">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs font-semibold text-foreground pt-1.5">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-xs font-medium text-foreground pt-1">{children}</h4>
          ),
          p: ({ children }) => (
            <p className="text-xs leading-relaxed text-foreground/90">{children}</p>
          ),
          ul: ({ children, className: cls }) => (
            <ul
              className={
                cls?.includes("contains-task-list")
                  ? "space-y-1 pl-0.5 list-none text-xs leading-relaxed"
                  : "space-y-1 pl-4 list-disc text-xs leading-relaxed"
              }
            >
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="space-y-1 pl-4 list-decimal text-xs leading-relaxed">{children}</ol>
          ),
          li: ({ children }) => <li className="text-foreground/90">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/50 bg-muted/35 rounded-r-md pl-3 pr-2 py-1.5 text-xs text-muted-foreground space-y-1">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border/80 my-2.5" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-md border border-border/80">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted/60 border-b border-border">{children}</thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-border/60">{children}</tbody>
          ),
          tr: ({ children }) => <tr className="hover:bg-muted/30">{children}</tr>,
          th: ({ children }) => (
            <th className="px-2.5 py-1.5 text-left font-semibold text-foreground">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-2.5 py-1.5 align-top text-foreground/90">{children}</td>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className: cls, children }) => {
            const isBlock = Boolean(cls) || String(children ?? "").includes("\n");
            if (isBlock) {
              return <CodeBlock className={cls}>{children}</CodeBlock>;
            }
            return (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.86em] text-foreground">
                {children}
              </code>
            );
          },
          a: ({ href, children }) => {
            const rawHref = href ?? "";
            if (rawHref.startsWith("wikilink:")) {
              const target = decodeURIComponent(rawHref.slice("wikilink:".length));
              return (
                <button
                  type="button"
                  onClick={() => onOpenWikilink?.(target)}
                  className="inline rounded bg-accent/80 px-1 py-0.5 text-[0.92em] font-medium text-primary hover:underline cursor-pointer"
                >
                  {children}
                </button>
              );
            }
            const isWeb = /^https?:\/\//i.test(rawHref);
            if (isWeb && onOpenUrl) {
              return (
                <button
                  type="button"
                  onClick={() => onOpenUrl(rawHref, typeof children === "string" ? children : undefined)}
                  className="inline text-primary underline underline-offset-2 hover:opacity-80 cursor-pointer text-left"
                >
                  {children}
                </button>
              );
            }
            if (!isWeb && rawHref && onOpenWikilink) {
              return (
                <button
                  type="button"
                  onClick={() => onOpenWikilink(rawHref)}
                  className="inline text-primary underline underline-offset-2 hover:opacity-80 cursor-pointer"
                >
                  {children}
                </button>
              );
            }
            return (
              <a
                href={rawHref}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {children}
              </a>
            );
          },
          input: ({ type, checked }) =>
            type === "checkbox" ? (
              <input
                type="checkbox"
                checked={Boolean(checked)}
                readOnly
                className="mr-1.5 align-middle accent-primary"
              />
            ) : null,
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt ?? ""}
              loading="lazy"
              className="my-2 max-w-full rounded-lg border border-border"
            />
          ),
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}

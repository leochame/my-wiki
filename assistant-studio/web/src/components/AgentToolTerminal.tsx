import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Terminal } from "lucide-react";

export interface ToolTerminalEntry {
  id: string;
  entryType: "call" | "result";
  toolName?: string;
  toolInput?: string;
  output?: string;
  isError?: boolean;
}

export interface ChatTimelineItem {
  id: string;
  eventId?: number;
  kind: "user" | "assistant" | "tool_call" | "tool_result" | "error";
  text: string;
  toolName?: string;
  toolInput?: string;
  output?: string;
  isError?: boolean;
  contextFiles?: string[];
  createdAt?: string;
}

export type GroupedTimelineItem =
  | { groupKind: "message"; item: ChatTimelineItem }
  | { groupKind: "tools"; id: string; entries: ToolTerminalEntry[] };

/** Collapse consecutive tool_call / tool_result events into one single terminal block. */
export function groupChatTimeline(items: ChatTimelineItem[]): GroupedTimelineItem[] {
  const result: GroupedTimelineItem[] = [];
  let pendingTools: ToolTerminalEntry[] = [];

  const flush = () => {
    if (pendingTools.length === 0) return;
    result.push({
      groupKind: "tools",
      id: `tg-${pendingTools[0].id}`,
      entries: pendingTools,
    });
    pendingTools = [];
  };

  for (const item of items) {
    if (item.kind === "tool_call") {
      pendingTools.push({
        id: item.id,
        entryType: "call",
        toolName: item.toolName || "tool",
        toolInput: item.toolInput || "",
      });
    } else if (item.kind === "tool_result") {
      pendingTools.push({
        id: item.id,
        entryType: "result",
        output: item.output || item.text || "",
        isError: item.isError,
      });
    } else {
      flush();
      result.push({ groupKind: "message", item });
    }
  }
  flush();
  return result;
}

function formatToolCommand(toolName: string, rawInput: string): { cmd: string; detail?: string } {
  if (!rawInput.trim()) return { cmd: toolName };
  try {
    const obj = JSON.parse(rawInput) as Record<string, unknown>;
    const nameLower = toolName.toLowerCase();
    if (nameLower === "bash" && typeof obj.command === "string") {
      return { cmd: obj.command };
    }
    if (typeof obj.file_path === "string") {
      return { cmd: `${toolName} ${obj.file_path}` };
    }
    if (typeof obj.path === "string") {
      return { cmd: `${toolName} ${obj.path}` };
    }
    if (typeof obj.pattern === "string") {
      return { cmd: `${toolName} "${obj.pattern}"` };
    }
    if (typeof obj.query === "string") {
      return { cmd: `${toolName} "${obj.query}"` };
    }
    if (typeof obj.url === "string") {
      return { cmd: `${toolName} ${obj.url}` };
    }
    const keys = Object.keys(obj);
    if (keys.length === 0) return { cmd: toolName };
    const compact = keys
      .slice(0, 3)
      .map((k) => {
        const v = obj[k];
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return `${k}=${s.length > 48 ? `${s.slice(0, 48)}…` : s}`;
      })
      .join(" ");
    return { cmd: `${toolName} ${compact}`, detail: rawInput };
  } catch {
    return { cmd: `${toolName} ${rawInput.slice(0, 100)}` };
  }
}

export function AgentToolTerminal({
  entries,
  running = false,
  compact = false,
}: {
  entries: ToolTerminalEntry[];
  running?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const calls = entries.filter((e) => e.entryType === "call");
  const stepCount = calls.length || entries.length;
  const uniqueNames = Array.from(new Set(calls.map((c) => c.toolName || "tool")));
  const latestName = calls[calls.length - 1]?.toolName ?? "tool";

  const summaryText = running
    ? `正在执行工具 (${stepCount}) · ${latestName}`
    : `已完成 ${stepCount} 步工具调用${
        uniqueNames.length > 0 ? ` · ${uniqueNames.slice(0, 3).join(", ")}${uniqueNames.length > 3 ? " …" : ""}` : ""
      }`;

  const handleCopyLog = async () => {
    const lines = entries.map((e) => {
      if (e.entryType === "call") {
        const { cmd } = formatToolCommand(e.toolName || "tool", e.toolInput || "");
        return `$ ${cmd}`;
      }
      return e.output || "";
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };

  return (
    <div
      data-testid="agent-tool-terminal"
      className="rounded-lg border border-border/80 bg-muted/25 overflow-hidden transition-colors"
    >
      {/* Collapsed / Toggle Header Bar */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 text-left transition-colors hover:bg-muted/50 cursor-pointer ${
          compact ? "px-2.5 py-1.5" : "px-3 py-2"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              running ? "bg-primary animate-pulse" : "bg-up"
            }`}
          />
          <Terminal size={12} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-[11px] font-medium text-muted-foreground">
            {summaryText}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <span>{open ? "收起终端" : "查看终端"}</span>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </button>

      {/* Embedded macOS-style Terminal Viewport (Only rendered when expanded) */}
      {open && (
        <div
          data-testid="agent-terminal-body"
          className="border-t border-border/80 bg-[#0d1015] text-[#d7dee9]"
        >
          <div className="flex items-center justify-between border-b border-white/10 bg-[#141922] px-3 py-1.5">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#ff5f56]/85" />
                <span className="h-2 w-2 rounded-full bg-[#ffbd2e]/85" />
                <span className="h-2 w-2 rounded-full bg-[#27c93f]/85" />
              </span>
              <span className="font-mono text-[10px] text-white/55">
                agent-tools — zsh ({stepCount})
              </span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleCopyLog();
              }}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] text-white/60 hover:bg-white/10 hover:text-white cursor-pointer"
            >
              {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
              {copied ? "已复制" : "复制"}
            </button>
          </div>

          <div
            className={`overflow-y-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed space-y-1.5 ${
              compact ? "max-h-52" : "max-h-64"
            }`}
          >
            {entries.map((entry, idx) => {
              if (entry.entryType === "call") {
                const { cmd } = formatToolCommand(entry.toolName || "tool", entry.toolInput || "");
                return (
                  <div key={entry.id} className="flex items-start gap-1.5 break-all">
                    <span className="select-none text-emerald-400/90 shrink-0">$</span>
                    <span className="text-white/95">{cmd}</span>
                  </div>
                );
              }
              return (
                <pre
                  key={`${entry.id}-${idx}`}
                  className={`whitespace-pre-wrap break-words border-l border-white/15 pl-2.5 text-[10.5px] leading-snug ${
                    entry.isError ? "text-rose-300" : "text-slate-400"
                  }`}
                >
                  {entry.output}
                </pre>
              );
            })}
            {running && (
              <div className="flex items-center gap-1.5 text-emerald-400/80">
                <span>$</span>
                <span className="inline-block h-3 w-1.5 bg-emerald-400/80 animate-pulse" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

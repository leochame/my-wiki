import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Bot,
  ChevronDown,
  Flame,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { StarBorder } from "@/components/reactbits/StarBorder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Workspace } from "./useWorkspace";
import * as api from "./api";
import { displayTime, errorMessage } from "./format";
import { cn } from "@/lib/utils";
import type { AgentStatus, LongbridgeAgentInfo, SymbolIntel } from "./types";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  elapsed?: number;
  further?: string[];
  refs?: Array<{ title?: string; url?: string }>;
  error?: boolean;
}

function fmtBigNumber(raw?: string) {
  if (!raw) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  return `${sign}${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-foreground/90">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;
        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={i} className="pt-1 text-xs font-semibold text-foreground">
              {renderInline(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith("## ") || trimmed.startsWith("# ")) {
          return (
            <h3 key={i} className="pt-1.5 text-[13px] font-semibold text-foreground">
              {renderInline(trimmed.replace(/^#+\s+/, ""))}
            </h3>
          );
        }
        if (/^[-*•]\s+/.test(trimmed)) {
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span className="text-muted-foreground">•</span>
              <span className="flex-1">{renderInline(trimmed.replace(/^[-*•]\s+/, ""))}</span>
            </div>
          );
        }
        if (/^\d+\.\s+/.test(trimmed)) {
          const [, num, rest] = trimmed.match(/^(\d+\.)\s+(.*)$/) ?? [];
          return (
            <div key={i} className="flex gap-1.5 pl-1">
              <span className="text-muted-foreground font-medium">{num}</span>
              <span className="flex-1">{renderInline(rest ?? trimmed)}</span>
            </div>
          );
        }
        return <p key={i}>{renderInline(trimmed)}</p>;
      })}
    </div>
  );
}

export function AgentHub({
  workspace: w,
  agentStatus,
  pendingPrompt,
  onConsumedPrompt,
  onRefreshStatus,
  onOpenConnections,
}: {
  workspace: Workspace;
  agentStatus: AgentStatus | null;
  pendingPrompt?: { text: string; key: number } | null;
  onConsumedPrompt?: () => void;
  onRefreshStatus: () => void;
  onOpenConnections: () => void;
}) {
  const [agents, setAgents] = useState<LongbridgeAgentInfo[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [agentUid, setAgentUid] = useState("chatbot");
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [agentSearch, setAgentSearch] = useState("");

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatUid, setChatUid] = useState<string | undefined>(undefined);
  const [parentMsgId, setParentMsgId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const [intel, setIntel] = useState<SymbolIntel | null>(null);
  const [loadingIntel, setLoadingIntel] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastConsumedKey = useRef<number>(0);

  const symbol = w.symbol || w.watchlist[0] || "";
  const snap = symbol ? w.snapshots[symbol] : undefined;

  useEffect(() => {
    if (!agentStatus?.authenticated) return;
    setLoadingAgents(true);
    void api
      .listAgents()
      .then((res) => {
        setAgents(res.agents);
        if (res.agents.length > 0 && !res.agents.some((a) => a.uid === agentUid)) {
          setAgentUid(res.agents[0].uid);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingAgents(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentStatus?.authenticated]);

  const loadIntel = () => {
    if (!agentStatus?.authenticated || !symbol) return;
    setLoadingIntel(true);
    void api
      .getSymbolIntel(symbol)
      .then(setIntel)
      .catch(() => setIntel(null))
      .finally(() => setLoadingIntel(false));
  };

  useEffect(() => {
    loadIntel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, agentStatus?.authenticated]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const currentAgent = useMemo(
    () => agents.find((a) => a.uid === agentUid) ?? null,
    [agents, agentUid],
  );

  const topAgents = useMemo(() => agents.slice(0, 5), [agents]);

  const resetChat = (nextUid?: string) => {
    if (nextUid) setAgentUid(nextUid);
    setMessages([]);
    setChatUid(undefined);
    setParentMsgId(undefined);
  };

  const sendPrompt = async (promptText: string) => {
    const q = promptText.trim();
    if (!q || sending || !agentStatus?.authenticated) return;
    setInput("");
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: q }]);
    setSending(true);
    try {
      const res = await api.chatWithAgent({
        agent_uid: agentUid,
        query: q,
        chat_uid: chatUid,
        parent_message_id: parentMsgId,
      });
      if (res.chat_uid) setChatUid(res.chat_uid);
      if (res.message_id) setParentMsgId(res.message_id);
      setMessages((prev) => [
        ...prev,
        {
          id: res.message_id ?? `a-${Date.now()}`,
          role: "assistant",
          content: res.answer || "（未返回正文）",
          elapsed: res.elapsed_time,
          further: res.further_questions,
          refs: res.references,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: errorMessage(e),
          error: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (
      pendingPrompt &&
      pendingPrompt.key !== lastConsumedKey.current &&
      agentStatus?.authenticated &&
      !sending
    ) {
      lastConsumedKey.current = pendingPrompt.key;
      onConsumedPrompt?.();
      void sendPrompt(pendingPrompt.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, agentStatus?.authenticated]);

  const capitalRows = useMemo(() => {
    const c = intel?.capital;
    if (!c?.capital_in || !c?.capital_out) return [];
    return [
      { label: "大单", inV: Number(c.capital_in.large ?? 0), outV: Number(c.capital_out.large ?? 0) },
      { label: "中单", inV: Number(c.capital_in.medium ?? 0), outV: Number(c.capital_out.medium ?? 0) },
      { label: "小单", inV: Number(c.capital_in.small ?? 0), outV: Number(c.capital_out.small ?? 0) },
    ];
  }, [intel?.capital]);

  if (agentStatus && !agentStatus.authenticated) {
    return (
      <Card className="max-w-xl mx-auto p-6 text-center space-y-3 rb-enter">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-warn-soft text-warn mx-auto">
          <Sparkles size={18} />
        </div>
        <div className="text-sm font-semibold">长桥 Agent 尚未登录</div>
        <div className="text-xs text-muted-foreground">
          在「连接」页面粘贴长桥 Auth Code 完成 OAuth 授权后即可使用长桥 Agent 对话与个股投研数据。
        </div>
        <div className="flex items-center justify-center gap-2 pt-1">
          <Button size="sm" onClick={onOpenConnections}>
            前往连接授权
          </Button>
          <Button variant="outline" size="sm" onClick={onRefreshStatus}>
            重新检测
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_370px] gap-px bg-border border-b border-border items-stretch rb-enter">
      {/* Left: LongbridgeAI Chat Studio */}
      <SpotlightCard className="flex flex-col min-h-[640px] max-h-[calc(100vh-88px)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 px-3.5 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="up">
              <Sparkles size={11} /> {currentAgent?.name ?? (loadingAgents ? "加载中…" : agentUid)}
            </Badge>
            <div className="hidden sm:flex items-center gap-1 overflow-x-auto">
              {topAgents.map((a) => (
                <button
                  key={a.uid}
                  onClick={() => resetChat(a.uid)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] whitespace-nowrap transition-colors cursor-pointer",
                    agentUid === a.uid
                      ? "bg-accent text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {agents.length > 0 && (
              <Popover open={agentPickerOpen} onOpenChange={setAgentPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="xs">
                    全部 Agent ({agents.length}) <ChevronDown size={11} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2 space-y-2">
                  <Input
                    placeholder="搜索长桥 Agent…"
                    value={agentSearch}
                    onChange={(e) => setAgentSearch(e.target.value)}
                    className="h-7"
                  />
                  <div className="max-h-64 overflow-y-auto space-y-0.5">
                    {agents
                      .filter((a) =>
                        `${a.name} ${a.description}`
                          .toLowerCase()
                          .includes(agentSearch.trim().toLowerCase()),
                      )
                      .slice(0, 40)
                      .map((a) => (
                        <button
                          key={a.uid}
                          onClick={() => {
                            resetChat(a.uid);
                            setAgentPickerOpen(false);
                          }}
                          className={cn(
                            "w-full rounded-md px-2 py-1.5 text-left hover:bg-accent cursor-pointer",
                            agentUid === a.uid && "bg-accent/80",
                          )}
                        >
                          <div className="text-xs font-medium truncate">{a.name}</div>
                          <div className="text-[10px] text-muted-foreground line-clamp-1">
                            {a.description}
                          </div>
                        </button>
                      ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            <Button variant="ghost" size="xs" onClick={() => resetChat()} disabled={!messages.length}>
              <RotateCcw size={11} /> 新对话
            </Button>
          </div>
        </div>

        {/* Symbol Context Selector */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/25 px-3.5 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <select
              aria-label="切换右侧情报标的"
              value={symbol}
              onChange={(e) => w.setSymbol(e.target.value)}
              className="h-6 rounded border border-input bg-background px-2 text-[11px] font-semibold outline-none cursor-pointer"
            >
              {w.watchlist.map((sym) => (
                <option key={sym} value={sym}>
                  {sym} {w.snapshots[sym]?.name_cn ?? ""}
                </option>
              ))}
            </select>
            {snap?.name_en && (
              <span className="text-[11px] text-muted-foreground truncate">{snap.name_en}</span>
            )}
          </div>
          {currentAgent?.mode && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {currentAgent.uid} · {currentAgent.mode}
            </span>
          )}
        </div>

        {/* Message Stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 ? (
            <div className="flex h-full min-h-[340px] flex-col items-center justify-center gap-3 text-center">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted/50 text-primary">
                <Bot size={20} />
              </div>
              <div className="space-y-1 max-w-md">
                <div className="text-sm font-semibold">
                  {currentAgent?.name ?? (loadingAgents ? "正在读取长桥 Agent 列表…" : agentUid)}
                </div>
                {currentAgent?.description && (
                  <div className="text-xs text-muted-foreground leading-relaxed">
                    {currentAgent.description}
                  </div>
                )}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex flex-col gap-1.5",
                  msg.role === "user" ? "items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[90%] rounded-xl px-3.5 py-2.5",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground text-xs"
                      : msg.error
                        ? "border border-down/30 bg-down-soft text-down text-xs"
                        : "border border-border bg-background/70 w-full",
                  )}
                >
                  {msg.role === "user" ? (
                    <span>{msg.content}</span>
                  ) : (
                    <>
                      <SimpleMarkdown text={msg.content} />
                      {msg.refs && msg.refs.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
                          {msg.refs.slice(0, 6).map((ref, idx) =>
                            ref.url ? (
                              <a
                                key={idx}
                                href={ref.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                              >
                                {ref.title || ref.url} <ArrowUpRight size={10} />
                              </a>
                            ) : null,
                          )}
                        </div>
                      )}
                      {msg.elapsed != null && (
                        <div className="mt-1.5 text-[10px] text-muted-foreground">
                          耗时 {msg.elapsed.toFixed(1)}s
                        </div>
                      )}
                    </>
                  )}
                </div>

                {msg.further && msg.further.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pl-1">
                    {msg.further.slice(0, 3).map((q) => (
                      <button
                        key={q}
                        disabled={sending}
                        onClick={() => void sendPrompt(q)}
                        className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground cursor-pointer"
                      >
                        ↳ {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}

          {sending && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/35 px-3.5 py-2.5 text-xs text-muted-foreground w-fit">
              <Loader2 size={13} className="animate-spin text-primary" />
              <span>{currentAgent?.name ?? "LongbridgeAI"} 正在调取长桥实时数据…</span>
            </div>
          )}
        </div>

        {/* Input Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendPrompt(input);
          }}
          className="flex items-center gap-2 border-t border-border/80 bg-muted/20 p-2.5"
        >
          <Input
            placeholder={`向 ${currentAgent?.name ?? "LongbridgeAI"} 提问…`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            className="h-9"
          />
          <StarBorder active={!!input.trim() && !sending} color="var(--up)">
            <Button type="submit" size="lg" disabled={sending || !input.trim()}>
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              发送
            </Button>
          </StarBorder>
        </form>
      </SpotlightCard>

      {/* Right: Real-time Longbridge Agent Intel Rail */}
      <div className="space-y-3">
        {/* Market Temperature */}
        <Card>
          <CardHeader>
            <CardTitle>
              <Flame size={13} className="text-warn" />
              长桥市场温度 · {intel?.market_temp?.market ?? (symbol.endsWith(".HK") ? "HK" : "US")}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={loadIntel} disabled={loadingIntel}>
              <RefreshCw size={12} className={loadingIntel ? "animate-spin" : ""} />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {intel?.market_temp ? (
              <>
                <div className="flex items-baseline justify-between">
                  <div className="flex items-baseline gap-1.5">
                    <b className="text-2xl font-semibold">{intel.market_temp.temperature ?? "—"}</b>
                    <span className="text-[11px] text-muted-foreground">/ 100</span>
                  </div>
                  <Badge variant="default">{intel.market_temp.description ?? "—"}</Badge>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, Math.max(0, intel.market_temp.temperature ?? 0))}%`,
                      background:
                        (intel.market_temp.temperature ?? 50) >= 65
                          ? "var(--up)"
                          : (intel.market_temp.temperature ?? 50) <= 35
                            ? "var(--down)"
                            : "var(--warn)",
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>估值 {intel.market_temp.valuation ?? "—"}</span>
                  <span>情绪 {intel.market_temp.sentiment ?? "—"}</span>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground py-2">
                {loadingIntel ? "读取中…" : "暂无温度数据"}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Valuation & Intraday Capital Flow */}
        {(intel?.calc || capitalRows.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle>{symbol} · 估值与资金</CardTitle>
              {intel?.calc?.mktcap && <Badge>{fmtBigNumber(intel.calc.mktcap)}</Badge>}
            </CardHeader>
            <CardContent className="space-y-3">
              {intel?.calc && (
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <div className="text-[10px] text-muted-foreground">PE</div>
                    <b>{intel.calc.pe ? Number(intel.calc.pe).toFixed(1) : "—"}</b>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">PB</div>
                    <b>{intel.calc.pb ? Number(intel.calc.pb).toFixed(1) : "—"}</b>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">股息率</div>
                    <b>{intel.calc.dps_rate ? `${intel.calc.dps_rate}%` : "—"}</b>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">换手率</div>
                    <b>{intel.calc.turnover_rate ? `${intel.calc.turnover_rate}%` : "—"}</b>
                  </div>
                </div>
              )}

              {capitalRows.length > 0 && (
                <div className="space-y-1.5 border-t border-border/70 pt-2.5">
                  <div className="text-[10px] text-muted-foreground">盘中资金净流向</div>
                  {capitalRows.map((row) => {
                    const net = row.inV - row.outV;
                    const total = Math.max(row.inV + row.outV, 1);
                    const inPct = (row.inV / total) * 100;
                    return (
                      <div key={row.label} className="space-y-0.5 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{row.label}</span>
                          <b className={net >= 0 ? "text-up" : "text-down"}>
                            {net >= 0 ? "+" : ""}
                            {fmtBigNumber(String(net))}
                          </b>
                        </div>
                        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-down/35">
                          <div className="h-full bg-up" style={{ width: `${inPct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Latest Quarterly Financial KPIs */}
        {intel?.report?.indicators && intel.report.indicators.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>最新财报 KPI</CardTitle>
              <Badge variant="outline">{intel.report.report_txt ?? "Latest"}</Badge>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2.5">
              {intel.report.indicators.slice(0, 4).map((ind) => {
                const yoy = ind.yoy != null ? Number(ind.yoy) * 100 : null;
                return (
                  <div key={ind.field_name ?? ind.indicator_name} className="space-y-0.5">
                    <div className="text-[10px] text-muted-foreground">{ind.indicator_name}</div>
                    <div className="flex items-baseline gap-1.5">
                      <b className="text-xs font-semibold">{fmtBigNumber(ind.indicator_value)}</b>
                      {yoy !== null && Number.isFinite(yoy) && (
                        <span className={cn("text-[10px]", yoy >= 0 ? "text-up" : "text-down")}>
                          {yoy >= 0 ? "+" : ""}
                          {yoy.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Longbridge Symbol News & SEC Filings */}
        <Card>
          <Tabs defaultValue="news">
            <CardHeader>
              <CardTitle>长桥资讯 · {symbol}</CardTitle>
              <TabsList>
                <TabsTrigger value="news">新闻 ({intel?.news.length ?? 0})</TabsTrigger>
                <TabsTrigger value="filings">公告 ({intel?.filings.length ?? 0})</TabsTrigger>
              </TabsList>
            </CardHeader>

            <TabsContent value="news" className="divide-y divide-border/60 max-h-72 overflow-y-auto">
              {intel?.news.length ? (
                intel.news.map((n, i) => (
                  <div
                    key={n.id ?? i}
                    className="group flex items-start justify-between gap-2 px-3 py-2 hover:bg-muted/40 transition-colors"
                  >
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 block"
                    >
                      <div className="text-xs leading-snug text-foreground/90 line-clamp-2 hover:text-primary">
                        {n.title}
                      </div>
                      {n.published_at && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {displayTime(n.published_at)}
                        </div>
                      )}
                    </a>
                    {n.title && (
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() =>
                          void sendPrompt(`解读这条关于 ${symbol} 的新闻：${n.title}`)
                        }
                        title="发送给长桥 Agent 解读"
                        className="shrink-0 rounded p-1 text-muted-foreground opacity-60 hover:bg-accent hover:text-up group-hover:opacity-100 cursor-pointer"
                      >
                        <Sparkles size={11} />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  {loadingIntel ? "加载长桥新闻…" : "暂无新闻"}
                </div>
              )}
            </TabsContent>

            <TabsContent
              value="filings"
              className="divide-y divide-border/60 max-h-72 overflow-y-auto"
            >
              {intel?.filings.length ? (
                intel.filings.map((f, i) => (
                  <a
                    key={f.id ?? i}
                    href={f.file_urls?.[0] ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="block px-3 py-2 hover:bg-muted/40 transition-colors"
                  >
                    <div className="text-xs leading-snug text-foreground/90 line-clamp-2">
                      {f.file_name || f.title}
                    </div>
                    {f.publish_at && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {displayTime(f.publish_at)}
                      </div>
                    )}
                  </a>
                ))
              ) : (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  {loadingIntel ? "加载公告…" : "暂无 SEC 公告"}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

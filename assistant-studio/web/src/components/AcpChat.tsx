import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  Bot,
  Lock,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import {
  acpWsUrl,
  createAcpSession,
  deleteAcpSession,
  listAcpEvents,
  listAcpProviders,
  listAcpSessions,
  revertAcpSession,
} from "@/lib/api";
import { displayTime, errorMessage } from "@/lib/format";
import type {
  AcpEventRecord,
  AcpProviderInfo,
  AcpSessionRecord,
  VaultFileRecord,
} from "@/types";
import {
  AgentToolTerminal,
  groupChatTimeline,
  type ChatTimelineItem,
  type ToolTerminalEntry,
} from "@/components/AgentToolTerminal";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { MarkdownView } from "@/components/MarkdownView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ReaderTarget } from "./ReaderDrawer";

interface AcpChatProps {
  vaultFiles: VaultFileRecord[];
  initialDraft?: { prompt?: string; contextPaths?: string[] } | null;
  onConsumeInitialDraft: () => void;
  onOpenWiki: (path: string) => void;
  onOpenReader: (target: ReaderTarget) => void;
  onNotify: (msg: string, tone?: "ok" | "err") => void;
}

function parseEventRecord(ev: AcpEventRecord): ChatTimelineItem {
  try {
    const p = JSON.parse(ev.payload_json) as Record<string, unknown>;
    if (ev.kind === "tool_call") {
      return {
        id: `ev-${ev.id}`,
        kind: "tool_call",
        toolName: String(p.name ?? "tool"),
        toolInput: typeof p.input === "string" ? p.input : JSON.stringify(p.input ?? {}, null, 2),
        text: "",
        createdAt: ev.created_at,
      };
    }
    if (ev.kind === "tool_result") {
      return {
        id: `ev-${ev.id}`,
        kind: "tool_result",
        output: String(p.output ?? p.content ?? ""),
        isError: Boolean(p.is_error),
        text: "",
        createdAt: ev.created_at,
      };
    }
    return {
      id: `ev-${ev.id}`,
      eventId: ev.id,
      kind: (ev.kind as ChatTimelineItem["kind"]) || "assistant",
      text: String(p.text ?? p.message ?? ""),
      contextFiles: Array.isArray(p.context_files)
        ? (p.context_files as string[])
        : Array.isArray(p.context_paths)
          ? (p.context_paths as string[])
          : undefined,
      createdAt: ev.created_at,
    };
  } catch {
    return {
      id: `ev-${ev.id}`,
      eventId: ev.id,
      kind: "assistant",
      text: ev.payload_json,
      createdAt: ev.created_at,
    };
  }
}

export function AcpChat({
  vaultFiles,
  initialDraft,
  onConsumeInitialDraft,
  onOpenWiki,
  onOpenReader,
  onNotify,
}: AcpChatProps) {
  const [providers, setProviders] = useState<AcpProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("claude");
  const [sessions, setSessions] = useState<AcpSessionRecord[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatTimelineItem[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [streamingTools, setStreamingTools] = useState<ToolTerminalEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [contextPaths, setContextPaths] = useState<string[]>([]);
  const [allowWrite, setAllowWrite] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [fileQuery, setFileQuery] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  const loadSessions = async () => {
    const [pList, sList] = await Promise.all([listAcpProviders(), listAcpSessions()]);
    setProviders(pList);
    setSessions(sList);
    const firstAvail = pList.find((p) => p.available)?.id ?? "claude";
    setSelectedProvider((cur) => (pList.some((p) => p.id === cur) ? cur : firstAvail));
    setActiveSessionId((cur) => cur ?? sList[0]?.session_id ?? null);
  };

  useEffect(() => {
    loadSessions().catch((e) => onNotify(errorMessage(e), "err"));
  }, []);

  // Consume cross-page draft (from WikiStudio / ReaderDrawer / FeedCenter)
  useEffect(() => {
    if (!initialDraft) return;
    if (initialDraft.prompt) setPrompt(initialDraft.prompt);
    if (initialDraft.contextPaths?.length) {
      setContextPaths((prev) => Array.from(new Set([...prev, ...initialDraft.contextPaths!])));
    }
    onConsumeInitialDraft();
  }, [initialDraft, onConsumeInitialDraft]);

  // Load events when switching sessions
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    listAcpEvents(activeSessionId)
      .then((evs) => setMessages(evs.map(parseEventRecord)))
      .catch((e) => onNotify(errorMessage(e), "err"));
  }, [activeSessionId]);

  // Auto-scroll chat feed
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingText, streamingTools.length]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const handleNewSession = async (providerId?: string) => {
    const prov = providerId ?? selectedProvider;
    try {
      const created = await createAcpSession(prov, "");
      setSessions((prev) => [created, ...prev]);
      setActiveSessionId(created.session_id);
      setMessages([]);
      setStreamingText("");
      setStreamingTools([]);
      onNotify(`已新建 ${prov} 会话（持久化于 SQLite）`);
      return created;
    } catch (e) {
      onNotify(errorMessage(e), "err");
      return null;
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteAcpSession(id);
      setSessions((prev) => {
        const next = prev.filter((s) => s.session_id !== id);
        if (activeSessionId === id) {
          setActiveSessionId(next[0]?.session_id ?? null);
        }
        return next;
      });
    } catch (e) {
      onNotify(errorMessage(e), "err");
    }
  };

  const handleRevert = async (item: ChatTimelineItem) => {
    if (!activeSessionId || !item.eventId || busy) return;
    try {
      const res = await revertAcpSession(activeSessionId, item.eventId);
      setMessages(res.events.map(parseEventRecord));
      setPrompt(item.text);
      void listAcpSessions().then(setSessions);
      onNotify("已回退到此消息，可直接编辑后重发");
    } catch (e) {
      onNotify(errorMessage(e), "err");
    }
  };

  const handleSend = async (overridePrompt?: string, overridePaths?: string[]) => {
    const textToSend = (overridePrompt ?? prompt).trim();
    if (!textToSend || busy) return;
    const attached = overridePaths ?? contextPaths;

    let sessionId = activeSessionId;
    if (!sessionId) {
      const created = await handleNewSession(selectedProvider);
      if (!created) return;
      sessionId = created.session_id;
    }

    setBusy(true);
    setPrompt("");
    setStreamingText("");
    setStreamingTools([]);

    const optimisticUser: ChatTimelineItem = {
      id: `local-${Date.now()}`,
      kind: "user",
      text: textToSend,
      contextFiles: attached,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      wsRef.current?.close();
      const ws = new WebSocket(acpWsUrl(sessionId));
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            prompt: textToSend,
            context_files: attached,
            allow_writes: allowWrite,
          }),
        );
      };

      ws.onmessage = (evt) => {
        try {
          const frame = JSON.parse(evt.data as string) as {
            kind?: string;
            data?: Record<string, unknown>;
          };
          const kind = String(frame.kind ?? "");
          const data = frame.data ?? {};
          if (kind === "delta") {
            const chunk = String(data.text ?? "");
            if (data.replace) {
              setStreamingText(chunk);
            } else {
              setStreamingText((prev) => prev + chunk);
            }
          } else if (kind === "tool" || kind === "tool_call") {
            setStreamingTools((prev) => [
              ...prev,
              {
                id: `tool-${Date.now()}-${prev.length}`,
                entryType: "call",
                toolName: String(data.name ?? "tool"),
                toolInput: JSON.stringify(data.input ?? {}, null, 2),
              },
            ]);
          } else if (kind === "tool_result") {
            setStreamingTools((prev) => [
              ...prev,
              {
                id: `tres-${Date.now()}-${prev.length}`,
                entryType: "result",
                output: String(data.output ?? data.content ?? ""),
                isError: Boolean(data.is_error),
              },
            ]);
          } else if (kind === "error") {
            const msg = String(data.message ?? "执行出错");
            setMessages((prev) => [
              ...prev,
              { id: `err-${Date.now()}`, kind: "error", text: msg },
            ]);
            setBusy(false);
            ws.close();
          } else if (kind === "done") {
            setStreamingText("");
            setStreamingTools([]);
            setBusy(false);
            ws.close();
            // Reload persisted events & updated session title from SQLite
            void listAcpEvents(sessionId!).then((evs) => setMessages(evs.map(parseEventRecord)));
            void listAcpSessions().then(setSessions);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        setBusy(false);
        onNotify("WebSocket 连接中断，请确认后端服务正在运行", "err");
      };
    } catch (e) {
      setBusy(false);
      onNotify(errorMessage(e), "err");
    }
  };

  const activeSession = sessions.find((s) => s.session_id === activeSessionId) ?? null;

  const filteredVaultFiles = vaultFiles
    .filter((f) => {
      const q = fileQuery.trim().toLowerCase();
      if (!q) return true;
      return f.path.toLowerCase().includes(q) || f.title.toLowerCase().includes(q);
    })
    .slice(0, 30);

  return (
    <div className="grid h-full min-h-0 gap-px bg-border lg:grid-cols-12">
      {/* Left: Providers + SQLite Sessions */}
      <aside className="flex min-h-0 flex-col bg-card lg:col-span-3">
        <div className="shrink-0 border-b border-border p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              <Bot size={13} className="text-primary" /> ACP / CLI 引擎
            </span>
            <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => void handleNewSession()}>
              <Plus size={11} /> 新对话
            </Button>
          </div>

          <div className="space-y-1">
            {providers.map((p) => {
              const selected = selectedProvider === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedProvider(p.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                    selected
                      ? "border-primary/60 bg-accent/60"
                      : "border-border/60 bg-background/40 hover:bg-muted/40"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.label}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{p.detail}</div>
                  </div>
                  <Badge variant={p.available ? "up" : "outline"} className="text-[9px] py-0 shrink-0">
                    {p.available ? "就绪" : "未装"}
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          历史会话（SQLite）
        </div>
        <div
          data-testid="acp-sessions-scroll"
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 space-y-1"
        >
          {sessions.length === 0 ? (
            <div className="py-8 text-center text-[11px] text-muted-foreground">
              暂无会话，点击上方「新对话」或直接发送消息开始
            </div>
          ) : (
            sessions.map((s) => {
              const active = s.session_id === activeSessionId;
              return (
                <div
                  key={s.session_id}
                  className={`group flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-xs ${
                    active ? "bg-accent text-foreground font-medium" : "hover:bg-muted/40"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveSessionId(s.session_id)}
                    className="min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <div className="truncate">{s.title || "新对话"}</div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{s.provider}</span>
                      <span>· {displayTime(s.updated_at)}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSession(s.session_id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-down cursor-pointer"
                    title="删除会话"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Right: Chat workspace */}
      <SpotlightCard className="flex min-h-0 flex-col overflow-hidden lg:col-span-9">
        {/* Session top bar */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-xs font-semibold">
              {activeSession ? activeSession.title : "个人知识库 AI 助理"}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {activeSession?.provider ?? selectedProvider}
            </Badge>
            {activeSession?.external_session_id && (
              <Badge variant="up" className="text-[10px]">
                多轮 resume 已绑定
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={busy}
              onClick={() =>
                void handleSend(
                  "请阅读 task/today.md，用 3-5 条重点总结今天的优先事项与风险提醒。",
                  ["task/today.md"],
                )
              }
            >
              <Sparkles size={11} /> 总结 Today
            </Button>
            <Button
              size="sm"
              variant={allowWrite ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              onClick={() => setAllowWrite((v) => !v)}
              title="默认只读规划模式，开启后允许 Claude/ACP 修改 Vault 文档"
            >
              {allowWrite ? <Unlock size={11} /> : <Lock size={11} />}
              {allowWrite ? "允许写入 Vault" : "只读规划模式"}
            </Button>
          </div>
        </div>

        {/* Scrollable chat feed */}
        <div
          data-testid="acp-chat-scroll"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-3"
        >
          {messages.length === 0 && !streamingText && (
            <div className="mx-auto max-w-lg py-14 text-center space-y-2.5">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary">
                <Bot size={20} />
              </div>
              <div className="text-sm font-semibold">MyWiki 个人助理（Claude Code / ACP）</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                直接运行在你本地的 `my-wiki` 根目录。可使用下方 `@ 引用文档` 把任意 Markdown 笔记作为上下文发给助理，所有对话和工具调用记录均自动持久化到 SQLite。
              </p>
            </div>
          )}

          {groupChatTimeline(messages).map((block) =>
            block.groupKind === "tools" ? (
              <AgentToolTerminal key={block.id} entries={block.entries} />
            ) : (
              <ChatBubble
                key={block.item.id}
                item={block.item}
                canRevert={!busy && block.item.kind === "user" && Boolean(block.item.eventId)}
                onRevert={() => void handleRevert(block.item)}
                onOpenWiki={onOpenWiki}
                onOpenReader={onOpenReader}
              />
            ),
          )}

          {streamingTools.length > 0 && (
            <AgentToolTerminal entries={streamingTools} running={busy} />
          )}

          {(streamingText || busy) && (
            <div className="rounded-xl border border-primary/30 bg-card/80 p-3.5 text-xs space-y-2">
              <div className="flex items-center gap-2 text-[11px] font-medium text-primary">
                <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                正在实时流式响应...
              </div>
              {streamingText && (
                <MarkdownView
                  text={streamingText}
                  onOpenWikilink={(t) => onOpenWiki(t)}
                  onOpenUrl={(url, title) => onOpenReader({ url, title })}
                />
              )}
            </div>
          )}
          <div ref={scrollEndRef} />
        </div>

        {/* Pinned composer */}
        <div className="shrink-0 border-t border-border bg-card/80 p-3 space-y-2">
          {contextPaths.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {contextPaths.map((p) => (
                <Badge key={p} variant="default" className="gap-1 text-[10px]">
                  <span>@{p}</span>
                  <button
                    type="button"
                    onClick={() => setContextPaths((prev) => prev.filter((x) => x !== p))}
                    className="hover:text-down cursor-pointer"
                  >
                    <X size={10} />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <Popover open={filePickerOpen} onOpenChange={setFilePickerOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-9 shrink-0 px-2.5 text-xs">
                  <AtSign size={13} /> 引用文档
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-2 space-y-2">
                <Input
                  value={fileQuery}
                  onChange={(e) => setFileQuery(e.target.value)}
                  placeholder="搜索 Vault 文档路径..."
                  className="h-7 text-xs"
                />
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {filteredVaultFiles.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => {
                        setContextPaths((prev) =>
                          prev.includes(f.path) ? prev : [...prev, f.path],
                        );
                        setFilePickerOpen(false);
                      }}
                      className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent cursor-pointer"
                    >
                      <div className="truncate font-medium">{f.title}</div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {f.path}
                      </div>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="输入任务安排、文档写作指令或问题（Enter 发送，Shift+Enter 换行）..."
              className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button
              className="h-9 px-3.5 shrink-0"
              disabled={busy || !prompt.trim()}
              onClick={() => void handleSend()}
            >
              <Send size={13} /> 发送
            </Button>
          </div>
        </div>
      </SpotlightCard>
    </div>
  );
}

function ChatBubble({
  item,
  canRevert,
  onRevert,
  onOpenWiki,
  onOpenReader,
}: {
  item: ChatTimelineItem;
  canRevert: boolean;
  onRevert: () => void;
  onOpenWiki: (path: string) => void;
  onOpenReader: (target: ReaderTarget) => void;
}) {
  if (item.kind === "error") {
    return (
      <div className="rounded-xl border border-down/40 bg-down-soft p-3 text-xs text-down">
        {item.text}
      </div>
    );
  }

  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-xl bg-primary px-3.5 py-2.5 text-xs text-primary-foreground space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap gap-1 opacity-90">
              {item.contextFiles?.map((p) => (
                <span key={p} className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px]">
                  @{p}
                </span>
              ))}
            </div>
            {canRevert && (
              <button
                type="button"
                onClick={onRevert}
                title="回退到此消息重新编辑"
                className="inline-flex shrink-0 items-center gap-1 rounded bg-black/15 px-1.5 py-0.5 text-[10px] hover:bg-black/25 cursor-pointer"
              >
                <RotateCcw size={10} /> 回退
              </button>
            )}
          </div>
          <div className="whitespace-pre-wrap leading-relaxed">{item.text}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/80 bg-background/80 p-3.5 text-xs">
      <MarkdownView
        text={item.text}
        onOpenWikilink={onOpenWiki}
        onOpenUrl={(url, title) => onOpenReader({ url, title })}
      />
    </div>
  );
}

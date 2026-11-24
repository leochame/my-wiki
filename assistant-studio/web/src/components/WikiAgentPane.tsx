import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  AtSign,
  Bot,
  Check,
  ChevronDown,
  Copy,
  CornerDownLeft,
  ExternalLink,
  FilePlus,
  FileText,
  History,
  MessageSquare,
  Plus,
  Replace,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
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
import { MarkdownView } from "@/components/MarkdownView";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ReaderTarget } from "./ReaderDrawer";

interface WikiAgentPaneProps {
  docPath: string | null;
  docTitle: string | null;
  vaultFiles: VaultFileRecord[];
  dirty: boolean;
  hasSelection: boolean;
  quotedSelection: string;
  onClearQuotedSelection: () => void;
  onSaveDoc: () => Promise<void>;
  onReloadDoc: () => Promise<void>;
  onInsertAtCursor: (snippet: string) => void;
  onReplaceSelection: (snippet: string) => void;
  onAppendToEnd: (snippet: string) => void;
  onOpenWiki: (path: string) => void;
  onOpenReader: (target: ReaderTarget) => void;
  onOpenFullAcp: () => void;
  onNotify: (msg: string, tone?: "ok" | "err") => void;
}

function parseEv(ev: AcpEventRecord): ChatTimelineItem {
  try {
    const p = JSON.parse(ev.payload_json) as Record<string, unknown>;
    if (ev.kind === "tool_call") {
      return {
        id: `ev-${ev.id}`,
        kind: "tool_call",
        toolName: String(p.name ?? "tool"),
        toolInput: typeof p.input === "string" ? p.input : JSON.stringify(p.input ?? {}, null, 2),
        text: "",
      };
    }
    if (ev.kind === "tool_result") {
      return {
        id: `ev-${ev.id}`,
        kind: "tool_result",
        output: String(p.output ?? p.content ?? ""),
        isError: Boolean(p.is_error),
        text: "",
      };
    }
    return {
      id: `ev-${ev.id}`,
      eventId: ev.id,
      kind: (ev.kind as ChatTimelineItem["kind"]) || "assistant",
      text: String(p.text ?? p.message ?? ""),
      contextFiles: Array.isArray(p.context_files) ? (p.context_files as string[]) : undefined,
    };
  } catch {
    return {
      id: `ev-${ev.id}`,
      eventId: ev.id,
      kind: "assistant",
      text: ev.payload_json,
    };
  }
}

export function WikiAgentPane({
  docPath,
  docTitle,
  vaultFiles,
  dirty,
  hasSelection,
  quotedSelection,
  onClearQuotedSelection,
  onSaveDoc,
  onReloadDoc,
  onInsertAtCursor,
  onReplaceSelection,
  onAppendToEnd,
  onOpenWiki,
  onOpenReader,
  onOpenFullAcp,
  onNotify,
}: WikiAgentPaneProps) {
  const [providers, setProviders] = useState<AcpProviderInfo[]>([]);
  const [provider, setProvider] = useState("claude");
  const [sessions, setSessions] = useState<AcpSessionRecord[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatTimelineItem[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [streamingTools, setStreamingTools] = useState<ToolTerminalEntry[]>([]);
  const [busy, setBusy] = useState(false);

  // Cursor-style state: Ask (read-only) vs Agent (can edit files)
  const [mode, setMode] = useState<"ask" | "agent">("ask");
  const [includeCurrentDoc, setIncludeCurrentDoc] = useState(true);
  const [extraFiles, setExtraFiles] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Popovers
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextQuery, setContextQuery] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    Promise.all([listAcpProviders(), listAcpSessions()])
      .then(([pList, sList]) => {
        setProviders(pList);
        setSessions(sList);
        const firstAvail = pList.find((p) => p.available)?.id ?? "claude";
        setProvider((cur) => (pList.some((p) => p.id === cur) ? cur : firstAvail));
        setSessionId((cur) => cur ?? sList[0]?.session_id ?? null);
      })
      .catch((e) => onNotify(errorMessage(e), "err"));
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // Re-enable active doc context whenever user opens a different file
  useEffect(() => {
    if (docPath) setIncludeCurrentDoc(true);
  }, [docPath]);

  // Focus composer when user quotes selection via Cmd+L
  useEffect(() => {
    if (quotedSelection) {
      inputRef.current?.focus();
    }
  }, [quotedSelection]);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    listAcpEvents(sessionId)
      .then((evs) => setMessages(evs.map(parseEv)))
      .catch((e) => onNotify(errorMessage(e), "err"));
  }, [sessionId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingText, streamingTools.length]);

  const activeSession = sessions.find((s) => s.session_id === sessionId) ?? null;

  const attachedFiles = useMemo(() => {
    const list: string[] = [];
    if (includeCurrentDoc && docPath) list.push(docPath);
    for (const f of extraFiles) {
      if (!list.includes(f)) list.push(f);
    }
    return list;
  }, [includeCurrentDoc, docPath, extraFiles]);

  const filteredVault = useMemo(() => {
    const q = contextQuery.trim().toLowerCase();
    return vaultFiles
      .filter((f) => !attachedFiles.includes(f.path))
      .filter((f) => !q || f.path.toLowerCase().includes(q) || f.title.toLowerCase().includes(q))
      .slice(0, 24);
  }, [vaultFiles, attachedFiles, contextQuery]);

  const handleNewSession = async () => {
    try {
      const title = docTitle ? `${docTitle.slice(0, 22)}` : "";
      const created = await createAcpSession(provider, title);
      setSessions((prev) => [created, ...prev]);
      setSessionId(created.session_id);
      setMessages([]);
      setStreamingText("");
      setStreamingTools([]);
      setHistoryOpen(false);
      inputRef.current?.focus();
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
        if (sessionId === id) setSessionId(next[0]?.session_id ?? null);
        return next;
      });
    } catch (e) {
      onNotify(errorMessage(e), "err");
    }
  };

  const handleStop = () => {
    wsRef.current?.close();
    setBusy(false);
    setStreamingText("");
    setStreamingTools([]);
    onNotify("已中止当前流式响应");
  };

  const handleRevertToMessage = async (item: ChatTimelineItem) => {
    if (!sessionId || !item.eventId || busy) return;
    try {
      const res = await revertAcpSession(sessionId, item.eventId);
      setMessages(res.events.map(parseEv));
      setPrompt(item.text);
      void listAcpSessions().then(setSessions);
      inputRef.current?.focus();
      onNotify("已回退到此消息，可直接修改后重新发送");
    } catch (e) {
      onNotify(errorMessage(e), "err");
    }
  };

  const handleSend = async (overrideText?: string) => {
    const rawText = (overrideText ?? prompt).trim();
    if (!rawText || busy) return;

    const finalPrompt = quotedSelection
      ? `以下是我在当前文档中选中的段落：\n\`\`\`\n${quotedSelection}\n\`\`\`\n\n${rawText}`
      : rawText;

    let sid = sessionId;
    if (!sid) {
      const created = await handleNewSession();
      if (!created) return;
      sid = created.session_id;
    }

    const allowWrites = mode === "agent";
    const ctx = [...attachedFiles];

    setBusy(true);
    setPrompt("");
    if (quotedSelection) onClearQuotedSelection();
    setStreamingText("");
    setStreamingTools([]);
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, kind: "user", text: finalPrompt, contextFiles: ctx },
    ]);

    try {
      wsRef.current?.close();
      const ws = new WebSocket(acpWsUrl(sid));
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            prompt: finalPrompt,
            context_files: ctx,
            allow_writes: allowWrites,
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
            setStreamingText((prev) => (data.replace ? chunk : prev + chunk));
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
            setMessages((prev) => [
              ...prev,
              {
                id: `err-${Date.now()}`,
                kind: "error",
                text: String(data.message ?? "执行出错"),
              },
            ]);
            setBusy(false);
            ws.close();
          } else if (kind === "done") {
            setStreamingText("");
            setStreamingTools([]);
            setBusy(false);
            ws.close();
            void listAcpEvents(sid!).then((evs) => setMessages(evs.map(parseEv)));
            void listAcpSessions().then(setSessions);
            if (allowWrites && !dirty) {
              void onReloadDoc();
            }
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        setBusy(false);
        onNotify("Agent WebSocket 连接中断", "err");
      };
    } catch (e) {
      setBusy(false);
      onNotify(errorMessage(e), "err");
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      onNotify("复制失败", "err");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Minimal Cursor-style top bar: Session Title + History + New Chat + Popout */}
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-border/70 px-3 py-1.5">
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium text-foreground hover:bg-muted/60 cursor-pointer"
              title="切换历史对话"
            >
              <History size={12} className="shrink-0 text-muted-foreground" />
              <span className="truncate max-w-[230px]">
                {activeSession ? activeSession.title || "未命名对话" : "新写作对话"}
              </span>
              <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-1.5 space-y-1">
            <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>历史会话 ({sessions.length})</span>
              <button
                type="button"
                onClick={() => void handleNewSession()}
                className="text-primary hover:underline cursor-pointer"
              >
                + 新建
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-0.5">
              {sessions.length === 0 ? (
                <div className="py-4 text-center text-[11px] text-muted-foreground">
                  暂无历史对话
                </div>
              ) : (
                sessions.map((s) => (
                  <div
                    key={s.session_id}
                    className={`group flex items-center justify-between gap-1 rounded-md px-2 py-1.5 text-xs ${
                      s.session_id === sessionId ? "bg-accent font-medium" : "hover:bg-muted/50"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSessionId(s.session_id);
                        setHistoryOpen(false);
                      }}
                      className="min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <div className="truncate">{s.title || "新对话"}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {s.provider} · {displayTime(s.updated_at)}
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
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => void handleNewSession()}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            title="新建对话"
            aria-label="新建写作对话"
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            onClick={onOpenFullAcp}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            title="在全屏助理页打开"
          >
            <ExternalLink size={12} />
          </button>
        </div>
      </div>

      {/* Scrollable conversation stream */}
      <div
        data-testid="wiki-agent-scroll"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-3"
      >
        {messages.length === 0 && !streamingText ? (
          <div className="flex h-full flex-col items-center justify-center px-3 text-center space-y-3">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-muted/40 text-primary">
              <Sparkles size={16} />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold">文档写作 Agent</div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                在左侧选中任意段落按 <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">⌘L</kbd> 即可引用提问；Agent 输出可一键插入光标处或替换选中内容。
              </p>
            </div>
            {docPath && (
              <div className="w-full space-y-1.5 pt-1">
                {[
                  { label: "梳理大纲与逻辑漏洞", text: "请阅读当前文档，提炼清晰的章节大纲并指出可以补充或收紧的地方。" },
                  { label: "润色提升可读性", text: "请针对当前文档给出更精炼、有节奏感的润色改写建议，直接输出可替换的 Markdown 段落。" },
                  { label: "顺着风格续写下一节", text: "请顺着这篇文档的语气和上下文，帮我起草下一小节的正文草稿。" },
                ].map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSend(s.text)}
                    className="flex w-full items-center justify-between rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-left text-[11px] text-foreground/90 hover:border-primary/50 hover:bg-accent/40 transition-colors cursor-pointer"
                  >
                    <span>{s.label}</span>
                    <CornerDownLeft size={11} className="text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {groupChatTimeline(messages).map((block) =>
              block.groupKind === "tools" ? (
                <AgentToolTerminal key={block.id} entries={block.entries} compact />
              ) : (
                <CursorBubble
                  key={block.item.id}
                  item={block.item}
                  copied={copiedId === block.item.id}
                  hasSelection={hasSelection}
                  canRevert={!busy && block.item.kind === "user" && Boolean(block.item.eventId)}
                  onRevert={() => void handleRevertToMessage(block.item)}
                  onCopy={() => void handleCopy(block.item.id, block.item.text)}
                  onInsert={() => {
                    onInsertAtCursor(block.item.text);
                    onNotify("已插入到光标位置（按 ⌘S 保存）");
                  }}
                  onReplace={() => {
                    onReplaceSelection(block.item.text);
                    onNotify("已替换选中文本（按 ⌘S 保存）");
                  }}
                  onAppend={() => {
                    onAppendToEnd(block.item.text);
                    onNotify("已追加到文档末尾（按 ⌘S 保存）");
                  }}
                  onOpenWiki={onOpenWiki}
                  onOpenReader={onOpenReader}
                />
              ),
            )}

            {streamingTools.length > 0 && (
              <AgentToolTerminal entries={streamingTools} running={busy} compact />
            )}

            {(streamingText || busy) && (
              <div className="space-y-1.5 rounded-xl border border-primary/30 bg-background/80 p-3 text-xs">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  {mode === "agent" ? "Agent 执行中..." : "思考并生成中..."}
                </div>
                {streamingText && (
                  <MarkdownView
                    text={streamingText}
                    onOpenWikilink={onOpenWiki}
                    onOpenUrl={(url, title) => onOpenReader({ url, title })}
                  />
                )}
              </div>
            )}
          </>
        )}
        <div ref={endRef} />
      </div>

      {/* Cursor-Style Unified Composer Box */}
      <div className="shrink-0 p-2.5 pt-1">
        <div className="rounded-xl border border-border bg-background/95 shadow-sm focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/25 transition-all">
          {/* Context pills row inside composer top */}
          <div className="flex flex-wrap items-center gap-1 px-2.5 pt-2">
            <Popover open={contextOpen} onOpenChange={setContextOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-5 items-center gap-1 rounded-md border border-border/80 bg-muted/40 px-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:border-primary/40 cursor-pointer"
                  title="添加更多 Vault 文档作为上下文"
                >
                  <AtSign size={10} />
                  <span>上下文</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-2 space-y-1.5">
                <Input
                  value={contextQuery}
                  onChange={(e) => setContextQuery(e.target.value)}
                  placeholder="搜索并引用其他文档..."
                  className="h-7 text-xs"
                />
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {filteredVault.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => {
                        setExtraFiles((prev) => [...prev, f.path]);
                        setContextOpen(false);
                        setContextQuery("");
                      }}
                      className="block w-full truncate rounded px-2 py-1 text-left font-mono text-[11px] hover:bg-accent cursor-pointer"
                    >
                      {f.path}
                    </button>
                  ))}
                  {filteredVault.length === 0 && (
                    <div className="py-3 text-center text-[11px] text-muted-foreground">
                      没有更多可添加文档
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {docPath && includeCurrentDoc && (
              <span className="inline-flex h-5 max-w-[170px] items-center gap-1 rounded-md bg-accent/80 px-1.5 text-[10px] font-medium text-foreground">
                <FileText size={10} className="shrink-0 text-primary" />
                <span className="truncate" title={docPath}>
                  {docPath.split("/").pop()}
                </span>
                <button
                  type="button"
                  onClick={() => setIncludeCurrentDoc(false)}
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                  title="移除当前文档上下文"
                >
                  <X size={10} />
                </button>
              </span>
            )}

            {extraFiles.map((f) => (
              <span
                key={f}
                className="inline-flex h-5 max-w-[150px] items-center gap-1 rounded-md bg-muted px-1.5 text-[10px] text-foreground"
              >
                <span className="truncate" title={f}>
                  {f.split("/").pop()}
                </span>
                <button
                  type="button"
                  onClick={() => setExtraFiles((prev) => prev.filter((x) => x !== f))}
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X size={10} />
                </button>
              </span>
            ))}

            {quotedSelection && (
              <span
                className="inline-flex h-5 max-w-[180px] items-center gap-1 rounded-md bg-primary/15 border border-primary/30 px-1.5 text-[10px] font-medium text-primary"
                title={quotedSelection}
              >
                <Sparkles size={10} className="shrink-0" />
                <span className="truncate">已引用选区 ({quotedSelection.length}字)</span>
                <button
                  type="button"
                  onClick={onClearQuotedSelection}
                  className="hover:opacity-75 cursor-pointer"
                >
                  <X size={10} />
                </button>
              </span>
            )}

            {dirty && (
              <button
                type="button"
                onClick={() => void onSaveDoc()}
                className="inline-flex h-5 items-center rounded-md bg-warn-soft px-1.5 text-[10px] font-medium text-warn hover:opacity-85 cursor-pointer"
                title="先保存当前未落盘修改，确保 Agent 读到最新内容"
              >
                同步最新草稿 ⌘S
              </button>
            )}
          </div>

          {/* Prompt textarea */}
          <textarea
            ref={inputRef}
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={
              mode === "agent"
                ? "描述修改要求，Agent 可直接编辑当前文档（Enter 发送）..."
                : "针对当前文档提问、润色或续写（Enter 发送，Shift+Enter 换行）..."
            }
            className="w-full resize-none bg-transparent px-3 py-2 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
          />

          {/* Bottom integrated Cursor control bar: Ask/Agent pill + Engine + Send/Stop */}
          <div className="flex items-center justify-between gap-2 border-t border-border/50 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="inline-flex rounded-md border border-border/80 bg-muted/40 p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setMode("ask")}
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors cursor-pointer ${
                    mode === "ask"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Ask 模式：只读分析与给出修改建议，不自动改动本地文件"
                >
                  <MessageSquare size={10} /> Ask
                </button>
                <button
                  type="button"
                  onClick={() => setMode("agent")}
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors cursor-pointer ${
                    mode === "agent"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="Agent 模式：允许调用工具并直接修改本地文档"
                >
                  <Bot size={10} /> Agent
                </button>
              </div>

              <select
                aria-label="选择底层 Agent 引擎"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="h-6 max-w-[130px] rounded-md border border-transparent bg-transparent px-1 text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground focus:outline-none cursor-pointer"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.label} {p.available ? "" : "(未装)"}
                  </option>
                ))}
              </select>
            </div>

            {busy ? (
              <button
                type="button"
                onClick={handleStop}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-down text-white hover:opacity-90 cursor-pointer"
                title="中止生成"
                aria-label="中止生成"
              >
                <Square size={11} className="fill-current" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!prompt.trim()}
                onClick={() => void handleSend()}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity cursor-pointer"
                title="发送 (Enter)"
                aria-label="发送给写作 Agent"
              >
                <ArrowUp size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CursorBubble({
  item,
  copied,
  hasSelection,
  canRevert,
  onRevert,
  onCopy,
  onInsert,
  onReplace,
  onAppend,
  onOpenWiki,
  onOpenReader,
}: {
  item: ChatTimelineItem;
  copied: boolean;
  hasSelection: boolean;
  canRevert: boolean;
  onRevert: () => void;
  onCopy: () => void;
  onInsert: () => void;
  onReplace: () => void;
  onAppend: () => void;
  onOpenWiki: (path: string) => void;
  onOpenReader: (target: ReaderTarget) => void;
}) {
  if (item.kind === "error") {
    return (
      <div className="rounded-xl border border-down/40 bg-down-soft p-2.5 text-[11px] text-down">
        {item.text}
      </div>
    );
  }

  if (item.kind === "user") {
    return (
      <div className="group rounded-xl border border-border/80 bg-muted/50 px-3 py-2 text-xs space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1 min-w-0">
            {item.contextFiles?.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                <FileText size={9} /> {p.split("/").pop()}
              </span>
            ))}
          </div>
          {canRevert && (
            <button
              type="button"
              onClick={onRevert}
              data-testid="agent-revert-btn"
              title="回退到此消息并放回输入框重新编辑"
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-background hover:text-foreground transition-colors cursor-pointer"
            >
              <RotateCcw size={10} /> 回退
            </button>
          )}
        </div>
        <div className="whitespace-pre-wrap leading-relaxed text-foreground">{item.text}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-background/70 p-3 text-xs">
      <MarkdownView
        text={item.text}
        onOpenWikilink={onOpenWiki}
        onOpenUrl={(url, title) => onOpenReader({ url, title })}
      />
      <div className="flex flex-wrap items-center justify-end gap-1 border-t border-border/50 pt-1.5">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
        >
          {copied ? <Check size={10} className="text-up" /> : <Copy size={10} />}
          {copied ? "已复制" : "复制"}
        </button>
        {hasSelection && (
          <button
            type="button"
            onClick={onReplace}
            className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/25 cursor-pointer"
          >
            <Replace size={10} /> 替换选中
          </button>
        )}
        <button
          type="button"
          onClick={onInsert}
          className="inline-flex items-center gap-1 rounded bg-accent/80 px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent cursor-pointer"
        >
          <CornerDownLeft size={10} /> 插入光标处
        </button>
        <button
          type="button"
          onClick={onAppend}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
        >
          <FilePlus size={10} /> 追加文末
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  Archive,
  Bot,
  ExternalLink,
  Highlighter,
  Maximize2,
  Minimize2,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { addHighlight, archiveArticle, fetchReader, listHighlights } from "@/lib/api";
import { displayTime, errorMessage } from "@/lib/format";
import type { HighlightRecord, ReaderResponse } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ReaderTarget {
  url: string;
  title?: string;
  sourceName?: string;
  feedItemId?: string;
}

interface ReaderDrawerProps {
  target: ReaderTarget | null;
  onClose: () => void;
  onArchived?: (path: string) => void;
  onAskAi?: (prompt: string) => void;
  onNotify: (msg: string, tone?: "ok" | "err") => void;
}

export function ReaderDrawer({
  target,
  onClose,
  onArchived,
  onAskAi,
  onNotify,
}: ReaderDrawerProps) {
  const [article, setArticle] = useState<ReaderResponse | null>(null);
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showHlForm, setShowHlForm] = useState(false);
  const [hlExcerpt, setHlExcerpt] = useState("");
  const [hlComment, setHlComment] = useState("");
  const [savingHl, setSavingHl] = useState(false);

  const load = async (url: string, force = false) => {
    setLoading(true);
    setErr(null);
    try {
      const [data, hls] = await Promise.all([fetchReader(url, force), listHighlights(url)]);
      setArticle(data);
      setHighlights(hls);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!target) {
      setArticle(null);
      setHighlights([]);
      setErr(null);
      setShowHlForm(false);
      return;
    }
    void load(target.url, false);
  }, [target?.url]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  if (!target) return null;

  const pageTitle = article?.title || target.title || target.url;

  const handleCaptureSelection = () => {
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel) setHlExcerpt(sel);
    setShowHlForm(true);
  };

  const handleSaveHighlight = async () => {
    if (!hlExcerpt.trim()) return;
    setSavingHl(true);
    try {
      const rec = await addHighlight({
        url: target.url,
        page_title: pageTitle,
        excerpt: hlExcerpt.trim(),
        comment: hlComment.trim(),
      });
      setHighlights((prev) => [rec, ...prev]);
      setHlExcerpt("");
      setHlComment("");
      setShowHlForm(false);
      onNotify("已保存摘录到 SQLite");
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setSavingHl(false);
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      const excerptSummary = article?.plain_text
        ? article.plain_text.slice(0, 600)
        : `原文链接：${target.url}`;
      const res = await archiveArticle({
        url: target.url,
        title: pageTitle,
        source_name: target.sourceName ?? article?.byline ?? undefined,
        summary: excerptSummary,
        highlights: highlights.map((h) => (h.comment ? `${h.excerpt} — ${h.comment}` : h.excerpt)),
        feed_item_id: target.feedItemId,
      });
      onNotify(`已归档到本地：${res.path}`);
      onArchived?.(res.path);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setArchiving(false);
    }
  };

  const handleAskAi = () => {
    const snippet = article?.plain_text ? article.plain_text.slice(0, 2600) : "";
    const prompt = [
      `请帮我深度提炼下面这篇文章的核心论点、关键数据与可落地启发：`,
      `- 标题：${pageTitle}`,
      `- 链接：${target.url}`,
      snippet ? `\n正文摘录：\n${snippet}` : "",
    ].join("\n");
    onAskAi?.(prompt);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="应用内阅读器"
        data-testid="reader-drawer"
        className={`relative z-10 flex h-full flex-col border-l border-border bg-background text-foreground shadow-2xl transition-[width] duration-200 ${
          wide ? "w-[min(920px,96vw)]" : "w-[min(660px,94vw)]"
        }`}
      >
        {/* Header toolbar */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                内置阅读器
              </Badge>
              {target.sourceName && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {target.sourceName}
                </span>
              )}
              {article && article.status === "ok" && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  · {article.word_count} 词
                </span>
              )}
            </div>
            <div className="truncate text-sm font-semibold mt-0.5">{pageTitle}</div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCaptureSelection}
              title="新增摘录到 SQLite"
            >
              <Highlighter size={13} />
              <span className="hidden sm:inline">摘录</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleArchive}
              disabled={archiving}
              title="归档为本地 Markdown 到 worth-reading/reading-notes/"
            >
              <Archive size={13} />
              <span>{archiving ? "归档中" : "收入 worth-reading/"}</span>
            </Button>
            {onAskAi && (
              <Button size="sm" variant="default" onClick={handleAskAi}>
                <Bot size={13} />
                <span>AI 总结</span>
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void load(target.url, true)}
              disabled={loading}
              title="强制重新抓取正文"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setWide((w) => !w)}
              title={wide ? "切换标准宽度" : "切换宽屏阅读"}
            >
              {wide ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </Button>
            <a
              href={target.url}
              target="_blank"
              rel="noreferrer"
              title="在外部浏览器打开原文"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ExternalLink size={13} />
            </a>
            <Button size="icon" variant="ghost" onClick={onClose} aria-label="关闭阅读器">
              <X size={15} />
            </Button>
          </div>
        </div>

        {/* Highlight composer bar */}
        {showHlForm && (
          <div className="shrink-0 border-b border-border bg-muted/40 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-medium">
              <span>新增摘录（写入 SQLite reader_highlights）</span>
              <button
                type="button"
                onClick={() => setShowHlForm(false)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                取消
              </button>
            </div>
            <textarea
              rows={2}
              value={hlExcerpt}
              onChange={(e) => setHlExcerpt(e.target.value)}
              placeholder="粘贴或输入想摘录的句子（选中正文后点「摘录」可自动填入）..."
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex items-center gap-2">
              <Input
                value={hlComment}
                onChange={(e) => setHlComment(e.target.value)}
                placeholder="批注 / 思考（可选）"
                className="flex-1"
              />
              <Button size="sm" onClick={handleSaveHighlight} disabled={savingHl || !hlExcerpt.trim()}>
                {savingHl ? "保存中..." : "保存摘录"}
              </Button>
            </div>
          </div>
        )}

        {/* Independently scrollable reading body */}
        <div
          data-testid="reader-scroll-body"
          className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-5"
        >
          {loading && !article && (
            <div className="flex items-center gap-2 py-12 text-xs text-muted-foreground justify-center">
              <RefreshCw size={14} className="animate-spin" />
              正在后端抽取并清洗正文（缓存于 SQLite）...
            </div>
          )}

          {err && (
            <div className="rounded-lg border border-down/40 bg-down-soft p-4 text-xs text-down space-y-2">
              <div className="font-semibold">抓取失败：{err}</div>
              <a
                href={target.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                <ExternalLink size={12} /> 前往外部浏览器查看原网页
              </a>
            </div>
          )}

          {article && (
            <>
              <div className="space-y-1.5 border-b border-border/70 pb-4">
                <h1 className="text-lg font-semibold leading-snug tracking-tight">
                  {article.title || pageTitle}
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {article.byline && <span>作者：{article.byline}</span>}
                  <span>抓取于 {displayTime(article.fetched_at)}</span>
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate max-w-[360px] text-primary hover:underline"
                  >
                    {article.url}
                  </a>
                </div>
              </div>

              {article.status === "blocked" ? (
                <div className="rounded-xl border border-warn/40 bg-warn-soft p-4 space-y-2.5 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-warn">
                    <ShieldAlert size={15} />
                    <span>目标站点启用了访问限制 / 付费墙 / 反爬保护，未强行绕过</span>
                  </div>
                  <p className="text-foreground/80 leading-relaxed">
                    原因：{article.reason || "远端返回受限状态或空正文"}。你可以直接点击下方链接在外部浏览器打开阅读，或先将其归档为待读卡片。
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
                    >
                      <ExternalLink size={12} /> 外部浏览器打开原文
                    </a>
                    <Button size="sm" variant="outline" onClick={handleArchive} disabled={archiving}>
                      <Archive size={12} /> 仅归档链接笔记
                    </Button>
                  </div>
                </div>
              ) : (
                <article
                  className="reader-prose"
                  dangerouslySetInnerHTML={{ __html: article.clean_html }}
                />
              )}

              {/* Saved Highlights from SQLite */}
              <section className="border-t border-border/70 pt-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    本文摘录 ({highlights.length})
                  </h2>
                  <Button size="sm" variant="ghost" onClick={handleCaptureSelection}>
                    <Highlighter size={12} /> 添加摘录
                  </Button>
                </div>
                {highlights.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    暂无摘录。选中文字后点击上方「摘录」即可保存到 SQLite，并在归档时自动写入 Markdown。
                  </p>
                ) : (
                  <div className="space-y-2">
                    {highlights.map((hl) => (
                      <div
                        key={hl.id}
                        className="rounded-lg border border-border/80 bg-card/60 px-3 py-2 text-xs space-y-1"
                      >
                        <blockquote className="border-l-2 border-primary/60 pl-2.5 text-foreground/95 leading-relaxed">
                          {hl.excerpt}
                        </blockquote>
                        {hl.comment && (
                          <div className="text-[11px] text-muted-foreground">批注：{hl.comment}</div>
                        )}
                        <div className="text-[10px] text-muted-foreground">
                          {displayTime(hl.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

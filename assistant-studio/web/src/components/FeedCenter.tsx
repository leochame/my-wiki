import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookOpen,
  Bot,
  CheckCheck,
  ExternalLink,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import {
  addFeedSource,
  archiveArticle,
  deleteFeedSource,
  importOpml,
  listFeeds,
  patchFeedItem,
  refreshFeeds,
  toggleFeedSource,
} from "@/lib/api";
import { displayTime, errorMessage } from "@/lib/format";
import type { FeedItemRecord, FeedsResponse } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ReaderTarget } from "./ReaderDrawer";

interface FeedCenterProps {
  initialGroup?: string | null;
  onConsumeInitialGroup?: () => void;
  onOpenReader: (target: ReaderTarget) => void;
  onAskAi: (prompt: string) => void;
  onNotify: (msg: string, tone?: "ok" | "err") => void;
  onOpenWiki: (path: string) => void;
}

export function FeedCenter({
  initialGroup,
  onConsumeInitialGroup,
  onOpenReader,
  onAskAi,
  onNotify,
  onOpenWiki,
}: FeedCenterProps) {
  const [data, setData] = useState<FeedsResponse>({ sources: [], items: [] });
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [group, setGroup] = useState<string>(initialGroup || "all");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<"all" | "unread" | "starred">("all");
  const [query, setQuery] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    if (initialGroup) {
      setGroup(initialGroup);
      setSourceId(null);
      onConsumeInitialGroup?.();
    }
  }, [initialGroup, onConsumeInitialGroup]);

  // Add RSS dialog
  const [addOpen, setAddOpen] = useState(false);
  const [rssName, setRssName] = useState("");
  const [rssGroup, setRssGroup] = useState("Tech");
  const [rssUrl, setRssUrl] = useState("");
  const [adding, setAdding] = useState(false);

  // Import OPML dialog
  const [opmlOpen, setOpmlOpen] = useState(false);
  const [opmlGroup, setOpmlGroup] = useState("Karpathy");
  const [opmlXml, setOpmlXml] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listFeeds({
        group: group === "all" ? undefined : group,
        source_id: sourceId ?? undefined,
        unread: filterTab === "unread" ? true : undefined,
        starred: filterTab === "starred" ? true : undefined,
        q: query.trim() || undefined,
        limit: 160,
      });
      setData(res);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setLoading(false);
    }
  }, [group, sourceId, filterTab, query, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of data.sources) {
      map.set(s.group_name, (map.get(s.group_name) ?? 0) + 1);
    }
    return Array.from(map.entries());
  }, [data.sources]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await refreshFeeds();
      await load();
      onNotify(`已拉取 ${res.processed} 个活跃订阅源并更新 SQLite`);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setRefreshing(false);
    }
  };

  const handleOpenArticle = async (item: FeedItemRecord) => {
    onOpenReader({
      url: item.url,
      title: item.title,
      sourceName: item.source_name,
      feedItemId: item.id,
    });
    if (!item.is_read) {
      try {
        await patchFeedItem(item.id, { is_read: true });
        setData((prev) => ({
          ...prev,
          items: prev.items.map((x) => (x.id === item.id ? { ...x, is_read: true } : x)),
        }));
      } catch {
        // Non-blocking
      }
    }
  };

  const handleToggleStar = async (item: FeedItemRecord) => {
    const next = !item.is_starred;
    try {
      await patchFeedItem(item.id, { is_starred: next });
      setData((prev) => ({
        ...prev,
        items: prev.items.map((x) => (x.id === item.id ? { ...x, is_starred: next } : x)),
      }));
    } catch (e) {
      onNotify(errorMessage(e), "err");
    }
  };

  const handleQuickArchive = async (item: FeedItemRecord) => {
    try {
      const res = await archiveArticle({
        url: item.url,
        title: item.title,
        source_name: item.source_name,
        summary: item.summary ?? undefined,
        feed_item_id: item.id,
      });
      setData((prev) => ({
        ...prev,
        items: prev.items.map((x) =>
          x.id === item.id ? { ...x, saved_note_path: res.path } : x,
        ),
      }));
      onNotify(`已归档到本地：${res.path}`);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    }
  };

  const handleAddRss = async () => {
    if (!rssName.trim() || !rssUrl.trim()) return;
    setAdding(true);
    try {
      await addFeedSource({
        name: rssName.trim(),
        group_name: rssGroup.trim() || "Tech",
        feed_url: rssUrl.trim(),
      });
      setAddOpen(false);
      setRssName("");
      setRssUrl("");
      await load();
      onNotify("已添加 RSS 源并开始首次同步");
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setAdding(false);
    }
  };

  const handleImportOpml = async () => {
    if (!opmlXml.trim()) return;
    setImporting(true);
    try {
      const res = await importOpml(opmlXml, opmlGroup.trim() || "OPML");
      setOpmlOpen(false);
      setOpmlXml("");
      await load();
      onNotify(`已成功批量导入 ${res.imported} 个 OPML 订阅源到 SQLite`);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setImporting(false);
    }
  };

  const handleToggleSource = async (id: string, enabled: boolean) => {
    try {
      await toggleFeedSource(id, enabled);
      setData((prev) => ({
        ...prev,
        sources: prev.sources.map((s) => (s.id === id ? { ...s, enabled } : s)),
      }));
    } catch (e) {
      onNotify(errorMessage(e), "err");
    }
  };

  const handleDeleteSource = async (id: string, name: string) => {
    try {
      await deleteFeedSource(id);
      if (sourceId === id) setSourceId(null);
      await load();
      onNotify(`已移除订阅源：${name}`);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    }
  };

  const visibleSources = useMemo(() => {
    const base =
      group === "all" ? data.sources : data.sources.filter((s) => s.group_name === group);
    const q = sourceQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter((s) =>
      `${s.name} ${s.description ?? ""} ${s.group_name}`.toLowerCase().includes(q),
    );
  }, [data.sources, group, sourceQuery]);

  const unreadVisibleItems = useMemo(
    () => data.items.filter((it) => !it.is_read),
    [data.items],
  );

  const handleMarkVisibleRead = async () => {
    if (unreadVisibleItems.length === 0 || markingAll) return;
    setMarkingAll(true);
    try {
      const targets = unreadVisibleItems.slice(0, 60);
      await Promise.all(targets.map((it) => patchFeedItem(it.id, { is_read: true })));
      const ids = new Set(targets.map((it) => it.id));
      setData((prev) => ({
        ...prev,
        items: prev.items.map((x) => (ids.has(x.id) ? { ...x, is_read: true } : x)),
      }));
      onNotify(`已将当前 ${targets.length} 条未读资讯标记为已读`);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setMarkingAll(false);
    }
  };

  const selectedSourceObj = useMemo(
    () => (sourceId ? data.sources.find((s) => s.id === sourceId) ?? null : null),
    [data.sources, sourceId],
  );

  return (
    <div className="grid h-full min-h-0 gap-px bg-border lg:grid-cols-12">
      {/* Left: Groups & RSS sources (flush, zero outer margin/radius) */}
      <aside className="flex min-h-0 flex-col bg-card lg:col-span-3">
        <div className="shrink-0 border-b border-border p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-1">
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              <Rss size={13} className="text-primary" /> 订阅源 ({data.sources.length})
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant="ghost"
                className="h-6 px-1.5 text-[10px]"
                onClick={() => onOpenWiki("worth-reading/karpathy-feeds-guide.md")}
                title="查看 Karpathy 关注的 91 位博主分类说明文档"
              >
                <BookOpen size={11} /> 博主说明
              </Button>
              <Button
                size="xs"
                variant="outline"
                className="h-6 px-1.5 text-[10px]"
                onClick={() => setOpmlOpen(true)}
              >
                <Upload size={10} /> OPML
              </Button>
              <Button
                size="xs"
                className="h-6 px-1.5 text-[10px]"
                onClick={() => setAddOpen(true)}
              >
                <Plus size={10} /> 添加
              </Button>
            </div>
          </div>

          <div className="relative">
            <Search
              size={11}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={sourceQuery}
              onChange={(e) => setSourceQuery(e.target.value)}
              placeholder="搜博主名或简介（如 编译器 / Rust / 芯片）..."
              className="h-6 pl-6 text-[11px]"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => {
                setGroup("all");
                setSourceId(null);
              }}
              className={`rounded px-2 py-0.5 text-[10px] cursor-pointer ${
                group === "all" && !sourceId
                  ? "bg-primary text-primary-foreground font-medium"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              全部 ({data.sources.length})
            </button>
            {groups.map(([g, count]) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setGroup(g);
                  setSourceId(null);
                }}
                className={`rounded px-2 py-0.5 text-[10px] cursor-pointer ${
                  group === g && !sourceId
                    ? "bg-primary text-primary-foreground font-medium"
                    : "bg-muted/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {g} ({count})
              </button>
            ))}
          </div>
        </div>

        <div
          data-testid="feeds-sources-scroll"
          className="min-h-0 flex-1 overflow-y-auto divide-y divide-border/50"
        >
          {visibleSources.map((s) => {
            const active = sourceId === s.id;
            return (
              <div
                key={s.id}
                className={`flex items-start justify-between gap-1.5 px-2.5 py-1.5 text-xs transition-colors ${
                  active ? "bg-accent/70" : "hover:bg-muted/40"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSourceId(active ? null : s.id)}
                  title={s.description || `${s.name} (${s.group_name})`}
                  className="min-w-0 flex-1 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        !s.enabled
                          ? "bg-muted-foreground/40"
                          : s.last_ok
                            ? "bg-up"
                            : "bg-warn"
                      }`}
                    />
                    <span className="truncate font-medium">{s.name}</span>
                  </div>
                  {s.description ? (
                    <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                      {s.description}
                    </div>
                  ) : (
                    <div className="truncate text-[10px] text-muted-foreground">
                      {s.group_name} · {s.kind.toUpperCase()}
                    </div>
                  )}
                </button>
                <div className="flex shrink-0 items-center gap-1 pt-0.5">
                  <Switch
                    checked={s.enabled}
                    onCheckedChange={(v) => void handleToggleSource(s.id, v)}
                    aria-label={`开关 ${s.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => void handleDeleteSource(s.id, s.name)}
                    title="删除订阅源"
                    className="p-0.5 text-muted-foreground hover:text-down cursor-pointer"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Right: Feed stream (flush, zero outer margin/radius) */}
      <section className="flex min-h-0 flex-col bg-card lg:col-span-9">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-[11px]">
              {(
                [
                  ["all", "全部"],
                  ["unread", "未读"],
                  ["starred", "星标"],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilterTab(k)}
                  className={`rounded px-2.5 py-1 cursor-pointer ${
                    filterTab === k
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <div className="relative w-56">
              <Search
                size={12}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索资讯标题或摘要..."
                className="h-7 pl-7 text-xs"
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {unreadVisibleItems.length > 0 && (
              <Button
                size="xs"
                variant="ghost"
                disabled={markingAll}
                onClick={() => void handleMarkVisibleRead()}
                title="将当前列表中的未读条目标记为已读"
              >
                <CheckCheck size={11} />
                {markingAll ? "标记中..." : `本页已读 (${unreadVisibleItems.length})`}
              </Button>
            )}
            <Button size="xs" variant="outline" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "同步中..." : "刷新资讯"}
            </Button>
          </div>
        </div>

        {selectedSourceObj?.description && (
          <div className="shrink-0 border-b border-border/70 bg-muted/25 px-3 py-1.5 text-[11px] text-muted-foreground flex items-center justify-between gap-2">
            <span>
              <b className="text-foreground">{selectedSourceObj.name}</b> — {selectedSourceObj.description}
            </span>
            <Badge variant="outline" className="text-[10px] py-0 shrink-0">
              {selectedSourceObj.group_name}
            </Badge>
          </div>
        )}

        <div
          data-testid="feeds-list-scroll"
          className="min-h-0 flex-1 overflow-y-auto divide-y divide-border/60"
        >
          {loading && data.items.length === 0 ? (
            <div className="py-16 text-center text-xs text-muted-foreground">
              正在加载资讯列表...
            </div>
          ) : data.items.length === 0 ? (
            <div className="py-16 text-center text-xs text-muted-foreground space-y-2">
              <p>当前筛选下暂无资讯条目。</p>
              <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
                <RefreshCw size={12} /> 立即同步全部订阅源
              </Button>
            </div>
          ) : (
            data.items.map((item) => (
              <article
                key={item.id}
                className="flex flex-col gap-1.5 px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => void handleOpenArticle(item)}
                    className="min-w-0 flex-1 text-left cursor-pointer group"
                  >
                    <h3
                      className={`text-[13px] leading-snug group-hover:text-primary ${
                        item.is_read ? "font-normal text-muted-foreground" : "font-semibold"
                      }`}
                    >
                      {item.title}
                    </h3>
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => void handleToggleStar(item)}
                      title={item.is_starred ? "取消星标" : "加星标"}
                    >
                      <Star
                        size={13}
                        className={item.is_starred ? "fill-warn text-warn" : "text-muted-foreground"}
                      />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => void handleOpenArticle(item)}
                    >
                      <BookOpen size={11} /> 内置阅读
                    </Button>
                    {item.saved_note_path ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px] text-up"
                        onClick={() => onOpenWiki(item.saved_note_path!)}
                      >
                        已归档
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => void handleQuickArchive(item)}
                        title="归档到 worth-reading/reading-notes/"
                      >
                        <Archive size={11} /> 归档
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() =>
                        onAskAi(
                          `请帮我快速总结这篇文章的核心内容：\n- 标题：${item.title}\n- 来源：${item.source_name}\n- 链接：${item.url}\n${item.summary ? `- 摘要：${item.summary}` : ""}`,
                        )
                      }
                      title="发给 AI 助理总结"
                    >
                      <Bot size={13} />
                    </Button>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      title="外部打开原文"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>

                {item.summary && (
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {item.summary}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <Badge variant="outline" className="text-[10px] py-0">
                    {item.group_name}
                  </Badge>
                  <span className="font-medium text-foreground/80">{item.source_name}</span>
                  <span>· {displayTime(item.published_at ?? item.fetched_at)}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {/* Add RSS Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent title="添加 RSS / Atom 订阅源">
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">名称 *</label>
              <Input
                value={rssName}
                onChange={(e) => setRssName(e.target.value)}
                placeholder="例如：Paul Graham Essays"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">分组</label>
              <Input
                value={rssGroup}
                onChange={(e) => setRssGroup(e.target.value)}
                placeholder="AI / Tech / Finance / Karpathy"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">Feed URL *</label>
              <Input
                value={rssUrl}
                onChange={(e) => setRssUrl(e.target.value)}
                placeholder="https://example.com/feed.xml"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAddOpen(false)}>
                取消
              </Button>
              <Button onClick={handleAddRss} disabled={adding || !rssName.trim() || !rssUrl.trim()}>
                {adding ? "添加中..." : "添加并同步"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import OPML Dialog */}
      <Dialog open={opmlOpen} onOpenChange={setOpmlOpen}>
        <DialogContent
          title="批量导入 OPML（支持 Karpathy 90 RSS 等清单）"
          className="w-[min(560px,calc(100%-24px))]"
        >
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">导入到分组</label>
              <Input
                value={opmlGroup}
                onChange={(e) => setOpmlGroup(e.target.value)}
                placeholder="Karpathy"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">
                粘贴 OPML XML 内容（包含 `xmlUrl="..."`）
              </label>
              <textarea
                rows={7}
                value={opmlXml}
                onChange={(e) => setOpmlXml(e.target.value)}
                placeholder='<opml version="2.0"><body><outline text="Blog" xmlUrl="https://..." /></body></opml>'
                className="w-full rounded-md border border-input bg-background p-2 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpmlOpen(false)}>
                取消
              </Button>
              <Button onClick={handleImportOpml} disabled={importing || !opmlXml.trim()}>
                {importing ? "导入中..." : "导入到 SQLite"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ExternalLink,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import * as api from "@/lib/api";
import { displayTime, errorMessage } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MediaFeedResponse, MediaItem } from "@/types";

const CATEGORIES = ["全部", "核心媒体", "财经与监管", "机构与人物", "自定义"] as const;

export function MediaFeed({
  onAskAgent,
}: {
  onAskAgent: (item: MediaItem) => void;
}) {
  const [feed, setFeed] = useState<MediaFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [category, setCategory] = useState<string>("全部");
  const [outlet, setOutlet] = useState<string>("全部");
  const [lang, setLang] = useState<string>("all");
  const [query, setQuery] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newOutlet, setNewOutlet] = useState("");
  const [newFeedUrl, setNewFeedUrl] = useState("");
  const [newSiteUrl, setNewSiteUrl] = useState("");
  const [newLang, setNewLang] = useState<"en" | "zh">("en");
  const [addErr, setAddErr] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getMediaFeed({ limit: 300 });
      setFeed(data);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll briefly while backend initial RSS sync is still running, and refresh passively every 5 min
  useEffect(() => {
    const ms = feed?.refreshing || (feed && !feed.updated_at) ? 2000 : 300_000;
    const timer = window.setInterval(() => void load(), ms);
    return () => window.clearInterval(timer);
  }, [feed?.refreshing, feed?.updated_at, load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      const data = await api.refreshMediaFeed();
      setFeed(data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      const data = await api.toggleMediaSource(id, enabled);
      setFeed(data);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const data = await api.deleteMediaSource(id);
      setFeed(data);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const handleAddSource = async () => {
    setAddErr("");
    setAdding(true);
    try {
      const data = await api.addMediaSource({
        name: newName.trim(),
        outlet: newOutlet.trim(),
        feed_url: newFeedUrl.trim(),
        site_url: newSiteUrl.trim() || undefined,
        language: newLang,
        category: "自定义",
      });
      setFeed(data);
      setAddOpen(false);
      setNewName("");
      setNewOutlet("");
      setNewFeedUrl("");
      setNewSiteUrl("");
    } catch (e) {
      setAddErr(errorMessage(e));
    } finally {
      setAdding(false);
    }
  };

  const sources = feed?.sources ?? [];
  const items = feed?.items ?? [];

  const filteredSources = useMemo(
    () => (category === "全部" ? sources : sources.filter((s) => s.category === category)),
    [sources, category],
  );

  const outletSummaries = useMemo(() => {
    const map = new Map<
      string,
      { outlet: string; category: string; count: number; okCount: number; totalChannels: number }
    >();
    for (const s of filteredSources) {
      const entry = map.get(s.outlet) ?? {
        outlet: s.outlet,
        category: s.category,
        count: 0,
        okCount: 0,
        totalChannels: 0,
      };
      if (s.enabled) {
        entry.totalChannels += 1;
        if (s.ok) entry.okCount += 1;
        entry.count += s.item_count;
      }
      map.set(s.outlet, entry);
    }
    return Array.from(map.values());
  }, [filteredSources]);

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== "全部" && item.category !== category) return false;
      if (outlet !== "全部" && item.outlet !== outlet) return false;
      if (lang !== "all" && item.language !== lang) return false;
      if (q) {
        const hay = `${item.title} ${item.summary ?? ""} ${item.outlet} ${item.source_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, category, outlet, lang, query]);

  const activeSourcesCount = sources.filter((s) => s.enabled).length;
  const okSourcesCount = sources.filter((s) => s.enabled && s.ok).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[288px_minmax(0,1fr)] gap-3 items-start rb-enter">
      {/* Left Rail: Followed Media Outlets & Real RSS Channel Status */}
      <div className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle>
              <Newspaper size={13} className="text-primary" />
              关注媒体
            </CardTitle>
            <Badge variant={okSourcesCount > 0 ? "up" : "default"}>
              {okSourcesCount}/{activeSourcesCount} 源在线
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.filter(
                (c) => c === "全部" || sources.some((s) => s.category === c),
              ).map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setCategory(c);
                    setOutlet("全部");
                  }}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] transition-colors cursor-pointer",
                    category === c
                      ? "bg-accent text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="space-y-0.5">
              <button
                onClick={() => setOutlet("全部")}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors cursor-pointer",
                  outlet === "全部"
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span>全部媒体</span>
                <span className="text-[11px]">{visibleItems.length}</span>
              </button>
              {outletSummaries.map((o) => (
                <button
                  key={o.outlet}
                  onClick={() => setOutlet(o.outlet)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors cursor-pointer",
                    outlet === o.outlet
                      ? "bg-accent text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="inline-flex items-center gap-1.5 truncate">
                    <i
                      className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0",
                        o.okCount > 0
                          ? "bg-up"
                          : o.totalChannels === 0
                            ? "bg-muted-foreground/40"
                            : "bg-warn",
                      )}
                    />
                    <span className="truncate">{o.outlet}</span>
                  </span>
                  <span className="text-[11px] tabular-nums">{o.count}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>RSS / Atom 订阅源</CardTitle>
            <Button variant="outline" size="xs" onClick={() => setAddOpen(true)}>
              <Plus size={11} /> 添加
            </Button>
          </CardHeader>
          <CardContent className="divide-y divide-border/60 py-0 max-h-[420px] overflow-y-auto">
            {filteredSources.map((src) => (
              <div key={src.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <i
                      className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0",
                        !src.enabled
                          ? "bg-muted-foreground/40"
                          : src.ok
                            ? "bg-up"
                            : src.error
                              ? "bg-down"
                              : "bg-warn",
                      )}
                    />
                    <a
                      href={src.site_url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-medium hover:text-primary inline-flex items-center gap-0.5"
                    >
                      <span className="truncate">{src.name}</span>
                      <ExternalLink size={9} className="shrink-0 opacity-60" />
                    </a>
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground truncate">
                    {!src.enabled
                      ? "已暂停"
                      : src.ok
                        ? `${src.item_count} 条 · ${src.language === "zh" ? "中文" : "EN"}`
                        : src.error
                          ? `失败: ${src.error}`
                          : "同步中…"}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {src.category === "自定义" && (
                    <button
                      onClick={() => void handleDelete(src.id)}
                      aria-label={`删除 ${src.name}`}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-down cursor-pointer"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                  <Switch
                    checked={src.enabled}
                    onCheckedChange={(checked) => void handleToggle(src.id, checked)}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Right Main Stream: Live Deduplicated Financial News */}
      <SpotlightCard className="flex flex-col min-h-[640px]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[200px]">
            <div className="relative flex-1 max-w-xs">
              <Search
                size={12}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="筛选标题、摘要或媒体…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-7 pl-7"
              />
            </div>

            <Tabs value={lang} onValueChange={setLang}>
              <TabsList>
                <TabsTrigger value="all" className="h-5 px-2">
                  全部
                </TabsTrigger>
                <TabsTrigger value="zh" className="h-5 px-2">
                  中文
                </TabsTrigger>
                <TabsTrigger value="en" className="h-5 px-2">
                  EN
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>
              {feed?.updated_at
                ? `同步 ${displayTime(feed.updated_at, true)} · 每10分自动更新`
                : "正在首次拉取官方 RSS…"}
            </span>
            <Button
              variant="outline"
              size="xs"
              disabled={refreshing || feed?.refreshing}
              onClick={() => void handleRefresh()}
            >
              <RefreshCw
                size={11}
                className={refreshing || feed?.refreshing ? "animate-spin" : ""}
              />
              刷新
            </Button>
          </div>
        </div>

        {error && (
          <div className="mx-3.5 mt-2.5 rounded-md bg-down-soft px-3 py-1.5 text-xs text-down">
            {error}
          </div>
        )}

        <div className="divide-y divide-border/60 flex-1">
          {loading || (visibleItems.length === 0 && (feed?.refreshing || !feed?.updated_at)) ? (
            <div className="flex h-72 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              <span>正在拉取 Bloomberg / Reuters / WSJ / NYT / FT / Fed / SEC 官方源…</span>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
              当前筛选条件下暂无条目
            </div>
          ) : (
            visibleItems.map((item) => (
              <div
                key={item.id}
                className="group flex items-start justify-between gap-3 px-3.5 py-2.5 hover:bg-muted/35 transition-colors"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <Badge variant="outline" className="font-semibold">
                      {item.outlet}
                    </Badge>
                    <span className="text-muted-foreground">{item.source_name}</span>
                    {item.language === "zh" && <Badge variant="default">中</Badge>}
                    {item.published_at && (
                      <span className="text-muted-foreground tabular-nums">
                        · {displayTime(item.published_at)}
                      </span>
                    )}
                  </div>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-start gap-1 text-[13px] font-medium leading-snug text-foreground hover:text-primary transition-colors"
                  >
                    <span>{item.title}</span>
                    <ArrowUpRight size={12} className="mt-0.5 shrink-0 opacity-50" />
                  </a>
                  {item.summary && (
                    <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
                      {item.summary}
                    </p>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onAskAgent(item)}
                  className="shrink-0 opacity-75 group-hover:opacity-100"
                >
                  <Sparkles size={11} className="text-up" /> AI 解读
                </Button>
              </div>
            ))
          )}
        </div>
      </SpotlightCard>

      {/* Add Custom RSS Source Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent title="添加 RSS / Atom 媒体源">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAddSource();
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-[11px] text-muted-foreground">媒体名称</span>
                <Input
                  placeholder="如 FT / Economist"
                  value={newOutlet}
                  onChange={(e) => setNewOutlet(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <span className="text-[11px] text-muted-foreground">语言</span>
                <select
                  value={newLang}
                  onChange={(e) => setNewLang(e.target.value as "en" | "zh")}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none"
                >
                  <option value="en">英文 (EN)</option>
                  <option value="zh">中文 (ZH)</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">频道名称</span>
              <Input
                placeholder="如 FT · Home"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">RSS / Atom URL</span>
              <Input
                placeholder="https://..."
                value={newFeedUrl}
                onChange={(e) => setNewFeedUrl(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">官网链接（可选）</span>
              <Input
                placeholder="https://..."
                value={newSiteUrl}
                onChange={(e) => setNewSiteUrl(e.target.value)}
              />
            </div>
            {addErr && (
              <div className="rounded-md bg-down-soft px-2.5 py-1.5 text-[11px] text-down">
                {addErr}
              </div>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={adding || !newName.trim() || !newOutlet.trim() || !newFeedUrl.trim()}
            >
              {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              验证并添加
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

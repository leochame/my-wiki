import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Bot,
  CalendarCheck2,
  CheckCircle2,
  FileText,
  Palette,
  Play,
  Rss,
  Search,
  Terminal,
  TrendingUp,
} from "lucide-react";
import { runScript, searchVault } from "@/lib/api";
import { AREA_LABELS, errorMessage } from "@/lib/format";
import { THEME_PRESETS, type MarketColorMode, type ThemePreset } from "@/lib/theme";
import type { ScriptDef, SearchHit, TaskRecord, VaultFileRecord } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type PaletteTabId = "today" | "wiki" | "feeds" | "invest" | "acp";

interface PaletteItem {
  id: string;
  section: string;
  title: string;
  subtitle?: string;
  badge?: string;
  icon: typeof Search;
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  indexedFiles: number;
  vaultFiles: VaultFileRecord[];
  tasks: TaskRecord[];
  scripts: ScriptDef[];
  watchlist: string[];
  theme: ThemePreset;
  colorMode: MarketColorMode;
  onNavigate: (tab: PaletteTabId) => void;
  onOpenWiki: (path: string) => void;
  onOpenStock: (symbol: string) => void;
  onSelectTheme: (preset: ThemePreset) => void;
  onSelectColorMode: (mode: MarketColorMode) => void;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: "ok" | "err") => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  indexedFiles,
  vaultFiles,
  tasks,
  scripts,
  watchlist,
  theme,
  colorMode,
  onNavigate,
  onOpenWiki,
  onOpenStock,
  onSelectTheme,
  onSelectColorMode,
  onRefresh,
  onNotify,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [docHits, setDocHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDocHits([]);
      setActiveIndex(0);
    }
  }, [open]);

  // Debounced SQLite FTS5 search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setDocHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchVault(q)
        .then(setDocHits)
        .catch(() => setDocHits([]))
        .finally(() => setSearching(false));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const closeAnd = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const triggerScript = (sc: ScriptDef) => {
    onOpenChange(false);
    onNotify(`已启动脚本「${sc.label}」...`);
    void runScript(sc.key)
      .then((rec) => {
        if (rec.status === "ok") {
          onNotify(`脚本「${sc.label}」完成 (${rec.duration_ms ?? 0}ms)`);
        } else {
          onNotify(`脚本「${sc.label}」退出码 ${rec.exit_code ?? -1}`, "err");
        }
        return onRefresh();
      })
      .catch((e) => onNotify(errorMessage(e), "err"));
  };

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const out: PaletteItem[] = [];

    // 1. Navigation Views
    const navs: Array<{ id: PaletteTabId; label: string; key: string; icon: typeof Search }> = [
      { id: "today", label: "今日与任务工作台", key: "1", icon: CalendarCheck2 },
      { id: "wiki", label: "文档 IDE 工作室", key: "2", icon: FileText },
      { id: "feeds", label: "统一资讯中心", key: "3", icon: Rss },
      { id: "invest", label: "投研终端（行情 / 持仓）", key: "4", icon: TrendingUp },
      { id: "acp", label: "AI 助理工作台", key: "5", icon: Bot },
    ];
    for (const n of navs) {
      if (!q || `${n.label} ${n.id}`.toLowerCase().includes(q)) {
        out.push({
          id: `nav-${n.id}`,
          section: "视图跳转",
          title: n.label,
          badge: `键 ${n.key}`,
          icon: n.icon,
          onSelect: () => closeAnd(() => onNavigate(n.id)),
        });
      }
    }

    // 2. Executable Scripts
    for (const sc of scripts) {
      if (!q || `${sc.label} ${sc.key} ${sc.description} 运行 脚本`.toLowerCase().includes(q)) {
        out.push({
          id: `script-${sc.key}`,
          section: "执行脚本",
          title: `运行：${sc.label}`,
          subtitle: sc.description,
          badge: sc.key,
          icon: Play,
          onSelect: () => triggerScript(sc),
        });
      }
    }

    // 3. Watchlist Stocks -> jump straight to #invest
    const stockMatches = watchlist
      .filter((sym) => !q || `${sym} 股票 行情 k线`.toLowerCase().includes(q))
      .slice(0, q ? 8 : 4);
    for (const sym of stockMatches) {
      out.push({
        id: `stock-${sym}`,
        section: "投研标的",
        title: sym,
        subtitle: "打开投研实时行情与 K 线图",
        badge: "投研",
        icon: TrendingUp,
        onSelect: () => closeAnd(() => onOpenStock(sym)),
      });
    }

    // 4. Tasks
    const taskMatches = tasks
      .filter((t) =>
        !q
          ? t.status !== "done" && t.status !== "cancelled"
          : `${t.id} ${t.title} ${t.category} ${t.status}`.toLowerCase().includes(q),
      )
      .slice(0, q ? 8 : 4);
    for (const t of taskMatches) {
      out.push({
        id: `task-${t.id}`,
        section: "任务",
        title: `${t.id} ${t.title}`,
        subtitle: t.due ? `截止 ${t.due} · ${t.file_path}` : t.file_path,
        badge: t.status,
        icon: CheckCircle2,
        onSelect: () => closeAnd(() => onOpenWiki(t.file_path)),
      });
    }

    // 5. Quick Docs or Live SQLite FTS5 Search Hits
    if (!q) {
      const quickPaths = [
        "Home.md",
        "task/today.md",
        "job-search/companies/latest-job-watch.md",
        "worth-reading/karpathy-feeds-guide.md",
      ];
      for (const p of quickPaths) {
        out.push({
          id: `quick-${p}`,
          section: "常用文档",
          title: p,
          subtitle: `已索引 ${indexedFiles || vaultFiles.length} 篇本地 Markdown`,
          badge: "Wiki",
          icon: BookOpen,
          onSelect: () => closeAnd(() => onOpenWiki(p)),
        });
      }
    } else {
      for (const hit of docHits.slice(0, 10)) {
        out.push({
          id: `doc-${hit.path}`,
          section: "Vault 文档 (FTS5)",
          title: hit.title,
          subtitle: hit.snippet || hit.path,
          badge: AREA_LABELS[hit.area] ?? hit.area,
          icon: FileText,
          onSelect: () => closeAnd(() => onOpenWiki(hit.path)),
        });
      }
    }

    // 6. Themes & Color Mode
    for (const preset of THEME_PRESETS) {
      if (q && `${preset.label} ${preset.id} 主题 深色 浅色 theme`.toLowerCase().includes(q)) {
        out.push({
          id: `theme-${preset.id}`,
          section: "外观与偏好",
          title: `切换主题：${preset.label}`,
          badge: theme === preset.id ? "当前" : preset.dark ? "深色" : "浅色",
          icon: Palette,
          onSelect: () => closeAnd(() => onSelectTheme(preset.id)),
        });
      }
    }
    if (q && /涨跌|美股|港a|配色|color/.test(q)) {
      out.push({
        id: "color-toggle",
        section: "外观与偏好",
        title: colorMode === "us" ? "切换为港A红涨绿跌" : "切换为美股绿涨红跌",
        badge: colorMode === "us" ? "当前美股" : "当前港A",
        icon: Terminal,
        onSelect: () => closeAnd(() => onSelectColorMode(colorMode === "us" ? "cn" : "us")),
      });
    }

    return out;
  }, [
    query,
    scripts,
    watchlist,
    tasks,
    docHits,
    indexedFiles,
    vaultFiles.length,
    theme,
    colorMode,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, items.length]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter" && items[activeIndex]) {
      e.preventDefault();
      items[activeIndex].onSelect();
    }
  };

  // Group items preserving section order
  const grouped = useMemo(() => {
    const map = new Map<string, Array<{ item: PaletteItem; flatIdx: number }>>();
    items.forEach((item, flatIdx) => {
      const arr = map.get(item.section) ?? [];
      arr.push({ item, flatIdx });
      map.set(item.section, arr);
    });
    return Array.from(map.entries());
  }, [items]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="全局命令与知识库面板 (⌘K)"
        className="w-[min(660px,calc(100%-24px))] p-0 overflow-hidden"
      >
        <div className="flex flex-col">
          <div className="relative border-b border-border bg-muted/20 px-3 py-2">
            <Search
              size={14}
              className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              autoFocus
              data-testid="command-palette-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="搜文档、任务、股票代码（如 NVDA）、运行脚本（如 gmail / jobs）或切换主题..."
              className="h-8 border-0 bg-transparent pl-7 text-xs shadow-none focus-visible:ring-0"
            />
          </div>

          <div
            data-testid="command-palette-list"
            className="max-h-[420px] overflow-y-auto divide-y divide-border/50"
          >
            {items.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground">
                {searching ? "检索 Vault FTS5 中..." : `未找到与「${query}」匹配的项目`}
              </div>
            ) : (
              grouped.map(([section, entries]) => (
                <div key={section} className="py-1">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {section}
                  </div>
                  {entries.map(({ item, flatIdx }) => {
                    const Icon = item.icon;
                    const active = flatIdx === activeIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseEnter={() => setActiveIndex(flatIdx)}
                        onClick={item.onSelect}
                        className={`flex w-full items-center justify-between gap-2.5 px-3 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                          active ? "bg-accent text-foreground" : "hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Icon size={13} className="shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{item.title}</div>
                            {item.subtitle && (
                              <div className="truncate text-[10px] text-muted-foreground">
                                {item.subtitle}
                              </div>
                            )}
                          </div>
                        </div>
                        {item.badge && (
                          <Badge variant="outline" className="text-[10px] py-0 shrink-0 font-mono">
                            {item.badge}
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] font-mono text-muted-foreground">
            <span>↑↓ 选择 · Enter 执行 · Esc 关闭</span>
            <span>
              {searching
                ? "FTS5 检索中..."
                : `Vault ${indexedFiles || vaultFiles.length} 篇 · ${tasks.length} 任务 · ${scripts.length} 脚本`}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

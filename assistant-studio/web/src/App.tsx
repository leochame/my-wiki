import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  CalendarCheck2,
  FileText,
  Palette,
  RefreshCw,
  Rss,
  Search,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  getHealth,
  getToday,
  listTasks,
  listVaultFiles,
} from "@/lib/api";
import { getWatchlist } from "@/invest/api";
import { errorMessage } from "@/lib/format";
import {
  applyTheme,
  loadSavedColorMode,
  loadSavedTheme,
  THEME_PRESETS,
  type MarketColorMode,
  type ThemePreset,
} from "@/lib/theme";
import type {
  HealthResponse,
  TaskRecord,
  TodayResponse,
  VaultFileRecord,
} from "@/types";
import { TodayDashboard } from "@/components/TodayDashboard";
import { WikiStudio } from "@/components/WikiStudio";
import { FeedCenter } from "@/components/FeedCenter";
import { AcpChat } from "@/components/AcpChat";
import { ReaderDrawer, type ReaderTarget } from "@/components/ReaderDrawer";
import { CommandPalette } from "@/components/CommandPalette";
import { WorkspaceStatusBar } from "@/components/WorkspaceStatusBar";
import { InvestWorkspace } from "@/invest/InvestWorkspace";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";

type TabId = "today" | "wiki" | "feeds" | "invest" | "acp";

const TABS: Array<{ id: TabId; label: string; icon: typeof CalendarCheck2 }> = [
  { id: "today", label: "今日与任务", icon: CalendarCheck2 },
  { id: "wiki", label: "文档", icon: FileText },
  { id: "feeds", label: "资讯", icon: Rss },
  { id: "invest", label: "投研", icon: TrendingUp },
  { id: "acp", label: "助理", icon: Bot },
];

function tabFromHash(): TabId {
  const h = window.location.hash.replace(/^#/, "");
  if (h === "tasks" || h === "today") return "today";
  if (h === "wiki" || h === "feeds" || h === "invest" || h === "acp") return h;
  return "today";
}

export function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [theme, setTheme] = useState<ThemePreset>(loadSavedTheme);
  const [colorMode, setColorMode] = useState<MarketColorMode>(loadSavedColorMode);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [vaultFiles, setVaultFiles] = useState<VaultFileRecord[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [activeWikiPath, setActiveWikiPath] = useState<string | null>(null);
  const [feedsInitialGroup, setFeedsInitialGroup] = useState<string | null>(null);
  const [investInitialSymbol, setInvestInitialSymbol] = useState<string | null>(null);
  const [readerTarget, setReaderTarget] = useState<ReaderTarget | null>(null);
  const [acpDraft, setAcpDraft] = useState<{ prompt?: string; contextPaths?: string[] } | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Global Raycast/Linear Command Palette (Cmd+K)
  const [cmdOpen, setCmdOpen] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);

  const notify = useCallback((msg: string, tone: "ok" | "err" = "ok") => {
    setToast({ msg, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    applyTheme(theme, colorMode);
  }, [theme, colorMode]);

  const navigate = useCallback((next: TabId) => {
    setTab(next);
    if (window.location.hash !== `#${next}`) {
      window.location.hash = `#${next}`;
    }
  }, []);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refreshCore = useCallback(async () => {
    setRefreshing(true);
    setLoadError(null);
    try {
      const [h, td, ts, vf, wl] = await Promise.allSettled([
        getHealth(),
        getToday(),
        listTasks(),
        listVaultFiles(),
        getWatchlist(),
      ]);
      if (h.status === "fulfilled") setHealth(h.value);
      if (td.status === "fulfilled") setToday(td.value);
      if (ts.status === "fulfilled") setTasks(ts.value);
      if (vf.status === "fulfilled") setVaultFiles(vf.value);
      if (wl.status === "fulfilled") setWatchlist(wl.value);

      const firstErr = [td, h, ts, vf].find((r) => r.status === "rejected");
      if (firstErr && firstErr.status === "rejected") {
        const msg = errorMessage(firstErr.reason);
        setLoadError(msg);
        notify(msg, "err");
      }
    } finally {
      setRefreshing(false);
    }
  }, [notify]);

  useEffect(() => {
    void refreshCore();
  }, [refreshCore]);

  // Global keyboard shortcuts: Cmd+K command palette + 1-5 view switching (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < TABS.length) {
        navigate(TABS[idx].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const openWikiPath = useCallback(
    (path: string) => {
      setActiveWikiPath(path);
      navigate("wiki");
    },
    [navigate],
  );

  const askAi = useCallback(
    (prompt: string, contextPaths?: string[]) => {
      setAcpDraft({ prompt, contextPaths });
      navigate("acp");
    },
    [navigate],
  );

  const openFinanceFeeds = useCallback(() => {
    setFeedsInitialGroup("核心财经");
    navigate("feeds");
  }, [navigate]);

  const openInvestSymbol = useCallback(
    (symbol: string) => {
      setInvestInitialSymbol(symbol);
      navigate("invest");
    },
    [navigate],
  );

  const cycleTheme = useCallback(() => {
    setTheme((cur) => {
      const idx = THEME_PRESETS.findIndex((t) => t.id === cur);
      return THEME_PRESETS[(idx + 1) % THEME_PRESETS.length].id;
    });
  }, []);

  const fullViewportLock = tab === "wiki" || tab === "feeds" || tab === "acp";

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={`bg-background text-foreground flex flex-col ${
          fullViewportLock ? "h-screen overflow-hidden" : "min-h-screen"
        }`}
      >
        {/* Full-bleed compact IDE Topbar */}
        <header className="sticky top-0 z-30 h-11 shrink-0 border-b border-border bg-background/95 backdrop-blur-md">
          <div className="flex h-full w-full items-center justify-between gap-3 px-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => navigate("today")}
                className="flex items-center gap-2 shrink-0 cursor-pointer"
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-xs">
                  <Sparkles size={13} />
                </span>
                <div className="text-left leading-none">
                  <div className="text-xs font-semibold tracking-tight">MyWiki Studio</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    知识库 · 投研 · 个人助理
                  </div>
                </div>
              </button>

              <nav aria-label="主导航" className="flex items-center gap-0.5">
                {TABS.map(({ id, label, icon: Icon }) => {
                  const active = tab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => navigate(id)}
                      className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                        active
                          ? "bg-accent text-foreground font-semibold"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      }`}
                    >
                      <Icon size={13} />
                      <span>{label}</span>
                      {id === "invest" && health?.invest_ready && (
                        <span className="h-1.5 w-1.5 rounded-full bg-up" />
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="topbar-command-btn"
                onClick={() => setCmdOpen(true)}
                className="inline-flex h-7 items-center gap-2 rounded-md border border-border bg-card px-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer"
              >
                <Search size={12} />
                <span className="hidden md:inline">命令 / 检索 Vault / 股票...</span>
                <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">⌘K</kbd>
              </button>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-7 w-7"
                    aria-label="切换主题与偏好"
                  >
                    <Palette size={13} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60 p-2.5 space-y-2.5">
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-muted-foreground">
                      tweakcn 主题预设
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {THEME_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setTheme(preset.id)}
                          className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs cursor-pointer ${
                            theme === preset.id
                              ? "border-primary bg-accent font-medium"
                              : "border-border/70 hover:bg-muted/50"
                          }`}
                        >
                          <span className="flex -space-x-1">
                            {preset.swatch.map((c, idx) => (
                              <span
                                key={idx}
                                className="h-3 w-3 rounded-full border border-black/20"
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </span>
                          <span className="truncate">{preset.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-muted-foreground">
                      行情涨跌习惯
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          ["us", "绿涨红跌 (美股)"],
                          ["cn", "红涨绿跌 (港A)"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setColorMode(id)}
                          className={`rounded-md border px-2 py-1 text-[11px] transition-colors cursor-pointer ${
                            colorMode === id
                              ? "border-primary bg-accent font-medium"
                              : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => void refreshCore()}
                disabled={refreshing}
                aria-label="刷新数据"
              >
                <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
              </Button>
            </div>
          </div>
        </header>

        {/* Full-bleed Main View */}
        <main
          className={
            fullViewportLock
              ? "w-full min-h-0 flex-1 flex flex-col overflow-hidden"
              : "w-full flex-1 p-0"
          }
        >
          {tab === "today" && (
            <TodayDashboard
              today={today}
              tasks={tasks}
              loadError={loadError}
              investReady={health?.invest_ready ?? health?.northstar_online ?? false}
              onRefresh={refreshCore}
              onOpenWiki={openWikiPath}
              onOpenReader={setReaderTarget}
              onGoInvest={() => navigate("invest")}
              onAskAi={(p, ctx) => askAi(p, ctx)}
              onNotify={notify}
            />
          )}

          {tab === "wiki" && (
            <WikiStudio
              files={vaultFiles}
              activePath={activeWikiPath}
              onSelectPath={setActiveWikiPath}
              onRefreshFiles={refreshCore}
              onOpenReader={setReaderTarget}
              onAskAiWithDoc={(path, title) =>
                askAi(
                  `请结合文档「${title}」(@${path}) 与我协作：先帮我梳理核心结构，再指出可以补充或改进的地方。`,
                  [path],
                )
              }
              onNotify={notify}
            />
          )}

          {tab === "feeds" && (
            <FeedCenter
              initialGroup={feedsInitialGroup}
              onConsumeInitialGroup={() => setFeedsInitialGroup(null)}
              onOpenReader={setReaderTarget}
              onAskAi={(p) => askAi(p)}
              onNotify={notify}
              onOpenWiki={openWikiPath}
            />
          )}

          {tab === "invest" && (
            <InvestWorkspace
              initialSymbol={investInitialSymbol}
              onConsumeInitialSymbol={() => setInvestInitialSymbol(null)}
              onOpenFinanceFeeds={openFinanceFeeds}
            />
          )}

          {tab === "acp" && (
            <AcpChat
              vaultFiles={vaultFiles}
              initialDraft={acpDraft}
              onConsumeInitialDraft={() => setAcpDraft(null)}
              onOpenWiki={openWikiPath}
              onOpenReader={setReaderTarget}
              onNotify={notify}
            />
          )}
        </main>

        {/* Global 24px IDE Bottom Status Bar (Wiki has its own built-in status bar) */}
        {tab !== "wiki" && (
          <WorkspaceStatusBar
            health={health}
            today={today}
            vaultCount={vaultFiles.length}
            theme={theme}
            colorMode={colorMode}
            onCycleTheme={cycleTheme}
            onToggleColorMode={() => setColorMode((c) => (c === "us" ? "cn" : "us"))}
            onOpenCommandPalette={() => setCmdOpen(true)}
            onGoInvest={() => navigate("invest")}
          />
        )}

        {/* Global In-App Reader Drawer */}
        <ReaderDrawer
          target={readerTarget}
          onClose={() => setReaderTarget(null)}
          onArchived={(path) => {
            void refreshCore();
            notify(`已归档到本地：${path}`);
          }}
          onAskAi={(p) => askAi(p)}
          onNotify={notify}
        />

        {/* Global Raycast/Linear Command Palette (Cmd+K) */}
        <CommandPalette
          open={cmdOpen}
          onOpenChange={setCmdOpen}
          indexedFiles={health?.indexed_files ?? vaultFiles.length}
          vaultFiles={vaultFiles}
          tasks={tasks}
          scripts={today?.scripts ?? []}
          watchlist={watchlist}
          theme={theme}
          colorMode={colorMode}
          onNavigate={navigate}
          onOpenWiki={openWikiPath}
          onOpenStock={openInvestSymbol}
          onSelectTheme={setTheme}
          onSelectColorMode={setColorMode}
          onRefresh={refreshCore}
          onNotify={notify}
        />

        {/* Toast */}
        {toast && (
          <div
            role="status"
            className={`fixed bottom-8 right-4 z-50 rounded-lg border px-3.5 py-2 text-xs shadow-lg rb-enter ${
              toast.tone === "err"
                ? "border-down/50 bg-card text-down"
                : "border-primary/40 bg-card text-foreground"
            }`}
          >
            {toast.msg}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export default App;

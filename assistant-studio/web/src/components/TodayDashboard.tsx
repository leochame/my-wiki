import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Briefcase,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  ListPlus,
  Mail,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Terminal,
  TrendingUp,
} from "lucide-react";
import { createTask, getScriptStatus, runScript } from "@/lib/api";
import { displayTime, errorMessage, moneyUsd, signedUsd } from "@/lib/format";
import type { ScriptRunRecord, TaskRecord, TodayResponse } from "@/types";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { RollingNumber } from "@/components/reactbits/RollingNumber";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MarkdownView } from "@/components/MarkdownView";
import { TasksView } from "@/components/TasksView";
import { ScriptConfigDialog } from "@/components/ScriptConfigDialog";
import type { ReaderTarget } from "./ReaderDrawer";

interface TodayDashboardProps {
  today: TodayResponse | null;
  tasks: TaskRecord[];
  loadError?: string | null;
  investReady: boolean;
  onRefresh: () => Promise<void>;
  onOpenWiki: (path: string) => void;
  onOpenReader: (target: ReaderTarget) => void;
  onGoInvest: () => void;
  onAskAi?: (prompt: string, contextPaths?: string[]) => void;
  onNotify: (msg: string, tone?: "ok" | "err") => void;
}

const PRIMARY_SCRIPT_KEYS = new Set(["today", "finance_brief"]);

function companyToneClass(company: string): string {
  const c = company.toLowerCase();
  if (c.includes("booking")) return "border-sky-500/40 text-sky-600 dark:text-sky-400";
  if (c.includes("nvidia")) return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
  if (c.includes("amazon")) return "border-amber-500/40 text-amber-600 dark:text-amber-400";
  if (c.includes("airbnb")) return "border-rose-500/40 text-rose-600 dark:text-rose-400";
  if (c.includes("coupang")) return "border-violet-500/40 text-violet-600 dark:text-violet-400";
  if (c.includes("intel")) return "border-cyan-500/40 text-cyan-600 dark:text-cyan-400";
  if (c.includes("ebay")) return "border-orange-500/40 text-orange-600 dark:text-orange-400";
  return "";
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function TodayDashboard({
  today,
  tasks,
  loadError,
  investReady,
  onRefresh,
  onOpenWiki,
  onOpenReader,
  onGoInvest,
  onAskAi,
  onNotify,
}: TodayDashboardProps) {
  // Per-script concurrent non-blocking execution state
  const [busyScripts, setBusyScripts] = useState<Set<string>>(() => new Set());
  const [serverRunning, setServerRunning] = useState<string[]>([]);
  const [inspectRun, setInspectRun] = useState<ScriptRunRecord | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  // Collapsible recent script runs inside Script Runner (collapsed by default)
  const [runsExpanded, setRunsExpanded] = useState(false);
  // Collapsible major lower modules (persisted in localStorage)
  const [briefCollapsed, setBriefCollapsed] = useState<boolean>(
    () => localStorage.getItem("mywiki.today.briefCollapsed") === "1",
  );
  // Company filter inside Jobs Watch panel
  const [selectedJobCompany, setSelectedJobCompany] = useState<string>("all");
  // Gmail panel quick filter, promo hiding & expanded mail preview
  const [gmailQuery, setGmailQuery] = useState("");
  const [hidePromoMail, setHidePromoMail] = useState(false);
  const [expandedMailId, setExpandedMailId] = useState<string | null>(null);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);

  useEffect(() => {
    setServerRunning(today?.running_scripts ?? []);
  }, [today?.running_scripts]);

  useEffect(() => {
    if (busyScripts.size === 0 && serverRunning.length === 0) return;
    const timer = window.setInterval(() => {
      void getScriptStatus()
        .then((res) => setServerRunning(res.running))
        .catch(() => {});
    }, 2000);
    return () => window.clearInterval(timer);
  }, [busyScripts.size, serverRunning.length]);

  const isScriptRunning = (key: string) =>
    busyScripts.has(key) || serverRunning.includes(key);

  const activeCount = new Set([...busyScripts, ...serverRunning]).size;

  const handleRunScript = async (
    key: string,
    label: string,
    openLogOnFinish = false,
  ) => {
    if (isScriptRunning(key)) return;
    setBusyScripts((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    try {
      const rec = await runScript(key);
      if (rec.status === "ok") {
        onNotify(`脚本「${label}」执行完成 (${rec.duration_ms ?? 0}ms)`);
      } else {
        onNotify(`脚本「${label}」返回异常退出码 (${rec.exit_code ?? -1})`, "err");
      }
      if (openLogOnFinish || rec.status !== "ok") {
        setInspectRun(rec);
      }
      await onRefresh();
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setBusyScripts((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Convert an unread Gmail item directly into a local Vault task (Direction 3)
  const handleMailToTask = async (m: {
    id: string;
    subject: string;
    sender: string;
    date: string;
    snippet: string;
    url: string;
  }) => {
    const key = `mail-${m.id}`;
    setBusyActionKey(key);
    try {
      const created = await createTask({
        title: `跟进邮件：${m.subject}`.slice(0, 90),
        source: "by_task",
        due: addDaysIso(1),
        priority: "medium",
        category: "personal",
        description: `发件人：${m.sender}\n时间：${m.date}\n链接：${m.url}\n\n摘要：${m.snippet}`,
      });
      await onRefresh();
      onNotify(`已转为待办任务 ${created.id}（落盘：${created.file_path}）`);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setBusyActionKey(null);
    }
  };

  // Convert a job opening directly into a local career application task (Direction 3)
  const handleJobToTask = async (job: {
    company: string;
    title: string;
    url: string;
    location?: string | null;
    team?: string | null;
  }) => {
    const key = `job-${job.url}`;
    setBusyActionKey(key);
    try {
      const created = await createTask({
        title: `投递 ${job.company}：${job.title}`.slice(0, 95),
        source: "by_task",
        due: addDaysIso(3),
        priority: "high",
        category: "career",
        description: `公司：${job.company}\n地点：${job.location || "China"}\n团队：${job.team || "—"}\n投递链接：${job.url}`,
      });
      await onRefresh();
      onNotify(`已创建投递任务 ${created.id}，已加入看板`);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setBusyActionKey(null);
    }
  };

  // Flatten Gmail unread emails + smart promo filter
  const gmailEmails = useMemo(() => {
    if (!today?.gmail_digest?.accounts) return [];
    return today.gmail_digest.accounts.flatMap((acc) =>
      (acc.emails ?? []).map((mail) => ({
        ...mail,
        accountEmail: mail.account_email || acc.email,
      })),
    );
  }, [today?.gmail_digest]);

  const filteredGmailEmails = useMemo(() => {
    const promoRe =
      /hot deal|save up to|unsubscribe|cash back|promotion|newsletter|word of the day|deals@|marketing@|emails\./i;
    const q = gmailQuery.trim().toLowerCase();
    return gmailEmails.filter((m) => {
      if (hidePromoMail && promoRe.test(`${m.subject} ${m.sender} ${m.snippet}`)) {
        return false;
      }
      if (q) {
        return `${m.subject} ${m.sender} ${m.snippet}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [gmailEmails, gmailQuery, hidePromoMail]);

  // Flatten job watch items
  const jobCompanies = today?.job_watch?.companies ?? [];
  const filteredJobs = useMemo(() => {
    const list: Array<{
      company: string;
      title: string;
      url: string;
      location?: string | null;
      posted_at?: string | null;
      team?: string | null;
      is_new?: boolean;
    }> = [];
    for (const c of jobCompanies) {
      if (selectedJobCompany !== "all" && c.company !== selectedJobCompany) continue;
      for (const j of c.jobs ?? []) {
        list.push({ company: c.company, ...j });
      }
    }
    return list;
  }, [jobCompanies, selectedJobCompany]);

  if (!today) {
    return (
      <div className="py-20 text-center text-xs text-muted-foreground space-y-2.5">
        <div>{loadError ? `加载失败：${loadError}` : "正在加载今日与任务工作台..."}</div>
        {loadError && (
          <Button size="xs" variant="outline" onClick={() => void onRefresh()}>
            <RefreshCw size={11} /> 重新加载
          </Button>
        )}
      </div>
    );
  }

  const ns = today.northstar_account;
  const nsDayPnlNum = ns?.day_pnl ? Number(ns.day_pnl) : 0;
  const unreadCount = today.gmail_digest?.total_unread ?? gmailEmails.length;
  const totalJobs = today.job_watch?.total_jobs ?? 0;
  const newJobs = today.job_watch?.total_new ?? 0;

  const primaryScripts = today.scripts.filter((s) => PRIMARY_SCRIPT_KEYS.has(s.key));
  const utilityScripts = today.scripts.filter((s) => !PRIMARY_SCRIPT_KEYS.has(s.key));

  const toggleBriefCollapsed = () => {
    setBriefCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("mywiki.today.briefCollapsed", next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="w-full pb-3">
      {/* ── Top Flush 4-KPI Strip (1px hairline dividers, crisp tabular-nums) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border-b border-border">
        <SpotlightCard className="px-3 py-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>任务池 · {today.date}</span>
            <CalendarClock size={13} className="text-primary" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-semibold font-mono tabular-nums tracking-tight">
              <RollingNumber value={today.total_open_count} format={(v) => String(Math.round(v))} />
            </span>
            <span className="text-[11px] text-muted-foreground">未完成</span>
            {today.overdue.length > 0 ? (
              <Badge variant="down" className="text-[10px] py-0">
                逾期 {today.overdue.length}
              </Badge>
            ) : (
              <Badge variant="up" className="text-[10px] py-0">
                无逾期
              </Badge>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground font-mono">
            今日 {today.due_today.length} · 7天 {today.upcoming_7d.length} · 长期 {today.todo_open_count}
          </div>
        </SpotlightCard>

        <SpotlightCard className="px-3 py-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Gmail 未读邮件</span>
            <Mail size={13} className="text-primary" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-semibold font-mono tabular-nums tracking-tight">
              <RollingNumber value={unreadCount} format={(v) => String(Math.round(v))} />
            </span>
            <span className="text-[11px] text-muted-foreground">封未读</span>
            {today.gmail_digest?.fetched_at && (
              <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
                {displayTime(today.gmail_digest.fetched_at)}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="truncate">
              {today.gmail_digest?.accounts?.[0]?.email ?? "IMAP 只读拉取"}
            </span>
            <button
              type="button"
              disabled={isScriptRunning("gmail")}
              onClick={() => void handleRunScript("gmail", "Gmail 未读邮件")}
              className="text-primary hover:underline cursor-pointer shrink-0"
            >
              {isScriptRunning("gmail") ? "拉取中..." : "立即拉取"}
            </button>
          </div>
        </SpotlightCard>

        <SpotlightCard className="px-3 py-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>目标公司职位</span>
            <Briefcase size={13} className="text-primary" />
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-semibold font-mono tabular-nums tracking-tight">
              <RollingNumber value={totalJobs} format={(v) => String(Math.round(v))} />
            </span>
            <span className="text-[11px] text-muted-foreground">个岗位</span>
            {newJobs > 0 && (
              <Badge variant="up" className="text-[10px] py-0">
                新增 {newJobs}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="truncate">
              {today.job_watch
                ? `${today.job_watch.location || "Global"} · ${jobCompanies.length} 家`
                : "尚未抓取"}
            </span>
            <button
              type="button"
              disabled={isScriptRunning("jobs")}
              onClick={() => void handleRunScript("jobs", "目标公司职位")}
              className="text-primary hover:underline cursor-pointer shrink-0"
            >
              {isScriptRunning("jobs") ? "抓取中..." : "刷新职位"}
            </button>
          </div>
        </SpotlightCard>

        <SpotlightCard className="px-3 py-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>投研总资产（本地账本）</span>
            <TrendingUp size={13} className="text-primary" />
          </div>
          {ns ? (
            <>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-semibold font-mono tabular-nums tracking-tight">
                  {moneyUsd(ns.total_equity)}
                </span>
                {ns.day_pnl != null && (
                  <Badge variant={nsDayPnlNum >= 0 ? "up" : "down"} className="text-[10px] py-0 font-mono">
                    {signedUsd(ns.day_pnl)}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="font-mono">现金 {moneyUsd(ns.cash_balance)}</span>
                <button
                  type="button"
                  onClick={onGoInvest}
                  className="inline-flex items-center gap-0.5 text-primary hover:underline cursor-pointer"
                >
                  进入投研 <ArrowUpRight size={10} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mt-1 text-sm font-medium text-muted-foreground">
                {investReady ? "暂无持仓记录" : "长桥行情未配置"}
              </div>
              <button
                type="button"
                onClick={onGoInvest}
                className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline cursor-pointer"
              >
                打开投研工作台 <ArrowUpRight size={10} />
              </button>
            </>
          )}
        </SpotlightCard>
      </div>

      {/* ── MAJOR MODULE 1 (UP FRONT): Linear Drag-Drop Kanban + 2-Tier Script Command Deck ── */}
      <div className="grid lg:grid-cols-12 gap-px bg-border border-b border-border">
        {/* Left 8 cols: Unified Tasks Kanban (+ WHV strip + collapsible Done rail) */}
        <div className="lg:col-span-8 min-w-0 bg-card">
          <TasksView
            tasks={tasks}
            todayDate={today.date}
            overdueCount={today.overdue.length}
            dueTodayCount={today.due_today.length}
            upcoming7dCount={today.upcoming_7d.length}
            whvLines={today.brief.whv_lines}
            whvAlert={today.brief.whv_alert}
            whvBusy={isScriptRunning("whv")}
            onCheckWhv={() => void handleRunScript("whv", "WHV 窗口检查")}
            onRefresh={onRefresh}
            onOpenWiki={onOpenWiki}
            onNotify={onNotify}
          />
        </div>

        {/* Right 4 cols: Compact 2-Tier Script Command Deck (Direction 2) */}
        <Card data-testid="script-runner-card" className="lg:col-span-4 flex flex-col">
          <CardHeader>
            <div className="flex items-center gap-1.5 min-w-0">
              <CardTitle>脚本调度中心</CardTitle>
              {activeCount > 0 ? (
                <Badge variant="warn" className="text-[10px] py-0 gap-1">
                  <RefreshCw size={9} className="animate-spin" /> {activeCount} 并行
                </Badge>
              ) : (
                <span className="text-[10px] text-muted-foreground">并行不阻塞</span>
              )}
            </div>
            <Button
              size="xs"
              variant="outline"
              onClick={() => setConfigOpen(true)}
              data-testid="open-script-config-btn"
            >
              <Settings2 size={11} /> 配置
            </Button>
          </CardHeader>

          {/* Tier 1: Top 2 Primary Action Hero Tiles */}
          <div className="grid grid-cols-2 gap-px bg-border border-b border-border">
            {primaryScripts.map((sc) => {
              const running = isScriptRunning(sc.key);
              const lastRun = today.recent_runs.find((r) => r.script_key === sc.key);
              return (
                <div
                  key={sc.key}
                  data-script-key={sc.key}
                  title={sc.description}
                  className="flex flex-col justify-between bg-card p-2.5 space-y-2"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold truncate">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            running
                              ? "bg-warn animate-pulse"
                              : lastRun?.status === "ok"
                                ? "bg-up"
                                : lastRun?.status === "error"
                                  ? "bg-down"
                                  : "bg-muted-foreground/40"
                          }`}
                        />
                        <span className="truncate">{sc.label}</span>
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] leading-snug text-muted-foreground line-clamp-1">
                      {sc.description}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {lastRun ? displayTime(lastRun.started_at) : "未运行"}
                    </span>
                    <div className="flex items-center gap-0.5">
                      {lastRun && (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-5 px-1.5 text-[10px]"
                          onClick={() => setInspectRun(lastRun)}
                        >
                          日志
                        </Button>
                      )}
                      <Button
                        size="xs"
                        variant="default"
                        className="h-5 px-2 text-[10px]"
                        disabled={running}
                        onClick={() => void handleRunScript(sc.key, sc.label)}
                      >
                        {running ? (
                          <RefreshCw size={10} className="animate-spin" />
                        ) : (
                          <Play size={10} />
                        )}
                        <span>{running ? "执行中" : "运行"}</span>
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tier 2: Compact Single-Row Command Strips (zero wasted vertical space, zero blank tail tile) */}
          <div className="flex-1 divide-y divide-border/60 bg-card">
            {utilityScripts.map((sc) => {
              const running = isScriptRunning(sc.key);
              const lastRun = today.recent_runs.find((r) => r.script_key === sc.key);
              return (
                <div
                  key={sc.key}
                  data-script-key={sc.key}
                  title={sc.description}
                  className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        running
                          ? "bg-warn animate-pulse"
                          : lastRun?.status === "ok"
                            ? "bg-up"
                            : lastRun?.status === "error"
                              ? "bg-down"
                              : "bg-muted-foreground/40"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate text-foreground">
                        {sc.label}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {lastRun ? displayTime(lastRun.started_at) : "—"}
                    </span>
                    {lastRun && (
                      <Button
                        size="xs"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px]"
                        onClick={() => setInspectRun(lastRun)}
                      >
                        日志
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="outline"
                      className="h-5 px-1.5 text-[10px]"
                      disabled={running}
                      onClick={() => void handleRunScript(sc.key, sc.label)}
                    >
                      {running ? (
                        <RefreshCw size={10} className="animate-spin" />
                      ) : (
                        <Play size={10} />
                      )}
                      <span>{running ? "执行" : "运行"}</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Merged & Collapsible Script Run History Footer */}
          <div className="border-t border-border bg-muted/25">
            <button
              type="button"
              data-testid="toggle-script-runs-btn"
              onClick={() => setRunsExpanded((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/45 hover:text-foreground transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5">
                {runsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Terminal size={11} />
                <span>最近执行记录</span>
                <Badge variant="outline" className="text-[10px] py-0 px-1 font-mono">
                  {today.recent_runs.length}
                </Badge>
              </span>
              <span className="text-[10px]">{runsExpanded ? "收起" : "展开"}</span>
            </button>

            {runsExpanded && (
              <div
                data-testid="script-runs-collapsible-list"
                className="max-h-[160px] overflow-y-auto border-t border-border/80 bg-card divide-y divide-border/60"
              >
                {today.recent_runs.length === 0 ? (
                  <div className="px-3 py-3 text-[11px] text-muted-foreground text-center">
                    暂无执行记录
                  </div>
                ) : (
                  today.recent_runs.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setInspectRun(r)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-muted/40 cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Badge
                          variant={
                            r.status === "ok"
                              ? "up"
                              : r.status === "running"
                                ? "warn"
                                : "down"
                          }
                          className="text-[10px] py-0 px-1"
                        >
                          {r.script_key}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground truncate font-mono tabular-nums">
                          {displayTime(r.started_at, true)}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono tabular-nums shrink-0">
                        {r.duration_ms != null ? `${r.duration_ms}ms` : "运行中"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ── MAJOR MODULE 2 (Subtle vertical gap above): Actionable Gmail + China Job Watch Panels ── */}
      <div className="mt-2.5 border-t border-b border-border grid lg:grid-cols-12 gap-px bg-border">
        {/* Left 6 cols: Actionable Gmail Unread Panel */}
        <Card data-testid="today-gmail-panel" className="lg:col-span-6 flex flex-col">
          <CardHeader>
            <div className="flex items-center gap-2 min-w-0">
              <CardTitle>
                <Mail size={13} className="text-primary" />
                Gmail 未读邮件
              </CardTitle>
              <Badge variant={unreadCount > 0 ? "warn" : "outline"} className="text-[10px] py-0 font-mono">
                {unreadCount} 封
              </Badge>
              {today.gmail_digest?.fetched_at && (
                <span className="text-[10px] text-muted-foreground font-mono tabular-nums truncate">
                  {displayTime(today.gmail_digest.fetched_at)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {gmailEmails.length > 0 && onAskAi && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    onAskAi(
                      `请帮我快速筛选下面 ${gmailEmails.length} 封未读邮件，标出需要立刻回复/处理的重要邮件与可忽略的推广邮件：\n\n` +
                        gmailEmails
                          .slice(0, 15)
                          .map(
                            (m, i) =>
                              `${i + 1}. [${m.date}] ${m.subject} — ${m.sender}\n   摘要: ${m.snippet}`,
                          )
                          .join("\n"),
                    )
                  }
                >
                  <Bot size={11} /> AI 筛选
                </Button>
              )}
              <Button
                size="xs"
                variant="outline"
                disabled={isScriptRunning("gmail")}
                onClick={() => void handleRunScript("gmail", "Gmail 未读邮件")}
              >
                <RefreshCw size={11} className={isScriptRunning("gmail") ? "animate-spin" : ""} />
                {isScriptRunning("gmail") ? "拉取中" : "拉取未读"}
              </Button>
            </div>
          </CardHeader>

          {gmailEmails.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-b border-border/80 bg-muted/15 px-3 py-1.5 text-[11px]">
              <div className="relative flex-1 max-w-[260px]">
                <Search
                  size={11}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={gmailQuery}
                  onChange={(e) => setGmailQuery(e.target.value)}
                  placeholder="搜索主题 / 发件人..."
                  className="h-6 pl-6 text-[11px] bg-card"
                />
              </div>
              <button
                type="button"
                data-testid="toggle-hide-promo-mail"
                onClick={() => setHidePromoMail((v) => !v)}
                className={`rounded px-2 py-0.5 text-[10px] transition-colors cursor-pointer ${
                  hidePromoMail
                    ? "bg-primary text-primary-foreground font-medium"
                    : "bg-muted/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {hidePromoMail
                  ? `已隐藏推广 (${filteredGmailEmails.length}/${gmailEmails.length})`
                  : "隐藏推广邮件"}
              </button>
            </div>
          )}

          <CardContent className="p-0 flex-1">
            {!today.gmail_digest ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground space-y-2">
                <div>尚未拉取 Gmail 未读邮件。</div>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={isScriptRunning("gmail")}
                  onClick={() => void handleRunScript("gmail", "Gmail 未读邮件")}
                >
                  <Mail size={11} /> 立即拉取未读邮件
                </Button>
              </div>
            ) : filteredGmailEmails.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                {gmailEmails.length === 0
                  ? `收件箱当前没有未读邮件（${today.gmail_digest.accounts?.[0]?.email ?? "Gmail"}）。`
                  : "当前筛选条件下没有匹配的未读邮件。"}
              </div>
            ) : (
              <div className="max-h-[320px] overflow-y-auto divide-y divide-border/60">
                {filteredGmailEmails.map((m) => {
                  const rowKey = `${m.accountEmail}-${m.id}`;
                  const expanded = expandedMailId === rowKey;
                  const converting = busyActionKey === `mail-${m.id}`;
                  return (
                    <div
                      key={rowKey}
                      className="group px-3 py-2 hover:bg-muted/30 transition-colors space-y-0.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setExpandedMailId(expanded ? null : rowKey)}
                          className="min-w-0 flex-1 text-left text-xs font-medium text-foreground hover:text-primary leading-snug line-clamp-1 cursor-pointer"
                        >
                          {m.subject}
                        </button>
                        <span className="font-mono text-[10px] text-muted-foreground shrink-0 tabular-nums">
                          {m.date}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">{m.sender}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={converting}
                            onClick={() => void handleMailToTask(m)}
                            title="将此邮件转为看板待办任务"
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-primary transition-colors cursor-pointer"
                          >
                            <ListPlus size={10} /> {converting ? "创建中" : "转待办"}
                          </button>
                          <a
                            href={m.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline"
                          >
                            打开 <ExternalLink size={9} />
                          </a>
                        </div>
                      </div>
                      {m.snippet && (
                        <p
                          className={`text-[11px] text-muted-foreground/90 leading-relaxed ${
                            expanded ? "" : "line-clamp-2"
                          }`}
                        >
                          {m.snippet}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right 6 cols: Actionable Mainland China Job Watch Panel */}
        <Card data-testid="today-jobs-panel" className="lg:col-span-6 flex flex-col">
          <CardHeader>
            <div className="flex items-center gap-2 min-w-0">
              <CardTitle>
                <Briefcase size={13} className="text-primary" />
                目标公司职位监控
              </CardTitle>
              <Badge variant="outline" className="text-[10px] py-0 font-mono">
                {totalJobs} 个岗位
              </Badge>
              {newJobs > 0 && (
                <Badge variant="up" className="text-[10px] py-0 font-mono">
                  NEW {newJobs}
                </Badge>
              )}
              {today.job_watch?.generated_at && (
                <span className="text-[10px] text-muted-foreground font-mono tabular-nums truncate">
                  {displayTime(today.job_watch.generated_at)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => onOpenWiki("job-search/companies/latest-job-watch.md")}
                title="在文档工作室打开完整 Markdown 职位报告"
              >
                <FileText size={11} /> 报告
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={isScriptRunning("jobs")}
                onClick={() => void handleRunScript("jobs", "目标公司职位")}
              >
                <RefreshCw size={11} className={isScriptRunning("jobs") ? "animate-spin" : ""} />
                {isScriptRunning("jobs") ? "抓取中" : "刷新职位"}
              </Button>
            </div>
          </CardHeader>

          {jobCompanies.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-b border-border/80 bg-muted/15 px-3 py-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setSelectedJobCompany("all")}
                className={`rounded px-2 py-0.5 cursor-pointer ${
                  selectedJobCompany === "all"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                全部 ({totalJobs})
              </button>
              {jobCompanies.map((c) => (
                <button
                  key={c.company}
                  type="button"
                  onClick={() => setSelectedJobCompany(c.company)}
                  className={`rounded px-2 py-0.5 cursor-pointer inline-flex items-center gap-1 ${
                    selectedJobCompany === c.company
                      ? "bg-primary text-primary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="capitalize">{c.company}</span>
                  <span className="font-mono text-[10px]">({c.jobs?.length ?? 0})</span>
                </button>
              ))}
              {(today.job_watch?.location || today.job_watch?.keyword) && (
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {today.job_watch.location ? `loc:${today.job_watch.location}` : ""}
                  {today.job_watch.keyword ? ` · kw:${today.job_watch.keyword}` : ""}
                </span>
              )}
            </div>
          )}

          <CardContent className="p-0 flex-1">
            {!today.job_watch ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground space-y-2">
                <div>尚未运行目标公司职位抓取脚本。</div>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={isScriptRunning("jobs")}
                  onClick={() => void handleRunScript("jobs", "目标公司职位")}
                >
                  <Briefcase size={11} /> 立即搜索目标公司职位
                </Button>
              </div>
            ) : filteredJobs.length === 0 ? (
              <div className="px-4 py-6 text-xs text-muted-foreground space-y-1.5">
                <div>当前筛选下暂无结构化职位。</div>
                {jobCompanies
                  .filter(
                    (c) =>
                      (selectedJobCompany === "all" || c.company === selectedJobCompany) &&
                      c.warning,
                  )
                  .map((c) => (
                    <div key={c.company} className="text-[11px] rounded bg-muted/40 px-2.5 py-1.5">
                      <b className="capitalize">{c.company}</b>：{c.warning}
                      {c.source_url && (
                        <a
                          href={c.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1.5 text-primary hover:underline"
                        >
                          查看官网 ↗
                        </a>
                      )}
                    </div>
                  ))}
              </div>
            ) : (
              <div className="max-h-[320px] overflow-y-auto divide-y divide-border/60">
                {filteredJobs.map((job, idx) => {
                  const converting = busyActionKey === `job-${job.url}`;
                  return (
                    <div
                      key={`${job.company}-${job.url}-${idx}`}
                      className="group px-3 py-2 hover:bg-muted/30 transition-colors space-y-0.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-foreground hover:text-primary leading-snug line-clamp-1"
                        >
                          {job.is_new && (
                            <Badge variant="up" className="mr-1.5 text-[9px] py-0 px-1 align-middle">
                              NEW
                            </Badge>
                          )}
                          {job.title}
                        </a>
                        <Badge
                          variant="outline"
                          className={`text-[10px] py-0 px-1.5 capitalize shrink-0 ${companyToneClass(job.company)}`}
                        >
                          {job.company}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                          {job.location && <span>{job.location}</span>}
                          {job.team && <span className="font-mono opacity-80">{job.team}</span>}
                          {job.posted_at && <span className="font-mono">{job.posted_at}</span>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={converting}
                            onClick={() => void handleJobToTask(job)}
                            title="加入看板作为投递任务"
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-primary transition-colors cursor-pointer"
                          >
                            <ListPlus size={10} /> {converting ? "添加中" : "转任务"}
                          </button>
                          {onAskAi && (
                            <button
                              type="button"
                              onClick={() =>
                                onAskAi(
                                  `请结合我本地 career-development/ 下的简历与背景，评估我与下面这个岗位的匹配度，并给出针对性的简历亮点与面试准备建议：\n- 公司：${job.company}\n- 岗位：${job.title}\n- 地点：${job.location || "China"}\n- 链接：${job.url}`,
                                  ["career-development/INDEX.md"],
                                )
                              }
                              title="调用 AI 助理结合本地简历评估岗位匹配度"
                              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-primary transition-colors cursor-pointer"
                            >
                              <Bot size={10} /> AI 匹配
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── MAJOR MODULE 3 (Subtle vertical gap above, collapsible): AI Financial Brief + Auto-Gmail ── */}
      <div className="mt-2.5 border-t border-b border-border">
        <Card data-testid="today-finance-brief-card">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="toggle-finance-brief-btn"
                onClick={toggleBriefCollapsed}
                className="inline-flex items-center gap-1 text-foreground hover:text-primary cursor-pointer"
                title={briefCollapsed ? "展开金融简报" : "收起金融简报"}
              >
                {briefCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                <CardTitle>
                  <Sparkles size={13} className="text-primary" />
                  AI 金融订阅简报 & 自动发邮件
                </CardTitle>
              </button>
              {today.finance_summary && (
                <Badge variant="outline" className="text-[10px] py-0 font-mono">
                  {today.finance_summary.item_count} 条金融源 ·{" "}
                  {displayTime(today.finance_summary.generated_at)}
                </Badge>
              )}
              {today.finance_summary?.mailed_to && (
                <Badge variant="up" className="text-[10px] py-0 gap-1">
                  <Mail size={10} /> 已发至 {today.finance_summary.mailed_to}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button size="xs" variant="ghost" onClick={() => onOpenWiki("task/today.md")}>
                <FileText size={11} /> today.md
              </Button>
              {today.finance_summary && onAskAi && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    onAskAi(
                      `请结合这份今日金融订阅简报，帮我进一步拆解对美股科技/AI 与我关注方向的潜在影响：\n\n${today.finance_summary!.markdown}`,
                    )
                  }
                >
                  <Bot size={11} /> 深聊
                </Button>
              )}
              <Button
                size="xs"
                variant="outline"
                disabled={isScriptRunning("finance_brief")}
                onClick={() =>
                  void handleRunScript("finance_brief", "金融资讯 AI 简报 & 发邮件")
                }
              >
                <RefreshCw
                  size={11}
                  className={isScriptRunning("finance_brief") ? "animate-spin" : ""}
                />
                {isScriptRunning("finance_brief")
                  ? "总结并发送中..."
                  : today.finance_summary
                    ? "重新总结并发送"
                    : "生成简报并发送"}
              </Button>
            </div>
          </CardHeader>
          {!briefCollapsed && (
            <CardContent className="p-3">
              {today.finance_summary ? (
                <div className="max-h-[420px] overflow-y-auto pr-1">
                  <MarkdownView
                    text={today.finance_summary.markdown}
                    onOpenWikilink={onOpenWiki}
                    onOpenUrl={(url, title) => onOpenReader({ url, title })}
                  />
                </div>
              ) : (
                <div className="py-4 text-xs text-muted-foreground">
                  点击右上角 <strong>「生成简报并发送」</strong>，系统会自动刷新 21 路金融订阅、调用 Claude Agent 总结写入{" "}
                  <code>task/today.md</code>，并自动发送至配置的 Gmail。
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>

      {/* Script Settings Dialog */}
      <ScriptConfigDialog open={configOpen} onOpenChange={setConfigOpen} onNotify={onNotify} />

      {/* Script output log modal */}
      <Dialog open={inspectRun !== null} onOpenChange={(o) => !o && setInspectRun(null)}>
        <DialogContent
          title={inspectRun ? `脚本日志 · ${inspectRun.script_key}` : "脚本日志"}
          className="w-[min(720px,calc(100%-24px))]"
        >
          {inspectRun && (
            <div className="space-y-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <Badge variant={inspectRun.status === "ok" ? "up" : "down"}>
                  {inspectRun.status} (exit {inspectRun.exit_code ?? "—"})
                </Badge>
                <span>耗时 {inspectRun.duration_ms ?? 0}ms</span>
                <span>开始于 {displayTime(inspectRun.started_at, true)}</span>
              </div>
              <div className="rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-[11px] break-all">
                {inspectRun.command}
              </div>
              <pre className="max-h-[380px] overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                {inspectRun.output_log || "(无标准输出)"}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Columns3,
  FileText,
  Globe2,
  GripVertical,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { createTask, promoteTask, resyncTasks, updateTask } from "@/lib/api";
import { errorMessage, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/format";
import type { TaskRecord } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface TasksViewProps {
  tasks: TaskRecord[];
  todayDate?: string;
  overdueCount?: number;
  dueTodayCount?: number;
  upcoming7dCount?: number;
  whvLines?: string[];
  whvAlert?: boolean;
  whvBusy?: boolean;
  onCheckWhv?: () => void;
  onRefresh: () => Promise<void>;
  onOpenWiki: (path: string) => void;
  onNotify: (msg: string, tone?: "ok" | "err") => void;
}

const KANBAN_COLS = [
  { key: "todo", label: "待办", dot: "bg-muted-foreground/60" },
  { key: "in-progress", label: "进行中", dot: "bg-primary" },
  { key: "waiting", label: "等待中", dot: "bg-warn" },
  { key: "done", label: "已完成", dot: "bg-up" },
] as const;

const STATUS_CYCLE = ["todo", "in-progress", "waiting", "done"] as const;

function priorityBorderClass(priority: string): string {
  if (priority === "urgent" || priority === "high") return "border-l-down";
  if (priority === "medium") return "border-l-warn";
  return "border-l-border";
}

export function TasksView({
  tasks,
  todayDate,
  overdueCount = 0,
  dueTodayCount = 0,
  upcoming7dCount = 0,
  whvLines = [],
  whvAlert = false,
  whvBusy = false,
  onCheckWhv,
  onRefresh,
  onOpenWiki,
  onNotify,
}: TasksViewProps) {
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [sourceFilter, setSourceFilter] = useState<"all" | "by_task" | "todo">("all");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Collapsible Done column (collapsed by default so active columns get maximum horizontal space)
  const [doneCollapsed, setDoneCollapsed] = useState<boolean>(
    () => localStorage.getItem("mywiki.kanban.doneCollapsed") !== "0",
  );

  // HTML5 Drag & Drop state
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  // Create task dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newSource, setNewSource] = useState<"by_task" | "todo">("by_task");
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [newCategory, setNewCategory] = useState("personal");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Promote NT -> T dialog state
  const [promoteTarget, setPromoteTarget] = useState<TaskRecord | null>(null);
  const [promoteDue, setPromoteDue] = useState("");
  const [promotePriority, setPromotePriority] = useState("medium");
  const [promoting, setPromoting] = useState(false);

  // Inline Edit Task dialog state
  const [editTarget, setEditTarget] = useState<TaskRecord | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editStatus, setEditStatus] = useState("todo");
  const [editDue, setEditDue] = useState("");
  const [editPriority, setEditPriority] = useState("medium");
  const [editCategory, setEditCategory] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const toggleDoneCollapsed = () => {
    setDoneCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("mywiki.kanban.doneCollapsed", next ? "1" : "0");
      return next;
    });
  };

  const openEditDialog = (t: TaskRecord) => {
    setEditTarget(t);
    setEditTitle(t.title);
    setEditStatus(t.status);
    setEditDue(t.due ?? "");
    setEditPriority(t.priority || "medium");
    setEditCategory(t.category || "personal");
  };

  const handleSaveEdit = async () => {
    if (!editTarget || !editTitle.trim()) return;
    setSavingEdit(true);
    try {
      await updateTask(editTarget.id, {
        title: editTitle.trim(),
        status: editStatus,
        due: editTarget.source === "by_task" ? editDue.trim() : undefined,
        priority: editPriority,
        category: editCategory.trim() || "personal",
      });
      setEditTarget(null);
      await onRefresh();
      onNotify(`已保存 ${editTarget.id} 并写回本地 Markdown`);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setSavingEdit(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (sourceFilter !== "all" && t.source !== sourceFilter) return false;
      if (q) {
        const hay = `${t.id} ${t.title} ${t.category} ${t.notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, sourceFilter, query]);

  const handleResync = async () => {
    setSyncing(true);
    try {
      await resyncTasks();
      await onRefresh();
      onNotify("已重新扫描 task/by-task 与 task/TODO.md 并同步到 SQLite");
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdate = async (
    id: string,
    patch: { status?: string; priority?: string; due?: string },
  ) => {
    setBusyId(id);
    try {
      await updateTask(id, patch);
      await onRefresh();
      onNotify(`已更新 ${id} 并原子写回本地 Markdown`);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setBusyId(null);
    }
  };

  const handleCycleStatus = (t: TaskRecord) => {
    const idx = STATUS_CYCLE.indexOf(t.status as (typeof STATUS_CYCLE)[number]);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    void handleUpdate(t.id, { status: next });
  };

  const handleDropToCol = (targetStatus: string, e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragTaskId;
    setDragOverCol(null);
    setDragTaskId(null);
    if (!id) return;
    const found = tasks.find((t) => t.id === id);
    if (!found || found.status === targetStatus) return;
    void handleUpdate(id, { status: targetStatus });
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const created = await createTask({
        title: newTitle.trim(),
        source: newSource,
        due: newDue.trim() || undefined,
        priority: newPriority,
        category: newCategory.trim() || "personal",
        notes: newDesc.trim() || undefined,
        description: newDesc.trim() || undefined,
      });
      setCreateOpen(false);
      setNewTitle("");
      setNewDue("");
      setNewDesc("");
      await onRefresh();
      onNotify(`已创建 ${created.id}（落盘：${created.file_path}）`);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setCreating(false);
    }
  };

  const handlePromote = async () => {
    if (!promoteTarget || !promoteDue.trim()) return;
    setPromoting(true);
    try {
      const created = await promoteTask(promoteTarget.id, {
        due: promoteDue.trim(),
        priority: promotePriority,
      });
      setPromoteTarget(null);
      setPromoteDue("");
      await onRefresh();
      onNotify(`已将 ${promoteTarget.id} 升级为 ${created.id} (${created.file_path})`);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setPromoting(false);
    }
  };

  const isOverdue = (t: TaskRecord) =>
    Boolean(
      todayDate &&
        t.due &&
        t.due < todayDate &&
        t.status !== "done" &&
        t.status !== "cancelled",
    );

  const doneCount = filtered.filter((t) => t.status === "done" || t.status === "cancelled").length;

  return (
    <section data-testid="unified-tasks-module" className="flex flex-col bg-card min-w-0 h-full">
      {/* Compact Flush Toolbar with subtle surface contrast */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5 min-h-9">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h2 className="text-xs font-semibold tracking-tight text-foreground shrink-0">
            任务看板
          </h2>
          {overdueCount > 0 && (
            <Badge variant="down" className="text-[10px] py-0 gap-0.5">
              <AlertTriangle size={10} /> 逾期 {overdueCount}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] py-0 font-mono">
            今日 {dueTodayCount} · 7天 {upcoming7dCount}
          </Badge>

          <div className="relative w-36 sm:w-44">
            <Search
              size={11}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="筛选 ID / 标题..."
              className="h-6 pl-6 text-[11px] bg-card"
            />
          </div>

          <div className="inline-flex rounded border border-border bg-card p-0.5 text-[11px]">
            {(
              [
                ["all", `全部 ${tasks.length}`],
                ["by_task", `期限 ${tasks.filter((t) => t.source === "by_task").length}`],
                ["todo", `长期 ${tasks.filter((t) => t.source === "todo").length}`],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSourceFilter(k)}
                className={`rounded-xs px-2 py-0.5 font-medium transition-colors cursor-pointer ${
                  sourceFilter === k
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <div className="inline-flex rounded border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("kanban")}
              className={`inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-[11px] cursor-pointer ${
                viewMode === "kanban"
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground"
              }`}
            >
              <Columns3 size={11} /> 看板
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-[11px] cursor-pointer ${
                viewMode === "list"
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground"
              }`}
            >
              <List size={11} /> 列表
            </button>
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={handleResync}
            disabled={syncing}
            title="重新扫描 task/by-task 与 task/TODO.md"
          >
            <RefreshCw size={11} className={syncing ? "animate-spin" : ""} /> 同步
          </Button>
          <Button size="xs" onClick={() => setCreateOpen(true)}>
            <Plus size={11} /> 新建
          </Button>
        </div>
      </div>

      {/* Integrated WHV / Australia 462 Visa Task Monitor Strip */}
      <div
        data-testid="tasks-whv-strip"
        className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/15 px-3 py-1.5 text-[11px]"
      >
        <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
          <span className="inline-flex items-center gap-1 font-semibold text-foreground shrink-0">
            <Globe2 size={12} className="text-primary" />
            WHV / 462 监控
          </span>
          <Badge variant={whvAlert ? "up" : "outline"} className="text-[10px] py-0 shrink-0">
            {whvAlert ? "名额开放提醒" : "常规监控"}
          </Badge>
          {whvLines.length === 0 ? (
            <span className="text-muted-foreground">暂无记录，点击右侧检查最新开放状态</span>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-foreground/85 min-w-0">
              {whvLines.map((line, idx) => (
                <span key={idx} className="truncate max-w-[440px]" title={line}>
                  {line
                    .replace(/\*\*/g, "")
                    .replace(/^\s*[-*•]+\s*/, "")
                    .replace(/\s+/g, " ")
                    .trim()}
                </span>
              ))}
            </div>
          )}
        </div>
        {onCheckWhv && (
          <Button
            size="xs"
            variant="ghost"
            className="h-6 px-2 text-[11px] shrink-0"
            disabled={whvBusy}
            onClick={onCheckWhv}
          >
            <RefreshCw size={10} className={whvBusy ? "animate-spin" : ""} />
            {whvBusy ? "检查中" : "检查 WHV"}
          </Button>
        )}
      </div>

      {/* Linear-style Drag-and-Drop Kanban with Collapsible Done Rail */}
      {viewMode === "kanban" ? (
        <div
          className={`grid flex-1 grid-cols-1 gap-px bg-border ${
            doneCollapsed
              ? "md:grid-cols-[repeat(3,minmax(0,1fr))_36px]"
              : "sm:grid-cols-2 xl:grid-cols-4"
          }`}
        >
          {KANBAN_COLS.map((col) => {
            const isDoneCol = col.key === "done";
            const colTasks = filtered
              .filter((t) =>
                isDoneCol
                  ? t.status === "done" || t.status === "cancelled"
                  : t.status === col.key,
              )
              .sort((a, b) => (a.due ?? "9999-99-99").localeCompare(b.due ?? "9999-99-99"));

            const isDropTarget = dragOverCol === col.key;

            // Collapsed 36px vertical rail for Done column (also acts as a drop target!)
            if (isDoneCol && doneCollapsed) {
              return (
                <button
                  key={col.key}
                  type="button"
                  data-testid="kanban-done-collapsed-rail"
                  onClick={toggleDoneCollapsed}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverCol("done");
                  }}
                  onDragLeave={() => setDragOverCol((c) => (c === "done" ? null : c))}
                  onDrop={(e) => handleDropToCol("done", e)}
                  title="点击展开「已完成」列，或拖拽任务到此处直接标为完成"
                  className={`hidden md:flex flex-col items-center justify-between py-2.5 px-1 transition-colors cursor-pointer ${
                    isDropTarget
                      ? "bg-up-soft/50 text-up ring-1 ring-inset ring-up/60"
                      : "bg-muted/20 hover:bg-muted/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ChevronLeft size={13} />
                  <div className="writing-vertical flex items-center gap-1.5 text-[11px] font-medium tracking-wide">
                    <span className="h-1.5 w-1.5 rounded-full bg-up" />
                    <span>已完成</span>
                    <span className="font-mono text-[10px] opacity-80">{doneCount}</span>
                  </div>
                  <span className="h-3" />
                </button>
              );
            }

            return (
              <div
                key={col.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverCol !== col.key) setDragOverCol(col.key);
                }}
                onDragLeave={() => setDragOverCol((c) => (c === col.key ? null : c))}
                onDrop={(e) => handleDropToCol(col.key, e)}
                className={`flex flex-col bg-card min-w-0 transition-colors ${
                  isDropTarget ? "bg-primary/5 ring-1 ring-inset ring-primary/40" : ""
                }`}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-border/80 bg-muted/25 px-2.5 py-1.5">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                    <span className={`h-1.5 w-1.5 rounded-full ${col.dot}`} />
                    {col.label}
                  </span>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-mono">
                      {colTasks.length}
                    </Badge>
                    {isDoneCol && (
                      <button
                        type="button"
                        data-testid="kanban-done-collapse-btn"
                        onClick={toggleDoneCollapsed}
                        title="收起「已完成」列，为活跃任务腾出空间"
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                      >
                        <ChevronRight size={12} />
                      </button>
                    )}
                  </div>
                </div>

                <div
                  data-testid={`kanban-col-${col.key}`}
                  className="min-h-[210px] max-h-[340px] flex-1 overflow-y-auto divide-y divide-border/50"
                >
                  {colTasks.length === 0 ? (
                    <div className="flex h-full min-h-[140px] items-center justify-center text-[11px] text-muted-foreground/70">
                      {isDropTarget ? "松手移入此列" : "拖拽任务至此"}
                    </div>
                  ) : (
                    colTasks.map((t) => {
                      const overdue = isOverdue(t);
                      const done = t.status === "done" || t.status === "cancelled";
                      const dragging = dragTaskId === t.id;
                      return (
                        <div
                          key={t.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", t.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDragTaskId(t.id);
                          }}
                          onDragEnd={() => {
                            setDragTaskId(null);
                            setDragOverCol(null);
                          }}
                          className={`group border-l-2 ${priorityBorderClass(t.priority)} px-2 py-2 space-y-1 transition-colors hover:bg-muted/35 ${
                            overdue ? "bg-down-soft/20" : ""
                          } ${dragging ? "opacity-45" : ""}`}
                        >
                          <div className="flex items-start gap-1.5">
                            <span
                              className="mt-0.5 shrink-0 text-muted-foreground/35 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing"
                              title="拖拽切换列"
                            >
                              <GripVertical size={11} />
                            </span>
                            <button
                              type="button"
                              disabled={busyId === t.id}
                              onClick={() =>
                                void handleUpdate(t.id, { status: done ? "todo" : "done" })
                              }
                              title={done ? "重新打开" : "快速标记完成"}
                              className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary cursor-pointer"
                            >
                              {done ? (
                                <CheckCircle2 size={13} className="text-up" />
                              ) : (
                                <Circle size={13} />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenWiki(t.file_path)}
                              className={`min-w-0 flex-1 text-left text-xs font-medium leading-snug hover:text-primary cursor-pointer ${
                                done ? "line-through text-muted-foreground" : "text-foreground"
                              }`}
                            >
                              <span className="mr-1 font-mono text-[10px] text-muted-foreground">
                                {t.id}
                              </span>
                              {t.title}
                            </button>
                          </div>

                          <div className="flex items-center justify-between gap-1 pl-5">
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
                              {t.due && (
                                <span
                                  className={`font-mono ${
                                    overdue ? "text-down font-semibold" : ""
                                  }`}
                                >
                                  {overdue ? `逾期 ${t.due}` : t.due}
                                </span>
                              )}
                              <span className="truncate opacity-80">{t.category || "personal"}</span>
                            </div>

                            {/* Lightweight Linear-style inline actions (replaces heavy native <select>) */}
                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                type="button"
                                disabled={busyId === t.id}
                                onClick={() => handleCycleStatus(t)}
                                title="点击推进状态（或直接拖拽到目标列）"
                                className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                              >
                                {STATUS_LABELS[t.status] ?? t.status} →
                              </button>
                              {t.source === "todo" && (
                                <button
                                  type="button"
                                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-primary cursor-pointer"
                                  onClick={() => {
                                    setPromoteTarget(t);
                                    setPromoteDue(new Date().toISOString().slice(0, 10));
                                    setPromotePriority(t.priority || "medium");
                                  }}
                                  title="升级为带截止日期的 task/by-task/T-*.md"
                                >
                                  <Sparkles size={10} />
                                </button>
                              )}
                              <button
                                type="button"
                                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-primary cursor-pointer"
                                onClick={() => openEditDialog(t)}
                                title={`编辑 ${t.id}（标题 / 截止 / 优先级）`}
                              >
                                <Pencil size={10} />
                              </button>
                              <button
                                type="button"
                                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-primary cursor-pointer"
                                onClick={() => onOpenWiki(t.file_path)}
                                title={`打开 ${t.file_path}`}
                              >
                                <ArrowUpRight size={11} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="min-h-[240px] max-h-[370px] flex-1 overflow-auto bg-card">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-muted/85 backdrop-blur border-b border-border text-[11px] text-muted-foreground">
              <tr>
                <th className="px-2.5 py-1.5 text-left font-medium w-16">ID</th>
                <th className="px-2.5 py-1.5 text-left font-medium">标题</th>
                <th className="px-2.5 py-1.5 text-left font-medium w-24">状态</th>
                <th className="px-2.5 py-1.5 text-left font-medium w-24">截止</th>
                <th className="px-2.5 py-1.5 text-left font-medium w-16">优先</th>
                <th className="px-2.5 py-1.5 text-left font-medium w-20">分类</th>
                <th className="px-2.5 py-1.5 text-right font-medium w-24">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((t) => {
                const done = t.status === "done";
                const overdue = isOverdue(t);
                return (
                  <tr
                    key={t.id}
                    className={`hover:bg-muted/30 ${overdue ? "bg-down-soft/20" : ""}`}
                  >
                    <td className="px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                      {t.id}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyId === t.id}
                          onClick={() =>
                            void handleUpdate(t.id, { status: done ? "todo" : "done" })
                          }
                          className="shrink-0 text-muted-foreground hover:text-primary cursor-pointer"
                        >
                          {done ? (
                            <CheckCircle2 size={13} className="text-up" />
                          ) : (
                            <Circle size={13} />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenWiki(t.file_path)}
                          className={`text-left font-medium hover:text-primary cursor-pointer ${
                            done ? "line-through text-muted-foreground" : ""
                          }`}
                        >
                          {t.title}
                        </button>
                      </div>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <button
                        type="button"
                        disabled={busyId === t.id}
                        onClick={() => handleCycleStatus(t)}
                        className="rounded border border-border/80 bg-muted/30 px-1.5 py-0.5 text-[11px] hover:bg-accent cursor-pointer"
                      >
                        {STATUS_LABELS[t.status] ?? t.status}
                      </button>
                    </td>
                    <td
                      className={`px-2.5 py-1.5 font-mono text-[11px] ${
                        overdue ? "text-down font-semibold" : "text-muted-foreground"
                      }`}
                    >
                      {t.due || "—"}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <Badge
                        variant={
                          t.priority === "urgent" || t.priority === "high"
                            ? "down"
                            : t.priority === "medium"
                              ? "warn"
                              : "outline"
                        }
                        className="text-[10px] py-0"
                      >
                        {PRIORITY_LABELS[t.priority] ?? t.priority}
                      </Badge>
                    </td>
                    <td className="px-2.5 py-1.5 text-muted-foreground">{t.category || "—"}</td>
                    <td className="px-2.5 py-1.5 text-right">
                      <div className="inline-flex items-center gap-0.5">
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-6 px-1.5 text-[10px]"
                          onClick={() => openEditDialog(t)}
                        >
                          <Pencil size={10} />
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="h-6 px-1.5 text-[10px]"
                          onClick={() => onOpenWiki(t.file_path)}
                        >
                          <FileText size={11} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Task Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent title="新建任务（直接写入本地 task/ Markdown）">
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewSource("by_task")}
                className={`rounded-lg border p-2.5 text-left cursor-pointer ${
                  newSource === "by_task"
                    ? "border-primary bg-accent/60"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <div className="font-semibold">期限任务 (T-xxx.md)</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  在 task/by-task/ 创建独立文件
                </div>
              </button>
              <button
                type="button"
                onClick={() => setNewSource("todo")}
                className={`rounded-lg border p-2.5 text-left cursor-pointer ${
                  newSource === "todo"
                    ? "border-primary bg-accent/60"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <div className="font-semibold">长期待办 (NT-xxx)</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  追加到 task/TODO.md 表格
                </div>
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">任务标题 *</label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="例如：整理本周论文阅读笔记"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">截止日期</label>
                <Input
                  type="date"
                  value={newDue}
                  onChange={(e) => setNewDue(e.target.value)}
                  disabled={newSource === "todo"}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">优先级</label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="urgent">紧急</option>
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">分类</label>
                <Input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="personal / work"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">说明 / 备注</label>
              <textarea
                rows={3}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="补充背景、验收标准或相关 [[wikilinks]]..."
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button onClick={handleCreate} disabled={creating || !newTitle.trim()}>
                {creating ? "写入中..." : "创建并落盘"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Task Dialog */}
      <Dialog open={editTarget !== null} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent title={`编辑任务 · ${editTarget?.id ?? ""}`}>
          {editTarget && (
            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">任务标题 *</label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">状态</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="todo">待办</option>
                    <option value="in-progress">进行中</option>
                    <option value="waiting">等待中</option>
                    <option value="done">已完成</option>
                    <option value="cancelled">已取消</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">优先级</label>
                  <select
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="urgent">紧急</option>
                    <option value="high">高</option>
                    <option value="medium">中</option>
                    <option value="low">低</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">截止日期</label>
                  <Input
                    type="date"
                    value={editDue}
                    onChange={(e) => setEditDue(e.target.value)}
                    disabled={editTarget.source === "todo"}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">分类</label>
                  <Input
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    placeholder="personal / work"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => setEditTarget(null)}>
                  取消
                </Button>
                <Button
                  onClick={() => void handleSaveEdit()}
                  disabled={savingEdit || !editTitle.trim()}
                >
                  {savingEdit ? "保存中..." : "保存并写回 Markdown"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Promote NT -> T Dialog */}
      <Dialog open={promoteTarget !== null} onOpenChange={(o) => !o && setPromoteTarget(null)}>
        <DialogContent title={`升级 ${promoteTarget?.id ?? ""} 为期限任务`}>
          {promoteTarget && (
            <div className="space-y-3 text-xs">
              <div className="rounded-md bg-muted/50 p-2.5">
                <div className="font-medium">{promoteTarget.title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  将在 `task/by-task/` 创建新的 `T-xxx.md`，并把 `task/TODO.md` 中原行标记为已完成。
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">截止日期 *</label>
                  <Input
                    type="date"
                    value={promoteDue}
                    onChange={(e) => setPromoteDue(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">优先级</label>
                  <select
                    value={promotePriority}
                    onChange={(e) => setPromotePriority(e.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="urgent">紧急</option>
                    <option value="high">高</option>
                    <option value="medium">中</option>
                    <option value="low">低</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setPromoteTarget(null)}>
                  取消
                </Button>
                <Button onClick={handlePromote} disabled={promoting || !promoteDue.trim()}>
                  {promoting ? "升级中..." : "确认升级"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

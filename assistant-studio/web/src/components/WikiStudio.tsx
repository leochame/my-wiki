import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Bot,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import { createVaultFile, getVaultFile, reindexVault, saveVaultFile } from "@/lib/api";
import { displayTime, errorMessage } from "@/lib/format";
import type { VaultFileDetail, VaultFileRecord } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PlateNoteEditor, type PlateNoteHandle } from "./agentero/PlateNoteEditor";
import { WikiAgentPane } from "./WikiAgentPane";
import type { ReaderTarget } from "./ReaderDrawer";

interface WikiStudioProps {
  files: VaultFileRecord[];
  activePath: string | null;
  onSelectPath: (path: string) => void;
  onRefreshFiles: () => Promise<void>;
  onOpenReader: (target: ReaderTarget) => void;
  onAskAiWithDoc: (path: string, title: string) => void;
  onNotify: (msg: string, tone?: "ok" | "err") => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  file?: VaultFileRecord;
  children: TreeNode[];
}

function buildFileTree(files: VaultFileRecord[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;
    let accum = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accum = accum ? `${accum}/${part}` : part;
      const isLast = i === parts.length - 1;
      if (isLast) {
        current.children.push({
          name: part,
          path: file.path,
          isDir: false,
          file,
          children: [],
        });
      } else {
        let dir = current.children.find((c) => c.isDir && c.name === part);
        if (!dir) {
          dir = { name: part, path: accum, isDir: true, children: [] };
          current.children.push(dir);
        }
        current = dir;
      }
    }
  }

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-CN", { numeric: true });
    });
    for (const n of nodes) {
      if (n.isDir) sortNodes(n.children);
    }
  };
  sortNodes(root.children);
  return root.children;
}

function readStoredPx(key: string, fallback: number, min: number, max: number): number {
  const raw = Number(localStorage.getItem(key));
  if (Number.isFinite(raw) && raw >= min && raw <= max) return raw;
  return fallback;
}

export function WikiStudio({
  files,
  activePath,
  onSelectPath,
  onRefreshFiles,
  onOpenReader,
  onAskAiWithDoc,
  onNotify,
}: WikiStudioProps) {
  const [treeQuery, setTreeQuery] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
    () => new Set(["writing", "notes", "task"]),
  );

  // IDE Layout State: Both sidebars independently collapsible + draggable widths
  const [leftOpen, setLeftOpen] = useState(() => localStorage.getItem("mywiki.ide.leftOpen") !== "0");
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem("mywiki.ide.rightOpen") !== "0");
  const [leftWidth, setLeftWidth] = useState(() => readStoredPx("mywiki.ide.leftW", 240, 170, 420));
  const [rightWidth, setRightWidth] = useState(() => readStoredPx("mywiki.ide.rightW", 410, 280, 680));
  const [rightTab, setRightTab] = useState<"agent" | "meta">("agent");
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);

  // IDE Open Editor Tabs
  const [openTabs, setOpenTabs] = useState<string[]>([]);

  const [detail, setDetail] = useState<VaultFileDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  // Selection bridging between Agentero PlateNoteEditor & Cursor-style WikiAgentPane
  const [selectedText, setSelectedText] = useState("");
  const [quotedSelection, setQuotedSelection] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const editorRef = useRef<PlateNoteHandle | null>(null);

  // Create new document dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newFolder, setNewFolder] = useState("writing");
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    localStorage.setItem("mywiki.ide.leftOpen", leftOpen ? "1" : "0");
  }, [leftOpen]);

  useEffect(() => {
    localStorage.setItem("mywiki.ide.rightOpen", rightOpen ? "1" : "0");
  }, [rightOpen]);

  useEffect(() => {
    localStorage.setItem("mywiki.ide.leftW", String(leftWidth));
  }, [leftWidth]);

  useEffect(() => {
    localStorage.setItem("mywiki.ide.rightW", String(rightWidth));
  }, [rightWidth]);

  // Mouse drag resize handlers for IDE panes
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (dragging === "left") {
        setLeftWidth(Math.max(170, Math.min(420, e.clientX)));
      } else {
        setRightWidth(Math.max(280, Math.min(680, window.innerWidth - e.clientX)));
      }
    };
    const onUp = () => setDragging(null);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const filteredFiles = useMemo(() => {
    const q = treeQuery.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) => f.path.toLowerCase().includes(q) || f.title.toLowerCase().includes(q),
    );
  }, [files, treeQuery]);

  const tree = useMemo(() => buildFileTree(filteredFiles), [filteredFiles]);

  // Track open tabs & expand ancestor folders when activePath changes
  useEffect(() => {
    if (!activePath) return;
    setOpenTabs((prev) => (prev.includes(activePath) ? prev : [...prev, activePath]));
    const parts = activePath.split("/");
    if (parts.length > 1) {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        let acc = "";
        for (let i = 0; i < parts.length - 1; i++) {
          acc = acc ? `${acc}/${parts[i]}` : parts[i];
          next.add(acc);
        }
        return next;
      });
    }
  }, [activePath]);

  // Select default file on mount
  useEffect(() => {
    if (!activePath && files.length > 0) {
      const home = files.find((f) => f.path === "Home.md") ?? files[0];
      onSelectPath(home.path);
    }
  }, [activePath, files, onSelectPath]);

  const fetchActiveDoc = useCallback(
    async (path: string) => {
      setLoadingDoc(true);
      try {
        const d = await getVaultFile(path);
        setDetail(d);
        setDraft(d.content);
        setReloadNonce((n) => n + 1);
      } catch (e) {
        onNotify(errorMessage(e), "err");
      } finally {
        setLoadingDoc(false);
      }
    },
    [onNotify],
  );

  useEffect(() => {
    if (!activePath) return;
    void fetchActiveDoc(activePath);
  }, [activePath, fetchActiveDoc]);

  const dirty = detail !== null && draft !== detail.content;

  const handleSave = useCallback(async () => {
    if (!detail || !dirty || saving) return;
    setSaving(true);
    try {
      const updated = await saveVaultFile(detail.path, draft);
      setDetail(updated);
      setDraft(updated.content);
      onNotify(`已保存 ${updated.path} 并刷新 SQLite FTS 索引`);
      await onRefreshFiles();
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setSaving(false);
    }
  }, [detail, dirty, draft, saving, onNotify, onRefreshFiles]);

  // IDE Keyboard Shortcuts: Cmd+S (Save), Cmd+B (Toggle Left Explorer), Cmd+J (Toggle Right Agent)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void handleSave();
      } else if (k === "b" && !e.shiftKey) {
        // Only hijack Cmd+B for sidebar toggle when focus is NOT inside contentEditable editor
        const active = document.activeElement as HTMLElement | null;
        const inEditor =
          active?.isContentEditable ||
          active?.tagName === "TEXTAREA" ||
          active?.tagName === "INPUT";
        if (!inEditor) {
          e.preventDefault();
          setLeftOpen((v) => !v);
        }
      } else if (k === "j" && !e.shiftKey) {
        e.preventDefault();
        setRightOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);

  const handleCloseTab = (pathToClose: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((p) => p !== pathToClose);
      if (activePath === pathToClose) {
        const idx = prev.indexOf(pathToClose);
        const fallback = next[Math.min(idx, next.length - 1)] ?? null;
        if (fallback) onSelectPath(fallback);
        else {
          setDetail(null);
          setDraft("");
        }
      }
      return next;
    });
  };

  const handleOpenWikilink = useCallback(
    (rawTarget: string) => {
      const clean = rawTarget.replace(/^\.\//, "").trim();
      const targetLower = clean.toLowerCase();
      const outMatch = detail?.outgoing.find(
        (o) =>
          o.resolved_path &&
          (o.target_raw.toLowerCase() === targetLower ||
            o.resolved_path.toLowerCase() === targetLower),
      );
      if (outMatch?.resolved_path) {
        onSelectPath(outMatch.resolved_path);
        return;
      }
      const direct = files.find(
        (f) =>
          f.path.toLowerCase() === targetLower ||
          f.path.toLowerCase() === `${targetLower}.md` ||
          f.path.toLowerCase().endsWith(`/${targetLower}.md`) ||
          f.path.toLowerCase().endsWith(`/${targetLower}`) ||
          f.title.toLowerCase() === targetLower,
      );
      if (direct) {
        onSelectPath(direct.path);
      } else {
        onNotify(`未在 Vault 中找到目标文档：[[${rawTarget}]]`, "err");
      }
    },
    [detail, files, onSelectPath, onNotify],
  );

  const openCreateInFolder = (folder: string) => {
    setNewFolder(folder);
    setCreateOpen(true);
  };

  const handleCreateDoc = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const created = await createVaultFile({
        folder: newFolder.trim() || "notes",
        title: newTitle.trim(),
        tags: [],
        body: newBody.trim() || undefined,
      });
      setCreateOpen(false);
      setNewTitle("");
      setNewBody("");
      await onRefreshFiles();
      onSelectPath(created.path);
      setDetail(created);
      setDraft(created.content);
      setReloadNonce((n) => n + 1);
      setRightOpen(true);
      setRightTab("agent");
      onNotify(`已新建本地文档：${created.path}`);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setCreating(false);
    }
  };

  const handleReindex = async () => {
    setReindexing(true);
    try {
      const res = await reindexVault();
      await onRefreshFiles();
      onNotify(`已刷新目录索引：${res.indexed_files} 篇文档，${res.tasks_count} 项任务`);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setReindexing(false);
    }
  };

  const toggleDir = (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const isSearching = treeQuery.trim().length > 0;
  const lineCount = useMemo(() => (draft ? draft.split("\n").length : 0), [draft]);
  const charCount = draft.length;

  return (
    <div
      data-testid="wiki-ide-workbench"
      className="flex min-h-0 flex-1 w-full flex-col overflow-hidden bg-background"
    >
      {/* Main Full-Bleed 3-Pane IDE Split Row (Zero outer whitespace) */}
      <div className="flex min-h-0 flex-1 w-full overflow-hidden">
        {/* Left IDE Sidebar: File Explorer */}
        {leftOpen && (
          <>
            <aside
              data-testid="ide-left-sidebar"
              style={{ width: `${leftWidth}px` }}
              className="flex min-h-0 shrink-0 flex-col border-r border-border bg-card/50"
            >
              <div className="shrink-0 border-b border-border/80 px-2.5 py-1.5 space-y-1.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    资源管理器
                  </span>
                  <div className="flex items-center gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={handleReindex}
                      disabled={reindexing}
                      title="刷新本地目录"
                    >
                      <RefreshCw size={11} className={reindexing ? "animate-spin" : ""} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => openCreateInFolder("writing")}
                      title="新建文档"
                    >
                      <FilePlus2 size={12} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => setLeftOpen(false)}
                      title="收起左侧栏"
                      aria-label="收起左侧栏"
                    >
                      <PanelLeftClose size={12} />
                    </Button>
                  </div>
                </div>

                <div className="relative">
                  <Search
                    size={11}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    value={treeQuery}
                    onChange={(e) => setTreeQuery(e.target.value)}
                    placeholder="筛选文件..."
                    className="h-6 pl-6 text-[11px] bg-background/80"
                  />
                </div>
              </div>

              <div
                data-testid="wiki-tree-scroll"
                className="min-h-0 flex-1 overflow-y-auto px-1 py-1"
              >
                {tree.length === 0 ? (
                  <div className="py-10 text-center text-xs text-muted-foreground">
                    没有匹配的文件
                  </div>
                ) : (
                  <FileTreeList
                    nodes={tree}
                    depth={0}
                    activePath={activePath}
                    expandedDirs={expandedDirs}
                    forceExpand={isSearching}
                    onToggleDir={toggleDir}
                    onSelectFile={onSelectPath}
                    onCreateInDir={openCreateInFolder}
                  />
                )}
              </div>
            </aside>

            {/* Draggable Splitter: Left <-> Center */}
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={() => setDragging("left")}
              className={`w-1 shrink-0 cursor-col-resize transition-colors hover:bg-primary/40 ${
                dragging === "left" ? "bg-primary/60" : "bg-transparent"
              }`}
              title="拖拽调整左侧目录宽度"
            />
          </>
        )}

        {/* Center IDE Editor Column: Open Tabs + Agentero PlateNote Canvas */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          {/* IDE Tab Bar */}
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-muted/25">
            <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
              {!leftOpen && (
                <button
                  type="button"
                  onClick={() => setLeftOpen(true)}
                  aria-label="展开左侧栏"
                  title="展开左侧文件目录"
                  className="inline-flex h-9 w-8 shrink-0 items-center justify-center border-r border-border text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                >
                  <PanelLeftOpen size={14} />
                </button>
              )}

              {openTabs.map((tabPath) => {
                const isActive = tabPath === activePath;
                const fileName = tabPath.split("/").pop() ?? tabPath;
                const isTabDirty = isActive && dirty;
                return (
                  <div
                    key={tabPath}
                    onClick={() => onSelectPath(tabPath)}
                    title={tabPath}
                    className={`group flex h-9 max-w-[200px] shrink-0 items-center gap-1.5 border-r border-border/80 px-3 text-xs cursor-pointer transition-colors ${
                      isActive
                        ? "bg-background text-foreground font-medium border-t-2 border-t-primary"
                        : "bg-muted/20 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }`}
                  >
                    <FileText
                      size={12}
                      className={`shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                    />
                    <span className="truncate">{fileName}</span>
                    {isTabDirty ? (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn"
                        title="有未保存修改"
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCloseTab(tabPath);
                      }}
                      aria-label={`关闭 ${fileName}`}
                      className="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-60 hover:bg-muted hover:opacity-100 cursor-pointer"
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Right-aligned Editor Actions: Save + Toggle Right Agent Sidebar */}
            <div className="flex shrink-0 items-center gap-1 px-2">
              <Button
                size="sm"
                variant={dirty ? "default" : "ghost"}
                className="h-6 px-2 text-[11px]"
                disabled={!dirty || saving}
                onClick={() => void handleSave()}
              >
                <Save size={11} /> {saving ? "保存中" : "保存 ⌘S"}
              </Button>
              <button
                type="button"
                onClick={() => setRightOpen((v) => !v)}
                aria-label={rightOpen ? "收起右侧 Agent 栏" : "展开右侧 Agent 栏"}
                title={rightOpen ? "收起右侧 Agent 栏 (⌘J)" : "展开右侧 Agent 栏 (⌘J)"}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
              >
                {rightOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
              </button>
            </div>
          </div>

          {/* Unified Agentero PlateNote Editor */}
          {loadingDoc && !detail ? (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              正在读取文档...
            </div>
          ) : !detail ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <span>从左侧资源管理器选择一篇 Markdown 文档开始写作</span>
              <Button size="sm" variant="outline" onClick={() => openCreateInFolder("writing")}>
                <FilePlus2 size={12} /> 新建文档
              </Button>
            </div>
          ) : (
            <PlateNoteEditor
              key={`${detail.path}-${reloadNonce}`}
              ref={editorRef}
              value={draft}
              onChange={setDraft}
              onSelectionChange={setSelectedText}
              onAskAgentSelection={(txt) => {
                setQuotedSelection(txt);
                setRightOpen(true);
                setRightTab("agent");
              }}
              onOpenUrl={(url, title) => onOpenReader({ url, title })}
              onOpenWikilink={handleOpenWikilink}
            />
          )}
        </section>

        {/* Right IDE Sidebar: Cursor-Style Agent + Backlinks */}
        {rightOpen && (
          <>
            {/* Draggable Splitter: Center <-> Right */}
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={() => setDragging("right")}
              className={`w-1 shrink-0 cursor-col-resize transition-colors hover:bg-primary/40 ${
                dragging === "right" ? "bg-primary/60" : "bg-transparent"
              }`}
              title="拖拽调整右侧 Agent 栏宽度"
            />

            <aside
              data-testid="ide-right-sidebar"
              style={{ width: `${rightWidth}px` }}
              className="flex min-h-0 shrink-0 flex-col border-l border-border bg-card/50 overflow-hidden"
            >
              <div className="flex h-9 shrink-0 items-center justify-between gap-1 border-b border-border bg-muted/25 px-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setRightTab("agent")}
                    className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors cursor-pointer ${
                      rightTab === "agent"
                        ? "bg-background text-foreground shadow-xs border border-border/70"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Bot size={12} className="text-primary" />
                    Agent
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightTab("meta")}
                    className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors cursor-pointer ${
                      rightTab === "meta"
                        ? "bg-background text-foreground shadow-xs border border-border/70"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <ArrowLeftRight size={11} />
                    双链
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setRightOpen(false)}
                  aria-label="收起右侧栏"
                  title="收起右侧栏 (⌘J)"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                >
                  <PanelRightClose size={12} />
                </button>
              </div>

              {rightTab === "agent" ? (
                <WikiAgentPane
                  docPath={detail?.path ?? null}
                  docTitle={detail?.title ?? null}
                  vaultFiles={files}
                  dirty={dirty}
                  hasSelection={selectedText.length > 0}
                  quotedSelection={quotedSelection}
                  onClearQuotedSelection={() => setQuotedSelection("")}
                  onSaveDoc={handleSave}
                  onReloadDoc={async () => {
                    if (detail?.path) await fetchActiveDoc(detail.path);
                  }}
                  onInsertAtCursor={(snippet) => editorRef.current?.insertAtCursor(snippet)}
                  onReplaceSelection={(snippet) => editorRef.current?.replaceSelection(snippet)}
                  onAppendToEnd={(snippet) => editorRef.current?.appendToEnd(snippet)}
                  onOpenWiki={handleOpenWikilink}
                  onOpenReader={onOpenReader}
                  onOpenFullAcp={() => {
                    if (detail) onAskAiWithDoc(detail.path, detail.title);
                  }}
                  onNotify={onNotify}
                />
              ) : (
                <div
                  data-testid="wiki-meta-scroll"
                  className="min-h-0 flex-1 overflow-y-auto p-3 space-y-4 text-xs"
                >
                  {detail ? (
                    <>
                      <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5 space-y-1 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">字数</span>
                          <span className="tabular-nums">{detail.word_count}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">修改时间</span>
                          <span className="tabular-nums">{displayTime(detail.mtime)}</span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Link2 size={11} /> 反向链接 (Backlinks)
                          </span>
                          <span>{detail.backlinks.length}</span>
                        </div>
                        {detail.backlinks.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">暂无其他文档引用此页</p>
                        ) : (
                          <div className="space-y-1">
                            {detail.backlinks.map((b, i) => (
                              <button
                                key={`${b.source_path}-${i}`}
                                type="button"
                                onClick={() => onSelectPath(b.source_path)}
                                className="block w-full truncate rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-left font-mono text-[11px] hover:border-primary/50 hover:text-primary cursor-pointer"
                              >
                                {b.source_path}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                          <span>出链 (Outgoing)</span>
                          <span>{detail.outgoing.length}</span>
                        </div>
                        {detail.outgoing.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">本文没有 [[wikilinks]]</p>
                        ) : (
                          <div className="space-y-1">
                            {detail.outgoing.map((o, i) => (
                              <button
                                key={`${o.target_raw}-${i}`}
                                type="button"
                                onClick={() =>
                                  o.resolved_path
                                    ? onSelectPath(o.resolved_path)
                                    : handleOpenWikilink(o.target_raw)
                                }
                                className="flex w-full items-center justify-between gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-left text-[11px] hover:border-primary/50 cursor-pointer"
                              >
                                <span className="truncate">{o.alias || o.target_raw}</span>
                                <Badge
                                  variant={o.resolved_path ? "up" : "outline"}
                                  className="text-[9px] py-0"
                                >
                                  {o.resolved_path ? "已解析" : "未建"}
                                </Badge>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="py-8 text-center text-muted-foreground">选择文档查看双链关系</div>
                  )}
                </div>
              )}
            </aside>
          </>
        )}
      </div>

      {/* Bottom IDE Status Bar */}
      <footer
        data-testid="ide-status-bar"
        className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-muted/40 px-3 text-[10.5px] text-muted-foreground select-none"
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setLeftOpen((v) => !v)}
            className="hover:text-foreground cursor-pointer"
            title="切换左侧文件目录"
          >
            {leftOpen ? "左栏: 开" : "左栏: 关"}
          </button>
          <button
            type="button"
            onClick={() => setRightOpen((v) => !v)}
            className="hover:text-foreground cursor-pointer"
            title="切换右侧 Agent 栏 (⌘J)"
          >
            {rightOpen ? "Agent: 开" : "Agent: 关"}
          </button>
          <span className="truncate font-mono text-foreground/75">
            {detail?.path ?? "未打开文件"}
          </span>
          {dirty ? (
            <span className="text-warn font-medium">● 未保存</span>
          ) : detail ? (
            <span className="text-up">✓ 已同步本地</span>
          ) : null}
        </div>

        <div className="hidden sm:flex items-center gap-3 shrink-0 tabular-nums">
          <span>{lineCount} 行</span>
          <span>{charCount} 字符</span>
          <span>UTF-8</span>
          <span>Markdown · Agentero Plate</span>
          <span className="text-muted-foreground/80">⌘J 右栏 · ⌘F 查找 · ⌘L 问 Agent</span>
        </div>
      </footer>

      {/* Create Document Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent title="在本地目录新建 Markdown 文档">
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">目标文件夹（相对路径）*</label>
              <Input
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                placeholder="例如：writing 或 notes/ideas"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">文档标题 *</label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="例如：2026 年度复盘与目标"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">初始正文（可选）</label>
              <textarea
                rows={4}
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder="支持标准 Markdown、KaTeX 公式与 [[wikilinks]]..."
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button onClick={handleCreateDoc} disabled={creating || !newTitle.trim()}>
                {creating ? "创建中..." : "创建并打开"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FileTreeList({
  nodes,
  depth,
  activePath,
  expandedDirs,
  forceExpand,
  onToggleDir,
  onSelectFile,
  onCreateInDir,
}: {
  nodes: TreeNode[];
  depth: number;
  activePath: string | null;
  expandedDirs: Set<string>;
  forceExpand: boolean;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  onCreateInDir: (dirPath: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => {
        const padLeft = 6 + depth * 13;
        if (node.isDir) {
          const isOpen = forceExpand || expandedDirs.has(node.path);
          return (
            <div key={node.path}>
              <div
                className="group flex items-center justify-between rounded pr-1 hover:bg-muted/60"
                style={{ paddingLeft: `${padLeft}px` }}
              >
                <button
                  type="button"
                  onClick={() => onToggleDir(node.path)}
                  className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left text-[11.5px] text-foreground/85 cursor-pointer"
                >
                  {isOpen ? (
                    <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
                  )}
                  {isOpen ? (
                    <FolderOpen size={13} className="shrink-0 text-primary/80" />
                  ) : (
                    <Folder size={13} className="shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate font-medium">{node.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onCreateInDir(node.path)}
                  title={`在 ${node.path}/ 下新建文档`}
                  className="opacity-0 group-hover:opacity-100 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                >
                  <Plus size={11} />
                </button>
              </div>
              {isOpen && (
                <FileTreeList
                  nodes={node.children}
                  depth={depth + 1}
                  activePath={activePath}
                  expandedDirs={expandedDirs}
                  forceExpand={forceExpand}
                  onToggleDir={onToggleDir}
                  onSelectFile={onSelectFile}
                  onCreateInDir={onCreateInDir}
                />
              )}
            </div>
          );
        }

        const active = node.path === activePath;
        return (
          <button
            key={node.path}
            type="button"
            onClick={() => onSelectFile(node.path)}
            style={{ paddingLeft: `${padLeft + 15}px` }}
            title={node.path}
            className={`flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-[11.5px] transition-colors cursor-pointer ${
              active
                ? "bg-accent text-foreground font-medium"
                : "text-foreground/80 hover:bg-muted/60 hover:text-foreground"
            }`}
          >
            <FileText
              size={12}
              className={`shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
            />
            <span className="truncate">{node.name}</span>
          </button>
        );
      })}
    </div>
  );
}

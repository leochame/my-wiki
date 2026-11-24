import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ListStyleType, toggleList } from "@platejs/list";
import { MarkdownPlugin } from "@platejs/markdown";
import { insertTable } from "@platejs/table";
import {
  Bold,
  ChevronDown,
  ChevronRight,
  Code,
  FileCode2,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Radical,
  Search,
  Sparkles,
  Strikethrough,
  Table,
  X,
} from "lucide-react";
import { ElementApi, KEYS, NodeApi, type TElement, type TRange } from "platejs";
import {
  Plate,
  PlateContent,
  useEditorRef,
  usePlateEditor,
  type PlateEditor,
} from "platejs/react";
import {
  editorClassName,
  editorContainerClassName,
  editorContentClassName,
  editorTextStyle,
} from "./editor-surface";
import { joinNoteFrontmatter, splitNoteFrontmatter } from "./frontmatter";
import { noteFindPlugin, notePlugins } from "./plate-kit";

export interface PlateNoteHandle {
  insertAtCursor: (markdown: string) => void;
  replaceSelection: (markdown: string) => void;
  appendToEnd: (markdown: string) => void;
}

interface PlateNoteEditorProps {
  value: string;
  onChange: (nextFullMarkdown: string) => void;
  onSelectionChange?: (selectedText: string) => void;
  onAskAgentSelection?: (selectedText: string) => void;
  onOpenUrl?: (url: string, title?: string) => void;
  onOpenWikilink?: (target: string) => void;
}

/**
 * Escape unescaped `|` inside Obsidian [[target|alias]] on GFM table rows so remark-gfm
 * doesn't split a wikilink into two table columns, and restore on serialize.
 */
function escapeWikilinksInTables(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      if (!line.trim().startsWith("|")) return line;
      return line.replace(/\[\[([^\]]+)\]\]/g, (m) => m.replace(/(?<!\\)\|/g, "\\|"));
    })
    .join("\n");
}

function unescapeWikilinksInTables(md: string): string {
  return md.replace(/\[\[([^\]]+)\]\]/g, (m) => m.replace(/\\\|/g, "|"));
}

function slateValue(editor: PlateEditor, markdown: string) {
  const cleaned = escapeWikilinksInTables(markdown);
  const source = cleaned.trim() === "" ? "\n" : cleaned;
  try {
    return editor.getApi(MarkdownPlugin).markdown.deserialize(source);
  } catch {
    return [{ children: [{ text: source }], type: KEYS.p }];
  }
}

function markdownOf(editor: PlateEditor): string {
  return unescapeWikilinksInTables(editor.getApi(MarkdownPlugin).markdown.serialize());
}

function findMatches(editor: PlateEditor, search: string): TRange[] {
  const query = search.trim().toLowerCase();
  if (query === "") return [];
  const matches: TRange[] = [];
  for (const [node, path] of editor.api.nodes({
    at: [],
    match: (candidate) => ElementApi.isElement(candidate) && editor.api.isBlock(candidate),
  })) {
    const block = node as TElement;
    if (block.children.some((child) => ElementApi.isElement(child) && editor.api.isBlock(child))) {
      continue;
    }
    const texts = [...NodeApi.texts(block)];
    if (texts.length === 0) continue;
    const bounds: { path: number[]; start: number; end: number }[] = [];
    let pos = 0;
    for (const [text, relative] of texts) {
      bounds.push({ path: [...path, ...relative], start: pos, end: pos + text.text.length });
      pos += text.text.length;
    }
    const content = texts
      .map(([text]) => text.text)
      .join("")
      .toLowerCase();
    let index = content.indexOf(query);
    while (index !== -1) {
      const end = index + query.length;
      const pointAt = (offset: number) => {
        const segment = bounds.find((item) => offset <= item.end) ?? bounds[bounds.length - 1];
        return { offset: offset - (segment?.start ?? 0), path: segment?.path ?? path };
      };
      matches.push({ anchor: pointAt(index), focus: pointAt(end) });
      index = content.indexOf(query, end);
    }
  }
  return matches;
}

/**
 * Unified WYSIWYG Markdown editor ported 1:1 from @poco-ai/agentero-dsh-notes (`PlateNote`)
 * with integrated KaTeX equations, lowlight syntax highlighting, Cmd+F Find/Replace,
 * lossless YAML Front Matter, Source mode toggle, and Cmd+L Cursor-style Agent selection bridge.
 */
export const PlateNoteEditor = forwardRef<PlateNoteHandle, PlateNoteEditorProps>(
  function PlateNoteEditor(
    {
      value,
      onChange,
      onSelectionChange,
      onAskAgentSelection,
      onOpenUrl,
      onOpenWikilink,
    },
    ref,
  ) {
    const initialFm = splitNoteFrontmatter(value);
    const [frontmatterRaw, setFrontmatterRaw] = useState(initialFm.raw);
    const fmRef = useRef(frontmatterRaw);
    fmRef.current = frontmatterRaw;

    const [fmOpen, setFmOpen] = useState(false);
    const [findOpen, setFindOpen] = useState(false);
    const [sourceMode, setSourceMode] = useState(false);
    const [selectedText, setSelectedText] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const editor = usePlateEditor(
      {
        plugins: notePlugins,
        value: (next) => slateValue(next, initialFm.body),
      },
      [],
    );

    const baseline = useRef<string | null>(null);

    useEffect(() => {
      baseline.current = markdownOf(editor);
    }, [editor]);

    const applySnippetToPlate = (markdown: string, mode: "insert" | "replace" | "append") => {
      const clean = markdown.trim();
      if (!clean) return;
      if (sourceMode) {
        const ta = textareaRef.current;
        if (mode === "replace" && ta && ta.selectionStart !== ta.selectionEnd) {
          onChange(`${value.slice(0, ta.selectionStart)}${clean}${value.slice(ta.selectionEnd)}`);
        } else if (mode === "insert" && ta) {
          const start = ta.selectionStart ?? value.length;
          const end = ta.selectionEnd ?? value.length;
          onChange(`${value.slice(0, start)}${clean}${value.slice(end)}`);
        } else {
          onChange(`${value.trimEnd()}\n\n${clean}\n`);
        }
        return;
      }

      const nodes = slateValue(editor, clean);
      editor.tf.focus();
      if (mode === "append") {
        const end = editor.api.end([]);
        if (end) editor.tf.select(end);
        editor.tf.insertNodes(nodes);
      } else if (mode === "replace") {
        if (editor.selection && !editor.api.isCollapsed()) {
          editor.tf.delete();
        }
        editor.tf.insertNodes(nodes);
      } else {
        editor.tf.insertNodes(nodes);
      }
      const next = markdownOf(editor);
      baseline.current = next;
      onChange(joinNoteFrontmatter(fmRef.current, next));
    };

    useImperativeHandle(
      ref,
      () => ({
        insertAtCursor: (md) => applySnippetToPlate(md, "insert"),
        replaceSelection: (md) => applySnippetToPlate(md, "replace"),
        appendToEnd: (md) => applySnippetToPlate(md, "append"),
      }),
      [editor, sourceMode, value],
    );

    const handleToggleSource = () => {
      if (sourceMode) {
        // Re-parse edited raw Markdown back into PlateJS
        const split = splitNoteFrontmatter(value);
        setFrontmatterRaw(split.raw);
        fmRef.current = split.raw;
        const nodes = slateValue(editor, split.body);
        editor.tf.setValue(nodes);
        baseline.current = markdownOf(editor);
      }
      setSourceMode((v) => !v);
    };

    const handleFrontmatterEdit = (nextRaw: string) => {
      setFrontmatterRaw(nextRaw);
      fmRef.current = nextRaw;
      const body = sourceMode ? splitNoteFrontmatter(value).body : markdownOf(editor);
      onChange(joinNoteFrontmatter(nextRaw, body));
    };

    const handleSourceSelect = () => {
      const ta = textareaRef.current;
      if (!ta) return;
      const txt = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
      setSelectedText(txt);
      onSelectionChange?.(txt);
    };

    const fmLineCount = frontmatterRaw ? frontmatterRaw.trim().split("\n").length : 0;

    return (
      <Plate
        editor={editor}
        onChange={() => {
          // Track selection for Cursor-style Cmd+L quote
          const selText = editor.selection ? editor.api.string(editor.selection).trim() : "";
          setSelectedText(selText);
          onSelectionChange?.(selText);

          if (baseline.current === null || sourceMode) return;
          const next = markdownOf(editor);
          if (next === baseline.current) return;
          baseline.current = next;
          onChange(joinNoteFrontmatter(fmRef.current, next));
        }}
      >
        <div
          className="@container/editor relative flex min-h-0 flex-1 flex-col overflow-hidden"
          style={editorTextStyle}
        >
          {/* Agentero-DSH Toolbar */}
          <NoteFormatBar
            sourceMode={sourceMode}
            selectedText={selectedText}
            onToggleSource={handleToggleSource}
            onAskAgentSelection={onAskAgentSelection}
            onFind={() => setFindOpen((v) => !v)}
          />

          {findOpen && !sourceMode ? (
            <FindBar onClose={() => setFindOpen(false)} />
          ) : null}

          {sourceMode ? (
            <textarea
              ref={textareaRef}
              data-testid="wiki-source-textarea"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onSelect={handleSourceSelect}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l" && selectedText) {
                  e.preventDefault();
                  onAskAgentSelection?.(selectedText);
                }
              }}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none overflow-y-auto bg-background/60 px-6 py-4 font-mono text-xs leading-relaxed text-foreground focus:outline-none"
            />
          ) : (
            <div
              data-testid="wiki-unified-scroll"
              className={`${editorContainerClassName} min-h-0 flex-1`}
            >
              {/* Lossless collapsible YAML Front Matter */}
              {frontmatterRaw ? (
                <div className="mx-7 mt-3 rounded-lg border border-border/70 bg-muted/25 text-xs">
                  <button
                    type="button"
                    onClick={() => setFmOpen((v) => !v)}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      {fmOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      文档属性（YAML Front Matter · {fmLineCount} 行）
                    </span>
                    <span className="font-mono text-[10px]">Agentero Plate · 无损保留</span>
                  </button>
                  {fmOpen && (
                    <textarea
                      rows={Math.min(10, Math.max(3, fmLineCount))}
                      value={frontmatterRaw.trimEnd()}
                      onChange={(e) => handleFrontmatterEdit(`${e.target.value}\n`)}
                      spellCheck={false}
                      className="w-full border-t border-border/70 bg-background/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground focus:outline-none"
                    />
                  )}
                </div>
              ) : null}

              <PlateContent
                data-testid="wiki-wysiwyg-editor"
                className={`${editorClassName} ${editorContentClassName} h-auto!`}
                placeholder="输入正文，支持 Markdown 快捷键（# 标题、- [ ] 待办、$$ 公式、``` 代码块），⌘F 查找替换，⌘L 引用到右侧 Agent..."
                onClick={(event) => {
                  const target = event.target as HTMLElement | null;
                  const anchor = target?.closest("a");
                  if (anchor) {
                    const href = anchor.getAttribute("href");
                    if (href && /^https?:\/\//i.test(href)) {
                      event.preventDefault();
                      onOpenUrl?.(href, anchor.textContent ?? undefined);
                      return;
                    }
                  }
                  if ((event.metaKey || event.ctrlKey) && target?.textContent) {
                    const m = target.textContent.match(/\[\[([^\]|#]+)/);
                    if (m?.[1]) {
                      event.preventDefault();
                      onOpenWikilink?.(m[1].trim());
                    }
                  }
                }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
                    event.preventDefault();
                    setFindOpen(true);
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
                    const sel = editor.selection ? editor.api.string(editor.selection).trim() : "";
                    if (sel) {
                      event.preventDefault();
                      onAskAgentSelection?.(sel);
                    }
                  }
                  if (event.key === "Escape") setFindOpen(false);
                }}
              />
            </div>
          )}
        </div>
      </Plate>
    );
  },
);

function NoteFormatBar({
  sourceMode,
  selectedText,
  onToggleSource,
  onAskAgentSelection,
  onFind,
}: {
  sourceMode: boolean;
  selectedText: string;
  onToggleSource: () => void;
  onAskAgentSelection?: (selectedText: string) => void;
  onFind: () => void;
}): ReactNode {
  const editor = useEditorRef();
  const run = (apply: () => void): void => {
    editor.tf.focus();
    apply();
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-1.5 border-b border-border/80 bg-muted/20 px-2.5 py-1">
      {!sourceMode ? (
        <div className="flex flex-wrap items-center gap-0.5">
          <FmtBtn label="加粗 (⌘B)" onClick={() => run(() => editor.tf.toggleMark(KEYS.bold))}>
            <Bold size={13} />
          </FmtBtn>
          <FmtBtn label="斜体 (⌘I)" onClick={() => run(() => editor.tf.toggleMark(KEYS.italic))}>
            <Italic size={13} />
          </FmtBtn>
          <FmtBtn
            label="删除线"
            onClick={() => run(() => editor.tf.toggleMark(KEYS.strikethrough))}
          >
            <Strikethrough size={13} />
          </FmtBtn>
          <FmtBtn label="行内代码" onClick={() => run(() => editor.tf.toggleMark(KEYS.code))}>
            <Code size={13} />
          </FmtBtn>
          <span aria-hidden className="mx-1 h-3.5 w-px bg-border" />
          <FmtBtn label="二级标题" onClick={() => run(() => editor.tf.toggleBlock(KEYS.h2))}>
            <Heading2 size={13} />
          </FmtBtn>
          <FmtBtn
            label="无序列表"
            onClick={() => run(() => toggleList(editor, { listStyleType: ListStyleType.Disc }))}
          >
            <List size={13} />
          </FmtBtn>
          <FmtBtn
            label="有序列表"
            onClick={() => run(() => toggleList(editor, { listStyleType: ListStyleType.Decimal }))}
          >
            <ListOrdered size={13} />
          </FmtBtn>
          <FmtBtn label="引用" onClick={() => run(() => editor.tf.toggleBlock(KEYS.blockquote))}>
            <Quote size={13} />
          </FmtBtn>
          <span aria-hidden className="mx-1 h-3.5 w-px bg-border" />
          <FmtBtn label="插入链接" onClick={() => run(() => insertLink(editor))}>
            <Link size={13} />
          </FmtBtn>
          <FmtBtn
            label="插入表格"
            onClick={() => run(() => insertTable(editor, { rowCount: 3, colCount: 3 }))}
          >
            <Table size={13} />
          </FmtBtn>
          <FmtBtn
            label="插入 LaTeX 公式 (KaTeX)"
            onClick={() =>
              run(() => {
                editor.tf.insertNodes({
                  type: KEYS.equation,
                  texExpression: "E = mc^2",
                  children: [{ text: "" }],
                });
              })
            }
          >
            <Radical size={13} />
          </FmtBtn>
          <span aria-hidden className="mx-1 h-3.5 w-px bg-border" />
          <FmtBtn label="查找与替换 (⌘F)" onClick={onFind}>
            <Search size={13} />
          </FmtBtn>
        </div>
      ) : (
        <span className="text-[11px] font-mono text-muted-foreground">
          Markdown 源码模式（含完整 YAML Front Matter）
        </span>
      )}

      <div className="flex items-center gap-1.5">
        {selectedText && onAskAgentSelection ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onAskAgentSelection(selectedText)}
            className="inline-flex h-6 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground shadow-xs hover:opacity-90 cursor-pointer"
            title="引用选中段落到右侧 Agent (⌘L)"
          >
            <Sparkles size={11} />
            <span>问 Agent ⌘L</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onToggleSource}
          className={`inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors cursor-pointer ${
            sourceMode
              ? "border-primary bg-primary/15 text-primary font-medium"
              : "border-border bg-background text-muted-foreground hover:text-foreground"
          }`}
          title="切换 Agentero Plate 所见即所得视图与原始 Markdown 源码"
        >
          <FileCode2 size={11} />
          <span>{sourceMode ? "返回文档视图" : "源码"}</span>
        </button>
      </div>
    </div>
  );
}

function FmtBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
    >
      {children}
    </button>
  );
}

function insertLink(editor: PlateEditor): void {
  const selected = editor.api.string(editor.selection ?? undefined).trim();
  const url = window.prompt("输入链接地址", selected.startsWith("http") ? selected : "https://");
  if (url === null || url.trim() === "") return;
  editor.tf.insertNodes({
    type: KEYS.a,
    url: url.trim(),
    children: [{ text: selected === "" ? url.trim() : selected }],
  });
}

function FindBar({ onClose }: { onClose: () => void }): ReactNode {
  const editor = useEditorRef();
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [index, setIndex] = useState(0);
  const matches = findMatches(editor, query);
  const current = matches.length === 0 ? -1 : index % matches.length;

  useEffect(() => {
    editor.setOption(noteFindPlugin, "search", query.trim());
    editor.api.redecorate();
    return () => {
      editor.setOption(noteFindPlugin, "search", "");
      editor.api.redecorate();
    };
  }, [editor, query]);

  const go = (target: number): void => {
    if (matches.length === 0) return;
    const next = (target + matches.length) % matches.length;
    const range = matches[next];
    if (range === undefined) return;
    setIndex(next);
    editor.tf.select(range);
    const node = editor.api.node(range.anchor)?.[0];
    if (node !== undefined) editor.api.toDOMNode(node)?.scrollIntoView({ block: "nearest" });
  };

  const replaceCurrent = (): void => {
    const range = matches[current];
    if (range === undefined) return;
    editor.tf.select(range);
    editor.tf.insertText(replacement);
    setIndex(current);
  };

  const replaceAll = (): void => {
    editor.tf.withoutNormalizing(() => {
      for (const range of [...matches].reverse()) {
        editor.tf.insertText(replacement, { at: range });
      }
    });
  };

  useEffect(() => {
    document.querySelector<HTMLInputElement>("[data-note-find]")?.focus();
  }, []);

  return (
    <div
      data-testid="wiki-find-bar"
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-1.5 text-xs"
    >
      <input
        data-note-find
        value={query}
        aria-label="查找"
        placeholder="查找..."
        className="h-6 w-32 rounded border border-input bg-background px-2 text-xs outline-none focus:border-primary"
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Enter") {
            event.preventDefault();
            go(event.shiftKey ? current - 1 : current + 1);
          }
        }}
      />
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {matches.length === 0 ? "0" : `${current + 1}/${matches.length}`}
      </span>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => go(current - 1)}
        className="h-6 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
      >
        上一个
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => go(current + 1)}
        className="h-6 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
      >
        下一个
      </button>
      <input
        value={replacement}
        aria-label="替换为"
        placeholder="替换为..."
        className="h-6 w-32 rounded border border-input bg-background px-2 text-xs outline-none focus:border-primary"
        onChange={(event) => setReplacement(event.target.value)}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={replaceCurrent}
        className="h-6 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
      >
        替换
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={replaceAll}
        className="h-6 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
      >
        全部替换
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭查找栏"
        className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
      >
        <X size={12} />
      </button>
    </div>
  );
}

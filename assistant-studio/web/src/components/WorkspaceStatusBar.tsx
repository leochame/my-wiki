import { Command, Palette, RefreshCw } from "lucide-react";
import { THEME_PRESETS, type MarketColorMode, type ThemePreset } from "@/lib/theme";
import type { HealthResponse, TodayResponse } from "@/types";

interface WorkspaceStatusBarProps {
  health: HealthResponse | null;
  today: TodayResponse | null;
  vaultCount: number;
  theme: ThemePreset;
  colorMode: MarketColorMode;
  onCycleTheme: () => void;
  onToggleColorMode: () => void;
  onOpenCommandPalette: () => void;
  onGoInvest: () => void;
}

export function WorkspaceStatusBar({
  health,
  today,
  vaultCount,
  theme,
  colorMode,
  onCycleTheme,
  onToggleColorMode,
  onOpenCommandPalette,
  onGoInvest,
}: WorkspaceStatusBarProps) {
  const themeLabel = THEME_PRESETS.find((t) => t.id === theme)?.label ?? theme;
  const runningCount = today?.running_scripts?.length ?? 0;
  const investReady = health?.invest_ready ?? health?.northstar_online ?? false;

  return (
    <footer
      data-testid="workspace-status-bar"
      className="sticky bottom-0 z-20 flex h-6 shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/45 backdrop-blur-sm px-3 text-[10px] font-mono text-muted-foreground select-none"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="inline-flex items-center gap-1.5 text-foreground/85 shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-up" />
          MyWiki Studio
        </span>
        <span className="hidden sm:inline shrink-0">
          Vault: {health?.indexed_files ?? vaultCount} 篇
        </span>
        {today && (
          <span className="hidden md:inline shrink-0">
            待办: {today.total_open_count}
            {today.overdue.length > 0 && (
              <span className="ml-1 text-down font-semibold">· 逾期 {today.overdue.length}</span>
            )}
          </span>
        )}
        {runningCount > 0 && (
          <span className="inline-flex items-center gap-1 text-warn shrink-0">
            <RefreshCw size={9} className="animate-spin" />
            {runningCount} 脚本运行中
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onGoInvest}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
          title="前往投研终端"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${investReady ? "bg-up" : "bg-warn"}`} />
          <span>{investReady ? "长桥实时" : "行情待连"}</span>
        </button>

        <button
          type="button"
          onClick={onToggleColorMode}
          className="hidden sm:inline hover:text-foreground transition-colors cursor-pointer"
          title="点击切换美股/港A 涨跌配色"
        >
          {colorMode === "us" ? "美股绿涨" : "港A红涨"}
        </button>

        <button
          type="button"
          onClick={onCycleTheme}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
          title="点击快速切换主题预设"
        >
          <Palette size={10} />
          <span>{themeLabel}</span>
        </button>

        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="inline-flex items-center gap-1 text-foreground/80 hover:text-primary transition-colors cursor-pointer"
          title="打开全局命令面板 (⌘K)"
        >
          <Command size={10} />
          <span>⌘K 命令</span>
        </button>
      </div>
    </footer>
  );
}

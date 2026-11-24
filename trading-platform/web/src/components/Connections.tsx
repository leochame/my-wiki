import { useState } from "react";
import { Check, CircleAlert, ExternalLink, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Workspace } from "@/hooks/useWorkspace";
import * as api from "@/lib/api";
import { errorMessage } from "@/lib/format";
import type { AgentStatus } from "@/types";

const LONGBRIDGE_KEYS = [
  "LONGBRIDGE_APP_KEY",
  "LONGBRIDGE_APP_SECRET",
  "LONGBRIDGE_ACCESS_TOKEN",
];

export function Connections({
  workspace: w,
  agentStatus,
  onRefreshAgent,
}: {
  workspace: Workspace;
  agentStatus: AgentStatus | null;
  onRefreshAgent: () => void;
}) {
  const [agentCode, setAgentCode] = useState("");
  const [agentErr, setAgentErr] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);

  const missing = new Set(w.health?.longbridge_missing ?? []);

  const redeemAgentCode = async () => {
    if (!agentCode.trim() || agentBusy) return;
    setAgentBusy(true);
    setAgentErr("");
    try {
      await api.loginAgentWithCode(agentCode.trim());
      setAgentCode("");
      onRefreshAgent();
    } catch (e) {
      setAgentErr(errorMessage(e));
    } finally {
      setAgentBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 rb-enter">
      {/* Longbridge OpenAPI */}
      <Card>
        <CardHeader>
          <CardTitle>长桥 OpenAPI（实时行情源）</CardTitle>
          <Badge variant={w.quoteReady ? "up" : "warn"}>
            {w.quoteReady ? "已连接" : "待配置"}
          </Badge>
        </CardHeader>
        <CardContent className="divide-y divide-border/70 py-1">
          {LONGBRIDGE_KEYS.map((key) => {
            const ok = w.health ? !missing.has(key) : false;
            return (
              <div key={key} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                <code className="font-mono text-[11px] text-muted-foreground">{key}</code>
                <span
                  className={
                    ok
                      ? "inline-flex items-center gap-1 text-up font-medium"
                      : "inline-flex items-center gap-1 text-muted-foreground"
                  }
                >
                  {ok ? <Check size={12} /> : <CircleAlert size={12} />}
                  {ok ? "已配置" : "缺失"}
                </span>
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-3 py-2.5 text-xs">
            <span className="text-muted-foreground shrink-0">外部配置</span>
            <code className="font-mono text-[11px] text-foreground break-all text-right">
              {w.health?.env_file_path ?? "~/.config/northstar/runtime.env"}
            </code>
          </div>
        </CardContent>
      </Card>

      {/* Longbridge Agent CLI */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Sparkles size={13} className="text-up" />
            长桥 Agent（AI 投研）
          </CardTitle>
          <Badge variant={agentStatus?.authenticated ? "up" : "warn"}>
            {agentStatus?.authenticated ? "已认证" : "待授权"}
          </Badge>
        </CardHeader>
        <CardContent className="divide-y divide-border/70 py-1">
          <div className="flex items-center justify-between gap-3 py-2.5 text-xs">
            <span className="text-muted-foreground">CLI 状态</span>
            <span className="font-medium">
              {agentStatus?.authenticated
                ? `有效 · ${agentStatus.dc_region ?? "AP"} (${agentStatus.packages_count} 项行情包)`
                : agentStatus?.cli_available
                  ? "未登录"
                  : "未检测到 CLI"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 py-2.5 text-xs">
            <span className="text-muted-foreground">续期机制</span>
            <span className="text-right text-[11px]">Access 14天 / Refresh 30天（活跃自动续期）</span>
          </div>
        </CardContent>
        <div className="border-t border-border bg-muted/35 p-3 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>用新 Auth Code 登录 / 续期</span>
            <a
              href="https://open.longbridge.cn/connect"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              获取授权码 <ExternalLink size={10} />
            </a>
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void redeemAgentCode();
            }}
          >
            <Input
              placeholder="粘贴长桥 Auth Code"
              value={agentCode}
              onChange={(e) => setAgentCode(e.target.value)}
              disabled={agentBusy}
              className="h-7"
            />
            <Button type="submit" variant="outline" size="sm" disabled={agentBusy || !agentCode.trim()}>
              登录
            </Button>
          </form>
          {agentErr && (
            <div className="rounded-md bg-down-soft px-2.5 py-1.5 text-[11px] text-down">
              {agentErr}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  Briefcase,
  CalendarSync,
  Check,
  Copy,
  Mail,
  Plus,
  Save,
  X,
} from "lucide-react";
import { getScriptConfig, updateScriptConfig } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import type { ScriptSettings, ScriptSettingsResponse } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const PRESET_COMPANIES = [
  "booking",
  "amazon",
  "nvidia",
  "coupang",
  "airbnb",
  "intel",
  "ebay",
  "paypal",
  "agoda",
  "databricks",
  "apple",
  "anthropic",
  "openai",
  "stripe",
];

interface ScriptConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNotify: (msg: string, tone?: "ok" | "err") => void;
  onSaved?: (res: ScriptSettingsResponse) => void;
}

export function ScriptConfigDialog({
  open,
  onOpenChange,
  onNotify,
  onSaved,
}: ScriptConfigDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState<Omit<ScriptSettingsResponse, "settings"> | null>(null);
  const [draft, setDraft] = useState<ScriptSettings | null>(null);
  const [customCompany, setCustomCompany] = useState("");
  const [copiedIcs, setCopiedIcs] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getScriptConfig()
      .then((res) => {
        setDraft(res.settings);
        setMeta({
          mail_env_configured: res.mail_env_configured,
          google_oauth_configured: res.google_oauth_configured,
          ics_url: res.ics_url,
        });
      })
      .catch((e) => onNotify(errorMessage(e), "err"))
      .finally(() => setLoading(false));
  }, [open, onNotify]);

  const toggleCompany = (company: string) => {
    if (!draft) return;
    const exists = draft.jobs.companies.includes(company);
    const next = exists
      ? draft.jobs.companies.filter((c) => c !== company)
      : [...draft.jobs.companies, company];
    setDraft({ ...draft, jobs: { ...draft.jobs, companies: next } });
  };

  const addCustomCompany = () => {
    const clean = customCompany.trim();
    if (!clean || !draft) return;
    if (!draft.jobs.companies.includes(clean)) {
      setDraft({
        ...draft,
        jobs: { ...draft.jobs, companies: [...draft.jobs.companies, clean] },
      });
    }
    setCustomCompany("");
  };

  const handleCopyIcs = async () => {
    if (!meta?.ics_url) return;
    try {
      await navigator.clipboard.writeText(meta.ics_url);
      setCopiedIcs(true);
      onNotify("已复制 Apple 日历订阅地址 (.ics)");
      window.setTimeout(() => setCopiedIcs(false), 2000);
    } catch {
      onNotify("复制失败，请手动选中复制", "err");
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const updated = await updateScriptConfig(draft);
      setDraft(updated.settings);
      setMeta({
        mail_env_configured: updated.mail_env_configured,
        google_oauth_configured: updated.google_oauth_configured,
        ics_url: updated.ics_url,
      });
      onSaved?.(updated);
      onNotify("脚本参数配置已保存到 SQLite");
      onOpenChange(false);
    } catch (e) {
      onNotify(errorMessage(e), "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="脚本参数与同步配置"
        className="w-[min(640px,calc(100%-24px))]"
      >
        {loading || !draft ? (
          <div className="py-10 text-center text-xs text-muted-foreground">正在加载配置...</div>
        ) : (
          <div className="space-y-4">
            <Tabs defaultValue="email">
              <TabsList className="w-full grid grid-cols-3">
                <TabsTrigger value="email" className="gap-1.5 text-xs">
                  <Mail size={12} /> 邮箱与推送
                </TabsTrigger>
                <TabsTrigger value="jobs" className="gap-1.5 text-xs">
                  <Briefcase size={12} /> 目标公司职位
                </TabsTrigger>
                <TabsTrigger value="calendar" className="gap-1.5 text-xs">
                  <CalendarSync size={12} /> 日历双向同步
                </TabsTrigger>
              </TabsList>

              {/* Tab 1: Email */}
              <TabsContent value="email" className="space-y-3 pt-2 text-xs">
                <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/30 px-3 py-2">
                  <div>
                    <div className="font-medium">Gmail 凭据状态（Vault 外安全存储）</div>
                    <div className="text-[11px] text-muted-foreground">
                      <code>~/.config/mywiki-studio/mail.env</code>
                    </div>
                  </div>
                  <Badge variant={meta?.mail_env_configured ? "up" : "warn"}>
                    {meta?.mail_env_configured ? "已配置" : "未配置"}
                  </Badge>
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-foreground">
                    收件人邮箱（多个地址用英文逗号分隔）
                  </label>
                  <Input
                    value={draft.email.to_addresses}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        email: { ...draft.email, to_addresses: e.target.value },
                      })
                    }
                    placeholder="liulch.cn@gmail.com"
                    className="h-8 text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-medium text-foreground">
                      未读邮件最大拉取条数
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={draft.email.max_unread}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          email: {
                            ...draft.email,
                            max_unread: Math.max(1, Math.min(50, Number(e.target.value) || 20)),
                          },
                        })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border/80 px-3 py-2 self-end">
                    <div>
                      <div className="font-medium">简报生成后自动发邮件</div>
                      <div className="text-[10px] text-muted-foreground">
                        点击金融简报或今日简报时自动投递
                      </div>
                    </div>
                    <Switch
                      checked={draft.email.auto_send_brief}
                      onCheckedChange={(checked) =>
                        setDraft({
                          ...draft,
                          email: { ...draft.email, auto_send_brief: checked },
                        })
                      }
                    />
                  </div>
                </div>
              </TabsContent>

              {/* Tab 2: Jobs */}
              <TabsContent value="jobs" className="space-y-3 pt-2 text-xs">
                <div className="space-y-1.5">
                  <label className="font-medium text-foreground">
                    目标公司列表（点击切换关注，用于 <code>fetch_job_watch.py</code>）
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(new Set([...PRESET_COMPANIES, ...draft.jobs.companies])).map(
                      (company) => {
                        const selected = draft.jobs.companies.includes(company);
                        return (
                          <button
                            key={company}
                            type="button"
                            onClick={() => toggleCompany(company)}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors cursor-pointer ${
                              selected
                                ? "border-primary bg-primary/15 text-primary font-medium"
                                : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {selected ? <Check size={10} /> : <Plus size={10} />}
                            <span>{company}</span>
                            {selected && !PRESET_COMPANIES.includes(company) && (
                              <X size={10} className="ml-0.5 opacity-70" />
                            )}
                          </button>
                        );
                      },
                    )}
                  </div>
                  <div className="flex gap-1.5 pt-1">
                    <Input
                      value={customCompany}
                      onChange={(e) => setCustomCompany(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomCompany();
                        }
                      }}
                      placeholder="添加自定义公司名（如 DeepMind / xAI）..."
                      className="h-8 text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0"
                      onClick={addCustomCompany}
                    >
                      <Plus size={12} /> 添加
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div className="space-y-1">
                    <label className="font-medium text-foreground">职位关键词（留空看全部）</label>
                    <Input
                      value={draft.jobs.keyword}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          jobs: { ...draft.jobs, keyword: e.target.value },
                        })
                      }
                      placeholder="留空或 engineer,AI,软件"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-medium text-foreground">地点筛选（默认大陆）</label>
                    <Input
                      value={draft.jobs.location}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          jobs: { ...draft.jobs, location: e.target.value },
                        })
                      }
                      placeholder="China / Shanghai / Beijing"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-medium text-foreground">每家上限条数</label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={draft.jobs.limit}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          jobs: {
                            ...draft.jobs,
                            limit: Math.max(1, Math.min(50, Number(e.target.value) || 10)),
                          },
                        })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </TabsContent>

              {/* Tab 3: Calendar Sync */}
              <TabsContent value="calendar" className="space-y-3 pt-2 text-xs">
                <div className="space-y-1">
                  <label className="font-medium text-foreground">同步模式</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        ["bidirectional", "双向同步", "本地 ↔ 远程互相同步"],
                        ["push", "仅推送", "本地任务 → 远程日历"],
                        ["status", "仅查看状态", "只读不修改两端数据"],
                      ] as const
                    ).map(([mode, title, desc]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            calendar: { ...draft.calendar, mode },
                          })
                        }
                        className={`rounded-lg border p-2 text-left transition-colors cursor-pointer ${
                          draft.calendar.mode === mode
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-muted/40"
                        }`}
                      >
                        <div className="font-semibold text-[11px]">{title}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Google Calendar / Tasks */}
                <div className="rounded-lg border border-border/80 p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Google Calendar & Tasks</span>
                      <Badge variant={meta?.google_oauth_configured ? "up" : "warn"} className="text-[10px]">
                        {meta?.google_oauth_configured ? "OAuth 已授权" : "未授权"}
                      </Badge>
                    </div>
                    <Switch
                      checked={draft.calendar.google_enabled}
                      onCheckedChange={(checked) =>
                        setDraft({
                          ...draft,
                          calendar: { ...draft.calendar, google_enabled: checked },
                        })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">Google 日历名称</label>
                      <Input
                        value={draft.calendar.google_calendar_name}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            calendar: {
                              ...draft.calendar,
                              google_calendar_name: e.target.value,
                            },
                          })
                        }
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">Google Tasks 清单名称</label>
                      <Input
                        value={draft.calendar.google_tasklist_name}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            calendar: {
                              ...draft.calendar,
                              google_tasklist_name: e.target.value,
                            },
                          })
                        }
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* Apple Calendar */}
                <div className="rounded-lg border border-border/80 p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">Apple 日历（macOS 原生写入 + .ics 订阅）</div>
                      <div className="text-[10px] text-muted-foreground">
                        开启原生写入时通过 AppleScript 同步至 macOS Calendar.app
                      </div>
                    </div>
                    <Switch
                      checked={draft.calendar.apple_enabled}
                      onCheckedChange={(checked) =>
                        setDraft({
                          ...draft,
                          calendar: { ...draft.calendar, apple_enabled: checked },
                        })
                      }
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 items-end">
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">Apple 日历名称</label>
                      <Input
                        value={draft.calendar.apple_calendar_name}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            calendar: {
                              ...draft.calendar,
                              apple_calendar_name: e.target.value,
                            },
                          })
                        }
                        placeholder="MyWiki 任务"
                        className="h-7 text-xs"
                      />
                    </div>
                    <label className="flex items-center justify-between rounded-md border border-border/70 px-2.5 py-1.5 cursor-pointer">
                      <span className="text-[11px]">同步已完成任务</span>
                      <Switch
                        checked={draft.calendar.include_completed}
                        onCheckedChange={(checked) =>
                          setDraft({
                            ...draft,
                            calendar: { ...draft.calendar, include_completed: checked },
                          })
                        }
                      />
                    </label>
                  </div>

                  {meta?.ics_url && (
                    <div className="rounded-md bg-muted/40 px-2.5 py-2 space-y-1">
                      <div className="text-[10px] text-muted-foreground">
                        零权限 Apple 日历订阅 URL（在 macOS 日历 → 文件 → 新建日历订阅中粘贴）：
                      </div>
                      <div className="flex items-center gap-1.5">
                        <code className="flex-1 truncate rounded bg-background px-2 py-1 font-mono text-[10px] border border-border/60">
                          {meta.ics_url}
                        </code>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => void handleCopyIcs()}
                        >
                          {copiedIcs ? <Check size={11} /> : <Copy size={11} />}
                          {copiedIcs ? "已复制" : "复制"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-3">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button size="sm" disabled={saving} onClick={() => void handleSave()}>
                <Save size={12} /> {saving ? "保存中..." : "保存配置"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

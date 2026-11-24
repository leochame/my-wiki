use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use axum::http::StatusCode;
use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::{process::Command, sync::RwLock, time::timeout};

use crate::{
    config::find_binary,
    db::{Database, FeedItemRecord, ScriptRunRecord, TaskRecord},
    feeds::FeedManager,
    tasks::sync_tasks_to_db,
    vault::{atomic_write, full_reindex, index_single_file},
    ApiError,
};

#[derive(Clone, Serialize)]
pub struct ScriptDef {
    pub key: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub script_rel: &'static str,
}

const JOB_WATCH_JSON_REL: &str = "job-search/companies/latest-job-watch.json";
const JOB_WATCH_MD_REL: &str = "job-search/companies/latest-job-watch.md";

pub const SCRIPTS: &[ScriptDef] = &[
    ScriptDef {
        key: "today",
        label: "Today 全量简报",
        description: "扫描任务 / WHV / Gmail，Agent 总结金融订阅并自动发邮件",
        script_rel: "task/script/generate_today.py",
    },
    ScriptDef {
        key: "finance_brief",
        label: "金融资讯 AI 简报 & 发邮件",
        description: "刷新 21 路金融源 → Agent 生成摘要 → 自动发往配置的 Gmail",
        script_rel: "builtin:agent_finance_brief",
    },
    ScriptDef {
        key: "gmail",
        label: "Gmail 未读邮件",
        description: "IMAP 只读拉取未读邮件，结果直接显示在首页邮件面板",
        script_rel: "task/script/fetch_gmail.py",
    },
    ScriptDef {
        key: "jobs",
        label: "目标公司职位",
        description: "按配置的公司与关键词抓取最新职位，结果显示在首页职位面板",
        script_rel: "task/script/fetch_job_watch.py",
    },
    ScriptDef {
        key: "whv",
        label: "WHV 窗口检查",
        description: "检查新西兰 WHV 与澳大利亚 462 开放状态（显示在任务模块）",
        script_rel: "task/script/fetch_whv_status.py",
    },
    ScriptDef {
        key: "calendar_sync",
        label: "日历双向同步",
        description: "本地任务 ↔ Google 日历/Tasks（可选 Apple 日历）双向同步",
        script_rel: "task/script/sync_calendars.py",
    },
    ScriptDef {
        key: "blogs",
        label: "AI 工程博客",
        description: "抓取 Anthropic / OpenAI / LangChain 近 7 天新文章（写入 today.md）",
        script_rel: "task/script/fetch_blogs.py",
    },
];

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EmailScriptConfig {
    pub to_addresses: String,
    pub max_unread: usize,
    pub auto_send_brief: bool,
}

impl Default for EmailScriptConfig {
    fn default() -> Self {
        Self {
            to_addresses: "liulch.cn@gmail.com".into(),
            max_unread: 15,
            auto_send_brief: true,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JobWatchConfig {
    pub companies: Vec<String>,
    pub keyword: String,
    pub location: String,
    pub limit: usize,
}

impl Default for JobWatchConfig {
    fn default() -> Self {
        Self {
            companies: vec![
                "booking".into(),
                "amazon".into(),
                "nvidia".into(),
                "coupang".into(),
                "airbnb".into(),
                "ebay".into(),
                "intel".into(),
            ],
            keyword: String::new(),
            location: "China".into(),
            limit: 6,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CalendarSyncConfig {
    pub mode: String, // bidirectional | push | status
    pub google_enabled: bool,
    pub google_calendar_name: String,
    pub google_tasklist_name: String,
    pub apple_enabled: bool,
    pub apple_calendar_name: String,
    pub include_completed: bool,
}

impl Default for CalendarSyncConfig {
    fn default() -> Self {
        Self {
            mode: "bidirectional".into(),
            google_enabled: true,
            google_calendar_name: "MyWiki 任务".into(),
            google_tasklist_name: "MyWiki 待办".into(),
            apple_enabled: false,
            apple_calendar_name: "MyWiki 任务".into(),
            include_completed: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct ScriptSettings {
    #[serde(default)]
    pub email: EmailScriptConfig,
    #[serde(default)]
    pub jobs: JobWatchConfig,
    #[serde(default)]
    pub calendar: CalendarSyncConfig,
}

#[derive(Clone, Serialize)]
pub struct ScriptSettingsResponse {
    pub settings: ScriptSettings,
    pub mail_env_configured: bool,
    pub google_oauth_configured: bool,
    pub ics_url: String,
}

#[derive(Clone, Serialize)]
pub struct TodayBlogLink {
    pub title: String,
    pub url: String,
    pub provider: String,
    pub meta: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct FinanceBriefSummary {
    pub generated_at: String,
    pub item_count: usize,
    pub markdown: String,
    #[serde(default)]
    pub mailed_to: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct TodayBrief {
    pub exists: bool,
    pub date_heading: Option<String>,
    pub whv_lines: Vec<String>,
    pub whv_alert: bool,
    pub blog_links: Vec<TodayBlogLink>,
    pub raw_markdown: String,
}

#[derive(Clone)]
pub struct ScriptRunner {
    vault_root: PathBuf,
    python_bin: PathBuf,
    db: Database,
    feeds: FeedManager,
    running: Arc<RwLock<HashSet<String>>>,
}

impl ScriptRunner {
    pub fn new(vault_root: PathBuf, python_bin: PathBuf, db: Database, feeds: FeedManager) -> Self {
        Self {
            vault_root,
            python_bin,
            db,
            feeds,
            running: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    pub async fn active_keys(&self) -> Vec<String> {
        self.running.read().await.iter().cloned().collect()
    }

    pub async fn load_settings(&self) -> ScriptSettings {
        let raw = self
            .db
            .get_meta("script_settings_json".into())
            .await
            .ok()
            .flatten();
        raw.and_then(|s| serde_json::from_str::<ScriptSettings>(&s).ok())
            .unwrap_or_default()
    }

    pub async fn save_settings(&self, mut next: ScriptSettings) -> Result<ScriptSettings, ApiError> {
        next.email.to_addresses = next.email.to_addresses.trim().to_string();
        if next.email.to_addresses.is_empty() {
            next.email.to_addresses = "liulch.cn@gmail.com".into();
        }
        next.email.max_unread = next.email.max_unread.clamp(1, 50);
        next.jobs.limit = next.jobs.limit.clamp(1, 30);
        next.jobs.companies = next
            .jobs
            .companies
            .into_iter()
            .map(|c| c.trim().to_lowercase())
            .filter(|c| !c.is_empty())
            .collect();
        if next.jobs.companies.is_empty() {
            next.jobs.companies = vec!["amazon".into(), "apple".into()];
        }
        if !matches!(next.calendar.mode.as_str(), "bidirectional" | "push" | "status") {
            next.calendar.mode = "bidirectional".into();
        }
        let encoded = serde_json::to_string(&next)
            .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        self.db
            .set_meta("script_settings_json".into(), encoded)
            .await?;
        Ok(next)
    }

    pub async fn settings_response(&self, port: u16) -> ScriptSettingsResponse {
        let settings = self.load_settings().await;
        let mail_env_path = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default()
            .join(".config/mywiki-studio/mail.env");
        let mail_env_configured = mail_env_path.exists()
            || std::env::var("MYWIKI_GMAIL_APP_PASSWORD")
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false);
        let google_oauth_configured = self
            .vault_root
            .join("task/script/google_calendar_token.json")
            .exists();
        ScriptSettingsResponse {
            settings,
            mail_env_configured,
            google_oauth_configured,
            ics_url: format!("http://127.0.0.1:{port}/api/calendar/tasks.ics"),
        }
    }

    pub async fn load_finance_summary(&self) -> Option<FinanceBriefSummary> {
        let raw = self
            .db
            .get_meta("today_finance_brief_json".into())
            .await
            .ok()??;
        serde_json::from_str::<FinanceBriefSummary>(&raw).ok()
    }

    /// Latest structured Gmail unread digest captured from `fetch_gmail.py --json`.
    pub async fn load_gmail_digest(&self) -> Option<serde_json::Value> {
        let raw = self.db.get_meta("gmail_digest_json".into()).await.ok()??;
        serde_json::from_str::<serde_json::Value>(&raw).ok()
    }

    /// Latest structured job-watch report written by `fetch_job_watch.py --json-output`.
    pub fn load_job_watch(&self) -> Option<serde_json::Value> {
        let path = self.vault_root.join(JOB_WATCH_JSON_REL);
        let raw = fs::read_to_string(path).ok()?;
        serde_json::from_str::<serde_json::Value>(&raw).ok()
    }

    async fn collect_finance_items(&self) -> Result<Vec<FeedItemRecord>, ApiError> {
        let mut all = Vec::new();
        for grp in ["核心财经", "财经监管", "机构与人物"] {
            let mut items = self
                .db
                .list_feed_items(Some(grp.into()), None, false, false, None, 12)
                .await?;
            all.append(&mut items);
        }
        all.sort_by(|a, b| {
            let ta = a.published_at.as_deref().unwrap_or(&a.fetched_at);
            let tb = b.published_at.as_deref().unwrap_or(&b.fetched_at);
            tb.cmp(ta)
        });
        all.truncate(36);
        Ok(all)
    }

    async fn summarize_finance_with_agent(&self) -> Result<(FinanceBriefSummary, String), ApiError> {
        let refreshed = self.feeds.refresh_finance_feeds().await.unwrap_or(0);
        let items = self.collect_finance_items().await?;
        if items.is_empty() {
            return Err(ApiError(
                StatusCode::BAD_GATEWAY,
                "未拉取到任何金融订阅条目，请先检查网络或订阅源开关".into(),
            ));
        }

        let bin = find_binary("claude", Some("CLAUDE_BIN")).ok_or_else(|| {
            ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "未找到本机 claude CLI，无法调用 Agent 总结金融资讯".into(),
            )
        })?;

        let mut feed_lines = String::new();
        for (idx, it) in items.iter().enumerate() {
            let dt = it
                .published_at
                .as_deref()
                .unwrap_or(&it.fetched_at)
                .chars()
                .take(10)
                .collect::<String>();
            let sum = it
                .summary
                .as_deref()
                .unwrap_or("")
                .replace('\n', " ")
                .chars()
                .take(160)
                .collect::<String>();
            feed_lines.push_str(&format!(
                "{}. [{} | {} | {}] {}\n   URL: {}\n",
                idx + 1,
                it.group_name,
                it.source_name,
                dt,
                it.title.replace('\n', " "),
                it.url
            ));
            if !sum.trim().is_empty() {
                feed_lines.push_str(&format!("   摘要: {sum}\n"));
            }
        }

        let today_str = Local::now().format("%Y-%m-%d").to_string();
        let prompt = format!(
            "你是用户的个人投研与金融资讯简报 Agent。请仅基于下面提供的 {count} 条最新金融订阅资讯（日期基准：{today_str}），不要调用任何外部工具，也不要编造列表外的数据或价格，直接输出一份高密度中文 Markdown 简报：\n\n\
            请严格使用以下 4 个小节：\n\
            ### 宏观与央行 / 监管动向\n\
            - （2-4 条要点，注明来源媒体）\n\n\
            ### 市场与科技主线\n\
            - （3-5 条要点，聚焦美股、AI、大科技与资金动向）\n\n\
            ### 重点风险与关注信号\n\
            - （2-3 条值得警惕的风险或政策催化）\n\n\
            ### 今日必读原文（3-5 篇）\n\
            - [原文标题](原文URL) — *来源*：一句话说明为什么值得读\n\n\
            --- 最新金融订阅列表 ---\n{feed_lines}",
            count = items.len()
        );

        let mut cmd = Command::new(bin);
        cmd.current_dir(&self.vault_root)
            .arg("-p")
            .arg("--permission-mode")
            .arg("plan")
            .arg("--output-format")
            .arg("text")
            .arg(&prompt);

        let out = timeout(Duration::from_secs(120), cmd.output())
            .await
            .map_err(|_| ApiError(StatusCode::GATEWAY_TIMEOUT, "Claude Agent 总结金融资讯超时".into()))?
            .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, format!("启动 claude 失败: {e}")))?;

        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if !out.status.success() || stdout.is_empty() {
            return Err(ApiError(
                StatusCode::BAD_GATEWAY,
                if stderr.is_empty() {
                    "Claude Agent 未返回有效金融简报内容".into()
                } else {
                    format!("Claude Agent 总结失败: {stderr}")
                },
            ));
        }

        let summary = FinanceBriefSummary {
            generated_at: Utc::now().to_rfc3339(),
            item_count: items.len(),
            markdown: stdout.clone(),
            mailed_to: None,
        };
        let encoded = serde_json::to_string(&summary).unwrap_or_default();
        self.db
            .set_meta("today_finance_brief_json".into(), encoded)
            .await?;

        let _ = upsert_finance_summary_in_today_md(&self.vault_root, &summary);
        let _ = index_single_file(&self.vault_root, &self.db, "task/today.md").await;

        let log_msg = format!(
            "[金融订阅刷新] 更新 {refreshed} 条，纳入最新 {count} 条交由 Claude Agent 总结完成。\n\n{stdout}",
            count = items.len()
        );
        Ok((summary, log_msg))
    }

    async fn try_send_brief_email(&self, settings: &ScriptSettings) -> (bool, String) {
        if !settings.email.auto_send_brief {
            return (false, "已在配置中关闭简报自动发邮件，跳过发送。".into());
        }
        let script_path = self.vault_root.join("task/script/send_gmail_brief.py");
        if !script_path.exists() {
            return (false, "未找到 task/script/send_gmail_brief.py".into());
        }
        let recipients: Vec<String> = settings
            .email
            .to_addresses
            .split([',', ';', ' '])
            .map(|s| s.trim().to_string())
            .filter(|s| s.contains('@'))
            .collect();
        let targets = if recipients.is_empty() {
            vec!["liulch.cn@gmail.com".to_string()]
        } else {
            recipients
        };

        let mut all_ok = true;
        let mut logs = Vec::new();
        for addr in &targets {
            let mut cmd = Command::new(&self.python_bin);
            cmd.args(["task/script/send_gmail_brief.py", "--to", addr])
                .current_dir(&self.vault_root)
                .env("PYTHONUNBUFFERED", "1");
            match timeout(Duration::from_secs(35), cmd.output()).await {
                Ok(Ok(out)) => {
                    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                    if !out.status.success() {
                        all_ok = false;
                    }
                    let msg = if !stdout.is_empty() && !stderr.is_empty() {
                        format!("{stdout}\n{stderr}")
                    } else if !stdout.is_empty() {
                        stdout
                    } else {
                        stderr
                    };
                    logs.push(msg);
                }
                Ok(Err(e)) => {
                    all_ok = false;
                    logs.push(format!("启动发信脚本失败 ({addr}): {e}"));
                }
                Err(_) => {
                    all_ok = false;
                    logs.push(format!("发信脚本超时 (>35s) ({addr})"));
                }
            }
        }
        (all_ok, logs.join("\n"))
    }

    pub async fn run_script(&self, key: &str) -> Result<ScriptRunRecord, ApiError> {
        let normalized_key = if key == "google_status" {
            "calendar_sync"
        } else {
            key
        };
        let def = SCRIPTS
            .iter()
            .find(|s| s.key == normalized_key)
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, format!("未知脚本: {key}")))?;

        if normalized_key != "finance_brief" {
            let script_path = self.vault_root.join(def.script_rel);
            if !script_path.exists() {
                return Err(ApiError(
                    StatusCode::NOT_FOUND,
                    format!("脚本不存在: {}", def.script_rel),
                ));
            }
        }

        // Per-script lock only: different scripts always run concurrently without blocking each other!
        {
            let mut guard = self.running.write().await;
            if guard.contains(normalized_key) {
                return Err(ApiError(
                    StatusCode::CONFLICT,
                    format!("脚本「{}」正在运行中，请稍候", def.label),
                ));
            }
            guard.insert(normalized_key.to_string());
        }

        let settings = self.load_settings().await;

        // Builtin Agent Financial Subscriptions Brief + Auto Gmail Delivery
        if normalized_key == "finance_brief" {
            let run_id = self
                .db
                .insert_script_run(
                    normalized_key.to_string(),
                    format!("agent:claude summarize -> gmail({})", settings.email.to_addresses),
                )
                .await?;
            let started = Instant::now();
            let res = self.summarize_finance_with_agent().await;
            let (status, exit_code, output_log, summary_json) = match res {
                Ok((mut summary, mut log)) => {
                    let (mailed, mail_msg) = self.try_send_brief_email(&settings).await;
                    if mailed {
                        summary.mailed_to = Some(settings.email.to_addresses.clone());
                        if let Ok(encoded) = serde_json::to_string(&summary) {
                            let _ = self
                                .db
                                .set_meta("today_finance_brief_json".into(), encoded)
                                .await;
                        }
                    }
                    if !mail_msg.is_empty() {
                        log.push_str("\n\n=== Gmail 推送 ===\n");
                        log.push_str(&mail_msg);
                    }
                    (
                        "ok".to_string(),
                        Some(0),
                        log.chars().take(65536).collect(),
                        Some(
                            json!({
                                "ok": true,
                                "item_count": summary.item_count,
                                "mailed": mailed,
                                "mailed_to": settings.email.to_addresses,
                            })
                            .to_string(),
                        ),
                    )
                }
                Err(e) => ("error".to_string(), Some(1), e.1, None),
            };
            let duration_ms = started.elapsed().as_millis() as i64;
            self.running.write().await.remove(normalized_key);
            self.db
                .finish_script_run(run_id, status, exit_code, duration_ms, summary_json, output_log)
                .await?;
            let runs = self.db.list_script_runs(15).await?;
            return runs
                .into_iter()
                .find(|r| r.id == run_id)
                .ok_or_else(|| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "回读脚本运行记录失败".into()));
        }

        let today_str = Local::now().format("%Y-%m-%d").to_string();
        let mut args: Vec<String> = vec![def.script_rel.to_string()];
        let wait = match normalized_key {
            "today" => {
                args.push("--date".into());
                args.push(today_str);
                Duration::from_secs(180)
            }
            "blogs" => {
                args.push("--days".into());
                args.push("7".into());
                Duration::from_secs(60)
            }
            "gmail" => {
                args.push("--max-results".into());
                args.push(settings.email.max_unread.to_string());
                args.push("--json".into());
                Duration::from_secs(45)
            }
            "jobs" => {
                if !settings.jobs.companies.is_empty() {
                    args.push("--companies".into());
                    args.push(settings.jobs.companies.join(","));
                }
                args.push("--keyword".into());
                args.push(settings.jobs.keyword.trim().to_string());
                args.push("--location".into());
                args.push(settings.jobs.location.trim().to_string());
                args.push("--limit".into());
                args.push(settings.jobs.limit.to_string());
                Duration::from_secs(90)
            }
            "calendar_sync" => {
                args.push("--mode".into());
                args.push(settings.calendar.mode.clone());
                if settings.calendar.google_enabled {
                    args.push("--google-calendar".into());
                    args.push(settings.calendar.google_calendar_name.clone());
                    args.push("--google-tasklist".into());
                    args.push(settings.calendar.google_tasklist_name.clone());
                } else {
                    args.push("--no-google".into());
                }
                if settings.calendar.apple_enabled {
                    args.push("--apple".into());
                    args.push("--apple-calendar".into());
                    args.push(settings.calendar.apple_calendar_name.clone());
                }
                if settings.calendar.include_completed {
                    args.push("--include-completed".into());
                }
                Duration::from_secs(60)
            }
            _ => Duration::from_secs(60),
        };

        let cmd_display = if normalized_key == "today" {
            format!(
                "{} {} && agent:finance_summary && gmail({})",
                self.python_bin.display(),
                args.join(" "),
                settings.email.to_addresses
            )
        } else {
            format!("{} {}", self.python_bin.display(), args.join(" "))
        };
        let run_id = self
            .db
            .insert_script_run(normalized_key.to_string(), cmd_display)
            .await?;

        let started = Instant::now();
        if normalized_key == "today" {
            let _ = self.feeds.refresh_finance_feeds().await;
        }

        let mut cmd = Command::new(&self.python_bin);
        cmd.args(&args)
            .current_dir(&self.vault_root)
            .env("PYTHONUNBUFFERED", "1");

        let exec_result = timeout(wait, cmd.output()).await;
        let mut raw_stdout = String::new();

        let (mut status, exit_code, mut output_log, mut summary_json) = match exec_result {
            Ok(Ok(out)) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let stderr = String::from_utf8_lossy(&out.stderr);
                raw_stdout = stdout.trim().to_string();
                let mut combined = String::new();
                if !stdout.trim().is_empty() {
                    combined.push_str(stdout.trim());
                }
                if !stderr.trim().is_empty() {
                    if !combined.is_empty() {
                        combined.push_str("\n--- stderr ---\n");
                    }
                    combined.push_str(stderr.trim());
                }
                let ok = out.status.success();
                let code = out.status.code();
                let summary = json!({
                    "ok": ok,
                    "lines": combined.lines().count(),
                })
                .to_string();
                (
                    if ok { "ok" } else { "error" }.to_string(),
                    code,
                    combined,
                    Some(summary),
                )
            }
            Ok(Err(e)) => (
                "error".to_string(),
                None,
                format!("启动 Python 脚本失败: {e}"),
                None,
            ),
            Err(_) => (
                "error".to_string(),
                None,
                format!("脚本执行超时（>{}s）", wait.as_secs()),
                None,
            ),
        };

        if normalized_key == "today" && status == "ok" {
            match self.summarize_finance_with_agent().await {
                Ok((mut fin_sum, fin_log)) => {
                    output_log.push_str("\n\n=== AI 金融订阅简报（Agent 自动总结） ===\n");
                    output_log.push_str(&fin_log);
                    let (mailed, mail_msg) = self.try_send_brief_email(&settings).await;
                    if mailed {
                        fin_sum.mailed_to = Some(settings.email.to_addresses.clone());
                        if let Ok(encoded) = serde_json::to_string(&fin_sum) {
                            let _ = self
                                .db
                                .set_meta("today_finance_brief_json".into(), encoded)
                                .await;
                        }
                    }
                    if !mail_msg.is_empty() {
                        output_log.push_str("\n\n=== Gmail 推送 ===\n");
                        output_log.push_str(&mail_msg);
                    }
                    summary_json = Some(
                        json!({
                            "ok": true,
                            "finance_summarized": true,
                            "finance_items": fin_sum.item_count,
                            "mailed": mailed,
                        })
                        .to_string(),
                    );
                }
                Err(err) => {
                    output_log.push_str(&format!(
                        "\n\n=== AI 金融订阅总结跳过/失败 ===\n{}",
                        err.1
                    ));
                    status = "ok".to_string();
                }
            }
        }

        if normalized_key == "gmail" && status == "ok" {
            match serde_json::from_str::<serde_json::Value>(&raw_stdout) {
                Ok(mut digest) => {
                    let total = digest
                        .get("accounts")
                        .and_then(|a| a.as_array())
                        .map(|accs| {
                            accs.iter()
                                .map(|acc| {
                                    acc.get("emails")
                                        .and_then(|e| e.as_array())
                                        .map(|e| e.len())
                                        .unwrap_or(0)
                                })
                                .sum::<usize>()
                        })
                        .unwrap_or(0);
                    if let Some(obj) = digest.as_object_mut() {
                        obj.insert("fetched_at".into(), json!(Utc::now().to_rfc3339()));
                        obj.insert("total_unread".into(), json!(total));
                    }
                    if let Ok(encoded) = serde_json::to_string(&digest) {
                        let _ = self.db.set_meta("gmail_digest_json".into(), encoded).await;
                    }
                    summary_json = Some(json!({ "ok": true, "unread": total }).to_string());
                    output_log = format!("[Gmail] 拉取未读邮件 {total} 封（IMAP 只读，不标记已读）\n\n{output_log}");
                }
                Err(e) => {
                    output_log.push_str(&format!("\n\n[Gmail] 未能解析 JSON 输出：{e}"));
                }
            }
        }

        if normalized_key == "jobs" && status == "ok" {
            if let Some(report) = self.load_job_watch() {
                let total = report.get("total_jobs").cloned().unwrap_or(json!(0));
                let fresh = report.get("total_new").cloned().unwrap_or(json!(0));
                summary_json = Some(json!({ "ok": true, "jobs": total, "new": fresh }).to_string());
            }
        }

        let duration_ms = started.elapsed().as_millis() as i64;
        self.running.write().await.remove(normalized_key);

        let truncated: String = output_log.chars().take(65536).collect();
        self.db
            .finish_script_run(run_id, status, exit_code, duration_ms, summary_json, truncated)
            .await?;

        if normalized_key == "today" {
            let _ = index_single_file(&self.vault_root, &self.db, "task/today.md").await;
            let _ = sync_tasks_to_db(&self.vault_root, &self.db).await;
        } else if normalized_key == "calendar_sync" {
            let _ = sync_tasks_to_db(&self.vault_root, &self.db).await;
            let _ = full_reindex(&self.vault_root, &self.db).await;
        } else if normalized_key == "jobs" {
            let _ = index_single_file(&self.vault_root, &self.db, JOB_WATCH_MD_REL).await;
        }

        let runs = self.db.list_script_runs(15).await?;
        runs.into_iter()
            .find(|r| r.id == run_id)
            .ok_or_else(|| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "回读脚本运行记录失败".into()))
    }
}

/// Generate a standard RFC 5545 VCALENDAR feed for Apple Calendar / Google Calendar subscription.
pub fn generate_tasks_ics(tasks: &[TaskRecord]) -> String {
    let now_stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//MyWiki Studio//Tasks Calendar//ZH".to_string(),
        "X-WR-CALNAME:MyWiki 任务".to_string(),
        "X-WR-TIMEZONE:Asia/Shanghai".to_string(),
        "CALSCALE:GREGORIAN".to_string(),
    ];

    for t in tasks {
        let Some(ref due) = t.due else {
            continue;
        };
        let Ok(d) = chrono::NaiveDate::parse_from_str(due.trim(), "%Y-%m-%d") else {
            continue;
        };
        let next_d = d + chrono::Duration::days(1);
        let done = matches!(t.status.as_str(), "done" | "cancelled");
        let summary = if done {
            format!("✓ [{}] {}", t.id, t.title)
        } else {
            format!("[{}] {}", t.id, t.title)
        };
        let esc = |s: &str| {
            s.replace('\\', "\\\\")
                .replace('\n', "\\n")
                .replace(',', "\\,")
                .replace(';', "\\;")
        };
        let desc = format!(
            "状态: {} | 优先级: {} | 分类: {}\\n文件: {}\\n[mywiki:{}]",
            t.status, t.priority, t.category, t.file_path, t.id
        );
        lines.push("BEGIN:VEVENT".into());
        lines.push(format!("UID:mywiki-{}@local", t.id.to_lowercase()));
        lines.push(format!("DTSTAMP:{now_stamp}"));
        lines.push(format!("DTSTART;VALUE=DATE:{}", d.format("%Y%m%d")));
        lines.push(format!("DTEND;VALUE=DATE:{}", next_d.format("%Y%m%d")));
        lines.push(format!("SUMMARY:{}", esc(&summary)));
        lines.push(format!("DESCRIPTION:{}", esc(&desc)));
        lines.push(format!("STATUS:{}", if done { "CANCELLED" } else { "CONFIRMED" }));
        lines.push("END:VEVENT".into());
    }

    lines.push("END:VCALENDAR".into());
    lines.join("\r\n") + "\r\n"
}

const FINANCE_SUMMARY_HEADING: &str = "## AI 金融订阅简报（Agent 自动总结）";

fn upsert_finance_summary_in_today_md(
    vault_root: &Path,
    summary: &FinanceBriefSummary,
) -> Result<(), ApiError> {
    let path = vault_root.join("task/today.md");
    if !path.exists() {
        return Ok(());
    }
    let raw = fs::read_to_string(&path).map_err(|e| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("读取 task/today.md 失败: {e}"),
        )
    })?;

    let block = format!(
        "{FINANCE_SUMMARY_HEADING}\n\n> 生成于 {} · 基于最新 {} 条金融订阅（核心财经 / 财经监管 / 机构与人物）\n\n{}\n",
        summary.generated_at,
        summary.item_count,
        summary.markdown.trim()
    );

    let cleaned = if let Some(start) = raw.find(FINANCE_SUMMARY_HEADING) {
        let after_start = &raw[start + FINANCE_SUMMARY_HEADING.len()..];
        if let Some(next_h2_rel) = after_start.find("\n## ") {
            format!("{}{}", raw[..start].trim_end(), &after_start[next_h2_rel..])
        } else {
            raw[..start].trim_end().to_string()
        }
    } else {
        raw
    };

    let updated = if let Some(pos) = cleaned.find("## 今日金融订阅资讯") {
        format!("{}\n\n{}\n{}", cleaned[..pos].trim_end(), block, &cleaned[pos..])
    } else if let Some(pos) = cleaned.find("## 最新 AI 博客") {
        format!("{}\n\n{}\n{}", cleaned[..pos].trim_end(), block, &cleaned[pos..])
    } else {
        format!("{}\n\n{}\n", cleaned.trim_end(), block)
    };

    atomic_write(&path, &updated)
}

pub fn parse_today_brief(vault_root: &Path) -> TodayBrief {
    let path = vault_root.join("task/today.md");
    let Ok(raw) = fs::read_to_string(&path) else {
        return TodayBrief {
            exists: false,
            date_heading: None,
            whv_lines: Vec::new(),
            whv_alert: false,
            blog_links: Vec::new(),
            raw_markdown: String::new(),
        };
    };

    let mut date_heading = None;
    let mut section = "";
    let mut provider = String::new();
    let mut whv_lines = Vec::new();
    let mut whv_alert = false;
    let mut blog_links = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if date_heading.is_none() && trimmed.starts_with("# ") {
            date_heading = Some(trimmed.trim_start_matches("# ").trim().to_string());
            continue;
        }
        if let Some(h2) = trimmed.strip_prefix("## ") {
            if h2.contains("WHV") {
                section = "whv";
            } else if h2.contains("博客") || h2.to_lowercase().contains("blog") {
                section = "blogs";
            } else {
                section = "other";
            }
            continue;
        }
        if section == "whv" {
            if trimmed.starts_with("- **") {
                if trimmed.contains("已开放") || trimmed.contains("可申请") {
                    whv_alert = true;
                }
                whv_lines.push(trimmed.trim_start_matches("- ").to_string());
            }
        } else if section == "blogs" {
            if let Some(h3) = trimmed.strip_prefix("### ") {
                provider = h3
                    .split('（')
                    .next()
                    .unwrap_or(h3)
                    .trim()
                    .to_string();
            } else if let Some(rest) = trimmed.strip_prefix("- [") {
                if let Some((title, after_bracket)) = rest.split_once("](") {
                    if let Some((url, tail)) = after_bracket.split_once(')') {
                        let meta = tail
                            .trim()
                            .trim_start_matches('—')
                            .trim()
                            .trim_matches('*')
                            .to_string();
                        blog_links.push(TodayBlogLink {
                            title: title.trim().to_string(),
                            url: url.trim().to_string(),
                            provider: if provider.is_empty() {
                                "AI Blog".into()
                            } else {
                                provider.clone()
                            },
                            meta,
                        });
                    }
                }
            }
        }
    }

    TodayBrief {
        exists: true,
        date_heading,
        whv_lines,
        whv_alert,
        blog_links: blog_links.into_iter().take(40).collect(),
        raw_markdown: raw,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_valid_ics_from_tasks() {
        let tasks = vec![TaskRecord {
            id: "T-001".into(),
            source: "by_task".into(),
            file_path: "task/by-task/T-001-demo.md".into(),
            title: "测试日历同步".into(),
            status: "todo".into(),
            due: Some("2026-12-01".into()),
            priority: "high".into(),
            category: "personal".into(),
            notes: "".into(),
            updated_at: "".into(),
        }];
        let ics = generate_tasks_ics(&tasks);
        assert!(ics.contains("BEGIN:VCALENDAR"));
        assert!(ics.contains("DTSTART;VALUE=DATE:20261201"));
        assert!(ics.contains("DTEND;VALUE=DATE:20261202"));
        assert!(ics.contains("SUMMARY:[T-001] 测试日历同步"));
        assert!(ics.contains("END:VCALENDAR"));
    }
}

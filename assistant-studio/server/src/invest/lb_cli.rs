use std::{
    collections::HashMap,
    env,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{process::Command, sync::RwLock, time::timeout};

use crate::ApiError;

#[derive(Clone)]
pub struct LongbridgeCli {
    bin: PathBuf,
    agents_cache: Arc<RwLock<Option<(Instant, Value)>>>,
    intel_cache: Arc<RwLock<HashMap<String, (Instant, Value)>>>,
}

#[derive(Deserialize)]
pub struct AgentChatRequest {
    pub agent_uid: String,
    pub query: String,
    pub chat_uid: Option<String>,
    pub parent_message_id: Option<String>,
}

#[derive(Serialize)]
pub struct AgentStatus {
    pub cli_available: bool,
    pub authenticated: bool,
    pub status: String,
    pub dc_region: Option<String>,
    pub logged_in_at: Option<i64>,
    pub packages_count: usize,
    pub detail: Option<String>,
}

fn resolve_bin() -> PathBuf {
    if let Some(explicit) = env::var_os("LONGBRIDGE_BIN").filter(|v| !v.is_empty()) {
        return PathBuf::from(explicit);
    }
    if let Some(home) = env::var_os("HOME") {
        let local = PathBuf::from(home).join(".local/bin/longbridge");
        if local.exists() {
            return local;
        }
    }
    PathBuf::from("longbridge")
}

impl LongbridgeCli {
    pub fn new() -> Self {
        Self {
            bin: resolve_bin(),
            agents_cache: Arc::new(RwLock::new(None)),
            intel_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    async fn run_json(&self, args: &[&str], wait: Duration) -> Result<Value, ApiError> {
        let mut cmd = Command::new(&self.bin);
        cmd.args(args);
        cmd.env("NO_COLOR", "1");
        let output = timeout(wait, cmd.output())
            .await
            .map_err(|_| ApiError(StatusCode::GATEWAY_TIMEOUT, "长桥 Agent 响应超时".into()))?
            .map_err(|e| {
                ApiError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    format!("无法调用 longbridge CLI: {e}"),
                )
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let msg = if !stderr.is_empty() { stderr } else { stdout };
            return Err(ApiError(
                StatusCode::BAD_GATEWAY,
                if msg.is_empty() {
                    "长桥 CLI 执行失败".into()
                } else {
                    msg
                },
            ));
        }

        let raw = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(raw.trim()).map_err(|e| {
            ApiError(
                StatusCode::BAD_GATEWAY,
                format!("解析长桥 CLI JSON 失败: {e}"),
            )
        })
    }

    pub async fn auth_status(&self) -> AgentStatus {
        match self
            .run_json(&["auth", "status", "--format", "json"], Duration::from_secs(10))
            .await
        {
            Ok(val) => {
                let status = val
                    .pointer("/token/status")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string();
                let authenticated = status.eq_ignore_ascii_case("valid");
                let dc_region = val
                    .pointer("/token/dc_region")
                    .and_then(Value::as_str)
                    .map(str::to_uppercase);
                let logged_in_at = val.pointer("/token/logged_in_at").and_then(Value::as_i64);
                let packages_count = val
                    .pointer("/account/activated_packages")
                    .and_then(Value::as_array)
                    .map(|a| a.len())
                    .unwrap_or(0);
                AgentStatus {
                    cli_available: true,
                    authenticated,
                    status,
                    dc_region,
                    logged_in_at,
                    packages_count,
                    detail: None,
                }
            }
            Err(ApiError(code, msg)) => AgentStatus {
                cli_available: code != StatusCode::SERVICE_UNAVAILABLE,
                authenticated: false,
                status: "unauthenticated".into(),
                dc_region: None,
                logged_in_at: None,
                packages_count: 0,
                detail: Some(msg),
            },
        }
    }

    pub async fn login_with_code(&self, auth_code: &str) -> Result<AgentStatus, ApiError> {
        let trimmed = auth_code.trim();
        if trimmed.is_empty() || trimmed.len() > 512 {
            return Err(ApiError(StatusCode::BAD_REQUEST, "请输入有效的授权码".into()));
        }
        let mut cmd = Command::new(&self.bin);
        cmd.args(["auth", "login", "--auth-code", trimmed]);
        let output = timeout(Duration::from_secs(20), cmd.output())
            .await
            .map_err(|_| ApiError(StatusCode::GATEWAY_TIMEOUT, "授权请求超时".into()))?
            .map_err(|e| {
                ApiError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    format!("无法调用 longbridge CLI: {e}"),
                )
            })?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                if !err.is_empty() { err } else { out },
            ));
        }
        *self.agents_cache.write().await = None;
        Ok(self.auth_status().await)
    }

    pub async fn list_agents(&self) -> Result<Value, ApiError> {
        {
            let guard = self.agents_cache.read().await;
            if let Some((at, cached)) = guard.as_ref() {
                if at.elapsed() < Duration::from_secs(600) {
                    return Ok(cached.clone());
                }
            }
        }
        let val = self
            .run_json(&["agent", "list", "--format", "json"], Duration::from_secs(20))
            .await?;
        let agents = val
            .get("agents")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let slim: Vec<Value> = agents
            .into_iter()
            .filter(|a| a.get("is_published").and_then(Value::as_bool).unwrap_or(true))
            .map(|a| {
                json!({
                    "uid": a.get("uid").and_then(Value::as_str).unwrap_or(""),
                    "name": a.get("name").and_then(Value::as_str).unwrap_or(""),
                    "description": a.get("description").and_then(Value::as_str).unwrap_or(""),
                    "mode": a.get("mode").and_then(Value::as_str).unwrap_or("chat"),
                })
            })
            .collect();
        let payload = json!({ "agents": slim });
        *self.agents_cache.write().await = Some((Instant::now(), payload.clone()));
        Ok(payload)
    }

    pub async fn chat(&self, req: AgentChatRequest) -> Result<Value, ApiError> {
        let uid = req.agent_uid.trim();
        let query = req.query.trim();
        if uid.is_empty() || query.is_empty() {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "agent_uid 和提问内容不能为空".into(),
            ));
        }
        if !uid
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(ApiError(StatusCode::BAD_REQUEST, "无效的 agent_uid".into()));
        }

        let mut args: Vec<String> = vec![
            "agent".into(),
            "chat".into(),
            uid.into(),
            "--format".into(),
            "json".into(),
            "--lang".into(),
            "zh-CN".into(),
        ];
        if let (Some(chat_uid), Some(parent_id)) = (
            req.chat_uid.as_deref().filter(|s| !s.trim().is_empty()),
            req.parent_message_id
                .as_deref()
                .filter(|s| !s.trim().is_empty()),
        ) {
            args.push("--chat-uid".into());
            args.push(chat_uid.trim().into());
            args.push("--parent-message-id".into());
            args.push(parent_id.trim().into());
        }
        args.push(query.into());

        let str_args: Vec<&str> = args.iter().map(String::as_str).collect();
        self.run_json(&str_args, Duration::from_secs(150)).await
    }

    pub async fn symbol_intel(&self, symbol: &str) -> Result<Value, ApiError> {
        let sym = symbol.trim().to_uppercase();
        {
            let guard = self.intel_cache.read().await;
            if let Some((at, cached)) = guard.get(&sym) {
                if at.elapsed() < Duration::from_secs(60) {
                    return Ok(cached.clone());
                }
            }
        }

        let market = if sym.ends_with(".HK") { "HK" } else { "US" };
        let is_index = sym.starts_with('.');
        let temp_args = ["market-temp", market, "--format", "json"];
        let news_args = ["news", &sym, "--format", "json", "--lang", "zh-CN"];

        let (temp_res, calc_res, cap_res, rep_res, news_res, filing_res) = tokio::join!(
            self.run_json(&temp_args, Duration::from_secs(15)),
            async {
                if is_index {
                    Err(ApiError(StatusCode::NOT_FOUND, "index".into()))
                } else {
                    self.run_json(
                        &["calc-index", &sym, "--format", "json"],
                        Duration::from_secs(15),
                    )
                    .await
                }
            },
            async {
                if is_index {
                    Err(ApiError(StatusCode::NOT_FOUND, "index".into()))
                } else {
                    self.run_json(
                        &["capital", &sym, "--format", "json"],
                        Duration::from_secs(15),
                    )
                    .await
                }
            },
            async {
                if is_index {
                    Err(ApiError(StatusCode::NOT_FOUND, "index".into()))
                } else {
                    self.run_json(
                        &["financial-report", &sym, "--latest", "--format", "json"],
                        Duration::from_secs(15),
                    )
                    .await
                }
            },
            self.run_json(&news_args, Duration::from_secs(15)),
            async {
                if is_index {
                    Err(ApiError(StatusCode::NOT_FOUND, "index".into()))
                } else {
                    self.run_json(
                        &["filing", &sym, "--format", "json"],
                        Duration::from_secs(15),
                    )
                    .await
                }
            },
        );

        let market_temp = temp_res.ok().and_then(|v| {
            let arr = v.as_array()?;
            let find = |k: &str| {
                arr.iter()
                    .find(|item| item.get("field").and_then(Value::as_str) == Some(k))
                    .and_then(|item| item.get("value").and_then(Value::as_str))
                    .map(str::to_string)
            };
            Some(json!({
                "market": find("Market").unwrap_or_else(|| market.into()),
                "temperature": find("Temperature").and_then(|s| s.parse::<i32>().ok()),
                "valuation": find("Valuation").and_then(|s| s.parse::<i32>().ok()),
                "sentiment": find("Sentiment").and_then(|s| s.parse::<i32>().ok()),
                "description": find("Description"),
            }))
        });

        let calc = calc_res
            .ok()
            .and_then(|v| v.as_array().and_then(|a| a.first()).cloned());
        let capital = cap_res.ok();
        let report = rep_res.ok();
        let news: Vec<Value> = news_res
            .ok()
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .take(10)
            .collect();
        let filings: Vec<Value> = filing_res
            .ok()
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .take(8)
            .collect();

        let bundle = json!({
            "symbol": sym,
            "market_temp": market_temp,
            "calc": calc,
            "capital": capital,
            "report": report,
            "news": news,
            "filings": filings,
        });

        self.intel_cache
            .write()
            .await
            .insert(sym, (Instant::now(), bundle.clone()));
        Ok(bundle)
    }
}

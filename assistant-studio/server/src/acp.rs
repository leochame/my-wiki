use std::{
    path::PathBuf,
    process::Stdio,
    time::Duration,
};

use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::mpsc,
    time::timeout,
};

use crate::{
    config::find_binary,
    db::{AcpSessionRecord, Database},
    ApiError,
};

#[derive(Clone, Debug, Serialize)]
pub struct AcpProviderInfo {
    pub id: String,
    pub label: String,
    pub protocol: String, // acp-stdio | claude-stream | codex-exec
    pub available: bool,
    pub binary: Option<String>,
    pub detail: String,
}

#[derive(Deserialize)]
pub struct CreateSessionRequest {
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub title: String,
}

#[derive(Deserialize)]
pub struct PromptRequest {
    pub prompt: String,
    #[serde(default)]
    pub context_files: Vec<String>,
    #[serde(default)]
    pub allow_writes: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct StreamFrame {
    pub kind: String, // delta | tool | permission_request | done | error | status
    pub data: Value,
}

fn default_provider() -> String {
    "claude".into()
}

#[derive(Clone)]
pub struct AcpHost {
    vault_root: PathBuf,
    db: Database,
}

impl AcpHost {
    pub fn new(vault_root: PathBuf, db: Database) -> Self {
        Self { vault_root, db }
    }

    pub fn detect_providers(&self) -> Vec<AcpProviderInfo> {
        let claude_bin = find_binary("claude", Some("CLAUDE_BIN"));
        let claude_acp = find_binary("claude-code-acp", Some("ACP_CLAUDE_BIN"));
        let gemini_bin = find_binary("gemini", Some("ACP_GEMINI_BIN"));
        let codex_bin = find_binary("codex", Some("CODEX_BIN"));

        vec![
            AcpProviderInfo {
                id: "claude".into(),
                label: "Claude Code".into(),
                protocol: "claude-stream".into(),
                available: claude_bin.is_some(),
                binary: claude_bin.map(|p| p.display().to_string()),
                detail: "本机 Claude Code CLI（流式 JSON + 多轮 --resume）".into(),
            },
            AcpProviderInfo {
                id: "claude-acp".into(),
                label: "Claude Code (ACP)".into(),
                protocol: "acp-stdio".into(),
                available: claude_acp.is_some(),
                binary: claude_acp.map(|p| p.display().to_string()),
                detail: "标准 ACP JSON-RPC 2.0 适配器（npm i -g @zed-industries/claude-code-acp）"
                    .into(),
            },
            AcpProviderInfo {
                id: "gemini-acp".into(),
                label: "Gemini CLI (ACP)".into(),
                protocol: "acp-stdio".into(),
                available: gemini_bin.is_some(),
                binary: gemini_bin.map(|p| p.display().to_string()),
                detail: "原生 gemini --acp 协议（npm i -g @google/gemini-cli）".into(),
            },
            AcpProviderInfo {
                id: "codex".into(),
                label: "Codex CLI".into(),
                protocol: "codex-exec".into(),
                available: codex_bin.is_some(),
                binary: codex_bin.map(|p| p.display().to_string()),
                detail: "本机 Codex CLI（codex exec --json）".into(),
            },
        ]
    }

    pub async fn create_session(&self, req: CreateSessionRequest) -> Result<AcpSessionRecord, ApiError> {
        let providers = self.detect_providers();
        let chosen = providers
            .iter()
            .find(|p| p.id == req.provider)
            .ok_or_else(|| ApiError(StatusCode::BAD_REQUEST, format!("不支持的引擎: {}", req.provider)))?;
        if !chosen.available {
            return Err(ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                format!("本机未检测到 {}（{}）", chosen.label, chosen.detail),
            ));
        }
        let sid = format!("acp-{}", &uuid::Uuid::new_v4().to_string()[..12]);
        let title = if req.title.trim().is_empty() {
            format!("新对话 · {}", chosen.label)
        } else {
            req.title.trim().to_string()
        };
        self.db
            .create_acp_session(
                sid,
                chosen.id.clone(),
                title,
                self.vault_root.display().to_string(),
            )
            .await
    }

    fn compose_prompt(&self, prompt: &str, context_files: &[String]) -> String {
        if context_files.is_empty() {
            return prompt.trim().to_string();
        }
        let mut prefix = String::from("以下是用户指定的 Vault 上下文文件，请优先结合它们回答：\n");
        for rel in context_files.iter().take(5) {
            let trimmed = rel.trim();
            if trimmed.is_empty() || trimmed.contains("..") {
                continue;
            }
            let abs = self.vault_root.join(trimmed);
            if let Ok(content) = std::fs::read_to_string(&abs) {
                let snippet: String = content.chars().take(6000).collect();
                prefix.push_str(&format!("\n--- FILE: {trimmed} ---\n{snippet}\n"));
            }
        }
        prefix.push_str("\n--- 用户请求 ---\n");
        prefix.push_str(prompt.trim());
        prefix
    }

    pub async fn run_prompt_streaming(
        &self,
        session_id: &str,
        req: PromptRequest,
        tx: mpsc::Sender<StreamFrame>,
    ) -> Result<(), ApiError> {
        let session = self
            .db
            .get_acp_session(session_id.to_string())
            .await?
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "会话不存在".into()))?;

        let raw_prompt = req.prompt.trim();
        if raw_prompt.is_empty() {
            return Err(ApiError(StatusCode::BAD_REQUEST, "提问内容不能为空".into()));
        }

        // Update session title on first user turn
        let existing_events = self.db.list_acp_events(session_id.to_string()).await?;
        if existing_events.is_empty() {
            let short_title: String = raw_prompt.chars().take(28).collect();
            let _ = self
                .db
                .update_acp_session(
                    session_id.to_string(),
                    None,
                    Some(short_title),
                    Some("working".into()),
                )
                .await;
        } else {
            let _ = self
                .db
                .update_acp_session(session_id.to_string(), None, None, Some("working".into()))
                .await;
        }

        self.db
            .append_acp_event(
                session_id.to_string(),
                "user".into(),
                json!({
                    "text": raw_prompt,
                    "context_files": req.context_files,
                })
                .to_string(),
            )
            .await?;

        let mut full_prompt = self.compose_prompt(raw_prompt, &req.context_files);
        // If session was reverted (external_session_id cleared) but earlier turns survive,
        // replay a compact transcript so the Agent retains conversation continuity.
        if session.external_session_id.as_deref().unwrap_or("").is_empty() && !existing_events.is_empty() {
            let mut history = String::from("以下是本会话此前保留的对话记录（用户已回退到此处继续提问）：\n");
            for ev in existing_events.iter().rev().take(12).rev() {
                if ev.kind == "user" || ev.kind == "assistant" {
                    if let Ok(v) = serde_json::from_str::<Value>(&ev.payload_json) {
                        if let Some(txt) = v.get("text").and_then(Value::as_str) {
                            let role = if ev.kind == "user" { "用户" } else { "助理" };
                            let clipped: String = txt.chars().take(1200).collect();
                            history.push_str(&format!("\n[{role}]: {clipped}\n"));
                        }
                    }
                }
            }
            history.push_str("\n---\n");
            history.push_str(&full_prompt);
            full_prompt = history;
        }

        let result = match session.provider.as_str() {
            "claude" => {
                self.run_claude_stream(&session, &full_prompt, req.allow_writes, &tx)
                    .await
            }
            "claude-acp" | "gemini-acp" => {
                self.run_acp_stdio(&session, &full_prompt, req.allow_writes, &tx)
                    .await
            }
            "codex" => self.run_codex_exec(&session, &full_prompt, &tx).await,
            other => Err(ApiError(
                StatusCode::BAD_REQUEST,
                format!("未知引擎: {other}"),
            )),
        };

        let _ = self
            .db
            .update_acp_session(session_id.to_string(), None, None, Some("idle".into()))
            .await;

        if let Err(ref err) = result {
            let _ = self
                .db
                .append_acp_event(
                    session_id.to_string(),
                    "error".into(),
                    json!({ "message": err.1 }).to_string(),
                )
                .await;
            let _ = tx
                .send(StreamFrame {
                    kind: "error".into(),
                    data: json!({ "message": err.1 }),
                })
                .await;
        }
        result
    }

    async fn run_claude_stream(
        &self,
        session: &AcpSessionRecord,
        prompt: &str,
        allow_writes: bool,
        tx: &mpsc::Sender<StreamFrame>,
    ) -> Result<(), ApiError> {
        let bin = find_binary("claude", Some("CLAUDE_BIN")).ok_or_else(|| {
            ApiError(StatusCode::SERVICE_UNAVAILABLE, "未找到 claude CLI".into())
        })?;

        let mut cmd = Command::new(bin);
        cmd.current_dir(&self.vault_root)
            .arg("-p")
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose");

        if !allow_writes {
            cmd.arg("--permission-mode").arg("plan");
        }
        if let Some(ext) = session.external_session_id.as_deref().filter(|s| !s.is_empty()) {
            cmd.arg("--resume").arg(ext);
        }
        cmd.arg(prompt)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            ApiError(
                StatusCode::BAD_GATEWAY,
                format!("启动 claude CLI 失败: {e}"),
            )
        })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            ApiError(StatusCode::INTERNAL_SERVER_ERROR, "无法读取 claude stdout".into())
        })?;
        let mut lines = BufReader::new(stdout).lines();

        let mut final_answer = String::new();
        let mut new_ext_session: Option<String> = None;
        let mut duration_ms: Option<i64> = None;

        while let Ok(Some(line)) = timeout(Duration::from_secs(180), lines.next_line())
            .await
            .map_err(|_| ApiError(StatusCode::GATEWAY_TIMEOUT, "Claude 响应超时".into()))?
        {
            let trimmed = line.trim();
            if !trimmed.starts_with('{') {
                continue;
            }
            let Ok(val) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };
            if let Some(sid) = val.get("session_id").and_then(Value::as_str) {
                if !sid.is_empty() {
                    new_ext_session = Some(sid.to_string());
                }
            }
            match val.get("type").and_then(Value::as_str) {
                Some("assistant") => {
                    if let Some(blocks) = val.pointer("/message/content").and_then(Value::as_array) {
                        for block in blocks {
                            match block.get("type").and_then(Value::as_str) {
                                Some("text") => {
                                    if let Some(t) = block.get("text").and_then(Value::as_str) {
                                        if !t.is_empty() {
                                            final_answer = t.to_string();
                                            let _ = tx
                                                .send(StreamFrame {
                                                    kind: "delta".into(),
                                                    data: json!({ "text": t, "replace": true }),
                                                })
                                                .await;
                                        }
                                    }
                                }
                                Some("tool_use") => {
                                    let name = block
                                        .get("name")
                                        .and_then(Value::as_str)
                                        .unwrap_or("tool");
                                    let input = block.get("input").cloned().unwrap_or(json!({}));
                                    let tool_payload = json!({ "name": name, "input": input });
                                    let _ = self
                                        .db
                                        .append_acp_event(
                                            session.session_id.clone(),
                                            "tool_call".into(),
                                            tool_payload.to_string(),
                                        )
                                        .await;
                                    let _ = tx
                                        .send(StreamFrame {
                                            kind: "tool".into(),
                                            data: tool_payload,
                                        })
                                        .await;
                                }
                                _ => {}
                            }
                        }
                    }
                }
                Some("user") => {
                    if let Some(blocks) = val.pointer("/message/content").and_then(Value::as_array) {
                        for block in blocks {
                            if block.get("type").and_then(Value::as_str) == Some("tool_result") {
                                let raw_out = match block.get("content") {
                                    Some(Value::String(s)) => s.clone(),
                                    Some(Value::Array(arr)) => arr
                                        .iter()
                                        .filter_map(|x| x.get("text").and_then(Value::as_str))
                                        .collect::<Vec<_>>()
                                        .join("\n"),
                                    Some(other) => other.to_string(),
                                    None => String::new(),
                                };
                                let trimmed_out: String = raw_out.chars().take(800).collect();
                                let is_err = block
                                    .get("is_error")
                                    .and_then(Value::as_bool)
                                    .unwrap_or(false);
                                if !trimmed_out.trim().is_empty() {
                                    let res_payload = json!({
                                        "output": trimmed_out,
                                        "is_error": is_err,
                                    });
                                    let _ = self
                                        .db
                                        .append_acp_event(
                                            session.session_id.clone(),
                                            "tool_result".into(),
                                            res_payload.to_string(),
                                        )
                                        .await;
                                    let _ = tx
                                        .send(StreamFrame {
                                            kind: "tool_result".into(),
                                            data: res_payload,
                                        })
                                        .await;
                                }
                            }
                        }
                    }
                }
                Some("result") => {
                    duration_ms = val.get("duration_ms").and_then(Value::as_i64);
                    if let Some(res_text) = val.get("result").and_then(Value::as_str) {
                        if !res_text.trim().is_empty() {
                            final_answer = res_text.to_string();
                        }
                    }
                    if val.get("is_error").and_then(Value::as_bool) == Some(true) {
                        return Err(ApiError(
                            StatusCode::BAD_GATEWAY,
                            if final_answer.is_empty() {
                                "Claude 执行返回错误".into()
                            } else {
                                final_answer
                            },
                        ));
                    }
                }
                _ => {}
            }
        }

        let _ = child.wait().await;
        if let Some(ext) = new_ext_session {
            let _ = self
                .db
                .update_acp_session(session.session_id.clone(), Some(ext), None, None)
                .await;
        }

        let payload = json!({
            "text": if final_answer.is_empty() { "（未返回正文）" } else { final_answer.as_str() },
            "duration_ms": duration_ms,
        });
        self.db
            .append_acp_event(
                session.session_id.clone(),
                "assistant".into(),
                payload.to_string(),
            )
            .await?;

        let _ = tx
            .send(StreamFrame {
                kind: "done".into(),
                data: payload,
            })
            .await;
        Ok(())
    }

    /// Standard Agent Client Protocol (ACP) JSON-RPC 2.0 over stdio NDJSON driver
    /// for `@zed-industries/claude-code-acp` and `gemini --acp`.
    async fn run_acp_stdio(
        &self,
        session: &AcpSessionRecord,
        prompt: &str,
        allow_writes: bool,
        tx: &mpsc::Sender<StreamFrame>,
    ) -> Result<(), ApiError> {
        let (bin, args): (PathBuf, Vec<&str>) = if session.provider == "gemini-acp" {
            let b = find_binary("gemini", Some("ACP_GEMINI_BIN")).ok_or_else(|| {
                ApiError(StatusCode::SERVICE_UNAVAILABLE, "未检测到 gemini CLI".into())
            })?;
            (b, vec!["--acp"])
        } else {
            let b = find_binary("claude-code-acp", Some("ACP_CLAUDE_BIN")).ok_or_else(|| {
                ApiError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "未检测到 claude-code-acp 适配器".into(),
                )
            })?;
            (b, Vec::new())
        };

        let mut child = Command::new(bin)
            .args(args)
            .current_dir(&self.vault_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, format!("启动 ACP 进程失败: {e}")))?;

        let mut stdin = child.stdin.take().ok_or_else(|| {
            ApiError(StatusCode::INTERNAL_SERVER_ERROR, "无法打开 ACP stdin".into())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            ApiError(StatusCode::INTERNAL_SERVER_ERROR, "无法打开 ACP stdout".into())
        })?;
        let mut lines = BufReader::new(stdout).lines();

        // 1. initialize
        let init_req = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": 1,
                "clientCapabilities": { "fs": { "readTextFile": true, "writeTextFile": allow_writes } },
                "clientInfo": { "name": "mywiki-studio", "version": "0.1.0" }
            }
        });
        write_ndjson(&mut stdin, &init_req).await?;
        let _ = read_rpc_response(&mut lines, 1, tx, &mut String::new(), &mut stdin, allow_writes).await?;

        // 2. session/new
        let new_req = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "session/new",
            "params": { "cwd": self.vault_root.display().to_string(), "mcpServers": [] }
        });
        write_ndjson(&mut stdin, &new_req).await?;
        let new_resp =
            read_rpc_response(&mut lines, 2, tx, &mut String::new(), &mut stdin, allow_writes)
                .await?;
        let acp_sid = new_resp
            .pointer("/result/sessionId")
            .and_then(Value::as_str)
            .unwrap_or("default")
            .to_string();

        // 3. session/prompt
        let prompt_req = json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "session/prompt",
            "params": {
                "sessionId": acp_sid,
                "prompt": [{ "type": "text", "text": prompt }]
            }
        });
        write_ndjson(&mut stdin, &prompt_req).await?;
        let mut acc = String::new();
        let _ = read_rpc_response(&mut lines, 3, tx, &mut acc, &mut stdin, allow_writes).await?;

        let _ = child.kill().await;

        let payload = json!({ "text": if acc.is_empty() { "（ACP 未返回正文）" } else { acc.as_str() } });
        self.db
            .append_acp_event(
                session.session_id.clone(),
                "assistant".into(),
                payload.to_string(),
            )
            .await?;
        let _ = tx
            .send(StreamFrame {
                kind: "done".into(),
                data: payload,
            })
            .await;
        Ok(())
    }

    async fn run_codex_exec(
        &self,
        session: &AcpSessionRecord,
        prompt: &str,
        tx: &mpsc::Sender<StreamFrame>,
    ) -> Result<(), ApiError> {
        let bin = find_binary("codex", Some("CODEX_BIN")).ok_or_else(|| {
            ApiError(StatusCode::SERVICE_UNAVAILABLE, "未找到 codex CLI".into())
        })?;
        let output = timeout(
            Duration::from_secs(180),
            Command::new(bin)
                .current_dir(&self.vault_root)
                .args(["exec", "--skip-git-repo-check", prompt])
                .output(),
        )
        .await
        .map_err(|_| ApiError(StatusCode::GATEWAY_TIMEOUT, "Codex 执行超时".into()))?
        .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, format!("启动 codex 失败: {e}")))?;

        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !output.status.success() && text.is_empty() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(ApiError(StatusCode::BAD_GATEWAY, err));
        }
        let payload = json!({ "text": text });
        self.db
            .append_acp_event(
                session.session_id.clone(),
                "assistant".into(),
                payload.to_string(),
            )
            .await?;
        let _ = tx
            .send(StreamFrame {
                kind: "done".into(),
                data: payload,
            })
            .await;
        Ok(())
    }
}

async fn write_ndjson(
    stdin: &mut tokio::process::ChildStdin,
    val: &Value,
) -> Result<(), ApiError> {
    let mut line = serde_json::to_string(val)
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    line.push('\n');
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, format!("写入 ACP 管道失败: {e}")))?;
    stdin
        .flush()
        .await
        .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, format!("刷新 ACP 管道失败: {e}")))
}

async fn read_rpc_response(
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    expect_id: i64,
    tx: &mpsc::Sender<StreamFrame>,
    acc: &mut String,
    stdin: &mut tokio::process::ChildStdin,
    allow_writes: bool,
) -> Result<Value, ApiError> {
    while let Ok(Some(line)) = timeout(Duration::from_secs(120), lines.next_line())
        .await
        .map_err(|_| ApiError(StatusCode::GATEWAY_TIMEOUT, "ACP 响应超时".into()))?
    {
        let trimmed = line.trim();
        if !trimmed.starts_with('{') {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if msg.get("id").and_then(Value::as_i64) == Some(expect_id) && msg.get("method").is_none() {
            if let Some(err) = msg.get("error") {
                return Err(ApiError(StatusCode::BAD_GATEWAY, format!("ACP 错误: {err}")));
            }
            return Ok(msg);
        }
        match msg.get("method").and_then(Value::as_str) {
            Some("session/update") => {
                if let Some(text) = msg
                    .pointer("/params/update/content/text")
                    .or_else(|| msg.pointer("/params/update/delta"))
                    .and_then(Value::as_str)
                {
                    acc.push_str(text);
                    let _ = tx
                        .send(StreamFrame {
                            kind: "delta".into(),
                            data: json!({ "text": acc, "replace": true }),
                        })
                        .await;
                }
            }
            Some("session/request_permission") => {
                if let Some(req_id) = msg.get("id").cloned() {
                    let outcome = if allow_writes {
                        json!({ "outcome": "selected", "optionId": "allow_once" })
                    } else {
                        json!({ "outcome": "cancelled" })
                    };
                    let reply = json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": { "outcome": outcome }
                    });
                    let _ = write_ndjson(stdin, &reply).await;
                }
            }
            _ => {}
        }
    }
    Err(ApiError(StatusCode::BAD_GATEWAY, "ACP 进程提前退出".into()))
}

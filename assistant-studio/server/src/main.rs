mod acp;
mod config;
mod db;
mod feed_catalog;
mod feeds;
mod invest;
mod runner;
mod tasks;
mod vault;

use std::{convert::Infallible, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

use acp::{AcpHost, AcpProviderInfo, CreateSessionRequest, PromptRequest};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
    Json, Router,
};
use chrono::Local;
use config::AppConfig;
use db::{
    AcpEventRecord, AcpSessionRecord, Database, FeedItemRecord, FeedSourceRecord, HighlightRecord,
    ScriptRunRecord, SearchHit, TaskRecord, VaultFileRecord,
};
use feeds::{AddFeedSourceRequest, ArchiveArticleRequest, FeedManager, ImportOpmlRequest, ReaderResponse};
use futures_util::{SinkExt, StreamExt};
use invest::InvestState;
use notify::{EventKind, RecursiveMode, Watcher};
use reqwest::Client;
use runner::{
    generate_tasks_ics, parse_today_brief, FinanceBriefSummary, ScriptDef, ScriptRunner,
    ScriptSettings, ScriptSettingsResponse, TodayBrief, SCRIPTS,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tasks::{CreateTaskRequest, PromoteTaskRequest, UpdateTaskRequest};
use tokio::sync::mpsc;
use tower_http::{cors::CorsLayer, services::ServeDir, trace::TraceLayer};
use tracing::{info, warn};
use vault::{CreateFileRequest, SaveFileRequest, VaultFileDetail};

#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub String);

#[derive(Serialize)]
struct ErrorBody {
    detail: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(ErrorBody { detail: self.1 })).into_response()
    }
}

#[derive(Clone)]
struct AppState {
    cfg: Arc<AppConfig>,
    db: Database,
    runner: ScriptRunner,
    feeds: FeedManager,
    acp: AcpHost,
    invest: InvestState,
}

#[derive(Serialize)]
struct HealthResponse {
    app: &'static str,
    port: u16,
    vault_root: String,
    db_path: String,
    indexed_files: usize,
    northstar_url: String,
    northstar_online: bool,
    providers: Vec<AcpProviderInfo>,
}

#[derive(Serialize)]
struct TodayResponse {
    date: String,
    due_today: Vec<TaskRecord>,
    overdue: Vec<TaskRecord>,
    upcoming_7d: Vec<TaskRecord>,
    todo_open_count: usize,
    total_open_count: usize,
    brief: TodayBrief,
    scripts: &'static [ScriptDef],
    running_scripts: Vec<String>,
    recent_runs: Vec<ScriptRunRecord>,
    northstar_account: Option<Value>,
    finance_summary: Option<FinanceBriefSummary>,
    gmail_digest: Option<Value>,
    job_watch: Option<Value>,
}

async fn health(State(state): State<AppState>) -> Result<Json<HealthResponse>, ApiError> {
    let indexed_files = state.db.vault_file_count().await?;
    Ok(Json(HealthResponse {
        app: "MyWiki Studio",
        port: state.cfg.port,
        vault_root: state.cfg.vault_root.display().to_string(),
        db_path: state.cfg.db_path.display().to_string(),
        indexed_files,
        northstar_url: format!("http://127.0.0.1:{}", state.cfg.port),
        northstar_online: state.invest.is_longbridge_ready(),
        providers: state.acp.detect_providers(),
    }))
}

async fn today_dashboard(State(state): State<AppState>) -> Result<Json<TodayResponse>, ApiError> {
    let today_date = Local::now().date_naive();
    let today_str = today_date.format("%Y-%m-%d").to_string();
    let plus_7 = (today_date + chrono::Duration::days(7))
        .format("%Y-%m-%d")
        .to_string();

    let (all_tasks, recent_runs, running_scripts, northstar_account, finance_summary, gmail_digest) = tokio::join!(
        state.db.list_tasks(),
        state.db.list_script_runs(15),
        state.runner.active_keys(),
        state.invest.account_overview_json(),
        state.runner.load_finance_summary(),
        state.runner.load_gmail_digest(),
    );
    let job_watch = state.runner.load_job_watch();
    let all_tasks = all_tasks?;
    let recent_runs = recent_runs?;

    let mut due_today = Vec::new();
    let mut overdue = Vec::new();
    let mut upcoming_7d = Vec::new();
    let mut todo_open_count = 0usize;
    let mut total_open_count = 0usize;

    for t in all_tasks {
        let done = matches!(t.status.as_str(), "done" | "cancelled");
        if done {
            continue;
        }
        total_open_count += 1;
        if t.source == "todo" {
            todo_open_count += 1;
            continue;
        }
        if let Some(ref due) = t.due {
            if due == &today_str {
                due_today.push(t);
            } else if due < &today_str {
                overdue.push(t);
            } else if due <= &plus_7 {
                upcoming_7d.push(t);
            }
        }
    }

    let root = state.cfg.vault_root.clone();
    let brief = tokio::task::spawn_blocking(move || parse_today_brief(&root))
        .await
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(TodayResponse {
        date: today_str,
        due_today,
        overdue,
        upcoming_7d,
        todo_open_count,
        total_open_count,
        brief,
        scripts: SCRIPTS,
        running_scripts,
        recent_runs,
        northstar_account,
        finance_summary,
        gmail_digest,
        job_watch,
    }))
}

async fn run_script(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<ScriptRunRecord>, ApiError> {
    Ok(Json(state.runner.run_script(&key).await?))
}

async fn list_script_runs(State(state): State<AppState>) -> Result<Json<Vec<ScriptRunRecord>>, ApiError> {
    Ok(Json(state.db.list_script_runs(30).await?))
}

async fn get_script_status(State(state): State<AppState>) -> Json<Value> {
    let running = state.runner.active_keys().await;
    Json(json!({ "running": running }))
}

async fn get_script_config(
    State(state): State<AppState>,
) -> Result<Json<ScriptSettingsResponse>, ApiError> {
    Ok(Json(state.runner.settings_response(state.cfg.port).await))
}

async fn update_script_config(
    State(state): State<AppState>,
    Json(settings): Json<ScriptSettings>,
) -> Result<Json<ScriptSettingsResponse>, ApiError> {
    state.runner.save_settings(settings).await?;
    Ok(Json(state.runner.settings_response(state.cfg.port).await))
}

async fn calendar_tasks_ics(State(state): State<AppState>) -> Result<Response, ApiError> {
    let tasks = state.db.list_tasks().await?;
    let ics = generate_tasks_ics(&tasks);
    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/calendar; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "inline; filename=\"mywiki-tasks.ics\"",
            ),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        ics,
    )
        .into_response())
}

// ---------- Tasks ----------

async fn list_tasks(State(state): State<AppState>) -> Result<Json<Vec<TaskRecord>>, ApiError> {
    Ok(Json(state.db.list_tasks().await?))
}

async fn resync_tasks(State(state): State<AppState>) -> Result<Json<Vec<TaskRecord>>, ApiError> {
    Ok(Json(tasks::sync_tasks_to_db(&state.cfg.vault_root, &state.db).await?))
}

async fn create_task(
    State(state): State<AppState>,
    Json(req): Json<CreateTaskRequest>,
) -> Result<Json<TaskRecord>, ApiError> {
    Ok(Json(tasks::create_task(&state.cfg.vault_root, &state.db, req).await?))
}

async fn update_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateTaskRequest>,
) -> Result<Json<TaskRecord>, ApiError> {
    Ok(Json(
        tasks::update_task(&state.cfg.vault_root, &state.db, &id, req).await?,
    ))
}

async fn promote_task(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<PromoteTaskRequest>,
) -> Result<Json<TaskRecord>, ApiError> {
    Ok(Json(
        tasks::promote_todo_to_task(&state.cfg.vault_root, &state.db, &id, req).await?,
    ))
}

// ---------- Vault & Wiki ----------

#[derive(Deserialize)]
struct VaultFilesQuery {
    area: Option<String>,
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    area: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct FilePathQuery {
    path: String,
}

async fn list_vault_files(
    State(state): State<AppState>,
    Query(q): Query<VaultFilesQuery>,
) -> Result<Json<Vec<VaultFileRecord>>, ApiError> {
    Ok(Json(state.db.list_vault_files(q.area).await?))
}

async fn reindex_vault(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let count = vault::full_reindex(&state.cfg.vault_root, &state.db).await?;
    let tasks = tasks::sync_tasks_to_db(&state.cfg.vault_root, &state.db).await?;
    Ok(Json(json!({ "indexed_files": count, "tasks_count": tasks.len() })))
}

async fn search_vault(
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Vec<SearchHit>>, ApiError> {
    Ok(Json(
        state
            .db
            .search_vault(q.q, q.area, q.limit.unwrap_or(30))
            .await?,
    ))
}

async fn get_vault_file(
    State(state): State<AppState>,
    Query(q): Query<FilePathQuery>,
) -> Result<Json<VaultFileDetail>, ApiError> {
    Ok(Json(
        vault::read_file_detail(&state.cfg.vault_root, &state.db, &q.path).await?,
    ))
}

async fn save_vault_file(
    State(state): State<AppState>,
    Json(req): Json<SaveFileRequest>,
) -> Result<Json<VaultFileDetail>, ApiError> {
    let rel = vault::validate_rel_path(&req.path)?;
    vault::atomic_write(&state.cfg.vault_root.join(&rel), &req.content)?;
    vault::index_single_file(&state.cfg.vault_root, &state.db, &rel).await?;
    if rel.starts_with("task/") {
        let _ = tasks::sync_tasks_to_db(&state.cfg.vault_root, &state.db).await;
    }
    Ok(Json(
        vault::read_file_detail(&state.cfg.vault_root, &state.db, &rel).await?,
    ))
}

async fn create_vault_file(
    State(state): State<AppState>,
    Json(req): Json<CreateFileRequest>,
) -> Result<Json<VaultFileDetail>, ApiError> {
    Ok(Json(
        vault::create_markdown_file(&state.cfg.vault_root, &state.db, req).await?,
    ))
}

// ---------- Feeds & Reader ----------

#[derive(Deserialize)]
struct FeedItemsQuery {
    group: Option<String>,
    source_id: Option<String>,
    unread: Option<bool>,
    starred: Option<bool>,
    q: Option<String>,
    limit: Option<usize>,
}

#[derive(Serialize)]
struct FeedsResponse {
    sources: Vec<FeedSourceRecord>,
    items: Vec<FeedItemRecord>,
}

#[derive(Deserialize)]
struct ToggleSourceRequest {
    enabled: bool,
}

#[derive(Deserialize)]
struct UpdateFeedItemRequest {
    is_read: Option<bool>,
    is_starred: Option<bool>,
}

#[derive(Deserialize)]
struct ReaderQuery {
    url: String,
    force: Option<bool>,
}

#[derive(Deserialize)]
struct CreateHighlightRequest {
    url: String,
    page_title: String,
    excerpt: String,
    #[serde(default)]
    comment: String,
    linked_doc_path: Option<String>,
}

#[derive(Deserialize)]
struct HighlightsQuery {
    url: Option<String>,
}

async fn list_feeds(
    State(state): State<AppState>,
    Query(q): Query<FeedItemsQuery>,
) -> Result<Json<FeedsResponse>, ApiError> {
    let (sources, items) = tokio::try_join!(
        state.db.list_feed_sources(),
        state.db.list_feed_items(
            q.group,
            q.source_id,
            q.unread.unwrap_or(false),
            q.starred.unwrap_or(false),
            q.q,
            q.limit.unwrap_or(150),
        ),
    )?;
    Ok(Json(FeedsResponse { sources, items }))
}

async fn refresh_feeds(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let count = state.feeds.refresh_all().await?;
    Ok(Json(json!({ "processed": count })))
}

async fn add_feed_source(
    State(state): State<AppState>,
    Json(req): Json<AddFeedSourceRequest>,
) -> Result<Json<FeedSourceRecord>, ApiError> {
    Ok(Json(state.feeds.add_source(req).await?))
}

async fn toggle_feed_source(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<ToggleSourceRequest>,
) -> Result<Json<Value>, ApiError> {
    state.db.set_feed_source_enabled(id, req.enabled).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn delete_feed_source(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    state.db.delete_feed_source(id).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn import_opml(
    State(state): State<AppState>,
    Json(req): Json<ImportOpmlRequest>,
) -> Result<Json<Value>, ApiError> {
    let imported = state.feeds.import_opml(req).await?;
    Ok(Json(json!({ "imported": imported })))
}

async fn patch_feed_item(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateFeedItemRequest>,
) -> Result<Json<Value>, ApiError> {
    state
        .db
        .update_feed_item_flags(id, req.is_read, req.is_starred, None)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn reader_article(
    State(state): State<AppState>,
    Query(q): Query<ReaderQuery>,
) -> Result<Json<ReaderResponse>, ApiError> {
    Ok(Json(
        state
            .feeds
            .fetch_reader(&q.url, q.force.unwrap_or(false))
            .await?,
    ))
}

async fn archive_article(
    State(state): State<AppState>,
    Json(req): Json<ArchiveArticleRequest>,
) -> Result<Json<Value>, ApiError> {
    let path = state.feeds.archive_to_worth_reading(req).await?;
    Ok(Json(json!({ "path": path })))
}

async fn list_highlights(
    State(state): State<AppState>,
    Query(q): Query<HighlightsQuery>,
) -> Result<Json<Vec<HighlightRecord>>, ApiError> {
    Ok(Json(state.db.list_highlights(q.url).await?))
}

async fn add_highlight(
    State(state): State<AppState>,
    Json(req): Json<CreateHighlightRequest>,
) -> Result<Json<HighlightRecord>, ApiError> {
    if req.excerpt.trim().is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "摘录内容不能为空".into()));
    }
    let rec = state
        .db
        .add_highlight(
            req.url.trim().to_string(),
            req.page_title.trim().to_string(),
            req.excerpt.trim().to_string(),
            req.comment.trim().to_string(),
            req.linked_doc_path,
        )
        .await?;
    Ok(Json(rec))
}

// ---------- ACP Agent Hub ----------

async fn list_acp_providers(State(state): State<AppState>) -> Json<Vec<AcpProviderInfo>> {
    Json(state.acp.detect_providers())
}

async fn list_acp_sessions(
    State(state): State<AppState>,
) -> Result<Json<Vec<AcpSessionRecord>>, ApiError> {
    Ok(Json(state.db.list_acp_sessions().await?))
}

async fn create_acp_session(
    State(state): State<AppState>,
    Json(req): Json<CreateSessionRequest>,
) -> Result<Json<AcpSessionRecord>, ApiError> {
    Ok(Json(state.acp.create_session(req).await?))
}

async fn delete_acp_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    state.db.delete_acp_session(id).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn list_acp_events(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<AcpEventRecord>>, ApiError> {
    Ok(Json(state.db.list_acp_events(id).await?))
}

#[derive(Deserialize)]
struct RevertAcpRequest {
    from_event_id: i64,
}

async fn revert_acp_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<RevertAcpRequest>,
) -> Result<Json<Value>, ApiError> {
    let deleted = state
        .db
        .revert_acp_session_from_event(id.clone(), req.from_event_id)
        .await?;
    let events = state.db.list_acp_events(id).await?;
    Ok(Json(json!({ "deleted": deleted, "events": events })))
}

async fn prompt_acp_rest(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<PromptRequest>,
) -> Result<Json<Vec<AcpEventRecord>>, ApiError> {
    let (tx, mut rx) = mpsc::channel(64);
    let drain = tokio::spawn(async move { while rx.recv().await.is_some() {} });
    state.acp.run_prompt_streaming(&id, req, tx).await?;
    let _ = drain.await;
    Ok(Json(state.db.list_acp_events(id).await?))
}

async fn ws_acp_session(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    ws.on_upgrade(move |socket| handle_acp_ws(socket, state, id))
}

async fn handle_acp_ws(socket: WebSocket, state: AppState, session_id: String) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    while let Some(Ok(msg)) = ws_rx.next().await {
        let Message::Text(text) = msg else {
            continue;
        };
        let Ok(req) = serde_json::from_str::<PromptRequest>(&text) else {
            let _ = ws_tx
                .send(Message::Text(
                    json!({ "kind": "error", "data": { "message": "无效的请求格式" } })
                        .to_string()
                        .into(),
                ))
                .await;
            continue;
        };

        let (tx, mut rx) = mpsc::channel(64);
        let acp = state.acp.clone();
        let sid = session_id.clone();
        let worker = tokio::spawn(async move {
            let _ = acp.run_prompt_streaming(&sid, req, tx).await;
        });

        while let Some(frame) = rx.recv().await {
            if let Ok(payload) = serde_json::to_string(&frame) {
                if ws_tx.send(Message::Text(payload.into())).await.is_err() {
                    break;
                }
            }
        }
        let _ = worker.await;
    }
}

fn spawn_vault_watcher(vault_root: PathBuf, db: Database) {
    tokio::spawn(async move {
        let (tx, mut rx) = mpsc::channel::<PathBuf>(128);
        let watch_root = vault_root.clone();
        let _watcher_thread = std::thread::spawn(move || {
            let Ok(mut watcher) = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
                if let Ok(ev) = res {
                    if matches!(ev.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) {
                        for p in ev.paths {
                            if p.extension().and_then(|s| s.to_str()) == Some("md") {
                                let _ = tx.blocking_send(p);
                            }
                        }
                    }
                }
            }) else {
                return;
            };
            if watcher.watch(&watch_root, RecursiveMode::Recursive).is_err() {
                return;
            }
            loop {
                std::thread::sleep(Duration::from_secs(3600));
            }
        });

        while let Some(changed_abs) = rx.recv().await {
            // Simple debounce: drain rapid consecutive writes
            tokio::time::sleep(Duration::from_millis(250)).await;
            let mut batch = vec![changed_abs];
            while let Ok(p) = rx.try_recv() {
                batch.push(p);
            }
            let mut task_dirty = false;
            for abs in batch {
                if let Ok(rel) = abs.strip_prefix(&vault_root) {
                    let rel_str = rel.to_string_lossy().replace('\\', "/");
                    if vault::validate_rel_path(&rel_str).is_ok() {
                        if abs.exists() {
                            let _ = vault::index_single_file(&vault_root, &db, &rel_str).await;
                        } else {
                            let _ = vault::full_reindex(&vault_root, &db).await;
                        }
                        if rel_str.starts_with("task/") {
                            task_dirty = true;
                        }
                    }
                }
            }
            if task_dirty {
                let _ = tasks::sync_tasks_to_db(&vault_root, &db).await;
            }
        }
    });
}

fn build_router(state: AppState, invest_state: InvestState, static_dir: PathBuf) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/today", get(today_dashboard))
        .route("/scripts/runs", get(list_script_runs))
        .route("/scripts/status", get(get_script_status))
        .route(
            "/scripts/config",
            get(get_script_config).put(update_script_config),
        )
        .route("/scripts/{key}/run", post(run_script))
        .route("/calendar/tasks.ics", get(calendar_tasks_ics))
        .route("/tasks", get(list_tasks).post(create_task))
        .route("/tasks/resync", post(resync_tasks))
        .route("/tasks/{id}", patch(update_task))
        .route("/tasks/{id}/promote", post(promote_task))
        .route("/vault/files", get(list_vault_files))
        .route("/vault/reindex", post(reindex_vault))
        .route("/vault/search", get(search_vault))
        .route(
            "/vault/file",
            get(get_vault_file)
                .put(save_vault_file)
                .post(create_vault_file),
        )
        .route("/feeds", get(list_feeds))
        .route("/feeds/refresh", post(refresh_feeds))
        .route("/feeds/sources", post(add_feed_source))
        .route(
            "/feeds/sources/{id}",
            patch(toggle_feed_source).delete(delete_feed_source),
        )
        .route("/feeds/import-opml", post(import_opml))
        .route("/feeds/items/{id}", patch(patch_feed_item))
        .route("/reader", get(reader_article))
        .route("/reader/archive", post(archive_article))
        .route("/reader/highlights", get(list_highlights).post(add_highlight))
        .route("/acp/providers", get(list_acp_providers))
        .route("/acp/sessions", get(list_acp_sessions).post(create_acp_session))
        .route("/acp/sessions/{id}", delete(delete_acp_session))
        .route("/acp/sessions/{id}/events", get(list_acp_events))
        .route("/acp/sessions/{id}/revert", post(revert_acp_session))
        .route("/acp/sessions/{id}/prompt", post(prompt_acp_rest))
        .with_state(state.clone())
        .merge(invest::invest_router(invest_state));

    Router::new()
        .nest("/api", api)
        .route("/ws/acp/{id}", get(ws_acp_session).with_state(state))
        .fallback_service(ServeDir::new(static_dir).append_index_html_on_directories(true))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}

#[tokio::main]
async fn main() -> Result<(), Infallible> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = Arc::new(AppConfig::from_env());
    let invest_state = InvestState::init().await;
    let db = Database::open(cfg.db_path.clone())
        .await
        .expect("initialize MyWiki Studio SQLite database");

    match vault::full_reindex(&cfg.vault_root, &db).await {
        Ok(n) => info!("Indexed {n} Markdown files from {}", cfg.vault_root.display()),
        Err(e) => warn!("Initial Vault index failed: {}", e.1),
    }
    match tasks::sync_tasks_to_db(&cfg.vault_root, &db).await {
        Ok(list) => info!("Synced {} tasks from task/", list.len()),
        Err(e) => warn!("Initial task sync failed: {}", e.1),
    }

    let http = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .expect("HTTP client");

    let feeds = FeedManager::new(db.clone(), http, cfg.vault_root.clone());
    feeds.spawn_background_sync();
    spawn_vault_watcher(cfg.vault_root.clone(), db.clone());

    let state = AppState {
        runner: ScriptRunner::new(
            cfg.vault_root.clone(),
            cfg.python_bin.clone(),
            db.clone(),
            feeds.clone(),
        ),
        acp: AcpHost::new(cfg.vault_root.clone(), db.clone()),
        feeds,
        invest: invest_state.clone(),
        db,
        cfg: cfg.clone(),
    };

    let app = build_router(state, invest_state, cfg.static_dir.clone());
    let addr = SocketAddr::from(([127, 0, 0, 1], cfg.port));
    info!("MyWiki Studio server listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind port");
    axum::serve(listener, app).await.expect("serve HTTP");
    Ok(())
}

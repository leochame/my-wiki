use std::{path::PathBuf, sync::Arc};

use axum::http::StatusCode;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::ApiError;

#[derive(Clone)]
pub struct Database {
    path: Arc<PathBuf>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VaultFileRecord {
    pub path: String,
    pub area: String,
    pub title: String,
    pub frontmatter_json: String,
    pub tags: Vec<String>,
    pub word_count: usize,
    pub mtime: i64,
    pub content_hash: String,
    pub indexed_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct SearchHit {
    pub path: String,
    pub area: String,
    pub title: String,
    pub snippet: String,
    pub tags: Vec<String>,
    pub mtime: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct WikilinkRecord {
    pub source_path: String,
    pub target_raw: String,
    pub resolved_path: Option<String>,
    pub alias: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskRecord {
    pub id: String,
    pub source: String, // by_task | todo
    pub file_path: String,
    pub title: String,
    pub status: String,
    pub due: Option<String>,
    pub priority: String,
    pub category: String,
    pub notes: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScriptRunRecord {
    pub id: i64,
    pub script_key: String,
    pub command: String,
    pub status: String,
    pub exit_code: Option<i32>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub summary_json: Option<String>,
    pub output_log: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FeedSourceRecord {
    pub id: String,
    pub name: String,
    pub group_name: String,
    pub kind: String,
    pub feed_url: String,
    pub site_url: String,
    #[serde(default)]
    pub description: String,
    pub enabled: bool,
    pub last_ok: bool,
    pub last_error: Option<String>,
    pub last_fetched_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FeedItemRecord {
    pub id: String,
    pub source_id: String,
    pub source_name: String,
    pub group_name: String,
    pub title: String,
    pub url: String,
    pub summary: Option<String>,
    pub published_at: Option<String>,
    pub is_read: bool,
    pub is_starred: bool,
    pub saved_note_path: Option<String>,
    pub fetched_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReaderCacheRecord {
    pub url: String,
    pub title: String,
    pub byline: Option<String>,
    pub clean_html: String,
    pub plain_text: String,
    pub fetched_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HighlightRecord {
    pub id: i64,
    pub url: String,
    pub page_title: String,
    pub excerpt: String,
    pub comment: String,
    pub linked_doc_path: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AcpSessionRecord {
    pub session_id: String,
    pub provider: String,
    pub external_session_id: Option<String>,
    pub title: String,
    pub cwd: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AcpEventRecord {
    pub id: i64,
    pub session_id: String,
    pub seq: i64,
    pub kind: String,
    pub payload_json: String,
    pub created_at: String,
}

fn storage_error(error: impl std::fmt::Display) -> ApiError {
    tracing::error!("SQLite error: {error}");
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, "数据库操作失败".into())
}

impl Database {
    pub async fn open(path: PathBuf) -> Result<Self, ApiError> {
        let db = Self {
            path: Arc::new(path),
        };
        let p = db.path.clone();
        tokio::task::spawn_blocking(move || {
            if let Some(parent) = p.parent().filter(|d| !d.as_os_str().is_empty()) {
                std::fs::create_dir_all(parent).map_err(storage_error)?;
            }
            let conn = Connection::open(p.as_ref()).map_err(storage_error)?;
            conn.busy_timeout(std::time::Duration::from_secs(5))
                .map_err(storage_error)?;
            conn.execute_batch(
                "PRAGMA journal_mode=WAL;
                PRAGMA foreign_keys=ON;

                CREATE TABLE IF NOT EXISTS vault_files (
                    path TEXT PRIMARY KEY NOT NULL,
                    area TEXT NOT NULL,
                    title TEXT NOT NULL,
                    frontmatter_json TEXT NOT NULL DEFAULT '{}',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    word_count INTEGER NOT NULL DEFAULT 0,
                    mtime INTEGER NOT NULL,
                    content_hash TEXT NOT NULL,
                    indexed_at TEXT NOT NULL
                );

                CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
                    path UNINDEXED,
                    title,
                    tags,
                    body,
                    tokenize = 'unicode61'
                );

                CREATE TABLE IF NOT EXISTS wikilinks (
                    source_path TEXT NOT NULL,
                    target_raw TEXT NOT NULL,
                    resolved_path TEXT,
                    alias TEXT,
                    PRIMARY KEY (source_path, target_raw)
                );
                CREATE INDEX IF NOT EXISTS idx_wikilinks_resolved ON wikilinks(resolved_path);

                CREATE TABLE IF NOT EXISTS tasks_index (
                    id TEXT PRIMARY KEY NOT NULL,
                    source TEXT NOT NULL CHECK (source IN ('by_task', 'todo')),
                    file_path TEXT NOT NULL,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL,
                    due TEXT,
                    priority TEXT NOT NULL DEFAULT 'medium',
                    category TEXT NOT NULL DEFAULT '',
                    notes TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS script_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    script_key TEXT NOT NULL,
                    command TEXT NOT NULL,
                    status TEXT NOT NULL,
                    exit_code INTEGER,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    duration_ms INTEGER,
                    summary_json TEXT,
                    output_log TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_script_runs_key ON script_runs(script_key, started_at DESC);

                CREATE TABLE IF NOT EXISTS feed_sources (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    group_name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    feed_url TEXT NOT NULL,
                    site_url TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    last_ok INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    last_fetched_at TEXT
                );

                CREATE TABLE IF NOT EXISTS feed_items (
                    id TEXT PRIMARY KEY NOT NULL,
                    source_id TEXT NOT NULL REFERENCES feed_sources(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL UNIQUE,
                    summary TEXT,
                    published_at TEXT,
                    is_read INTEGER NOT NULL DEFAULT 0,
                    is_starred INTEGER NOT NULL DEFAULT 0,
                    saved_note_path TEXT,
                    fetched_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_feed_items_pub ON feed_items(published_at DESC);

                CREATE TABLE IF NOT EXISTS reader_cache (
                    url TEXT PRIMARY KEY NOT NULL,
                    title TEXT NOT NULL,
                    byline TEXT,
                    clean_html TEXT NOT NULL,
                    plain_text TEXT NOT NULL,
                    fetched_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS reader_highlights (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url TEXT NOT NULL,
                    page_title TEXT NOT NULL,
                    excerpt TEXT NOT NULL,
                    comment TEXT NOT NULL DEFAULT '',
                    linked_doc_path TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS acp_sessions (
                    session_id TEXT PRIMARY KEY NOT NULL,
                    provider TEXT NOT NULL,
                    external_session_id TEXT,
                    title TEXT NOT NULL,
                    cwd TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'idle',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS acp_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL REFERENCES acp_sessions(session_id) ON DELETE CASCADE,
                    seq INTEGER NOT NULL,
                    kind TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_acp_events_session ON acp_events(session_id, seq);

                CREATE TABLE IF NOT EXISTS meta_settings (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                PRAGMA user_version=1;",
            )
            .map_err(storage_error)?;
            // Idempotent column migration for existing DBs
            let _ = conn.execute(
                "ALTER TABLE feed_sources ADD COLUMN description TEXT NOT NULL DEFAULT ''",
                [],
            );
            Ok::<_, ApiError>(())
        })
        .await
        .map_err(storage_error)??;
        Ok(db)
    }

    async fn run<T, F>(&self, op: F) -> Result<T, ApiError>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, ApiError> + Send + 'static,
    {
        let p = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = Connection::open(p.as_ref()).map_err(storage_error)?;
            conn.busy_timeout(std::time::Duration::from_secs(5))
                .map_err(storage_error)?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")
                .map_err(storage_error)?;
            op(&mut conn)
        })
        .await
        .map_err(storage_error)?
    }

    pub async fn get_meta(&self, key: String) -> Result<Option<String>, ApiError> {
        self.run(move |conn| {
            conn.query_row("SELECT value FROM meta_settings WHERE key=?1", [key], |r| r.get(0))
                .optional()
                .map_err(storage_error)
        })
        .await
    }

    pub async fn set_meta(&self, key: String, value: String) -> Result<(), ApiError> {
        self.run(move |conn| {
            conn.execute(
                "INSERT OR REPLACE INTO meta_settings(key, value, updated_at) VALUES (?1, ?2, ?3)",
                params![key, value, Utc::now().to_rfc3339()],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    // ---------- Vault Index & FTS5 ----------

    pub async fn replace_vault_index(
        &self,
        files: Vec<(VaultFileRecord, String, Vec<WikilinkRecord>)>,
    ) -> Result<usize, ApiError> {
        let count = files.len();
        self.run(move |conn| {
            let tx = conn.transaction().map_err(storage_error)?;
            tx.execute("DELETE FROM vault_files", []).map_err(storage_error)?;
            tx.execute("DELETE FROM vault_fts", []).map_err(storage_error)?;
            tx.execute("DELETE FROM wikilinks", []).map_err(storage_error)?;

            for (rec, body, links) in files {
                let tags_json = serde_json::to_string(&rec.tags).unwrap_or_else(|_| "[]".into());
                let tags_text = rec.tags.join(" ");
                tx.execute(
                    "INSERT INTO vault_files
                     (path, area, title, frontmatter_json, tags_json, word_count, mtime, content_hash, indexed_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        rec.path,
                        rec.area,
                        rec.title,
                        rec.frontmatter_json,
                        tags_json,
                        rec.word_count as i64,
                        rec.mtime,
                        rec.content_hash,
                        rec.indexed_at,
                    ],
                )
                .map_err(storage_error)?;
                tx.execute(
                    "INSERT INTO vault_fts(path, title, tags, body) VALUES (?1, ?2, ?3, ?4)",
                    params![rec.path, rec.title, tags_text, body],
                )
                .map_err(storage_error)?;
                for link in links {
                    tx.execute(
                        "INSERT OR IGNORE INTO wikilinks(source_path, target_raw, resolved_path, alias)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![link.source_path, link.target_raw, link.resolved_path, link.alias],
                    )
                    .map_err(storage_error)?;
                }
            }
            tx.commit().map_err(storage_error)?;
            Ok(count)
        })
        .await
    }

    pub async fn upsert_vault_file(
        &self,
        rec: VaultFileRecord,
        body: String,
        links: Vec<WikilinkRecord>,
    ) -> Result<(), ApiError> {
        self.run(move |conn| {
            let tx = conn.transaction().map_err(storage_error)?;
            let tags_json = serde_json::to_string(&rec.tags).unwrap_or_else(|_| "[]".into());
            let tags_text = rec.tags.join(" ");
            tx.execute(
                "INSERT OR REPLACE INTO vault_files
                 (path, area, title, frontmatter_json, tags_json, word_count, mtime, content_hash, indexed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    rec.path,
                    rec.area,
                    rec.title,
                    rec.frontmatter_json,
                    tags_json,
                    rec.word_count as i64,
                    rec.mtime,
                    rec.content_hash,
                    rec.indexed_at,
                ],
            )
            .map_err(storage_error)?;
            tx.execute("DELETE FROM vault_fts WHERE path=?1", [&rec.path])
                .map_err(storage_error)?;
            tx.execute(
                "INSERT INTO vault_fts(path, title, tags, body) VALUES (?1, ?2, ?3, ?4)",
                params![rec.path, rec.title, tags_text, body],
            )
            .map_err(storage_error)?;
            tx.execute("DELETE FROM wikilinks WHERE source_path=?1", [&rec.path])
                .map_err(storage_error)?;
            for link in links {
                tx.execute(
                    "INSERT OR IGNORE INTO wikilinks(source_path, target_raw, resolved_path, alias)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![link.source_path, link.target_raw, link.resolved_path, link.alias],
                )
                .map_err(storage_error)?;
            }
            tx.commit().map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn list_vault_files(&self, area: Option<String>) -> Result<Vec<VaultFileRecord>, ApiError> {
        self.run(move |conn| {
            let mut out = Vec::new();
            let map_row = |r: &rusqlite::Row<'_>| {
                let tags_raw: String = r.get(4)?;
                let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();
                Ok(VaultFileRecord {
                    path: r.get(0)?,
                    area: r.get(1)?,
                    title: r.get(2)?,
                    frontmatter_json: r.get(3)?,
                    tags,
                    word_count: r.get::<_, i64>(5)? as usize,
                    mtime: r.get(6)?,
                    content_hash: r.get(7)?,
                    indexed_at: r.get(8)?,
                })
            };
            if let Some(a) = area.filter(|s| !s.is_empty()) {
                let mut stmt = conn
                    .prepare(
                        "SELECT path, area, title, frontmatter_json, tags_json, word_count, mtime, content_hash, indexed_at
                         FROM vault_files WHERE area=?1 ORDER BY path ASC",
                    )
                    .map_err(storage_error)?;
                let rows = stmt.query_map([a], map_row).map_err(storage_error)?;
                for r in rows {
                    out.push(r.map_err(storage_error)?);
                }
            } else {
                let mut stmt = conn
                    .prepare(
                        "SELECT path, area, title, frontmatter_json, tags_json, word_count, mtime, content_hash, indexed_at
                         FROM vault_files ORDER BY path ASC",
                    )
                    .map_err(storage_error)?;
                let rows = stmt.query_map([], map_row).map_err(storage_error)?;
                for r in rows {
                    out.push(r.map_err(storage_error)?);
                }
            }
            Ok(out)
        })
        .await
    }

    pub async fn search_vault(
        &self,
        query: String,
        area: Option<String>,
        limit: usize,
    ) -> Result<Vec<SearchHit>, ApiError> {
        let cap = limit.clamp(1, 100) as i64;
        self.run(move |conn| {
            let q = query.trim();
            if q.is_empty() {
                return Ok(Vec::new());
            }
            // Escape FTS5 syntax characters safely and fallback to LIKE if FTS returns empty (e.g. CJK substring)
            let tokens: Vec<String> = q
                .split_whitespace()
                .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
                .collect();
            let fts_query = tokens.join(" ");
            let mut hits = Vec::new();

            if let Ok(mut stmt) = conn.prepare(
                "SELECT f.path, f.area, f.title,
                        snippet(vault_fts, 3, '[', ']', '…', 20) as snip,
                        f.tags_json, f.mtime
                 FROM vault_fts
                 JOIN vault_files f ON f.path = vault_fts.path
                 WHERE vault_fts MATCH ?1 AND (?2 = '' OR f.area = ?2)
                 ORDER BY bm25(vault_fts) ASC
                 LIMIT ?3",
            ) {
                let area_param = area.clone().unwrap_or_default();
                if let Ok(rows) = stmt.query_map(params![fts_query, area_param, cap], |r| {
                    let tags_raw: String = r.get(4)?;
                    Ok(SearchHit {
                        path: r.get(0)?,
                        area: r.get(1)?,
                        title: r.get(2)?,
                        snippet: r.get::<_, String>(3).unwrap_or_default(),
                        tags: serde_json::from_str(&tags_raw).unwrap_or_default(),
                        mtime: r.get(5)?,
                    })
                }) {
                    for r in rows.flatten() {
                        hits.push(r);
                    }
                }
            }

            if hits.is_empty() {
                let pattern = format!("%{q}%");
                let area_param = area.unwrap_or_default();
                let mut stmt = conn
                    .prepare(
                        "SELECT f.path, f.area, f.title, substr(v.body, 1, 160), f.tags_json, f.mtime
                         FROM vault_files f
                         JOIN vault_fts v ON v.path = f.path
                         WHERE (f.title LIKE ?1 OR f.path LIKE ?1 OR v.body LIKE ?1 OR f.tags_json LIKE ?1)
                           AND (?2 = '' OR f.area = ?2)
                         ORDER BY f.mtime DESC
                         LIMIT ?3",
                    )
                    .map_err(storage_error)?;
                let rows = stmt
                    .query_map(params![pattern, area_param, cap], |r| {
                        let tags_raw: String = r.get(4)?;
                        Ok(SearchHit {
                            path: r.get(0)?,
                            area: r.get(1)?,
                            title: r.get(2)?,
                            snippet: r.get::<_, String>(3).unwrap_or_default(),
                            tags: serde_json::from_str(&tags_raw).unwrap_or_default(),
                            mtime: r.get(5)?,
                        })
                    })
                    .map_err(storage_error)?;
                for r in rows {
                    hits.push(r.map_err(storage_error)?);
                }
            }
            Ok(hits)
        })
        .await
    }

    pub async fn links_for_file(
        &self,
        path: String,
    ) -> Result<(Vec<WikilinkRecord>, Vec<WikilinkRecord>), ApiError> {
        self.run(move |conn| {
            let mut out_stmt = conn
                .prepare(
                    "SELECT source_path, target_raw, resolved_path, alias
                     FROM wikilinks WHERE source_path=?1 ORDER BY target_raw ASC",
                )
                .map_err(storage_error)?;
            let outgoing = out_stmt
                .query_map([&path], |r| {
                    Ok(WikilinkRecord {
                        source_path: r.get(0)?,
                        target_raw: r.get(1)?,
                        resolved_path: r.get(2)?,
                        alias: r.get(3)?,
                    })
                })
                .map_err(storage_error)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(storage_error)?;

            let mut back_stmt = conn
                .prepare(
                    "SELECT source_path, target_raw, resolved_path, alias
                     FROM wikilinks WHERE resolved_path=?1 ORDER BY source_path ASC",
                )
                .map_err(storage_error)?;
            let backlinks = back_stmt
                .query_map([&path], |r| {
                    Ok(WikilinkRecord {
                        source_path: r.get(0)?,
                        target_raw: r.get(1)?,
                        resolved_path: r.get(2)?,
                        alias: r.get(3)?,
                    })
                })
                .map_err(storage_error)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(storage_error)?;

            Ok((outgoing, backlinks))
        })
        .await
    }

    pub async fn vault_file_count(&self) -> Result<usize, ApiError> {
        self.run(|conn| {
            let c: i64 = conn
                .query_row("SELECT COUNT(*) FROM vault_files", [], |r| r.get(0))
                .map_err(storage_error)?;
            Ok(c as usize)
        })
        .await
    }

    // ---------- Tasks Index ----------

    pub async fn replace_tasks(&self, tasks: Vec<TaskRecord>) -> Result<(), ApiError> {
        self.run(move |conn| {
            let tx = conn.transaction().map_err(storage_error)?;
            tx.execute("DELETE FROM tasks_index", [])
                .map_err(storage_error)?;
            for t in tasks {
                tx.execute(
                    "INSERT OR REPLACE INTO tasks_index
                     (id, source, file_path, title, status, due, priority, category, notes, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        t.id,
                        t.source,
                        t.file_path,
                        t.title,
                        t.status,
                        t.due,
                        t.priority,
                        t.category,
                        t.notes,
                        t.updated_at,
                    ],
                )
                .map_err(storage_error)?;
            }
            tx.commit().map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn list_tasks(&self) -> Result<Vec<TaskRecord>, ApiError> {
        self.run(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, source, file_path, title, status, due, priority, category, notes, updated_at
                     FROM tasks_index
                     ORDER BY
                       CASE WHEN status IN ('done','cancelled') THEN 1 ELSE 0 END ASC,
                       CASE WHEN due IS NULL OR due='' THEN 1 ELSE 0 END ASC,
                       due ASC,
                       id ASC",
                )
                .map_err(storage_error)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(TaskRecord {
                        id: r.get(0)?,
                        source: r.get(1)?,
                        file_path: r.get(2)?,
                        title: r.get(3)?,
                        status: r.get(4)?,
                        due: r.get(5)?,
                        priority: r.get(6)?,
                        category: r.get(7)?,
                        notes: r.get(8)?,
                        updated_at: r.get(9)?,
                    })
                })
                .map_err(storage_error)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(storage_error)
        })
        .await
    }

    pub async fn get_task(&self, id: String) -> Result<Option<TaskRecord>, ApiError> {
        self.run(move |conn| {
            conn.query_row(
                "SELECT id, source, file_path, title, status, due, priority, category, notes, updated_at
                 FROM tasks_index WHERE id=?1",
                [id],
                |r| {
                    Ok(TaskRecord {
                        id: r.get(0)?,
                        source: r.get(1)?,
                        file_path: r.get(2)?,
                        title: r.get(3)?,
                        status: r.get(4)?,
                        due: r.get(5)?,
                        priority: r.get(6)?,
                        category: r.get(7)?,
                        notes: r.get(8)?,
                        updated_at: r.get(9)?,
                    })
                },
            )
            .optional()
            .map_err(storage_error)
        })
        .await
    }

    // ---------- Script Runs ----------

    pub async fn insert_script_run(
        &self,
        script_key: String,
        command: String,
    ) -> Result<i64, ApiError> {
        self.run(move |conn| {
            conn.execute(
                "INSERT INTO script_runs(script_key, command, status, started_at)
                 VALUES (?1, ?2, 'running', ?3)",
                params![script_key, command, Utc::now().to_rfc3339()],
            )
            .map_err(storage_error)?;
            Ok(conn.last_insert_rowid())
        })
        .await
    }

    pub async fn finish_script_run(
        &self,
        id: i64,
        status: String,
        exit_code: Option<i32>,
        duration_ms: i64,
        summary_json: Option<String>,
        output_log: String,
    ) -> Result<(), ApiError> {
        self.run(move |conn| {
            conn.execute(
                "UPDATE script_runs
                 SET status=?1, exit_code=?2, finished_at=?3, duration_ms=?4, summary_json=?5, output_log=?6
                 WHERE id=?7",
                params![
                    status,
                    exit_code,
                    Utc::now().to_rfc3339(),
                    duration_ms,
                    summary_json,
                    output_log,
                    id,
                ],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn list_script_runs(&self, limit: usize) -> Result<Vec<ScriptRunRecord>, ApiError> {
        let cap = limit.clamp(1, 200) as i64;
        self.run(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, script_key, command, status, exit_code, started_at, finished_at,
                            duration_ms, summary_json, output_log
                     FROM script_runs ORDER BY id DESC LIMIT ?1",
                )
                .map_err(storage_error)?;
            let rows = stmt
                .query_map([cap], |r| {
                    Ok(ScriptRunRecord {
                        id: r.get(0)?,
                        script_key: r.get(1)?,
                        command: r.get(2)?,
                        status: r.get(3)?,
                        exit_code: r.get(4)?,
                        started_at: r.get(5)?,
                        finished_at: r.get(6)?,
                        duration_ms: r.get(7)?,
                        summary_json: r.get(8)?,
                        output_log: r.get(9)?,
                    })
                })
                .map_err(storage_error)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(storage_error)
        })
        .await
    }

    // ---------- Feeds & Reader ----------

    pub async fn list_feed_sources(&self) -> Result<Vec<FeedSourceRecord>, ApiError> {
        self.run(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, group_name, kind, feed_url, site_url, description, enabled,
                            last_ok, last_error, last_fetched_at
                     FROM feed_sources ORDER BY group_name ASC, name ASC",
                )
                .map_err(storage_error)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(FeedSourceRecord {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        group_name: r.get(2)?,
                        kind: r.get(3)?,
                        feed_url: r.get(4)?,
                        site_url: r.get(5)?,
                        description: r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                        enabled: r.get::<_, i64>(7)? != 0,
                        last_ok: r.get::<_, i64>(8)? != 0,
                        last_error: r.get(9)?,
                        last_fetched_at: r.get(10)?,
                    })
                })
                .map_err(storage_error)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(storage_error)
        })
        .await
    }

    pub async fn upsert_feed_source(&self, src: FeedSourceRecord) -> Result<(), ApiError> {
        self.run(move |conn| {
            conn.execute(
                "INSERT INTO feed_sources
                 (id, name, group_name, kind, feed_url, site_url, description, enabled, last_ok, last_error, last_fetched_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(id) DO UPDATE SET
                   name=excluded.name,
                   group_name=excluded.group_name,
                   kind=excluded.kind,
                   feed_url=excluded.feed_url,
                   site_url=excluded.site_url,
                   description=CASE WHEN excluded.description != '' THEN excluded.description ELSE feed_sources.description END,
                   enabled=excluded.enabled",
                params![
                    src.id,
                    src.name,
                    src.group_name,
                    src.kind,
                    src.feed_url,
                    src.site_url,
                    src.description,
                    if src.enabled { 1 } else { 0 },
                    if src.last_ok { 1 } else { 0 },
                    src.last_error,
                    src.last_fetched_at,
                ],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn update_feed_source_classification(
        &self,
        id: String,
        group_name: String,
        description: String,
    ) -> Result<(), ApiError> {
        self.run(move |conn| {
            conn.execute(
                "UPDATE feed_sources SET group_name=?1, description=?2 WHERE id=?3",
                params![group_name, description, id],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn update_feed_source_status(
        &self,
        id: String,
        ok: bool,
        error: Option<String>,
    ) -> Result<(), ApiError> {
        self.run(move |conn| {
            conn.execute(
                "UPDATE feed_sources SET last_ok=?1, last_error=?2, last_fetched_at=?3 WHERE id=?4",
                params![if ok { 1 } else { 0 }, error, Utc::now().to_rfc3339(), id],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn set_feed_source_enabled(&self, id: String, enabled: bool) -> Result<(), ApiError> {
        self.run(move |conn| {
            conn.execute(
                "UPDATE feed_sources SET enabled=?1 WHERE id=?2",
                params![if enabled { 1 } else { 0 }, id],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn delete_feed_source(&self, id: String) -> Result<(), ApiError> {
        self.run(move |conn| {
            conn.execute("DELETE FROM feed_sources WHERE id=?1", [id])
                .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn upsert_feed_items(
        &self,
        items: Vec<(String, String, String, String, Option<String>, Option<String>)>,
    ) -> Result<usize, ApiError> {
        let now = Utc::now().to_rfc3339();
        self.run(move |conn| {
            let tx = conn.transaction().map_err(storage_error)?;
            let mut inserted = 0usize;
            for (id, source_id, title, url, summary, published_at) in items {
                let changed = tx
                    .execute(
                        "INSERT INTO feed_items(id, source_id, title, url, summary, published_at, fetched_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                         ON CONFLICT(url) DO UPDATE SET
                           title=excluded.title,
                           summary=COALESCE(excluded.summary, feed_items.summary),
                           published_at=COALESCE(excluded.published_at, feed_items.published_at),
                           fetched_at=excluded.fetched_at",
                        params![id, source_id, title, url, summary, published_at, now],
                    )
                    .map_err(storage_error)?;
                inserted += changed;
            }
            tx.commit().map_err(storage_error)?;
            Ok(inserted)
        })
        .await
    }

    pub async fn list_feed_items(
        &self,
        group: Option<String>,
        source_id: Option<String>,
        only_unread: bool,
        only_starred: bool,
        q: Option<String>,
        limit: usize,
    ) -> Result<Vec<FeedItemRecord>, ApiError> {
        let cap = limit.clamp(1, 300) as i64;
        self.run(move |conn| {
            let g = group.unwrap_or_default();
            let s = source_id.unwrap_or_default();
            let pat = q
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .map(|v| format!("%{v}%"))
                .unwrap_or_default();
            let mut stmt = conn
                .prepare(
                    "SELECT i.id, i.source_id, fs.name, fs.group_name, i.title, i.url,
                            i.summary, i.published_at, i.is_read, i.is_starred,
                            i.saved_note_path, i.fetched_at
                     FROM feed_items i
                     JOIN feed_sources fs ON fs.id = i.source_id
                     WHERE fs.enabled = 1
                       AND (?1 = '' OR fs.group_name = ?1)
                       AND (?2 = '' OR i.source_id = ?2)
                       AND (?3 = 0 OR i.is_read = 0)
                       AND (?4 = 0 OR i.is_starred = 1)
                       AND (?5 = '' OR i.title LIKE ?5 OR COALESCE(i.summary,'') LIKE ?5 OR fs.name LIKE ?5)
                     ORDER BY COALESCE(i.published_at, i.fetched_at) DESC
                     LIMIT ?6",
                )
                .map_err(storage_error)?;
            let rows = stmt
                .query_map(
                    params![
                        g,
                        s,
                        if only_unread { 1 } else { 0 },
                        if only_starred { 1 } else { 0 },
                        pat,
                        cap
                    ],
                    |r| {
                        Ok(FeedItemRecord {
                            id: r.get(0)?,
                            source_id: r.get(1)?,
                            source_name: r.get(2)?,
                            group_name: r.get(3)?,
                            title: r.get(4)?,
                            url: r.get(5)?,
                            summary: r.get(6)?,
                            published_at: r.get(7)?,
                            is_read: r.get::<_, i64>(8)? != 0,
                            is_starred: r.get::<_, i64>(9)? != 0,
                            saved_note_path: r.get(10)?,
                            fetched_at: r.get(11)?,
                        })
                    },
                )
                .map_err(storage_error)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(storage_error)
        })
        .await
    }

    pub async fn update_feed_item_flags(
        &self,
        id: String,
        is_read: Option<bool>,
        is_starred: Option<bool>,
        saved_note_path: Option<String>,
    ) -> Result<(), ApiError> {
        self.run(move |conn| {
            if let Some(v) = is_read {
                conn.execute(
                    "UPDATE feed_items SET is_read=?1 WHERE id=?2",
                    params![if v { 1 } else { 0 }, &id],
                )
                .map_err(storage_error)?;
            }
            if let Some(v) = is_starred {
                conn.execute(
                    "UPDATE feed_items SET is_starred=?1 WHERE id=?2",
                    params![if v { 1 } else { 0 }, &id],
                )
                .map_err(storage_error)?;
            }
            if let Some(path) = saved_note_path {
                conn.execute(
                    "UPDATE feed_items SET saved_note_path=?1, is_read=1 WHERE id=?2",
                    params![path, &id],
                )
                .map_err(storage_error)?;
            }
            Ok(())
        })
        .await
    }

    pub async fn get_reader_cache(&self, url: String) -> Result<Option<ReaderCacheRecord>, ApiError> {
        self.run(move |conn| {
            conn.query_row(
                "SELECT url, title, byline, clean_html, plain_text, fetched_at
                 FROM reader_cache WHERE url=?1",
                [url],
                |r| {
                    Ok(ReaderCacheRecord {
                        url: r.get(0)?,
                        title: r.get(1)?,
                        byline: r.get(2)?,
                        clean_html: r.get(3)?,
                        plain_text: r.get(4)?,
                        fetched_at: r.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(storage_error)
        })
        .await
    }

    pub async fn put_reader_cache(&self, rec: ReaderCacheRecord) -> Result<(), ApiError> {
        self.run(move |conn| {
            conn.execute(
                "INSERT OR REPLACE INTO reader_cache(url, title, byline, clean_html, plain_text, fetched_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    rec.url,
                    rec.title,
                    rec.byline,
                    rec.clean_html,
                    rec.plain_text,
                    rec.fetched_at,
                ],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn add_highlight(
        &self,
        url: String,
        page_title: String,
        excerpt: String,
        comment: String,
        linked_doc_path: Option<String>,
    ) -> Result<HighlightRecord, ApiError> {
        let now = Utc::now().to_rfc3339();
        self.run(move |conn| {
            conn.execute(
                "INSERT INTO reader_highlights(url, page_title, excerpt, comment, linked_doc_path, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![url, page_title, excerpt, comment, linked_doc_path, now],
            )
            .map_err(storage_error)?;
            let id = conn.last_insert_rowid();
            Ok(HighlightRecord {
                id,
                url,
                page_title,
                excerpt,
                comment,
                linked_doc_path,
                created_at: now,
            })
        })
        .await
    }

    pub async fn list_highlights(&self, url: Option<String>) -> Result<Vec<HighlightRecord>, ApiError> {
        self.run(move |conn| {
            let mut out = Vec::new();
            let u = url.unwrap_or_default();
            let mut stmt = conn
                .prepare(
                    "SELECT id, url, page_title, excerpt, comment, linked_doc_path, created_at
                     FROM reader_highlights
                     WHERE (?1 = '' OR url = ?1)
                     ORDER BY id DESC LIMIT 100",
                )
                .map_err(storage_error)?;
            let rows = stmt
                .query_map([u], |r| {
                    Ok(HighlightRecord {
                        id: r.get(0)?,
                        url: r.get(1)?,
                        page_title: r.get(2)?,
                        excerpt: r.get(3)?,
                        comment: r.get(4)?,
                        linked_doc_path: r.get(5)?,
                        created_at: r.get(6)?,
                    })
                })
                .map_err(storage_error)?;
            for r in rows {
                out.push(r.map_err(storage_error)?);
            }
            Ok(out)
        })
        .await
    }

    // ---------- ACP Sessions & Events ----------

    pub async fn create_acp_session(
        &self,
        session_id: String,
        provider: String,
        title: String,
        cwd: String,
    ) -> Result<AcpSessionRecord, ApiError> {
        let now = Utc::now().to_rfc3339();
        self.run(move |conn| {
            conn.execute(
                "INSERT INTO acp_sessions(session_id, provider, title, cwd, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'idle', ?5, ?5)",
                params![session_id, provider, title, cwd, now],
            )
            .map_err(storage_error)?;
            Ok(AcpSessionRecord {
                session_id,
                provider,
                external_session_id: None,
                title,
                cwd,
                status: "idle".into(),
                created_at: now.clone(),
                updated_at: now,
            })
        })
        .await
    }

    pub async fn list_acp_sessions(&self) -> Result<Vec<AcpSessionRecord>, ApiError> {
        self.run(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT session_id, provider, external_session_id, title, cwd, status, created_at, updated_at
                     FROM acp_sessions ORDER BY updated_at DESC LIMIT 100",
                )
                .map_err(storage_error)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(AcpSessionRecord {
                        session_id: r.get(0)?,
                        provider: r.get(1)?,
                        external_session_id: r.get(2)?,
                        title: r.get(3)?,
                        cwd: r.get(4)?,
                        status: r.get(5)?,
                        created_at: r.get(6)?,
                        updated_at: r.get(7)?,
                    })
                })
                .map_err(storage_error)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(storage_error)
        })
        .await
    }

    pub async fn get_acp_session(&self, session_id: String) -> Result<Option<AcpSessionRecord>, ApiError> {
        self.run(move |conn| {
            conn.query_row(
                "SELECT session_id, provider, external_session_id, title, cwd, status, created_at, updated_at
                 FROM acp_sessions WHERE session_id=?1",
                [session_id],
                |r| {
                    Ok(AcpSessionRecord {
                        session_id: r.get(0)?,
                        provider: r.get(1)?,
                        external_session_id: r.get(2)?,
                        title: r.get(3)?,
                        cwd: r.get(4)?,
                        status: r.get(5)?,
                        created_at: r.get(6)?,
                        updated_at: r.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(storage_error)
        })
        .await
    }

    pub async fn update_acp_session(
        &self,
        session_id: String,
        external_session_id: Option<String>,
        title: Option<String>,
        status: Option<String>,
    ) -> Result<(), ApiError> {
        let now = Utc::now().to_rfc3339();
        self.run(move |conn| {
            if let Some(ext) = external_session_id {
                conn.execute(
                    "UPDATE acp_sessions SET external_session_id=?1, updated_at=?2 WHERE session_id=?3",
                    params![ext, &now, &session_id],
                )
                .map_err(storage_error)?;
            }
            if let Some(t) = title {
                conn.execute(
                    "UPDATE acp_sessions SET title=?1, updated_at=?2 WHERE session_id=?3",
                    params![t, &now, &session_id],
                )
                .map_err(storage_error)?;
            }
            if let Some(st) = status {
                conn.execute(
                    "UPDATE acp_sessions SET status=?1, updated_at=?2 WHERE session_id=?3",
                    params![st, &now, &session_id],
                )
                .map_err(storage_error)?;
            }
            Ok(())
        })
        .await
    }

    pub async fn delete_acp_session(&self, session_id: String) -> Result<(), ApiError> {
        self.run(move |conn| {
            conn.execute("DELETE FROM acp_sessions WHERE session_id=?1", [session_id])
                .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn append_acp_event(
        &self,
        session_id: String,
        kind: String,
        payload_json: String,
    ) -> Result<AcpEventRecord, ApiError> {
        let now = Utc::now().to_rfc3339();
        self.run(move |conn| {
            let next_seq: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(seq), 0) + 1 FROM acp_events WHERE session_id=?1",
                    [&session_id],
                    |r| r.get(0),
                )
                .map_err(storage_error)?;
            conn.execute(
                "INSERT INTO acp_events(session_id, seq, kind, payload_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![&session_id, next_seq, &kind, &payload_json, &now],
            )
            .map_err(storage_error)?;
            let id = conn.last_insert_rowid();
            conn.execute(
                "UPDATE acp_sessions SET updated_at=?1 WHERE session_id=?2",
                params![&now, &session_id],
            )
            .map_err(storage_error)?;
            Ok(AcpEventRecord {
                id,
                session_id,
                seq: next_seq,
                kind,
                payload_json,
                created_at: now,
            })
        })
        .await
    }

    pub async fn list_acp_events(&self, session_id: String) -> Result<Vec<AcpEventRecord>, ApiError> {
        self.run(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, session_id, seq, kind, payload_json, created_at
                     FROM acp_events WHERE session_id=?1 ORDER BY seq ASC",
                )
                .map_err(storage_error)?;
            let rows = stmt
                .query_map([session_id], |r| {
                    Ok(AcpEventRecord {
                        id: r.get(0)?,
                        session_id: r.get(1)?,
                        seq: r.get(2)?,
                        kind: r.get(3)?,
                        payload_json: r.get(4)?,
                        created_at: r.get(5)?,
                    })
                })
                .map_err(storage_error)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(storage_error)
        })
        .await
    }

    /// Revert an ACP session back to just before `from_event_id` (deletes that event and all later ones)
    /// and clears `external_session_id` so subsequent turns don't inherit rolled-back CLI state.
    pub async fn revert_acp_session_from_event(
        &self,
        session_id: String,
        from_event_id: i64,
    ) -> Result<usize, ApiError> {
        let now = Utc::now().to_rfc3339();
        self.run(move |conn| {
            let deleted = conn
                .execute(
                    "DELETE FROM acp_events WHERE session_id=?1 AND id >= ?2",
                    params![&session_id, from_event_id],
                )
                .map_err(storage_error)?;
            conn.execute(
                "UPDATE acp_sessions SET external_session_id = NULL, status = 'idle', updated_at = ?1 WHERE session_id = ?2",
                params![&now, &session_id],
            )
            .map_err(storage_error)?;
            Ok(deleted)
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    async fn test_db() -> Database {
        Database::open(std::env::temp_dir().join(format!("mywiki-test-{}.sqlite3", Uuid::new_v4())))
            .await
            .expect("open test db")
    }

    #[tokio::test]
    async fn fts5_search_and_wikilinks_roundtrip() {
        let db = test_db().await;
        let rec = VaultFileRecord {
            path: "writing/technical/flash-attention.md".into(),
            area: "writing".into(),
            title: "Flash Attention 笔记".into(),
            frontmatter_json: r#"{"tags":["gpu","ai"]}"#.into(),
            tags: vec!["gpu".into(), "ai".into()],
            word_count: 120,
            mtime: 1700000000,
            content_hash: "abc".into(),
            indexed_at: Utc::now().to_rfc3339(),
        };
        let link = WikilinkRecord {
            source_path: rec.path.clone(),
            target_raw: "Home".into(),
            resolved_path: Some("Home.md".into()),
            alias: Some("首页".into()),
        };
        db.upsert_vault_file(
            rec,
            "Flash Attention reduces HBM reads via SRAM tiling.".into(),
            vec![link],
        )
        .await
        .unwrap();

        let hits = db
            .search_vault("SRAM".into(), Some("writing".into()), 10)
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "writing/technical/flash-attention.md");

        let (out, back) = db.links_for_file("Home.md".into()).await.unwrap();
        assert!(out.is_empty());
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].source_path, "writing/technical/flash-attention.md");
    }

    #[tokio::test]
    async fn acp_sessions_and_events_persist() {
        let db = test_db().await;
        let s = db
            .create_acp_session("s1".into(), "claude".into(), "Today".into(), "/tmp".into())
            .await
            .unwrap();
        assert_eq!(s.session_id, "s1");
        db.append_acp_event("s1".into(), "user".into(), r#"{"text":"hello"}"#.into())
            .await
            .unwrap();
        db.append_acp_event("s1".into(), "assistant".into(), r#"{"text":"hi"}"#.into())
            .await
            .unwrap();
        let events = db.list_acp_events("s1".into()).await.unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].seq, 1);
        assert_eq!(events[1].seq, 2);
    }
}

use std::{path::PathBuf, str::FromStr, sync::Arc};

use axum::http::StatusCode;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::{
    media::{default_media_sources, MediaSource},
    ApiError,
};

#[derive(Clone)]
pub struct Database {
    path: Arc<PathBuf>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredPosition {
    pub symbol: String,
    pub quantity: String,
    pub avg_cost: String,
    pub notes: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EquitySnapshot {
    pub id: i64,
    pub recorded_at: String,
    pub total_equity: String,
    pub cash_balance: String,
    pub market_value: String,
    pub cost_basis: String,
    pub day_pnl: Option<String>,
    pub unrealized_pnl: Option<String>,
    pub unrealized_pnl_pct: Option<String>,
}

fn storage_error(error: impl std::fmt::Display) -> ApiError {
    tracing::error!("SQLite error: {error}");
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, "数据库操作失败".into())
}

pub fn default_path() -> PathBuf {
    if let Some(path) = std::env::var_os("NORTHSTAR_DATABASE_PATH") {
        return PathBuf::from(path);
    }
    let root = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir)
                .join(".local/share")
        });
    root.join("northstar/terminal.sqlite3")
}

impl Database {
    pub async fn open(path: PathBuf) -> Result<Self, ApiError> {
        let db = Self {
            path: Arc::new(path),
        };
        let path = db.path.clone();
        tokio::task::spawn_blocking(move || {
            if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
                std::fs::create_dir_all(parent).map_err(storage_error)?;
            }
            let conn = Connection::open(path.as_ref()).map_err(storage_error)?;
            conn.busy_timeout(std::time::Duration::from_secs(5))
                .map_err(storage_error)?;
            conn.execute_batch(
                "PRAGMA journal_mode=WAL;
                PRAGMA foreign_keys=ON;
                CREATE TABLE IF NOT EXISTS watchlist (
                    symbol TEXT PRIMARY KEY NOT NULL,
                    added_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS positions (
                    symbol TEXT PRIMARY KEY NOT NULL,
                    quantity TEXT NOT NULL,
                    avg_cost TEXT NOT NULL,
                    notes TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS account_settings (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS media_sources (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    outlet TEXT NOT NULL,
                    category TEXT NOT NULL,
                    language TEXT NOT NULL,
                    feed_url TEXT NOT NULL,
                    site_url TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    added_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS equity_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    recorded_at TEXT NOT NULL,
                    total_equity TEXT NOT NULL,
                    cash_balance TEXT NOT NULL,
                    market_value TEXT NOT NULL,
                    cost_basis TEXT NOT NULL,
                    day_pnl TEXT,
                    unrealized_pnl TEXT,
                    unrealized_pnl_pct TEXT
                );
                CREATE INDEX IF NOT EXISTS equity_snapshots_recorded_at
                    ON equity_snapshots(recorded_at DESC);
                PRAGMA user_version=5;",
            )
            .map_err(storage_error)?;

            let seeded: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM account_settings WHERE key='media_seeded_v1')",
                    [],
                    |r| r.get(0),
                )
                .map_err(storage_error)?;
            if !seeded {
                for src in default_media_sources() {
                    conn.execute(
                        "INSERT OR IGNORE INTO media_sources
                         (id, name, outlet, category, language, feed_url, site_url, enabled, added_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        params![
                            src.id,
                            src.name,
                            src.outlet,
                            src.category,
                            src.language,
                            src.feed_url,
                            src.site_url,
                            if src.enabled { 1 } else { 0 },
                            src.added_at,
                        ],
                    )
                    .map_err(storage_error)?;
                }
                conn.execute(
                    "INSERT OR REPLACE INTO account_settings(key, value, updated_at)
                     VALUES ('media_seeded_v1', '1', ?1)",
                    [Utc::now().to_rfc3339()],
                )
                .map_err(storage_error)?;
            }
            Ok::<_, ApiError>(())
        })
        .await
        .map_err(storage_error)??;
        Ok(db)
    }

    async fn run<T, F>(&self, operation: F) -> Result<T, ApiError>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, ApiError> + Send + 'static,
    {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = Connection::open(path.as_ref()).map_err(storage_error)?;
            conn.busy_timeout(std::time::Duration::from_secs(5))
                .map_err(storage_error)?;
            conn.execute_batch("PRAGMA foreign_keys=ON;")
                .map_err(storage_error)?;
            operation(&mut conn)
        })
        .await
        .map_err(storage_error)?
    }

    pub async fn watchlist(&self) -> Result<Vec<String>, ApiError> {
        self.run(|conn| {
            let mut stmt = conn
                .prepare("SELECT symbol FROM watchlist ORDER BY added_at, symbol")
                .map_err(storage_error)?;
            let rows = stmt
                .query_map([], |row| row.get(0))
                .map_err(storage_error)?;
            rows.collect::<rusqlite::Result<Vec<String>>>()
                .map_err(storage_error)
        })
        .await
    }

    pub async fn add_symbol(&self, symbol: String) -> Result<(), ApiError> {
        self.run(move |conn| {
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(storage_error)?;
            let count: i64 = tx
                .query_row("SELECT COUNT(*) FROM watchlist", [], |r| r.get(0))
                .map_err(storage_error)?;
            if count >= 50 {
                let exists: bool = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM watchlist WHERE symbol=?1)",
                        [&symbol],
                        |r| r.get(0),
                    )
                    .map_err(storage_error)?;
                if !exists {
                    return Err(ApiError(
                        StatusCode::BAD_REQUEST,
                        "自选最多 50 个标的".into(),
                    ));
                }
            }
            tx.execute(
                "INSERT OR IGNORE INTO watchlist(symbol, added_at) VALUES (?1, ?2)",
                params![symbol, Utc::now().to_rfc3339()],
            )
            .map_err(storage_error)?;
            tx.commit().map_err(storage_error)
        })
        .await
    }

    pub async fn remove_symbol(&self, symbol: String) -> Result<(), ApiError> {
        self.run(move |conn| {
            conn.execute("DELETE FROM watchlist WHERE symbol=?1", [symbol])
                .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn positions(&self) -> Result<Vec<StoredPosition>, ApiError> {
        self.run(|conn| {
            let mut stmt = conn
                .prepare("SELECT symbol, quantity, avg_cost, notes, updated_at FROM positions ORDER BY symbol")
                .map_err(storage_error)?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(StoredPosition {
                        symbol: row.get(0)?,
                        quantity: row.get(1)?,
                        avg_cost: row.get(2)?,
                        notes: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                })
                .map_err(storage_error)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(storage_error)
        })
        .await
    }

    pub async fn upsert_position(
        &self,
        symbol: String,
        quantity: String,
        avg_cost: String,
        notes: String,
    ) -> Result<Vec<StoredPosition>, ApiError> {
        self.run(move |conn| {
            conn.execute(
                "INSERT INTO positions(symbol, quantity, avg_cost, notes, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(symbol) DO UPDATE SET
                   quantity=excluded.quantity,
                   avg_cost=excluded.avg_cost,
                   notes=excluded.notes,
                   updated_at=excluded.updated_at",
                params![symbol, quantity, avg_cost, notes, Utc::now().to_rfc3339()],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await?;
        self.positions().await
    }

    pub async fn delete_position(&self, symbol: String) -> Result<Vec<StoredPosition>, ApiError> {
        self.run(move |conn| {
            conn.execute("DELETE FROM positions WHERE symbol=?1", [symbol])
                .map_err(storage_error)?;
            Ok(())
        })
        .await?;
        self.positions().await
    }

    pub async fn cash_balance(&self) -> Result<Decimal, ApiError> {
        self.run(|conn| {
            let raw: Option<String> = conn
                .query_row(
                    "SELECT value FROM account_settings WHERE key='cash_balance'",
                    [],
                    |r| r.get(0),
                )
                .optional()
                .map_err(storage_error)?;
            Ok(raw
                .and_then(|v| Decimal::from_str(&v).ok())
                .unwrap_or(Decimal::ZERO))
        })
        .await
    }

    pub async fn set_cash_balance(&self, amount: Decimal) -> Result<Decimal, ApiError> {
        let formatted = amount.normalize().to_string();
        self.run(move |conn| {
            conn.execute(
                "INSERT INTO account_settings(key, value, updated_at) VALUES ('cash_balance', ?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                params![formatted, Utc::now().to_rfc3339()],
            )
            .map_err(storage_error)?;
            Ok(amount)
        })
        .await
    }

    pub async fn media_sources(&self) -> Result<Vec<MediaSource>, ApiError> {
        self.run(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, outlet, category, language, feed_url, site_url, enabled, added_at
                     FROM media_sources ORDER BY added_at ASC, rowid ASC",
                )
                .map_err(storage_error)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(MediaSource {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        outlet: r.get(2)?,
                        category: r.get(3)?,
                        language: r.get(4)?,
                        feed_url: r.get(5)?,
                        site_url: r.get(6)?,
                        enabled: r.get::<_, i64>(7)? != 0,
                        added_at: r.get(8)?,
                    })
                })
                .map_err(storage_error)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(storage_error)
        })
        .await
    }

    pub async fn upsert_media_source(&self, src: MediaSource) -> Result<(), ApiError> {
        self.run(move |conn| {
            conn.execute(
                "INSERT INTO media_sources
                 (id, name, outlet, category, language, feed_url, site_url, enabled, added_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                   name=excluded.name,
                   outlet=excluded.outlet,
                   category=excluded.category,
                   language=excluded.language,
                   feed_url=excluded.feed_url,
                   site_url=excluded.site_url,
                   enabled=excluded.enabled",
                params![
                    src.id,
                    src.name,
                    src.outlet,
                    src.category,
                    src.language,
                    src.feed_url,
                    src.site_url,
                    if src.enabled { 1 } else { 0 },
                    src.added_at,
                ],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn set_media_source_enabled(&self, id: String, enabled: bool) -> Result<(), ApiError> {
        self.run(move |conn| {
            let changed = conn
                .execute(
                    "UPDATE media_sources SET enabled=?1 WHERE id=?2",
                    params![if enabled { 1 } else { 0 }, id],
                )
                .map_err(storage_error)?;
            if changed == 0 {
                return Err(ApiError(StatusCode::NOT_FOUND, "未找到该媒体源".into()));
            }
            Ok(())
        })
        .await
    }

    pub async fn delete_media_source(&self, id: String) -> Result<(), ApiError> {
        self.run(move |conn| {
            conn.execute("DELETE FROM media_sources WHERE id=?1", [id])
                .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn record_equity_snapshot(
        &self,
        snap: EquitySnapshot,
        min_interval_secs: i64,
    ) -> Result<bool, ApiError> {
        self.run(move |conn| {
            let last: Option<(String, String, String, Option<String>)> = conn
                .query_row(
                    "SELECT recorded_at, total_equity, cash_balance, unrealized_pnl
                     FROM equity_snapshots ORDER BY id DESC LIMIT 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()
                .map_err(storage_error)?;

            if let Some((last_at, last_eq, last_cash, last_pnl)) = last {
                let unchanged = last_eq == snap.total_equity
                    && last_cash == snap.cash_balance
                    && last_pnl == snap.unrealized_pnl;
                if min_interval_secs > 0 && unchanged {
                    if let (Ok(prev_dt), Ok(cur_dt)) = (
                        chrono::DateTime::parse_from_rfc3339(&last_at),
                        chrono::DateTime::parse_from_rfc3339(&snap.recorded_at),
                    ) {
                        if (cur_dt - prev_dt).num_seconds() < min_interval_secs {
                            return Ok(false);
                        }
                    }
                }
            }

            conn.execute(
                "INSERT INTO equity_snapshots
                 (recorded_at, total_equity, cash_balance, market_value, cost_basis,
                  day_pnl, unrealized_pnl, unrealized_pnl_pct)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    snap.recorded_at,
                    snap.total_equity,
                    snap.cash_balance,
                    snap.market_value,
                    snap.cost_basis,
                    snap.day_pnl,
                    snap.unrealized_pnl,
                    snap.unrealized_pnl_pct,
                ],
            )
            .map_err(storage_error)?;
            Ok(true)
        })
        .await
    }

    pub async fn equity_history(
        &self,
        since_rfc3339: Option<String>,
        limit: usize,
    ) -> Result<Vec<EquitySnapshot>, ApiError> {
        let cap = limit.clamp(1, 2000) as i64;
        self.run(move |conn| {
            let mut rows_out = Vec::new();
            if let Some(since) = since_rfc3339 {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, recorded_at, total_equity, cash_balance, market_value,
                                cost_basis, day_pnl, unrealized_pnl, unrealized_pnl_pct
                         FROM equity_snapshots
                         WHERE recorded_at >= ?1
                         ORDER BY recorded_at DESC, id DESC LIMIT ?2",
                    )
                    .map_err(storage_error)?;
                let iter = stmt
                    .query_map(params![since, cap], row_to_equity_snapshot)
                    .map_err(storage_error)?;
                for r in iter {
                    rows_out.push(r.map_err(storage_error)?);
                }
            } else {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, recorded_at, total_equity, cash_balance, market_value,
                                cost_basis, day_pnl, unrealized_pnl, unrealized_pnl_pct
                         FROM equity_snapshots
                         ORDER BY recorded_at DESC, id DESC LIMIT ?1",
                    )
                    .map_err(storage_error)?;
                let iter = stmt
                    .query_map(params![cap], row_to_equity_snapshot)
                    .map_err(storage_error)?;
                for r in iter {
                    rows_out.push(r.map_err(storage_error)?);
                }
            }
            rows_out.reverse();
            Ok(rows_out)
        })
        .await
    }
}

fn row_to_equity_snapshot(r: &rusqlite::Row<'_>) -> rusqlite::Result<EquitySnapshot> {
    Ok(EquitySnapshot {
        id: r.get(0)?,
        recorded_at: r.get(1)?,
        total_equity: r.get(2)?,
        cash_balance: r.get(3)?,
        market_value: r.get(4)?,
        cost_basis: r.get(5)?,
        day_pnl: r.get(6)?,
        unrealized_pnl: r.get(7)?,
        unrealized_pnl_pct: r.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    async fn database() -> Database {
        Database::open(
            std::env::temp_dir().join(format!("northstar-test-{}.sqlite3", Uuid::new_v4())),
        )
        .await
        .expect("test database")
    }

    #[tokio::test]
    async fn watchlist_positions_and_cash_survive_reopening() {
        let db = database().await;
        db.add_symbol("AAPL.US".into()).await.unwrap();
        db.set_cash_balance(Decimal::from(892)).await.unwrap();
        db.upsert_position("ANT.US".into(), "19".into(), "105".into(), "hold".into())
            .await
            .unwrap();

        let reopened = Database::open(db.path.as_ref().clone()).await.unwrap();
        assert_eq!(reopened.watchlist().await.unwrap(), vec!["AAPL.US"]);
        assert_eq!(reopened.cash_balance().await.unwrap(), Decimal::from(892));
        let pos = reopened.positions().await.unwrap();
        assert_eq!(pos.len(), 1);
        assert_eq!(pos[0].symbol, "ANT.US");
        assert_eq!(pos[0].quantity, "19");
    }

    #[tokio::test]
    async fn media_sources_seed_once_and_respect_user_changes() {
        let db = database().await;
        let seeded = db.media_sources().await.unwrap();
        assert!(seeded.len() >= 15);
        let first_id = seeded[0].id.clone();

        db.set_media_source_enabled(first_id.clone(), false)
            .await
            .unwrap();
        db.delete_media_source(seeded[1].id.clone()).await.unwrap();

        let reopened = Database::open(db.path.as_ref().clone()).await.unwrap();
        let after = reopened.media_sources().await.unwrap();
        assert_eq!(after.len(), seeded.len() - 1);
        assert!(!after.iter().find(|s| s.id == first_id).unwrap().enabled);
    }

    #[tokio::test]
    async fn equity_snapshots_record_deduplicate_and_query_chronologically() {
        let db = database().await;
        let base = EquitySnapshot {
            id: 0,
            recorded_at: "2026-11-20T15:00:00+00:00".into(),
            total_equity: "3514.02".into(),
            cash_balance: "892.06".into(),
            market_value: "2621.96".into(),
            cost_basis: "3025.03".into(),
            day_pnl: Some("-200.74".into()),
            unrealized_pnl: Some("-403.07".into()),
            unrealized_pnl_pct: Some("-13.32".into()),
        };
        assert!(db.record_equity_snapshot(base.clone(), 300).await.unwrap());
        let dup = EquitySnapshot {
            recorded_at: "2026-11-20T15:02:00+00:00".into(),
            ..base.clone()
        };
        assert!(!db.record_equity_snapshot(dup, 300).await.unwrap());
        let moved = EquitySnapshot {
            recorded_at: "2026-11-20T15:03:00+00:00".into(),
            total_equity: "3520.50".into(),
            unrealized_pnl: Some("-396.59".into()),
            ..base
        };
        assert!(db.record_equity_snapshot(moved, 300).await.unwrap());

        let hist = db.equity_history(None, 50).await.unwrap();
        assert_eq!(hist.len(), 2);
        assert_eq!(hist[0].total_equity, "3514.02");
        assert_eq!(hist[1].total_equity, "3520.50");
    }
}

use std::{path::PathBuf, str::FromStr, sync::Arc};

use axum::http::StatusCode;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::ApiError;

#[derive(Clone)]
pub struct InvestDatabase {
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
    tracing::error!("Invest SQLite error: {error}");
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, "投研数据库操作失败".into())
}

fn row_to_equity_snapshot(r: &Row<'_>) -> rusqlite::Result<EquitySnapshot> {
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

impl InvestDatabase {
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
                    ON equity_snapshots(recorded_at DESC);",
            )
            .map_err(storage_error)?;
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

use std::{path::PathBuf, sync::Arc};

use axum::http::StatusCode;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use uuid::Uuid;

use crate::{ApiError, OrderEntry, OrderRequest, OrderResult};

#[derive(Clone)]
pub struct Database {
    path: Arc<PathBuf>,
}

pub enum Submission {
    Existing(OrderEntry),
    New(OrderEntry),
}

fn storage_error(error: impl std::fmt::Display) -> ApiError {
    tracing::error!("SQLite operation failed: {error}");
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "数据库操作失败，请检查服务日志".into(),
    )
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

pub fn canonical_order(order: &OrderRequest) -> String {
    serde_json::json!({
        "symbol": order.symbol, "side": order.side, "quantity": order.quantity,
        "order_type": order.order_type, "limit_price": order.limit_price,
    })
    .to_string()
}

impl Database {
    pub async fn open(path: PathBuf) -> Result<Self, ApiError> {
        let db = Self {
            path: Arc::new(path),
        };
        let path = db.path.clone();
        tokio::task::spawn_blocking(move || {
            if let Some(parent) = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
            {
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
                CREATE TABLE IF NOT EXISTS order_previews (
                    preview_id TEXT PRIMARY KEY NOT NULL,
                    request_json TEXT NOT NULL,
                    mode TEXT NOT NULL CHECK (mode IN ('paper', 'live')),
                    created_at TEXT NOT NULL,
                    expires_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS orders (
                    preview_id TEXT PRIMARY KEY NOT NULL REFERENCES order_previews(preview_id),
                    mode TEXT NOT NULL CHECK (mode IN ('paper', 'live')),
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    entry_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS orders_created_at ON orders(created_at DESC);
                PRAGMA user_version=1;",
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
            let mut query = conn
                .prepare("SELECT symbol FROM watchlist ORDER BY added_at, symbol")
                .map_err(storage_error)?;
            let rows = query
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
                .query_row("SELECT COUNT(*) FROM watchlist", [], |row| row.get(0))
                .map_err(storage_error)?;
            if count >= 50 {
                let exists: bool = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM watchlist WHERE symbol=?1)",
                        [&symbol],
                        |row| row.get(0),
                    )
                    .map_err(storage_error)?;
                if !exists {
                    return Err(ApiError(
                        StatusCode::BAD_REQUEST,
                        "自选列表最多保存 50 个标的".into(),
                    ));
                }
            }
            tx.execute(
                "INSERT OR IGNORE INTO watchlist(symbol,added_at) VALUES (?1,?2)",
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

    pub async fn save_preview(
        &self,
        order: &OrderRequest,
        mode: String,
    ) -> Result<String, ApiError> {
        let id = Uuid::new_v4().to_string();
        let request = canonical_order(order);
        let saved_id = id.clone();
        self.run(move |conn| {
            conn.execute("INSERT INTO order_previews(preview_id, request_json, mode, created_at, expires_at) VALUES (?1,?2,?3,?4,?5)",
                params![saved_id, request, mode, Utc::now().to_rfc3339(), Utc::now().timestamp() + 600]).map_err(storage_error)?;
            Ok(())
        }).await?;
        Ok(id)
    }

    pub async fn prepare_submission(
        &self,
        order: &OrderRequest,
        mode: String,
    ) -> Result<Submission, ApiError> {
        let id = order
            .preview_id
            .clone()
            .ok_or_else(|| ApiError(StatusCode::CONFLICT, "请先预览订单，再确认提交".into()))?;
        let request = canonical_order(order);
        let order = order.clone();
        self.run(move |conn| {
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(storage_error)?;
            let saved = tx.query_row("SELECT request_json, mode, expires_at FROM order_previews WHERE preview_id=?1", [&id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?))).optional().map_err(storage_error)?;
            let (saved_request, saved_mode, expires_at) = saved.ok_or_else(|| ApiError(StatusCode::CONFLICT, "预览不存在，请重新预览订单".into()))?;
            if saved_request != request || saved_mode != mode {
                return Err(ApiError(StatusCode::CONFLICT, "订单参数或交易模式已改变，请重新预览".into()));
            }
            let existing: Option<String> = tx.query_row("SELECT entry_json FROM orders WHERE preview_id=?1", [&id], |row| row.get(0)).optional().map_err(storage_error)?;
            if let Some(value) = existing {
                let entry = serde_json::from_str(&value).map_err(storage_error)?;
                return Ok(Submission::Existing(entry));
            }
            if expires_at < Utc::now().timestamp() {
                return Err(ApiError(StatusCode::CONFLICT, "预览已过期，请重新预览订单".into()));
            }
            let paper = mode == "paper";
            let entry = OrderEntry {
                result: OrderResult {
                    order_id: format!("{}-{}", if paper { "paper" } else { "pending" }, id),
                    status: if paper { "accepted" } else { "submitting" }.into(), mode: mode.clone(),
                    provider: if paper { "paper" } else { "schwab" }.into(),
                    message: if paper { "纸上订单已接受，未向券商发送，未模拟成交" } else { "委托正在提交，不能重复发送" }.into(),
                },
                symbol: order.symbol, side: order.side, quantity: order.quantity,
                order_type: order.order_type, limit_price: order.limit_price,
                created_at: Utc::now().to_rfc3339(),
            };
            tx.execute("INSERT INTO orders(preview_id, mode, status, created_at, entry_json) VALUES (?1,?2,?3,?4,?5)",
                params![id, mode, entry.result.status, entry.created_at, serde_json::to_string(&entry).map_err(storage_error)?]).map_err(storage_error)?;
            tx.commit().map_err(storage_error)?;
            Ok(Submission::New(entry))
        }).await
    }

    pub async fn finish_submission(
        &self,
        preview_id: String,
        entry: OrderEntry,
    ) -> Result<(), ApiError> {
        self.run(move |conn| {
            conn.execute(
                "UPDATE orders SET status=?1,entry_json=?2 WHERE preview_id=?3",
                params![
                    entry.result.status,
                    serde_json::to_string(&entry).map_err(storage_error)?,
                    preview_id
                ],
            )
            .map_err(storage_error)?;
            Ok(())
        })
        .await
    }

    pub async fn orders(&self) -> Result<Vec<OrderEntry>, ApiError> {
        self.run(|conn| {
            let mut query = conn
                .prepare("SELECT entry_json FROM orders ORDER BY created_at ASC LIMIT 1000")
                .map_err(storage_error)?;
            let rows = query
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(storage_error)?;
            rows.map(|row| {
                serde_json::from_str(&row.map_err(storage_error)?).map_err(storage_error)
            })
            .collect()
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn database() -> Database {
        Database::open(
            std::env::temp_dir().join(format!("northstar-test-{}.sqlite3", Uuid::new_v4())),
        )
        .await
        .expect("test database")
    }

    fn order() -> OrderRequest {
        OrderRequest {
            symbol: "AAPL.US".into(),
            side: "buy".into(),
            quantity: "2".into(),
            order_type: "limit".into(),
            limit_price: Some("100.25".into()),
            confirmation: Some("never-store-this-secret".into()),
            preview_id: None,
        }
    }

    #[tokio::test]
    async fn watchlist_and_paper_orders_survive_reopening() {
        let db = database().await;
        assert!(db.watchlist().await.unwrap().is_empty());
        assert!(db.orders().await.unwrap().is_empty());
        db.add_symbol("AAPL.US".into()).await.unwrap();
        db.add_symbol("AAPL.US".into()).await.unwrap();
        let mut order = order();
        order.preview_id = Some(db.save_preview(&order, "paper".into()).await.unwrap());
        assert!(matches!(
            db.prepare_submission(&order, "paper".into()).await.unwrap(),
            Submission::New(_)
        ));
        let reopened = Database::open(db.path.as_ref().clone()).await.unwrap();
        assert_eq!(reopened.watchlist().await.unwrap(), vec!["AAPL.US"]);
        let entries = reopened.orders().await.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].result.mode, "paper");
        assert_eq!(entries[0].quantity, "2");
        let stored = reopened
            .run(|conn| {
                let request: String = conn
                    .query_row("SELECT request_json FROM order_previews", [], |row| {
                        row.get(0)
                    })
                    .map_err(storage_error)?;
                Ok(request)
            })
            .await
            .unwrap();
        assert!(!stored.contains("never-store-this-secret"));
        assert!(!stored.contains("confirmation"));
    }

    #[tokio::test]
    async fn repeated_concurrent_submission_creates_one_order() {
        let db = database().await;
        let mut order = order();
        order.preview_id = Some(db.save_preview(&order, "paper".into()).await.unwrap());
        let (first, second) = tokio::join!(
            db.prepare_submission(&order, "paper".into()),
            db.prepare_submission(&order, "paper".into())
        );
        let results = [first.unwrap(), second.unwrap()];
        assert_eq!(
            results
                .iter()
                .filter(|value| matches!(value, Submission::New(_)))
                .count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|value| matches!(value, Submission::Existing(_)))
                .count(),
            1
        );
        assert_eq!(db.orders().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn changed_missing_expired_or_different_mode_previews_cannot_submit() {
        let db = database().await;
        let mut order = order();
        assert!(db.prepare_submission(&order, "paper".into()).await.is_err());
        order.preview_id = Some(db.save_preview(&order, "paper".into()).await.unwrap());
        assert!(db.prepare_submission(&order, "live".into()).await.is_err());
        order.quantity = "3".into();
        assert!(db.prepare_submission(&order, "paper".into()).await.is_err());
        order.quantity = "2".into();
        db.run(|conn| {
            conn.execute("UPDATE order_previews SET expires_at=0", [])
                .map_err(storage_error)?;
            Ok(())
        })
        .await
        .unwrap();
        assert!(db.prepare_submission(&order, "paper".into()).await.is_err());
        assert!(db.orders().await.unwrap().is_empty());
    }
}

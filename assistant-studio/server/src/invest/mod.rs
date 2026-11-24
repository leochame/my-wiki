pub mod db;
pub mod envfile;
pub mod lb_cli;

use std::{collections::HashMap, env, str::FromStr, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::{Duration, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::RwLock;
use tracing::info;

use crate::ApiError;
use db::{EquitySnapshot, InvestDatabase};
use lb_cli::{AgentChatRequest, AgentStatus, LongbridgeCli};

#[derive(Clone, Debug, Default)]
struct SecurityMeta {
    name_en: Option<String>,
    name_cn: Option<String>,
    exchange: Option<String>,
}

#[derive(Clone)]
pub struct InvestState {
    env_report: Arc<envfile::EnvLoadReport>,
    longbridge: Option<Arc<longbridge::QuoteContext>>,
    longbridge_missing: Vec<&'static str>,
    meta_cache: Arc<RwLock<HashMap<String, SecurityMeta>>>,
    lb_cli: LongbridgeCli,
    db: InvestDatabase,
}

fn longbridge_missing_vars() -> Vec<&'static str> {
    ["LONGBRIDGE_APP_KEY", "LONGBRIDGE_APP_SECRET", "LONGBRIDGE_ACCESS_TOKEN"]
        .into_iter()
        .filter(|key| env::var(key).ok().is_none_or(|v| v.trim().is_empty()))
        .collect()
}

impl InvestState {
    pub async fn init() -> Self {
        let env_report = envfile::load_external_env(&envfile::default_env_path());
        if env_report.loaded {
            info!(
                "Loaded {} Longbridge env key(s) from {}",
                env_report.applied_keys,
                env_report.path.display()
            );
        }

        let longbridge_missing = longbridge_missing_vars();
        let longbridge = match longbridge::Config::from_apikey_env() {
            Ok(config) => {
                let (context, _receiver) = longbridge::QuoteContext::new(Arc::new(config));
                Some(Arc::new(context))
            }
            Err(error) => {
                info!("Longbridge quote context not configured: {error}");
                None
            }
        };

        let db = InvestDatabase::open(db::default_path())
            .await
            .expect("initialize invest SQLite database");

        let state = Self {
            env_report: Arc::new(env_report),
            longbridge,
            longbridge_missing,
            meta_cache: Arc::new(RwLock::new(HashMap::new())),
            lb_cli: LongbridgeCli::new(),
            db,
        };

        // Background 5-minute equity curve recorder (preserves historical curve seamlessly)
        let bg = state.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(4)).await;
            loop {
                if let Ok(overview) = build_manual_account(&bg).await {
                    maybe_record_equity_snapshot(&bg, &overview, 300).await;
                }
                tokio::time::sleep(std::time::Duration::from_secs(300)).await;
            }
        });

        state
    }

    pub fn is_longbridge_ready(&self) -> bool {
        self.longbridge.is_some()
    }

    pub async fn account_overview_json(&self) -> Option<Value> {
        let overview = build_manual_account(self).await.ok()?;
        serde_json::to_value(overview).ok()
    }
}

pub fn invest_router(state: InvestState) -> Router {
    Router::new()
        .route("/invest/health", get(health))
        .route("/account", get(account_overview))
        .route("/portfolio/cash", put(set_cash))
        .route("/portfolio/positions", post(upsert_position))
        .route("/portfolio/positions/{symbol}", delete(delete_position))
        .route("/portfolio/history", get(portfolio_history))
        .route("/portfolio/snapshot", post(record_portfolio_snapshot))
        .route("/agent/status", get(agent_status))
        .route("/agent/login", post(agent_login))
        .route("/agent/list", get(agent_list))
        .route("/agent/chat", post(agent_chat))
        .route("/agent/intel/{symbol}", get(agent_intel))
        .route("/watchlist", get(watchlist).post(add_symbol))
        .route("/watchlist/snapshots", get(watchlist_snapshots))
        .route("/watchlist/{symbol}", delete(remove_symbol))
        .route("/quotes/{symbol}", get(quote))
        .route("/candles/{symbol}", get(candles))
        .with_state(state)
}

#[derive(Serialize)]
struct InvestHealth {
    longbridge_ready: bool,
    longbridge_missing: Vec<&'static str>,
    env_file_loaded: bool,
    env_file_path: String,
}

#[derive(Serialize, Clone)]
struct PositionItem {
    symbol: String,
    name_en: Option<String>,
    name_cn: Option<String>,
    asset_type: String,
    quantity: String,
    average_price: String,
    current_price: Option<String>,
    market_value: String,
    cost_basis: String,
    day_pnl: Option<String>,
    day_pnl_pct: Option<String>,
    unrealized_pnl: Option<String>,
    unrealized_pnl_pct: Option<String>,
    weight_pct: Option<String>,
    notes: String,
}

#[derive(Serialize, Clone)]
struct AccountOverview {
    account_label: String,
    account_type: String,
    currency: String,
    total_equity: String,
    cash_balance: String,
    buying_power: String,
    day_pnl: Option<String>,
    day_pnl_pct: Option<String>,
    unrealized_pnl: Option<String>,
    unrealized_pnl_pct: Option<String>,
    positions_count: usize,
    positions: Vec<PositionItem>,
    updated_at: String,
    source: &'static str,
}

#[derive(Serialize, Clone)]
struct Quote {
    symbol: String,
    name_en: Option<String>,
    name_cn: Option<String>,
    exchange: Option<String>,
    last: String,
    previous_close: Option<String>,
    open: Option<String>,
    high: Option<String>,
    low: Option<String>,
    volume: Option<u64>,
    timestamp: String,
}

#[derive(Serialize, Clone)]
struct WatchlistSnapshot {
    symbol: String,
    name_en: Option<String>,
    name_cn: Option<String>,
    exchange: Option<String>,
    last: Option<String>,
    previous_close: Option<String>,
    timestamp: Option<String>,
}

#[derive(Serialize)]
struct Candle {
    timestamp: String,
    open: String,
    high: String,
    low: String,
    close: String,
    volume: Option<u64>,
}

#[derive(Deserialize)]
struct CandleQuery {
    period: Option<String>,
    count: Option<usize>,
}

#[derive(Deserialize)]
struct SymbolRequest {
    symbol: String,
}

#[derive(Deserialize)]
struct CashRequest {
    cash_balance: String,
}

#[derive(Deserialize)]
struct PositionRequest {
    symbol: String,
    quantity: String,
    avg_cost: String,
    #[serde(default)]
    notes: String,
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn validate_market_symbol(raw: &str, allow_index: bool) -> Result<String, ApiError> {
    let symbol = raw.trim().to_uppercase();
    let valid = symbol
        .strip_suffix(".US")
        .or_else(|| symbol.strip_suffix(".HK"))
        .is_some_and(|ticker| {
            !ticker.is_empty()
                && (allow_index || !ticker.starts_with('.'))
                && ticker
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        });
    if !valid || symbol.len() > 30 {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            if allow_index {
                "代码格式需带 .US 或 .HK 后缀（如 AAPL.US、.VIX.US）".into()
            } else {
                "交易标的需带 .US 或 .HK 后缀且不可为指数".into()
            },
        ));
    }
    Ok(symbol)
}

fn parse_candle_period(
    raw: Option<&str>,
) -> Result<(longbridge::quote::Period, longbridge::quote::TradeSessions), ApiError> {
    use longbridge::quote::{Period, TradeSessions};
    match raw.unwrap_or("day").trim().to_lowercase().as_str() {
        "1m" => Ok((Period::OneMinute, TradeSessions::All)),
        "5m" => Ok((Period::FiveMinute, TradeSessions::All)),
        "15m" => Ok((Period::FifteenMinute, TradeSessions::All)),
        "30m" => Ok((Period::ThirtyMinute, TradeSessions::All)),
        "60m" | "1h" => Ok((Period::SixtyMinute, TradeSessions::All)),
        "day" | "1d" => Ok((Period::Day, TradeSessions::Intraday)),
        "week" | "1w" => Ok((Period::Week, TradeSessions::Intraday)),
        "month" | "1mo" => Ok((Period::Month, TradeSessions::Intraday)),
        other => Err(ApiError(
            StatusCode::BAD_REQUEST,
            format!("不支持的 K 线周期: {other}"),
        )),
    }
}

fn positive_decimal(value: &str, field: &str) -> Result<Decimal, ApiError> {
    let value = Decimal::from_str(value.trim())
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, format!("{field} 必须为正数")))?;
    if value <= Decimal::ZERO {
        return Err(ApiError(StatusCode::BAD_REQUEST, format!("{field} 必须大于 0")));
    }
    Ok(value)
}

async fn fetch_static_meta(state: &InvestState, symbols: &[String]) -> HashMap<String, SecurityMeta> {
    let mut result = HashMap::new();
    let mut missing = Vec::new();
    {
        let cache = state.meta_cache.read().await;
        for symbol in symbols {
            if let Some(meta) = cache.get(symbol) {
                result.insert(symbol.clone(), meta.clone());
            } else {
                missing.push(symbol.clone());
            }
        }
    }
    if missing.is_empty() {
        return result;
    }
    let Some(context) = &state.longbridge else {
        return result;
    };
    if let Ok(Ok(infos)) = tokio::time::timeout(
        std::time::Duration::from_secs(6),
        context.static_info(missing),
    )
    .await
    {
        let mut cache = state.meta_cache.write().await;
        for info in infos {
            let sym = info.symbol.to_uppercase();
            let meta = SecurityMeta {
                name_en: non_empty_string(&info.name_en),
                name_cn: non_empty_string(&info.name_cn)
                    .or_else(|| non_empty_string(&info.name_hk)),
                exchange: non_empty_string(&info.exchange),
            };
            cache.insert(sym.clone(), meta.clone());
            result.insert(sym, meta);
        }
    }
    result
}

async fn health(State(state): State<InvestState>) -> Json<InvestHealth> {
    Json(InvestHealth {
        longbridge_ready: state.longbridge.is_some(),
        longbridge_missing: state.longbridge_missing.clone(),
        env_file_loaded: state.env_report.loaded,
        env_file_path: state.env_report.path.display().to_string(),
    })
}

async fn build_manual_account(state: &InvestState) -> Result<AccountOverview, ApiError> {
    let (stored_positions, cash) = tokio::try_join!(state.db.positions(), state.db.cash_balance())?;
    let symbols: Vec<String> = stored_positions.iter().map(|p| p.symbol.clone()).collect();

    let (meta_map, quote_map) = if !symbols.is_empty() {
        let quotes = if let Some(ctx) = &state.longbridge {
            tokio::time::timeout(std::time::Duration::from_secs(6), ctx.quote(symbols.clone()))
                .await
                .ok()
                .and_then(|r| r.ok())
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let mut by_sym = HashMap::new();
        for q in quotes {
            by_sym.insert(q.symbol.to_uppercase(), q);
        }
        let meta = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            fetch_static_meta(state, &symbols),
        )
        .await
        .unwrap_or_default();
        (meta, by_sym)
    } else {
        (HashMap::new(), HashMap::new())
    };

    let mut total_market_value = Decimal::ZERO;
    let mut total_cost_basis = Decimal::ZERO;
    let mut total_day_pnl = Decimal::ZERO;
    let mut has_day_pnl = false;
    let mut total_unrealized = Decimal::ZERO;
    let mut has_unrealized = false;

    let mut raw_items = Vec::with_capacity(stored_positions.len());
    for pos in stored_positions {
        let qty = Decimal::from_str(&pos.quantity).unwrap_or(Decimal::ZERO);
        let avg_cost = Decimal::from_str(&pos.avg_cost).unwrap_or(Decimal::ZERO);
        let cost_basis = qty * avg_cost;
        total_cost_basis += cost_basis;

        let live = quote_map.get(&pos.symbol);
        let cur_price = live.map(|q| q.last_done).filter(|p| *p > Decimal::ZERO);
        let prev_close = live.map(|q| q.prev_close).filter(|p| *p > Decimal::ZERO);
        let mark_price = cur_price.unwrap_or(avg_cost);
        let market_value = qty * mark_price;
        total_market_value += market_value;

        let day_pnl = match (cur_price, prev_close) {
            (Some(last), Some(prev)) => {
                let pnl = (last - prev) * qty;
                total_day_pnl += pnl;
                has_day_pnl = true;
                Some(pnl)
            }
            _ => None,
        };
        let day_pnl_pct = match (cur_price, prev_close) {
            (Some(last), Some(prev)) if prev > Decimal::ZERO => {
                Some(((last - prev) / prev * Decimal::from(100)).round_dp(2))
            }
            _ => None,
        };
        let unrealized = cur_price.map(|_| {
            let pnl = market_value - cost_basis;
            total_unrealized += pnl;
            has_unrealized = true;
            pnl
        });
        let unrealized_pct = unrealized.and_then(|pnl| {
            (!cost_basis.is_zero()).then(|| ((pnl / cost_basis.abs()) * Decimal::from(100)).round_dp(2))
        });

        raw_items.push((
            pos,
            cost_basis,
            cur_price,
            market_value,
            day_pnl,
            day_pnl_pct,
            unrealized,
            unrealized_pct,
        ));
    }

    let total_equity = cash + total_market_value;
    let positions: Vec<PositionItem> = raw_items
        .into_iter()
        .map(
            |(pos, cost_basis, cur_price, market_value, day_pnl, day_pnl_pct, unrealized, unrealized_pct)| {
                let meta = meta_map.get(&pos.symbol);
                let weight_pct = (total_equity > Decimal::ZERO)
                    .then(|| ((market_value / total_equity) * Decimal::from(100)).round_dp(1));
                PositionItem {
                    symbol: pos.symbol,
                    name_en: meta.and_then(|m| m.name_en.clone()),
                    name_cn: meta.and_then(|m| m.name_cn.clone()),
                    asset_type: "EQUITY".into(),
                    quantity: pos.quantity,
                    average_price: pos.avg_cost,
                    current_price: cur_price.map(|v| v.normalize().to_string()),
                    market_value: market_value.round_dp(2).normalize().to_string(),
                    cost_basis: cost_basis.round_dp(2).normalize().to_string(),
                    day_pnl: day_pnl.map(|v| v.round_dp(2).normalize().to_string()),
                    day_pnl_pct: day_pnl_pct.map(|v| v.normalize().to_string()),
                    unrealized_pnl: unrealized.map(|v| v.round_dp(2).normalize().to_string()),
                    unrealized_pnl_pct: unrealized_pct.map(|v| v.normalize().to_string()),
                    weight_pct: weight_pct.map(|v| v.normalize().to_string()),
                    notes: pos.notes,
                }
            },
        )
        .collect();

    let day_pnl_pct = if has_day_pnl {
        let base = total_equity - total_day_pnl;
        (base > Decimal::ZERO)
            .then(|| ((total_day_pnl / base) * Decimal::from(100)).round_dp(2).normalize().to_string())
    } else {
        None
    };
    let unrealized_pnl_pct = if has_unrealized && total_cost_basis > Decimal::ZERO {
        Some(
            ((total_unrealized / total_cost_basis) * Decimal::from(100))
                .round_dp(2)
                .normalize()
                .to_string(),
        )
    } else {
        None
    };

    Ok(AccountOverview {
        account_label: "嘉信国际 · 本地账本".into(),
        account_type: "INTERNATIONAL".into(),
        currency: "USD".into(),
        total_equity: total_equity.round_dp(2).normalize().to_string(),
        cash_balance: cash.round_dp(2).normalize().to_string(),
        buying_power: cash.round_dp(2).normalize().to_string(),
        day_pnl: has_day_pnl.then(|| total_day_pnl.round_dp(2).normalize().to_string()),
        day_pnl_pct,
        unrealized_pnl: has_unrealized.then(|| total_unrealized.round_dp(2).normalize().to_string()),
        unrealized_pnl_pct,
        positions_count: positions.len(),
        positions,
        updated_at: Utc::now().to_rfc3339(),
        source: "local_ledger",
    })
}

fn snapshot_from_overview(overview: &AccountOverview) -> Option<EquitySnapshot> {
    let total_eq = Decimal::from_str(&overview.total_equity).unwrap_or(Decimal::ZERO);
    let cash = Decimal::from_str(&overview.cash_balance).unwrap_or(Decimal::ZERO);
    if overview.positions_count == 0 && cash <= Decimal::ZERO {
        return None;
    }
    if overview.positions_count > 0 && overview.unrealized_pnl.is_none() {
        return None;
    }
    let market_value = (total_eq - cash).round_dp(2);
    let cost_basis: Decimal = overview
        .positions
        .iter()
        .filter_map(|p| Decimal::from_str(&p.cost_basis).ok())
        .sum();
    Some(EquitySnapshot {
        id: 0,
        recorded_at: Utc::now().to_rfc3339(),
        total_equity: total_eq.round_dp(2).normalize().to_string(),
        cash_balance: cash.round_dp(2).normalize().to_string(),
        market_value: market_value.normalize().to_string(),
        cost_basis: cost_basis.round_dp(2).normalize().to_string(),
        day_pnl: overview.day_pnl.clone(),
        unrealized_pnl: overview.unrealized_pnl.clone(),
        unrealized_pnl_pct: overview.unrealized_pnl_pct.clone(),
    })
}

async fn maybe_record_equity_snapshot(
    state: &InvestState,
    overview: &AccountOverview,
    min_interval_secs: i64,
) {
    if let Some(snap) = snapshot_from_overview(overview) {
        let _ = state.db.record_equity_snapshot(snap, min_interval_secs).await;
    }
}

async fn account_overview(State(state): State<InvestState>) -> Result<Json<AccountOverview>, ApiError> {
    Ok(Json(build_manual_account(&state).await?))
}

#[derive(Deserialize)]
struct HistoryQuery {
    range: Option<String>,
    limit: Option<usize>,
}

async fn portfolio_history(
    State(state): State<InvestState>,
    Query(q): Query<HistoryQuery>,
) -> Result<Json<Vec<EquitySnapshot>>, ApiError> {
    let since = match q.range.as_deref().unwrap_or("1w") {
        "1d" => Some((Utc::now() - Duration::hours(24)).to_rfc3339()),
        "1w" => Some((Utc::now() - Duration::days(7)).to_rfc3339()),
        "1m" => Some((Utc::now() - Duration::days(30)).to_rfc3339()),
        _ => None,
    };
    let rows = state
        .db
        .equity_history(since, q.limit.unwrap_or(500))
        .await?;
    Ok(Json(rows))
}

async fn record_portfolio_snapshot(
    State(state): State<InvestState>,
) -> Result<Json<Vec<EquitySnapshot>>, ApiError> {
    let overview = build_manual_account(&state).await?;
    maybe_record_equity_snapshot(&state, &overview, 0).await;
    let rows = state.db.equity_history(None, 500).await?;
    Ok(Json(rows))
}

async fn set_cash(
    State(state): State<InvestState>,
    Json(req): Json<CashRequest>,
) -> Result<Json<AccountOverview>, ApiError> {
    let amount = Decimal::from_str(req.cash_balance.trim())
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "现金余额必须为有效数字".into()))?;
    if amount < Decimal::ZERO {
        return Err(ApiError(StatusCode::BAD_REQUEST, "现金余额不能为负数".into()));
    }
    state.db.set_cash_balance(amount).await?;
    let overview = build_manual_account(&state).await?;
    maybe_record_equity_snapshot(&state, &overview, 0).await;
    Ok(Json(overview))
}

async fn upsert_position(
    State(state): State<InvestState>,
    Json(req): Json<PositionRequest>,
) -> Result<Json<AccountOverview>, ApiError> {
    let symbol = validate_market_symbol(&req.symbol, false)?;
    let quantity = positive_decimal(&req.quantity, "quantity")?.normalize().to_string();
    let avg_cost = positive_decimal(&req.avg_cost, "avg_cost")?.normalize().to_string();
    state
        .db
        .upsert_position(symbol, quantity, avg_cost, req.notes.trim().to_string())
        .await?;
    let overview = build_manual_account(&state).await?;
    maybe_record_equity_snapshot(&state, &overview, 0).await;
    Ok(Json(overview))
}

async fn delete_position(
    State(state): State<InvestState>,
    Path(symbol): Path<String>,
) -> Result<Json<AccountOverview>, ApiError> {
    state.db.delete_position(symbol.trim().to_uppercase()).await?;
    let overview = build_manual_account(&state).await?;
    maybe_record_equity_snapshot(&state, &overview, 0).await;
    Ok(Json(overview))
}

async fn watchlist(State(state): State<InvestState>) -> Result<Json<Vec<String>>, ApiError> {
    Ok(Json(state.db.watchlist().await?))
}

async fn add_symbol(
    State(state): State<InvestState>,
    Json(request): Json<SymbolRequest>,
) -> Result<Json<Vec<String>>, ApiError> {
    let symbol = validate_market_symbol(&request.symbol, true)?;
    state.db.add_symbol(symbol).await?;
    Ok(Json(state.db.watchlist().await?))
}

async fn remove_symbol(
    State(state): State<InvestState>,
    Path(symbol): Path<String>,
) -> Result<Json<Vec<String>>, ApiError> {
    state.db.remove_symbol(symbol.to_uppercase()).await?;
    Ok(Json(state.db.watchlist().await?))
}

async fn watchlist_snapshots(
    State(state): State<InvestState>,
) -> Result<Json<Vec<WatchlistSnapshot>>, ApiError> {
    let symbols = state.db.watchlist().await?;
    let Some(context) = &state.longbridge else {
        return Ok(Json(Vec::new()));
    };
    if symbols.is_empty() {
        return Ok(Json(Vec::new()));
    }
    let (meta_map, quote_rows) = tokio::join!(
        fetch_static_meta(&state, &symbols),
        tokio::time::timeout(std::time::Duration::from_secs(8), context.quote(symbols.clone())),
    );
    let mut quotes_by_symbol = HashMap::new();
    if let Ok(Ok(rows)) = quote_rows {
        for row in rows {
            quotes_by_symbol.insert(row.symbol.to_uppercase(), row);
        }
    }
    let snapshots = symbols
        .into_iter()
        .map(|symbol| {
            let meta = meta_map.get(&symbol);
            let quote = quotes_by_symbol.get(&symbol);
            WatchlistSnapshot {
                symbol,
                name_en: meta.and_then(|m| m.name_en.clone()),
                name_cn: meta.and_then(|m| m.name_cn.clone()),
                exchange: meta.and_then(|m| m.exchange.clone()),
                last: quote.map(|row| row.last_done.to_string()),
                previous_close: quote.map(|row| row.prev_close.to_string()),
                timestamp: quote.and_then(|row| {
                    chrono::DateTime::<Utc>::from_timestamp(row.timestamp.unix_timestamp(), 0)
                        .map(|v| v.to_rfc3339())
                }),
            }
        })
        .collect();
    Ok(Json(snapshots))
}

async fn quote(
    State(state): State<InvestState>,
    Path(symbol): Path<String>,
) -> Result<Json<Quote>, ApiError> {
    let symbol = symbol.to_uppercase();
    let Some(context) = &state.longbridge else {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "长桥行情未配置".into(),
        ));
    };
    let lookup = [symbol.clone()];
    let (rows_res, meta_map) = tokio::join!(
        tokio::time::timeout(std::time::Duration::from_secs(8), context.quote([symbol.clone()])),
        fetch_static_meta(&state, &lookup),
    );
    let rows = rows_res
        .map_err(|_| ApiError(StatusCode::GATEWAY_TIMEOUT, "长桥实时行情请求超时 (>8s)".into()))?
        .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, format!("Longbridge quote failed: {e}")))?;
    let row = rows
        .first()
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, format!("no quote for {symbol}")))?;
    let meta = meta_map.get(&symbol);
    Ok(Json(Quote {
        symbol: row.symbol.clone(),
        name_en: meta.and_then(|m| m.name_en.clone()),
        name_cn: meta.and_then(|m| m.name_cn.clone()),
        exchange: meta.and_then(|m| m.exchange.clone()),
        last: row.last_done.to_string(),
        previous_close: Some(row.prev_close.to_string()),
        open: Some(row.open.to_string()),
        high: Some(row.high.to_string()),
        low: Some(row.low.to_string()),
        volume: Some(row.volume as u64),
        timestamp: chrono::DateTime::<Utc>::from_timestamp(row.timestamp.unix_timestamp(), 0)
            .map(|v| v.to_rfc3339())
            .unwrap_or_default(),
    }))
}

async fn candles(
    State(state): State<InvestState>,
    Path(symbol): Path<String>,
    Query(query): Query<CandleQuery>,
) -> Result<Json<Vec<Candle>>, ApiError> {
    let count = query.count.unwrap_or(90).clamp(1, 500);
    let (period, sessions) = parse_candle_period(query.period.as_deref())?;
    let symbol = symbol.to_uppercase();
    let Some(context) = &state.longbridge else {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "长桥行情未配置".into(),
        ));
    };
    let rows = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        context.candlesticks(
            symbol,
            period,
            count,
            longbridge::quote::AdjustType::NoAdjust,
            sessions,
        ),
    )
    .await
    .map_err(|_| ApiError(StatusCode::GATEWAY_TIMEOUT, "长桥 K 线请求超时 (>10s)".into()))?
    .map_err(|e| ApiError(StatusCode::BAD_GATEWAY, format!("Longbridge candles failed: {e}")))?;
    Ok(Json(
        rows.into_iter()
            .map(|row| Candle {
                timestamp: chrono::DateTime::<Utc>::from_timestamp(row.timestamp.unix_timestamp(), 0)
                    .map(|v| v.to_rfc3339())
                    .unwrap_or_default(),
                open: row.open.to_string(),
                high: row.high.to_string(),
                low: row.low.to_string(),
                close: row.close.to_string(),
                volume: Some(row.volume as u64),
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
struct AgentLoginRequest {
    auth_code: String,
}

async fn agent_status(State(state): State<InvestState>) -> Json<AgentStatus> {
    Json(state.lb_cli.auth_status().await)
}

async fn agent_login(
    State(state): State<InvestState>,
    Json(req): Json<AgentLoginRequest>,
) -> Result<Json<AgentStatus>, ApiError> {
    Ok(Json(state.lb_cli.login_with_code(&req.auth_code).await?))
}

async fn agent_list(State(state): State<InvestState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.lb_cli.list_agents().await?))
}

async fn agent_chat(
    State(state): State<InvestState>,
    Json(req): Json<AgentChatRequest>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.lb_cli.chat(req).await?))
}

async fn agent_intel(
    State(state): State<InvestState>,
    Path(symbol): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.lb_cli.symbol_intel(&symbol).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_symbols_and_positive_decimals() {
        assert_eq!(validate_market_symbol(" aapl.us ", false).unwrap(), "AAPL.US");
        assert_eq!(validate_market_symbol(".vix.us", true).unwrap(), ".VIX.US");
        assert!(validate_market_symbol(".VIX.US", false).is_err());
        assert!(validate_market_symbol("AAPL", true).is_err());
        assert_eq!(positive_decimal("2.4358", "qty").unwrap().to_string(), "2.4358");
        assert!(positive_decimal("0", "qty").is_err());
    }

    #[test]
    fn parses_candle_periods() {
        for p in ["1m", "5m", "15m", "30m", "60m", "day", "week", "month"] {
            assert!(parse_candle_period(Some(p)).is_ok());
        }
        assert!(parse_candle_period(Some("2m")).is_err());
    }
}

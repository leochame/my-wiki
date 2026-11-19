mod db;

use std::{convert::Infallible, env, net::SocketAddr, path::PathBuf, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use db::{Database, Submission};
use reqwest::Client;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::str::FromStr;
use tower_http::{cors::CorsLayer, services::ServeDir, trace::TraceLayer};
use tracing::info;

#[derive(Clone)]
struct AppState {
    settings: Arc<Settings>,
    http: Client,
    longbridge: Option<Arc<longbridge::QuoteContext>>,
    db: Database,
}

#[derive(Clone)]
struct Settings {
    mode: String,
    port: u16,
    static_dir: PathBuf,
    schwab_base_url: String,
    schwab_access_token: Option<String>,
    schwab_account_hash: Option<String>,
    live_confirmation: Option<String>,
}

impl Settings {
    fn from_env() -> Self {
        let default_static_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../web/dist");
        Self {
            mode: env::var("TRADING_MODE").unwrap_or_else(|_| "paper".into()),
            port: env::var("PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(8787),
            static_dir: env::var("STATIC_DIR")
                .map(PathBuf::from)
                .unwrap_or(default_static_dir),
            schwab_base_url: env::var("SCHWAB_API_BASE_URL")
                .unwrap_or_else(|_| "https://api.schwabapi.com".into()),
            schwab_access_token: env::var("SCHWAB_ACCESS_TOKEN").ok(),
            schwab_account_hash: env::var("SCHWAB_ACCOUNT_HASH").ok(),
            live_confirmation: env::var("LIVE_ORDER_CONFIRMATION").ok(),
        }
    }

    fn is_live(&self) -> bool {
        self.mode.eq_ignore_ascii_case("live")
    }
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    environment: String,
    trading_mode: String,
    market_data_provider: &'static str,
    execution_provider: &'static str,
    account_data_connected: bool,
    runtime: &'static str,
    storage: &'static str,
}

#[derive(Serialize, Clone)]
struct Quote {
    symbol: String,
    last: String,
    previous_close: Option<String>,
    open: Option<String>,
    high: Option<String>,
    low: Option<String>,
    volume: Option<u64>,
    timestamp: String,
    source: &'static str,
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
struct CountQuery {
    count: Option<usize>,
}

#[derive(Deserialize, Serialize, Clone)]
struct OrderRequest {
    symbol: String,
    side: String,
    quantity: String,
    #[serde(rename = "order_type")]
    order_type: String,
    limit_price: Option<String>,
    #[serde(skip_serializing)]
    confirmation: Option<String>,
    preview_id: Option<String>,
}

#[derive(Serialize)]
struct Preview {
    preview_id: String,
    expires_in_seconds: u64,
    symbol: String,
    side: String,
    quantity: String,
    order_type: String,
    limit_price: Option<String>,
    mode: String,
    executable: bool,
    warnings: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct OrderResult {
    order_id: String,
    status: String,
    mode: String,
    provider: String,
    message: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct OrderEntry {
    #[serde(flatten)]
    result: OrderResult,
    symbol: String,
    side: String,
    quantity: String,
    order_type: String,
    limit_price: Option<String>,
    created_at: String,
}

async fn list_orders(State(state): State<AppState>) -> Result<Json<Vec<OrderEntry>>, ApiError> {
    Ok(Json(state.db.orders().await?))
}

#[derive(Deserialize)]
struct SymbolRequest {
    symbol: String,
}

async fn watchlist(State(state): State<AppState>) -> Result<Json<Vec<String>>, ApiError> {
    Ok(Json(state.db.watchlist().await?))
}

async fn add_symbol(
    State(state): State<AppState>,
    Json(request): Json<SymbolRequest>,
) -> Result<Json<Vec<String>>, ApiError> {
    let symbol = request.symbol.trim().to_uppercase();
    let valid = symbol
        .strip_suffix(".US")
        .or_else(|| symbol.strip_suffix(".HK"))
        .is_some_and(|ticker| {
            !ticker.is_empty()
                && ticker
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        });
    if !valid || symbol.len() > 30 {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "请输入带 .US 或 .HK 后缀的证券代码".into(),
        ));
    }
    state.db.add_symbol(symbol).await?;
    Ok(Json(state.db.watchlist().await?))
}

async fn remove_symbol(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
) -> Result<Json<Vec<String>>, ApiError> {
    state.db.remove_symbol(symbol.to_uppercase()).await?;
    Ok(Json(state.db.watchlist().await?))
}

#[derive(Serialize)]
struct ErrorBody {
    detail: String,
}

#[derive(Debug)]
struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(ErrorBody { detail: self.1 })).into_response()
    }
}

async fn health(State(state): State<AppState>) -> Json<Health> {
    Json(Health {
        status: "ok",
        environment: "development".into(),
        trading_mode: if state.settings.is_live() {
            "live"
        } else {
            "paper"
        }
        .into(),
        market_data_provider: if state.longbridge.is_some() {
            "longbridge"
        } else {
            "unconfigured"
        },
        execution_provider: if state.settings.is_live() {
            "schwab"
        } else {
            "paper"
        },
        account_data_connected: false,
        runtime: "rust-axum",
        storage: "sqlite",
    })
}

async fn quote(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
) -> Result<Json<Quote>, ApiError> {
    let symbol = symbol.to_uppercase();
    if let Some(context) = &state.longbridge {
        let rows = context.quote([symbol.clone()]).await.map_err(|error| {
            ApiError(
                StatusCode::BAD_GATEWAY,
                format!("Longbridge quote failed: {error}"),
            )
        })?;
        let row = rows
            .first()
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, format!("no quote for {symbol}")))?;
        return Ok(Json(Quote {
            symbol: row.symbol.clone(),
            last: row.last_done.to_string(),
            previous_close: Some(row.prev_close.to_string()),
            open: Some(row.open.to_string()),
            high: Some(row.high.to_string()),
            low: Some(row.low.to_string()),
            volume: Some(row.volume as u64),
            timestamp: chrono::DateTime::<Utc>::from_timestamp(row.timestamp.unix_timestamp(), 0)
                .map(|value| value.to_rfc3339())
                .unwrap_or_default(),
            source: "longbridge",
        }));
    }
    Err(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "长桥行情未配置，无法获取真实报价".into(),
    ))
}

async fn candles(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
    Query(query): Query<CountQuery>,
) -> Result<Json<Vec<Candle>>, ApiError> {
    let count = query.count.unwrap_or(60).clamp(1, 1000);
    let symbol = symbol.to_uppercase();
    if let Some(context) = &state.longbridge {
        use longbridge::quote::{AdjustType, Period, TradeSessions};
        let rows = context
            .candlesticks(
                symbol.clone(),
                Period::Day,
                count,
                AdjustType::NoAdjust,
                TradeSessions::Intraday,
            )
            .await
            .map_err(|error| {
                ApiError(
                    StatusCode::BAD_GATEWAY,
                    format!("Longbridge candlesticks failed: {error}"),
                )
            })?;
        let candles = rows
            .into_iter()
            .map(|row| Candle {
                timestamp: chrono::DateTime::<Utc>::from_timestamp(
                    row.timestamp.unix_timestamp(),
                    0,
                )
                .map(|value| value.to_rfc3339())
                .unwrap_or_default(),
                open: row.open.to_string(),
                high: row.high.to_string(),
                low: row.low.to_string(),
                close: row.close.to_string(),
                volume: Some(row.volume as u64),
            })
            .collect();
        return Ok(Json(candles));
    }
    Err(ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "长桥行情未配置，无法获取真实 K 线".into(),
    ))
}

async fn preview_order(
    State(state): State<AppState>,
    Json(order): Json<OrderRequest>,
) -> Result<Json<Preview>, ApiError> {
    let order = validate_order(order)?;
    let mut warnings = Vec::new();
    if order.order_type.eq_ignore_ascii_case("market") {
        warnings.push("市价单会按市场可得价格成交，建议实盘前先使用限价单".into());
    }
    if state.settings.is_live() {
        warnings.push("当前为实盘模式，提交后可能真实成交".into());
    }
    let preview_id = state
        .db
        .save_preview(
            &order,
            if state.settings.is_live() {
                "live"
            } else {
                "paper"
            }
            .into(),
        )
        .await?;
    Ok(Json(Preview {
        preview_id,
        expires_in_seconds: 600,
        symbol: order.symbol.to_uppercase(),
        side: order.side,
        quantity: order.quantity,
        order_type: order.order_type,
        limit_price: order.limit_price,
        mode: if state.settings.is_live() {
            "live"
        } else {
            "paper"
        }
        .into(),
        executable: true,
        warnings,
    }))
}

async fn submit_order(
    State(state): State<AppState>,
    Json(order): Json<OrderRequest>,
) -> Result<Json<OrderResult>, ApiError> {
    let order = validate_order(order)?;
    let live = state.settings.is_live();
    let payload = if live {
        let expected = state
            .settings
            .live_confirmation
            .as_deref()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ApiError(StatusCode::SERVICE_UNAVAILABLE, "实盘确认码尚未配置".into())
            })?;
        if order.confirmation.as_deref() != Some(expected) {
            return Err(ApiError(StatusCode::CONFLICT, "实盘确认码不匹配".into()));
        }
        if state
            .settings
            .schwab_access_token
            .as_deref()
            .filter(|value| !value.is_empty())
            .is_none()
            || state
                .settings
                .schwab_account_hash
                .as_deref()
                .filter(|value| !value.is_empty())
                .is_none()
        {
            return Err(ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "嘉信账户凭证尚未配置".into(),
            ));
        }
        Some(schwab_payload(&order)?)
    } else {
        None
    };
    let mut entry = match state
        .db
        .prepare_submission(&order, if live { "live" } else { "paper" }.into())
        .await?
    {
        Submission::Existing(entry) => {
            if matches!(entry.result.status.as_str(), "accepted" | "submitted") {
                return Ok(Json(entry.result));
            }
            return Err(ApiError(
                StatusCode::CONFLICT,
                format!(
                    "该委托已有记录（{}），请核查券商状态，不会重复发送",
                    entry.result.status
                ),
            ));
        }
        Submission::New(entry) => entry,
    };
    if !live {
        return Ok(Json(entry.result));
    }
    let preview_id = order.preview_id.clone().expect("validated preview");
    let endpoint = format!(
        "{}/trader/v1/accounts/{}/orders",
        state.settings.schwab_base_url.trim_end_matches('/'),
        state
            .settings
            .schwab_account_hash
            .as_deref()
            .unwrap_or_default()
    );
    let response = state
        .http
        .post(endpoint)
        .bearer_auth(
            state
                .settings
                .schwab_access_token
                .as_deref()
                .unwrap_or_default(),
        )
        .json(&payload)
        .send()
        .await;
    let response = match response {
        Ok(response) => response,
        Err(_) => {
            entry.result.status = "unknown".into();
            entry.result.message = "嘉信委托结果未知，请核查券商订单，系统不会自动重发".into();
            state.db.finish_submission(preview_id, entry).await?;
            return Err(ApiError(
                StatusCode::BAD_GATEWAY,
                "嘉信委托结果未知，请在券商端核查后处理".into(),
            ));
        }
    };
    if !response.status().is_success() {
        let rejected = response.status().is_client_error();
        entry.result.status = if rejected { "rejected" } else { "unknown" }.into();
        entry.result.message = format!("嘉信响应 {}，请核查券商状态", response.status());
        let detail = entry.result.message.clone();
        state.db.finish_submission(preview_id, entry).await?;
        return Err(ApiError(StatusCode::BAD_GATEWAY, detail));
    }
    entry.result.order_id = response
        .headers()
        .get("location")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim_end_matches('/').rsplit('/').next())
        .unwrap_or("submitted")
        .to_string();
    entry.result.status = "submitted".into();
    entry.result.message = "订单已提交到嘉信，尚未确认成交".into();
    state
        .db
        .finish_submission(preview_id, entry.clone())
        .await?;
    Ok(Json(entry.result))
}

fn positive_decimal(value: &str, field: &str) -> Result<Decimal, ApiError> {
    let value = Decimal::from_str(value).map_err(|_| {
        ApiError(
            StatusCode::BAD_REQUEST,
            format!("{field} must be a finite positive decimal"),
        )
    })?;
    if value <= Decimal::ZERO {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            format!("{field} must be positive"),
        ));
    }
    Ok(value)
}

fn validate_order(mut order: OrderRequest) -> Result<OrderRequest, ApiError> {
    order.symbol = order.symbol.trim().to_uppercase();
    if order.symbol.is_empty()
        || order.symbol.len() > 30
        || !order
            .symbol
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "invalid security symbol".into(),
        ));
    }
    if !matches!(order.side.as_str(), "buy" | "sell") {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "side must be buy or sell".into(),
        ));
    }
    if !matches!(order.order_type.as_str(), "market" | "limit") {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "order_type must be market or limit".into(),
        ));
    }
    order.quantity = positive_decimal(&order.quantity, "quantity")?
        .normalize()
        .to_string();
    if order.order_type == "limit" {
        let price = order.limit_price.as_deref().ok_or_else(|| {
            ApiError(
                StatusCode::BAD_REQUEST,
                "limit orders require limit_price".into(),
            )
        })?;
        order.limit_price = Some(
            positive_decimal(price, "limit_price")?
                .normalize()
                .to_string(),
        );
    } else {
        order.limit_price = None;
    }
    Ok(order)
}

fn schwab_payload(order: &OrderRequest) -> Result<Value, ApiError> {
    if order.symbol.ends_with(".HK") {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Schwab execution supports US equities in this application".into(),
        ));
    }
    let symbol = order.symbol.strip_suffix(".US").unwrap_or(&order.symbol);
    let quantity = positive_decimal(&order.quantity, "quantity")?
        .normalize()
        .to_string()
        .parse::<serde_json::Number>()
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "invalid quantity".into()))?;
    let mut payload = json!({
        "orderType": if order.order_type == "market" { "MARKET" } else { "LIMIT" },
        "session": "NORMAL", "duration": "DAY", "orderStrategyType": "SINGLE",
        "orderLegCollection": [{
            "instruction": if order.side == "buy" { "BUY" } else { "SELL" },
            "quantity": quantity,
            "instrument": { "symbol": symbol, "assetType": "EQUITY" }
        }]
    });
    if order.order_type == "limit" {
        payload["price"] = Value::String(order.limit_price.clone().unwrap_or_default());
    }
    Ok(payload)
}

#[tokio::main]
async fn main() -> Result<(), Infallible> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let settings = Settings::from_env();
    let port = settings.port;
    let static_dir = settings.static_dir.clone();
    let longbridge = match longbridge::Config::from_apikey_env() {
        Ok(config) => {
            let (context, _receiver) = longbridge::QuoteContext::new(Arc::new(config));
            Some(Arc::new(context))
        }
        Err(error) => {
            info!("Longbridge not configured; quote requests will return 503: {error}");
            None
        }
    };
    let db = Database::open(db::default_path())
        .await
        .expect("initialize SQLite database");
    let state = AppState {
        settings: Arc::new(settings),
        http: Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("HTTP client"),
        longbridge,
        db,
    };
    let api = Router::new()
        .route("/health", get(health))
        .route("/watchlist", get(watchlist).post(add_symbol))
        .route("/watchlist/{symbol}", axum::routing::delete(remove_symbol))
        .route("/quotes/{symbol}", get(quote))
        .route("/candles/{symbol}", get(candles))
        .route("/orders/preview", post(preview_order))
        .route("/orders", get(list_orders).post(submit_order));
    let app = Router::new()
        .nest("/api", api)
        .fallback_service(ServeDir::new(static_dir).append_index_html_on_directories(true))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    info!("northstar server listening on http://{}", address);
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .expect("bind server port");
    axum::serve(listener, app).await.expect("serve HTTP");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn order() -> OrderRequest {
        OrderRequest {
            symbol: " aapl.us ".into(),
            side: "buy".into(),
            quantity: "2".into(),
            order_type: "limit".into(),
            limit_price: Some("100.25".into()),
            confirmation: None,
            preview_id: None,
        }
    }

    #[test]
    fn non_positive_or_non_finite_numbers_are_rejected() {
        for value in ["0", "-1", "NaN", "inf", "Infinity", "", "1e9999"] {
            let mut request = order();
            request.quantity = value.into();
            assert!(
                validate_order(request).is_err(),
                "accepted quantity: {value}"
            );
        }
    }

    #[test]
    fn limit_order_requires_positive_price() {
        for value in [None, Some("0"), Some("-0.01"), Some("NaN")] {
            let mut request = order();
            request.limit_price = value.map(str::to_owned);
            assert!(validate_order(request).is_err());
        }
    }

    #[test]
    fn unexpected_side_or_order_type_is_rejected() {
        let mut request = order();
        request.side = "short".into();
        assert!(validate_order(request).is_err());
        let mut request = order();
        request.order_type = "typo".into();
        assert!(validate_order(request).is_err());
    }

    #[test]
    fn schwab_symbol_is_converted_and_decimal_is_preserved() {
        let mut request = order();
        request.quantity = "2.123456789123456789".into();
        let validated = validate_order(request).ok().expect("valid order");
        let payload = schwab_payload(&validated).ok().expect("valid payload");
        assert_eq!(
            payload["orderLegCollection"][0]["instrument"]["symbol"],
            "AAPL"
        );
        assert_eq!(
            payload["orderLegCollection"][0]["quantity"].to_string(),
            "2.123456789123456789"
        );
        assert_eq!(payload["price"], "100.25");
    }

    #[test]
    fn hk_equities_are_never_routed_to_schwab() {
        let mut request = order();
        request.symbol = "700.HK".into();
        let validated = validate_order(request).ok().expect("valid order");
        assert!(schwab_payload(&validated).is_err());
    }
}

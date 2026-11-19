from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.models import OrderPreview, OrderRequest
from app.services import execution_provider, market_data_provider

app = FastAPI(title="Schwab + Longbridge Trading Platform", version="0.1.0")
settings = get_settings()
market_data = market_data_provider(settings)


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "environment": settings.app_env,
        "trading_mode": "live" if settings.is_live else "paper",
        "market_data_provider": market_data.name,
        "execution_provider": "schwab" if settings.is_live else "paper",
    }


@app.get("/api/quotes/{symbol}")
async def get_quote(symbol: str):
    try:
        return await market_data.quote(symbol.upper())
    except (LookupError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/candles/{symbol}")
async def get_candles(symbol: str, count: int = Query(default=60, ge=1, le=1000)):
    try:
        return await market_data.candles(symbol.upper(), count)
    except (LookupError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/orders/preview", response_model=OrderPreview)
async def preview_order(order: OrderRequest):
    warnings: list[str] = []
    if order.order_type == "market":
        warnings.append("市价单会按市场可得价格成交，建议实盘前先使用限价单")
    if order.quantity != order.quantity.to_integral_value():
        warnings.append("数量包含小数，是否支持取决于标的和券商账户权限")
    if settings.is_live:
        warnings.append("当前为实盘模式，提交后可能真实成交")
    return OrderPreview(
        symbol=order.symbol,
        side=order.side,
        quantity=order.quantity,
        order_type=order.order_type,
        limit_price=order.limit_price,
        mode="live" if settings.is_live else "paper",
        executable=True,
        warnings=warnings,
    )


@app.post("/api/orders")
async def submit_order(order: OrderRequest):
    if settings.is_live:
        if not settings.live_order_confirmation:
            raise HTTPException(status_code=503, detail="live mode is disabled until LIVE_ORDER_CONFIRMATION is configured")
        if order.confirmation != settings.live_order_confirmation:
            raise HTTPException(status_code=409, detail="live order confirmation does not match")
    try:
        return await execution_provider(settings).submit(order)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


project_root = Path(__file__).resolve().parents[1]
modern_static_dir = project_root / "web" / "dist"
static_dir = modern_static_dir if modern_static_dir.exists() else Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(static_dir / "index.html")

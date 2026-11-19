from __future__ import annotations

from app.config import Settings
from app.providers.execution import ExecutionProvider, PaperExecution, SchwabExecution
from app.providers.market_data import UnconfiguredMarketData, LongbridgeMarketData, MarketDataProvider


def market_data_provider(settings: Settings) -> MarketDataProvider:
    if settings.has_longbridge_credentials:
        return LongbridgeMarketData(
            settings.longbridge_app_key or "",
            settings.longbridge_app_secret or "",
            settings.longbridge_access_token or "",
        )
    return UnconfiguredMarketData()


def execution_provider(settings: Settings) -> ExecutionProvider:
    if settings.is_live:
        if not settings.has_schwab_credentials:
            raise RuntimeError("live mode requires SCHWAB_ACCESS_TOKEN and SCHWAB_ACCOUNT_HASH")
        return SchwabExecution(
            settings.schwab_api_base_url,
            settings.schwab_access_token or "",
            settings.schwab_account_hash or "",
        )
    return PaperExecution()

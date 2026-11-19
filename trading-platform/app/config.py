from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    trading_mode: str = "paper"

    longbridge_app_key: str | None = None
    longbridge_app_secret: str | None = None
    longbridge_access_token: str | None = None

    schwab_api_base_url: str = "https://api.schwabapi.com"
    schwab_access_token: str | None = None
    schwab_account_hash: str | None = None

    live_order_confirmation: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def is_live(self) -> bool:
        return self.trading_mode.lower() == "live"

    @property
    def has_longbridge_credentials(self) -> bool:
        return all(
            (
                self.longbridge_app_key,
                self.longbridge_app_secret,
                self.longbridge_access_token,
            )
        )

    @property
    def has_schwab_credentials(self) -> bool:
        return all((self.schwab_access_token, self.schwab_account_hash))


@lru_cache
def get_settings() -> Settings:
    return Settings()

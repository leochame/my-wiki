import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import ValidationError

from .models import BridgeConfig


def default_data_dir() -> Path:
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "meituan-wechat-bridge"
    return Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local" / "state"))) / (
        "meituan-wechat-bridge"
    )


@dataclass(frozen=True)
class Settings:
    config: BridgeConfig = field(default_factory=BridgeConfig)
    data_dir: Path = field(default_factory=default_data_dir)
    api_token: str = field(default="", repr=False)
    meituan_secret: str = field(default="", repr=False)
    demo: bool = False

    @classmethod
    def load(cls, config_file: str | None = None) -> "Settings":
        filename = config_file or os.environ.get("BRIDGE_CONFIG")
        config = BridgeConfig()
        if filename:
            try:
                config = BridgeConfig.model_validate_json(
                    Path(filename).expanduser().read_text(encoding="utf-8")
                )
            except ValidationError as exc:
                fields = [".".join(map(str, error["loc"])) for error in exc.errors()]
                raise ValueError("invalid configuration fields: " + ", ".join(fields)) from None
        if config.callback_base_url:
            url = urlsplit(config.callback_base_url)
            if (
                url.scheme != "https"
                or not url.netloc
                or url.username
                or url.password
                or url.query
                or url.fragment
            ):
                raise ValueError("callback_base_url must be an HTTPS URL without credentials/query")
        data_dir = Path(os.environ.get("BRIDGE_DATA_DIR", str(default_data_dir()))).expanduser()
        return cls(
            config=config,
            data_dir=data_dir,
            api_token=os.environ.get("BRIDGE_API_TOKEN", ""),
            meituan_secret=os.environ.get("MEITUAN_CONSUMER_SECRET", ""),
        )

    def public_status(self) -> dict:
        return {
            "version": "0.1.0",
            "configured_stores": sorted(self.config.routes),
            "api_configured": bool(self.api_token),
            "brand_callback_configured": bool(
                self.config.meituan_app_id and self.config.callback_base_url and self.meituan_secret
            ),
            "auto_trigger": "incoming webhook -> durable queue -> running desktop worker",
            "mcp_events": False,
            "demo": self.demo,
        }


def load_json(path: str) -> dict:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("expected a JSON object")
    return value

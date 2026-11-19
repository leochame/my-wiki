import argparse
import json
import os
import sys
import time
import uuid
from dataclasses import replace

import httpx

from .client import BridgeClient, BridgeError
from .config import Settings, load_json
from .models import BridgeConfig, OrderEvent, Route, format_message


def print_json(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="美团订单通知桥（首版支持模拟发送）")
    result.add_argument("--version", action="version", version="0.1.0")
    subcommands = result.add_subparsers(dest="command", required=True)
    for name, help_text in (("serve", "启动接入与管理服务"), ("demo", "启动本地演示和模拟发送端")):
        sub = subcommands.add_parser(name, help=help_text)
        sub.add_argument("--host", default="127.0.0.1")
        sub.add_argument("--port", type=int, default=8787)
        sub.add_argument("--config")
        if name == "demo":
            sub.add_argument("--no-worker", action="store_true")
    for name in ("status", "submit", "worker", "mcp"):
        sub = subcommands.add_parser(name)
        sub.add_argument("--url", default=os.environ.get("BRIDGE_URL", "http://127.0.0.1:8787"))
        if name == "submit":
            sub.add_argument("file")
        if name == "worker":
            sub.add_argument("--sender", choices=["mock"], default="mock")
            sub.add_argument("--once", action="store_true")
            sub.add_argument("--interval", type=float, default=2)
            sub.add_argument("--worker-id", default=f"mock-{uuid.uuid4().hex[:8]}")
    preview = subcommands.add_parser("preview", help="本地预览通知，不入队")
    preview.add_argument("file")
    doctor = subcommands.add_parser("doctor", help="检查配置，不输出密钥")
    doctor.add_argument("--config")
    return result


def main():
    args = parser().parse_args()
    try:
        if args.command == "preview":
            print(format_message(OrderEvent.model_validate(load_json(args.file))))
            return
        if args.command in {"serve", "demo", "doctor"}:
            settings = Settings.load(args.config)
            if args.command == "doctor":
                print_json(
                    {
                        **settings.public_status(),
                        "data_dir": str(settings.data_dir),
                        "real_wechat_sender": "not implemented in v0.1",
                        "supported_callback_protocol": (
                            "brand app_id/sig; ISV developerId/sign pending"
                        ),
                    }
                )
                return
            if args.command == "demo":
                if args.host not in {"127.0.0.1", "localhost", "::1"}:
                    raise ValueError("unauthenticated demo mode must bind to loopback only")
                settings = replace(
                    settings,
                    demo=True,
                    meituan_secret="",
                    api_token="",
                    data_dir=settings.data_dir / "demo",
                    config=BridgeConfig(routes={"demo-store": Route(group_name="订单通知测试群")}),
                )
            elif not settings.api_token:
                raise ValueError("set BRIDGE_API_TOKEN in the process environment before serve")
            import uvicorn

            from .app import create_app

            app = create_app(settings, demo_worker=not getattr(args, "no_worker", False))
            print(f"管理页面：http://{args.host}:{args.port}", file=sys.stderr)
            uvicorn.run(app, host=args.host, port=args.port, access_log=False)
            return
        client = BridgeClient(args.url, os.environ.get("BRIDGE_API_TOKEN", ""))
        try:
            if args.command == "status":
                print_json(client.request("GET", "/api/status"))
            elif args.command == "submit":
                print_json(client.request("POST", "/api/orders", load_json(args.file)))
            elif args.command == "worker":
                from .worker import run_once

                if args.interval < 0.1:
                    raise ValueError("interval must be at least 0.1 seconds")
                while True:
                    try:
                        job = run_once(client, args.worker_id)
                        if job:
                            print_json({"job_id": job["id"], "state": job["state"]})
                    except (BridgeError, httpx.HTTPError) as exc:
                        if args.once:
                            raise
                        print(f"worker request failed: {type(exc).__name__}", file=sys.stderr)
                    if args.once:
                        break
                    time.sleep(args.interval)
            elif args.command == "mcp":
                try:
                    from .mcp_server import create_server

                    server = create_server(client)
                except ImportError as exc:
                    raise ValueError("install the MCP extra: uv sync --extra mcp") from exc
                server.run(transport="stdio")
        finally:
            client.close()
    except KeyboardInterrupt:
        pass
    except (ValueError, OSError, BridgeError, httpx.HTTPError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()

"""Run the HTTP service, simulate a delivery, and exercise a real stdio MCP client.

All data is fictional and lives in an automatically cleaned temporary directory.
Run with: uv run --extra mcp python scripts/smoke.py
"""

import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx


async def check_mcp(url: str, env: dict) -> int:
    from mcp import Client, StdioServerParameters

    transport = StdioServerParameters(
        command=sys.executable,
        args=["-m", "order_bridge", "mcp", "--url", url],
        env=env,
    )
    async with Client(transport) as client:
        tools = await client.list_tools()
        result = await client.call_tool("bridge_status", {})
        assert not result.is_error, result
        status = json.loads(result.content[0].text)
        assert status["demo"] is True
        assert status["counts"]["simulated"] == 1
        assert status["counts"]["sent"] == 0
        return len(tools.tools)


def main():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    env = dict(os.environ)
    for name in ("BRIDGE_CONFIG", "BRIDGE_API_TOKEN", "MEITUAN_CONSUMER_SECRET"):
        env.pop(name, None)
    with tempfile.TemporaryDirectory(prefix="order-bridge-smoke-") as directory:
        env["BRIDGE_DATA_DIR"] = directory
        with (Path(directory) / "server.log").open("w+") as log:
            process = subprocess.Popen(
                [sys.executable, "-m", "order_bridge", "demo", "--port", str(port)],
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            try:
                with httpx.Client(base_url=url, timeout=3, trust_env=False) as client:
                    for _ in range(100):
                        try:
                            if client.get("/healthz").status_code == 200:
                                break
                        except httpx.HTTPError:
                            pass
                        if process.poll() is not None:
                            raise RuntimeError("smoke server failed to start")
                        time.sleep(0.1)
                    else:
                        raise RuntimeError("smoke server startup timed out")
                    assert client.get("/").status_code == 200
                    assert client.get("/openapi.json").status_code == 200
                    response = client.post("/api/demo/orders")
                    response.raise_for_status()
                    job = response.json()["job"]
                    replay = client.post("/api/orders", json=job["payload"])
                    replay.raise_for_status()
                    assert replay.json()["created"] is False
                    for _ in range(100):
                        result = client.get(f"/api/jobs/{job['id']}").json()
                        if result["state"] == "simulated":
                            break
                        time.sleep(0.1)
                    else:
                        raise RuntimeError("mock worker did not complete the notification")
                    assert [event["state"] for event in result["history"]] == [
                        "pending",
                        "leased",
                        "sending",
                        "simulated",
                    ]
                tools = asyncio.run(check_mcp(url, env))
                print(
                    json.dumps(
                        {
                            "http": "passed",
                            "duplicate_callback": "deduplicated",
                            "delivery": "simulated",
                            "real_messages_sent": 0,
                            "mcp_stdio_tools": tools,
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                )
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    main()

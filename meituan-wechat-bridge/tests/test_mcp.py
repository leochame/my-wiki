import asyncio
import json

from order_bridge.client import BridgeClient
from order_bridge.mcp_server import create_server


def test_mcp_discovery_and_actual_tool_calls(client, order):
    mcp = __import__("mcp", fromlist=["Client"])
    bridge = BridgeClient("http://127.0.0.1:8787")
    bridge.http.close()
    bridge.http = client
    server = create_server(bridge)

    async def exercise():
        async with mcp.Client(server) as session:
            tools = await session.list_tools()
            names = {tool.name for tool in tools.tools}
            assert {"bridge_status", "notification_preview", "notifications_list"} <= names
            status = await session.call_tool("bridge_status", {})
            assert not status.is_error
            preview = await session.call_tool(
                "notification_preview", {"order": order.model_dump(mode="json")}
            )
            assert not preview.is_error
            content = json.loads(preview.content[0].text)
            assert content["queued"] is False
            assert "鸡腿饭" in content["message"]
            await session.call_tool("route_set", {"store_id": "new-store", "group_name": "新群"})

    asyncio.run(exercise())
    assert client.get("/api/routes").json()["new-store"]["group_name"] == "新群"
    assert client.get("/api/status").json()["total"] == 0

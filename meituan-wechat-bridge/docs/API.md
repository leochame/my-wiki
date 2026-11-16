# HTTP API

除 `/healthz`、静态页面和美团平台回调外，正式服务要求 `Authorization: Bearer <BRIDGE_API_TOKEN>`。演示服务仅允许在回环地址运行，无需令牌。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/healthz` | 最小健康检查，不返回订单数据 |
| GET | `/api/status` | 配置就绪状态、队列计数和 worker 心跳 |
| GET / PUT | `/api/routes` / `/api/routes/{store_id}` | 列出路由、设置某门店的目标群 |
| POST | `/api/orders` | 接收已授权 ERP 的规范化订单 |
| POST | `/api/preview` | 仅渲染通知；不创建任务 |
| GET | `/api/jobs?state=pending&limit=50` | 按状态查询任务，最多 100 条 |
| GET | `/api/jobs/{id}` | 查询一条任务 |
| POST | `/api/jobs/{id}/retry` | 对失败任务重新入队 |
| POST | `/api/jobs/{id}/resolve` | 核对并解决不确定任务 |
| POST | `/api/worker/claim` | 原子领取一个任务 |
| POST | `/api/worker/{id}/begin` | 标记开始发送 |
| POST | `/api/worker/{id}/result` | 回报发送结果 |
| GET / POST | `/webhooks/meituan/confirmed` | 品牌商已确认回调 |
| GET / POST | `/webhooks/meituan/cancelled` | 品牌商取消回调 |
| POST | `/api/demo/orders` | 仅演示环境：添加随机模拟订单 |
| POST | `/api/demo/jobs/{id}/cancel` | 仅演示环境：模拟取消 |

## 统一订单入口

请求体示例见 `examples/order.confirmed.json`。`store_id`、`order_id` 必须是字符串，状态为 `confirmed` 或 `cancelled`。已确认订单必须至少有一项菜品；取消事件允许没有菜品。菜品数量为正数；金额为整数分。

成功响应：

```json
{
  "created": true,
  "job": {
    "id": 1,
    "store_id": "demo-store",
    "order_id": "demo-order-10001",
    "event": "confirmed",
    "state": "pending",
    "target": {"group_name": "订单通知测试群"},
    "attempts": 0,
    "message": "【美团｜新订单（已接单）】\n…"
  }
}
```

实际响应还包含规范化的 `payload`、Unix 时间戳、worker 及租约到期信息。单条任务查询额外返回 `history`，保留各次状态变化和处理备注。管理查询不返回任务领取密钥。相同事件再次进入时 `created` 为 `false`，返回已有任务，HTTP 状态仍为 200。

## 路由

```http
PUT /api/routes/store-001
Content-Type: application/json

{"group_name":"门店一备餐群"}
```

保存后立即用于新的订单；已有订单的取消通知沿用该订单最初的目标群。未知门店的订单返回 422，不能静默发到默认群。

## 重试与核对

普通失败重试：

```json
{"confirmed_unsent":false}
```

不确定结果需在核对目标端未收到之后提交 `{"confirmed_unsent":true}`。已经完成、模拟完成、已停止或仍在处理的任务不能重试。已经取消的订单不能重试其接单通知。

`POST /api/jobs/{id}/resolve` 支持 `{"outcome":"sent"}` 或 `{"outcome":"suppressed"}`；仅用于解决待核对状态。

## 错误

| HTTP 状态 | 含义 |
| --- | --- |
| 401 | 管理令牌或平台签名无效 |
| 404 | 未找到任务或不支持的回调类型 |
| 409 | 状态冲突、租约失效或不能安全重试 |
| 413 | 订单入口或回调超过 256 KiB |
| 415 | 平台回调内容类型错误 |
| 422 | 订单字段、路由或状态值不合法 |
| 503 | 接入尚未配置，或演示环境拒绝真实回调 |

平台回调只在数据已持久化后返回 `{"data":"ok"}`。其他管理 API 的成功响应结构不同，不能把它们当作美团回调地址。

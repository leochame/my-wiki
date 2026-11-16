# 发送端协议

同一套协议用于现有模拟 worker 和将来的 Mac 微信 worker。所有接口使用管理 Bearer 令牌，真实外网连接必须使用 HTTPS。

## 1. 领取

```http
POST /api/worker/claim
Content-Type: application/json

{"worker_id":"mac-store-01","mode":"wechat-macos"}
```

模拟端使用 `mode: "mock"`。没有任务时返回 `{"job":null}`。成功返回 `job`，包括：

- `id`：任务编号。
- `target.group_name`：创建任务时保存的群名称。
- `message`：固定格式的完整通知。
- `lease_token`：该任务的领取密钥，仅此次领取响应可见，不写日志。
- `lease_until`：租约到期的 Unix 时间戳；默认 180 秒。

每个 worker 同时只能持有一个未完成任务。领取接口也用于更新 worker 心跳，空闲时建议每两秒轮询一次。将来真正控制微信的进程还应持有本机单实例锁，保证同一个微信客户端只被串行操作。

## 2. 开始发送

```http
POST /api/worker/42/begin
Content-Type: application/json

{"lease_token":"<领取响应中的值>"}
```

只有请求成功后才能进行提交发送的操作。返回 409 时不要发送，可能是取消事件已撤销任务或租约到期。

Mac 端在提交前必须核对目标群、处理同名会话，并确认界面和输入框状态。超出剩余租约时间就停止，不继续发送。

## 3. 返回结果

```http
POST /api/worker/42/result
Content-Type: application/json

{"lease_token":"<领取响应中的值>","outcome":"simulated","note":"模拟处理完成"}
```

| outcome | 使用条件 | 后续处理 |
| --- | --- | --- |
| `simulated` | 只模拟，未操作微信 | 结束，页面明确显示模拟完成 |
| `sent` | 真正发送端确认提交成功 | 结束；不表示群成员已阅读 |
| `retry` | 明确知道消息尚未提交，如打开群前失败 | 指数退避，达到上限转失败 |
| `uncertain` | 可能提交过，但无法确认 | 暂停，等待核对，不能自动重发 |

`mode: mock` 的任务不能报告 `sent`。任务已开始发送后 worker 崩溃或失联，租约到期时服务会将它标为 `uncertain`。开始发送前失联的领取任务可以重新领取。

## 网络中断

开始请求或结果回报超时，不能据此判断服务是否处理成功。查询 `/api/jobs/{id}` 核对状态；不要直接再次提交微信消息。租约已经失效时停止当前任务；不要用新的领取密钥回报旧操作。

真正的 Mac UI 自动化没有平台级幂等发送 ID，无法保证崩溃瞬间不重复提交，所以本协议明确区分“可以重试”和“结果不确定”。

## 参考实现

`src/order_bridge/worker.py` 使用上述接口完成一次模拟任务；`order-bridge worker --sender mock` 持续消费。首版没有 Mac UI 发送实现，不需要微信登录或辅助功能权限。

# Bot 集成

Grok Bot 是用户入口。super-bot 把结果放进 inbox，由 bot 取走后再用人话回复。不要让 super-bot 自己给人发消息。

## 拉模式

这是回报契约，不是已经推到用户聊天里的消息。

| status | 含义 |
| --- | --- |
| `queued` | 已写入 outbox，reply 效果还没完成。崩溃后会再投一次，inbox 里还看不到。 |
| `deliverable` | bot 可以拉取。重复执行 reply 不会再插一条。 |
| `acked` | bot 调用 ack 之后。 |

```bash
sbot inbox
sbot inbox ack --id msg_...
```

或：

```bash
curl -s http://127.0.0.1:47231/v1/inbox
curl -s -X POST http://127.0.0.1:47231/v1/inbox/msg_example/ack
```

若设置了 `SUPERBOT_TOKEN`，请求要带 `Authorization: Bearer <token>`。服务只绑 `127.0.0.1`。

## gbb 回调

在 gbb 的 `[[owners]]` 里给 `grok-bot` 配一个 URL：`http://127.0.0.1:47231/v1/callbacks/gbb`。这是 gbb 已有的 owner 路由，不是另一条控制通道。

回调体沿用 gbb 0.3.3 的字段（`source`、`event`、`task_id`、`status`、`ts`、`owner`、`route`）。没有终端文本。示例见 `examples/gbb-callback.json`。

重复投递（不同 `route`、相同 task/event/status/ts）返回 `duplicate: true`，派工不推进两次。

## 新请求

```bash
curl -s -X POST http://127.0.0.1:47231/v1/requests \
  -H 'content-type: application/json' \
  -d '{"requestId":"r1","text":"补健康检查","scope":"只改示例仓库","acceptance":["tests"],"phases":["design"]}'
```

默认 runtime 若以 real dry-run 启动，响应里的派工是 `planned` 或 `blocked`，不是已在 hc 里跑完。

## 接管

`POST /v1/takeover` 的正文是 `examples/takeover.json` 那种快照。`{"paneId":"term-example"}` 会 400，`code` 为 `takeover-incomplete`。

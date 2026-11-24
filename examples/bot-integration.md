# Bot 集成

Grok Bot 是用户入口。super-bot 不自己给人发消息。结果要么推回 Bot 配置的 URL，要么留在 inbox 等 Bot 来取。

## 推回原来的 Bot

设置 `SUPERBOT_BOT_URL` 后，reply 效果会 `POST` 那条消息。头里有 `x-superbot-message-id`，正文里的 `id` 是同一个稳定 id。这是至少一次，不是 exactly-once：2xx 之后、写回 `delivered` 之前如果进程崩溃，重启会用同一个 id 再 POST。接收端必须按这个 id 去重。非 2xx 和断连都会重试，最多 3 次，然后写成 `failed`。`sbot inbox retry --id` 用同一个 id 再投，不会新建一条。

没有这个 URL 时，行为仍是下面的拉模式。

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

## bac 回调

回调 URL 是 `http://127.0.0.1:47231/v1/callbacks/bac`。`source` 必须是 `bot-as-collie`，`version` 必须是整数 `1`。去重键是 `event_id`。同一逻辑事件的 owner 与 fallback 共用这个 id。回调里不能有终端正文、模型或额度。owner 是受信 CLI 选择器，不是独立认证。bac 二进制还没实现，现网不要先切这个 URL。

## 新请求

```bash
curl -s -X POST http://127.0.0.1:47231/v1/requests \
  -H 'content-type: application/json' \
  -d '{"requestId":"r1","text":"补健康检查","scope":"只改示例仓库","acceptance":["tests"],"phases":["design"]}'
```

默认 runtime 若以 real dry-run 启动，响应里的派工是 `planned` 或 `blocked`，不是已在 hc 里跑完。

## 接管

`POST /v1/takeover` 的正文是 `examples/takeover.json` 那种快照。`{"paneId":"term-example"}` 会 400，`code` 为 `takeover-incomplete`。

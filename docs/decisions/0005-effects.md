# 0005 — 效果、outbox、崩溃与超时

日期：2026-11-21 · 状态：接受

## 事务

Engine 的一次命令在一个 SQLite 事务里改聚合，并插入 effect 行。`Runtime.drain` 在提交之后按 `seq` 执行到期的 `waiting` 行。

| 效果 | 幂等 | 超时或重启 |
| --- | --- | --- |
| `launch`、`send`、`handover`、`stop` | 否 | 先落成 `running` 再调用。没有确认的超时，或重启时仍是 `running`，改成 `unknown`，不再调用。 |
| `status` | 是 | 只读 `gbb status`。未知的派工可以排队一次，用来对账，不作为重发提示。 |
| `reply` | 是 | 把已经落库的 bot 回执留在 inbox。重复执行不新开一条。 |

暂停时，除 `reply` 和 `status` 外的效果把 `due` 推后，不增加失败次数。恢复后重新准入还在排队的 Trigger。

## 不自动重发

`gbb send` 和 `gbb launch` 都可能已经作用在终端上，只是调用方没看到退出码。再发一次会把提示打进对话框或再开一个代理。因此未知不是失败重试。

取消一个已经 `unknown` 的 launch 也不会补一次 `gbb stop`。取消一个 fake/live 已确认 `running` 的新 launch，会发一次 `stop`。接管来的 pane 即使在 send 之后被取消，也不 `stop`，避免 gbb reclaim 清标记。

卡住：运行时间超过阈值只发一条 attention，派工仍是 `running`，不新发提示。

## 验收

回调 `done` 或 `idle` 把派工从 `running` 改为 `claimed`。`producer: agent` 的检查记下来，原因 `agent-self-report`。`producer: harness` 的检查盖住该阶段要求的 id，且回调已经是完成态，才 `accepted`。最后一阶段还要盖住工单上的验收 id。dry-run 的 `planned` 不能验收。

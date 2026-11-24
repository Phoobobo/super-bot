# 0004 — 接管已有 hc 会话

日期：2026-11-21 · 状态：接受

## 不够的输入

只有 pane id，或者一行 `gbb list` / `gbb report`。`stale: true`、或 `labels.gbb_task` 和 `task_id` 不一致时，更不能拿来派工。`trustListRow` 永远返回 `trusted: false`，并带上原因。

## 快照

`superbot.takeover.v1` 至少要有：

- 来源命令和 `observedAt`
- pane、backend、origin、owner
- kind 和 model 两条观察（可以是 unknown，但不能在 unknown 里夹带 value）
- `labelsConsistent`
- 授权：谁、范围、`allowedToContinue: true`、验收项
- `work.done`、`work.open`、`work.unknown` 三个数组
- `acceptancePath`、repo、channel

kind 若是 known，`source` 必须是调用方写下的，例如 `operator-snapshot`。这不是 hc 读出来的字段。model 在 hc 不提供时保持 unknown。

## 续办

- done 里的 key 再出现在 open 里，派工记 `skipped` / `already-complete`，不 send。
- unknown 只展示，不执行。只要还有 unknown，工单不因为其它项验收通过就结束。
- 已知 kind 的未完成项用 `gbb send` 发到原 pane，不新 launch。提示里写明已完成项和未知项。
- 同时排队一次 `gbb handover`，让 gbb 打上原来的标记。fake/dry-run 不碰真实终端。
- handover 超时则尚未发出的 send 取消，状态未知，不重发。

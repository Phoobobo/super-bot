# 0002 — gbb 0.3.3 能力与扩展契约

日期：2026-11-21 · 状态：接受

## 读过的树

`https://github.com/Phoobobo/grokbot-bridge-herdr` @ `bbdfc4bbaece3ddafa3a9363b1d0f43b230aa5a6`（`GBB_VERSION` 0.3.3）。GitHub 上的 `main` 停在 `92e801a`，没有 hc 后端；0.3.3 在 `origin/cursor/hc-app-placement-309f`。

| 事实 | 位置 |
| --- | --- |
| `--kind` 只能是 grok 或 codex | `bin/gbb` `cmd_launch`，约 1501–1502 行 |
| hc 上实际是 `hc run ... -- "$kind" "$@"` | `launch_with_hc`，约 1063–1066 行 |
| 非 codex 要等到状态词 `idle` 或 `done` 才算就绪 | `wait_hc_ready`，约 764–801 行 |
| handover 把 `kind` 写成 null | `do_handover_hc`，约 1206–1212 行 |
| 模型行只在 kind 为 codex 时从屏幕读 | `cmd_status`，约 1696–1701 行 |
| 回调没有终端正文，也没有 `event_id` | `build_event`，约 290–298 行 |
| 回调是后台 curl，失败时回退到主 webhook，没有持久队列 | `notify` / `post_webhook`，约 165–205 行 |
| `stale` 在 hc 模块没开、或终端既不是 live 也不是 finished 时为真 | `report_task_row`，约 2092–2124 行 |
| `gbb stop` 对 handover 来的终端只是注销，并清标记 | `hc_cmd_stop`，ADR 0007 |
| hc 0.1.x 的 get/ls 不带 model 字段 | `docs/decisions/0005-herdr-core-backend.md` |

没有现成的扩展点能注册新 kind。kind 是 `case` 写死的。所以「通过已有钩子让 `gbb launch --kind pi` 成功」不成立。

## 决定

- 内置资料 `gbb-0.3.3` 的 `launchKinds` 只有 grok、codex。执行派工在此资料下受阻。
- 测试和 `sbot demo` 可以使用 `gbb-launch-kind-v1-simulated`。它的 `simulated` 为真，不能当成 0.3.3 已支持 pi。
- 接管一条已经在 hc 里的 pane，走 `gbb handover` 再 `gbb send`，不新 launch。kind 必须来自快照里一条带 source 的 known 观察。模型仍可以是 unknown。
- 取消这类工单时不调用 `gbb stop`，避免清掉 `grokbot=managed`。
- 若上游要支持新开 pi，最小改动写在 `docs/gbb/MINIMAL-PATCH.md`。只放宽 kind 不够。

## 去重

gbb 0.3.3 的回调没有 `event_id`。去重键是 `task_id|event|status|ts`，忽略 `route`。这样 owner 路由和 fallback/extra 的同一次事件不会执行两次。没有 `ts` 的重发会撞车；gbb 的 `build_event` 自带 `ts`。

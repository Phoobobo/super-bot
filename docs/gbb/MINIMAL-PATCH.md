# 建议中的 gbb 最小补丁

**没有应用到任何 gbb 安装或克隆，也没有改 `Phoobobo/grokbot-bridge-herdr`。** 目标修订是 `bbdfc4bbaece3ddafa3a9363b1d0f43b230aa5a6`。下面是可以交给那个仓库的最小契约。

super-bot 在这个补丁落地并在真实 hc 上验证之前，继续把「新开 pi / antigravity」视为做不到。

## 1. 放宽 launch kind

`bin/gbb` 的 `cmd_launch` 里：

```sh
# 现在
case "$kind" in grok | codex) ;; *) die usage "--kind must be grok or codex" ;; esac

# 建议
case "$kind" in grok | codex | pi | antigravity) ;; *) die usage "--kind must be grok, codex, pi, or antigravity" ;; esac
```

同一段 usage 字符串（约 1501 行）要一起改。`launch_with_hc` 已经把 `$kind` 当作 `hc run` 的程序名，所以白名单是第一道门，不是唯一的门。

## 2. 没有 OSC 7501 时不要空等再盲发

`wait_hc_ready` 在 kind 不是 codex 时，只有状态词 `idle` 或 `done` 才算就绪。从不上报的程序会等到 `startup_ready_timeout_sec`（默认 90 秒）然后失败。建议对 `pi` 和 `antigravity`：

- 若 `reported` 不是 true，立即返回 `WAIT_STATE=status_unreported`（返回码 3），不要进入 `hc send`。
- 若已经上报，仍只在 `idle` 或 `done` 时继续，`blocked` / `error` 保持现在的拒绝。
- 不要为了「看起来能用」去刮屏幕、也不要发明 model。

这一步没有在 hc 0.1.21 上对 pi 验证过。补丁合并前，pi 是否发出 OSC 7501 仍是未知。

## 3. handover 允许显式 kind，仍然不填 model

`do_handover_hc` 现在写 `kind: null`。建议增加可选 `--kind`，只接受上面的白名单，并原样写入登记。不从 `hc get` 推断模型。`cmd_status` 对非 codex 继续把模型留空。

## 4. 回调仍保持现在的安全形状

建议只加可选 `event_id`（同一次投递的稳定 id）。不要把终端文本放进 webhook。持久重试队列不是这条最小补丁的一部分：调用方必须把「没有确认的超时」当成未知，而不是再发一遍 `gbb send`。

## super-bot 怎么用

- 资料 `gbb-0.3.3`：不生成 `--kind pi` 的 launch。
- 资料 `gbb-launch-kind-v1-simulated`：只在 fake adapter 里生成，并标明模拟。
- 真实 dry-run 若被要求 launch pi，适配器直接 `blocked`，不会 spawn。

# super-bot

Grok Bot 用这份说明调用 super-bot。人只和你说话。你不要开第二个聊天代理，也不要直接跑 `hc` 或 `herdr`。

## 何时用

- 人要新开一件事：设计偏 codex，验证偏 codex，执行偏 pi。
- 人要接着某个已经在 Herdr Core 里的会话做，而且能提供完整快照，不是只丢一个 pane id。
- 人要改强度、本地预算或「pi 不可用时的替代」。先给建议，等人点头再确认。
- 人要可选的 pstack 流程时，先说明默认是 `off`。可选的只有 `feature`、`bugfix`、`verify`。确认后再写入偏好。这不改变代理人选，也不取消已经在跑的工单。

## 不要做

- 不要把代理或 gbb 的 `done` 说成已经验收。
- 不要在模型或额度是 unknown、stale、expired 时编一个模型名或剩余额度。
- 不要因为 pi 不能 launch 就自己改派 codex。那要走偏好确认。
- 不要用 `gbb list` 的 stale 行或对不上的标签去接管。
- 不要把终端输出塞进回调。gbb 0.3.3 的回调本来就没有正文。

## 命令

状态目录用 `SUPERBOT_STATE`。默认是 dry-run，不会真的启动代理。

新请求：

```bash
sbot request --request-id <id> --text "<人的原话>" --scope "<范围>" --acceptance tests
```

要走 pstack 流程时加上 `--workflow feature|bugfix|verify`。`verify` 还要 `--head <sha>`。证据要带 `--head`、`--command`、`--output`，验收步骤再加 `--verifier <验收派工 id>`。

看工单：`sbot show --ticket <id>`。把 `summary` / `attention` 用你自己的话告诉人。然后 `sbot inbox ack --id <message-id>`。

模拟全流程（fake adapter，不是用户机器，realE2E 为 false）：`sbot demo`。

接管：`sbot takeover --snapshot <file>`。文件要符合 `examples/takeover.json`。

回调：`POST /v1/callbacks/bac`。`source` 是 `bot-as-collie`，`version` 是整数 1。去重键是 `event_id`。bac 二进制还没实现，不要据此切现网。

证据：你或人跑过检查之后，

```bash
sbot evidence --assignment <id> --producer harness --check role:verify=ok --check tests=ok
```

`--producer agent` 不会通过验收。

改偏好：

```bash
sbot preference propose --intensity high --budget 12
sbot preference confirm --proposal <id> --option apply
sbot preference revert --version 1
```

把建议原文里的选项和影响给人看。没有确认就不要当成已经生效。

## 你该怎么说

短。说明现在是 dry-run、模拟，还是在等尚未实现的 bac。若派工是 `kind_unsupported` 且 `kind_support` 为 `rejected`，告诉人：v1 不 launch pi 或 antigravity，也不会改写成 codex。已有 codex 或 grok 窗格可以走 `bac handover`。

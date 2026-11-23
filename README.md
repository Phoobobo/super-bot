# super-bot

Grok Bot 仍然是唯一和人说话的入口。super-bot 不另做聊天壳，也不绕过 [gbb](https://github.com/Phoobobo/grokbot-bridge-herdr) 去直接控制 `hc`。它把 bot 的一句话收成授权工单，按角色派给 Herdr Core 里的代理，再用证据而不是自报来验收，最后把短摘要交回原来的 bot。

这是草稿，不是生产系统，也还没有在 Mac 上跟真实 gbb/hc 做过端到端。`dry-run` 只生成 `gbb` 参数并记下来，进程不启动，pane 不注册，上下文不读取。它不是 E2E。

没有 `SUPERBOT_BOT_URL` 时，给原 bot 的回报仍是本机 inbox：消息先是 `queued`，reply 效果成功后才变成 `deliverable`，bot ack 之后才是 `acked`。设置了 `SUPERBOT_BOT_URL` 之后，同一条 outbox 会 POST 回那个地址；2xx 写成 `delivered`，失败最多再试两次，然后写成 `failed`。这仍不是已经送到用户聊天里的消息，也不是 Mac 上的端到端。模拟适配器里的成功不能当成真实 gbb。

## 现在能跑

- `sbot demo`：四条模拟场景。fake adapter 走完「新请求 → 授权/工单 → 分工 → 回调 → harness 证据 → 回给 bot」，「接管已有会话且不重复已完成项」，「改派工偏好 → 看建议 → 确认 → 撤回」，以及可选的 pstack `feature` 流程。输出里 `simulated: true`、`realE2E: false`。
- `sbot request` 默认是 **real dry-run**：只生成 `gbb` 的参数数组，不 spawn。
- `sbot serve`：本机 JSON API，给 bot 和 gbb 回调用。
- 状态、outbox、效果队列在 SQLite 里。进程重启后，正在飞的非幂等调用记为未知，不会自动重发。

## 受 gbb 0.3.3 限制，现在不能当成真的

对照的 gbb 是 `bbdfc4bbaece3ddafa3a9363b1d0f43b230aa5a6`（版本 0.3.3，main 上的文档更旧）。

- `gbb launch --kind` 只有 `grok` 和 `codex`。执行阶段的首选是 pi。在这份资料下，新的执行派工会停成 `capability`，要求 `gbb.launch.kind=pi`，**不会悄悄改成 codex**。
- 只把 `--kind` 白名单放宽也不够。`wait_hc_ready` 对非 codex 要等 OSC 7501 的 `idle`/`done`。pi 会不会报这个状态，这份草稿没有在真实 hc 上看到，所以不能假设补丁一上就能开 pi。见 `docs/gbb/MINIMAL-PATCH.md`。
- `hc ls` / `hc get` 没有 model 字段。交接进 gbb 的 pane，`kind` 还是 null，模型行只在 kind 为 codex 时从屏幕刮。读不到就保持 `unknown`，不填默认模型。
- 没有已接通的官方额度接口。额度是 `unknown` / `stale` / `expired`，数字过期了就不能当余额用。
- gbb 回调没有终端输出，也没有持久重试队列。超时且没有退出确认的发送记为未知，不自动重发。
- `gbb list` / `report` 的 `stale` 和标签不能拿来接管。只有 pane id 会被拒绝。

用户后来明确批准的执行替代（例如 codex）会写成新的偏好版本，并在派工上标 `user-approved-substitute`。撤回会回到批准之前。

## 快速上手

需要 Node.js 22.13 或更新。

```bash
npm install
npm test
npm run demo
npm run smoke
```

`npm run smoke` 只打印以后在操作者机器上的步骤，并确认能力资料。它不会调用 gbb，也不会连到别人的机器。

另开一个终端看 API：

```bash
npm run serve
```

默认地址是 `http://127.0.0.1:47231`。健康检查是 `/v1/health`。

状态目录是 `SUPERBOT_STATE`，缺省为 `./data/superbot`。

一条 dry-run 请求：

```bash
npx sbot request --request-id demo-1 --text "给示例仓库补健康检查" --scope "只改示例仓库" --acceptance tests
```

执行阶段会停住，原因是 pi 不能 launch。设计阶段如果单独指定 `--phases design`，会得到一组 `gbb launch ... --kind codex` 参数，进程并不启动。

## 可选的 pstack 流程

默认 `workflow.defaultKind` 是 `off`，请求仍按 `design,execute,verify` 阶段走。确认偏好或在单次请求里写 `--workflow feature|bugfix|verify` 之后，Engine 才使用这三类步骤。流程偏好和代理偏好是两件事：设计仍默认 codex，执行仍默认 pi，验证仍默认 codex。pi 不能 launch 时停成 `capability`，不会悄悄改成 codex。

| 流程 | 步骤 | 写入 |
| --- | --- | --- |
| feature | 追踪/设计 → 实现 → 独立验收 | 只有实现步骤写仓库，工单只有一个 owner |
| bugfix | 先复现 → 最小修复 → 用同一条复现命令验收 | 修复步骤才写 |
| verify | 只读验收一个已给出的 head | 不产生执行派工，不接管实现 diff |

验收要带上 head、命令、实际输出，以及和实现派工不同的验收身份。旧 head 上的通过不能拿来给新 head 放行。kickoff 里的验收项不会在中途被加长。返工上限写在偏好里，默认 2，最多 5。改偏好不会取消已经在跑的工单，也不会放宽它的授权。

这不是 Cursor 里的 `/poteto-mode`。没有接 slash skill、custom mode、`poteto-agent` / Comment Sicko、arena、swarm、automations、bugbot、worktree 或 `/loop`。模型也不使用 pstack 默认的 Opus / Fable / Gemini 面板。gbb 仍是唯一的 agent 通信层。

## 模拟和真实 E2E

| 标记 | 含义 |
| --- | --- |
| `sbot demo`、`--simulate`、profile `gbb-launch-kind-v1-simulated` | fake adapter。pi 可以在模拟里被 launch。不是 gbb 0.3.3。 |
| 默认 `sbot request`、`adapter: real`、`mode: dry-run` | 参数是真的 gbb 参数，没有 spawn。 |
| live spawn | 代码里有，但要 `mode: live` 且 `allowLive`。本草稿的命令行没有打开它。这里也没有对用户的 hc 做端到端。 |

bot 怎么接，看 `skills/super-bot/SKILL.md` 和 `examples/bot-integration.md`。

架构从 dsh-superagent 的哪些文件来、又故意没搬什么，看 `docs/architecture-map.md`。取舍在 `docs/decisions/`。

## 许可

MIT。概念来源和 gbb 的版本写在 `NOTICE`。

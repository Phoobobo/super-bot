# 文件级映射

参考实现是 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 的 `8c32a9dc5d72c033816c6a8110b37f40cf94fba4`。下面按该提交的 `docs/007-architecture.md` 和 `src/core/` 对照。super-bot 没有把那棵树搬过来，也没有 DeepSeek Harness 的 Session。

## 保留的边界

| dsh-superagent | 在这里 | 说明 |
| --- | --- | --- |
| `src/core/engine.ts` 唯一写入 Trigger、Thread、Decision、Ticket、Assignment | `src/core/engine.ts` `Engine` | 命令在 `Store.atomic` 里提交。适配器在事务外调用，结果经 `applyAdapterResult` 回到 Engine。 |
| `src/core/intake.ts` `receive` | `Engine.request` / `Engine.takeover` | 同一 `requestId` 只产生一个 Trigger。已有工单的线程上，后来的话是 follow-up，不新开 Mandate。 |
| `src/core/evals.ts` 准入与 Decision | `Engine.evaluate` | 只接受配置里的 bot 身份，强度 `explicit`。没有进程内的模型研判。主 Session 是外面的 Grok Bot。 |
| `src/core/tickets.ts` Mandate、Subscription | `Mandate`、`Thread.subscription` | 取消会撤回 Mandate。更宽的范围要新工单，这份草稿用新的 `requestId`。 |
| `src/core/assignments.ts` 派工与报告 | `Assignment`、`Engine.callback` | `done`/`idle` 只把状态改成 `claimed`。验收在 `Engine.evidence`。 |
| `src/core/replies.ts` + `src/app/outbox.ts` | `BotMessage` + effect `reply` | 回执先落库，再由 reply 效果标成可拉取。bot 用 `sbot inbox` 取，不另开一条到 hc 的通道。 |
| `src/app/effects.ts` | `src/store.ts` 的 `effect` 表 + `Runtime.step` | 非幂等效果先记 `running` 再调用。重启时仍是 `running` 的，改成 `unknown`，不重发。 |
| `src/app/store.ts` SQLite | `src/store.ts`，`node:sqlite` | 单进程锁文件。没有 dsh 的 schema 11 迁移。 |
| `src/policy.ts` 版本化策略 | `src/preferences/` | 偏好版本可确认、可撤回。未知额度是观察，不是编出来的余额。 |
| `src/executor/dsh.ts` | `src/gbb/fake.ts`、`src/gbb/real.ts` | 执行器是 gbb 管理的 hc 终端，不是 DSH worker session。 |
| `src/sources/github.ts`、`feishu.ts` | 没有 | 唯一用户来源是 Grok Bot 的 CLI/API。gbb 回调是执行器事实，不是第二个用户入口。 |
| `src/client/` 面板 | 没有 | 不另做给人看的聊天或控制台。 |
| `src/core/stage.ts` | 工单 `phase` 加派工 `status` | 阶段表被压成：未激活、待发、dry-run、运行、已声称、已验收、受阻、未知、跳过、取消。 |

## 本仓库文件

| 路径 | 职责 |
| --- | --- |
| `src/core/model.ts` | 领域类型。对应 `src/core/model.ts` 里用到的那一组，去掉了 PR/飞书字段。 |
| `src/core/engine.ts` | 单写者。 |
| `src/core/plan.ts` | 角色抽样。dsh 的模型选择在 `src/app/role-models.ts`，这里改成可复现抽样，并且额度不可用时不探索非首选。 |
| `src/core/ids.ts` | 由输入派生的 id。对应 `src/core/ids.ts`。 |
| `src/core/errors.ts` | `UserError`。对应 `src/core/errors.ts`。 |
| `src/observe.ts` | `known` / `unknown` / `stale` / `expired`。dsh 没有这个额度观察。 |
| `src/store.ts` | 文档、效果、回调去重。 |
| `src/runtime.ts` | 组合根，对应 `src/app/runtime.ts`，但没有插件宿主。 |
| `src/gbb/contract.ts` | gbb 0.3.3 的能力，以及一份标明 `simulated` 的扩展契约。 |
| `src/gbb/argv.ts` | 只构造参数数组。 |
| `src/gbb/fake.ts` | 测试和 demo 的适配器。 |
| `src/gbb/real.ts` | dry-run 或 `shell: false` 的 spawn。 |
| `src/takeover/snapshot.ts` | 接管快照。dsh 没有「把一个已有 Session 收成工单」这一条。 |
| `src/preferences/propose.ts` | 建议、选项、影响。确认后才写版本。 |
| `src/quota.ts` | 可替换的额度读取。默认是未配置。 |
| `src/cli.ts`、`src/http.ts` | bot 调用的 CLI 和本机 API。 |
| `src/demo.ts` | 三条模拟场景。 |
| `skills/super-bot/SKILL.md` | 给 Grok Bot 的集成说明。 |

## 故意偏离

1. **主 Session 不在进程里。** dsh 的 `orchestrator` 是一个会研判的 DSH Session（`src/app/assessment.ts`、`src/app/sessions.ts`）。这里如果再放一个会聊天的模型，就变成了第二个用户入口。明确请求由 bot 带来，Engine 只做准入、授权和派工。
2. **证据门。** dsh 的 `ready` 报告可以在没有 PR 时结束工单（`docs/003-execution.md`）。这里 `done` 只是声称。验收要有 `producer: harness` 的检查，代理自报不够。
3. **执行器是 gbb，不是 DSH。** 不调用 `hc` 或 `herdr` 二进制。Herdr 里可见，靠 gbb 0.3.3 自己打的 `herdr.space`、`herdr.tab`、`grokbot=managed`、`gbb_task`。取消接管来的 pane 时不调用 `gbb stop`，因为那会 reclaim、清掉标记（`bin/gbb` `hc_cmd_stop`，`docs/decisions/0007`）。
4. **pi 不能新开时停住。** dsh 的角色模型是配置好的 Eval/Executor 模型。这里执行首选是 pi，不在 `launchKinds` 里就 `blocked`，除非偏好里已有确认过的替代。
5. **没有面板、没有飞书/GitHub Source、没有 DSH 工具协议。** 那些是参考系统的部署，不是这份草稿要复刻的产品。

## pstack 流程，不是第二个调度器

可选协议来自 [pstack](https://github.com/cursor/plugins/tree/e58dd043600587dbaf58ba315e7f2b38373eeb43/pstack) 的 `e58dd043600587dbaf58ba315e7f2b38373eeb43`（v0.15.44，MIT，Copyright (c) 2026 Lauren Tan）。对照的 playbook 是 `pstack/skills/poteto-mode/playbooks/feature.md` 和 `bug-fix.md`。实现在 `src/workflow/protocol.ts`，状态写在工单的 `workflow` 上，派工仍由 `Engine` 单写者经 gbb 发出。

| pstack 宿主 | 这里的替换 |
| --- | --- |
| `/poteto-mode`、custom mode、slash skill | 请求字段或偏好里的 `feature` / `bugfix` / `verify`。默认 `off`。 |
| `poteto-agent`、Comment Sicko、arena、swarm | 不生成。一个工单一个 owner。共享写入按步骤串行。 |
| 角色模型 Opus / Fable / Gemini，`/setup-pstack` | 不读取。设计 codex、执行 pi、验证 codex，能力不够就 `blocked`。 |
| bugbot、automations、worktree、`/loop`、control-cli | 不接。 |
| 独立验收和同一复现面 | harness 证据要有 head、命令、输出和验收身份。实现派工的 id 不能充当验收身份。 |

dsh-superagent 仍然只提供 Source → Trigger → Eval → Mandate / Ticket → Assignment 的边界。pstack 不取代那条边界，也不成为第二个会和人说话的入口。

## 严验对照（仍不可声称完成）

| 检查 | 参考里的落点 | 这里的做法 | 还不能声称 |
| --- | --- | --- | --- |
| 单写者 | `src/core/engine.ts` 是 Trigger/Thread/Decision/Ticket/Assignment 的唯一写入；`docs/007-architecture.md` 的 writer 表 | `Engine.write` 打开 domain 标记后，`Store.put` 才接受 `ticket`、`mandate` 以及同组聚合。其它调用会得到 `single-writer`。 | 进程内约定，不是操作系统权限。 |
| Outbox | `src/app/outbox.ts`：事务里记账，`reply` 效果提交后发送；同一 id 不排两次 | 消息先 `queued`，与 reply 效果同一事务。领取后才标 `deliverable`。崩溃时幂等 reply 回到 `waiting`，非幂等 gbb 调用保持 `unknown`。 | 没有把摘要 POST 到用户的 bot webhook。 |
| 并发领取 | `src/app/effects.ts` 一行一个 kind/key | `Store.claimEffect` 在一个事务里把 `waiting` 改成 `running`。第二次领取得到空。 | 只覆盖同一进程。 |
| 回调去重 | gbb `build_event` 无 `event_id`；`notify` 可能 owner 与 fallback 各送一次 | 去重键忽略 `route`。`owner` 必须等于工单 owner，否则不推进声称。 | 不是 gbb 自己的持久重试队列。 |
| 超时不重发 | dsh 对非幂等外部动作避免在 unknown 时自动再做；gbb `post_webhook` 没有持久队列 | `launch`/`send`/`handover` 超时记 `unknown`，`claim` 之后不再执行。`read`/`status` 可以有限次重试。 | 没有在真实 gbb 上制造超时。 |
| 接管 | gbb `do_handover_hc` 与 `cmd_read` | 快照只是申请。`gbb handover` 成功后才 `gbb read`。空文本或 dry-run 的 `planned` 不会 `send`。 | fake 的 read 文本是夹具。dry-run 没有注册 pane。不是 Mac E2E。 |

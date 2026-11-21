# 0003 — 模型、额度、偏好

日期：2026-11-21 · 状态：接受

## 观察

一条观察只有在 `status: known`、有 `source`、有 `observedAt`、并且 `freshUntil` 仍在当前时间之后时，数字才可用。否则是 `unknown`、`stale` 或 `expired`。过期观察里的 `remaining` 只留作审计，规划器看 `usable === false`。

这次没有读到用户 hc 会话的当前模型，也没有读到供应商剩余额度。默认观察是：

- 模型来源 `hc-get-has-no-model-field`，状态 unknown。
- 额度来源 `no-quota-channel`，状态 unknown。

不会把某个默认模型写进 gbb 参数。gbb 自己的 `codex_args` 仍可能在真实 launch 时生效；那是 gbb 的配置，不是 super-bot 选出的模型。dry-run 的参数里没有 `-m`。

## 分工

| 角色 | 首选 | 其它 |
| --- | --- | --- |
| design | codex，权重 94 | grok、antigravity 各 3 |
| verify | codex，权重 94 | grok、antigravity 各 3 |
| execute | pi，权重 100 | 没有随机替代 |

抽样只用当前资料能 launch、且用户已授权的候选。额度不可用时，非首选权重视为 0，并记下 `quota-unknown`、`quota-expired` 或 `quota-stale`。种子是 `sampleSeed + 偏好版本 + 工单 id + 角色`，同一输入得到同一结果。

执行角色在 pi 不能 launch 时不进入这个抽样。没有 `executeSubstitutes` 就受阻。有的话，选用的是用户确认过的替代，选择原因写成 `user-approved-substitute`。

`unknownQuota: block` 时，额度不可用会连首选一起停住。默认是 `mark-and-proceed`，因为否则在没有额度接口时任何工作都开始不了，而那会被误读成「我们知道余额是 0」。

## 偏好怎么改

`propose` 给出一句建议、若干选项和各自的影响。`confirm --option` 才写入下一个版本。`keep` 不产生新版本。`revert` 追加一个内容等于旧版本的新版本，已发生的本地花费计数不退回。本地预算是计数器，不是供应商账单。强度 `low/normal/high` 每阶段记 1/2/4。

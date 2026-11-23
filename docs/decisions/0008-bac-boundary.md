# 0008 — 消费方迁到已冻结的 BotAsCollie v1

日期：2026-11-23 · 状态：消费方已按冻结契约改写。bac 二进制仍未实现。

## 决定

用户要求通信依赖做 breaking change，简称 BAC（BotAsCollie）。不保留 gbb 兼容层，也不另做 legacy adapter。

契约已冻结在 `Phoobobo/grokbot-bridge-herdr` `ae859908ed07684997c786d1744e5f724f087259`，父提交 `bbdfc4bbaece3ddafa3a9363b1d0f43b230aa5a6`。本仓库只改消费方。不实现 `bac`，不安装，不切换现网，不把 fixture 当成端到端。

可执行文件名是小写 `bac`。`launch` 必须带 `--kind`，只接受 `codex` 和 `grok`。省略是 `kind_required`。`pi` 和 `antigravity` 是 `kind_unsupported`，`kind_support` 为 `rejected`，不会改写成别的 kind。回调 `source` 是 `bot-as-collie`，`version` 是整数 `1`。去重键是 `event_id`。owner 不匹配是 `owner_mismatch`，缺 owner 是 `owner_required`。这是受信 CLI 选择器，不是独立认证。模型与额度不进回调。

人的通信仍然只经过桥接层。super-bot 不直接 spawn `hc`。

## 消费方现在怎么调用

| 位置 | 事实 |
| --- | --- |
| `src/bac/argv.ts` | argv0 必须是 `bac`。子命令来自冻结的 `commands.json` |
| `src/bac/real.ts` | dry-run 只记参数。live 要显式 `allowLive`，`shell: false`。本环境不 spawn |
| `POST /v1/callbacks/bac` | `source=bot-as-collie`，`version` 为整数 1，去重键是 `event_id` |
| takeover | 只排 `bac handover`。拒绝保留字和 `herdr_space` / `herdr_tab`。不调用 `hc` |

`docs/gbb/MINIMAL-PATCH.md` 只描述旧的 gbb 0.3.3 缺口，不是这份 v1 契约。bac 运行时、真机 Bot→BAC→Herdr→Bot，以及 Dots 桥的切换都还没有做。`realE2E` 保持 false。

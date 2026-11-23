# 0008 — 迁到 BotAsCollie，先不猜接口

日期：2026-11-23 · 状态：接受，契约未到

## 决定

用户要求通信依赖做 breaking change，简称 BAC（BotAsCollie）。不保留 gbb 兼容层，也不另做 legacy adapter。研发工程师独占上游实现。本仓库在契约交付前不编写 BAC 的 argv，也不删除现有 gbb 测试。

人的通信仍然只经过桥接层。super-bot 不直接 spawn `hc`。

## 现在仍钉在 gbb 上的边界

这些调用在契约到达前保持原样，因为它们是已经能验证的行为：

| 位置 | 现在的事实 |
| --- | --- |
| `src/gbb/argv.ts` | `launch` / `send` / `handover` / `read` / `status` / `stop`，bin 名必须是 `gbb` |
| `src/gbb/contract.ts` | 0.3.3 的 `launchKinds` 只有 grok、codex |
| `src/gbb/real.ts` | dry-run 只记参数；live 要显式 `allowLive`，且 `shell: false` |
| `POST /v1/callbacks/gbb` | 事件形状沿用 gbb 0.3.3，去重键不含 route |
| takeover | `gbb handover` 再 `gbb read`，然后才 `gbb send`。pane id 原样传递 |

## 要等上游写明的契约

没有这些事实之前，不替换上面的调用：

- 可执行文件名，以及取代 launch、send、handover、read、status、stop 的子命令
- 新任务如何指定 codex、grok、pi、antigravity
- pane id 由谁生成、字段叫什么。hc 打出来的 id 是不透明字符串，不是 super-bot 起的名字
- 回调 JSON、owner 隔离和去重键
- 回调里有没有终端文本
- 接管已有 pane 时如何只经 BAC，而不由 super-bot 调用 hc
- 模型和额度如果有字段，来源如何区分 observed 与 unknown

`docs/gbb/MINIMAL-PATCH.md` 只描述旧的 gbb 0.3.3 缺口，不是 BAC 的设计。

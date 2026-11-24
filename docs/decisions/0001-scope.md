# 0001 — 草稿范围

日期：2026-11-21 · 状态：接受

## 问题

人只和 Grok Bot 说话。Bot 用 gbb 看和指挥 Herdr Core 里的代理。super-bot 要按 dsh-superagent 的方式把「谁允许、做到哪、谁执行、怎么验收」分开，而不是再包一层多 agent 聊天。

## 决定

- 入口只有 bot 调用的 CLI 和 `127.0.0.1` 上的 JSON API。
- 对代理的写操作只通过 `gbb` 参数数组。不 spawn `hc` 或 `herdr`。
- 默认 real 适配器是 dry-run。`sbot demo` 用 fake adapter，输出标明模拟。
- 明确请求直接形成 Mandate。不在进程里跑一个研判模型。
- 执行角色首选 pi；gbb 0.3.3 不能 launch pi 时派工受阻。已确认的替代才可以改派。
- 验收不相信代理自报，也不相信 gbb 的 `done` 本身。

## 没有做

- 没有发布 GitHub 仓库，没有部署。
- 没有改用户机器上的 gbb，也没有把补丁打进克隆下来的参考树。
- 没有接供应商额度 API，没有填当前会话模型。
- 没有把 dsh 的面板、飞书、GitHub Source 或 Session 工具做一遍。

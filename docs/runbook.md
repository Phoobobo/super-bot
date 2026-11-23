# 运行手册

这是下一轮在操作者自己的 Mac 上可以执行的最小步骤。这里没有跑过那台机器，所以下面的预期不是端到端通过记录。

## 包

```bash
npm ci
npm run check
npm pack --dry-run
```

`npm pack` 只列出包，不发布。默认 `sbot serve` 是 dry-run，不会 spawn。

## 本机闭环

1. 终端 A：`SUPERBOT_STATE=./data/superbot npm run serve`
2. 健康检查：`curl -s http://127.0.0.1:47231/v1/health`。`mode` 应是 `dry-run`。
3. 要让结果推回原来的 Bot，启动前设置 `SUPERBOT_BOT_URL=http://127.0.0.1:<bot-port>/superbot`。可选 `SUPERBOT_BOT_TOKEN` 只放在环境里，不要写进仓库。
4. 没有 `SUPERBOT_BOT_URL` 时，结果停在 inbox，由 Bot `GET /v1/inbox` 再 ack。
5. gbb 的 owner `grok-bot` webhook 指到 `http://127.0.0.1:47231/v1/callbacks/gbb`。

## 下一轮预期

`sbot facts`：模型来源 `hc-get-has-no-model-field`，origin `unknown`。额度来源 `no-quota-channel`，origin `unknown`。`realE2E` 是 false。

`sbot request --request-id mac-1 --text "只读检查" --scope "不改仓库" --acceptance tests --phases design`：设计阶段生成 `gbb launch ... --kind codex`，状态 `planned`，没有进程。

同一条命令如果阶段含 `execute`：执行派工 `blocked`，`requirement` 是 `gbb.launch.kind=pi`。参数里可以出现 kind pi，但不会 spawn，也不会改成 codex。

`sbot preference recommend` 只给出选项。确认 `substitutes-only` 之后，pi 不能 launch 才会标 `user-approved-substitute`。

`sbot serve --live` 才会 spawn，并且仍然只调用 `gbb`，`shell` 为 false。不要和 `--simulate` 一起用。

操作者提供的额度或模型文件是 `config`，不是官方观测。文件里写成 observed 也会被记成 config。

## 还不能做

- 没有在真实 hc 上接管或验收。
- gbb 0.3.3 不能新开 pi 或 antigravity。Mac 只读核对是 hc 0.1.22。`docs/gbb/MINIMAL-PATCH.md` 只记这个旧缺口。
- 通信层将改为 BotAsCollie，不保留 gbb 兼容层。契约还没到，所以命令仍是现在的 gbb 向量。见 `docs/decisions/0008-bac-boundary.md`。
- Mac harness 的 live takeover 要操作者填入 hc 打印的 pane id。脚本不检查名字前缀，也不运行 `hc ls`。
- 没有官方额度接口，也没有 hc 的 model 字段。

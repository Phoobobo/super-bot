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
5. 回调送到 `http://127.0.0.1:47231/v1/callbacks/bac`。`source` 必须是 `bot-as-collie`，`version` 必须是整数 1。去重键是 `event_id`。BAC 的 journal 恢复不会重放没送到的回调，所以这里不承诺恰好一次。没收到的完成回调保持未完成，不补造一条。

## 下一轮预期

`sbot facts`：模型来源 `hc-get-has-no-model-field`，origin `unknown`。额度来源 `no-quota-channel`，origin `unknown`。`realE2E` 是 false。

`sbot request --request-id mac-1 --text "只读检查" --scope "不改仓库" --acceptance tests --phases design`：设计阶段生成 `bac launch ... --kind codex`，状态 `planned`，没有进程。

同一条命令如果阶段含 `execute`：执行派工 `blocked`，`code` 是 `kind_unsupported`，`kind_support` 是 `rejected`。不会 spawn，也不会改成 codex。

`sbot preference recommend` 只给出选项。确认 `substitutes-only` 只记下名单，不改写 launch kind。

`sbot serve --live` 才会尝试 spawn `bac`，`shell` 为 false。不要和 `--simulate` 一起用。最近一次能读到的 bac 运行时是 `ca89d297c1aa34dbdc367af7c5234da0f59c0ef4`，不在 BAC 的 `main` 上。候选 `10e1d2b` 在 2026-11-24 这次读取里不存在。

操作者提供的额度或模型文件是 `config`，不是官方观测。文件里写成 observed 也会被记成 config。

## Mac mini 隔离步骤

机器 `0df4e466-1b69-44c6-a3d3-6f46d4155c1e` 由参谋长操作。这里没有连上它，下面不是那台机器的运行记录。

1. 状态放在新目录，例如 `/tmp/sbot-mac-state` 和 `/tmp/bac-mac-state`。不要用已经有会话的 `~/.local/state/bot-as-collie`。
2. 官方安装仍是 `https://releases.herdr.dev/app/install.sh`。开发机上这次得到 Herdr app `0.1.17` 和 `hc 0.1.22`。Mac 上先 `hc --version` 再决定是否安装。
3. bac 用可读到的提交 `ca89d297c1aa34dbdc367af7c5234da0f59c0ef4` 的 `bin/bac`，除非 `10e1d2b` 已经能按完整 SHA 打开。不要跑 `tests/run.sh`，也不要做 lock、kill、并发探针。
4. Grok 需要本机已有登录或 `XAI_API_KEY`。没有就停。开发机上同一次 launch 停在 `startup_blocked` / `auth`，`pane_id` 是 `t1`，随后 `bac stop --owner grok-bot` 清掉了终端。
5. `SUPERBOT_STATE=/tmp/sbot-mac-state SUPERBOT_BOT_URL=<Bot 的 URL> SUPERBOT_BAC_BIN=<bac> sbot serve --live`。bac 配置的 webhook 指到 `http://127.0.0.1:47231/v1/callbacks/bac`。
6. 只发一次 `bac launch --backend hc --kind grok --task <id> --owner grok-bot`。然后 `bac read <id> --owner grok-bot`。完成回调必须是 bac 自己 POST 的，`task_id` 对上这次 launch。脚本注入或 fixture 不算。
7. 结束后 `bac stop <id> --owner grok-bot`，`hc ls` 应为空。

## 还不能做

- 没有在真实 hc 上接管或验收。
- gbb 0.3.3 不能新开 pi 或 antigravity。Mac 只读核对是 hc 0.1.22。`docs/gbb/MINIMAL-PATCH.md` 只记这个旧缺口。
- 通信层将改为 BotAsCollie，不保留 gbb 兼容层。契约还没到，所以命令仍是现在的 gbb 向量。见 `docs/decisions/0008-bac-boundary.md`。
- Mac harness 的 live takeover 要操作者填入 hc 打印的 pane id。脚本不检查名字前缀，也不运行 `hc ls`。
- 没有官方额度接口，也没有 hc 的 model 字段。

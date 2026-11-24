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

`sbot serve --live` 才会尝试 spawn `bac`，`shell` 为 false。不要和 `--simulate` 一起用。消费方钉在保全包 `10e1d2b7ce2d7bee71286b0a1d0672db4a551202`。它的 `commands.json` 与 `ae859908` 相同，所以 argv 没有改。该提交未发布，也不在远端。

操作者提供的额度或模型文件是 `config`，不是官方观测。文件里写成 observed 也会被记成 config。

## Mac mini 隔离接收端

机器 `0df4e466-1b69-44c6-a3d3-6f46d4155c1e` 由参谋长操作。这里没有连上它，下面不是运行记录。源码包是 `26d836ae916e30c0eaf977be4c4eaae951276cd6`，tree `38a2d6b6a9f83afa5be753926b077503bb472b94`，archive sha256 `bf92fa994a4ee117bf229fbefce9825468a022cb8a8ea998a28eb6d8359ff238`。

1. 在 Mac 上解包后 `npm ci` 再 `npm run build`。Node 要 `>=22.13`。没有运行时依赖。入口是 `node dist/cli.js`。`npm run serve` 不带 `--live`，不要用它做这次测试。不要全局安装。
2. 四个新目录：`SUPERBOT_STATE`、`BAC_STATE_DIR`、`BAC_DATA_DIR`、`BAC_CONFIG`。不要指向已有会话。`SUPERBOT_BAC_BIN` 指向保全包 `10e1d2b` 的 `bin/bac`，文件名必须是 `bac`。已有的 Grok 登录留在原处，不复制、不打印。
3. 启动：`SUPERBOT_STATE=<新目录> SUPERBOT_BAC_BIN=<bac> node dist/cli.js serve --port 47231 --live`。进程只听 `127.0.0.1`，并占住状态目录的锁。查询和取消都走这个进程的 HTTP，不要再开一个 CLI。
4. 隔离的 bac 配置把 `webhook_url` 设成打印出来的 url 加上 `/v1/callbacks/bac`。不要写 `[[owners]]` 里的 `grok-bot`，否则回调先去那个地址，失败才回主 webhook。配置文件模式必须是 `600`。`SUPERBOT_TOKEN` 未设置时，`webhook_header_name` 和 `webhook_header_value` 留空。设置了才用请求头 `Authorization`，值是 `Bearer` 加该令牌。令牌不写进仓库。
5. 默认执行阶段的权重是 `pi`，会被 `kind_unsupported` 拒绝，不会启动 Grok。先 `POST /v1/preferences/propose`，`weights.execute` 只有 `grok`，design 和 verify 仍给 `codex`，再 `POST /v1/preferences/confirm`，`option` 为 `apply`。然后 `POST /v1/requests`，`phases` 只有 `execute`，`repo` 必须是本机已有的 git 仓库。服务器自己执行 `bac launch --repo --kind grok --task --owner grok-bot --no-worktree --prompt-file`。不要在外面另发一条 launch。
6. 关联：`GET /v1/tickets/<id>` 的 `assignments[].gbbTaskId`。bac 侧是 `BAC_STATE_DIR/managed.json` 的 `task_id`，generation 在 `event-seq.json`。收到的回调在 `seen_callback`，键是 `id:` 加 `event_id`。这次提交的 live 结果不把 stdout 里的 `pane_id` 写进 assignment。
7. `bac launch` 会等到进程自己退出。等待上限是 bac 默认成功路径：1 秒、三次最多 60 秒的 herdr agent start、两次 3 秒间隔、4 秒 settle、90 秒 ready、一次 30 秒 prompt、10 秒核对，再加 15 秒，一共 336 秒。hc 路径更短，包含在里面。超过这个上限才把 assignment 标成 `unknown`，这时完成回调仍是 `not-dispatched`。`status`、`read`、`send`、`handover`、`stop` 仍是 5 秒。重启不重放没送到的回调。
8. 结束只限这次：`POST /v1/tickets/<id>/cancel`，再杀掉 `SUPERBOT_STATE/lock` 里的那个 pid。`bac stop` 不执行 `hc server stop`。只删除这四个新目录。不要用 `sbot callback --json` 或 `bac test-webhook` 充当端到端。

## 还不能做

- 没有在真实 hc 上接管或验收。
- gbb 0.3.3 不能新开 pi 或 antigravity。Mac 只读核对是 hc 0.1.22。`docs/gbb/MINIMAL-PATCH.md` 只记这个旧缺口。
- 消费方已经按 BotAsCollie v1 调用 `bac`。没有 gbb 兼容层。见 `docs/decisions/0008-bac-boundary.md`。
- Mac harness 的 live takeover 要操作者填入 hc 打印的 pane id。脚本不检查名字前缀，也不运行 `hc ls`。
- 没有官方额度接口，也没有 hc 的 model 字段。

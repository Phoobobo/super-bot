# 验证记录

dry-run 只生成 gbb 参数。它不注册 pane，不读取终端，不是 E2E。`sbot demo` 使用 fake adapter，`simulated: true`，`realE2E: false`。

下面这次 `npm run check` 在提交验收修复之后的工作树上运行，退出码 0。

- eslint 通过。
- `tsc -p tsconfig.json --noEmit` 与 `tsc -p tsconfig.test.json --noEmit` 通过。
- vitest：6 个文件，27 个测试，全部通过。
- `tsc -p tsconfig.json` 构建通过。

`npx tsx src/cli.ts demo` 退出码 0。新请求、接管、偏好三个场景都是 ok。接管场景的原文写明快照还不是完成的接管，send 发生在模拟的 gbb handover 和 gbb read 之后。后来的 demo 加了第四个 `workflow` 场景，仍然是 fake adapter。

尚未完成：真实 Mac 上的 gbb 0.3.3 / hc 0.1.21 E2E，以及向用户 bot webhook 的推送。inbox 只是本机拉取契约。

## 依赖公告

2026-11-21 的 `npm audit --json` 在 vitest 3.2.7 上报 2 critical、1 moderate，全部是 devDependency，生产 `dependencies` 为空。

- critical：`tinypool@1.1.1`，只被 vitest 依赖。GHSA-5gmw-xhrv-c9v3（`<=2.1.0`）和 GHSA-85c8-ppgw-ccpr（`<2.1.2`）是 worker options 的原型污染 gadget，可到 RCE。运行中的 bot 不 import tinypool；`npm test` 会加载它。
- moderate：`@vitest/mocker@3.2.7`。GHSA-82fw-gwwq-j7x9（`<4.1.11`）和 GHSA-qxg6-89mg-rqv8（`<4.1.12`）。vitest 3.2.7 把这两者标成 critical 是因为传递依赖，包自身公告是 moderate。

vitest 3 线的 dist-tag 停在 3.2.7，仍依赖 `tinypool@^1.1.1`，没有兼容补丁。`npm audit` 给出的修复是 vitest 5.1.1，且 `isSemVerMajor: true`。更小的已修补发布是 vitest 4.1.12：直接依赖 `@vitest/mocker@4.1.12`，依赖列表里没有 tinypool。vite 被钉在已经在树上的 `^7.3.8`，没有为了审计建议升到 vite 8 或 vitest 5。

npm 10.9.9 在解析 vitest 4 的可选 peer 时会走到 `vitest@*`，再去取 `@vitest/browser-playwright@5.1.1`，然后在 arborist 的 `#loadPeerSet` 里崩溃（`edgesOut`）。普通 `npm install vitest@4.1.12` 因此失败了两次。生成锁文件改用一次 `npm install --save-dev vitest@4.1.12 vite@7.3.8 --legacy-peer-deps`。这个仓库不用 browser、UI、coverage 或 jsdom。

锁文件生成后，同一工作区删除 `node_modules` 再跑 `npm ci`，退出码 0，安装 150 个包。随后 `npm audit --json` 退出码 0，critical/high/moderate/low 都是 0。`npm ls` 是 `vite@7.3.8`、`vitest@4.1.12`、`@vitest/mocker@4.1.12`，没有 tinypool。`npm run check` 退出码 0：eslint、两套 tsc、vitest 7 个文件 28 个测试、构建都通过。`npm run demo` 退出码 0，`simulated: true`，`realE2E: false`。这仍不是真实 E2E。

## pstack 流程

加入可选 feature / bugfix / verify 之后，再次删除 `node_modules` 跑 `npm ci`，退出码 0。`npm audit --json` 退出码 0，四级计数都是 0。`npm run check` 退出码 0：8 个文件、33 个测试通过。`npm run demo` 退出码 0，四个场景都是 ok，`realE2E` 仍是 false。`workflow` 场景写明 fake adapter，没有接 Cursor 子代理、arena 或 automations。

## 回投与来源

2026-11-23 上午：`npm ci` 退出码 0，151 个包，audit 四级都是 0。`npm run check` 退出码 0：9 个文件、40 个测试。`npm run demo` 退出码 0，四个场景都是 ok，`realE2E` 仍是 false。

同日继续：outbox 故障测试覆盖 204 之后崩溃重放、断连、非 2xx、人工重试和 owner 隔离。投递是至少一次，接收端按稳定消息 id 去重，不是 exactly-once。Codex `account/rateLimits/read` 只解析 `usedPercent`，不生成 remaining，也不当作会话模型。`grok usage --json` 退出码 1 记为 `grok-usage-unavailable`，没有数字。`npm run check` 退出码 0：11 个文件、45 个测试。`npm audit --json` 退出码 0。当时的 Mac 脚本把 pane 前缀 `sbot-mac-` 当成 id，并把脚本自己塞入的回调和 takeover 的 summary 混在一次 dry-run 里。那次 `realE2E` 已是 false，但不能把 `planned` 或 stub 收包说成端到端。修正后 `npm run check` 退出码 0：12 个文件、47 个测试。`npm audit --json` 退出码 0。`SUPERBOT_MAC_E2E=1 node scripts/mac-e2e.mjs` 退出码 0，`realE2E` false，`observedLaunch` false，派工保持 `planned`，脚本注入的 callback 只把 claim 记成 done 而状态不变，`summaryDelivered` false。takeover 用的是夹具 id `term-fixture`，`handover` planned。live 不再要求 `sbot-mac-` 前缀；没有操作者给出的 hc pane id 就不接管。最新只读核对是 gbb 0.3.3 / hc 0.1.22。BAC 可执行文件名确定为小写 `bac`，子命令契约未到，没有新的 argv。

## 没派工的完成回调

cc41e3e 的 dry-run 报告 `claimStoredWhilePlanned: true`：状态停在 `planned`，但 `claim.status` 被写成 `done`。验收函数对 `planned` 直接返回，所以工单没有结束，request 的 summary 也没有投出。危险在于这条成功形状的 claim 留在派工上，后续如果只看 `claim.status` 就会把它当成已经执行。

Engine 现在只在状态已经是 `running` 时写入完成或失败 claim。`planned`、`pending`、`held` 上的 `done` / `idle` / `blocked` / `error` 返回 `not-dispatched`，不写 claim，并占用去重键。同一事件在后来变成 `running` 时是重复，不能补成成功。派工之后新的 `ts` 或 `event_id` 才算这次执行。没派工时提交的证据 `disposition` 是 `simulation`，不参与覆盖检查。错 owner、错 task、过期 head 仍不能验收。已经从 `running` 记下完成 claim、随后被 harness 标成 `blocked` 的步骤，仍可以判断下一条证据。这不是放行 dry-run。

`npm run check` 退出码 0：13 个文件、52 个测试。`npm audit --json` 退出码 0，四级都是 0。`npm run demo` 退出码 0，`simulated: true`，`realE2E: false`。fake adapter 仍会把派工走到 `running` 再收回调，汇总原文写明这是模拟路径。`SUPERBOT_MAC_E2E=1 node scripts/mac-e2e.mjs` 在重新构建 dist 之后退出码 0：`realE2E` false，派工 `planned`，`claim` null，`callbackRejected` `not-dispatched`，`evidenceDisposition` `simulation`，`claimStoredWhilePlanned` false，`summaryDelivered` false。这仍不是 Mac 上的真实执行。

## bac v1 消费方

契约冻结提交 `ae859908ed07684997c786d1744e5f724f087259`，父提交 `bbdfc4bbaece3ddafa3a9363b1d0f43b230aa5a6`。super-bot 改的是 argv、回调和接管消费方。没有实现 `bac`，没有在本机安装或切换，也没有把 fixture 或脚本注入的回调写成端到端。`acceptance.json` 的 `ran` 仍是 false。迁移后 `npm run check` 退出码 0：14 个文件、57 个测试。`npm audit --json` 的 critical/high/moderate/low 都是 0。`npm run demo` 退出码 0，`simulated: true`，`realE2E: false`。执行阶段的 pi 是 `kind_unsupported` / `rejected`，没有改写成 codex。

## 2026-11-24 实查

`origin/main` 是 `46216429a08b0f9115cbf4542048f22bef63eeb7`（合并 PR #1）。BAC 仓库 `main` 仍是 `4211de848dc82defd57b71a067c500f79340ace7`，`bin/` 只有 `gbb`。`bin/bac` 在分支 `cursor/bac-contract-v1-a131` 的 `ca89d297c1aa34dbdc367af7c5234da0f59c0ef4`，`identity.json` 的 `runtime_implemented` 为 true，未发布。该分支最新提交是 `ca89d297`「Make the generation lock portable and stop stealing a live holder」，其上是 `3f4e3c036170` 的 flock。锁是否已能安全并发，这次没有证明，所以没有 launch。

本机是 Linux `cursor` `6.12.113+` x86_64，时间 `2026-11-24T09:26:23Z`。PATH 上没有 `bac`、`gbb`、`hc`、`herdr`。把该提交的 `bin/bac` 放进 `/tmp/bac-probe-1795510000`，`HOME` 和 XDG 都指到这个临时目录后：

- `bac version` 退出码 0：`{"ok":true,"version":"1.0.0","contract":"bac.v1","source":"bot-as-collie"}`
- `bac capabilities` 退出码 0：codex/grok supported，pi/antigravity rejected
- `bac doctor` 退出码 0：`generation_lock` 为 `mkdir`，`herdr` 空，`hc` null，原因分别是 `herdr not on PATH`、`hc not on PATH`。没有写出 registry 文件。临时目录随后删除。

`node scripts/real-bac-preflight.mjs` 对同一个临时二进制退出码 0，`realE2E` false，`launched` false，缺口是 herdr、hc、`SUPERBOT_BOT_URL`，以及本命令本身不 launch。缺失二进制退出码 2。这不是端到端。

## 2026-11-24 开发机安装与一次真实 launch

官方安装，只写这台 Linux 开发机的 `/home/ubuntu`，没有改用户 Mac：

- `https://releases.herdr.dev/app/install.sh`：Herdr app `0.1.17`，同时装入 `hc 0.1.22` 到 `~/.local/bin/herdr-core`。`herdr-app --version` 与 `hc --version` 退出码都是 0。这是官方 app 加官方 core，不是替代品。PATH 上没有名为 `herdr` 的 TUI；`bac doctor` 因此把 `herdr_tui` 标成 `herdr not on PATH`。hc 模块 `probe_ok` 为 true。
- `https://x.ai/cli/install.sh`：Grok CLI `1.0.92` (`b06756fd6256`)。`~/.grok/auth.json` 不存在。没有读取或写入任何凭据。
- bac 取自分支 `ca89d297c1aa34dbdc367af7c5234da0f59c0ef4` 的 `bin/bac`，放到这台机器的 `~/.local/bin/bac`。没有改 BAC 仓库。

`hc server status` 退出码 0，`version` `0.1.22`，`pid` 8004。隔离会话：`hc run --json --bg --name sbot-probe -- /bin/sh -c 'echo sbot-isolated-ok; sleep 30'` 得到 `address` `t2`，`hc read` 打出 `sbot-isolated-ok`，随后 `hc kill` 与 `hc rm` 都成功，`hc ls` 为空。

一次串行 `bac launch`（`BAC_STATE_DIR` 与 `BAC_CONFIG` 都在 `/tmp/sbot-real-20261124T093839Z`，`--backend hc --kind grok --task sbot-e2e-1 --owner grok-bot`）退出码 0，正文是 `ok:false`，`state:startup_blocked`，`blocked_reason:auth`，`prompt_pending:true`，`pane_id:t1`。提示没有打进窗格。当时没有 webhook 监听，所以没有回调。`bac stop sbot-e2e-1 --owner grok-bot` 退出码 0：`workspace_closed:true`，`hc terminal killed and removed`，登记表 `panes` 为空。`hc ls --all` 为空。`realE2E` 仍是 false。

还缺两样，都不是“没有机器”：一个已登录的 Grok（`XAI_API_KEY` 或完成 `grok login`，本环境没有 auth 文件，也不会代签），以及 Bot 的 `SUPERBOT_BOT_URL`。没有这两样，终态回调到不了 SuperBot，也到不了用户的 Bot。

## 2026-11-24 17:33 UTC 读到 10e1d2b

附件 `grokbot-bridge-herdr-10e1d2b.tar.gz` 的 sha256 是 `36d70b540387a2cc7e23795d503a882407c1f825a6a9085d4544a894b3f0a180`，与清单一致。包内 HEAD 是 `10e1d2b7ce2d7bee71286b0a1d0672db4a551202`。只在 `/tmp/bac-10e1d2b-read` 解压读取，没有改包，没有跑它的测试。

`commands.json` 与仓库里钉着的 `ae859908` 副本没有差异，所以 launch、read、handover 的 argv 不改。`identity.json` 把 `runtime_implemented` 改为 true，`published` 仍是 false。`acceptance.json` 的 restart 场景是 `replay_undelivered: false`，投递描述是每个目标一次尝试、跨目标可能重复、重启不重放。消费方本来就按 `event_id` 去重，并且不会补造没收到的回调。`6e3eef3` 的 CI 单独核对为 success，不沿用 `f097330` 的结果。`realE2E` 仍是 false。没有重放 17:47 被终止的探针。

新增的本地 HTTP 回投测试覆盖：Bot POST `/v1/requests` 后 summary 被 POST 回 Bot URL、同一 id 不重复投、失败三次后 `failed`、重启后再投同一 id、错误 owner 不推进。takeover 测试核对授权范围和未知项不执行。`sbot facts` 的默认模型与额度 origin 是 unknown。操作者文件即使自称为 observed，也记成 config。dry-run 不 spawn；live 没有 `allowLive` 会拒绝；live 的 spawn `shell` 为 false，参数里没有 `-m`。这些都不是 Mac 上的 gbb/hc 端到端。

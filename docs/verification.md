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

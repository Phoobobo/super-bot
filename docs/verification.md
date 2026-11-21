# 验证记录

dry-run 只生成 gbb 参数。它不注册 pane，不读取终端，不是 E2E。`sbot demo` 使用 fake adapter，`simulated: true`，`realE2E: false`。

下面这次 `npm run check` 在提交验收修复之后的工作树上运行，退出码 0。

- eslint 通过。
- `tsc -p tsconfig.json --noEmit` 与 `tsc -p tsconfig.test.json --noEmit` 通过。
- vitest：6 个文件，27 个测试，全部通过。
- `tsc -p tsconfig.json` 构建通过。

`npx tsx src/cli.ts demo` 退出码 0。三个场景都是 ok。接管场景的原文写明快照还不是完成的接管，send 发生在模拟的 gbb handover 和 gbb read 之后。

尚未完成：真实 Mac 上的 gbb 0.3.3 / hc 0.1.21 E2E，以及向用户 bot webhook 的推送。inbox 只是本机拉取契约。

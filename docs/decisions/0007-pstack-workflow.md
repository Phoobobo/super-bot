# 0007 — 可选的 pstack 流程

日期：2026-11-21 · 状态：接受

## 来源

流程顺序来自 pstack `e58dd043600587dbaf58ba315e7f2b38373eeb43` 的 `playbooks/feature.md` 和 `bug-fix.md`。许可是 MIT，Copyright (c) 2026 Lauren Tan。没有把 pstack 树vendoring 进来。

dsh-superagent `8c32a9dc5d72c033816c6a8110b37f40cf94fba4` 仍是 Source → Mandate → Ticket 的边界。pstack 只决定一个已接受工单里的步骤、证据和返工，不另做调度器，也不另做用户入口。

## 取舍

- 默认 `off`。已有请求继续用阶段列表。
- 只做 feature、bugfix、verify。不做 arena、全栈 autopilot、benchmark 或新 UI。
- 步骤角色仍是设计 codex、执行 pi、验证 codex。能力不够就 blocked。
- Cursor 的 slash skill、子代理、automations 和模型面板不在这个宿主里，用 Engine 里的步骤和 gbb 派工代替。
- kickoff 验收在工单上冻住。返工上限也在开工时冻住。之后改偏好不取消在途工单，不放宽授权。

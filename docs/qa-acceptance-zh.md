# QA 验收报告：openvitals-v0.6

> 语言： [English](./qa-acceptance.md) | [简体中文](./qa-acceptance-zh.md)

这份报告跟踪 OpenVitals v0.6 硬件支撑 wedge 的自动化与人工验收状态。它刻意保持保守：只要没有人类提供真实设备 / 账号证据，硬件证据就必须保持 **pending**。

最后一次集成验证更新：2026-04-26。

注意：这份报告明确区分 **自动化仓库验证** 和 **人工硬件验证**。仓库级集成检查已经通过，但在有人给出真实设备 / 账号结果之前，硬件证据仍然是 pending。

## 当前验收状态

| 区域 | 状态 | 证据 |
| --- | --- | --- |
| 文档语义 | passed | README 和 quickstarts 已记录 provider payload、platform sample、summary、score、live signal、freshness、confidence、mirrored-source dedupe 以及 pending hardware gates。 |
| 生成文档 | passed | `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` 中 `pnpm docs:generate` 通过。 |
| Typecheck | passed | `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` 中 `pnpm typecheck` 通过。 |
| Unit / integration tests | passed | `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` 中 `pnpm test` 通过。 |
| Smoke E2E | passed | `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` 中 `pnpm smoke:e2e` 通过。 |
| Orchestrator verification | passed | `pnpm agent:workflow verify --run openvitals-v0.6` 接受了集成后的仓库，并写入 `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md`。 |
| Oura 人工硬件验证 | pending-hardware | 需要 Oura Ring / 账号证据；见 [硬件测试计划](./hardware-test-plan-zh.md)。 |
| WHOOP 人工硬件验证 | pending-hardware | 需要 WHOOP 设备 / 账号证据；见 [硬件测试计划](./hardware-test-plan-zh.md)。 |
| iPhone + Apple Watch HealthKit 人工验证 | pending-hardware | 需要 iPhone / Apple Watch 证据；见 [硬件测试计划](./hardware-test-plan-zh.md)。 |
| Mirrored Oura / WHOOP dedupe 人工验证 | pending-hardware | 需要 direct provider data 加 mirrored Apple Health 副本；见 [硬件测试计划](./hardware-test-plan-zh.md)。 |

## Worker 验证快照

| Worker / 来源 | 报告中的自动化状态 | 后续说明 |
| --- | --- | --- |
| 集成仓库 | `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` 中 `pnpm docs:generate`、`pnpm build`、`pnpm test`、`pnpm smoke:e2e` 和 `pnpm typecheck` 全部通过。 | 自动化验收已完成。 |
| worker-3 Phase 0 stabilization | 在 commit `b527043` 中报告 `pnpm test`、`pnpm build`、`pnpm smoke:e2e` 和 `pnpm typecheck` 通过。 | 已被最终集成验证覆盖。 |
| worker-6 docs / QA | 在 commit `e487cdae` 中报告 `pnpm docs:generate`、`pnpm build`、`pnpm typecheck` 和 `pnpm smoke:e2e` 通过；集成前的 `pnpm test` 仅因后来由 worker-3 修掉的 runtime bug 而失败。 | 已被最终集成验证覆盖。 |
| Hardware QA | agent 未执行。 | 需要按硬件矩阵由人类提供设备 / 账号证据。 |

## 必需的自动化命令

实现分支集成后，从仓库根目录运行：

```bash
pnpm docs:generate
pnpm typecheck
pnpm test
pnpm smoke:e2e
pnpm agent:workflow verify --run openvitals-v0.6
```

orchestrator verification 应把报告写到 `.agent-workflows/openvitals-v0.6/reports/`。如果失败，创建 iteration note，并以最小责任范围继续修复：

```bash
pnpm agent:workflow iterate --run openvitals-v0.6 --note "<failure summary and owner>"
```

## 硬件证据要求

人工证据至少要包含：

- 使用的硬件 / 账号；
- 时间戳；
- 执行的 app 动作或命令；
- 带 source、freshness、granularity 和 provenance 的 API / timeline 响应片段；
- 在适用时，带 stale / delayed / mirrored / incomplete 语义的 MCP / OpenClaw 响应片段；
- 任何已知限制或失败预期。

没有这些证据，不要把以下条目标为 passed：

1. Oura direct cloud sync。
2. WHOOP direct cloud sync。
3. iPhone HealthKit anchored upload。
4. Apple Watch historical HealthKit samples。
5. Apple Watch live workout HR session。
6. Oura mirrored into Apple Health dedupe。
7. WHOOP mirrored into Apple Health dedupe。
8. Android Health Connect smoke test（iOS 路径变绿后）。

## 实时 / 原始数据表述策略

允许的表述：

- “Apple Watch live workout heart-rate samples 在 workout collector session 活跃时可视为 live / near-real-time。”
- “Oura 通过 cloud sync 提供 provider-mediated 的 heart-rate samples 与 daily summaries / scores。”
- “WHOOP 通过 cloud sync 提供 provider-mediated 的 recovery、sleep、workout、strain/load、HRV、resting-HR 和 HR-zone 数据。”
- “OpenVitals 保留 provider payload 和 platform sample，并在其上推导 normalized episode、summary 和 score。”

在未来代码和硬件证据证明之前，禁止的表述：

- “Oura continuous raw sensor stream。”
- “WHOOP continuous raw HR stream。”
- 把 delayed cloud sync 或 stale platform upload 说成 “real-time monitoring”。
- 在没有上面人工硬件证据条目的前提下宣称 “hardware-backed complete”。

## 最终报告模板

发布或 PR 交接时，使用下面这个结构：

```markdown
## Changed files
- ...

## Automated verification
- `pnpm docs:generate` — PASS/FAIL, excerpt/path
- `pnpm typecheck` — PASS/FAIL, excerpt/path
- `pnpm test` — PASS/FAIL, excerpt/path
- `pnpm smoke:e2e` — PASS/FAIL, excerpt/path
- `pnpm agent:workflow verify --run openvitals-v0.6` — PASS/FAIL, report path

## Hardware evidence
- Oura direct cloud connector — PASS/PENDING/FAIL, evidence
- WHOOP direct cloud connector — PASS/PENDING/FAIL, evidence
- iPhone HealthKit collector — PASS/PENDING/FAIL, evidence
- Apple Watch historical samples — PASS/PENDING/FAIL, evidence
- Apple Watch live workout HR — PASS/PENDING/FAIL, evidence
- Mirrored Oura dedupe — PASS/PENDING/FAIL, evidence
- Mirrored WHOOP dedupe — PASS/PENDING/FAIL, evidence
- Android Health Connect smoke — PASS/PENDING/FAIL, evidence

## Remaining limitations
- ...

## Follow-up issues
- ...
```

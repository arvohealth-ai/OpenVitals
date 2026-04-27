# Agent 编排器

> 语言： [English](./agent-orchestrator.md) | [简体中文](./agent-orchestrator-zh.md)

这个仓库内置了一套首版 agent 工作流执行器，适合需要规划、任务分发、隔离开发、验证和迭代的大任务。

这套流程把 GitHub 继续作为 Issue、PR、CI 和 code review 的事实来源。本地执行时，每个 worker 使用一个独立 git worktree，这样多个 Codex / OMX worker 可以并行工作而不会互相覆盖。

## 启动一次运行

```bash
pnpm agent:workflow start --task "在这里写总任务描述"
```

如果任务描述很长，建议放进 Markdown 文件：

```bash
pnpm agent:workflow start --description-file docs/agent-tasks/openvitals-v0.6.md
```

这会生成：

- `.agent-workflows/<run-id>/manifest.json`
- `.agent-workflows/<run-id>/plan.md`
- `.agent-workflows/<run-id>/worker-prompts/*.md`
- `.agent-workflows/<run-id>/reports/`

如果你想立即创建 worktree：

```bash
pnpm agent:workflow start --task "在这里写总任务描述" --dispatch
```

## 分发 worker

```bash
pnpm agent:workflow dispatch --run <run-id>
```

分发器会创建类似下面的 branch 和 worktree：

```text
codex/<run-id>-api-runtime
../OpenVitals-worktrees/<run-id>-api-runtime
```

每份 worker prompt 都包含父目标、负责路径、branch、worktree、验收标准和完成信号。

## 配合 OMX 使用

在仓库根目录打开一个 OMX leader session：

```bash
omx --madmax --high
```

然后使用刚生成的 plan 和 prompts：

```bash
$ralplan "Review and approve .agent-workflows/<run-id>/plan.md"
$team 3:executor "Execute the approved plan using the worker prompts under .agent-workflows/<run-id>/worker-prompts"
```

如果你想要更严格的隔离，可以让每个 worker 直接指向 prompt 里分配给它的 worktree。

## 用 OMX Team 自动化

先生成一个可复用的 OMX team prompt 和启动配置：

```bash
pnpm agent:workflow omx-plan --run openvitals-v0.6 --phase phase0 --workers 6
```

也可以固定模型和 reasoning effort：

```bash
pnpm agent:workflow omx-plan --run openvitals-v0.6 --phase phase0 --workers 6 --model gpt-5.5 --reasoning xhigh
```

启动 team：

```bash
pnpm agent:workflow omx-run --run openvitals-v0.6 --phase phase0 --workers 6 --model gpt-5.5 --reasoning xhigh --start
```

对于带硬件验收的大版本，建议先从 `--phase phase0` 开始。后续 phase 可能包含人工硬件 gate，agent 不应该在没有用户证据的情况下把它标记为完成。

如果你想尝试跑完所有可自动化阶段，同时保留人工硬件 gate：

```bash
pnpm agent:workflow omx-run --run openvitals-v0.6 --phase all --workers 7 --model gpt-5.5 --reasoning xhigh --start
```

## 验证

集成完 worker 变更后，执行：

```bash
pnpm agent:workflow verify --run <run-id>
```

即便是在 detached 的 worker worktree 里，这个命令也能工作。脚本会先在当前 worktree 查找 `.agent-workflows/`，找不到时再回退到共享 git 仓库根目录（或者 `OPENVITALS_AGENT_WORKFLOW_ROOT`），这样验证报告仍然会写回 orchestrator 的运行目录。

验证会执行：

- `pnpm docs:generate`
- `pnpm build`
- `pnpm test`
- `pnpm smoke:e2e`
- `pnpm typecheck`

报告会写入 `.agent-workflows/<run-id>/reports/`。

## 迭代

如果验证失败：

```bash
pnpm agent:workflow iterate --run <run-id> --note "修复失败的 API contract 测试"
```

这会推进一次 iteration，并写出 `.agent-workflows/<run-id>/iteration.md`。把相关失败片段回传给负责的 worker，集成修复后再次运行验证。

只有在下面这些条件都满足时，这个工作流才算真正完成：

- 验证通过；
- 生成文档是最新的；
- 人工硬件 gate 明确通过，或带着证据要求被标为 pending；
- 最终 PR 被人类维护者接受。

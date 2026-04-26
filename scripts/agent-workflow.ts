import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

type WorkflowStatus =
  | "planned"
  | "dispatched"
  | "in_progress"
  | "omx_ready"
  | "omx_running"
  | "verification_failed"
  | "accepted";

type AgentTaskStatus =
  | "planned"
  | "dispatched"
  | "in_progress"
  | "blocked"
  | "ready_for_review"
  | "accepted";

type AgentTask = {
  id: string;
  title: string;
  scope: string;
  agent: string;
  branch: string;
  worktree: string;
  status: AgentTaskStatus;
  paths: string[];
  acceptance: string[];
  promptPath: string;
};

type WorkflowRun = {
  id: string;
  objective: string;
  createdAt: string;
  updatedAt: string;
  iteration: number;
  status: WorkflowStatus;
  repoRoot: string;
  worktreeRoot: string;
  tasks: AgentTask[];
  verificationCommands: string[];
  history: Array<{
    at: string;
    event: string;
    details?: string;
  }>;
};

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const localStateRoot = join(repoRoot, ".agent-workflows");
const stateRoot = resolveWorkflowStateRoot();
const defaultWorktreeRoot = resolve(repoRoot, "..", `${basename(repoRoot)}-worktrees`);

const verificationCommands = [
  "pnpm docs:generate",
  "pnpm build",
  "pnpm test",
  "pnpm smoke:e2e",
  "pnpm typecheck",
];

function resolveWorkflowStateRoot() {
  const configured = process.env.OPENVITALS_AGENT_WORKFLOW_ROOT;
  if (configured) {
    return resolve(configured);
  }

  if (existsSync(localStateRoot)) {
    return localStateRoot;
  }

  const gitCommonDir = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (gitCommonDir.status === 0) {
    const commonDir = gitCommonDir.stdout.trim();
    const sharedStateRoot = join(dirname(commonDir), ".agent-workflows");
    if (commonDir && existsSync(sharedStateRoot)) {
      return sharedStateRoot;
    }
  }

  return localStateRoot;
}

const scopeDefinitions: Array<{
  scope: string;
  agent: string;
  keywords: string[];
  paths: string[];
  title: string;
  acceptance: string[];
}> = [
  {
    scope: "api-runtime",
    agent: "backend-runtime-agent",
    keywords: ["api", "backend", "runtime", "contract", "drizzle", "sqlite", "auth", "oauth", "webhook", "sse"],
    paths: ["apps/api", "packages/runtime", "packages/contracts", "packages/scores"],
    title: "Implement API/runtime changes",
    acceptance: [
      "Contract shape remains backward-compatible unless the parent task explicitly requires a breaking change.",
      "Runtime behavior is covered by focused unit tests or smoke coverage.",
      "Auth, provenance, and explainability behavior are preserved.",
    ],
  },
  {
    scope: "dashboard",
    agent: "frontend-agent",
    keywords: ["dashboard", "frontend", "ui", "screen", "page", "playground", "browser", "visual"],
    paths: ["apps/dashboard", "apps/devplayground"],
    title: "Implement dashboard/playground changes",
    acceptance: [
      "UI states are complete for loading, empty, error, and normal paths where applicable.",
      "The implementation follows existing dashboard patterns and avoids unrelated styling churn.",
      "Manual or automated browser verification is documented in the worker report.",
    ],
  },
  {
    scope: "providers",
    agent: "provider-agent",
    keywords: ["provider", "whoop", "oura", "garmin", "strava", "apple", "health connect", "fitbit", "withings", "collector"],
    paths: ["providers", "packages/collector-mobile-core", "packages/collector-ios", "packages/collector-android", "packages/collector-flutter", "packages/collector-rn"],
    title: "Implement provider or collector changes",
    acceptance: [
      "Raw payload preservation, normalized records, provenance, and dedupe behavior are explicit.",
      "Provider-specific tests cover success, stale/expired credentials, and failure handling where relevant.",
      "Live-mode behavior remains opt-in and does not weaken demo-mode determinism.",
    ],
  },
  {
    scope: "ios-watch-collector",
    agent: "mobile-ios-agent",
    keywords: ["iphone", "apple watch", "watch", "healthkit", "hkworkoutsession", "hkliveworkoutbuilder", "ios", "swift"],
    paths: ["examples/mobile-ios-minimal-app", "examples/mobile-ios-reference", "packages/collector-ios", "providers/apple-health"],
    title: "Implement iPhone and Apple Watch collector changes",
    acceptance: [
      "HealthKit authorization, anchored query state, source revision metadata, and upload payload semantics are explicit.",
      "Apple Watch live workout heart-rate samples are marked as live signals, not generic provider payloads.",
      "The implementation includes a documented manual hardware test path for iPhone and Apple Watch.",
    ],
  },
  {
    scope: "sdk-mcp-agent-adapters",
    agent: "sdk-mcp-agent",
    keywords: ["sdk", "mcp", "openclaw", "agent", "tool", "python", "typescript", "webhook"],
    paths: ["packages/sdk-ts", "packages/sdk-py", "packages/mcp", "packages/openclaw-skill", "packages/openclaw-workspace-recovery", "packages/export-fhir", "packages/export-omh"],
    title: "Implement SDK/MCP/agent adapter changes",
    acceptance: [
      "Tool and SDK request/response contracts are documented through tests or examples.",
      "Agent-token scope behavior is preserved and covered by verification where applicable.",
      "Generated docs are refreshed if exported surfaces change.",
    ],
  },
  {
    scope: "docs",
    agent: "docs-agent",
    keywords: ["doc", "readme", "quickstart", "guide", "documentation", "docs"],
    paths: ["README.md", "docs", "examples"],
    title: "Update documentation and examples",
    acceptance: [
      "Docs match the implemented behavior and commands in this repository.",
      "Generated docs are produced through pnpm docs:generate rather than hand-edited.",
      "Examples remain runnable with the documented quickstart path.",
    ],
  },
];

function main() {
  const [command = "help", ...rest] = process.argv.slice(2);

  if (command === "start") {
    start(rest);
    return;
  }

  if (command === "dispatch") {
    dispatch(rest);
    return;
  }

  if (command === "status") {
    status(rest);
    return;
  }

  if (command === "verify") {
    verify(rest);
    return;
  }

  if (command === "iterate") {
    iterate(rest);
    return;
  }

  if (command === "omx-plan") {
    omxPlan(rest);
    return;
  }

  if (command === "omx-run") {
    omxRun(rest);
    return;
  }

  printHelp();
}

function start(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      task: { type: "string" },
      "task-file": { type: "string" },
      "description-file": { type: "string" },
      id: { type: "string" },
      "worktree-root": { type: "string" },
      dispatch: { type: "boolean", default: false },
    },
  });

  const objective = readObjective(values.task, values["description-file"] ?? values["task-file"]);
  const id = values.id ?? createRunId(objective);
  const runDir = join(stateRoot, id);

  if (existsSync(runDir)) {
    throw new Error(`Workflow run already exists: ${runDir}`);
  }

  mkdirSync(join(runDir, "worker-prompts"), { recursive: true });
  mkdirSync(join(runDir, "reports"), { recursive: true });

  const worktreeRoot = resolve(String(values["worktree-root"] ?? defaultWorktreeRoot));
  const tasks = createTasks(objective, id, worktreeRoot);
  const run: WorkflowRun = {
    id,
    objective,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    iteration: 0,
    status: "planned",
    repoRoot,
    worktreeRoot,
    tasks,
    verificationCommands,
    history: [{ at: new Date().toISOString(), event: "planned" }],
  };

  writeWorkflowFiles(runDir, run);
  saveRun(runDir, run);

  if (values.dispatch) {
    dispatch(["--run", id]);
    return;
  }

  print(`Created workflow run ${id}`);
  print(`Plan: ${join(runDir, "plan.md")}`);
  print(`Next: pnpm agent:workflow dispatch --run ${id}`);
}

function dispatch(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      "skip-worktrees": { type: "boolean", default: false },
    },
  });

  const { run, runDir } = loadRun(values.run);
  mkdirSync(run.worktreeRoot, { recursive: true });

  for (const task of run.tasks) {
    if (!values["skip-worktrees"]) {
      ensureWorktree(task.branch, task.worktree);
    }
    task.status = "dispatched";
  }

  run.status = "dispatched";
  run.updatedAt = new Date().toISOString();
  run.history.push({
    at: new Date().toISOString(),
    event: "dispatched",
    details: values["skip-worktrees"] ? "Skipped worktree creation." : "Created or reused task worktrees.",
  });

  saveRun(runDir, run);
  writeWorkflowFiles(runDir, run);
  print(`Dispatched workflow run ${run.id}`);
  print(`Worker prompts: ${join(runDir, "worker-prompts")}`);
}

function status(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
    },
  });

  const { run } = loadRun(values.run);
  const lines = [
    `# Agent Workflow Status: ${run.id}`,
    "",
    `- Status: ${run.status}`,
    `- Iteration: ${run.iteration}`,
    `- Objective: ${truncate(oneLine(run.objective), 220)}`,
    "",
    "| Task | Scope | Agent | Status | Branch | Worktree |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const task of run.tasks) {
    lines.push(
      `| ${task.id} | ${task.scope} | ${task.agent} | ${task.status} | ${task.branch} | ${task.worktree} |`,
    );
  }

  print(lines.join("\n"));
}

function verify(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      "continue-on-error": { type: "boolean", default: true },
    },
  });

  const { run, runDir } = loadRun(values.run);
  const reportPath = join(runDir, "reports", `verify-iteration-${run.iteration}.md`);
  const report: string[] = [
    `# Verification Report`,
    "",
    `- Run: ${run.id}`,
    `- Iteration: ${run.iteration}`,
    `- Started: ${new Date().toISOString()}`,
    "",
  ];

  let failed = false;
  for (const command of verificationCommandsForRun(run)) {
    report.push(`## ${command}`, "");
    const result = spawnSync(command, {
      cwd: repoRoot,
      shell: true,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
    });
    report.push("```text");
    report.push(result.stdout.trim());
    if (result.stderr.trim()) {
      report.push(result.stderr.trim());
    }
    report.push("```", "");
    report.push(`Exit code: ${result.status ?? 1}`, "");

    if (result.status !== 0) {
      failed = true;
      if (!values["continue-on-error"]) {
        break;
      }
    }
  }

  run.status = failed ? "verification_failed" : "accepted";
  run.updatedAt = new Date().toISOString();
  run.history.push({
    at: new Date().toISOString(),
    event: failed ? "verification_failed" : "accepted",
    details: reportPath,
  });

  report.push(`Completed: ${new Date().toISOString()}`);
  report.push(`Result: ${failed ? "failed" : "accepted"}`);
  writeFileSync(reportPath, report.join("\n"));
  saveRun(runDir, run);

  print(`Verification ${failed ? "failed" : "passed"}: ${reportPath}`);
  if (failed) {
    print(`Next: pnpm agent:workflow iterate --run ${run.id}`);
    process.exitCode = 1;
  }
}

function iterate(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      note: { type: "string" },
    },
  });

  const { run, runDir } = loadRun(values.run);
  run.iteration += 1;
  run.status = "in_progress";
  run.updatedAt = new Date().toISOString();
  run.history.push({
    at: new Date().toISOString(),
    event: "iteration_started",
    details: values.note,
  });

  writeIterationPrompt(runDir, run, values.note);
  saveRun(runDir, run);
  writeWorkflowFiles(runDir, run);

  print(`Prepared iteration ${run.iteration} for ${run.id}`);
  print(`Iteration prompt: ${join(runDir, "iteration.md")}`);
}

function omxPlan(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      phase: { type: "string", default: "phase0" },
      workers: { type: "string", default: "4" },
      model: { type: "string" },
      reasoning: { type: "string" },
    },
  });

  const { run, runDir } = loadRun(values.run);
  writeOmxFiles(runDir, run, {
    phase: String(values.phase),
    workers: Number(values.workers),
    model: values.model,
    reasoning: values.reasoning,
  });

  run.status = "omx_ready";
  run.updatedAt = new Date().toISOString();
  run.history.push({
    at: new Date().toISOString(),
    event: "omx_ready",
    details: `phase=${values.phase}; workers=${values.workers}; model=${values.model ?? "default"}; reasoning=${values.reasoning ?? "default"}`,
  });
  saveRun(runDir, run);

  print(`Prepared OMX team prompt for ${run.id}`);
  print(`Prompt: ${join(runDir, "omx-team-prompt.md")}`);
  print(`Launcher: ${join(runDir, "run-omx-team.sh")}`);
  print(`Start: ${renderOmxRunCommand(run.id, String(values.phase), Number(values.workers), values.model, values.reasoning, true)}`);
}

function omxRun(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      phase: { type: "string", default: "phase0" },
      workers: { type: "string", default: "4" },
      model: { type: "string" },
      reasoning: { type: "string" },
      start: { type: "boolean", default: false },
      "skip-dispatch": { type: "boolean", default: false },
    },
  });

  const { run, runDir } = loadRun(values.run);
  if (!values["skip-dispatch"] && run.status === "planned") {
    dispatch(["--run", run.id]);
  }

  const reloaded = loadRun(run.id);
  const omxOptions = {
    phase: String(values.phase),
    workers: Number(values.workers),
    model: values.model,
    reasoning: values.reasoning,
  };
  writeOmxFiles(reloaded.runDir, reloaded.run, omxOptions);

  if (!values.start) {
    print(`Prepared OMX automation for ${run.id}.`);
    print(`Review: ${join(runDir, "omx-team-prompt.md")}`);
    print(`Run: ${renderOmxRunCommand(run.id, String(values.phase), Number(values.workers), values.model, values.reasoning, true)}`);
    return;
  }

  const promptPath = join(reloaded.runDir, "omx-team-prompt.md");
  const prompt = readFileSync(promptPath, "utf8");
  const result = spawnSync("omx", ["team", `${omxOptions.workers}:executor`, prompt], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
    env: {
      ...process.env,
      ...omxWorkerLaunchEnv(omxOptions),
    },
  });

  const outputPath = join(reloaded.runDir, "reports", `omx-team-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  writeFileSync(outputPath, `${result.stdout ?? ""}${result.stderr ?? ""}`);

  reloaded.run.status = result.status === 0 ? "omx_running" : "verification_failed";
  reloaded.run.updatedAt = new Date().toISOString();
  reloaded.run.history.push({
    at: new Date().toISOString(),
    event: result.status === 0 ? "omx_team_started" : "omx_team_failed",
    details: outputPath,
  });
  saveRun(reloaded.runDir, reloaded.run);

  print(result.stdout.trim());
  if (result.stderr.trim()) {
    print(result.stderr.trim());
  }
  print(`OMX team log: ${outputPath}`);
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}

function createTasks(objective: string, runId: string, worktreeRoot: string): AgentTask[] {
  const normalized = objective.toLowerCase();
  const selected = scopeDefinitions.filter((definition) =>
    definition.keywords.some((keyword) => normalized.includes(keyword)),
  );
  const scopes = selected.length > 0 ? selected : scopeDefinitions.slice(0, 4);
  const withQa = [
    ...scopes,
    {
      scope: "qa-acceptance",
      agent: "qa-agent",
      keywords: [],
      paths: ["scripts", ".github/workflows", "docs"],
      title: "Verify and accept the integrated change",
      acceptance: [
        "Run the full repository verification command set.",
        "Summarize residual risk, failed checks, and required follow-up issues.",
        "Do not mark the workflow accepted until all required checks pass or a human explicitly waives them.",
      ],
    },
  ];

  return withQa.map((definition, index) => {
    const id = `T${String(index + 1).padStart(2, "0")}-${definition.scope}`;
    const branch = `codex/${runId}-${definition.scope}`;
    const worktree = join(worktreeRoot, `${runId}-${definition.scope}`);
    return {
      id,
      title: definition.title,
      scope: definition.scope,
      agent: definition.agent,
      branch,
      worktree,
      status: "planned",
      paths: definition.paths,
      acceptance: definition.acceptance,
      promptPath: join(".agent-workflows", runId, "worker-prompts", `${id}.md`),
    };
  });
}

function writeWorkflowFiles(runDir: string, run: WorkflowRun) {
  writeFileSync(join(runDir, "task.md"), `# Parent Task\n\n${run.objective.trim()}\n`);
  writeFileSync(join(runDir, "plan.md"), renderPlan(run));

  for (const task of run.tasks) {
    const promptPath = join(runDir, "worker-prompts", basename(task.promptPath));
    mkdirSync(dirname(promptPath), { recursive: true });
    writeFileSync(promptPath, renderWorkerPrompt(run, task));
  }
}

function renderPlan(run: WorkflowRun) {
  return [
    `# Agent Delivery Plan: ${run.id}`,
    "",
    `## Objective`,
    "",
    run.objective.trim(),
    "",
    `## Operating Model`,
    "",
    "1. Keep GitHub Issues, PRs, CI, and human review as the source of truth.",
    "2. Use one branch and one worktree per task.",
    "3. Workers only edit files in their assigned scope unless the prompt explicitly expands ownership.",
    "4. The orchestrator verifies integration after workers report ready.",
    "5. If verification fails, run `iterate` and send the generated iteration prompt back to the relevant workers.",
    "",
    `## Tasks`,
    "",
    "| ID | Scope | Agent | Branch | Worktree | Owned paths |",
    "| --- | --- | --- | --- | --- | --- |",
    ...run.tasks.map((task) =>
      `| ${task.id} | ${task.scope} | ${task.agent} | ${task.branch} | ${task.worktree} | ${task.paths.join(", ")} |`,
    ),
    "",
    `## Verification Commands`,
    "",
    ...verificationCommandsForRun(run).map((command) => `- \`${command}\``),
    "",
    `## OMX Handoff`,
    "",
    "Use these prompts manually inside an OMX leader session, or dispatch workers with equivalent commands:",
    "",
    "```bash",
    ...run.tasks
      .filter((task) => task.scope !== "qa-acceptance")
      .map((task) => `omx team 1:executor "$(cat ${task.promptPath})"`),
    "```",
    "",
  ].join("\n");
}

function renderWorkerPrompt(run: WorkflowRun, task: AgentTask) {
  return [
    `# Worker Task: ${task.id}`,
    "",
    `You are ${task.agent}. You are not alone in the codebase. Other agents may be working in sibling worktrees and branches. Do not revert edits made by others; adjust your implementation to accommodate them.`,
    "",
    `## Parent Objective`,
    "",
    run.objective.trim(),
    "",
    `## Assignment`,
    "",
    `- Scope: ${task.scope}`,
    `- Branch: ${task.branch}`,
    `- Worktree: ${task.worktree}`,
    `- Owned paths: ${task.paths.join(", ")}`,
    "",
    `## Required Acceptance`,
    "",
    ...task.acceptance.map((item) => `- ${item}`),
    "",
    `## Local Workflow`,
    "",
    "1. Read the parent plan and relevant code before editing.",
    "2. Keep changes scoped to the owned paths unless the parent task cannot be completed otherwise.",
    "3. Add or update focused tests for changed behavior.",
    "4. Run the narrowest useful checks first, then run broader checks if your scope affects shared contracts.",
    "5. Write a short worker report with changed files, checks run, and unresolved risks.",
    "",
    `## Done Signal`,
    "",
    `When complete, report: ${task.id} ready_for_review, changed files, tests run, and any integration concerns.`,
    "",
  ].join("\n");
}

function writeOmxFiles(
  runDir: string,
  run: WorkflowRun,
  options: { phase: string; workers: number; model?: string; reasoning?: string },
) {
  const prompt = renderOmxTeamPrompt(run, options.phase, options);
  const promptPath = join(runDir, "omx-team-prompt.md");
  const scriptPath = join(runDir, "run-omx-team.sh");
  writeFileSync(promptPath, prompt);
  writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `cd ${JSON.stringify(repoRoot)}`,
      ...renderOmxWorkerLaunchEnvLines(options),
      `${shellQuoteCommand(["omx", "team", `${options.workers}:executor`])} "$(cat ${JSON.stringify(promptPath)})"`,
      "",
    ].join("\n"),
  );
  chmodSync(scriptPath, 0o755);
}

function renderOmxTeamPrompt(run: WorkflowRun, phase: string, options: { model?: string; reasoning?: string }) {
  const activeTasks = run.tasks.filter((task) => task.scope !== "qa-acceptance");
  const phaseInstruction =
    phase === "all"
      ? "Execute all automatable phases, but do not claim manual hardware tests are complete without user-provided evidence."
      : phase === "phase0"
        ? "Execute Phase 0 only: stabilize the repository, make automated checks green, and stop before feature expansion."
        : `Execute only ${phase}. Keep other phases as context and do not drift into unrelated work.`;

  return [
    `# OMX Team Run: ${run.id}`,
    "",
    "You are an OMX team operating inside this repository. Work like a disciplined engineering team with a leader, scoped workers, integration review, and verification.",
    "",
    `## Run Mode`,
    "",
    phaseInstruction,
    "",
    `- Requested model: ${options.model ?? "OMX/Codex default"}`,
    `- Requested reasoning: ${options.reasoning ?? "OMX/Codex default"}`,
    "",
    "Manual hardware evidence is required for Oura, WHOOP, iPhone, and Apple Watch acceptance. If hardware access is unavailable, implement the software path, document the exact manual test, and mark hardware verification as pending rather than passed.",
    "",
    "Do not commit or remove unrelated vendor/demo entries. Keep edits scoped to the assigned paths and preserve the existing API/runtime/MCP/OpenClaw structure.",
    "",
    `## Parent Brief`,
    "",
    run.objective.trim(),
    "",
    `## Worker Assignments`,
    "",
    ...activeTasks.flatMap((task) => [
      `### ${task.id}: ${task.title}`,
      "",
      `- Agent role: ${task.agent}`,
      `- Scope: ${task.scope}`,
      `- Branch: ${task.branch}`,
      `- Worktree: ${task.worktree}`,
      `- Owned paths: ${task.paths.join(", ")}`,
      `- Prompt file: ${task.promptPath}`,
      "",
      "Acceptance:",
      ...task.acceptance.map((item) => `- ${item}`),
      "",
    ]),
    `## Required Loop`,
    "",
    "1. Read `AGENTS.md`, this prompt, and `.agent-workflows/" + run.id + "/plan.md`.",
    "2. Assign each worker to the smallest relevant scope and avoid overlapping edits.",
    "3. Start with failing checks and Phase 0 stabilization before feature work.",
    "4. Run narrow checks in worker scopes, then integrate and run repository verification.",
    "5. Use `pnpm agent:workflow verify --run " + run.id + "` for the orchestrator verification report.",
    "6. If verification fails, create an iteration note with `pnpm agent:workflow iterate --run " + run.id + " --note \"...\"` and continue.",
    "7. Stop with a concise final report: changed files, tests run, hardware evidence status, remaining limitations, and follow-up issues.",
    "",
    `## Verification Commands`,
    "",
    ...verificationCommandsForRun(run).map((command) => `- \`${command}\``),
    "",
  ].join("\n");
}

function verificationCommandsForRun(run: WorkflowRun) {
  return run.verificationCommands.includes("pnpm docs:generate")
    ? run.verificationCommands
    : ["pnpm docs:generate", ...run.verificationCommands];
}

function omxWorkerLaunchArgs(options: { model?: string; reasoning?: string }) {
  const args: string[] = [];
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.reasoning) {
    const normalized = options.reasoning.toLowerCase();
    if (normalized === "high" || normalized === "hi" || normalized === "hi-x") {
      args.push("-c", "model_reasoning_effort=\"high\"");
    } else if (normalized === "xhigh" || normalized === "x-high" || normalized === "extra-high") {
      args.push("-c", "model_reasoning_effort=\"xhigh\"");
    } else {
      args.push("-c", `model_reasoning_effort=${JSON.stringify(options.reasoning)}`);
    }
  }
  return args;
}

function omxWorkerLaunchEnv(options: { model?: string; reasoning?: string }) {
  const args = omxWorkerLaunchArgs(options);
  return args.length > 0 ? { OMX_TEAM_WORKER_LAUNCH_ARGS: joinOmxWorkerLaunchArgs(args) } : {};
}

function renderOmxWorkerLaunchEnvLines(options: { model?: string; reasoning?: string }) {
  const args = omxWorkerLaunchArgs(options);
  if (args.length === 0) {
    return [];
  }
  return [`export OMX_TEAM_WORKER_LAUNCH_ARGS=${JSON.stringify(joinOmxWorkerLaunchArgs(args))}`];
}

function joinOmxWorkerLaunchArgs(args: string[]) {
  return args.join(" ");
}

function renderOmxRunCommand(runId: string, phase: string, workers: number, model?: string, reasoning?: string, start = false) {
  return shellQuoteCommand([
    "pnpm",
    "agent:workflow",
    "omx-run",
    "--run",
    runId,
    "--phase",
    phase,
    "--workers",
    String(workers),
    ...(model ? ["--model", model] : []),
    ...(reasoning ? ["--reasoning", reasoning] : []),
    ...(start ? ["--start"] : []),
  ]);
}

function shellQuoteCommand(parts: string[]) {
  return parts.map((part) => (part.length > 0 && /^[a-zA-Z0-9_./:=+-]+$/.test(part) ? part : `'${part.replace(/'/g, "'\\''")}'`)).join(" ");
}

function writeIterationPrompt(runDir: string, run: WorkflowRun, note?: string) {
  const latestReport = join(runDir, "reports", `verify-iteration-${run.iteration - 1}.md`);
  const lines = [
    `# Iteration ${run.iteration}: ${run.id}`,
    "",
    `## Objective`,
    "",
    run.objective.trim(),
    "",
    `## Latest Verification Report`,
    "",
    existsSync(latestReport) ? latestReport : "No verification report found.",
    "",
    `## Operator Note`,
    "",
    note ?? "Inspect the latest failed verification report, assign failures to the smallest responsible worker scope, and rerun checks after fixes.",
    "",
    `## Expected Loop`,
    "",
    "1. Identify which worker scope owns each failure.",
    "2. Send the relevant worker prompt plus the failure excerpt.",
    "3. Merge or cherry-pick accepted worker changes into the integration branch.",
    "4. Run `pnpm agent:workflow verify --run " + run.id + "` again.",
    "5. Repeat until verification passes or a human explicitly changes acceptance criteria.",
    "",
  ];
  writeFileSync(join(runDir, "iteration.md"), lines.join("\n"));
}

function ensureWorktree(branch: string, worktree: string) {
  if (existsSync(worktree)) {
    return;
  }

  const branchExists = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
    cwd: repoRoot,
  }).status === 0;
  const args = branchExists
    ? ["worktree", "add", worktree, branch]
    : ["worktree", "add", "-b", branch, worktree, "HEAD"];
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`Failed to create worktree for ${branch}:\n${result.stderr || result.stdout}`);
  }
}

function readObjective(task?: string, taskFile?: string) {
  if (taskFile) {
    return readFileSync(resolve(repoRoot, taskFile), "utf8").trim();
  }
  if (task) {
    return task.trim();
  }
  throw new Error("Provide --task, --task-file, or --description-file.");
}

function createRunId(objective: string) {
  const slug = objective
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    || "agent-task";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `${stamp}-${slug}`;
}

function loadRun(id?: string) {
  const runId = id ?? latestRunId();
  if (!runId) {
    throw new Error("No workflow run found. Start one with pnpm agent:workflow start --task \"...\".");
  }
  const runDir = join(stateRoot, runId);
  const manifestPath = join(runDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Workflow manifest not found: ${manifestPath}`);
  }
  return {
    run: JSON.parse(readFileSync(manifestPath, "utf8")) as WorkflowRun,
    runDir,
  };
}

function latestRunId() {
  if (!existsSync(stateRoot)) {
    return undefined;
  }
  const result = spawnSync("find", [stateRoot, "-mindepth", "1", "-maxdepth", "1", "-type", "d"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((path) => basename(path))
    .sort()
    .at(-1);
}

function saveRun(runDir: string, run: WorkflowRun) {
  writeFileSync(join(runDir, "manifest.json"), `${JSON.stringify(run, null, 2)}\n`);
}

function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function print(message: string) {
  process.stdout.write(`${message}\n`);
}

function printHelp() {
  print(`Agent workflow orchestrator

Usage:
  pnpm agent:workflow start --task "Implement ..."
  pnpm agent:workflow start --description-file docs/agent-tasks/example.md
  pnpm agent:workflow dispatch --run <run-id>
  pnpm agent:workflow status --run <run-id>
  pnpm agent:workflow verify --run <run-id>
  pnpm agent:workflow iterate --run <run-id> --note "Fix failing API tests"
  pnpm agent:workflow omx-plan --run <run-id> --phase phase0 --workers 4 --model gpt-5.5 --reasoning xhigh
  pnpm agent:workflow omx-run --run <run-id> --phase phase0 --workers 4 --model gpt-5.5 --reasoning xhigh --start

The start command creates .agent-workflows/<run-id>/ with a plan, worker prompts,
and a manifest. Dispatch creates one git worktree per task unless --skip-worktrees
is provided.`);
}

main();

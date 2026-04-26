#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const openClawDir = path.join(repoRoot, "vendor", "openclaw");
const openClawCli = path.join(openClawDir, "openclaw.mjs");
const e2eDir = path.join(repoRoot, ".agent-workflows", "openclaw-e2e");
const generatedDir = path.join(e2eDir, "generated");
const stateDir = path.join(e2eDir, "state");
const configPath = path.join(stateDir, "openclaw.json");
const derivedToken = "ov_demo_user_ada_derived";

const check = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const logStep = (message) => {
  console.error(`[openclaw:e2e] ${message}`);
};

const wait = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseJson = (input) => {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
};

const asObject = (value, message) => {
  check(value !== null && typeof value === "object" && !Array.isArray(value), message);
  return value;
};

const asArray = (value, message) => {
  check(Array.isArray(value), message);
  return value;
};

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const cwd = options.cwd ?? repoRoot;
    const timeoutMs = options.timeoutMs ?? 60_000;
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...(options.env ?? {})
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 2000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !didTimeout) {
        resolve({ stdout, stderr });
        return;
      }
      const rendered = [
        `${command} ${args.join(" ")} failed`,
        didTimeout ? `timed out after ${timeoutMs}ms` : `exit=${String(code)} signal=${String(signal)}`,
        stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
        stderr.trim() ? `stderr:\n${stderr.trim()}` : ""
      ]
        .filter(Boolean)
        .join("\n");
      reject(new Error(rendered));
    });

    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });

const ensureOpenClawCli = async () => {
  check(fs.existsSync(openClawCli), "OpenClaw submodule is missing. Run: git submodule update --init --recursive");
  try {
    const version = await runCommand(process.execPath, [openClawCli, "--version"], { timeoutMs: 15_000 });
    return version.stdout.trim();
  } catch (error) {
    logStep("OpenClaw dist output is missing; building the submodule locally.");
    await runCommand("pnpm", ["install", "--frozen-lockfile"], { cwd: openClawDir, timeoutMs: 180_000 });
    await runCommand("pnpm", ["build"], { cwd: openClawDir, timeoutMs: 180_000 });
    const version = await runCommand(process.execPath, [openClawCli, "--version"], { timeoutMs: 15_000 });
    return version.stdout.trim();
  }
};

const buildOpenVitalsPackages = async () => {
  await runCommand(
    "pnpm",
    [
      "--filter",
      "@openvitals/api...",
      "--filter",
      "@openvitals/mcp...",
      "--filter",
      "@openvitals/openclaw-skill...",
      "--filter",
      "@openvitals/openclaw-workspace-recovery...",
      "build"
    ],
    { timeoutMs: 180_000 }
  );
};

const requestJson = async (apiBaseUrl, method, route, options = {}) => {
  const headers = new Headers();
  headers.set("authorization", `Bearer ${options.token ?? derivedToken}`);
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(new URL(route, apiBaseUrl).toString(), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  return {
    status: response.status,
    body: parseJson(text)
  };
};

const listFiles = (root) => {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        out.push(path.relative(root, fullPath));
      }
    }
  };
  walk(root);
  return out.sort();
};

const generateOpenClawAssets = async (apiBaseUrl) => {
  const singleDir = path.join(generatedDir, "single-profile");
  const familyDir = path.join(generatedDir, "family-workspace");
  fs.mkdirSync(singleDir, { recursive: true });
  fs.mkdirSync(familyDir, { recursive: true });

  await runCommand(
    process.execPath,
    [
      path.join(repoRoot, "packages", "openclaw-skill", "dist", "cli.js"),
      "--out-dir",
      singleDir,
      "--api-base-url",
      apiBaseUrl,
      "--user-id",
      "user_ada",
      "--timezone",
      "Asia/Shanghai",
      "--webhook-secret",
      "local-e2e-secret"
    ],
    { timeoutMs: 30_000 }
  );

  await runCommand(
    process.execPath,
    [
      path.join(repoRoot, "packages", "openclaw-workspace-recovery", "dist", "cli.js"),
      "--out-dir",
      familyDir,
      "--api-base-url",
      apiBaseUrl,
      "--timezone",
      "Asia/Shanghai",
      "--webhook-secret",
      "local-e2e-secret",
      "--profile",
      "user_ada|Ada Athlete|0 8 * * *|0 9 * * 0",
      "--profile",
      "user_bea|Bea Recovery|30 8 * * *|30 9 * * 0"
    ],
    { timeoutMs: 30_000 }
  );

  const skillFile = fs.readFileSync(path.join(singleDir, "skills", "openvitals", "SKILL.md"), "utf8");
  check(skillFile.includes(apiBaseUrl), "generated OpenClaw skill did not include the local API base URL");
  check(skillFile.includes("health.sync_status"), "generated OpenClaw skill did not require health.sync_status");
  check(skillFile.includes("not continuous raw sensor streams"), "generated OpenClaw skill lost provider-mediated caveat");

  const daily = JSON.parse(fs.readFileSync(path.join(singleDir, "automation", "cron-daily.json"), "utf8"));
  check(daily.tool === "health.daily_brief", "generated daily automation does not call health.daily_brief");
  check(daily.args?.userId === "user_ada", "generated daily automation has the wrong userId");

  const familyReadme = fs.readFileSync(path.join(familyDir, "workspaces", "health-recovery", "README.md"), "utf8");
  check(familyReadme.includes("user_ada") && familyReadme.includes("user_bea"), "family workspace did not include both profiles");

  return {
    singleProfileFiles: listFiles(singleDir),
    familyWorkspaceFiles: listFiles(familyDir)
  };
};

const openClawEnv = () => ({
  OPENCLAW_STATE_DIR: stateDir,
  OPENCLAW_CONFIG_PATH: configPath
});

const configureOpenClawMcp = async (apiBaseUrl) => {
  fs.mkdirSync(stateDir, { recursive: true });
  const mcpServer = {
    command: process.execPath,
    args: [path.join(repoRoot, "packages", "mcp", "dist", "stdio.js")],
    env: {
      OPENVITALS_API_URL: apiBaseUrl,
      OPENVITALS_AGENT_TOKEN: derivedToken
    }
  };

  await runCommand(process.execPath, [openClawCli, "mcp", "set", "openvitals", JSON.stringify(mcpServer)], {
    env: openClawEnv(),
    timeoutMs: 30_000
  });
  const list = await runCommand(process.execPath, [openClawCli, "mcp", "list", "--json"], {
    env: openClawEnv(),
    timeoutMs: 30_000
  });
  const parsed = asObject(JSON.parse(list.stdout), "OpenClaw MCP list output must be an object");
  check(parsed.openvitals, "OpenClaw MCP registry is missing the openvitals server");
  return parsed.openvitals;
};

class JsonRpcStdioClient {
  constructor(command, args, env) {
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = "";
    this.stderr = "";
    this.child = spawn(command, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.stdout.on("data", (chunk) => {
      this.stdoutBuffer += chunk.toString("utf8");
      this.drainStdout();
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString("utf8");
    });
    this.child.on("close", (code, signal) => {
      const error = new Error(`MCP stdio process exited code=${String(code)} signal=${String(signal)} stderr=${this.stderr.trim()}`);
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }
      this.pending.clear();
    });
  }

  drainStdout() {
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line.trim()) {
        continue;
      }
      const message = JSON.parse(line);
      if (message.id === undefined) {
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        continue;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  request(method, params = {}, timeoutMs = 10_000) {
    const id = this.nextId;
    this.nextId += 1;
    const message = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for MCP response to ${method}. stderr=${this.stderr.trim()}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async close() {
    this.child.stdin.end();
    await wait(100);
    if (!this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }
}

const payloadFromToolResult = (result) => {
  const structured = result?.structuredContent?.result;
  if (structured !== undefined) {
    return structured;
  }
  const content = asArray(result?.content, "MCP tool result content must be an array");
  const text = content.find((entry) => entry?.type === "text")?.text;
  check(typeof text === "string", "MCP tool result text content is missing");
  return JSON.parse(text);
};

const exerciseMcpServer = async (apiBaseUrl) => {
  const client = new JsonRpcStdioClient(process.execPath, [path.join(repoRoot, "packages", "mcp", "dist", "stdio.js")], {
    OPENVITALS_API_URL: apiBaseUrl,
    OPENVITALS_AGENT_TOKEN: derivedToken
  });
  try {
    const init = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "openvitals-openclaw-e2e",
        version: "0.1.0"
      }
    });
    check(init?.serverInfo?.name === "openvitals", "MCP initialize did not return the openvitals server");
    client.notify("notifications/initialized");

    const tools = await client.request("tools/list");
    const toolNames = asArray(tools.tools, "MCP tools/list must return tools").map((tool) => tool.name);
    check(toolNames.includes("health.sync_status"), "MCP tools/list is missing health.sync_status");
    check(toolNames.includes("health.daily_brief"), "MCP tools/list is missing health.daily_brief");

    const syncStatus = payloadFromToolResult(
      await client.request("tools/call", {
        name: "health.sync_status",
        arguments: {
          userId: "user_ada"
        }
      })
    );
    const sources = asArray(syncStatus.sources, "health.sync_status must return sources");
    check(sources.some((source) => source.providerId === "apple-health"), "health.sync_status is missing apple-health");
    check(syncStatus.metadata?.dataModes, "health.sync_status metadata is missing data mode semantics");

    const dailyBrief = payloadFromToolResult(
      await client.request("tools/call", {
        name: "health.daily_brief",
        arguments: {
          userId: "user_ada"
        }
      })
    );
    check(dailyBrief.dataQuality, "health.daily_brief is missing dataQuality");
    check(dailyBrief.sync?.dataQuality, "health.daily_brief sync is missing data quality semantics");

    return {
      protocolVersion: init.protocolVersion,
      tools: toolNames,
      syncSourceCount: sources.length,
      dailyBriefGated: Boolean(dailyBrief.gated)
    };
  } finally {
    await client.close();
  }
};

const providerEnvPresence = () => {
  const keys = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENCLAW_GATEWAY_TOKEN",
    "OPENVITALS_OURA_CLIENT_ID",
    "OPENVITALS_OURA_CLIENT_SECRET",
    "OPENVITALS_OURA_REDIRECT_URI",
    "OPENVITALS_WHOOP_CLIENT_ID",
    "OPENVITALS_WHOOP_CLIENT_SECRET",
    "OPENVITALS_WHOOP_ACCESS_TOKEN"
  ];
  return Object.fromEntries(keys.map((key) => [key, Boolean(process.env[key])]));
};

const run = async () => {
  logStep("checking OpenClaw submodule CLI");
  const openClawVersion = await ensureOpenClawCli();

  logStep("building OpenVitals API/MCP/OpenClaw integration packages");
  await buildOpenVitalsPackages();

  fs.rmSync(e2eDir, { recursive: true, force: true });
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openvitals-openclaw-e2e-"));
  const dbPath = path.join(tempDir, "openclaw-e2e.sqlite");
  const { createApi } = await import("../apps/api/src/index.js");
  const { app } = await createApi({
    dbPath,
    mode: "demo",
    now: new Date("2026-03-19T08:00:00.000Z")
  });

  try {
    logStep("starting local OpenVitals API in demo mode");
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    check(address && typeof address !== "string", "api failed to bind an address");
    const apiBaseUrl = `http://127.0.0.1:${address.port}`;

    const syncHttp = await requestJson(apiBaseUrl, "GET", "/v1/users/user_ada/sync-status");
    check(syncHttp.status === 200, `HTTP sync-status expected 200, got ${syncHttp.status}`);
    check(asArray(syncHttp.body.sources, "HTTP sync-status sources must be an array").length > 0, "HTTP sync-status has no sources");

    logStep("generating OpenClaw skill and family workspace assets");
    const generated = await generateOpenClawAssets(apiBaseUrl);

    logStep("registering OpenVitals MCP server in OpenClaw config");
    const registeredMcp = await configureOpenClawMcp(apiBaseUrl);

    logStep("exercising OpenVitals MCP stdio tools");
    const mcp = await exerciseMcpServer(apiBaseUrl);

    const envPresence = providerEnvPresence();
    const hasModelKey = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"].some(
      (key) => envPresence[key]
    );
    const hasOuraKeys = envPresence.OPENVITALS_OURA_CLIENT_ID && envPresence.OPENVITALS_OURA_CLIENT_SECRET;
    const hasWhoopKeys =
      (envPresence.OPENVITALS_WHOOP_CLIENT_ID && envPresence.OPENVITALS_WHOOP_CLIENT_SECRET) ||
      envPresence.OPENVITALS_WHOOP_ACCESS_TOKEN;

    console.log(
      JSON.stringify(
        {
          openClawVersion,
          apiBaseUrl,
          openClawConfigPath: configPath,
          registeredMcp,
          generated,
          http: {
            syncStatus: syncHttp.status,
            sourceCount: syncHttp.body.sources.length
          },
          mcp,
          providerEnvPresence: envPresence,
          limitations: {
            openClawAgentLoop: hasModelKey ? "not_run_by_default" : "skipped_no_model_provider_key",
            ouraHardware: hasOuraKeys ? "keys_present_manual_hardware_test_still_required" : "skipped_missing_oura_oauth_env_and_ring_session",
            whoopHardware: hasWhoopKeys ? "keys_present_manual_hardware_test_still_required" : "skipped_missing_whoop_oauth_or_token_env_and_device_session",
            appleWatchHardware: "skipped_requires_paired_iPhone_Apple_Watch_and_HealthKit_permissions"
          }
        },
        null,
        2
      )
    );
  } finally {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

await run();

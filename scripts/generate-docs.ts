import fs from "node:fs/promises";
import path from "node:path";

import { MCP_TOOLS } from "../packages/mcp/src/tools.js";

const root = process.cwd();

type PackageManifest = {
  name: string;
  openvitals?: {
    kind?: string;
    phase?: string;
    status?: string;
    title?: string;
    provider?: {
      id: string;
      class: string;
      status: string;
      runtimePath?: string;
      coverage: string[];
    };
  };
};

type ProviderSemantics = {
  connectionMode: string;
  dataGranularity: string;
  latencyClass: string;
  liveSignalPath: string;
  agentGuidance: string;
};

const workspaceDirs = ["apps", "packages", "providers"];

const providerSemantics: Record<string, ProviderSemantics> = {
  "apple-health": {
    connectionMode: "mobile_permission + device_pairing",
    dataGranularity: "sample, daily_summary, live_signal",
    latencyClass: "near_realtime; live only during active Apple Watch workout",
    liveSignalPath: "Apple Watch live workout collector",
    agentGuidance: "Use source revision, device, anchor, freshness, and captureMode metadata before making current-state claims."
  },
  "health-connect": {
    connectionMode: "mobile_permission",
    dataGranularity: "sample, daily_summary",
    latencyClass: "near_realtime, delayed_sync",
    liveSignalPath: "none in v0.6",
    agentGuidance: "Treat as Android platform samples; use as a smoke path after iOS is green."
  },
  oura: {
    connectionMode: "cloud_oauth or mock",
    dataGranularity: "provider_payload, sample, daily_summary, score",
    latencyClass: "delayed_sync, daily",
    liveSignalPath: "none",
    agentGuidance: "Oura cloud data is provider-mediated; never describe it as continuous raw sensor streaming."
  },
  whoop: {
    connectionMode: "cloud_oauth",
    dataGranularity: "provider_payload, daily_summary, score",
    latencyClass: "delayed_sync, daily",
    liveSignalPath: "none",
    agentGuidance: "WHOOP cloud data is provider-mediated recovery/sleep/workout data; never describe it as continuous raw HR streaming."
  },
  garmin: {
    connectionMode: "mock",
    dataGranularity: "provider_payload, daily_summary",
    latencyClass: "manual, delayed_sync",
    liveSignalPath: "none",
    agentGuidance: "Demo-only coverage; do not use for v0.6 hardware acceptance."
  },
  strava: {
    connectionMode: "mock",
    dataGranularity: "provider_payload, episode, daily_summary",
    latencyClass: "manual, delayed_sync",
    liveSignalPath: "none",
    agentGuidance: "Demo-only workout coverage; do not use for v0.6 hardware acceptance."
  }
};

const fallbackSemantics: ProviderSemantics = {
  connectionMode: "unknown",
  dataGranularity: "provider_payload",
  latencyClass: "manual",
  liveSignalPath: "none",
  agentGuidance: "Check provider documentation before making data-quality claims."
};

const readJson = async <T>(filePath: string): Promise<T> => JSON.parse(await fs.readFile(filePath, "utf8")) as T;

const collectPackageJsonPaths = async (): Promise<string[]> => {
  const result: string[] = [];
  for (const dir of workspaceDirs) {
    const entries = await fs.readdir(path.join(root, dir), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = path.join(root, dir, entry.name, "package.json");
        try {
          await fs.access(candidate);
          result.push(candidate);
        } catch {
          // ignore
        }
      }
    }
  }
  return result;
};

const write = async (relativePath: string, content: string) => {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
};

const main = async () => {
  const packagePaths = await collectPackageJsonPaths();
  const manifests = await Promise.all(packagePaths.map((packagePath) => readJson<PackageManifest>(packagePath)));
  const providerManifests = manifests.filter((manifest) => manifest.openvitals?.provider);
  const roadmapManifests = manifests.filter((manifest) => manifest.openvitals?.phase);

  const providerCoverage = `# Provider Coverage

Generated from workspace package manifests plus OpenVitals's v0.6 data-quality semantics.

Provider cloud APIs and mobile platform stores expose different evidence types. Agents should inspect granularity, freshness, latency, provenance, and mirrored-source metadata before making coaching claims.

| Provider | Class | Runtime Path | Status | Coverage | Connection Mode | Data Granularity | Latency Class | Live Signal Path | Agent Guidance |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${providerManifests
  .map((manifest) => {
    const provider = manifest.openvitals!.provider!;
    const semantics = providerSemantics[provider.id] ?? fallbackSemantics;
    return `| ${provider.id} | ${provider.class} | ${provider.runtimePath ?? "mock"} | ${provider.status} | ${provider.coverage.join(", ")} | ${semantics.connectionMode} | ${semantics.dataGranularity} | ${semantics.latencyClass} | ${semantics.liveSignalPath} | ${semantics.agentGuidance} |`;
  })
  .join("\n")}

## Manual hardware gates

- Apple Watch live heart rate is only accepted from an active live workout collector session.
- Oura and WHOOP cloud data are delayed/provider-mediated. They must not be documented as continuous raw sensor streams.
- Oura/WHOOP mirrored into Apple Health must be retained for auditability but suppressed from normalized views when direct provider data wins.
- Hardware acceptance remains pending until the matrix in [Hardware Test Plan](../hardware-test-plan.md) is completed with real device/account evidence.
`;

  const mcpTools = `# MCP Tools

| Tool | Title | Description |
| --- | --- | --- |
${MCP_TOOLS.map((tool) => `| ${tool.name} | ${tool.title} | ${tool.description} |`).join("\n")}
`;

  const roadmap = `# Roadmap Status

| Package | Title | Phase | Status |
| --- | --- | --- | --- |
${roadmapManifests
  .map(
    (manifest) =>
      `| ${manifest.name} | ${manifest.openvitals?.title ?? manifest.name} | ${manifest.openvitals?.phase ?? "-"} | ${manifest.openvitals?.status ?? manifest.openvitals?.provider?.status ?? "-"} |`
  )
  .join("\n")}
`;

  const statusJson = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      providers: providerManifests.map((manifest) => {
        const provider = manifest.openvitals!.provider!;
        return {
          ...provider,
          semantics: providerSemantics[provider.id] ?? fallbackSemantics
        };
      }),
      mcpTools: MCP_TOOLS.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description
      })),
      roadmap: roadmapManifests.map((manifest) => ({
        packageName: manifest.name,
        title: manifest.openvitals?.title,
        phase: manifest.openvitals?.phase,
        status: manifest.openvitals?.status ?? manifest.openvitals?.provider?.status
      }))
    },
    null,
    2
  );

  await write("docs/generated/provider-coverage.md", providerCoverage);
  await write("docs/generated/mcp-tools.md", mcpTools);
  await write("docs/generated/roadmap.md", roadmap);
  await write("docs/generated/status.json", statusJson);
};

await main();

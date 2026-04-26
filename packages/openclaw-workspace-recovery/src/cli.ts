#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { createOpenClawRecoveryWorkspaceFiles } from "./index.js";

type CliArgs = {
  outDir: string;
  apiBaseUrl: string;
  timezone: string;
  webhookSecret: string;
  profiles: Array<{ userId: string; name: string; dailyCron?: string; weeklyCron?: string }>;
};

const parseProfile = (value: string): { userId: string; name: string; dailyCron?: string; weeklyCron?: string } => {
  const [userId, name, dailyCron, weeklyCron] = value.split("|");
  if (!userId || !name) {
    throw new Error("Invalid --profile value. Expected format: userId|name|dailyCron?|weeklyCron?");
  }
  return {
    userId,
    name,
    dailyCron: dailyCron || undefined,
    weeklyCron: weeklyCron || undefined
  };
};

const parseArgs = (argv: string[]): CliArgs => {
  const args: CliArgs = {
    outDir: process.cwd(),
    apiBaseUrl: process.env.OPENVITALS_API_URL ?? "http://127.0.0.1:3000",
    timezone: process.env.OPENVITALS_TIMEZONE ?? "Asia/Shanghai",
    webhookSecret: process.env.OPENVITALS_WEBHOOK_SECRET ?? "replace-me",
    profiles: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value) {
      continue;
    }
    if (value === "--out-dir") {
      args.outDir = path.resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (value === "--api-base-url") {
      args.apiBaseUrl = argv[index + 1] ?? args.apiBaseUrl;
      index += 1;
      continue;
    }
    if (value === "--timezone") {
      args.timezone = argv[index + 1] ?? args.timezone;
      index += 1;
      continue;
    }
    if (value === "--webhook-secret") {
      args.webhookSecret = argv[index + 1] ?? args.webhookSecret;
      index += 1;
      continue;
    }
    if (value === "--profile") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --profile");
      }
      args.profiles.push(parseProfile(next));
      index += 1;
      continue;
    }
  }

  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const files = createOpenClawRecoveryWorkspaceFiles({
    apiBaseUrl: args.apiBaseUrl,
    timezone: args.timezone,
    webhookSecret: args.webhookSecret,
    profiles: args.profiles
  });
  for (const file of files) {
    const target = path.join(args.outDir, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, "utf8");
    console.log(`wrote ${path.relative(args.outDir, target)}`);
  }
};

await main();

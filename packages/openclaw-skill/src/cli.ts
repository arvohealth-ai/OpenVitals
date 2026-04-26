#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { createOpenClawSkillFiles } from "./index.js";

type CliArgs = {
  outDir: string;
  apiBaseUrl: string;
  userId: string;
  timezone: string;
  dailyCron: string;
  weeklyCron: string;
  webhookSecret: string;
};

const parseArgs = (argv: string[]): CliArgs => {
  const args: CliArgs = {
    outDir: process.cwd(),
    apiBaseUrl: process.env.OPENVITALS_API_URL ?? "http://127.0.0.1:3000",
    userId: process.env.OPENVITALS_USER_ID ?? "user_ada",
    timezone: process.env.OPENVITALS_TIMEZONE ?? "Asia/Shanghai",
    dailyCron: process.env.OPENVITALS_DAILY_CRON ?? "0 8 * * *",
    weeklyCron: process.env.OPENVITALS_WEEKLY_CRON ?? "0 9 * * 0",
    webhookSecret: process.env.OPENVITALS_WEBHOOK_SECRET ?? "replace-me"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value) {
      continue;
    }

    if (value === "--out-dir") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --out-dir");
      }
      args.outDir = path.resolve(next);
      index += 1;
      continue;
    }

    if (value === "--api-base-url") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --api-base-url");
      }
      args.apiBaseUrl = next;
      index += 1;
      continue;
    }

    if (value === "--user-id") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --user-id");
      }
      args.userId = next;
      index += 1;
      continue;
    }

    if (value === "--timezone") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --timezone");
      }
      args.timezone = next;
      index += 1;
      continue;
    }

    if (value === "--daily-cron") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --daily-cron");
      }
      args.dailyCron = next;
      index += 1;
      continue;
    }

    if (value === "--weekly-cron") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --weekly-cron");
      }
      args.weeklyCron = next;
      index += 1;
      continue;
    }

    if (value === "--webhook-secret") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --webhook-secret");
      }
      args.webhookSecret = next;
      index += 1;
    }
  }

  return args;
};

const writeSkillFiles = async ({ outDir, apiBaseUrl, userId, timezone, dailyCron, weeklyCron, webhookSecret }: CliArgs) => {
  const files = createOpenClawSkillFiles({
    apiBaseUrl,
    userId,
    timezone,
    dailyCron,
    weeklyCron,
    webhookSecret
  });
  for (const file of files) {
    const targetPath = path.join(outDir, file.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, file.content, "utf8");
    console.log(`wrote ${path.relative(outDir, targetPath)}`);
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  await writeSkillFiles(args);
};

await main();

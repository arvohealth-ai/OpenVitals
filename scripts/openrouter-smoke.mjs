#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenRouterClient, openRouterConfigFromEnv, rankOpenRouterModelsByPrice } from "../packages/llm/src/index.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

loadEnvFiles([".env", ".env.local", ".env.live.local"]);

const config = openRouterConfigFromEnv(process.env);
const client = createOpenRouterClient(config);
const selectedBy = config.model ? "env" : "cheapest";
const maxAttempts = parseInteger(process.env.OPENVITALS_OPENROUTER_MAX_ATTEMPTS, 8);
const maxTokens = parseInteger(process.env.OPENVITALS_OPENROUTER_MAX_TOKENS, 8);
const allowFree = parseBoolean(process.env.OPENVITALS_OPENROUTER_ALLOW_FREE, true);
const attempts = [];
const candidates = config.model
  ? [{ model: { id: config.model }, estimatedTokenPrice: undefined }]
  : rankOpenRouterModelsByPrice(await client.listModels(), { allowFree }).slice(0, maxAttempts);

if (candidates.length === 0) {
  throw new Error("No OpenRouter text chat model candidates were available for smoke testing");
}

let result = null;
let selection = null;
for (const candidate of candidates) {
  try {
    result = await client.chat({
      model: candidate.model.id,
      temperature: 0,
      maxTokens,
      messages: [
        { role: "system", content: "Reply with only ok." },
        { role: "user", content: "OpenVitals OpenRouter smoke test." }
      ]
    });
    selection = candidate;
    break;
  } catch (error) {
    attempts.push({
      model: candidate.model.id,
      error: getErrorMessage(error).slice(0, 220)
    });
    if (config.model) {
      throw error;
    }
  }
}

if (!result || !selection) {
  throw new Error(`OpenRouter smoke failed for ${attempts.length} candidate model(s): ${JSON.stringify(attempts)}`);
}

const summary = {
  provider: "openrouter",
  apiUrl: config.apiUrl,
  model: result.model || selection.model.id,
  selectedBy,
  estimatedTokenPrice: selection.estimatedTokenPrice,
  maxTokens,
  keyPresent: Boolean(config.apiKey),
  attemptedModels: attempts.map((attempt) => attempt.model),
  contentPreview: result.content.trim().slice(0, 120),
  usage: result.usage
};

console.log(JSON.stringify(summary, null, 2));

function loadEnvFiles(files) {
  for (const file of files) {
    const fullPath = path.join(repoRoot, file);
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    const text = fs.readFileSync(fullPath, "utf8");
    for (const [key, value] of parseEnv(text)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function parseEnv(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const equals = withoutExport.indexOf("=");
    if (equals <= 0) {
      continue;
    }
    const key = withoutExport.slice(0, equals).trim();
    const rawValue = withoutExport.slice(equals + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    entries.push([key, unquoteEnvValue(rawValue)]);
  }
  return entries;
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  const hashIndex = value.indexOf(" #");
  return hashIndex >= 0 ? value.slice(0, hashIndex).trim() : value;
}

function parseInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (/^(1|true|yes)$/i.test(value)) {
    return true;
  }
  if (/^(0|false|no)$/i.test(value)) {
    return false;
  }
  return fallback;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

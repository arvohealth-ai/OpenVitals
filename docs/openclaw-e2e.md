# OpenClaw Submodule E2E

OpenVitals keeps the upstream OpenClaw repository as a pinned submodule at `vendor/openclaw`. The current pin is OpenClaw `v2026.4.24`.

## Setup

```bash
git submodule update --init --recursive
pnpm install
```

The E2E command builds OpenClaw locally if the submodule checkout does not already have `dist/` output.

```bash
pnpm openclaw:e2e
```

## What The E2E Covers

`pnpm openclaw:e2e` verifies the local integration path without requiring live provider credentials:

- OpenClaw CLI from `vendor/openclaw/openclaw.mjs` starts and reports its version.
- OpenVitals API starts in deterministic demo mode on a random localhost port.
- OpenVitals OpenClaw skill assets and family recovery workspace files are generated.
- OpenClaw MCP config is written to `.agent-workflows/openclaw-e2e/state/openclaw.json` with a `openvitals` server entry.
- OpenVitals MCP stdio is exercised directly with `initialize`, `tools/list`, `health.sync_status`, and `health.daily_brief`.
- The MCP results are checked for freshness, data-quality, and source semantics.

The command prints a JSON report with the OpenClaw version, generated files, MCP tool coverage, provider env presence, and skipped live-test limitations.

## Live Tests Not Covered

This automated E2E does not run a full OpenClaw agent loop by default because that needs a configured model provider key such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, or `OPENROUTER_API_KEY`.

It also does not replace the hardware QA matrix. These still require manual setup:

- Oura OAuth credentials and an Oura Ring account/session.
- WHOOP OAuth credentials or a valid development token and a WHOOP account/device.
- A paired iPhone and Apple Watch with HealthKit permissions for historical samples and live workout heart rate.
- Mirrored Oura/WHOOP data in Apple Health for dedupe verification.

The E2E intentionally keeps provider claims conservative: Oura and WHOOP cloud APIs remain provider-mediated delayed data unless a live hardware test proves otherwise, and Apple Watch live heart rate is only live during the workout collector path.

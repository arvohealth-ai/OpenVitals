import type { DemoState } from "@openvitals/contracts";

export type OmhExport = {
  body: {
    user_id: string;
    date: string;
    schemas: Array<{
      schema_id: string;
      data: Record<string, unknown>;
    }>;
  };
};

type SourceAccount = DemoState["sourceAccounts"][number];

const companionNoteForSourceAccount = (account: SourceAccount): string => {
  const liveSignalCapable = account.metricCapabilities.some((capability) => capability.dataGranularity === "live_signal");
  if (account.providerId === "apple-health") {
    if (account.connectionMode === "device_pairing") {
      return "Optional Apple Watch workout mode is active; only these samples should be exported as live Apple Health signals.";
    }
    if (liveSignalCapable) {
      return "Apple Health normal sync uses the iPhone companion. The Watch app is optional for live workout heart-rate; historical Watch samples arrive through HealthKit on iPhone.";
    }
    return "Apple Health normal sync uses the iPhone companion for HealthKit authorization, historical sync, background/incremental sync, and manual Sync Now.";
  }
  if (account.platform === "cloud") {
    return "Cloud provider data is delayed/provider-mediated, not continuous raw sensor streaming.";
  }
  return "Mobile platform data should be interpreted using freshness and data-quality gates.";
};

export const toOmh = (state: DemoState): OmhExport => ({
  body: {
    user_id: state.user.id,
    date: new Date().toISOString(),
    schemas: [
      ...state.sourceAccounts.map((account) => ({
        schema_id: "omh:openvitals:source-account",
        data: {
          provider_id: account.providerId,
          platform: account.platform,
          status: account.status,
          sync_freshness_hours: account.syncFreshnessHours,
          connection_mode: account.connectionMode,
          live_signal_capable: account.metricCapabilities.some((capability) => capability.dataGranularity === "live_signal"),
          companion_note: companionNoteForSourceAccount(account)
        }
      })),
      ...state.scores.map((score) => ({
        schema_id: `omh:openvitals:${score.scoreKind}`,
        data: {
          value: score.value,
          label: score.label,
          evidence_set: score.evidenceSet,
          confidence: score.confidence,
          freshness_hours: score.freshnessHours,
          data_granularity: "score",
          latency_class: score.latencyClass,
          source_provider: score.source,
          capture_mode: score.captureMode,
          stale: score.freshnessHours >= 24 || score.missingSignals.length > 0
        }
      })),
      ...state.dailySummaries.slice(-7).map((summary) => ({
        schema_id: "omh:openvitals:daily-summary",
        data: {
          day: summary.day,
          summary: summary.summary,
          provenance: {
            source: summary.source,
            capture_mode: summary.captureMode,
            suppressed_sources: summary.suppressedSources,
            freshness_hours: summary.freshnessHours,
            confidence: summary.confidence,
            data_granularity: "daily_summary",
            latency_class: summary.latencyClass,
            stale: summary.freshnessHours >= 24
          }
        }
      }))
    ]
  }
});

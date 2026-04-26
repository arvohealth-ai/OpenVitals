import type { DemoState } from "@openvitals/contracts";

export type FhirBundle = {
  resourceType: "Bundle";
  type: "collection";
  entry: Array<{
    resource: Record<string, unknown>;
  }>;
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

export const toFhirBundle = (state: DemoState): FhirBundle => ({
  resourceType: "Bundle",
  type: "collection",
  entry: [
    {
      resource: {
        resourceType: "Patient",
        id: state.user.id,
        name: [{ text: state.user.name }]
      }
    },
    ...state.sourceAccounts.map((account) => ({
      resource: {
        resourceType: "Device",
        id: account.id,
        status: account.status === "connected" ? "active" : "inactive",
        type: {
          text: account.providerId
        },
        patient: {
          reference: `Patient/${state.user.id}`
        },
        deviceName: [{ name: account.connectionLabel, type: "user-friendly-name" }],
        extension: [
          { url: "https://openvitals.dev/fhir/StructureDefinition/provider-id", valueCode: account.providerId },
          { url: "https://openvitals.dev/fhir/StructureDefinition/connection-mode", valueCode: account.connectionMode },
          {
            url: "https://openvitals.dev/fhir/StructureDefinition/live-signal-capable",
            valueBoolean: account.metricCapabilities.some((capability) => capability.dataGranularity === "live_signal")
          },
          { url: "https://openvitals.dev/fhir/StructureDefinition/companion-note", valueString: companionNoteForSourceAccount(account) }
        ]
      }
    })),
    ...state.scores.map((score) => ({
      resource: {
        resourceType: "Observation",
        id: score.id,
        status: "final",
        code: {
          text: score.scoreKind
        },
        subject: {
          reference: `Patient/${state.user.id}`
        },
        effectivePeriod: {
          start: score.windowStart,
          end: score.windowEnd
        },
        valueQuantity: {
          value: score.value,
          unit: "score"
        },
        extension: [
          { url: "https://openvitals.dev/fhir/StructureDefinition/data-granularity", valueCode: "score" },
          { url: "https://openvitals.dev/fhir/StructureDefinition/source-provider", valueCode: score.source },
          { url: "https://openvitals.dev/fhir/StructureDefinition/capture-mode", valueCode: score.captureMode },
          { url: "https://openvitals.dev/fhir/StructureDefinition/latency-class", valueCode: score.latencyClass },
          { url: "https://openvitals.dev/fhir/StructureDefinition/freshness-hours", valueDecimal: score.freshnessHours },
          { url: "https://openvitals.dev/fhir/StructureDefinition/stale", valueBoolean: score.freshnessHours >= 24 || score.missingSignals.length > 0 },
          { url: "https://openvitals.dev/fhir/StructureDefinition/confidence", valueDecimal: score.confidence }
        ],
        note: [{ text: score.uncertaintyNote }]
      }
    })),
    ...state.alerts.map((alert) => ({
      resource: {
        resourceType: "DetectedIssue",
        id: alert.id,
        status: "final",
        code: {
          text: alert.workflowKind
        },
        subject: {
          reference: `Patient/${state.user.id}`
        },
        detail: alert.summary
      }
    }))
  ]
});

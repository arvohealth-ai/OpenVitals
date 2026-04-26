import type { DedupeDecision, Episode, MetricFamily, Observation, ProviderId } from "@openvitals/contracts";
import { DedupeDecisionSchema } from "@openvitals/contracts";

export type DedupeFingerprintInput = {
  userId: string;
  sourceRecordId: string;
  metricFamily: MetricFamily;
  startAt: string;
  endAt: string;
  sourceApp: string;
  bundleId?: string | null;
  packageName?: string | null;
};

export type DedupePipelineDeps = {
  createId: (...parts: string[]) => string;
  canonicalSourceKey: (sourceRecordId: string) => string;
  precedence: Record<string, number>;
  createWhyPrimary: (source: ProviderId, suppressedSources: ProviderId[], captureMode: string) => string;
  dedupePrecedenceVersion: string;
  iso: (date: Date) => string;
};

export const dedupeFingerprint = (input: DedupeFingerprintInput, deps: DedupePipelineDeps): string =>
  deps.createId(
    "fingerprint",
    input.userId,
    deps.canonicalSourceKey(input.sourceRecordId),
    input.metricFamily,
    input.startAt,
    input.endAt,
    input.sourceApp,
    input.bundleId ?? "bundle:none",
    input.packageName ?? "package:none"
  ).replace(/:/g, "-");

const originForEntry = (entry: Observation | Episode): { bundleId: string | null; packageName: string | null } => ({
  bundleId: entry.bundleId ?? null,
  packageName: entry.packageName ?? null
});

export const dedupeTimelineWithDecisions = <T extends Observation | Episode>(
  entries: T[],
  deps: DedupePipelineDeps,
  now = new Date()
): { primaryEntries: T[]; decisions: DedupeDecision[] } => {
  const groups = new Map<string, T[]>();

  for (const entry of entries) {
    const key =
      entry.kind === "observation"
        ? deps.createId("group", entry.userId, entry.metric, entry.startAt, entry.endAt, deps.canonicalSourceKey(entry.sourceRecordId))
        : deps.createId("group", entry.userId, entry.episodeType, entry.startAt, entry.endAt, deps.canonicalSourceKey(entry.sourceRecordId));
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  const primaryEntries: T[] = [];
  const decisions: DedupeDecision[] = [];
  for (const entriesForKey of groups.values()) {
    const sorted = [...entriesForKey].sort((left, right) => {
      const precedenceDelta = (deps.precedence[right.captureMode] ?? 0) - (deps.precedence[left.captureMode] ?? 0);
      if (precedenceDelta !== 0) {
        return precedenceDelta;
      }
      const freshnessDelta = left.freshnessHours - right.freshnessHours;
      if (freshnessDelta !== 0) {
        return freshnessDelta;
      }
      const confidenceDelta = right.confidence - left.confidence;
      if (confidenceDelta !== 0) {
        return confidenceDelta;
      }
      const rightOrigin = originForEntry(right);
      const leftOrigin = originForEntry(left);
      const rightOriginScore = Number(Boolean(rightOrigin.bundleId || rightOrigin.packageName));
      const leftOriginScore = Number(Boolean(leftOrigin.bundleId || leftOrigin.packageName));
      return rightOriginScore - leftOriginScore;
    });

    const primary = sorted[0];
    if (!primary) {
      continue;
    }

    const suppressedSources = sorted.slice(1).map((entry) => entry.source);
    primary.whyPrimary = deps.createWhyPrimary(primary.source, suppressedSources, primary.captureMode);
    primary.suppressedSources = suppressedSources;
    primary.provenanceChain = sorted.map((entry, index) => ({
      providerId: entry.source,
      sourceRecordId: entry.sourceRecordId,
      captureMode: entry.captureMode,
      role: index === 0 ? "primary" : "suppressed"
    }));

    const fingerprint = dedupeFingerprint(
      {
        userId: primary.userId,
        sourceRecordId: primary.sourceRecordId,
        metricFamily: primary.metricFamily,
        startAt: primary.startAt,
        endAt: primary.endAt,
        sourceApp: primary.sourceApp,
        bundleId: primary.bundleId ?? null,
        packageName: primary.packageName ?? null
      },
      deps
    );

    const reasonCode =
      sorted.length <= 1
        ? "single_candidate"
        : sorted.some((entry) => entry.captureMode !== primary.captureMode)
          ? "capture_mode_precedence"
          : sorted.some((entry) => entry.confidence !== primary.confidence)
            ? "confidence_precedence"
            : "capture_mode_precedence";

    decisions.push(
      DedupeDecisionSchema.parse({
        id: deps.createId("dedupe_decision", fingerprint),
        userId: primary.userId,
        providerId: primary.source,
        fingerprint,
        metricFamily: primary.metricFamily,
        precedenceVersion: deps.dedupePrecedenceVersion,
        policyVersion: deps.dedupePrecedenceVersion,
        policy: {
          name: "capture_mode_precedence",
          version: deps.dedupePrecedenceVersion
        },
        reasonCode,
        origin: {
          sourceApp: primary.sourceApp,
          bundleId: primary.bundleId ?? null,
          packageName: primary.packageName ?? null
        },
        ignoredBySourceFilter: false,
        primary: {
          source: primary.source,
          sourceRecordId: primary.sourceRecordId,
          sourceApp: primary.sourceApp,
          bundleId: primary.bundleId ?? null,
          packageName: primary.packageName ?? null,
          captureMode: primary.captureMode,
          confidence: primary.confidence,
          freshnessHours: primary.freshnessHours
        },
        suppressed: sorted.slice(1).map((entry) => ({
          source: entry.source,
          sourceRecordId: entry.sourceRecordId,
          sourceApp: entry.sourceApp,
          bundleId: entry.bundleId ?? null,
          packageName: entry.packageName ?? null,
          captureMode: entry.captureMode,
          confidence: entry.confidence,
          freshnessHours: entry.freshnessHours
        })),
        reason: primary.whyPrimary,
        decisionTrace: [
          "Grouped by source_record_id + time window + metric_family",
          "Compared origin (bundle/package) and confidence as deterministic tie-breakers",
          `Applied precedence direct > mirrored > imported > manual (version ${deps.dedupePrecedenceVersion})`,
          `Selected ${primary.source} as primary`
        ],
        decidedAt: deps.iso(now)
      })
    );
    primaryEntries.push(primary);
  }

  return {
    primaryEntries: primaryEntries.sort((left, right) => (left.startAt < right.startAt ? -1 : 1)),
    decisions
  };
};

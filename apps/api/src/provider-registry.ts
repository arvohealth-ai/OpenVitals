import type { Collector, CollectorRuntimePath, ProviderId, RuntimeMode } from "@openvitals/contracts";
import { PROVIDER_IDS, ProviderIdSchema } from "@openvitals/contracts";

import {
  collector as appleHealthCollector,
  manifest as appleHealthManifest,
  mockCollector as appleHealthMockCollector
} from "../../../providers/apple-health/src/index.js";
import {
  collector as healthConnectCollector,
  manifest as healthConnectManifest,
  mockCollector as healthConnectMockCollector
} from "../../../providers/health-connect/src/index.js";
import { collector as garminCollector, manifest as garminManifest, mockCollector as garminMockCollector } from "../../../providers/garmin/src/index.js";
import {
  liveCollector as ouraLiveCollector,
  liveManifest as ouraLiveManifest,
  mockCollector as ouraMockCollector
} from "../../../providers/oura/src/index.js";
import { collector as stravaCollector, manifest as stravaManifest, mockCollector as stravaMockCollector } from "../../../providers/strava/src/index.js";
import { collector as whoopCollector, manifest as whoopManifest, mockCollector as whoopMockCollector } from "../../../providers/whoop/src/index.js";

type ProviderRegistryRow = {
  providerId: ProviderId;
  runtimePath: CollectorRuntimePath;
  liveCollector: Collector;
  mockCollector: Collector;
};

const REGISTRY: Record<ProviderId, ProviderRegistryRow> = {
  "apple-health": {
    providerId: "apple-health",
    runtimePath: appleHealthManifest.runtimePath,
    liveCollector: appleHealthCollector,
    mockCollector: appleHealthMockCollector
  },
  "health-connect": {
    providerId: "health-connect",
    runtimePath: healthConnectManifest.runtimePath,
    liveCollector: healthConnectCollector,
    mockCollector: healthConnectMockCollector
  },
  garmin: {
    providerId: "garmin",
    runtimePath: garminManifest.runtimePath,
    liveCollector: garminCollector,
    mockCollector: garminMockCollector
  },
  oura: {
    providerId: "oura",
    runtimePath: ouraLiveManifest.runtimePath,
    liveCollector: ouraLiveCollector,
    mockCollector: ouraMockCollector
  },
  strava: {
    providerId: "strava",
    runtimePath: stravaManifest.runtimePath,
    liveCollector: stravaCollector,
    mockCollector: stravaMockCollector
  },
  whoop: {
    providerId: "whoop",
    runtimePath: whoopManifest.runtimePath,
    liveCollector: whoopCollector,
    mockCollector: whoopMockCollector
  }
};

export const registryProviderIds = (): ProviderId[] => [...PROVIDER_IDS];

export const resolveCollector = (
  mode: RuntimeMode,
  providerId: ProviderId
): {
  collector: Collector;
  collectorType: CollectorRuntimePath;
} => {
  const row = REGISTRY[providerId];
  if (!row) {
    throw new Error(`Unknown provider ${providerId}`);
  }

  if (mode === "demo") {
    return {
      collector: row.mockCollector,
      collectorType: "mock"
    };
  }

  if (row.runtimePath === "mock") {
    return {
      collector: row.mockCollector,
      collectorType: "mock"
    };
  }

  return {
    collector: row.liveCollector,
    collectorType: "live"
  };
};

export const dataModesForRuntime = (mode: RuntimeMode): Partial<Record<ProviderId, "demo" | "live">> =>
  Object.fromEntries(
    registryProviderIds().map((providerId) => {
      const resolved = resolveCollector(mode, providerId);
      return [providerId, resolved.collectorType === "live" ? "live" : "demo"];
    })
  ) as Partial<Record<ProviderId, "demo" | "live">>;

export const collectorTypeForRuntime = (mode: RuntimeMode): CollectorRuntimePath => {
  const collectorTypes = new Set(
    registryProviderIds().map((providerId) => {
      const resolved = resolveCollector(mode, providerId);
      return resolved.collectorType;
    })
  );

  if (collectorTypes.size === 1) {
    return collectorTypes.has("live") ? "live" : "mock";
  }
  return "hybrid";
};

export const pickProviderIds = (providerId?: string): ProviderId[] => {
  if (!providerId) {
    return registryProviderIds();
  }
  return [ProviderIdSchema.parse(providerId)];
};

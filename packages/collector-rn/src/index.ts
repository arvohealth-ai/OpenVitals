import {
  createMobileCollectorClient,
  healthConnectDataSemantics,
  type CollectorConfig,
  type IngestInput as CoreIngestInput,
  type MobileProvider
} from "@openvitals/collector-mobile-core";

type IngestInput = CoreIngestInput;

export const reactNativeCollectorBridge = {
  packageName: "@openvitals/collector-rn",
  platforms: ["ios", "android"],
  capabilities: [
    "connect session lifecycle",
    "per-user session isolation",
    "anchor/token isolation",
    "upload ingest batch",
    "background sync",
    "offline queue",
    "source filtering",
    "battery-aware backoff",
    "provider-mediated data labels"
  ],
  installSnippet: `import { createOpenVitalsCollector } from "@openvitals/collector-rn";`,
  example: {
    create: "const collector = createOpenVitalsCollector({ apiBaseUrl: 'http://localhost:3000' });",
    connect: "const session = await collector.createSession({ userId: 'user_ada', providerId: 'health-connect' });",
    ingest:
      "await collector.ingest({ userId: 'user_ada', providerId: 'health-connect', sessionToken: session.sessionToken, idempotencyKey: 'batch-1', records });",
    checkpoint: "await collector.checkpointAnchor({ userId: 'user_ada', providerId: 'health-connect' });"
  }
};

export const createOpenVitalsCollector = (config: CollectorConfig) => ({
  config,
  dataSemanticsForProvider(providerId: MobileProvider) {
    return providerId === "health-connect" ? healthConnectDataSemantics : null;
  },
  clientForProvider(providerId: MobileProvider) {
    return createMobileCollectorClient(config, providerId);
  },
  async createSession(input: { userId: string; providerId: MobileProvider }) {
    return this.clientForProvider(input.providerId).createSession(input.userId);
  },
  async ingest(input: IngestInput) {
    return this.clientForProvider(input.providerId).ingest({
      userId: input.userId,
      sessionToken: input.sessionToken,
      idempotencyKey: input.idempotencyKey,
      anchorBefore: input.anchorBefore,
      anchorAfter: input.anchorAfter,
      records: input.records
    });
  },
  async checkpointAnchor(input: { userId: string; providerId: MobileProvider }) {
    return this.clientForProvider(input.providerId).checkpointAnchor(input.userId);
  },
  async setIgnoredSources(input: { userId: string; providerId: MobileProvider; ignoredSources: string[] }) {
    return this.clientForProvider(input.providerId).setIgnoredSources(input.userId, input.ignoredSources);
  },
  async syncStatus(input: { userId: string; providerId: MobileProvider }) {
    return this.clientForProvider(input.providerId).syncStatus(input.userId);
  }
});

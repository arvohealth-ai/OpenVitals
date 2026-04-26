import {
  createMobileCollectorClient,
  healthConnectDataSemantics,
  isCollectorClientError,
  type CollectorConfig,
  type IngestInput,
  type SessionResponse
} from "@openvitals/collector-mobile-core";

export type { CollectorConfig, IngestInput, MobileProvider, SessionResponse } from "@openvitals/collector-mobile-core";

export type AndroidCollectorOptions = CollectorConfig & {
  maxRetries?: number;
  baseBackoffMs?: number;
  queueStorage?: AndroidQueueStorage;
};

type AndroidQueuedBatch = Omit<IngestInput, "providerId"> & {
  retries: number;
};

export type AndroidQueueStorage = {
  load(): Promise<AndroidQueuedBatch[]>;
  save(queue: AndroidQueuedBatch[]): Promise<void>;
};

export const createFileQueueStorage = (filePath: string): AndroidQueueStorage => ({
  async load() {
    try {
      const fs = await import("node:fs/promises");
      const payload = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(payload);
      return Array.isArray(parsed) ? (parsed as AndroidQueuedBatch[]) : [];
    } catch {
      return [];
    }
  },
  async save(queue) {
    const fs = await import("node:fs/promises");
    const nodePath = await import("node:path");
    await fs.mkdir(nodePath.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(queue, null, 2), "utf8");
  }
});

export const createAndroidCollectorClient = (options: AndroidCollectorOptions) => {
  const core = createMobileCollectorClient(options, "health-connect");
  const queue: AndroidQueuedBatch[] = [];
  let backoffUntil: string | null = null;
  let initialized = false;
  const maxRetries = options.maxRetries ?? 3;
  const baseBackoffMs = options.baseBackoffMs ?? 1500;
  const queueStorage = options.queueStorage;

  const initializeQueue = async () => {
    if (initialized) {
      return;
    }
    initialized = true;
    if (!queueStorage) {
      return;
    }
    const stored = await queueStorage.load();
    queue.push(...stored);
  };

  const persistQueue = async () => {
    if (!queueStorage) {
      return;
    }
    await queueStorage.save(queue);
  };

  const applyBackoff = (retries: number) => {
    const waitMs = baseBackoffMs * Math.max(1, 2 ** Math.max(retries - 1, 0));
    backoffUntil = new Date(Date.now() + waitMs).toISOString();
    return waitMs;
  };

  const ingestWithAnchorRecovery = async (input: Omit<IngestInput, "providerId">) => {
    try {
      return await core.ingest(input);
    } catch (error) {
      if (!isCollectorClientError(error) || error.code !== "ANCHOR_CONFLICT") {
        throw error;
      }
      const syncStatus = (await core.syncStatus(input.userId)) as {
        sources?: Array<{ providerId: string; lastAnchor: string | null }>;
      };
      const latestAnchor = syncStatus.sources?.find((source) => source.providerId === "health-connect")?.lastAnchor ?? null;
      return core.ingest({
        ...input,
        anchorBefore: latestAnchor
      });
    }
  };

  const flushQueue = async () => {
    await initializeQueue();
    while (queue.length > 0) {
      const next = queue[0];
      if (!next) {
        return;
      }

      if (backoffUntil && new Date(backoffUntil).getTime() > Date.now()) {
        return;
      }

      try {
        await ingestWithAnchorRecovery(next);
        queue.shift();
        await persistQueue();
        backoffUntil = null;
      } catch (error) {
        if (isCollectorClientError(error) && error.code === "SESSION_EXPIRED") {
          queue.shift();
          await persistQueue();
          backoffUntil = null;
          continue;
        }
        next.retries += 1;
        await persistQueue();
        if (next.retries >= maxRetries) {
          queue.shift();
          await persistQueue();
          backoffUntil = null;
          continue;
        }
        applyBackoff(next.retries);
        return;
      }
    }
  };

  return {
    providerId: "health-connect" as const,
    dataSemantics: healthConnectDataSemantics,
    async createSession(userId: string): Promise<SessionResponse> {
      return core.createSession(userId);
    },
    async ingest(input: Omit<IngestInput, "providerId">) {
      return ingestWithAnchorRecovery(input);
    },
    async enqueue(input: Omit<IngestInput, "providerId">) {
      await initializeQueue();
      queue.push({ ...input, retries: 0 });
      await persistQueue();
      await flushQueue();
      return {
        queued: queue.length,
        backoffUntil
      };
    },
    async flush() {
      await flushQueue();
      return {
        queued: queue.length,
        backoffUntil
      };
    },
    async checkpointAnchor(userId: string) {
      return core.checkpointAnchor(userId);
    },
    async setIgnoredSources(userId: string, ignoredSources: string[]) {
      return core.setIgnoredSources(userId, ignoredSources);
    },
    async syncStatus(userId: string) {
      const status = (await core.syncStatus(userId)) as Record<string, unknown>;
      return {
        ...status,
        clientQueueDepth: queue.length,
        clientBackoffUntil: backoffUntil
      };
    }
  };
};

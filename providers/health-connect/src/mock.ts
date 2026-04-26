import type { ProviderManifest } from "@openvitals/contracts";
import { createMockCollector } from "@openvitals/runtime";

export const createHealthConnectMockCollector = (manifest: ProviderManifest) => createMockCollector(manifest);

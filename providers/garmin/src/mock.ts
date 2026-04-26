import type { ProviderManifest } from "@openvitals/contracts";
import { createMockCollector } from "@openvitals/runtime";

export const createMockProviderCollector = (manifest: ProviderManifest) => createMockCollector(manifest);

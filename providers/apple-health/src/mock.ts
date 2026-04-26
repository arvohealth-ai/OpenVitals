import type { ProviderManifest } from "@openvitals/contracts";
import { createMockCollector } from "@openvitals/runtime";

export const createAppleHealthMockCollector = (manifest: ProviderManifest) => createMockCollector(manifest);

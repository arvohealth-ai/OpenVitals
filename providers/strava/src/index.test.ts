import { assertProviderContract } from "../../_test/contract.js";
import { collector, manifest } from "./index.js";

assertProviderContract({
  expectedProviderId: "strava",
  manifest,
  collector
});

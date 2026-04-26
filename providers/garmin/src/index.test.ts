import { assertProviderContract } from "../../_test/contract.js";
import { collector, manifest } from "./index.js";

assertProviderContract({
  expectedProviderId: "garmin",
  manifest,
  collector
});

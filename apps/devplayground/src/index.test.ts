import { renderDevPlaygroundPage } from "./index.js";

describe("dev playground page", () => {
  it("includes dashboard-state probing and quality summaries", () => {
    const html = renderDevPlaygroundPage("http://localhost:3000");

    expect(html).toContain("/v1/dashboard/state?userId=user_ada");
    expect(html).toContain("Quality summary");
    expect(html).toContain("dataQualityGate");
    expect(html).toContain("syncFreshnessHours");
    expect(html).toContain("confidence");
  });
});

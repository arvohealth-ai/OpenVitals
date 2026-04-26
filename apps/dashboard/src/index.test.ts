import { renderDashboardPage } from "./index.js";

describe("dashboard page", () => {
  it("surfaces data-quality and confidence context", () => {
    const html = renderDashboardPage("http://localhost:3000");

    expect(html).toContain("Data Quality");
    expect(html).toContain("dataQualityGate");
    expect(html).toContain("syncFreshnessHours");
    expect(html).toContain("confidence");
    expect(html).toContain("dataGranularity");
    expect(html).toContain("latencyClass");
  });
});

import { createApi } from "./index.js";

describe("createApi", () => {
  it("creates the fastify instance", async () => {
    const { app } = await createApi({ now: new Date("2026-03-19T08:00:00.000Z"), dbPath: ":memory:" });
    expect(app).toBeDefined();
    await app.close();
  });
});

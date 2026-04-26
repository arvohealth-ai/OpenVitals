import { providerCredentialsTable } from "./schema.js";
import { createStore } from "./db.js";

describe("provider credential store", () => {
  it("encrypts provider credentials at rest and decrypts them on read", async () => {
    const originalSecretsKey = process.env.OPENVITALS_SECRETS_KEY;
    process.env.OPENVITALS_SECRETS_KEY = "test-provider-credential-key";
    const store = await createStore(":memory:");

    try {
      const credential = {
        id: "provider_credential_whoop_user_ada",
        userId: "user_ada",
        providerId: "whoop" as const,
        authState: "connected" as const,
        connectionMethod: "oauth" as const,
        accessToken: "whoop-access-token",
        refreshToken: "whoop-refresh-token",
        expiresAt: "2026-03-20T08:00:00.000Z",
        scopes: ["read:sleep", "read:recovery"],
        externalUserId: "whoop-user-123",
        lastRefreshAt: null,
        lastRefreshError: null,
        createdAt: "2026-03-19T08:00:00.000Z",
        updatedAt: "2026-03-19T08:00:00.000Z"
      };

      await store.upsertProviderCredential(credential);

      const rawRows = await store.db.select().from(providerCredentialsTable);
      expect(rawRows).toHaveLength(1);
      expect(rawRows[0]?.payload).toContain("\"accessToken\":\"v1:");
      expect(rawRows[0]?.payload).not.toContain("whoop-access-token");
      expect(rawRows[0]?.payload).not.toContain("whoop-refresh-token");

      const loaded = await store.getProviderCredential("user_ada", "whoop");
      expect(loaded).toEqual(credential);
    } finally {
      if (originalSecretsKey === undefined) {
        delete process.env.OPENVITALS_SECRETS_KEY;
      } else {
        process.env.OPENVITALS_SECRETS_KEY = originalSecretsKey;
      }
    }
  });

  it("keeps provider credentials isolated per user and provider", async () => {
    const originalSecretsKey = process.env.OPENVITALS_SECRETS_KEY;
    process.env.OPENVITALS_SECRETS_KEY = "test-provider-credential-key";
    const store = await createStore(":memory:");

    try {
      await store.upsertProviderCredential({
        id: "provider_credential_whoop_user_owner",
        userId: "user_owner",
        providerId: "whoop",
        authState: "connected",
        connectionMethod: "oauth",
        accessToken: "owner-access",
        refreshToken: "owner-refresh",
        expiresAt: "2026-03-20T08:00:00.000Z",
        scopes: ["read:sleep"],
        externalUserId: "owner-external",
        lastRefreshAt: null,
        lastRefreshError: null,
        createdAt: "2026-03-19T08:00:00.000Z",
        updatedAt: "2026-03-19T08:00:00.000Z"
      });
      await store.upsertProviderCredential({
        id: "provider_credential_whoop_user_kid",
        userId: "user_kid",
        providerId: "whoop",
        authState: "connected",
        connectionMethod: "oauth",
        accessToken: "kid-access",
        refreshToken: "kid-refresh",
        expiresAt: "2026-03-20T08:00:00.000Z",
        scopes: ["read:sleep"],
        externalUserId: "kid-external",
        lastRefreshAt: null,
        lastRefreshError: null,
        createdAt: "2026-03-19T08:00:00.000Z",
        updatedAt: "2026-03-19T08:00:00.000Z"
      });

      expect((await store.listProviderCredentials()).map((row) => row.userId).sort()).toEqual(["user_kid", "user_owner"]);
      expect((await store.getProviderCredential("user_owner", "whoop"))?.accessToken).toBe("owner-access");
      expect((await store.getProviderCredential("user_kid", "whoop"))?.accessToken).toBe("kid-access");

      await store.deleteProviderCredentials("user_owner");

      expect(await store.getProviderCredential("user_owner", "whoop")).toBeNull();
      expect((await store.getProviderCredential("user_kid", "whoop"))?.accessToken).toBe("kid-access");
    } finally {
      if (originalSecretsKey === undefined) {
        delete process.env.OPENVITALS_SECRETS_KEY;
      } else {
        process.env.OPENVITALS_SECRETS_KEY = originalSecretsKey;
      }
    }
  });
});

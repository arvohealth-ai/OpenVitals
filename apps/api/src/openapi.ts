import { zodToJsonSchema } from "zod-to-json-schema";

import {
  AgentTokenSchema,
  AlertSchema,
  ConnectCallbackInputSchema,
  ConnectCallbackResponseSchema,
  ConnectSessionResponseSchema,
  ConnectStartResponseSchema,
  ConnectorsResponseSchema,
  DailySummarySchema,
  DedupeDecisionSchema,
  ExplainResponseSchema,
  HouseholdBootstrapInputSchema,
  HouseholdBootstrapResultSchema,
  IngestBatchInputSchema,
  IngestBatchResultSchema,
  IngestFailureSchema,
  OutboxEventSchema,
  ProfilesListResponseSchema,
  SourceFilterSchema,
  SourcePrecedenceInputSchema,
  SourcePrecedenceOverrideSchema,
  SyncStatusResponseSchema,
  TimelineEntrySchema,
  ScoreSchema,
  WebhookDeliverySchema,
  WebhookEndpointSchema
} from "@openvitals/contracts";

const toJsonSchema = (schema: unknown, name: string) => zodToJsonSchema(schema as never, name);

const stable = <T extends Record<string, unknown>>(operation: T) =>
  ({
    ...operation,
    "x-api-track": "stable"
  }) as T & { "x-api-track": "stable" };

const experimental = <T extends Record<string, unknown>>(operation: T) =>
  ({
    ...operation,
    "x-api-track": "experimental"
  }) as T & { "x-api-track": "experimental" };

export const createOpenApiDocument = (baseUrl: string) => ({
  openapi: "3.1.0",
  info: {
    title: "OpenVitals API",
    version: "0.5.0",
    description: "Agent-native health operating system API focused on the Apple Health + WHOOP live wedge."
  },
  servers: [{ url: baseUrl }],
  paths: {
    "/v1/users": {
      get: stable({
        summary: "List accessible profiles for the current token.",
        responses: {
          "200": {
            description: "Profile summaries",
            content: {
              "application/json": {
                schema: toJsonSchema(ProfilesListResponseSchema, "ProfilesListResponse")
              }
            }
          }
        }
      })
    },
    "/v1/household/bootstrap": {
      post: stable({
        summary: "Bootstrap owner + family profiles in one call.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: toJsonSchema(HouseholdBootstrapInputSchema, "HouseholdBootstrapInput")
            }
          }
        },
        responses: {
          "200": {
            description: "Household bootstrap result",
            content: {
              "application/json": {
                schema: toJsonSchema(HouseholdBootstrapResultSchema, "HouseholdBootstrapResult")
              }
            }
          }
        }
      })
    },
    "/v1/users/{id}/connect/{provider}/session": {
      post: stable({
        summary: "Create a connector session token for mobile ingest.",
        responses: {
          "200": {
            description: "Connector session",
            content: {
              "application/json": {
                schema: toJsonSchema(ConnectSessionResponseSchema, "ConnectSessionResponse")
              }
            }
          }
        }
      })
    },
    "/v1/users/{id}/connect/{provider}/start": {
      post: stable({
        summary: "Start connector handshake for mobile SDK ingest or WHOOP OAuth.",
        responses: {
          "200": {
            description: "Connect start response",
            content: {
              "application/json": {
                schema: toJsonSchema(ConnectStartResponseSchema, "ConnectStartResponse")
              }
            }
          }
        }
      })
    },
    "/v1/users/{id}/connect/{provider}/callback": {
      post: stable({
        summary: "Finalize provider callback, persist credential metadata, and mark the source connected.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: toJsonSchema(ConnectCallbackInputSchema, "ConnectCallbackInput")
            }
          }
        },
        responses: {
          "200": {
            description: "Connect callback result",
            content: {
              "application/json": {
                schema: toJsonSchema(ConnectCallbackResponseSchema, "ConnectCallbackResponse")
              }
            }
          }
        }
      })
    },
    "/v1/connect/callback/whoop": {
      get: stable({
        summary: "Browser redirect endpoint for WHOOP OAuth that completes the per-user credential exchange.",
        parameters: [
          { name: "code", in: "query", required: false, schema: { type: "string" } },
          { name: "state", in: "query", required: false, schema: { type: "string" } },
          { name: "error", in: "query", required: false, schema: { type: "string" } },
          { name: "error_description", in: "query", required: false, schema: { type: "string" } }
        ],
        responses: {
          "200": {
            description: "Connect callback result",
            content: {
              "application/json": {
                schema: toJsonSchema(ConnectCallbackResponseSchema, "ConnectCallbackResponse")
              }
            }
          }
        }
      })
    },
    "/v1/users/{id}/ingest/{provider}": {
      post: stable({
        summary: "Ingest a mobile batch with session and anchor metadata. Apple mirrored records require bundleId.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: toJsonSchema(IngestBatchInputSchema, "IngestBatchInput")
            }
          }
        },
        responses: {
          "200": {
            description: "Ingest result",
            content: {
              "application/json": {
                schema: toJsonSchema(IngestBatchResultSchema, "IngestBatchResult")
              }
            }
          }
        }
      })
    },
    "/v1/users/{id}/providers/whoop/webhook": {
      post: stable({
        summary: "Receive WHOOP webhook events and trigger incremental sync.",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object"
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Webhook accepted and sync triggered",
            content: {
              "application/json": {
                schema: {
                  type: "object"
                }
              }
            }
          }
        }
      })
    },
    "/v1/users/{id}/sync-status": {
      get: stable({
        summary: "Get connector sync freshness, anchor, authState, connectionMethod, and credential status.",
        responses: {
          "200": {
            description: "Sync status",
            content: {
              "application/json": {
                schema: toJsonSchema(SyncStatusResponseSchema, "SyncStatusResponse")
              }
            }
          }
        }
      })
    },
    "/v1/users/{id}/source-filters": {
      put: stable({
        summary: "Update mirrored-source ignore list for a provider.",
        responses: {
          "200": {
            description: "Source filter",
            content: {
              "application/json": {
                schema: toJsonSchema(SourceFilterSchema, "SourceFilter")
              }
            }
          }
        }
      })
    },
    "/v1/users/{id}/source-precedence": {
      put: stable({
        summary: "Update per-user capture_mode dedupe precedence override.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: toJsonSchema(SourcePrecedenceInputSchema, "SourcePrecedenceInput")
            }
          }
        },
        responses: {
          "200": {
            description: "Source precedence override",
            content: {
              "application/json": {
                schema: toJsonSchema(SourcePrecedenceOverrideSchema, "SourcePrecedenceOverride")
              }
            }
          }
        }
      })
    },
    "/v1/connectors": {
      get: stable({
        summary: "List connectors, devices, policy, and runtime descriptors for a user.",
        parameters: [{ name: "userId", in: "query", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Connector view",
            content: {
              "application/json": {
                schema: toJsonSchema(ConnectorsResponseSchema, "ConnectorsResponse")
              }
            }
          }
        }
      })
    },
    "/v1/dashboard/state": {
      get: stable({
        summary: "Derived-scope dashboard payload with connectors, scores, alerts, explainability, and automation runs.",
        parameters: [{ name: "userId", in: "query", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Dashboard state",
            content: {
              "application/json": {
                schema: {
                  type: "object"
                }
              }
            }
          }
        }
      })
    },
    "/v1/live/bootstrap": {
      post: stable({
        summary: "Bootstrap live mode with an initial user, source accounts, and optional agent tokens.",
        responses: {
          "200": {
            description: "Live bootstrap result",
            content: {
              "application/json": {
                schema: {
                  type: "object"
                }
              }
            }
          }
        }
      })
    },
    "/v1/timeline": {
      get: stable({
        summary: "List deduped timeline entries.",
        responses: {
          "200": {
            description: "Timeline entries",
            content: {
              "application/json": {
                schema: toJsonSchema(TimelineEntrySchema.array(), "TimelineEntries")
              }
            }
          }
        }
      })
    },
    "/v1/summaries/daily": {
      get: stable({
        summary: "List derived daily summaries.",
        responses: {
          "200": {
            description: "Daily summaries",
            content: {
              "application/json": {
                schema: toJsonSchema(DailySummarySchema.array(), "DailySummaries")
              }
            }
          }
        }
      })
    },
    "/v1/scores": {
      get: stable({
        summary: "List derived scores.",
        responses: {
          "200": {
            description: "Scores",
            content: {
              "application/json": {
                schema: toJsonSchema(ScoreSchema.array(), "Scores")
              }
            }
          }
        }
      })
    },
    "/v1/alerts": {
      get: stable({
        summary: "List alert workflows.",
        responses: {
          "200": {
            description: "Alerts",
            content: {
              "application/json": {
                schema: toJsonSchema(AlertSchema.array(), "Alerts")
              }
            }
          }
        }
      })
    },
    "/v1/explain/{entity}/{id}": {
      get: stable({
        summary: "Explain provenance and evidence for a record.",
        responses: {
          "200": {
            description: "Explain response",
            content: {
              "application/json": {
                schema: toJsonSchema(ExplainResponseSchema, "ExplainResponse")
              }
            }
          }
        }
      })
    },
    "/v1/explain-dedupe/{fingerprint}": {
      get: stable({
        summary: "Explain dedupe decision details for a fingerprint.",
        responses: {
          "200": {
            description: "Dedupe explain payload",
            content: {
              "application/json": {
                schema: toJsonSchema(DedupeDecisionSchema, "DedupeDecision")
              }
            }
          }
        }
      })
    },
    "/v1/webhooks": {
      get: stable({
        summary: "List webhook endpoints.",
        responses: {
          "200": {
            description: "Webhook endpoints",
            content: {
              "application/json": {
                schema: toJsonSchema(WebhookEndpointSchema.array(), "WebhookEndpoints")
              }
            }
          }
        }
      }),
      post: stable({
        summary: "Create a webhook endpoint.",
        responses: {
          "200": {
            description: "Webhook endpoint",
            content: {
              "application/json": {
                schema: toJsonSchema(WebhookEndpointSchema, "WebhookEndpoint")
              }
            }
          }
        }
      })
    },
    "/v1/users/{id}/sync": {
      post: stable({
        summary: "Run incremental/history sync for one provider or all.",
        responses: {
          "200": {
            description: "Sync result",
            content: {
              "application/json": {
                schema: {
                  type: "object"
                }
              }
            }
          }
        }
      })
    },
    "/v1/alerts/{id}/ack": {
      post: stable({
        summary: "Acknowledge an alert.",
        responses: {
          "200": {
            description: "Updated alert",
            content: {
              "application/json": {
                schema: toJsonSchema(AlertSchema, "Alert")
              }
            }
          }
        }
      })
    },
    "/v1/export/omh": {
      get: stable({
        summary: "Export OMH-shaped payload.",
        responses: {
          "200": {
            description: "OMH export",
            content: {
              "application/json": {
                schema: {
                  type: "object"
                }
              }
            }
          }
        }
      })
    },
    "/v1/export/fhir": {
      get: stable({
        summary: "Export FHIR Bundle.",
        responses: {
          "200": {
            description: "FHIR bundle",
            content: {
              "application/json": {
                schema: {
                  type: "object"
                }
              }
            }
          }
        }
      })
    },
    "/v1/webhooks/{id}": {
      patch: stable({
        summary: "Update webhook endpoint.",
        responses: {
          "200": {
            description: "Webhook endpoint",
            content: {
              "application/json": {
                schema: toJsonSchema(WebhookEndpointSchema, "WebhookEndpoint")
              }
            }
          }
        }
      }),
      delete: stable({
        summary: "Delete webhook endpoint.",
        responses: {
          "204": {
            description: "Deleted"
          }
        }
      })
    },
    "/v1/webhooks/{id}/test": {
      post: stable({
        summary: "Preview test webhook payload.",
        responses: {
          "200": {
            description: "Webhook test event",
            content: {
              "application/json": {
                schema: {
                  type: "object"
                }
              }
            }
          }
        }
      })
    },
    "/v1/goals": {
      post: stable({
        summary: "Create a lightweight wellness goal.",
        responses: {
          "200": {
            description: "Goal result",
            content: {
              "application/json": {
                schema: {
                  type: "object"
                }
              }
            }
          }
        }
      })
    },
    "/v1/quiet-hours": {
      post: stable({
        summary: "Update quiet hours for user automations.",
        responses: {
          "200": {
            description: "Updated automations",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object"
                  }
                }
              }
            }
          }
        }
      })
    },
    "/v1/events/stream": {
      get: stable({
        summary: "SSE outbox stream with cursor support via query param after=<sequence>.",
        responses: {
          "200": {
            description: "SSE stream"
          }
        }
      })
    },
    "/v1/experimental/outbox/events": {
      get: experimental({
        summary: "List persisted outbox events using sequence cursors.",
        responses: {
          "200": {
            description: "Outbox events",
            content: {
              "application/json": {
                schema: toJsonSchema(OutboxEventSchema.array(), "OutboxEvents")
              }
            }
          }
        }
      })
    },
    "/v1/experimental/webhook-deliveries": {
      get: experimental({
        summary: "List webhook delivery attempts and retry traces.",
        responses: {
          "200": {
            description: "Webhook deliveries",
            content: {
              "application/json": {
                schema: toJsonSchema(WebhookDeliverySchema.array(), "WebhookDeliveries")
              }
            }
          }
        }
      })
    },
    "/v1/experimental/scheduler/status": {
      get: experimental({
        summary: "Read scheduler state for a user.",
        parameters: [{ name: "userId", in: "query", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Scheduler status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    userId: { type: "string" },
                    enabled: { type: "boolean" },
                    leader: { type: "boolean" },
                    lastTickAt: { type: ["string", "null"], format: "date-time" },
                    nextTickAt: { type: ["string", "null"], format: "date-time" },
                    lastError: { type: ["string", "null"] },
                    lastRunSummary: { type: ["object", "null"], additionalProperties: true }
                  },
                  required: ["userId", "enabled", "leader", "lastTickAt", "nextTickAt", "lastError", "lastRunSummary"]
                }
              }
            }
          }
        }
      })
    },
    "/v1/experimental/scheduler/run": {
      post: experimental({
        summary: "Run scheduler jobs manually for debugging and regression checks.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  userId: { type: "string" },
                  job: { type: "string", enum: ["tick", "daily", "weekly", "stale", "all"], default: "all" },
                  dryRun: { type: "boolean", default: false }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Scheduler run result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    dryRun: { type: "boolean" },
                    runs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          userId: { type: ["string", "null"] },
                          job: { type: "string" },
                          status: { type: "string", enum: ["succeeded", "failed"] },
                          startedAt: { type: "string", format: "date-time" },
                          finishedAt: { type: "string", format: "date-time" },
                          durationMs: { type: "number" },
                          dryRun: { type: "boolean" },
                          emittedEvents: { type: "number" },
                          error: { type: ["string", "null"] },
                          summary: { type: ["object", "null"], additionalProperties: true }
                        },
                        required: [
                          "id",
                          "userId",
                          "job",
                          "status",
                          "startedAt",
                          "finishedAt",
                          "durationMs",
                          "dryRun",
                          "emittedEvents",
                          "error",
                          "summary"
                        ]
                      }
                    }
                  },
                  required: ["dryRun", "runs"]
                }
              }
            }
          }
        }
      })
    },
    "/v1/experimental/scheduler/runs": {
      get: experimental({
        summary: "List recent scheduler executions.",
        parameters: [
          { name: "userId", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "number", default: 50, maximum: 500 } }
        ],
        responses: {
          "200": {
            description: "Scheduler run records",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      userId: { type: ["string", "null"] },
                      job: { type: "string" },
                      status: { type: "string", enum: ["succeeded", "failed"] },
                      startedAt: { type: "string", format: "date-time" },
                      finishedAt: { type: "string", format: "date-time" },
                      durationMs: { type: "number" },
                      dryRun: { type: "boolean" },
                      emittedEvents: { type: "number" },
                      error: { type: ["string", "null"] },
                      summary: { type: ["object", "null"], additionalProperties: true }
                    },
                    required: [
                      "id",
                      "userId",
                      "job",
                      "status",
                      "startedAt",
                      "finishedAt",
                      "durationMs",
                      "dryRun",
                      "emittedEvents",
                      "error",
                      "summary"
                    ]
                  }
                }
              }
            }
          }
        }
      })
    },
    "/v1/experimental/ingest-failures": {
      get: experimental({
        summary: "List ingest failures available for replay.",
        responses: {
          "200": {
            description: "Ingest failures",
            content: {
              "application/json": {
                schema: toJsonSchema(IngestFailureSchema.array(), "IngestFailures")
              }
            }
          }
        }
      })
    },
    "/v1/experimental/agent-tokens": {
      get: experimental({
        summary: "List agent tokens.",
        responses: {
          "200": {
            description: "Agent tokens",
            content: {
              "application/json": {
                schema: toJsonSchema(AgentTokenSchema.array(), "AgentTokens")
              }
            }
          }
        }
      }),
      post: experimental({
        summary: "Create agent token.",
        responses: {
          "200": {
            description: "Created token",
            content: {
              "application/json": {
                schema: {
                  type: "object"
                }
              }
            }
          }
        }
      })
    }
  }
});

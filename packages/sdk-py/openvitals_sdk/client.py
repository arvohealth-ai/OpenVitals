from datetime import datetime, timezone

import httpx


STALE_THRESHOLD_HOURS = 24
CLOUD_PROVIDERS = {"oura", "whoop", "garmin", "strava"}
MOBILE_PROVIDERS = {"apple-health", "health-connect"}


def _round_hours(value: float | int) -> float:
    return max(round(float(value) * 10) / 10, 0.0)


def _effective_connection_mode_for_source(source: dict) -> str:
    connection_mode = source.get("connectionMode", "mock")
    connection_method = source.get("connectionMethod", "mock")
    provider_id = source.get("providerId")
    if connection_mode != "mock" or connection_method == "mock":
        return connection_mode
    if connection_method == "sdk-ingest" and provider_id in MOBILE_PROVIDERS:
        return "mobile_permission"
    if connection_method == "oauth":
        return "cloud_oauth"
    if connection_method == "bridge":
        return "device_pairing"
    return connection_mode


def _live_signal_capable_for_source(source: dict) -> bool:
    return any(
        capability.get("dataGranularity") == "live_signal" and capability.get("latencyClass") == "live"
        for capability in source.get("metricCapabilities", [])
    )


def _live_signal_active_for_source(source: dict) -> bool:
    return (
        source.get("providerId") == "apple-health"
        and source.get("connectionMethod") == "sdk-ingest"
        and _effective_connection_mode_for_source(source) == "device_pairing"
    )


def _data_granularity_for_source(source: dict) -> str:
    if _live_signal_active_for_source(source):
        return "live_signal"
    if source.get("connectionMethod") == "sdk-ingest" and source.get("providerId") in MOBILE_PROVIDERS:
        return "sample"
    return "provider_payload"


def _latency_class_for_source(source: dict) -> str:
    provider_id = source.get("providerId")
    freshness_hours = float(source.get("syncFreshnessHours") or 0)
    if _live_signal_active_for_source(source):
        return "live"
    if source.get("connectionMethod") == "mock":
        return "manual"
    if source.get("connectionMethod") == "sdk-ingest" and provider_id in MOBILE_PROVIDERS and freshness_hours <= 1:
        return "near_realtime"
    if provider_id in CLOUD_PROVIDERS:
        return "delayed_sync"
    return "daily" if freshness_hours >= STALE_THRESHOLD_HOURS else "delayed_sync"


def _companion_role_for_source(source: dict) -> str:
    if _live_signal_active_for_source(source):
        return "optional_watch_live_workout"
    if source.get("providerId") == "apple-health" and source.get("connectionMethod") == "sdk-ingest":
        return "iphone_companion"
    if source.get("providerId") == "health-connect" and source.get("connectionMethod") == "sdk-ingest":
        return "android_companion"
    if source.get("connectionMethod") == "mock" or source.get("dataMode") != "live":
        return "mock_or_demo"
    return "cloud_connector"


def _confidence_note_for_source(source: dict, stale: bool) -> str:
    provider_id = source.get("providerId")
    if source.get("dataMode") != "live":
        return "Demo or mock data; do not present as hardware-backed live telemetry."
    if _live_signal_active_for_source(source):
        if stale:
            return "Optional Apple Watch live-workout signal is stale; stop live claims until fresh workout samples arrive."
        return "Optional Apple Watch live-workout heart-rate is active and may be described as live_signal/live."
    if provider_id == "apple-health" and source.get("connectionMethod") == "sdk-ingest":
        if stale:
            return "iPhone companion Apple Health samples are stale; ask the user to open the iPhone app or run Sync Now."
        return "Apple Health is connected through the iPhone companion; historical Apple Watch samples remain HealthKit samples, not live streams."
    if source.get("connectionMethod") == "sdk-ingest" and provider_id in MOBILE_PROVIDERS:
        if stale:
            return "Mobile platform samples exist but are stale; defer confident coaching until a fresh sync completes."
        return "Mobile platform samples are recently synced; do not call them real-time unless a live workout stream is explicit."
    if provider_id in CLOUD_PROVIDERS:
        if stale:
            return "Cloud provider payload is stale or incomplete; avoid current-state claims."
        return "Cloud provider payload is delayed/provider-mediated rather than continuous raw sensor streaming."
    return "Source is stale or missing; avoid high-confidence guidance." if stale else "Source freshness is acceptable for derived guidance."


def _companion_note_for_source(source: dict, live_signal_capable: bool, live_signal_active: bool) -> str:
    provider_id = source.get("providerId")
    if provider_id == "apple-health":
        if live_signal_active:
            return "Optional Apple Watch workout mode is providing live heart-rate samples; this is the only Apple Health path that should be called live."
        if live_signal_capable:
            return "Apple Health uses the iPhone companion for normal sync. The Apple Watch app is optional and only required for live workout heart-rate; historical Watch samples arrive through HealthKit on iPhone."
        return "Apple Health uses the iPhone companion for HealthKit authorization, historical sync, background/incremental sync, and manual Sync Now."
    if provider_id == "health-connect":
        return "Health Connect uses the Android/mobile companion path; treat samples as platform sync data unless a live signal is explicit."
    if provider_id in CLOUD_PROVIDERS:
        return "Cloud provider data is delayed/provider-mediated and should not be described as continuous raw sensor streaming."
    return "Use source freshness and data-quality gates before giving coaching advice."


def summarize_sync_status_semantics(sync_status: dict, generated_at: datetime | None = None) -> dict:
    generated_at = generated_at or datetime.now(timezone.utc)
    sources = []
    for source in sync_status.get("sources", []):
        freshness_hours = _round_hours(source.get("syncFreshnessHours") or 0)
        data_quality_gate = source.get("dataQualityGate", "ok")
        stale = data_quality_gate != "ok" or freshness_hours >= STALE_THRESHOLD_HOURS
        connection_mode = _effective_connection_mode_for_source(source)
        live_signal_capable = _live_signal_capable_for_source(source)
        live_signal_active = _live_signal_active_for_source(source)
        sources.append(
            {
                "providerId": source.get("providerId"),
                "dataMode": source.get("dataMode", "demo"),
                "connectionMethod": source.get("connectionMethod", "mock"),
                "connectionMode": connection_mode,
                "dataGranularity": _data_granularity_for_source(source),
                "latencyClass": _latency_class_for_source(source),
                "freshnessHours": freshness_hours,
                "dataQualityGate": data_quality_gate,
                "stale": stale,
                "stalenessReason": source.get("stalenessReason") or ("freshness_or_quality_gate" if stale else None),
                "lastSyncAt": source.get("lastSyncAt"),
                "lastSuccessfulSyncAt": source.get("lastSuccessfulSyncAt"),
                "queueDepth": source.get("queueDepth", 0),
                "companionRole": _companion_role_for_source(source),
                "liveSignalCapable": live_signal_capable,
                "liveSignalActive": live_signal_active,
                "confidenceNote": _confidence_note_for_source(source, stale),
                "companionNote": _companion_note_for_source(source, live_signal_capable, live_signal_active),
            }
        )

    stale_providers = [source["providerId"] for source in sources if source["stale"] or source["dataQualityGate"] == "stale"]
    missing_providers = [source["providerId"] for source in sources if source["dataQualityGate"] == "missing"]
    delayed_providers = [source["providerId"] for source in sources if source["latencyClass"] in {"delayed_sync", "daily"}]
    live_signal_providers = [source["providerId"] for source in sources if source["dataGranularity"] == "live_signal"]
    live_signal_capable_providers = [source["providerId"] for source in sources if source["liveSignalCapable"]]
    gate_open = not stale_providers and not missing_providers

    return {
        "userId": sync_status.get("userId"),
        "generatedAt": generated_at.isoformat().replace("+00:00", "Z"),
        "staleThresholdHours": STALE_THRESHOLD_HOURS,
        "gateOpen": gate_open,
        "gateReason": None if gate_open else "stale_or_missing_data",
        "staleProviders": stale_providers,
        "missingProviders": missing_providers,
        "delayedProviders": delayed_providers,
        "liveSignalProviders": live_signal_providers,
        "liveSignalCapableProviders": live_signal_capable_providers,
        "iphoneCompanionRequired": any(source["providerId"] == "apple-health" for source in sources),
        "watchAppRequiredForHistoricalSync": False,
        "watchAppRequiredForLiveWorkoutHr": "apple-health" in live_signal_capable_providers,
        "sources": sources,
    }


def summarize_explanation_semantics(explanation: dict) -> dict:
    payload = explanation.get("payload", {})
    entity = explanation.get("entity")
    data_granularity = {
        "score": "score",
        "daily_summary": "daily_summary",
        "episode": "episode",
        "observation": "sample",
    }.get(entity, "provider_payload")
    freshness_hours = payload.get("freshnessHours")
    freshness_hours = _round_hours(freshness_hours) if isinstance(freshness_hours, (int, float)) else None
    missing_signals = [item for item in payload.get("missingSignals", []) if isinstance(item, str)]
    stale = (freshness_hours or 0) >= STALE_THRESHOLD_HOURS or bool(missing_signals)
    return {
        "entity": entity,
        "id": explanation.get("id"),
        "dataGranularity": data_granularity,
        "latencyClass": "daily" if data_granularity in {"score", "daily_summary"} or stale else "delayed_sync",
        "freshnessHours": freshness_hours,
        "stale": stale,
        "stalenessReason": "missing_signals" if missing_signals else "freshness_threshold_exceeded" if stale else None,
        "confidence": payload.get("confidence") if isinstance(payload.get("confidence"), (int, float)) else None,
        "missingSignals": missing_signals,
        "suppressedSources": explanation.get("suppressedSources", []),
        "mirroredOrSuppressed": bool(explanation.get("suppressedSources") or explanation.get("suppressedRecords")),
    }


class OpenVitalsClient:
    def __init__(self, base_url: str, agent_token: str | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.agent_token = agent_token

    def _get(self, path: str, params: dict | None = None):
        response = httpx.get(f"{self.base_url}{path}", params=params, headers=self._headers(), timeout=30)
        response.raise_for_status()
        return response.json()

    def _post(self, path: str, payload: dict | None = None):
        response = httpx.post(f"{self.base_url}{path}", json=payload or {}, headers=self._headers(), timeout=30)
        response.raise_for_status()
        return response.json()

    def _put(self, path: str, payload: dict | None = None):
        response = httpx.put(f"{self.base_url}{path}", json=payload or {}, headers=self._headers(), timeout=30)
        response.raise_for_status()
        return response.json()

    def _headers(self) -> dict:
        if not self.agent_token:
            return {}
        return {"authorization": f"Bearer {self.agent_token}"}

    def connectors(self, user_id: str):
        return self._get("/v1/connectors", {"userId": user_id})

    def users(self):
        return self._get("/v1/users")

    def timeline(self, user_id: str, days: int = 14):
        return self._get("/v1/timeline", {"userId": user_id, "days": days})

    def scores(self, user_id: str, kind: str | None = None):
        params = {"userId": user_id}
        if kind:
            params["kind"] = kind
        return self._get("/v1/scores", params)

    def alerts(self, user_id: str):
        return self._get("/v1/alerts", {"userId": user_id})

    def sync_user(self, user_id: str, provider_id: str | None = None, mode: str = "incremental"):
        payload = {"mode": mode}
        if provider_id:
            payload["providerId"] = provider_id
        return self._post(f"/v1/users/{user_id}/sync", payload)

    def create_connector_session(self, user_id: str, provider_id: str):
        return self._post(f"/v1/users/{user_id}/connect/{provider_id}/session")

    def connect_start(self, user_id: str, provider_id: str):
        return self._post(f"/v1/users/{user_id}/connect/{provider_id}/start")

    def connect_callback(self, user_id: str, provider_id: str, payload: dict):
        return self._post(f"/v1/users/{user_id}/connect/{provider_id}/callback", payload)

    def ingest_batch(self, user_id: str, provider_id: str, payload: dict):
        return self._post(f"/v1/users/{user_id}/ingest/{provider_id}", payload)

    def whoop_webhook(self, user_id: str, payload: dict | None = None, signature: str | None = None, admin_token: str | None = None):
        headers = self._headers()
        if signature:
            headers["x-openvitals-whoop-signature"] = signature
        if admin_token:
            headers["x-openvitals-admin"] = admin_token
        response = httpx.post(
            f"{self.base_url}/v1/users/{user_id}/providers/whoop/webhook",
            json=payload or {},
            headers=headers,
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

    def sync_status(self, user_id: str):
        return self._get(f"/v1/users/{user_id}/sync-status")

    def signal_freshness(self, user_id: str):
        sync_status = self.sync_status(user_id)
        return {**sync_status, "semantics": summarize_sync_status_semantics(sync_status)}

    def set_source_filter(self, user_id: str, provider_id: str, ignored_sources: list[str]):
        return self._put(
            f"/v1/users/{user_id}/source-filters",
            {"providerId": provider_id, "ignoredSources": ignored_sources},
        )

    def set_source_precedence(self, user_id: str, precedence: dict):
        return self._put(
            f"/v1/users/{user_id}/source-precedence",
            {"precedence": precedence},
        )

    def outbox_events(self, user_id: str, after: int = 0, limit: int = 200):
        return self._get("/v1/experimental/outbox/events", {"userId": user_id, "after": after, "limit": limit})

    def explain(self, entity: str, entity_id: str):
        return self._get(f"/v1/explain/{entity}/{entity_id}")

    def explain_with_semantics(self, entity: str, entity_id: str):
        explanation = self.explain(entity, entity_id)
        return {**explanation, "semantics": summarize_explanation_semantics(explanation)}

    def webhook_deliveries(self, event_id: str | None = None, webhook_id: str | None = None):
        params = {}
        if event_id:
            params["eventId"] = event_id
        if webhook_id:
            params["webhookId"] = webhook_id
        return self._get("/v1/experimental/webhook-deliveries", params or None)

    def household_bootstrap(self, payload: dict, admin_token: str = "openvitals-dev-admin"):
        response = httpx.post(
            f"{self.base_url}/v1/household/bootstrap",
            json=payload,
            headers={**self._headers(), "x-openvitals-admin": admin_token},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

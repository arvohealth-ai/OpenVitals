# Local Personal Health Agent

This example treats OpenVitals as the local health substrate for another agent.

## Suggested loop

1. Fetch `/v1/alerts?userId=user_ada`
2. Fetch `/v1/scores?userId=user_ada`
3. Fetch `/v1/users/user_ada/sync-status` and inspect `dataQualityGate`
4. If `sync_stale_alert` exists or any source gate is `stale`/`missing`, stop coaching and ask for fresh data
5. Otherwise use `/v1/explain/score/:id` to generate an evidence-backed daily brief

## Minimal curl

```bash
TOKEN="ov_demo_user_ada_derived"
curl -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/v1/alerts?userId=user_ada"
curl -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/v1/users/user_ada/sync-status"
curl -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/v1/explain/score/score_recovery_readiness"
curl -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:3000/v1/experimental/outbox/events?userId=user_ada&after=0"
```

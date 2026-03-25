# x402 API Pre-Launch Checklist (Pass/Fail Gates)

Use this as a hard go/no-go rubric.

Launch rule: public launch only if all `P0` gates pass.

## 1) `P0` Packaging and deployability

Pass when service runs from a standalone package/container and does not require patching global `npm -g` files.

Fail if production depends on manual edits in `node_modules`.

## 2) `P0` IPC safety and isolation

Pass when IPC paths are under `%LOCALAPPDATA%` (or service account profile), not `C:\tmp`, with ACLs locked to service user and admins only.

Fail if any local user can read or write request/response files.

## 3) `P0` Request integrity and anti-replay

Pass when each request is authenticated (HMAC/signature), includes nonce/timestamp, and rejects stale or replayed payloads.

Fail if copied JSON requests can be replayed successfully.

## 4) `P0` Idempotent billing behavior

Pass when retries cannot double-charge and each paid request has a deterministic idempotency key.

Fail if timeout/retry can create multiple billable executions.

## 5) `P0` Reliability under Windows/RDP constraints

Pass when watch+poll fallback is implemented and a 24-hour soak test completes with no stuck requests.

Fail if request files can age out without a response.

## 6) `P0` Observability and alerting

Pass when logs/metrics exist for request count, success rate, timeout rate, p95 latency, and charge failures, with active alerts.

Fail if failures are not detectable within 5 minutes.

## 7) `P0` Secret and key handling

Pass when secrets are in env/secret store only, never in repo or logs, with rotation documented.

Fail if secrets appear in plaintext config, stack traces, or debug output.

## 8) `P1` Abuse and resource controls

Pass when rate limits, payload size limits, execution timeout caps, and concurrency caps are enforced.

Fail if one client can starve service resources.

## 9) `P1` Failure policy and refunds

Pass when policy for partial failures, retries, and refunds/credits is explicit and user-visible.

Fail if users can be charged without a remediation path.

## 10) `P1` Legal and licensing review

Pass when redistribution/patching rights are confirmed and terms/privacy pages are published.

Fail if license or ToS constraints are unknown.

## 11) `P1` Recovery and rollback

Pass when rollback is a single documented deploy step and an incident runbook exists.

Fail if recovery requires manual edits on live hosts.

## 12) `P2` Security validation

Pass when at least one focused security review and one adversarial test pass (auth bypass, replay, path traversal, file tamper).

Fail if no adversarial testing has been completed.

## Launch thresholds

1. Internal alpha: all `P0` can be provisional except billing integrity and secrets.
2. Paid private beta: all `P0` pass.
3. Public marketplace listing: all `P0` and all `P1` pass.

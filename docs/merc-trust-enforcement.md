# Merc-Trust Enforcement For Paid Routes

This service now supports provider-side Merc-Trust receipt enforcement on paid routes.

## Request flow order

1. `x402` payment gate runs first.
2. Merc-Trust receipt policy runs second (if enabled).
3. Route handler executes only when both checks pass.

This keeps unpaid probes on the standard `402 Payment Required` response, while blocking paid calls that do not carry a valid trust receipt.

## Enable in production

Set environment variables:

```bash
MERC_TRUST_ENFORCEMENT_ENABLED=true
MERC_TRUST_BASE_URL=https://merc-trust.vercel.app
MERC_TRUST_FAIL_OPEN=false
MERC_TRUST_ENFORCED_PATH_PREFIXES=/api/business-days/next,/api/holidays/today
MERC_TRUST_REVIEW_ALLOWED_PATH_PREFIXES=/api/business-days/next,/api/holidays/today
```

By default, enforcement is scoped to:

- `/api/business-days/next`
- `/api/holidays/today`

Those same low-risk prefixes accept `watch` receipts by default:

- `review` decision
- `review-required` guarantee

Higher-risk enforced routes still require `allow` + `execution-allowed` unless you explicitly extend the review-allowed prefix list.

Set `MERC_TRUST_ENFORCED_PATH_PREFIXES=*` to enforce all paid routes.

Recommended policy defaults already configured in `.env.example`:

- Deep-check service IDs only (`trust-quick-check` is not allowed by default)
- `allow` decision and `execution-allowed` guarantee required by default
- `review` and `review-required` accepted only on `MERC_TRUST_REVIEW_ALLOWED_PATH_PREFIXES`
- Signed receipt (`hmac-sha256`) required
- Canonical identity required for identity mode
- Verification endpoint must match `/api/trust/receipts/verify`

## How callers provide receipts

Any one of these is accepted:

- JSON body field `trustReceipt`
- JSON body field `receipt`
- Raw receipt object as request body
- Header `x-merc-trust-receipt`
- Header `x-mercury-trust-receipt`
- Header `x-trust-receipt`

Header values may be raw JSON or `base64:<json>`.

## Response codes

- `402` unpaid request (x402 gate)
- `400` missing receipt
- `403` receipt verification/policy failed
- `409` replay detected (when single-use enabled)
- `502` verification call failed (unless fail-open is enabled)

## Runtime exports

The app exports:

- `createMercTrustEnforcementFromEnv(...)`

Use this when wiring Merc-Trust checks into additional routers/services in this repo.

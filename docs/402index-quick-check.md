# 402 Index Quick Check

Use this to quickly validate how an endpoint appears in [402index](https://402index.io/) and whether its unpaid handshake looks correct.

## Commands

```bash
node scripts/automation_http.cjs 402index-search "<query>" [limit]
node scripts/automation_http.cjs 402index-probe "<endpoint-url>"
node scripts/automation_http.cjs 402index-check "<endpoint-url>" [limit]
node scripts/automation_http.cjs 402index-audit [scope] [concurrency]
```

## What each command does

- `402index-search`
  - Calls `GET https://402index.io/api/v1/services?q=...`.
  - Returns matched services with protocol, health, source, method, and x402 payment validity.
- `402index-probe`
  - Calls the same live probe stream used in the web UI:
    `GET https://402index.io/api/v1/demo/probe-live?url=...`
  - Summarizes response status, detected protocol, payment validation result, and health status.
- `402index-check`
  - Runs both checks above.
  - Searches by full URL, path-only URL, and host.
  - Classifies matches as exact URL, same path, and same host.
  - Emits actionable recommendations.
- `402index-audit`
  - Audits all current paid endpoints from route configs in:
    - `app.js`
    - `apps/restricted-party-screen/app.js`
    - `apps/vendor-entity-brief/app.js`
  - Probes each endpoint through 402index live check and compares index coverage per host.
  - If 402index probe is rate-limited, it falls back to a direct unpaid request so health/handshake checks still complete.
  - Returns totals (`indexExact`, `indexPath`, `indexHostOnly`, `indexNone`) and a `failures` list.
  - Includes host-level metadata quality (`missingPrice`, `uncategorized`, `missingDescription`) and route-level expected-vs-indexed metadata.

## Interpreting output

- `responseStatus` should be `402` for unpaid requests.
- `protocol` should be detected (`x402` or `L402`) from response headers.
- For x402 services, `validation.valid` should be `true` and `paymentValid` should be `1` in search results.
- If `exactUrlMatches` is empty but `samePathMatches` is present, the index likely stores canonical path URLs while your check URL includes query params.

## Recommended batch workflow

1. Run full audit:

```bash
npm run 402index:audit
```

2. Focus one seller/app:

```bash
npm run 402index:audit -- restricted-party-screen
npm run 402index:audit -- warehouse
```

3. Prioritize fixes from `failures`:
- `responseStatus != 402`: unpaid handshake is wrong.
- `coverage = none`: endpoint is not indexed at all.
- `coverage = host-only`: host is indexed, but this route path is missing.
- `healthStatus != healthy`: endpoint is unstable even if indexed.
- `indexedRouteMetadata.price_usd` missing or `category=uncategorized`: directory metadata quality gap.

## API docs details worth using

From `https://402index.io/api-docs`:

- `POST /api/v1/register` is currently L402-only.
- `http_method` and `probe_body` are important for endpoints that require specific methods or request bodies before returning 402.
- `GET /api/v1/services/:id` includes recent health check history for deeper debugging.

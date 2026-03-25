# Bazaar Learning Log

Use this file as the persistent memory for autonomous Bazaar scouting and shipping.

## How To Use This Log

- Read this file before choosing a new opportunity.
- Update it after every ship or failed ship attempt.
- Prefer lessons grounded in live production metrics over intuition.
- Keep entries concise and comparable across runs.

## What Strong Looks Like

- routes that get repeated external `402` traffic
- routes that convert from `402` to paid `200`
- routes that return useful, agent-ready data with little cleanup
- routes that index in Bazaar from one canonical paid path
- routes with stable upstreams and low support burden

## What Weak Looks Like

- high challenge volume with no paid conversion
- upstream failures after payment or flaky data quality
- duplicate ideas with weak differentiation
- broad catalogs without one clearly winning endpoint
- ideas that depend on fragile scraping or hidden credentials

## Shipped APIs

| Date | Service | Hero Route | Price | Live 402 | Paid 200 | Indexed | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-03-13 | x402 Data Bazaar | `/api/holidays/today/US` | `$0.002` | Yes | Yes | Yes | Strong probe route, simple utility |
| 2026-03-13 | x402 Data Bazaar | `/api/exchange-rates/USD` | `$0.003` | Yes | Earlier paid verification | Yes | Discovery-friendly lookup |
| 2026-03-13 | x402 Data Bazaar | `/api/weather/current?lat=40.7128&lon=-74.0060` | `$0.003` | Yes | Yes | Yes | Query-based route can index with exact canonical path |

## Observed Market Signals

- `holidays/today`, `exchange-rates`, and `weather/current` attract repeated `402` probe traffic.
- Simple lookup routes appear to be the best discovery surface.
- Query routes can still index when the canonical path and example metadata are exact.
- A large multi-route catalog does not automatically index broadly; one hero route must prove itself first.

## Current Heuristics

- Start with one hero GET route.
- Use micro-pricing in the `$0.002` to `$0.005` band unless there is strong premium value.
- Ship public, stable, deterministic data first.
- Prefer routes another agent can call with one clear purpose.
- Treat repeated external `402`s as interest, but treat paid `200`s as the real validation.

## Run Entry Template

### YYYY-MM-DD

- Winner:
- Reason it won:
- Hero route:
- Upstream:
- Price:
- Test result:
- Deploy result:
- Live 402:
- Paid 200:
- Bazaar indexing:
- Metrics read:
- Lesson learned:
- Next heuristic update:

### 2026-03-13 (Pre-run)

- Winner: Pending
- Reason it won: Pending scoring
- Hero route: Pending
- Upstream: Pending
- Price: Pending
- Test result: Pending
- Deploy result: Pending
- Live 402: Pending
- Paid 200: Pending
- Bazaar indexing: Pending
- Metrics read: Persistent log confirms repeated external 402 probe traffic on `/api/holidays/today/US`, `/api/exchange-rates/USD`, and `/api/weather/current?lat=40.7128&lon=-74.0060`, with paid 200 conversions for those routes. Direct live dashboard fetch at `https://x402-data-bazaar.vercel.app/ops/metrics/data` was attempted but blocked by sandbox outbound network restrictions.
- Lesson learned: Route selection should stay centered on simple deterministic lookup utilities with one clear task per call.
- Next heuristic update: Prefer canonical path routes that avoid long query payloads and can be tested cheaply.

### 2026-03-16 / 2026-03-17

- Winner: Restricted-party screening
- Reason it won: Best fit for the rebuilt business thesis of transaction checks for agentic commerce.
- Hero route: `/api/ofac-sanctions-screening/SBERBANK?minScore=90&limit=5`
- Upstream: OFAC Sanctions List Service
- Price: `$0.005`
- Test result: Passed locally
- Deploy result: Passed on Vercel
- Live 402: Verified
- Paid 200: Verified
- Bazaar indexing: Not yet visible in discovery registry at verification time
- Metrics read: Shared metrics recorded live self-tagged paid success for the route
- Lesson learned: Build the focused wedge first and let the old catalog become background inventory.
- Next heuristic update: Keep the portfolio explicitly classified as core, legacy-keep, or legacy-kill so repo structure does not drift back into catalog sprawl.

### 2026-03-13 (Post-run)

- Winner: Postal code lookup utility
- Reason it won: Matches prior conversion pattern (simple deterministic lookup with immediate agent utility and low integration friction).
- Hero route: `/api/zip/us/10001`
- Upstream: Zippopotam.us
- Price: `$0.003`
- Test result: Passed (2/2 mocked route regression checks).
- Deploy result: Failed (Vercel CLI blocked by outbound network restriction: `connect EACCES ...:443`).
- Live 402: Not verified (deployment/network blocked).
- Paid 200: Not verified (deployment/network blocked).
- Bazaar indexing: Not verified (Bazaar/Vercel network access blocked).
- Metrics read: Persistent log learnings were available; direct live fetch was blocked (`Unable to connect to the remote server`).
- Lesson learned: In restricted sandboxes, ship-ready code and tests can be produced, but production proof requires a network-enabled runner with Vercel + Bazaar access.
- Next heuristic update: Prefer opportunities with local testability first, and treat deploy/connectivity checks as explicit early gates before claiming ship completion.

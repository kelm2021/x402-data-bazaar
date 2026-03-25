# Bazaar discovery does not refresh seller metadata or canonical resource after route/description update

Date: March 17, 2026

## Summary

`restricted-party-screen.vercel.app` now serves an updated primary x402 route:

- `https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/SBERBANK`

The seller was redeployed on March 17, 2026 and two live paid requests were made against the new route after deploy. The live app advertises the new route first in its MCP/health catalog, but CDP discovery still returns only the older pre-deploy resource:

- `https://restricted-party-screen.vercel.app/api/restricted-party/screen/SBERBANK`

The discovery object is stale:

- `lastUpdated`: `2026-03-17T11:28:45.667Z`
- `metadata`: `{}`
- `accepts[0].description`: old description text

As a result, Bazaar/Payments MCP search still does not surface the seller for obvious queries like:

- `ofac`
- `restricted party screening`
- `sanctions screening api`

## Current live seller state

The live seller now advertises these route keys in order:

1. `GET /api/ofac-sanctions-screening/*`
2. `GET /api/restricted-party/screen/*`

The live MCP prompt catalog now starts with:

- `https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/SBERBANK?minScore=90&limit=5`

## Repro

1. Deploy the seller so its primary route and descriptions change from the old restricted-party path to the new OFAC-specific path.
2. Confirm the live seller returns x402 requirements for the new route:
   - `npx awal@latest x402 details "https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/SBERBANK?minScore=90&limit=5" --json`
3. Make a live paid request against the exact new route.
4. Query CDP discovery:
   - `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?type=http&limit=100&offset=0...`
5. Search Bazaar:
   - `npx awal@latest x402 bazaar search "ofac" --json`
   - `npx awal@latest x402 bazaar search "restricted party screening" --json`
   - `npx awal@latest x402 bazaar search "sanctions screening api" --json`

## Expected

- CDP discovery should either:
  - update the existing resource object to the new canonical resource and description, or
  - register the new primary resource alongside the legacy alias
- Bazaar search should be able to rank the seller for OFAC / sanctions / restricted-party queries based on the updated live seller metadata

## Actual

- CDP discovery still returns only the stale old resource object
- search results do not include the seller for obvious compliance/sanctions queries

## Evidence

### Live paid requests on the new canonical path

- `0x3436ebaf048230246d4d24551fed51346d6a2e2d7fa4949ab2db80fceb73a8d6`
- `0xb1a6b1a09ec2ba6876beb80fc7b77931f86ff3d23cdcc6f0bc934efae868d0f9`

### Raw discovery result after deploy and paid calls

- matched resource: `https://restricted-party-screen.vercel.app/api/restricted-party/screen/SBERBANK`
- lastUpdated: `2026-03-17T11:28:45.667Z`
- description: `OFAC restricted-party screening support for a person or entity name. Returns grouped potential matches, aliases, source lists, sanctions programs, and a manual-review recommendation. Optional query params: minScore, type, country, program, list, limit.`

### Example search mismatch

`npx awal@latest x402 bazaar search "sanctions screening api" --json` returns other sanctions-related services, but not this seller.

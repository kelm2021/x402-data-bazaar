# Handoff: Move x402 Facilitator Setup Beyond Coinbase

Date: 2026-03-29  
Repo: `C:\Users\KentEgan\claude projects\x402-data-bazaar`

## Goal

Stop defaulting to Coinbase-only facilitator bootstrap and support multi-facilitator operation (including automatic failover/load-balancing) for x402 middleware.

## Current State (Found in Codebase)

The code already has a good abstraction (`facilitatorLoader`) but defaults to Coinbase:

- Root app defaults to `loadCoinbaseFacilitator()` in:
  - `app.js` (`createPaymentGate`)
  - `app.js` (`createSettleTestHandler`)
- Seller apps have the same Coinbase default:
  - `apps/restricted-party-screen/app.js`
  - `apps/vendor-entity-brief/app.js`
  - `apps/generic-parameter-simulator/app.js`

Also, some integration metadata/copy still references Coinbase MCP package names:

- `@coinbase/payments-mcp` strings in:
  - `apps/restricted-party-screen/app.js`
  - `apps/vendor-entity-brief/app.js`
  - `apps/generic-parameter-simulator/app.js`

## Recommended Implementation

1. Add facilitator registry package:

```bash
npm i @swader/x402facilitators
```

2. Replace Coinbase-only loader with provider-selecting loader.

Suggested pattern:

```js
async function loadFacilitator(env = process.env) {
  const provider = String(env.X402_FACILITATOR || "auto").toLowerCase();

  if (provider === "coinbase") {
    const { createFacilitatorConfig } = await import("@coinbase/x402");
    return createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET);
  }

  const f = await import("@swader/x402facilitators");
  if (provider === "auto") return f.auto;
  if (provider === "payai") return f.payai;
  if (provider === "openx402") return f.openx402;
  if (provider === "daydreams") return f.daydreams;

  throw new Error(`Unsupported X402_FACILITATOR: ${provider}`);
}
```

3. Wire this loader into existing defaults in all app variants:

- Root:
  - `app.js` `createPaymentGate(...)`
  - `app.js` `createSettleTestHandler(...)`
- Sellers:
  - `apps/restricted-party-screen/app.js`
  - `apps/vendor-entity-brief/app.js`
  - `apps/generic-parameter-simulator/app.js`

4. Add env documentation:

- Update `.env.example` with:
  - `X402_FACILITATOR=auto`
  - Optional notes for supported values (`coinbase`, `auto`, `payai`, etc.)
- Keep CDP credentials documented only when `X402_FACILITATOR=coinbase`.

5. Optional positioning cleanup:

- If desired, replace Coinbase-branded MCP references in integration docs/JSON payloads with facilitator-neutral wording.

## Why This Fits Current Architecture

- You already use `facilitatorLoader` injection and retry logic.
- Middleware creation is centralized, so only loader defaults need changing.
- This minimizes risk and avoids broad payment pipeline rewrites.

## Verification Plan

1. Set env and boot app:

```bash
X402_FACILITATOR=auto
```

2. Hit debug endpoint:

- `GET /debug/settle-test`
- Confirm `facilitatorUrl` is not always Coinbase-specific and supported kinds load.

3. Smoke test a paid route:

- Verify normal `402` challenge flow still works.
- Verify paid settlement still returns `200`.

4. Regression check:

- Re-run tests (`node --test`, plus any app-specific test scripts).

## Known Constraints

- Current sellers are Base-focused (`eip155:8453`), so chosen facilitators must support Base for production parity.
- Some facilitators require separate credentials; map env vars per provider if enabling more than no-key facilitators.

## Sources Used

- Facilitator registry and package guidance:
  - https://facilitators.x402.watch/
  - https://github.com/Swader/x402facilitators

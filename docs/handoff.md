# x402 Data Bazaar — Handoff Doc

## What It Is

Express server with 17 API endpoints wrapping free public data sources (NHTSA, Open-Meteo, USDA, Census, BLS, FDA, etc.), protected by x402 payment middleware. Deployed to Vercel at `https://x402-data-bazaar.vercel.app`.

## Current State

- **All 17 endpoints return proper 402 responses** with correct payment requirements
- **Payment settlement fails** — "Payment was authorized but rejected by server"
- The server is fully functional otherwise — health check, route matching, API keys all work

## The Unsolved Problem

When a client (awal CLI) sends a paid request:
1. Server returns 402 with payment requirements ✅
2. Client signs USDC authorization ✅
3. Client resubmits with X-PAYMENT header ✅
4. Server calls CDP facilitator `/verify` — ✅ passes
5. Server runs route handler (buffered) ✅
6. Server calls CDP facilitator `/settle` — ❌ **FAILS HERE**
7. Server returns 402 with `settleResponse.errorReason`

The **exact errorReason from the facilitator is unknown** because:
- Vercel runtime logs truncate error messages (`SettleError: Failed to sett...`)
- node_modules patches don't survive Vercel's build step
- The awal client wraps the error as "Payment was authorized but rejected by server"

### What to do next

**Get the full settle error.** The x402-express middleware (v1.1.0) at `node_modules/x402-express/dist/cjs/index.js` line 262 calls `settle()` and catches errors at line 274. The settle function is in `node_modules/x402/dist/cjs/verify/index.js`. To see the actual error:

1. **Option A**: Create a proxy facilitator in `index.js` that wraps the CDP facilitator's verify/settle calls with console.error logging. The `useFacilitator(facilitator)` function from `x402/verify` returns `{ verify, settle, supported }`. Wrap settle to log the full response before returning. Then pass this wrapper as the facilitator to `paymentMiddleware`.

2. **Option B**: Use a postinstall script to patch `node_modules/x402-express/dist/cjs/index.js` after npm install, adding logging around the settle call.

3. **Option C**: Replicate the settle call manually — build a debug endpoint that takes a real X-PAYMENT header, decodes it, and manually calls the CDP facilitator's `/settle` endpoint, then returns the full response.

### Likely root causes (ranked by probability)

1. **Network mismatch**: Our v1 middleware sends `network: "base"` but the signed payment from the awal client may use a different network identifier. The CDP facilitator supports both `"base"` (v1) and `"eip155:8453"` (v2). If the client signs for `"eip155:8453"` but our requirements say `"base"`, the facilitator may reject.

2. **Smart wallet signature format**: The awal wallet (`0xC1ce2f3fc018EB304Fa178BDDFFf0E5664Fa6B64`) might be a smart contract wallet using ERC-6492 signatures. If the wallet isn't deployed on Base mainnet, the facilitator returns `invalid_exact_evm_payload_undeployed_smart_wallet`.

3. **Self-payment guard**: The payTo address is `0x348Df429BD49A7506128c74CE1124A81B4B7dC9d` and sender is `0xC1ce2f3fc018EB304Fa178BDDFFf0E5664Fa6B64` — these are different, so this should NOT be the issue. But worth verifying.

4. **On-chain transaction revert**: The `transferWithAuthorization` call might revert for reasons like nonce collision, insufficient allowance, or contract-level restrictions.

## Architecture

```
index.js                    — Entry point, route config, payment middleware setup
routes/
  vin.js                    — NHTSA VIN decoder (no key)
  weather.js                — Open-Meteo current + forecast (no key)
  holidays.js               — Nager.Date holidays + business day (no key)
  exchange-rates.js         — ExchangeRate-API (no key)
  ip.js                     — ip-api.com geolocation (no key)
  food.js                   — Open Food Facts barcode lookup (no key)
  nutrition.js              — USDA FoodData Central (USDA_API_KEY)
  fda.js                    — openFDA recalls + adverse events (FDA_API_KEY)
  census.js                 — US Census ACS 5-year (CENSUS_API_KEY)
  bls.js                    — BLS CPI + unemployment (BLS_API_KEY)
  air-quality.js            — EPA AirNow (AIRNOW_API_KEY)
  congress.js               — Congress.gov bills (CONGRESS_API_KEY)
```

## Key Technical Details

### Packages
- `x402-express` v1.1.0 — Express middleware (v1 protocol, returns JSON 402 body)
- `@x402/express` v2.6.0 — Also installed but NOT used (v2 protocol, returns `Payment-Required` header — awal client can't parse it)
- `@coinbase/x402` v2.1.0 — CDP facilitator config (ESM-only, requires dynamic `import()`)
- `x402` v1.1.0 — Core verify/settle functions

### Middleware Pattern
```js
// @coinbase/x402 is ESM-only, so lazy-init with dynamic import
let paymentReady = null;
function getPaymentMiddleware() {
  if (!paymentReady) {
    paymentReady = import("@coinbase/x402").then(({ createFacilitatorConfig }) => {
      const facilitator = createFacilitatorConfig(
        process.env.CDP_API_KEY_ID,
        process.env.CDP_API_KEY_SECRET,
      );
      // v1 x402-express accepts facilitator as 3rd arg
      return paymentMiddleware(PAY_TO, routeConfig, facilitator);
    });
  }
  return paymentReady;
}
```

### Route Config
- Uses `*` wildcards (not Express `:params`) — `"GET /api/vin/*"` not `"GET /api/vin/:vin"`
- x402 route matching uses `findMatchingRoute` from `x402/shared` which doesn't support `:param` syntax
- Holiday routes: `/today/:country` registered BEFORE `/:country/:year` to avoid conflict

### Vercel Config
- `vercel.json`: `@vercel/node` builder, 30s maxDuration, 50mb maxLambdaSize
- `app.set("trust proxy", 1)` — required so `req.protocol` returns `https`
- All env vars set in Vercel dashboard (no trailing newlines — fixed with `printf` not `echo`)

## Environment Variables (Vercel Production)

| Var | Purpose |
|-----|---------|
| CDP_API_KEY_ID | `158eecf5-19ea-46c7-9037-90dfebce296d` |
| CDP_API_KEY_SECRET | Ed25519 key (88 chars, base64) |
| USDA_API_KEY | FoodData Central |
| FDA_API_KEY | openFDA |
| CENSUS_API_KEY | US Census |
| BLS_API_KEY | Bureau of Labor Statistics |
| AIRNOW_API_KEY | EPA AirNow |
| CONGRESS_API_KEY | Congress.gov (api.data.gov key) |

## Addresses

- **PayTo**: `0x348Df429BD49A7506128c74CE1124A81B4B7dC9d`
- **Agent wallet (sender)**: `0xC1ce2f3fc018EB304Fa178BDDFFf0E5664Fa6B64` (has ~$16.72 USDC on Base mainnet)

## What Was Already Tried

1. ❌ Using x402.org facilitator (default) — doesn't support Base mainnet at all
2. ❌ Switching to base-sepolia — works with x402.org but wallet has no testnet USDC
3. ❌ Upgrading to @x402/express v2 — works but awal client can't parse v2 Payment-Required header format
4. ❌ Using @coinbase/x402 CDP facilitator without auth — 401 Unauthorized
5. ❌ Setting env vars with `echo |` — adds trailing newlines, fixed with `printf`
6. ✅ v1 x402-express + CDP facilitator with createFacilitatorConfig — 402 responses correct, facilitator authed, but settle still fails

## Debug Endpoints (currently deployed, should be removed for prod)

- `GET /debug/settle-test` — Tests CDP facilitator connection, lists supported kinds
- Remove both before production use

## Git History

```
60be40d — initial 17-endpoint build
1efe14a — trust proxy fix
48c0038 — update payTo
520c94a — v1 x402-express + CDP facilitator (current approach)
d9a042e — settle error logging (response interceptor)
0e7a958 — settle-test debug endpoint
```


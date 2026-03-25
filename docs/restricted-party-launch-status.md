# Restricted Party Launch Status

## Current State

As of March 16, 2026 and March 17, 2026 UTC verification:

- app directory: `apps/restricted-party-screen`
- live domain: `https://restricted-party-screen.vercel.app`
- hero route: `GET /api/ofac-sanctions-screening/:name`
- canonical verification path: `/api/ofac-sanctions-screening/SBERBANK?minScore=90&limit=5`
- launch price: `$0.005`
- free MCP integration path: `/integrations/payments-mcp`
- SIWX repeat-access support: enabled

## What Is Verified

- local test suite passes
- production deploy is live on Vercel
- unpaid request returns `402 Payment Required`
- live payment settles successfully on Base
- Coinbase Payments MCP wallet bridge can execute the paid route end-to-end
- paid request returns grouped OFAC screening results
- shared metrics ingestion is working
- seller health surface exposes Payments MCP integration metadata
- seller `402` responses declare `sign-in-with-x`
- SIWX server-side verification is configured for Base smart wallets
- signer-driven SIWX client demo reclaims access without a second payment

## Live Verification Snapshot

Paid verification confirmed:

- payer wallet: `0xC1ce2f3fc018EB304Fa178BDDFFf0E5664Fa6B64`
- direct x402 settlement tx: `0x361b994f2ca0734bf4224d6b34aa1eabb28aa8afed998f9b033e2fa591e673cd`
- Payments MCP bridge settlement tx #1: `0x273504dcb401e6db34bbb44657014a60cb2b5eaa63950ff6d543d14e927fd6bb`
- Payments MCP bridge settlement tx #2: `0xb89feead4446096b7b2bdeff5385a803c6d7e7b9e65205d8ab96ae1d606ba42b`
- route price in payment requirements: `5000` micros of USDC
- wallet code check on Base: contract wallet, not EOA
- signer-driven demo wallet funding tx: `0x82e3b3dcf5367fbb5ba04c33fca107d8df29377f9dbc4f0f08ebc31f9de1f001`
- signer-driven reclaim result: second fresh request returned `200` with no `PAYMENT-RESPONSE` header

Example paid response characteristics:

- `summary.status`: `potential-match`
- `summary.rawResultCount`: `92`
- `summary.matchCount`: `5`
- source: `OFAC Sanctions List Service`

## Metrics Snapshot

After live verification:

- route key: `GET /api/restricted-party/screen/*`
- total requests seen: `4`
- paid successes: `2`
- self-tagged paid successes: `2`
- paid revenue recorded: `$0.02`

These are launch checks, not market demand.

## Registry Status

The seller is registered in CDP discovery, but discovery/search is still stale relative to the live app.

Confirmed on March 17, 2026 via the paginated discovery API after the OFAC-route deploy and two paid calls on the new exact path:

- total HTTP resources seen: `13,995`
- live canonical route now served first: `https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/SBERBANK`
- raw CDP registry still matched stale resource: `https://restricted-party-screen.vercel.app/api/restricted-party/screen/SBERBANK`
- last updated in stale registry payload: `2026-03-17T11:28:45.667Z`
- Bazaar/Payments MCP search still does not surface the seller for obvious queries like `ofac`, `restricted party screening`, or `sanctions screening api`
- upstream discovery refresh issue opened: `https://github.com/coinbase/x402/issues/1659`

Repeat access still needs one more client-side step:

- the seller now supports SIWX verification for smart wallets
- Coinbase Payments MCP did not reclaim access via SIWX in live testing and instead settled a fresh payment on the second identical request
- a full reclaim test now exists in `npm run restricted-party-screen:siwx-demo`
- the current remaining gap is specifically Coinbase Payments MCP not yet sending the SIWX proof on repeat requests
- upstream issue opened: `https://github.com/coinbase/payments-mcp/issues/23`

## Next Checks

1. Watch CDP discovery for the stale restricted-party resource to refresh to the OFAC route or for the OFAC route to appear alongside it.
2. Keep pushing the direct Payments MCP lane while Bazaar search catches up.
3. Watch for Coinbase Payments MCP or another client path that actually sends SIWX proofs on repeat requests.
4. Measure external probes and first non-self paid buyer against the pivot gates in `docs/rebuild-blueprint.md`.

# Payments MCP SIWX Repeat-Access Repro

Upstream issue:

- `https://github.com/coinbase/payments-mcp/issues/23`

## Summary

`@coinbase/payments-mcp` can pay a live x402 route successfully, but it does not reclaim access on repeat requests when the seller advertises `sign-in-with-x`.

Instead, the second identical request settles a second onchain payment.

## Public Repro Target

- seller root: `https://restricted-party-screen.vercel.app/`
- canonical route: `https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/SBERBANK?minScore=90&limit=5`

The canonical route returns a `402` with:

- x402 v2 `PAYMENT-REQUIRED`
- `sign-in-with-x` extension
- supported chain `eip155:8453`

## Actual Payments MCP Behavior

Using the same authenticated Coinbase wallet through the Payments MCP wallet bridge:

1. first request pays and succeeds
2. second fresh request to the exact same route pays again and succeeds

Observed settlements:

- first Payments MCP settlement: `0x273504dcb401e6db34bbb44657014a60cb2b5eaa63950ff6d543d14e927fd6bb`
- second Payments MCP settlement: `0xb89feead4446096b7b2bdeff5385a803c6d7e7b9e65205d8ab96ae1d606ba42b`

## Expected Behavior

On the second fresh request, Payments MCP should:

1. see the `sign-in-with-x` extension on the `402`
2. sign the SIWX message with the same wallet
3. retry with the SIWX header
4. receive `200` without a new payment settlement

## Control Repro That Proves Seller-Side Support

The seller-side flow was verified independently with the signer-driven demo in this repo:

- command: `npm run restricted-party-screen:siwx-demo`

That demo:

1. confirms the initial `402`
2. confirms pre-payment SIWX retry still returns `402`
3. pays once through x402
4. makes a second fresh request
5. gets `200` with no `PAYMENT-RESPONSE` header on the second request

This shows the seller-side SIWX flow works when the client sends the proof correctly.

## Why This Looks Like a Payments MCP Client Bug

- the route is live and indexed in CDP discovery
- direct x402 payment works
- Payments MCP payment works
- signer-driven SIWX reclaim works
- only Payments MCP repeat access still re-pays

So the remaining gap appears to be in the Payments MCP client flow, not in the seller.

## Suggested Investigation Areas

- confirm `make_http_request_with_x402` inspects the `sign-in-with-x` extension on `402` responses
- confirm it generates and retries with a SIWX header before creating a second payment
- confirm the retry path works for x402 v2 `PAYMENT-REQUIRED` header flows
- confirm repeat requests use the same wallet identity for SIWX signing

## Environment

- date verified: `2026-03-17`
- Payments MCP local install used in testing: `2.0.0`
- seller packages: `@x402/core 2.6.0`, `@x402/express 2.6.0`, `@x402/extensions 2.6.0`

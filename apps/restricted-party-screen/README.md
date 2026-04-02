# Restricted Party Screen

Paid x402 API for OFAC restricted-party screening support in agentic commerce workflows.

## Why This Exists

This app is the first focused revenue wedge in the rebuild plan. It is designed to answer a narrow but valuable question for an agent:

- does this counterparty look like a potential OFAC match that needs human review

It does not provide legal advice or compliance clearance.

## Hero Route

- `GET /api/ofac-sanctions-screening/:name`

Example:

- `/api/ofac-sanctions-screening/SBERBANK?minScore=90&limit=5`

Compatibility alias:

- `GET /api/restricted-party/screen/:name`

Batch route:

- `GET /api/vendor-onboarding/restricted-party-batch`

Returns:

- grouped potential matches
- aliases
- sanctions programs
- source lists
- addresses
- source freshness
- manual review signal

The batch route is designed for vendor onboarding and payout-review workflows. It screens up to 25 counterparties in one paid call, stays cheap enough to use as a workflow utility, and returns a batch-level proceed-or-pause recommendation.

## Agent Distribution

This app now supports two practical access patterns for agents:

- direct x402 payment to the hero route
- repeat access via SIWX after a wallet has already paid for the route path

There is also a free integration surface for MCP clients:

- `GET /integrations/payments-mcp`

That endpoint returns:

- recommended `@coinbase/payments-mcp` install commands
- canonical route URLs
- prompt templates for Codex, Claude Code, or Gemini style clients
- SIWX support details for repeat access

The root health endpoint `/` now includes the same MCP and SIWX metadata in a lighter summary form, with the OFAC-specific route as the canonical path that agents should prefer.

For higher-value buyer flows, the Payments MCP helper also advertises the vendor-onboarding batch route with copy-paste prompts.

For the operator playbook, see [docs/restricted-party-mcp-playbook.md](/C:/Users/KentEgan/claude projects/x402-data-bazaar/docs/restricted-party-mcp-playbook.md).

## Local Commands

From the repo root:

```powershell
npm run restricted-party-screen:test
npm run restricted-party-screen:dev
npm run restricted-party-screen:distribution-pack
npm run restricted-party-screen:siwx-demo
```

Or from this folder:

```powershell
cmd /c npm test
cmd /c npm run dev
```

## Required Environment

See [.env.example](/C:/Users/KentEgan/claude projects/x402-data-bazaar/apps/restricted-party-screen/.env.example).

For production payment and shared metrics, set:

- `CDP_API_KEY_ID`
- `CDP_API_KEY_SECRET`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `METRICS_DASHBOARD_PASSWORD`
- `METRICS_SOURCE_SALT`
- `PUBLIC_BASE_URL`

Optional:

- `SIWX_EVM_CHAIN_ID`
- `SIWX_EVM_RPC_URL`
- `SIWX_NONCE_TTL_SECONDS`

For the client-side reclaim demo:

- `SIWX_DEMO_PRIVATE_KEY`
- `SIWX_DEMO_URL`
- `SIWX_DEMO_MAX_AMOUNT_ATOMIC`

SIWX verification now defaults to Base smart-wallet verification, which matters for smart wallets and other contract wallets reclaiming already-purchased access.

## True Reclaim Demo

Run:

```powershell
npm run restricted-party-screen:siwx-demo
```

The script expects `SIWX_DEMO_PRIVATE_KEY` to point at a funded Base wallet. It will:

1. confirm the initial `402`
2. generate a SIWX proof and confirm pre-payment reclaim still gets `402`
3. pay once through x402 and confirm `200` plus settlement
4. make a second fresh request and confirm SIWX reclaims access with `200` and no new settlement

## Product Guardrails

- Sell screening support, not approval decisions.
- Keep the response machine-readable and fast.
- Judge the product on paid repeat usage, not curiosity traffic.
- If support burden or legal ambiguity grows faster than revenue, pause it.

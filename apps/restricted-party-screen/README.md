# AurelianFlo

Paid x402 API for enhanced due diligence memos, batch wallet screening, and exact-match OFAC wallet checks in agentic commerce workflows.

## Why This Exists

This app is the compliance-focused screening service in the AurelianFlo stack. It is designed to answer two buyer jobs:

- screen a wallet or wallet set against OFAC SDN digital currency address designations
- produce a reviewable compliance memo without pretending to provide legal advice or compliance clearance

## Primary Routes

- `POST /api/workflows/compliance/edd-report`
  Primary buyer-facing route. Takes case metadata plus wallet addresses and returns an enhanced due diligence memo as `json`, `pdf`, or `docx`.
- `POST /api/workflows/compliance/batch-wallet-screen`
  Lower-priced route for screening a wallet set and returning structured batch results plus artifact hints.
- `GET /api/ofac-wallet-screen/:address`
  Single-wallet primitive for exact-match OFAC screening with structured report payloads.
- `POST /api/workflows/compliance/wallet-sanctions-report`
  Single-wallet workflow wrapper that returns a structured compliance payload.

These routes use public OFAC SDN advanced XML data, exact wallet-address matching, source freshness metadata, and explicit human-review language. They do not provide behavioral AML scoring, cluster analysis, or legal approval decisions.

## Agent Distribution

This app now supports two practical access patterns for agents:

- direct x402 payment to the primary route
- repeat access via SIWX after a wallet has already paid for the route path

There is also a free integration surface for MCP clients:

- `GET /integrations/payments-mcp`

That endpoint returns:

- recommended `@coinbase/payments-mcp` install commands
- canonical route URLs
- prompt templates for Codex, Claude Code, or Gemini style clients
- SIWX support details for repeat access

The root health endpoint `/` now includes the same MCP and SIWX metadata in a lighter summary form, with the EDD and wallet-screening routes represented in the catalog.

For higher-value buyer flows, the Payments MCP helper can point agents to the screening primitives and the memo workflow.

For the operator playbook, see [docs/restricted-party-mcp-playbook.md](../../docs/restricted-party-mcp-playbook.md).

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

See [.env.example](./.env.example).

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

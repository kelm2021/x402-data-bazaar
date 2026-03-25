# Restricted Party Distribution

## Why This Exists

`restricted-party-screen` should not wait on Bazaar indexing alone.

The current phase-1 distribution plan is:

1. keep the Bazaar path live and monitor indexing
2. add a direct MCP lane through Coinbase Payments MCP
3. support SIWX so returning wallets can reopen access without re-paying

Registry status as of March 17, 2026:

- `restricted-party-screen` is present in the live CDP discovery registry
- target canonical indexed resource: `https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/SBERBANK`
- raw CDP discovery still returns the stale pre-deploy resource `https://restricted-party-screen.vercel.app/api/restricted-party/screen/SBERBANK`
- Bazaar/Payments MCP search still misses the seller for obvious OFAC / sanctions queries
- upstream refresh issue is live at `https://github.com/coinbase/x402/issues/1659`

## Live Surfaces

- seller root: `https://restricted-party-screen.vercel.app/`
- MCP integration metadata: `https://restricted-party-screen.vercel.app/integrations/payments-mcp`
- canonical paid route: `https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/SBERBANK?minScore=90&limit=5`

## Payments MCP

Recommended install commands:

- Codex: `npx @coinbase/payments-mcp --client codex --auto-config`
- Claude Code: `npx @coinbase/payments-mcp --client claude-code --auto-config`
- Gemini: `npx @coinbase/payments-mcp --client gemini --auto-config`

Example prompt:

- `Use payments-mcp to pay https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/SBERBANK?minScore=90&limit=5 and return the JSON response.`

For the full operator pack, see:

- `docs/restricted-party-mcp-playbook.md`
- `docs/payments-mcp-siwx-issue.md`
- `npm run restricted-party-screen:distribution-pack`
- `npm run restricted-party-screen:siwx-demo`

## SIWX

The seller now declares `sign-in-with-x` support in `402 Payment Required` responses and records successful payments for the route path.

That means a wallet that has already paid for:

- `/api/ofac-sanctions-screening/SBERBANK`

can prove wallet ownership and regain access to that route path without repaying, as long as the client supports SIWX.

Current storage mode:

- Upstash Redis when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are configured
- in-memory fallback otherwise

As of March 17, 2026 UTC:

- seller-side SIWX verification is configured for Base smart wallets
- Coinbase Payments MCP live payment works
- repeat access through the current Payments MCP path still re-pays instead of reclaiming access, which suggests the client is not yet sending SIWX proofs on retry
- signer-driven reclaim is now verified through `npm run restricted-party-screen:siwx-demo`
- the signer-driven demo proved a second fresh request can return `200` with no new settlement when the client sends the SIWX proof correctly
- upstream repro issue is live at `https://github.com/coinbase/payments-mcp/issues/23`

## What This Changes

- Bazaar registration exists, but Bazaar search freshness is still a real dependency.
- Returning customers have a cleaner repeat-access path.
- The wedge is now better aligned with the Coinbase x402 roadmap without building wedge `#2` early.
- We now know the remaining reclaim gap is a Payments MCP client behavior issue, not a seller-side SIWX issue.

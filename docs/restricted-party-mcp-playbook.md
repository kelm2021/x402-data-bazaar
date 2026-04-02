# Restricted Party MCP Playbook

## Goal

Drive real external usage to `restricted-party-screen` through the new Payments MCP lane while Bazaar indexing is still catching up.

This is not a general marketing plan. It is the smallest practical operator plan to get:

- external probes
- first non-self paid calls
- early repeat usage

## Live Assets

- seller root: `https://restricted-party-screen.vercel.app/`
- MCP helper endpoint: `https://restricted-party-screen.vercel.app/integrations/payments-mcp`
- canonical paid route: `https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/SBERBANK?minScore=90&limit=5`

## Who To Target First

Prioritize people already building agent workflows where a transaction pause is normal:

1. builders using Codex, Claude Code, Gemini, or MCP-native agent stacks
2. procurement and vendor-onboarding automation builders
3. payout, treasury, or cross-border workflow builders
4. x402 and Bazaar ecosystem builders who want higher-value examples than generic utilities

Do not start with broad “check out my API” posting. Start with people whose agents already make or block transactions.

## Core Message

Use one simple angle:

- paid restricted-party screening for agent workflows

The point is not “we have OFAC data.” The point is:

- your agent can pay for a screening check exactly when it needs one
- you do not need subscriptions, custom auth, or a large integration
- the output already tells the workflow whether to proceed or pause

## Copy-Paste Prompt Pack

### Smoke Test

```text
Use payments-mcp to pay https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/SBERBANK?minScore=90&limit=5 and return the JSON response.
```

### Supplier Onboarding Gate

```text
Use payments-mcp to pay https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/<COUNTERPARTY_NAME>?minScore=90&limit=5. Return the JSON, then tell me whether onboarding should proceed or pause for human review based on summary.manualReviewRecommended.
```

### Payout Gate

```text
Before sending funds to <COUNTERPARTY_NAME>, use payments-mcp to pay https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/<COUNTERPARTY_NAME>?minScore=90&limit=5. If the response shows potential matches, tell me to block payment and escalate.
```

### Cross-Border Counterparty Check

```text
Use payments-mcp to pay https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/<COUNTERPARTY_NAME>?minScore=90&limit=5 for the counterparty in this transaction. Summarize the top match, the sanctions programs involved, and whether a human review is recommended.
```

## Reusable Outreach Copy

### Short Post

```text
Built a paid x402 OFAC sanctions and restricted-party screening endpoint for agent workflows. MCP-ready, direct pay via Payments MCP, and SIWX-enabled for repeat access. Canonical route: https://restricted-party-screen.vercel.app/api/ofac-sanctions-screening/SBERBANK?minScore=90&limit=5
```

### Developer DM

```text
If you are building procurement, payout, or cross-border agents, I have a live x402 endpoint for OFAC-style restricted-party screening. You can call it through Payments MCP and pay per request instead of wiring a custom integration.
```

### README / Docs Snippet

```text
Install Payments MCP, then call the canonical restricted-party-screen route through MCP. The seller returns grouped matches, sanctions programs, source freshness, and a manual-review signal for agent workflows.
```

## Operating Sequence

### Day 0

- verify the live MCP helper endpoint still returns `200`
- verify the canonical route still returns `402` with `sign-in-with-x`
- run `npm run rebuild:status`

### Day 1 To Day 7

- use the short post and developer DM copy anywhere x402 and MCP builders already gather
- use the prompt pack in direct conversations and demos
- keep all traffic pointed at the canonical route or the MCP helper endpoint

### What To Watch

- external `402` probes from anonymous sources
- first non-self paid call
- repeat paid activity from the same anonymous source fingerprint
- whether traffic comes from MCP-friendly user agents versus generic noise

## Decision Rules

- If MCP distribution increases probes but not paid conversions, improve the prompt and positioning once.
- If it increases paid conversions, keep pushing wedge `#1` and do not build wedge `#2`.
- If it produces no measurable probe lift, then Bazaar indexing is still the main bottleneck and we should revisit the distribution assumptions.

## Useful Commands

```powershell
npm run restricted-party-screen:test
npm run restricted-party-screen:distribution-pack
npm run rebuild:status
```

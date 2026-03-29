# Rebuild Blueprint

## Thesis

Rebuild this business as a focused provider for agent transaction checks, not a broad catalog of unrelated paid APIs.

The core buyer job is:

- can I transact with this counterparty
- what risk blocks this transaction
- what cost or rule should be applied before execution

That points to a narrow product family:

1. restricted-party screening
2. HTS and tariff lookup
3. trade calendar and cutoff checks

## Why This Direction

- Generic utility APIs are crowded and easy to copy.
- Trade and compliance checks have higher value per call because they sit directly on transaction boundaries.
- A tighter product family makes pricing, distribution, and pivot decisions cleaner.

## Product Strategy

### Phase 1: Revenue Wedge

Launch one focused product first:

- `restricted-party-screen`

Hero route:

- `GET /api/restricted-party/screen/:name`

The route should sell machine-readable screening support, not legal advice. It should return:

- grouped potential matches
- aliases
- sanctions programs
- source lists
- confidence and review signal
- source freshness

Phase 1 now includes a distribution layer too:

- keep Bazaar indexing live, but do not rely on it as the only path
- package the wedge for Payments MCP so agents have a direct tool lane
- enable SIWX so returning wallets can regain access without repaying
- stay on USDC-denominated pricing first, even if buyers can pay with broader supported tokens

### Phase 1.5: Trust And Repeat Access

Before expanding to wedge `#2`, improve trust and repeatability around the first wedge:

- SIWX-backed repeat access
- clear MCP integration metadata and prompt examples
- consistent provider identity across the focused products

This is still in service of revenue, not branding polish.

### Phase 2: Trust Layer

After the first wedge shows paid demand, add a stronger provider identity layer:

- consistent product naming
- consistent domains
- shared provider metadata
- optional ENS and onchain agent identity verification

This is not consumer branding. It is machine-readable provider identity that helps discovery, routing, and trust.

### Phase 3: Expansion

Only expand after the first product shows repeat paid use.

Next products:

1. `hts-lookup`
2. `trade-calendar`

Do not add unrelated utilities to the core brand.

## Repo Shape

Use a monorepo, but not a monolith.

- `apps/restricted-party-screen`
- `apps/hts-lookup`
- `apps/trade-calendar`
- `docs/`

Shared internal packages can come later if duplication becomes real. In the first pass, keep each app independently deployable and easy to kill.

## Current Utility Sellers

Keep the existing utility sellers live if they are low-maintenance.

Treat them as:

- side income
- discovery experiments
- x402 operating practice

Do not treat them as the center of the business.

## Metrics That Matter

Optimize for:

- external paid calls
- repeat buyers
- revenue per route
- support burden
- upstream reliability
- time to first paid conversion

Do not optimize for:

- route count
- total traffic
- raw `402` volume alone

## Pivot Rules

Every new product gets one launch cycle and one repair cycle.

### 14-Day Probe Gate

- at least 10 external `402` probes
- from at least 3 distinct hosts or caller fingerprints

If this misses, fix positioning or distribution once.

Distribution includes:

- Bazaar indexing
- Payments MCP accessibility
- route clarity and machine-usable metadata

### 21-Day Paid Gate

- at least 5 external paid calls

If probes exist but no paid conversions happen, fix the offer once:

- route contract
- metadata
- pricing
- positioning

### 30-Day Repeat Gate

- at least 2 returning buyers

If buyers do not come back, pause the product. It is not yet a passive-income candidate.

### Ops Gate

Kill or pause quickly if:

- upstream freshness is weak
- support burden is too high
- legal ambiguity is too high
- revenue does not justify maintenance

## First Build Order

1. scaffold `apps/restricted-party-screen`
2. wire it to official OFAC screening endpoints
3. ship one hero route
4. validate unpaid `402`, paid `200`, and output quality
5. expose a second distribution lane through Payments MCP
6. support SIWX for repeat access
7. judge it with the pivot rules above before adding the next app

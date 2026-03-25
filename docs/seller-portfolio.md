# Seller Portfolio Workflow

The seller portfolio is now split into two operating tracks:

- `core`: products that define the business direction
- `legacy`: products that can stay live for side income, but do not get roadmap priority

## Model

- Keep the monolith as the route warehouse, testbed, and shared metrics dashboard.
- Keep each focused seller as a separate discoverable product with one hero route.
- Use live metrics plus Bazaar discovery status to decide whether a seller is worth building around, merely keeping live, or retiring.
- Treat [portfolio-classification.md](/C:/Users/KentEgan/claude%20projects/x402-data-bazaar/docs/portfolio-classification.md) as the current strategic source of truth.

## Commands

List the current seller portfolio:

```powershell
node scripts/list_seller_portfolio.js
```

Generate a live priority report from production metrics plus Bazaar discovery:

```powershell
node scripts/portfolio_report.js
```

Check the current launched seller surfaces by domain:

```powershell
node scripts/live_seller_status.js
```

Dump a scaffold config for a focused seller:

```powershell
node scripts/scaffold_portfolio_seller.js --seller weather-decision
```

Write a config file and scaffold a new seller project:

```powershell
node scripts/scaffold_portfolio_seller.js `
  --seller fx-conversion-quotes `
  --config-out portfolio/configs/fx-conversion-quotes.json `
  --out tmp/ships/fx-conversion-quotes
```

For supported seller ids, the scaffold step now also replaces the starter stub with a real provider-backed `handlers/primary.js`. Today that includes:

- `weather-decision`
- `calendar-business-days`
- `fx-conversion-quotes`
- `vehicle-vin`

## Operating Priority

Current intended shape:

1. `core`: restricted-party screening
2. `legacy-keep`: calendar, FX, VIN, weather
3. `legacy-kill`: everything else unless it unexpectedly proves repeat paid demand

## What This Unlocks

- one repo can still operate many sellers without pretending they are one business
- the scripts now reinforce what is core versus what is just inventory
- the live seller registry can be checked against shared metrics and Bazaar discovery
- the team can freeze or retire low-fit routes without guessing
- new build effort stays aligned to the focused wedge instead of catalog sprawl

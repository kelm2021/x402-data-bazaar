# 402index Manual Metadata Import/Override Request Draft (Post-Fix Recheck)

## Subject
Manual metadata import/override request for `x402-data-bazaar.vercel.app` after fresh 19/19 settlements

## Ticket Body
Hello 402index team,

We completed a fresh post-fix settlement + probe validation pass, but the directory listing is unchanged and still missing metadata.

### Recheck Snapshot (UTC)
- Recheck timestamp: 2026-03-20T07:02:17.230Z
- Host query total: 3
- Currently indexed URLs:
- https://x402-data-bazaar.vercel.app/api/exchange-rates/USD
- https://x402-data-bazaar.vercel.app/api/holidays/today/US
- https://x402-data-bazaar.vercel.app/api/weather/current

Current host metadata quality:
- `missingPrice: 3`
- `uncategorized: 3`
- `missingDescription: 3`

### Fresh Proof (Post-Fix)
- Settled payments: 19/19 canonical routes
- Unpaid/header quality:
  - `402` responses: 19/19
  - Decodable header: 19/19
  - `facilitator` present: 19/19
  - `category` present: 19/19
  - USD price label present: 19/19

Requested actions:
1. Import canonical metadata for all 19 endpoints from `https://x402-data-bazaar.vercel.app/api`.
2. Apply metadata immediately for currently indexed routes:
   - `/api/weather/current` -> `category: weather`, `price_usd: 0.003`
   - `/api/holidays/today/US` -> `category: calendar/holidays`, `price_usd: 0.002`
   - `/api/exchange-rates/USD` -> `category: finance/fx`, `price_usd: 0.003`
3. If needed, map exchange-rates to canonical URL `https://x402-data-bazaar.vercel.app/api/exchange-rates/quote/USD/EUR/100`.
4. Keep existing health/payment-valid fields; fill only missing metadata fields now.

Evidence bundle paths:
- `docs/support-escalation/2026-03-20-discovery-followup/recheck-now-402index-search.json`
- `docs/support-escalation/2026-03-20-discovery-followup/recheck-now-402index-audit.json`
- `docs/support-escalation/2026-03-20-discovery-followup/settlement-ledger.json`
- `docs/support-escalation/2026-03-20-discovery-followup/unpaid-probe-proof.json`
- `docs/support-escalation/2026-03-20-discovery-followup/canonical-urls.json`

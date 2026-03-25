# CDP/Bazaar Support Ticket Draft (Post-Fix Recheck)

## Subject
Post-fix discovery/indexing unchanged for `x402-data-bazaar.vercel.app` after fresh 19/19 settlements (request host re-ingest + canonical backfill)

## Ticket Body
Hello CDP/Bazaar support,

We redeployed our x402 service and re-verified settlement and probe health, but discovery/indexing still appears stale.

### Recheck Snapshot (UTC)
- Recheck timestamp: 2026-03-20T07:02:17.230Z
- Host: `x402-data-bazaar.vercel.app`
- Discovery consumer host query still returns only 3 indexed URLs:
- https://x402-data-bazaar.vercel.app/api/exchange-rates/USD
- https://x402-data-bazaar.vercel.app/api/holidays/today/US
- https://x402-data-bazaar.vercel.app/api/weather/current
- Host-scoped audit totals (19 canonical endpoints):
  - `probeHealthy: 19`
  - `paymentRequired402: 19`
  - `indexExact: 1`
  - `indexHostOnly: 18`
  - `indexNone: 0`

### Fresh Settlement Proof (Post-Fix Run, 2026-03-20)
- Successful settled payments: 19/19

| Route Key | Canonical URL | Tx Hash |
|---|---|---|
| GET /api/vin/* | https://x402-data-bazaar.vercel.app/api/vin/1HGCM82633A004352 | 0xefd6194ca0f02ab3e3d19cc72c9afc82268cc48d7447e53201ffa8f5927d4e85 |
| GET /api/weather/current/* | https://x402-data-bazaar.vercel.app/api/weather/current/40.7128/-74.0060 | 0xaff3a1511eb2a1e0a7d416a5e4ab7f3601d6f08a7a335785eff9dee3eb3d601e |
| GET /api/weather/current | https://x402-data-bazaar.vercel.app/api/weather/current/40.7128/-74.0060 | 0x985a0e3457ed810378ad48d9f478e91ea9c29ff29f140abe04328ffba29876c7 |
| GET /api/weather/forecast | https://x402-data-bazaar.vercel.app/api/weather/forecast | 0x1d2ee000d57597410c8e6605c8e19988443cd2d500628ab7efe82468f1ec25ad |
| GET /api/holidays/today/* | https://x402-data-bazaar.vercel.app/api/holidays/today/US | 0xa22541e38b69074a96439a48414317009b9fafdb7d696075d2ce86280522a852 |
| GET /api/business-days/next/* | https://x402-data-bazaar.vercel.app/api/business-days/next/US/2026-03-15 | 0x2b22b694c30d260be475aba8c715c415600f303585421dd73160d192ed172e13 |
| GET /api/holidays/* | https://x402-data-bazaar.vercel.app/api/holidays/US/2026 | 0x683757cd837791baefd6bc1c55a7c95611dd281d55710bef0f7de36a36901f42 |
| GET /api/exchange-rates/* | https://x402-data-bazaar.vercel.app/api/exchange-rates/quote/USD/EUR/100 | 0xbe93eb919764e81ccb4ca32337bbcef67b1c2094ee6168fabc192eba9920c950 |
| GET /api/ip/* | https://x402-data-bazaar.vercel.app/api/ip/8.8.8.8 | 0xbfa60032f407983847b271489e947e5864739d854003002f0fe70cacc8953734 |
| GET /api/food/barcode/* | https://x402-data-bazaar.vercel.app/api/food/barcode/737628064502 | 0x049914d31a2867d804a172236ffef7f6ba24754ad53dad2d71fe4a4e0edc20ca |
| GET /api/nutrition/search | https://x402-data-bazaar.vercel.app/api/nutrition/search | 0xe76aa615b14d80f1f8159c3bf77829c1a882b23a8ab5932b686226dfe7b09cd0 |
| GET /api/fda/recalls | https://x402-data-bazaar.vercel.app/api/fda/recalls | 0x63ac11fa16e4b63e87ec1903be8c9f84c97891d4ffc5561b88b4af282ba0175d |
| GET /api/fda/adverse-events | https://x402-data-bazaar.vercel.app/api/fda/adverse-events | 0x316f9d52962b5cf387949a4c12feba19bb0d73f10b8fad8ad9d761fe8d5988f2 |
| GET /api/census/population | https://x402-data-bazaar.vercel.app/api/census/population | 0x8520719dfe13feb8b0fca90c5dfb61f30f1100d035d2d7d818d5a08c2eddac6f |
| GET /api/bls/cpi | https://x402-data-bazaar.vercel.app/api/bls/cpi | 0x49d4e31e0db5ed6ba2593df6ff2f21b0f7fe9a688d00097788de009d4867c76d |
| GET /api/bls/unemployment | https://x402-data-bazaar.vercel.app/api/bls/unemployment | 0x5f090ef2260c371a8e900cb118ff0464839675a52b3e9b98194944a4c029687e |
| GET /api/air-quality/* | https://x402-data-bazaar.vercel.app/api/air-quality/20002 | 0x4b0d724636d1e90025f7860500d59b627c22d6b5b1224ce3eef93ffc151bfa52 |
| GET /api/congress/bills | https://x402-data-bazaar.vercel.app/api/congress/bills | 0x42572371d577fedb95ce25f9259acbe1ac15e77c14404ad8d4cfb5a59299571c |
| GET /api/fec/candidates | https://x402-data-bazaar.vercel.app/api/fec/candidates | 0x340f9868a7905eacaefa2b65b84b93503a070f1e6d0998f001c6e7dae9d984e6 |

### Unpaid Probe / Header Quality Proof
- Proof timestamp: 2026-03-20T06:54:52.268Z
- `402` responses: 19/19
- Decodable `payment-required` headers: 19/19
- `facilitator` present: 19/19
- `category` present: 19/19
- USD price label present: 19/19

Requested actions:
1. Re-ingest host `x402-data-bazaar.vercel.app` now using current canonical resources.
2. Backfill discovery records from `https://x402-data-bazaar.vercel.app/api` (19 canonical endpoints).
3. Confirm why only 3 legacy URLs are still propagated and whether a canonicalization filter is blocking the remaining 18.
4. Share expected propagation ETA to downstream consumers (Bazaar / 402index).

Evidence bundle paths:
- `docs/support-escalation/2026-03-20-discovery-followup/recheck-now-402index-search.json`
- `docs/support-escalation/2026-03-20-discovery-followup/recheck-now-402index-audit.json`
- `docs/support-escalation/2026-03-20-discovery-followup/settlement-ledger.json`
- `docs/support-escalation/2026-03-20-discovery-followup/unpaid-probe-proof.json`
- `docs/support-escalation/2026-03-20-discovery-followup/canonical-urls.json`

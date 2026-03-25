# Portfolio Classification

This repo now treats sellers in three buckets:

- `core`: the focused business we are actively building around
- `legacy-keep`: keep live, freeze scope, and monitor for low-effort side income
- `legacy-kill`: do not improve; retire if maintenance, support, or distraction rises

## Core

| Seller | Why it is core |
| --- | --- |
| `restricted-party-screen` | This is the phase-1 wedge from the rebuild plan. It fits the transaction-check thesis directly and already has live paid verification. |

## Legacy Keep

| Seller | Why we keep it |
| --- | --- |
| `calendar-business-days` | Transaction-adjacent and still potentially useful, but not the main wedge. |
| `fx-conversion-quotes` | Existing demand and simple buyer story make it worth keeping live as side income. |
| `vehicle-vin` | Specific enough to keep if support stays near zero. |
| `weather-decision` | Existing interest justifies leaving it online, but we stop treating it as the identity of the business. |

## Legacy Kill

These routes stay out of the roadmap and get retired if they become noisy:

- `nutrition-search`
- `food-barcode`
- `public-health-recalls`
- `drug-safety-events`
- `census-demographics`
- `economic-inflation`
- `economic-unemployment`
- `air-quality-zip`
- `ip-geolocation`
- `congress-bills`
- `solar-times`

## Operating Rules

- Do not add new generic utility routes.
- Keep `legacy-keep` sellers stable, but do not spend product strategy time expanding them.
- Treat the broad `x402-data-bazaar` umbrella as warehouse and ops infrastructure, not as the future product identity.
- Build only adjacent products that strengthen the transaction-check thesis.

# Merchandising cluster — baseline before the content fix

**Measured 2026-08-17** from Google Search Console, 90-day window (2026-05-16 → 2026-08-14).
Recorded so the consolidation decision can be made against a real before/after rather than
a recollection.

## Why this baseline exists

`/what-is-retail-merchandising/` holds 1,242 impressions at position 62 while rendering
**548 words** — header, navigation and footer only. Its stored content has never displayed.
Several other pages in this cluster are in the same state. Any consolidation decision taken
today would be made against positions that reflect empty pages, not the pages themselves.

The sequence is therefore: publish the content (WPCode snippet 11233 → Update), let Google
recrawl, re-measure, then decide which URL owns the cluster.

## Head terms — where they stand now

| Term | Impressions | Clicks | CTR | Our pages competing | Best position |
|---|---:|---:|---:|---:|---:|
| retail merchandising | 5,051 | 0 | 0.00% | 7 | 26.3 |
| retail merchandising services | 4,226 | 7 | 0.17% | 4 | 8.3 |
| merchandising services | 1,633 | 1 | 0.06% | 2 | 8.0 |
| **cluster total** | **10,910** | **8** | **0.07%** | — | — |

For comparison, the brand-ambassador cluster is 4,225 impressions and 15 clicks.

## Which of our pages holds what

**"retail merchandising services"** — 4,226 impressions

| Page | Position | Impressions | Clicks |
|---|---:|---:|---:|
| /merchandising-services/ | 8.3 | 3,594 | 7 |
| /services/merchandising/ | 32.5 | 599 | 0 |
| /what-is-retail-merchandising/ | 55.4 | 24 | 0 |
| /retail-merchandising/ | 62.3 | 9 | 0 |

**"merchandising services"** — 1,633 impressions

| Page | Position | Impressions | Clicks |
|---|---:|---:|---:|
| /merchandising-services/ | 8.0 | 1,620 | 1 |
| /services/merchandising/ | 27.3 | 13 | 0 |

**"retail merchandising"** — 5,051 impressions, zero clicks

| Page | Position | Impressions | Clicks |
|---|---:|---:|---:|
| /retail-merchandising/ | 40.8 | 2,420 | 0 |
| /merchandising-services/ | 26.3 | 1,342 | 0 |
| /what-is-retail-merchandising/ | 62.2 | 1,242 | 0 |
| /retail-merchandising-secrets/ | 87.9 | 29 | 0 |
| /services/merchandising/ | 45.2 | 15 | 0 |
| /retail-merchandising-trends/ | 9.5 | 2 | 0 |

## Rendered word count, same day

| Page | HTTP | Rendered words |
|---|---|---:|
| /retail-merchandising/ | 200 | 3,215 |
| /retail-merchandising-secrets/ | 200 | 3,035 |
| /merchandising-services/ | 200 | 2,815 |
| /services/merchandising/ | 200 | 2,439 |
| **/what-is-retail-merchandising/** | 200 | **548** ← renders nothing |

## The decision this baseline serves

`/merchandising-services/` and `/services/merchandising/` both target the same term and Google
prefers the first by roughly 24 positions. One of them should own the cluster and the rest should
redirect into it. The trade-off:

- **/merchandising-services/** already holds position 8 — keeping it avoids resetting earned authority, but it breaks the `/services/*` pattern every other service page follows.
- **/services/merchandising/** is architecturally correct, but it sits at position 32 with zero clicks, so choosing it means betting that authority transfers through the redirect.

## Re-measure

`pageOpportunities` in `scripts/gsc.mjs` now tracks all six URLs. The daily cron regenerates it;
`data/latest.json` is committed each run, so git history holds every intermediate snapshot.

Compare against this file once the pages have rendered for long enough to be recrawled —
realistically 2 to 3 weeks, not days. Search Console also lags roughly 3 days.

## Caveat carried into the comparison

Part of this impression volume is machine-generated and will never click — the same artefact that
produced queries like "roster technologies ambassador points blacklabel" and "mysterypct" in the
striking-distance data. Judge the result on **clicks and position**, not on impression growth.

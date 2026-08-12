# Phase 1 — Consolidation spec

**Date:** 2026-08-12 · **Source:** Google Search Console, measured, 90 days to 2026-08-09
**Status:** analysis complete, ready to execute. Publishing steps need WordPress access.

---

## What the data says

For each commercial term, every page of ours that Google surfaces:

### "brand ambassador" — 4,012 impressions · 10 clicks · **13 competing pages**

| Position | Impressions | Clicks | Page |
|---:|---:|---:|---|
| **10.5** | **3,832** | **9** | `/services/brand-ambassadors/` |
| 17.8 | 107 | 0 | `/how-does-a-brand-ambassador-work-2/` |
| 8.3 | 41 | 0 | `/different-types-of-brand-ambassadors-2/` |
| 3.7 | 10 | 0 | `/measuring-brand-ambassador-program-success/` |
| 2.3 | 6 | 1 | `/influencer-vs-brand-ambassador-marketing-whats-the-difference/` |
| 3.0 | 5 | 0 | `/brand-ambassador-marketing/` |
| 2.3 | 3 | 0 | `/growing-your-brand-ambassador-program/` |

**This overturns the assumption the plan was built on.** The 12 satellite articles are *not* stealing the term — Google already sends **95.5% of impressions to the service page**. Merging them would consolidate topical signals and internal links, but it will not redistribute impressions, because there is nothing meaningful to redistribute.

**The actual problem is position.** The service page sits at **10.5 — the bottom of page one**, where almost nobody clicks. Moving it to the top five is the whole job.

### "retail merchandising services" — 4,208 impressions · 7 clicks · 4 pages

| Position | Impressions | Clicks | Page |
|---:|---:|---:|---|
| **8.5** | **3,574** | **7** | `/merchandising-services/` |
| 32.4 | 613 | 0 | `/services/merchandising/` |
| 58.1 | 12 | 0 | `/what-is-retail-merchandising/` |
| 62.3 | 9 | 0 | `/retail-merchandising/` |

**Two separate service pages exist for the same service** — `/merchandising-services/` and `/services/merchandising/`. That is real duplication and the clearest fix on the site.

### "retail merchandising" — 4,960 impressions · **0 clicks** · 7 pages

| Position | Impressions | Page |
|---:|---:|---|
| 39.6 | 2,446 | `/retail-merchandising/` |
| 27.9 | 1,289 | `/merchandising-services/` |
| 61.4 | 1,161 | `/what-is-retail-merchandising/` |
| 55.8 | 33 | `/services/merchandising/` |

Three near-identical pages, none on page one, **zero clicks from ~5,000 impressions**. This is genuine dilution: the topic has demand and we rank nowhere with any of them.

---

## Actions, in order

### 1. Merge the duplicate merchandising service pages — highest confidence

`/services/merchandising/` (pos 32.4) → **301 → `/merchandising-services/`** (pos 8.5)

Two pages selling the same service compete for the same term. Keep the stronger, redirect the weaker, and fold any unique content across.

*Confirm first:* check whether `/services/merchandising/` is linked from the main navigation. If it is, the nav must point at the survivor before redirecting.

### 2. Consolidate the "retail merchandising" trio

`/what-is-retail-merchandising/` (pos 61.4) and `/retail-merchandising/` (pos 39.6) overlap heavily and neither ranks.

**Recommended:** keep `/retail-merchandising/` as the informational page (it holds the most impressions of the two), merge the useful content from `/what-is-retail-merchandising/` into it, and 301 the latter. Link it to `/merchandising-services/` as the commercial destination.

*Judgement call for the client:* if `/retail-merchandising/` is thin, the reverse direction may be better. Both rank badly, so neither has authority worth preserving on its own.

### 3. Strengthen `/services/brand-ambassadors/` — do not start by merging

It already receives 95.5% of the term's impressions at position 10.5. To move it up:

- Fix its title and meta description (part of the Phase 2 title work)
- Add internal links **to** it from the 12 satellite articles, anchored "brand ambassador" — these posts are far more useful as link sources than as merge candidates
- Expand it to properly answer the term, not just sell the service
- **Re-measure in three weeks.** Position responds before clicks do.

Merging the satellites is a later, optional step. On this evidence it is not where the gain is, and it would destroy pages that currently serve a linking purpose.

### 4. Leave the low-CTR informational pages alone

The query breakdown showed a third of their exposure is machine-generated entity lookups that never click. They are not a growth opportunity, and effort spent on them displaces the work above.

---

## What this needs

| Step | Needs | Blocked? |
|---|---|---|
| 1 — merge service pages | WordPress edit + redirect | Yes |
| 2 — consolidate trio | WordPress edit + redirect | Yes |
| 3 — internal links | WordPress edit | Yes |
| 3 — title/meta | WPCode override snippet | Yes |

All four need publishing access. The analysis is done and will not change; the moment access arrives this is executable without further investigation.

---

## How to verify it worked

The dashboard tracks these terms every day. After any change, watch:

- **Position** on `/services/brand-ambassadors/` for "brand ambassador" — currently **10.5**
- **Competing page count** for "retail merchandising services" — currently **4**, should fall to 2
- **Clicks** on "retail merchandising" — currently **0**

Position moves within days of a re-crawl; clicks follow. If position has not moved in three weeks, the change was not the constraint and we re-plan rather than repeat.

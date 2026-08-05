# T-ROC SEO Dashboard

Auto-refreshing SEO dashboard for **trocglobal.com**, built on the Ahrefs API v3
and Google PageSpeed Insights.

## How it works

```
GitHub Actions (every 6h)  →  scripts/fetch-data.mjs  →  data/latest.json  →  index.html
        ▲                              ▲
   encrypted Secrets            server-side only
```

The page reads a committed JSON file. It never talks to Ahrefs directly.

### Why not fetch live from the browser?

Because the Ahrefs API is **metered and paid**, and a browser fetch requires the
token to be present in client-side JavaScript — where any visitor can read it and
spend your quota. There is no way to hide a key in a static page.

So data refreshes **every 6 hours** rather than on page load. The dashboard shows
its own last-updated timestamp so the freshness is never ambiguous. If you need
true on-demand refresh, the fix is a small serverless proxy (Cloudflare Worker or
Vercel function) that holds the token — not client-side fetching.

## Setup

### 1. Add the secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Required | Purpose |
|---|---|---|
| `AHREFS_API_TOKEN` | yes | All Ahrefs metrics. Get one at <https://ahrefs.com/api> |
| `GOOGLE_API_KEY` | no | Core Web Vitals via PageSpeed Insights |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | no | Search Console clicks, impressions, CTR |

Never put these in a file. They belong only in Secrets.

### 1b. Connect Search Console (recommended)

Search Console gives **measured clicks** instead of Ahrefs' modeled estimates, and
the API is **free and unmetered** — no quota risk. A plain API key will not work:

```
401 — API keys are not supported by this API.
      Expected OAuth2 access token or other authentication credentials.
```

You need a service account:

1. <https://console.cloud.google.com> → create or pick a project
2. **APIs & Services → Library** → enable **Google Search Console API**
3. **IAM & Admin → Service Accounts → Create service account** (any name)
4. Open it → **Keys → Add key → Create new key → JSON** → download
5. Copy the `client_email` from that file (`…@….iam.gserviceaccount.com`)
6. **Search Console → Settings → Users and permissions → Add user** → paste that
   email → permission **Restricted** is enough
7. Add the **entire JSON file contents** as the `GOOGLE_SERVICE_ACCOUNT_JSON` secret

The connector auto-detects whether the property is registered as
`sc-domain:trocglobal.com` or `https://trocglobal.com/`. If the service account
has no access, the run logs exactly which properties it *can* see.

**Search Console data lags 2–3 days.** That is Google's pipeline, not this
dashboard — no tool can show real-time GSC data. The connector requests up to
three days before today for that reason.

### 2. Enable Pages

**Settings → Pages → Source: GitHub Actions**

### 3. Run it

**Actions → Refresh SEO data → Run workflow.** After it completes, the site
publishes and `data/latest.json` is committed.

## What the dashboard reports

- Core Ahrefs metrics — traffic, DR, keywords, Top-3, referring domains
- 13-month organic traffic trend
- **Branded vs non-branded split** — computed by explicit pattern match
- **Rankings earning no clicks** — top-10 positions with 150+ volume and zero traffic
- Top keywords and pages
- Core Web Vitals from real Chrome field data

## Known limitations

These are properties of the data, not bugs. They are surfaced in the dashboard footer.

- **Ahrefs traffic is a model, not measured clicks.** Search Console is the source
  of truth. Treat these as directional.
- **Keyword data covers the top 100 by traffic only.** The Ahrefs plan in use
  ignores the `offset` parameter — every page of results returns the same rows, so
  pagination is impossible. That top 100 still covers roughly 90% of traffic, but
  the long tail is genuinely unmeasured.
- **Ahrefs' `is_branded` flag is unreliable for this domain** — it marks
  "walmart wallpaper" as branded and "troc" as non-branded. The split is therefore
  computed from an explicit regex in `scripts/fetch-data.mjs`; update `BRAND_RE`
  if the brand terms change.
- **Search Console data is not included.** The GSC API rejects plain API keys
  (`401 — API keys are not supported by this API`) and requires OAuth or a service
  account. Adding real click and impression data means creating a service account
  and granting it access in Search Console.

### A note on the brand split

An earlier dashboard reported "100% non-branded — strong organic discovery" while
holding **zero** click data. This one refuses to render a percentage when the
sample is empty, and says so instead. An empty dataset is not evidence of 100% of
anything.

## Local development

```bash
AHREFS_API_TOKEN=xxx node scripts/fetch-data.mjs   # requires Node 18+
python3 -m http.server 8000                        # then open localhost:8000
```

Serve over HTTP rather than opening `index.html` directly — `fetch()` is blocked
on `file://` origins.

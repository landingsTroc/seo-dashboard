/**
 * Fetches SEO data from Ahrefs API v3 + Google PageSpeed Insights and writes
 * data/latest.json for the dashboard to read.
 *
 * Runs inside GitHub Actions ONLY — never in the browser. The API tokens come
 * from repository Secrets and must never be committed or shipped to the client.
 *
 *   AHREFS_API_TOKEN  (required)  https://ahrefs.com/api
 *   GOOGLE_API_KEY    (optional)  PageSpeed Insights / CrUX field data
 */

import { writeFile, mkdir } from "node:fs/promises";

const AHREFS_TOKEN = process.env.AHREFS_API_TOKEN;
const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
const TARGET = process.env.TARGET_DOMAIN || "trocglobal.com";
const MODE = "subdomains";

if (!AHREFS_TOKEN) {
  console.error("FATAL: AHREFS_API_TOKEN is not set. Add it under Settings → Secrets → Actions.");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

/** Ahrefs terms that count as OUR brand. Ahrefs' own is_branded flag is
 *  unreliable for this domain — it marks "walmart wallpaper" branded and
 *  "troc" non-branded — so we classify explicitly. */
const BRAND_RE = /troc|t-roc|t roc|retail outsource|revenue optimization compan/i;

async function ahrefs(endpoint, params = {}) {
  const url = new URL(`https://api.ahrefs.com/v3/site-explorer/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AHREFS_TOKEN}`, Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ahrefs ${endpoint} → HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** PageSpeed Insights returns real Chrome field data. Optional: a missing or
 *  unauthorized key degrades the CWV card rather than failing the whole run. */
async function pagespeed(strategy) {
  if (!GOOGLE_KEY) return null;
  const url = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  url.searchParams.set("url", `https://${TARGET}`);
  url.searchParams.set("key", GOOGLE_KEY);
  url.searchParams.set("strategy", strategy);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`PageSpeed (${strategy}) HTTP ${res.status} — skipping CWV.`);
      return null;
    }
    const json = await res.json();
    const m = json?.loadingExperience?.metrics;
    if (!m) return null;
    return {
      strategy,
      overall: json.loadingExperience.overall_category ?? null,
      lcp: m.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
      cls: m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile ?? null,
      inp: m.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
      performanceScore: Math.round((json?.lighthouseResult?.categories?.performance?.score ?? 0) * 100) || null,
    };
  } catch (err) {
    console.warn(`PageSpeed (${strategy}) failed: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log(`Fetching Ahrefs data for ${TARGET} @ ${today}`);

  const base = { target: TARGET, mode: MODE, date: today };

  const [metrics, dr, backlinks, history, refdomainsHistory] = await Promise.all([
    ahrefs("metrics", base),
    ahrefs("domain-rating", { target: TARGET, date: today }),
    ahrefs("backlinks-stats", base),
    ahrefs("metrics-history", {
      target: TARGET, mode: MODE,
      date_from: new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10),
      history_grouping: "monthly", volume_mode: "monthly",
    }),
    ahrefs("refdomains-history", {
      target: TARGET, mode: MODE,
      date_from: new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10),
      history_grouping: "monthly",
    }),
  ]);

  // NOTE: the Ahrefs plan in use ignores `offset` — every page returns the same
  // rows — so this is the top 100 by traffic, not the full keyword set. It still
  // covers ~90% of traffic. Do not present it as exhaustive.
  const kwResp = await ahrefs("organic-keywords", {
    target: TARGET, mode: MODE, date: today, country: "us",
    select: "keyword,best_position,best_position_url,volume,keyword_difficulty,sum_traffic",
    order_by: "sum_traffic:desc", limit: "100",
  });

  const pagesResp = await ahrefs("top-pages", {
    target: TARGET, mode: MODE, date: today, country: "us",
    select: "url,sum_traffic,keywords,top_keyword,top_keyword_volume,top_keyword_best_position",
    order_by: "sum_traffic:desc", limit: "20",
  });

  const keywords = kwResp.keywords ?? [];

  // Branded vs non-branded — the number the old dashboard reported as
  // "100% non-branded" while holding zero data.
  let brandedTraffic = 0, nonBrandedTraffic = 0, brandedCount = 0, nonBrandedCount = 0;
  for (const k of keywords) {
    const t = k.sum_traffic ?? 0;
    if (BRAND_RE.test(k.keyword)) { brandedTraffic += t; brandedCount++; }
    else { nonBrandedTraffic += t; nonBrandedCount++; }
  }
  const sampleTraffic = brandedTraffic + nonBrandedTraffic;

  const [mobile, desktop] = await Promise.all([pagespeed("mobile"), pagespeed("desktop")]);

  // "Rankings that earn no clicks" — ranked top 10, decent volume, zero traffic.
  const deadRankings = keywords
    .filter((k) => (k.best_position ?? 99) <= 10 && (k.sum_traffic ?? 0) === 0 && (k.volume ?? 0) >= 150)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

  const out = {
    generatedAt: new Date().toISOString(),
    target: TARGET,
    scope: `${MODE} · US`,
    summary: {
      domainRating: dr?.domain_rating?.domain_rating ?? null,
      ahrefsRank: dr?.domain_rating?.ahrefs_rank ?? null,
      organicTraffic: metrics?.metrics?.org_traffic ?? null,
      organicCost: metrics?.metrics?.org_cost ?? null,
      organicKeywords: metrics?.metrics?.org_keywords ?? null,
      keywordsTop3: metrics?.metrics?.org_keywords_1_3 ?? null,
      paidTraffic: metrics?.metrics?.paid_traffic ?? null,
      liveBacklinks: backlinks?.metrics?.live ?? null,
      liveRefdomains: backlinks?.metrics?.live_refdomains ?? null,
    },
    brandSplit: {
      sampleTraffic,
      sampleSize: keywords.length,
      brandedTraffic, nonBrandedTraffic, brandedCount, nonBrandedCount,
      brandedPct: sampleTraffic ? +((brandedTraffic / sampleTraffic) * 100).toFixed(1) : null,
      nonBrandedPct: sampleTraffic ? +((nonBrandedTraffic / sampleTraffic) * 100).toFixed(1) : null,
      note: "Computed from the top 100 keywords by traffic, classified manually. Null when no data — never assume 100%.",
    },
    trafficHistory: (history?.metrics ?? []).map((m) => ({
      date: m.date.slice(0, 7), organic: m.org_traffic, paid: m.paid_traffic,
    })),
    refdomainsHistory: (refdomainsHistory?.refdomains ?? []).map((m) => ({
      date: m.date.slice(0, 7), refdomains: m.refdomains,
    })),
    topKeywords: keywords.slice(0, 25).map((k) => ({
      keyword: k.keyword, position: k.best_position, volume: k.volume,
      difficulty: k.keyword_difficulty, traffic: k.sum_traffic,
      url: k.best_position_url, branded: BRAND_RE.test(k.keyword),
    })),
    topPages: (pagesResp?.pages ?? []).map((p) => ({
      url: p.url, traffic: p.sum_traffic, keywords: p.keywords, topKeyword: p.top_keyword,
    })),
    deadRankings: deadRankings.map((k) => ({
      keyword: k.keyword, position: k.best_position, volume: k.volume, url: k.best_position_url,
    })),
    coreWebVitals: { mobile, desktop },
    caveats: [
      "Ahrefs traffic is a modeled estimate, not measured clicks. Search Console is the source of truth.",
      "Keyword data covers the top 100 by traffic — the Ahrefs plan in use ignores pagination offset.",
      "Branded/non-branded is classified by explicit pattern match; Ahrefs' is_branded flag is unreliable for this domain.",
    ],
  };

  await mkdir("data", { recursive: true });
  await writeFile("data/latest.json", JSON.stringify(out, null, 2));

  console.log(`OK — traffic ${out.summary.organicTraffic}, DR ${out.summary.domainRating}, ` +
    `${out.summary.organicKeywords} keywords, brand split ${out.brandSplit.brandedPct}% branded, ` +
    `${out.deadRankings.length} dead rankings`);
}

main().catch((err) => {
  console.error("Fetch failed:", err.message);
  process.exit(1);
});

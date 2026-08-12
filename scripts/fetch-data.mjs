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

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { fetchSearchConsole } from "./gsc.mjs";

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

/** Last successful run, used so one failing source can't blank the others. */
async function loadPrevious() {
  try {
    return JSON.parse(await readFile("data/latest.json", "utf8"));
  } catch {
    return null;
  }
}

async function collectAhrefs() {
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

  // Sorted by VOLUME, not traffic. The zero-traffic rankings we care about sit at
  // the bottom of a traffic-sorted list and never appear in its top 100 — sorting
  // by volume is the only way this plan surfaces them (offset is ignored).
  const volResp = await ahrefs("organic-keywords", {
    target: TARGET, mode: MODE, date: today, country: "us",
    select: "keyword,best_position,best_position_url,volume,keyword_difficulty,sum_traffic",
    order_by: "volume:desc", limit: "100",
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
  // Derived from the volume-sorted set for the reason noted above.
  const byVolume = volResp.keywords ?? [];
  const deadRankings = byVolume
    .filter((k) => (k.best_position ?? 99) <= 10 && (k.sum_traffic ?? 0) === 0 && (k.volume ?? 0) >= 150)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

  return {
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
    _log: `traffic ${metrics?.metrics?.org_traffic}, DR ${dr?.domain_rating?.domain_rating}, ` +
      `${deadRankings.length} dead rankings (from ${byVolume.length} volume-sorted keywords)`,
  };
}

async function main() {
  const prev = await loadPrevious();

  // Each source fails independently. A metered Ahrefs 403 must not cost us the
  // free Search Console data, and vice versa.
  let ahrefs = null, ahrefsError = null;
  try {
    ahrefs = await collectAhrefs();
    console.log(`Ahrefs OK — ${ahrefs._log}`);
    delete ahrefs._log;
    if (ahrefs.deadRankings.length === 0) {
      console.warn("NOTE: no zero-traffic top-10 rankings found. Verify the volume-sorted " +
        "query still returns rows — an empty result previously meant a sort-order bug, not a clean site.");
    }
  } catch (err) {
    ahrefsError = err.message;
    console.warn(`Ahrefs FAILED — ${err.message}`);
    if (/units limit reached/i.test(err.message)) {
      console.warn("Ahrefs units exhausted (~3,300 per run). Wait for the monthly reset; " +
        "do not re-run to retry.");
    }
    if (!prev) throw new Error(`Ahrefs failed with no previous data to fall back on: ${err.message}`);
    console.warn("Reusing the previous Ahrefs data.");
  }

  let gsc = null, gscError = null;
  try {
    gsc = await fetchSearchConsole(TARGET, BRAND_RE);
    if (gsc) {
      console.log(`GSC OK — ${gsc.totals.clicks} clicks / ${gsc.totals.impressions} impressions ` +
        `(CTR ${gsc.totals.ctr}%), ${gsc.lowCtrHighRank.length} pages ranked top-10 with CTR under 2%`);
    }
  } catch (err) {
    gscError = err.message;
    console.warn(`GSC FAILED — ${err.message}`);
  }

  const a = ahrefs ?? prev;

  // Ahrefs reports a live snapshot, not history, for DR / keywords / refdomains.
  // Week-over-week on those is only possible if we store consecutive readings —
  // so keep one entry per day, and only when the fetch actually succeeded.
  const ahrefsHistory = (prev?.ahrefsHistory ?? []).filter((h) => h.date !== today);
  if (ahrefs) {
    ahrefsHistory.push({
      date: today,
      domainRating: ahrefs.summary.domainRating,
      organicKeywords: ahrefs.summary.organicKeywords,
      keywordsTop3: ahrefs.summary.keywordsTop3,
      liveRefdomains: ahrefs.summary.liveRefdomains,
      liveBacklinks: ahrefs.summary.liveBacklinks,
    });
  }
  ahrefsHistory.sort((x, y) => (x.date < y.date ? -1 : 1));
  while (ahrefsHistory.length > 120) ahrefsHistory.shift();

  const out = {
    generatedAt: new Date().toISOString(),
    target: TARGET,
    scope: `${MODE} · US`,
    sources: {
      ahrefs: { ok: !!ahrefs, error: ahrefsError, asOf: ahrefs ? new Date().toISOString() : prev?.sources?.ahrefs?.asOf ?? prev?.generatedAt ?? null },
      searchConsole: { ok: !!gsc, error: gscError, asOf: gsc ? new Date().toISOString() : prev?.sources?.searchConsole?.asOf ?? null },
    },
    summary: a?.summary ?? {},
    brandSplit: a?.brandSplit ?? {},
    trafficHistory: a?.trafficHistory ?? [],
    refdomainsHistory: a?.refdomainsHistory ?? [],
    topKeywords: a?.topKeywords ?? [],
    topPages: a?.topPages ?? [],
    deadRankings: a?.deadRankings ?? [],
    coreWebVitals: a?.coreWebVitals ?? {},
    ahrefsHistory,
    searchConsole: gsc ?? prev?.searchConsole ?? null,
    caveats: [
      "Ahrefs traffic is a modeled estimate, not measured clicks. Search Console clicks are the source of truth where both are present.",
      "Search Console data lags 2-3 days — Google's pipeline, not a limitation of this dashboard.",
      "Ahrefs keyword data covers the top 100 by traffic; that plan ignores pagination offset.",
      "Branded/non-branded is classified by explicit pattern match; Ahrefs' is_branded flag is unreliable for this domain.",
    ],
  };

  await mkdir("data", { recursive: true });
  await writeFile("data/latest.json", JSON.stringify(out, null, 2));
  console.log(`Wrote data/latest.json — ahrefs=${!!ahrefs} searchConsole=${!!gsc}`);
}

main().catch(async (err) => {
  console.error("Fetch failed:", err.message);

  // Quota exhaustion and transient API errors must not wipe or block the site.
  // Leave the existing data/latest.json untouched and let the deploy proceed —
  // the dashboard surfaces its own age, so stale data is visible, not silent.
  const { access } = await import("node:fs/promises");
  try {
    await access("data/latest.json");
    console.warn("Keeping the existing data/latest.json. The site will publish with stale data.");
    if (/units limit reached/i.test(err.message)) {
      console.warn("Ahrefs API units are exhausted. Each run costs ~3,300 units; " +
        "reduce the schedule or wait for the monthly reset rather than re-running.");
    }
    process.exit(0);
  } catch {
    console.error("No existing data/latest.json to fall back on — failing so this is not silent.");
    process.exit(1);
  }
});

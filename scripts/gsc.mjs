/**
 * Google Search Console connector.
 *
 * Authenticates a service account with a signed JWT (RS256) and queries the
 * Search Analytics API. Uses only Node built-ins — no dependencies.
 *
 * Required secret: GOOGLE_SERVICE_ACCOUNT_JSON — the full service-account JSON
 * key, pasted verbatim. A plain API key does NOT work here; the API rejects it
 * with "API keys are not supported by this API".
 *
 * The service account's client_email must be added as a user in Search Console
 * (Settings → Users and permissions). "Restricted" is enough.
 */

import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

const b64url = (input) => Buffer.from(input).toString("base64url");

/** Exchange a service-account key for an OAuth2 access token. */
async function getAccessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: creds.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));

  let signature;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claim}`);
    signature = signer.sign(creds.private_key, "base64url");
  } catch (err) {
    // OpenSSL's "DECODER routines::unsupported" means the private key isn't a
    // usable PEM. Almost always a paste problem, not a bad key.
    throw new Error(
      `could not sign with private_key (${err.message}). The key must be the full PEM ` +
      `including the BEGIN/END lines. Paste the service-account JSON file verbatim — ` +
      `do not unescape the \\n sequences, reformat it, or wrap it in extra quotes.`
    );
  }
  const jwt = `${header}.${claim}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`token exchange HTTP ${res.status}: ${JSON.stringify(json).slice(0, 240)}`);
  }
  return json.access_token;
}

async function query(token, siteUrl, body) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`searchAnalytics HTTP ${res.status}: ${JSON.stringify(json).slice(0, 240)}`);
  }
  return json.rows ?? [];
}

/** Find which property form this account can actually read. */
async function resolveSite(token, domain) {
  const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`sites.list HTTP ${res.status}: ${JSON.stringify(json).slice(0, 240)}`);
  }
  const entries = json.siteEntry ?? [];
  const wanted = [`sc-domain:${domain}`, `https://${domain}/`, `https://www.${domain}/`];
  const hit = wanted.find((w) => entries.some((e) => e.siteUrl === w));
  if (hit) return hit;

  throw new Error(
    `service account has no access to ${domain}. Properties it can see: ` +
    (entries.map((e) => e.siteUrl).join(", ") || "(none)") +
    ". Add its client_email under Search Console → Settings → Users and permissions."
  );
}

const iso = (d) => d.toISOString().slice(0, 10);

export async function fetchSearchConsole(domain, brandRe) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn("GSC: GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping Search Console.");
    return null;
  }

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the whole key file, including braces.");
  }
  if (!creds.client_email || !creds.private_key) {
    throw new Error("Service-account JSON is missing client_email or private_key.");
  }

  const token = await getAccessToken(creds);
  const siteUrl = await resolveSite(token, domain);
  console.log(`GSC: authenticated as ${creds.client_email}, reading ${siteUrl}`);

  // Search Console data lags ~2-3 days; asking for today returns empty rows.
  const endDate = iso(new Date(Date.now() - 3 * 864e5));
  const startDate = iso(new Date(Date.now() - 93 * 864e5));
  const base = { startDate, endDate, type: "web" };

  const [dateRows, queryRows, pageRows] = await Promise.all([
    query(token, siteUrl, { ...base, dimensions: ["date"], rowLimit: 500 }),
    query(token, siteUrl, { ...base, dimensions: ["query"], rowLimit: 250 }),
    query(token, siteUrl, { ...base, dimensions: ["page"], rowLimit: 250 }),
  ]);

  const totals = dateRows.reduce(
    (a, r) => ({ clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions }),
    { clicks: 0, impressions: 0 }
  );

  // The branded split, finally from measured clicks rather than modeled traffic.
  let brandedClicks = 0, nonBrandedClicks = 0;
  for (const r of queryRows) {
    if (brandRe.test(r.keys[0])) brandedClicks += r.clicks;
    else nonBrandedClicks += r.clicks;
  }
  const clickSample = brandedClicks + nonBrandedClicks;

  // The title/CTR test: ranked well, seen often, barely clicked.
  const lowCtrHighRank = pageRows
    .filter((r) => r.position <= 10 && r.impressions >= 200 && r.ctr < 0.02)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 25)
    .map((r) => ({
      page: r.keys[0], clicks: r.clicks, impressions: r.impressions,
      ctr: +(r.ctr * 100).toFixed(2), position: +r.position.toFixed(1),
    }));

  // For each badly-converting page, what are people actually searching when they
  // see it? This is what separates a title/snippet problem from a page that
  // simply is not what the searcher wanted. Search Console is unmetered, so the
  // extra calls are free.
  const diagnoseTargets = lowCtrHighRank.slice(0, 15);
  const pageQueries = [];
  for (const t of diagnoseTargets) {
    try {
      // The API sorts rows by clicks and has no orderBy, so a low-click page
      // returns its least interesting queries first. Pull deep, then sort by
      // impressions ourselves to find what actually drives the exposure.
      const rows = await query(token, siteUrl, {
        ...base,
        dimensions: ["query"],
        rowLimit: 1000,
        dimensionFilterGroups: [{
          filters: [{ dimension: "page", operator: "equals", expression: t.page }],
        }],
      });
      const named = rows.reduce((a, r) => a + r.impressions, 0);
      const byImpressions = rows.slice().sort((a, b) => b.impressions - a.impressions);

      pageQueries.push({
        page: t.page, pageCtr: t.ctr, pagePosition: t.position, pageImpressions: t.impressions,
        namedQueryCount: rows.length,
        namedImpressions: named,
        // Google withholds rare queries. A large gap means most exposure cannot
        // be attributed to any search we can see — which is itself a finding.
        anonymizedImpressions: Math.max(0, t.impressions - named),
        anonymizedPct: t.impressions ? +(((t.impressions - named) / t.impressions) * 100).toFixed(1) : null,
        topQueries: byImpressions.slice(0, 12).map((r) => ({
          query: r.keys[0], clicks: r.clicks, impressions: r.impressions,
          ctr: +(r.ctr * 100).toFixed(2), position: +r.position.toFixed(1),
          shareOfPageImpressions: t.impressions ? +((r.impressions / t.impressions) * 100).toFixed(2) : null,
        })),
      });
    } catch (err) {
      console.warn(`GSC: query breakdown failed for ${t.page} — ${err.message}`);
    }
  }
  console.log(`GSC: query breakdown captured for ${pageQueries.length}/${diagnoseTargets.length} low-CTR pages`);

  // Which page does Google actually choose for our commercial head terms? If
  // several of our own pages appear, we are competing with ourselves and the
  // fix is consolidation, not more content.
  const COMMERCIAL_TERMS = [
    "brand ambassador",
    "brand ambassadors",
    "brand ambassador programs",
    "retail merchandising services",
    "merchandising services",
    "retail merchandising",
  ];
  const termPages = [];
  for (const term of COMMERCIAL_TERMS) {
    try {
      const rows = await query(token, siteUrl, {
        ...base,
        dimensions: ["page"],
        rowLimit: 25,
        dimensionFilterGroups: [{
          filters: [{ dimension: "query", operator: "equals", expression: term }],
        }],
      });
      if (!rows.length) continue;
      termPages.push({
        term,
        totalImpressions: rows.reduce((a, r) => a + r.impressions, 0),
        totalClicks: rows.reduce((a, r) => a + r.clicks, 0),
        competingPages: rows.length,
        pages: rows
          .sort((a, b) => b.impressions - a.impressions)
          .map((r) => ({
            page: r.keys[0], clicks: r.clicks, impressions: r.impressions,
            ctr: +(r.ctr * 100).toFixed(2), position: +r.position.toFixed(1),
          })),
      });
    } catch (err) {
      console.warn(`GSC: term breakdown failed for "${term}" — ${err.message}`);
    }
  }
  const cannibalised = termPages.filter((t) => t.competingPages > 1);
  console.log(`GSC: ${termPages.length} commercial terms analysed, ` +
    `${cannibalised.length} show more than one of our pages competing`);

  // Per-page query inventory for the pages we are actively trying to rank.
  // termPages answers "which of our pages does Google pick?"; this answers the
  // next question — "for that page, which specific queries are close enough to
  // move?" Anything at position 4-20 with real impressions is a candidate; a
  // page at 10.5 overall is an average hiding both winnable and hopeless terms.
  const TARGET_PAGES = [
    "https://trocglobal.com/services/brand-ambassadors/",
    "https://trocglobal.com/services/merchandising/",
    "https://trocglobal.com/services/mystery-shopping-and-audits/",
  ];
  const pageOpportunities = [];
  for (const page of TARGET_PAGES) {
    try {
      const rows = await query(token, siteUrl, {
        ...base,
        dimensions: ["query"],
        rowLimit: 500,
        dimensionFilterGroups: [{
          filters: [{ dimension: "page", operator: "equals", expression: page }],
        }],
      });
      if (!rows.length) { console.warn(`GSC: no query rows for ${page}`); continue; }
      const queries = rows
        .map((r) => ({
          query: r.keys[0], clicks: r.clicks, impressions: r.impressions,
          ctr: +(r.ctr * 100).toFixed(2), position: +r.position.toFixed(1),
          branded: brandRe.test(r.keys[0]),
        }))
        .sort((a, b) => b.impressions - a.impressions);
      const impressions = queries.reduce((a, q) => a + q.impressions, 0);
      const clicks = queries.reduce((a, q) => a + q.clicks, 0);
      pageOpportunities.push({
        page,
        totalQueries: queries.length,
        clicks,
        impressions,
        ctr: impressions ? +((clicks / impressions) * 100).toFixed(2) : null,
        // Impression-weighted, so one high-volume term at 18 is not hidden by
        // fifty long-tail terms at 3.
        position: impressions
          ? +(queries.reduce((a, q) => a + q.position * q.impressions, 0) / impressions).toFixed(1)
          : null,
        // Non-branded only: no amount of on-page work moves "t-roc" rankings,
        // and including them flatters the numbers.
        strikingDistance: queries
          .filter((q) => !q.branded && q.position >= 4 && q.position <= 20 && q.impressions >= 20)
          .slice(0, 40),
        alreadyTop3: queries.filter((q) => !q.branded && q.position < 4).length,
        queries: queries.slice(0, 100),
      });
    } catch (err) {
      console.warn(`GSC: page opportunity query failed for ${page} — ${err.message}`);
    }
  }
  for (const p of pageOpportunities) {
    console.log(`GSC: ${p.page} — ${p.totalQueries} queries, pos ${p.position}, ` +
      `${p.strikingDistance.length} non-branded terms in striking distance`);
  }

  return {
    siteUrl,
    dateRange: { startDate, endDate },
    pageQueries,
    termPages,
    pageOpportunities,
    totals: {
      clicks: totals.clicks,
      impressions: totals.impressions,
      ctr: totals.impressions ? +((totals.clicks / totals.impressions) * 100).toFixed(2) : null,
    },
    daily: dateRows.map((r) => ({
      date: r.keys[0], clicks: r.clicks, impressions: r.impressions,
      ctr: +(r.ctr * 100).toFixed(2), position: +r.position.toFixed(1),
    })),
    brandSplitByClicks: clickSample ? {
      brandedClicks, nonBrandedClicks, sampleClicks: clickSample,
      brandedPct: +((brandedClicks / clickSample) * 100).toFixed(1),
      nonBrandedPct: +((nonBrandedClicks / clickSample) * 100).toFixed(1),
      note: "Measured clicks from Search Console — supersedes the Ahrefs-modeled split.",
    } : null,
    topQueries: queryRows.slice(0, 30).map((r) => ({
      query: r.keys[0], clicks: r.clicks, impressions: r.impressions,
      ctr: +(r.ctr * 100).toFixed(2), position: +r.position.toFixed(1),
      branded: brandRe.test(r.keys[0]),
    })),
    lowCtrHighRank,
  };
}

/**
 * Per-URL Search Console check.
 *
 * Answers one question for a supplied list of URLs: does Google serve this
 * page in search results? A URL with impressions is indexed. A URL with none
 * is either not indexed or simply never matched a query, which the report
 * states rather than guessing.
 *
 * Reuses the service-account auth in gsc.mjs. Required secret:
 * GOOGLE_SERVICE_ACCOUNT_JSON. "Restricted" access in Search Console is enough
 * for this; URL Inspection would need owner or full-user and is not used here.
 *
 * Usage:  node scripts/gsc-urls.mjs <list-file> [out-file]
 * The list file holds one path or absolute URL per line; blanks and lines
 * starting with # are ignored.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { getAccessToken, resolveSite } from "./gsc.mjs";

const DOMAIN = process.env.TARGET_DOMAIN || "trocglobal.com";
const DAYS = Number(process.env.GSC_DAYS || 90);

const iso = (d) => d.toISOString().slice(0, 10);

function loadList(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      if (/^https?:\/\//i.test(l)) return l;
      return `https://${DOMAIN}/${l.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
    });
}

/** One Search Analytics call filtered to a single page. */
async function pageRow(token, siteUrl, page, startDate, endDate) {
  const url =
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const body = {
    startDate,
    endDate,
    type: "web",
    dimensions: ["page"],
    rowLimit: 1,
    dimensionFilterGroups: [
      { filters: [{ dimension: "page", operator: "equals", expression: page }] },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} on ${page}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const row = data.rows?.[0];
  return {
    page,
    clicks: row?.clicks ?? 0,
    impressions: row?.impressions ?? 0,
    ctr: row ? Number((row.ctr * 100).toFixed(2)) : 0,
    position: row ? Number(row.position.toFixed(1)) : null,
    servedBySearch: Boolean(row && row.impressions > 0),
  };
}

async function main() {
  const listFile = process.argv[2];
  const outFile = process.argv[3] || "data/gsc-urls.json";
  if (!listFile) {
    console.error("usage: node scripts/gsc-urls.mjs <list-file> [out-file]");
    process.exit(2);
  }

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
    process.exit(1);
  }
  const creds = JSON.parse(raw);

  const token = await getAccessToken(creds);
  const siteUrl = await resolveSite(token, DOMAIN);
  const endDate = iso(new Date(Date.now() - 3 * 864e5));
  const startDate = iso(new Date(Date.now() - (DAYS + 3) * 864e5));
  console.log(`GSC: ${creds.client_email} -> ${siteUrl}, ${startDate}..${endDate}`);

  const pages = loadList(listFile);
  const results = [];
  for (const p of pages) {
    try {
      const r = await pageRow(token, siteUrl, p, startDate, endDate);
      results.push(r);
      console.log(
        `${r.servedBySearch ? "SERVED  " : "no data "} ${String(r.impressions).padStart(7)} impr  ${p}`,
      );
    } catch (err) {
      results.push({ page: p, error: String(err.message) });
      console.log(`ERROR    ${p}: ${err.message}`);
    }
    // Search Console allows a generous QPS, but there is no reason to rush a
    // one-off report, and a burst is the easiest way to get throttled.
    await new Promise((r) => setTimeout(r, 250));
  }

  const served = results.filter((r) => r.servedBySearch).length;
  const payload = {
    generatedAt: new Date().toISOString(),
    siteUrl,
    dateRange: { startDate, endDate },
    checked: results.length,
    servedBySearch: served,
    note:
      "impressions > 0 proves Google served the URL in results, so it is indexed. " +
      "Zero impressions is not proof of the opposite: a page can be indexed and " +
      "still never match a query in the window.",
    results,
  };
  writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`\n${served} of ${results.length} URLs were served by Google in the window.`);
  console.log(`wrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

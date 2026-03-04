// ─── lib/report-engine.js ────────────────────────────────────────────────────
// Core logic: search via Claude API + web search, score, filter, deduplicate

const SEARCH_QUERIES = [
  "Yale University news today",
  "Yale University research today 2026",
  "Yale New Haven Hospital news today",
  "Yale Law School news today",
  "Yale faculty announcement today",
  "Yale athletics results today",
  "Yale School of Medicine news today",
  "Yale University policy today",
  "Yale grants partnerships today",
  "Yale student campus news today",
];

const FALSE_POSITIVES = [
  "yale appliance",
  "yale lock",
  "yale forklift",
  "yale cbd",
];

const RISK_LEXICON = [
  "lawsuit","title ix","arrest","harassment","plagiarism","data breach",
  "misconduct","investigation","complaint","violation","scandal",
  "whistleblower","fraud","discrimination","retaliation","resignation",
  "termination","subpoena","injunction","protest","controversy",
];

const PROXIMITY_LABELS = { 3: "Direct", 2: "Indirect", 1: "Contextual" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isFalsePositive(text) {
  const l = text.toLowerCase();
  return FALSE_POSITIVES.some((fp) => l.includes(fp));
}

function scoreProximity(text) {
  const l = text.toLowerCase();
  if (isFalsePositive(text)) return 0;
  const direct = ["yale university","yale school","yale college","yale law","yale new haven","ynhh","ysm","ysph"];
  if (direct.some((t) => l.includes(t))) return 3;
  const indirect = ["yale researchers","yale professor","yale study","yale athletics","yale peabody","yale art gallery"];
  if (indirect.some((t) => l.includes(t))) return 2;
  if (l.includes("yale")) return 1;
  return 0;
}

function detectCategory(text) {
  const l = text.toLowerCase();
  if (RISK_LEXICON.some((w) => l.includes(w))) return "Risk & Watch";
  if (/research|study|discover|findings|journal|published|lab|clinical trial/.test(l)) return "Research";
  if (/grant|partnership|funding|endow|donation|philanthrop/.test(l)) return "Grants & Partnerships";
  if (/faculty|professor|hire|appoint|tenure|emerit/.test(l)) return "Faculty";
  if (/athlet|sport|game|coach|tournament|ncaa|ivy league/.test(l)) return "Athletics";
  if (/policy|strategy|president|provost|board|governance|ranking/.test(l)) return "Strategy & Policy";
  if (/student|art|museum|exhibit|concert|culture|campus life/.test(l)) return "Student Life & Arts";
  return "Research";
}

function detectGeo(text) {
  if (/global|international|world|countries|abroad/i.test(text)) return "Global";
  if (/new haven|connecticut|ct |hartford|bridgeport/i.test(text)) return "Local";
  return "National";
}

function computeScore(item) {
  const prox = item.proximity * 2;
  const catW = ["Research","Grants & Partnerships","Strategy & Policy"].includes(item.category) ? 2 : 1;
  const risk = item.category === "Risk & Watch" ? 3 : 0;
  return prox + catW + risk;
}

function dedup(items) {
  const seen = new Map();
  return items.filter((item) => {
    const normTitle = item.headline.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
    const normUrl = (item.url || "").replace(/[?#].*$/, "").toLowerCase();
    if (seen.has(normTitle)) return false;
    if (normUrl && normUrl !== "#" && [...seen.values()].some((v) => v === normUrl)) return false;
    seen.set(normTitle, normUrl);
    return true;
  });
}

// ─── Single search query via Claude API ──────────────────────────────────────

async function runSingleSearch(query, cutoffISO, apiKey) {
  const cutoffDate = new Date(cutoffISO);
  const cutoffStr = cutoffDate.toLocaleDateString("en-US", {
    timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric",
  });
  const cutoffTimeStr = cutoffDate.toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: true,
  });

  const systemPrompt = `You are a news research assistant for Yale University's Office of Public Affairs.
Search for VERY RECENT news about Yale University using the query provided.

CRITICAL TIME CONSTRAINT: Only include items published within the last 12 hours.
The current time is approximately ${new Date().toISOString()}.
The 12-hour cutoff is ${cutoffISO}. Only include articles published AFTER ${cutoffStr} ${cutoffTimeStr} ET.
If an article does not have a clear publication date within this window, EXCLUDE it.

Return ONLY a JSON array (no markdown, no backticks, no preamble) of news items.
Each item must have these fields:
- "headline": string (max 12 words, AP style)
- "source": string (publication name)
- "url": string (article URL, use "#" if unknown)
- "summary": string (1-2 sentences, neutral AP style, 12-25 words, mention specific Yale entity)
- "tags": array of strings (topic tags)
- "pub_time": string (ISO 8601 publication timestamp if available, "" if unknown)

Return 0-5 items. Only genuine Yale University items. If nothing qualifies, return [].`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: `Search for: ${query}` }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (!text.trim()) return [];
    const match = text.replace(/```json|```/g, "").trim().match(/\[[\s\S]*\]/);
    if (!match) return [];
    const items = JSON.parse(match[0]);
    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.error(`[search] Error for "${query}":`, err.message);
    return [];
  }
}

// ─── Full report generation ──────────────────────────────────────────────────

async function generateReport(apiKey) {
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const cutoffISO = cutoffTime.toISOString();

  console.log(`[report] Starting report generation at ${now.toISOString()}`);
  console.log(`[report] 12-hour cutoff: ${cutoffISO}`);

  let allRaw = [];
  let stats = { falsePositives: 0, timeFiltered: 0, duplicates: 0 };

  for (let i = 0; i < SEARCH_QUERIES.length; i++) {
    const q = SEARCH_QUERIES[i];
    console.log(`[report] (${i + 1}/${SEARCH_QUERIES.length}) Searching: ${q}`);

    const results = await runSingleSearch(q, cutoffISO, apiKey);

    for (const r of results) {
      // Time filter
      if (r.pub_time) {
        try {
          const pubDate = new Date(r.pub_time);
          if (!isNaN(pubDate.getTime()) && pubDate < cutoffTime) {
            stats.timeFiltered++;
            continue;
          }
        } catch (e) { /* keep if parse fails */ }
      }

      const fullText = `${r.headline || ""} ${r.summary || ""}`;
      if (isFalsePositive(fullText)) { stats.falsePositives++; continue; }

      const proximity = scoreProximity(fullText);
      if (proximity === 0) { stats.falsePositives++; continue; }

      allRaw.push({
        headline: r.headline || "Untitled",
        source: r.source || "Unknown",
        url: r.url || "#",
        summary: r.summary || "",
        tags: r.tags || [],
        pub_time: r.pub_time || "",
        proximity,
        proximityLabel: PROXIMITY_LABELS[proximity],
        category: detectCategory(fullText),
        geo: detectGeo(fullText),
        score: 0,
      });
    }

    // Rate-limit pause between queries
    if (i < SEARCH_QUERIES.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const beforeDedup = allRaw.length;
  const items = dedup(allRaw);
  stats.duplicates = beforeDedup - items.length;

  items.forEach((item) => (item.score = computeScore(item)));
  items.sort((a, b) => b.score - a.score);

  const report = {
    generatedAt: now.toISOString(),
    cutoffStart: cutoffISO,
    cutoffEnd: now.toISOString(),
    items,
    stats: {
      total: items.length,
      ...stats,
    },
  };

  console.log(`[report] Complete: ${items.length} items kept, ${stats.duplicates} dupes, ${stats.falsePositives} false positives, ${stats.timeFiltered} outside window`);
  return report;
}

module.exports = { generateReport, PROXIMITY_LABELS };

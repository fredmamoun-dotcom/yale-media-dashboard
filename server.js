// ─── Yale Media Dashboard — Single-file server ──────────────────────────────
// Everything in one file: search engine, email builder, mailer, server + dashboard

require("dotenv").config();
const express = require("express");
const cron = require("node-cron");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Publication-targeted searches ───────────────────────────────────────────
// Each group targets specific publication domains via allowed_domains.
// The API's web_search tool will only return results from these domains.

const SEARCHES = [
  // Yale's own sources
  {
    query: "Yale University",
    domains: ["news.yale.edu", "yaledailynews.com", "medicine.yale.edu", "law.yale.edu", "seas.yale.edu", "jackson.yale.edu", "som.yale.edu", "gsas.yale.edu", "divinity.yale.edu"],
  },
  // Major national newspapers
  {
    query: "Yale University",
    domains: ["nytimes.com", "washingtonpost.com", "wsj.com", "apnews.com", "reuters.com", "usatoday.com"],
  },
  // TV / broadcast news
  {
    query: "Yale",
    domains: ["cnn.com", "nbcnews.com", "abcnews.go.com", "cbsnews.com", "foxnews.com", "bbc.com", "msnbc.com"],
  },
  // Local Connecticut
  {
    query: "Yale",
    domains: ["ctmirror.org", "nhregister.com", "courant.com", "ctpost.com", "newhavenindependent.org", "wtnh.com", "nbcconnecticut.com"],
  },
  // Higher education press
  {
    query: "Yale",
    domains: ["chronicle.com", "insidehighered.com", "timeshighereducation.com", "thefire.org", "highereddive.com"],
  },
  // Science & research
  {
    query: "Yale research",
    domains: ["nature.com", "science.org", "statnews.com", "scientificamerican.com", "eurekalert.org", "nih.gov", "newscientist.com"],
  },
  // Sports
  {
    query: "Yale athletics Bulldogs",
    domains: ["espn.com", "si.com", "ivyleague.com", "ncaa.com", "yalebulldogs.com", "theathletic.com"],
  },
  // Business & finance
  {
    query: "Yale",
    domains: ["forbes.com", "fortune.com", "bloomberg.com", "cnbc.com", "businessinsider.com", "barrons.com"],
  },
  // Policy, politics & public media
  {
    query: "Yale",
    domains: ["politico.com", "thehill.com", "axios.com", "npr.org", "pbs.org", "wnpr.org", "propublica.com"],
  },
  // Broad catch-all searches (no domain restriction)
  { query: "Yale University news" },
  { query: "Yale New Haven Hospital news" },
  { query: "Yale research study published" },
  { query: "Yale Law School" },
];

const FALSE_POSITIVES = [
  "yale appliance", "yale lock", "yale forklift", "yale cbd",
];

const RISK_LEXICON = [
  "lawsuit","title ix","arrest","harassment","plagiarism","data breach",
  "misconduct","investigation","complaint","violation","scandal",
  "whistleblower","fraud","discrimination","retaliation","resignation",
  "termination","subpoena","injunction","protest","controversy",
];

const PROXIMITY_LABELS = { 3: "Direct", 2: "Indirect", 1: "Contextual" };

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

async function runSingleSearch(query, cutoffISO, apiKey, domains) {
  const cutoffDate = new Date(cutoffISO);
  const cutoffStr = cutoffDate.toLocaleDateString("en-US", {
    timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric",
  });
  const cutoffTimeStr = cutoffDate.toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: true,
  });

  const systemPrompt = `You are a news research assistant. Search the web for recent news about Yale University matching the user's query.

Focus on articles from the past few days. Today is approximately ${new Date().toISOString().slice(0, 10)}.

After searching, return a JSON array of news items you found. Each item must have these fields:
- "headline": string (concise title)
- "source": string (publication name)
- "url": string (article URL, or "#" if unknown)
- "summary": string (1-2 sentence summary)
- "tags": array of strings (topic tags)
- "pub_time": string (ISO 8601 date if available, or "" if unknown)

Return 0-5 items as a JSON array. Only include items genuinely about Yale University (not Yale locks, Yale appliances, etc). If nothing relevant is found, return [].

IMPORTANT: Your response must end with the JSON array. Format: [{"headline":"...","source":"...","url":"...","summary":"...","tags":[...],"pub_time":"..."}]`;

  const makeRequest = async (messages) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 16000,
        system: systemPrompt,
        messages,
        tools: [Object.assign(
          { type: "web_search_20250305", name: "web_search", max_uses: 5 },
          domains && domains.length > 0 ? { allowed_domains: domains } : {}
        )],
      }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.log(`[search] HTTP ${res.status} for "${query}": ${errorText.slice(0, 500)}`);
      return null;
    }
    return res.json();
  };

  try {
    let messages = [{ role: "user", content: `Search for: ${query}` }];
    let data = await makeRequest(messages);
    if (!data) return [];

    if (data.error) {
      console.log(`[search] API error for "${query}":`, JSON.stringify(data.error));
      return [];
    }

    // Loop to handle pause_turn and tool_use — keep going until end_turn or max 5 rounds
    for (let round = 0; round < 5 && data.stop_reason !== "end_turn"; round++) {
      const types = (data.content || []).map(b => b.type);
      console.log(`[search] "${query}" round=${round} stop=${data.stop_reason} types=[${types.join(",")}]`);

      // Check for web search errors
      const toolErrors = (data.content || []).filter(
        (b) => b.type === "web_search_tool_result" && b.content?.type === "web_search_tool_result_error"
      );
      if (toolErrors.length > 0) {
        console.log(`[search] Web search error for "${query}": ${JSON.stringify(toolErrors.map(e => e.content))}`);
      }

      if (data.stop_reason === "pause_turn" || data.stop_reason === "tool_use") {
        // Continue the conversation — pass back everything the model returned
        messages = [
          ...messages,
          { role: "assistant", content: data.content },
        ];
        data = await makeRequest(messages);
        if (!data) return [];
        if (data.error) {
          console.log(`[search] API error on continuation for "${query}":`, JSON.stringify(data.error));
          return [];
        }
      } else {
        // Unknown stop reason
        console.log(`[search] Unexpected stop_reason="${data.stop_reason}" for "${query}"`);
        break;
      }
    }

    const contentTypes = (data.content || []).map(b => b.type);
    console.log(`[search] "${query}" final => stop=${data.stop_reason}, types=[${contentTypes.join(",")}], usage=${JSON.stringify(data.usage || {})}`);

    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");

    if (!text.trim()) {
      console.log(`[search] No text in response for "${query}". Content: ${JSON.stringify(data.content).slice(0, 800)}`);
      return [];
    }

    console.log(`[search] Text for "${query}": ${text.slice(0, 300)}`);

    const cleaned = text.replace(/```json|```/g, "").trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) {
      console.log(`[search] No JSON array found for "${query}". Text was: ${text.slice(0, 500)}`);
      return [];
    }
    const items = JSON.parse(match[0]);
    console.log(`[search] Parsed ${items.length} items for "${query}"`);
    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.log(`[search] Error for "${query}":`, err.message, err.stack);
    return [];
  }
}

async function generateReport(apiKey) {
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const cutoffISO = cutoffTime.toISOString();

  console.log(`[report] Starting report generation at ${now.toISOString()}`);
  console.log(`[report] 24-hour cutoff: ${cutoffISO}`);

  let allRaw = [];
  let stats = { falsePositives: 0, timeFiltered: 0, duplicates: 0 };

  for (let i = 0; i < SEARCHES.length; i++) {
    const search = SEARCHES[i];
    const label = search.domains ? `${search.query} [${search.domains.length} domains]` : search.query;
    console.log(`[report] (${i + 1}/${SEARCHES.length}) Searching: ${label}`);

    const results = await runSingleSearch(search.query, cutoffISO, apiKey, search.domains);

    for (const r of results) {
      if (r.pub_time) {
        try {
          const pubDate = new Date(r.pub_time);
          if (!isNaN(pubDate.getTime()) && pubDate < cutoffTime) {
            stats.timeFiltered++;
            continue;
          }
        } catch (e) {}
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

    if (i < SEARCHES.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
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
    stats: { total: items.length, ...stats },
  };

  console.log(`[report] Complete: ${items.length} items kept, ${stats.duplicates} dupes, ${stats.falsePositives} false positives, ${stats.timeFiltered} outside window`);
  return report;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMAIL BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

const CATEGORY_COLORS = {
  "Research": "#0f4c75", "Faculty": "#3c1361", "Grants & Partnerships": "#1b5e20",
  "Strategy & Policy": "#4a148c", "Athletics": "#bf360c", "Student Life & Arts": "#00695c",
  "Risk & Watch": "#b71c1c", "Social & Influencer": "#e65100",
};

const PROXIMITY_COLORS = { 3: "#1a4d8f", 2: "#4a7ab5", 1: "#8fafd4" };

function formatET(iso) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "long", year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function formatTimeET(iso) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function buildHtmlEmail(report, dashboardUrl) {
  const { items, stats, generatedAt, cutoffStart } = report;
  const riskItems = items.filter((i) => i.category === "Risk & Watch");
  const topItems = items.slice(0, 6);

  const categories = {};
  items.forEach((item) => {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  });

  const renderItem = (item) => {
    const isRisk = item.category === "Risk & Watch";
    const prefix = isRisk ? "\u26A0 " : "";
    const pubTime = item.pub_time
      ? (() => { try { const d = new Date(item.pub_time); return isNaN(d.getTime()) ? "" : ` \u00B7 ${formatTimeET(item.pub_time)} ET`; } catch { return ""; } })()
      : "";

    return `
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e8e4df;${isRisk ? "background:#fef3f2;border-left:3px solid #b71c1c;" : ""}">
        <div style="margin-bottom:6px;">
          <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;color:#fff;background:${PROXIMITY_COLORS[item.proximity] || "#999"};font-family:monospace;text-transform:uppercase;">${PROXIMITY_LABELS[item.proximity]}</span>
          <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;color:${CATEGORY_COLORS[item.category] || "#333"};border:1px solid ${CATEGORY_COLORS[item.category] || "#ccc"};font-family:monospace;margin-left:4px;">${item.category}</span>
          <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;color:#fff;background:#555;font-family:monospace;margin-left:4px;">${item.geo}</span>
        </div>
        <div style="font-size:15px;font-weight:700;color:#1a1a1a;font-family:Georgia,serif;margin-bottom:4px;">${prefix}${item.headline}</div>
        <div style="font-size:13px;color:#444;line-height:1.5;margin-bottom:6px;">${item.summary}</div>
        <div style="font-size:11px;color:#888;">
          <strong style="color:#555;">${item.source}</strong>${pubTime}
          ${item.url && item.url !== "#" ? ` \u00B7 <a href="${item.url}" style="color:#0f4c81;">View source \u2192</a>` : ""}
        </div>
      </td></tr>`;
  };

  let categorySections = "";
  for (const [cat, catItems] of Object.entries(categories)) {
    categorySections += `
      <tr><td style="padding:16px 16px 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:${CATEGORY_COLORS[cat] || "#333"};font-family:monospace;border-bottom:2px solid ${CATEGORY_COLORS[cat] || "#ccc"};">${cat} (${catItems.length})</td></tr>
      ${catItems.map(renderItem).join("")}`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f3f0;font-family:Georgia,'Times New Roman',serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f0;">
<tr><td align="center" style="padding:20px 10px;">
<table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:4px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.1);">
  <tr><td style="background:linear-gradient(135deg,#0f2b46,#1a4d8f);padding:24px 20px;border-bottom:4px solid #c5a55a;">
    <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#c5a55a;font-family:monospace;font-weight:700;">Office of Public Affairs & Communications</div>
    <div style="font-size:22px;font-weight:700;color:#fff;margin-top:6px;font-family:Georgia,serif;">Yale Daily Media & Research Report</div>
    <div style="font-size:11px;color:#a8c4e0;font-family:monospace;margin-top:8px;">${formatET(generatedAt)} ET \u00B7 12h window from ${formatTimeET(cutoffStart)} to ${formatTimeET(generatedAt)} ET</div>
  </td></tr>
  <tr><td style="background:#f5f3ef;padding:16px 20px;border-bottom:1px solid #e0dcd6;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td align="center" width="25%"><div style="font-size:28px;font-weight:800;color:#0f3057;font-family:monospace;">${stats.total}</div><div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#777;font-weight:600;">Total</div></td>
      <td align="center" width="25%"><div style="font-size:28px;font-weight:800;color:#1a4d8f;font-family:monospace;">${items.filter((i) => i.proximity === 3).length}</div><div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#777;font-weight:600;">Direct</div></td>
      <td align="center" width="25%"><div style="font-size:28px;font-weight:800;color:${riskItems.length > 0 ? "#b71c1c" : "#2d6a4f"};font-family:monospace;">${riskItems.length}</div><div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#777;font-weight:600;">Risk</div></td>
      <td align="center" width="25%"><div style="font-size:28px;font-weight:800;color:#555;font-family:monospace;">${stats.duplicates}</div><div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#777;font-weight:600;">Filtered</div></td>
    </tr></table>
  </td></tr>
  ${riskItems.length > 0 ? `<tr><td style="background:#fef3f2;padding:12px 20px;border-bottom:1px solid #f5c6cb;"><div style="font-size:12px;font-weight:700;color:#b71c1c;font-family:monospace;">\u26A0 ${riskItems.length} RISK ITEM${riskItems.length > 1 ? "S" : ""}</div><div style="font-size:12px;color:#721c24;margin-top:4px;">${riskItems.map((r) => r.headline).join(" \u00B7 ")}</div></td></tr>` : ""}
  <tr><td style="padding:16px 16px 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#0f3057;font-family:monospace;border-bottom:2px solid #0f3057;">Top Highlights</td></tr>
  ${topItems.map(renderItem).join("")}
  ${categorySections}
  ${dashboardUrl ? `<tr><td style="padding:20px;text-align:center;"><a href="${dashboardUrl}" style="display:inline-block;padding:10px 28px;background:#0f3057;color:#fff;text-decoration:none;border-radius:4px;font-size:12px;font-weight:700;font-family:monospace;text-transform:uppercase;">View Dashboard \u2192</a></td></tr>` : ""}
  <tr><td style="padding:16px 20px;background:#f0ece6;border-top:1px solid #e0dcd6;font-size:11px;color:#888;font-family:monospace;">
    <div>Totals: ${stats.total} kept \u00B7 ${stats.duplicates} dupes \u00B7 ${stats.falsePositives} FP \u00B7 ${stats.timeFiltered} outside window</div>
    <div style="margin-top:6px;font-style:italic;color:#aaa;">Prepared automatically. Review names/titles before sharing.</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function buildPlainTextEmail(report) {
  const { items, stats, generatedAt, cutoffStart } = report;
  let text = `YALE DAILY MEDIA & RESEARCH REPORT\n${"=".repeat(56)}\nGenerated: ${formatET(generatedAt)} ET\n12h window: ${formatTimeET(cutoffStart)} to ${formatTimeET(generatedAt)} ET\nItems: ${stats.total} kept | ${stats.duplicates} dupes | ${stats.falsePositives} FP | ${stats.timeFiltered} outside window\n${"=".repeat(56)}\n\n`;

  const riskItems = items.filter((i) => i.category === "Risk & Watch");
  if (riskItems.length > 0) {
    text += `!! RISK ALERT: ${riskItems.length} item(s)\n`;
    riskItems.forEach((r) => { text += `   - ${r.headline}\n`; });
    text += `${"-".repeat(40)}\n\n`;
  }

  text += `TOP HIGHLIGHTS\n${"-".repeat(40)}\n`;
  items.slice(0, 6).forEach((item, i) => {
    text += `${i + 1}. ${item.headline} -- ${item.source}\n   ${item.summary}\n   [${PROXIMITY_LABELS[item.proximity]}] [${item.category}] [${item.geo}]\n\n`;
  });

  text += `\n${"=".repeat(56)}\nPrepared automatically. Review names/titles before sharing.\n`;
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAILER
// ═══════════════════════════════════════════════════════════════════════════════

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendReportEmail(report, dashboardUrl) {
  const recipients = (process.env.EMAIL_RECIPIENTS || "").split(",").map((e) => e.trim()).filter(Boolean);
  if (recipients.length === 0) { console.warn("[mailer] No EMAIL_RECIPIENTS — skipping"); return { sent: false, reason: "no recipients" }; }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) { console.warn("[mailer] No SMTP credentials — skipping"); return { sent: false, reason: "no smtp credentials" }; }

  const transport = createTransport();
  const genDate = new Date(report.generatedAt).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const genTime = new Date(report.generatedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: true });
  const riskCount = report.items.filter((i) => i.category === "Risk & Watch").length;
  const riskTag = riskCount > 0 ? ` [!! ${riskCount} RISK]` : "";
  const subject = `Yale Media Report -- ${genDate} ${genTime} ET${riskTag} (${report.stats.total} items)`;

  try {
    const info = await transport.sendMail({
      from: process.env.EMAIL_FROM || `"Yale Media Monitor" <${process.env.SMTP_USER}>`,
      to: recipients.join(", "),
      subject,
      text: buildPlainTextEmail(report),
      html: buildHtmlEmail(report, dashboardUrl),
    });
    console.log(`[mailer] Sent to ${recipients.length} recipient(s): ${info.messageId}`);
    return { sent: true, messageId: info.messageId, recipients };
  } catch (err) {
    console.log("[mailer] Send failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER
// ═══════════════════════════════════════════════════════════════════════════════

let latestReport = null;
let reportHistory = [];
let isGenerating = false;
let lastEmailResult = null;

const DASHBOARD_URL = process.env.DASHBOARD_URL || `http://localhost:${PORT}`;

async function runScheduledReport() {
  if (isGenerating) { console.log("[cron] Already generating — skipping"); return; }
  isGenerating = true;
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { console.log("[cron] ANTHROPIC_API_KEY not set"); return; }
    const report = await generateReport(apiKey);
    latestReport = report;
    reportHistory.unshift(report);
    if (reportHistory.length > 14) reportHistory = reportHistory.slice(0, 14);
    lastEmailResult = await sendReportEmail(report, DASHBOARD_URL);
  } catch (err) {
    console.log("[cron] Report generation failed:", err);
  } finally {
    isGenerating = false;
  }
}

// Cron schedules
const tz = process.env.CRON_TIMEZONE || "America/New_York";
const morningCron = process.env.CRON_MORNING || "0 7 * * *";
const eveningCron = process.env.CRON_EVENING || "0 19 * * *";

cron.schedule(morningCron, () => { console.log("[cron] Morning report"); runScheduledReport(); }, { timezone: tz });
cron.schedule(eveningCron, () => { console.log("[cron] Evening report"); runScheduledReport(); }, { timezone: tz });

console.log(`[cron] Scheduled: morning=${morningCron}, evening=${eveningCron} (${tz})`);

// API routes
app.use(express.json());

app.get("/api/report", (req, res) => {
  if (!latestReport) return res.json({ report: null, status: isGenerating ? "generating" : "none" });
  res.json({ report: latestReport, status: "ready" });
});

app.get("/api/history", (req, res) => {
  res.json({ reports: reportHistory.map((r) => ({ generatedAt: r.generatedAt, totalItems: r.stats.total, riskItems: r.items.filter((i) => i.category === "Risk & Watch").length })) });
});

app.post("/api/generate", async (req, res) => {
  if (isGenerating) return res.status(409).json({ error: "Already generating" });
  res.json({ status: "started" });
  runScheduledReport();
});

app.get("/api/status", (req, res) => {
  res.json({
    generating: isGenerating,
    hasReport: !!latestReport,
    lastGenerated: latestReport?.generatedAt || null,
    lastEmail: lastEmailResult,
    schedules: { morning: morningCron, evening: eveningCron, timezone: tz },
    reportsInHistory: reportHistory.length,
  });
});

// Debug endpoint — runs a single search and returns raw API response
app.get("/api/test-search", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "No ANTHROPIC_API_KEY set" });

  const query = req.query.q || "Yale University news today";
  console.log(`[test] Running test search: "${query}"`);

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: `Search the web for: ${query}. Return a brief summary of what you find.` }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      }),
    });

    const status = apiRes.status;
    const data = await apiRes.json();

    // Summarize the response
    const contentTypes = (data.content || []).map(b => b.type);
    const textBlocks = (data.content || []).filter(b => b.type === "text").map(b => b.text);
    const searchResults = (data.content || []).filter(b => b.type === "web_search_tool_result");

    res.json({
      http_status: status,
      stop_reason: data.stop_reason,
      content_types: contentTypes,
      text_response: textBlocks.join("\n").slice(0, 2000),
      search_result_count: searchResults.length,
      has_error: !!data.error,
      error: data.error || null,
      usage: data.usage || null,
      raw_content_preview: JSON.stringify(data.content).slice(0, 3000),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Dashboard HTML
app.get("/", (req, res) => { res.send(getDashboardHTML()); });

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Yale Daily Media Report</title>
<link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=JetBrains+Mono:wght@400;600;700;800&family=Source+Serif+4:wght@300;400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --navy: #0f2b46; --blue: #0f3057; --blue-mid: #1a4d8f; --gold: #c5a55a;
    --cream: #f9f8f5; --warm-gray: #f0ece6; --border: #e0dcd6;
    --risk-bg: #fef3f2; --risk-border: #b71c1c;
    --font-display: 'Libre Baskerville', Georgia, serif;
    --font-body: 'Source Serif 4', Georgia, serif;
    --font-mono: 'JetBrains Mono', 'Courier New', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--cream); font-family: var(--font-body); color: #1a1a1a; min-height: 100vh; }
  .header { background: linear-gradient(135deg, var(--navy) 0%, var(--blue) 40%, var(--blue-mid) 100%); color: #fff; padding: 28px 32px 20px; border-bottom: 4px solid var(--gold); }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; }
  .header-label { font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: var(--gold); font-family: var(--font-mono); font-weight: 700; margin-bottom: 6px; }
  .header h1 { font-size: 26px; font-weight: 700; font-family: var(--font-display); letter-spacing: -0.5px; }
  .header-meta { margin-top: 8px; font-size: 12px; font-family: var(--font-mono); color: #a8c4e0; }
  .btn { padding: 8px 20px; border: none; border-radius: 4px; font-size: 12px; font-weight: 700; cursor: pointer; letter-spacing: 0.5px; text-transform: uppercase; font-family: var(--font-mono); transition: opacity .15s; }
  .btn:hover { opacity: 0.85; } .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--gold); color: var(--navy); }
  .btn-export { background: var(--blue); color: #fff; }
  .stats-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; padding: 16px 32px; background: #f5f3ef; border-bottom: 1px solid var(--border); }
  .stat { text-align: center; } .stat-value { font-size: 28px; font-weight: 800; font-family: var(--font-mono); }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #777; font-weight: 600; }
  .schedule-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 32px; background: #eae7e1; border-bottom: 1px solid var(--border); font-size: 11px; font-family: var(--font-mono); color: #777; flex-wrap: wrap; gap: 8px; }
  .schedule-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: #2d6a4f; }
  .filter-bar { display: flex; gap: 2px; padding: 10px 32px; background: var(--warm-gray); border-bottom: 1px solid var(--border); overflow-x: auto; flex-wrap: wrap; }
  .filter-btn { padding: 5px 14px; border: none; border-radius: 3px; font-size: 11px; cursor: pointer; font-family: var(--font-mono); background: transparent; color: #666; white-space: nowrap; }
  .filter-btn.active { background: var(--blue); color: #fff; font-weight: 800; }
  .progress-bar { padding: 12px 32px; background: #e8e4df; }
  .progress-track { height: 4px; background: #d0ccc5; border-radius: 2px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--blue); border-radius: 2px; transition: width 0.3s; }
  .news-item { padding: 16px 32px; border-bottom: 1px solid #e8e4df; }
  .news-item:hover { background: #f5f3ef; }
  .news-item.risk { background: var(--risk-bg); border-left: 3px solid var(--risk-border); }
  .news-item-inner { display: flex; align-items: flex-start; gap: 12px; justify-content: space-between; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 3px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; font-family: var(--font-mono); }
  .badge-tag { font-size: 9px; padding: 1px 6px; border-radius: 2px; background: var(--warm-gray); color: #5a5347; text-transform: lowercase; }
  .news-headline { font-size: 15px; font-weight: 700; color: #1a1a1a; font-family: var(--font-display); line-height: 1.35; margin-bottom: 4px; }
  .news-summary { font-size: 13px; color: #444; line-height: 1.5; margin-bottom: 6px; }
  .news-meta { font-size: 11px; color: #888; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .news-meta a { color: var(--blue-mid); text-decoration: none; border-bottom: 1px dotted var(--blue-mid); }
  .score-circle { min-width: 36px; height: 36px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; font-family: var(--font-mono); flex-shrink: 0; }
  .empty { text-align: center; padding: 80px 32px; color: #888; }
  .empty-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.3; }
  .empty h2 { font-size: 20px; font-family: var(--font-display); color: #555; margin-bottom: 8px; }
  .empty p { font-size: 14px; color: #999; max-width: 440px; margin: 0 auto 24px; line-height: 1.6; }
  .footer { padding: 20px 32px; background: var(--warm-gray); border-top: 1px solid var(--border); font-size: 12px; color: #888; font-family: var(--font-mono); }
  .footer div { margin-bottom: 6px; } .footer .disclaimer { font-size: 11px; color: #aaa; font-style: italic; }
  @media (max-width: 640px) { .header, .stats-bar, .filter-bar, .news-item, .footer, .schedule-bar, .progress-bar { padding-left: 16px; padding-right: 16px; } .header h1 { font-size: 20px; } }
</style>
</head>
<body>
<header class="header"><div class="header-top"><div>
  <div class="header-label">Office of Public Affairs & Communications</div>
  <h1>Yale Daily Media &amp; Research Report</h1>
  <div class="header-meta" id="headerMeta">Loading...</div>
</div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
  <button class="btn btn-export" id="btnExport" style="display:none" onclick="exportReport()">Export .txt</button>
  <button class="btn btn-primary" id="btnGenerate" onclick="triggerGenerate()">Run Report</button>
</div></div></header>
<div class="schedule-bar"><div><span class="schedule-dot"></span>Auto-reports: 7:00 AM &amp; 7:00 PM ET daily</div><div id="emailStatus">Email: checking...</div></div>
<div class="progress-bar" id="progressBar" style="display:none"><div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:11px;font-family:var(--font-mono);color:#555"><span id="progressLabel">Starting...</span><span id="progressCount"></span></div><div class="progress-track"><div class="progress-fill" id="progressFill" style="width:0%"></div></div></div>
<div class="stats-bar" id="statsBar" style="display:none"></div>
<div class="filter-bar" id="filterBar" style="display:none"></div>
<main id="content"><div class="empty"><div class="empty-icon">&#x1F4F0;</div><h2>Ready to Generate Report</h2><p>Click "Run Report" to scan 10 queries for Yale University mentions published in the last 12 hours. Reports also auto-generate and email at 7 AM &amp; 7 PM ET.</p></div></main>
<footer class="footer" id="footer" style="display:none"></footer>
<script>
let currentReport=null,currentFilter="All",pollInterval=null;
const PL={3:"Direct",2:"Indirect",1:"Contextual"},PC={3:"#1a4d8f",2:"#4a7ab5",1:"#8fafd4"},GC={Local:"#2d6a4f",National:"#7b2d8b",Global:"#b5651d"},CC={"Research":"#0f4c75","Faculty":"#3c1361","Grants & Partnerships":"#1b5e20","Strategy & Policy":"#4a148c","Athletics":"#bf360c","Student Life & Arts":"#00695c","Risk & Watch":"#b71c1c","Social & Influencer":"#e65100"},CATS=Object.keys(CC);
function fET(i){return new Date(i).toLocaleString("en-US",{timeZone:"America/New_York",weekday:"long",year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:true})}
function fTE(i){return new Date(i).toLocaleString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:true})}
async function fetchStatus(){try{return await(await fetch("/api/status")).json()}catch{return null}}
async function fetchReport(){try{return await(await fetch("/api/report")).json()}catch{return null}}
async function triggerGenerate(){const b=document.getElementById("btnGenerate");b.disabled=true;b.textContent="Scanning...";document.getElementById("progressBar").style.display="block";document.getElementById("progressLabel").textContent="Generating via Claude API + web search...";document.getElementById("progressFill").style.width="10%";try{await fetch("/api/generate",{method:"POST"})}catch{}let p=10;pollInterval=setInterval(async()=>{p=Math.min(p+5,90);document.getElementById("progressFill").style.width=p+"%";const s=await fetchStatus();if(s&&!s.generating){clearInterval(pollInterval);document.getElementById("progressFill").style.width="100%";setTimeout(()=>{document.getElementById("progressBar").style.display="none";loadReport();b.disabled=false;b.textContent="Refresh"},500)}},2000)}
async function loadReport(){const d=await fetchReport();if(!d||!d.report)return;currentReport=d.report;renderReport()}
function renderReport(){const r=currentReport;if(!r)return;document.getElementById("headerMeta").textContent=fET(r.generatedAt)+" ET - 12h window from "+fTE(r.cutoffStart)+" to "+fTE(r.cutoffEnd)+" ET";const rc=r.items.filter(i=>i.category==="Risk & Watch").length,dc=r.items.filter(i=>i.proximity===3).length;const s=document.getElementById("statsBar");s.style.display="grid";s.innerHTML=sB(r.stats.total,"Total","#0f3057")+sB(dc,"Direct","#1a4d8f")+sB(rc,"Risk",rc>0?"#b71c1c":"#2d6a4f")+sB(r.stats.duplicates+r.stats.falsePositives+r.stats.timeFiltered,"Filtered","#888");const ac=["All",...CATS.filter(c=>r.items.some(i=>i.category===c))];const f=document.getElementById("filterBar");f.style.display="flex";f.innerHTML=ac.map(c=>'<button class="filter-btn'+(currentFilter===c?" active":"")+'" onclick="setFilter(\\''+c.replace(/'/g,"\\\\'")+'\\')">'+c+(c!=="All"?" ("+r.items.filter(i=>i.category===c).length+")":"")+"</button>").join("");const items=currentFilter==="All"?r.items:r.items.filter(i=>i.category===currentFilter);document.getElementById("content").innerHTML=items.length===0?'<div class="empty"><div class="empty-icon">&#x1F4ED;</div><h2>No items in this category</h2></div>':items.map((item,idx)=>rNI(item)).join("");document.getElementById("btnExport").style.display="inline-block";const ft=document.getElementById("footer");ft.style.display="block";ft.innerHTML="<div>Totals: "+r.stats.total+" kept, "+r.stats.duplicates+" dupes, "+r.stats.falsePositives+" FP, "+r.stats.timeFiltered+" outside 12h window</div><div>Next runs: 7:00 AM &amp; 7:00 PM ET daily</div>"+'<div class="disclaimer">Prepared automatically. Review names/titles before sharing.</div>'}
function sB(v,l,c){return'<div class="stat"><div class="stat-value" style="color:'+c+'">'+v+'</div><div class="stat-label">'+l+"</div></div>"}
function rNI(item){const ir=item.category==="Risk & Watch",pc=PC[item.proximity]||"#999",cc=CC[item.category]||"#333",gc=GC[item.geo]||"#666",sc=item.score>=6?"#1a4d8f":item.score>=4?"#4a7ab5":"#c0c0c0";let pt="";if(item.pub_time){try{const d=new Date(item.pub_time);if(!isNaN(d.getTime()))pt=d.toLocaleString("en-US",{timeZone:"America/New_York",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:true})+" ET"}catch{}}const tags=(item.tags||[]).map(t=>'<span class="badge badge-tag">'+t+"</span>").join("");return'<div class="news-item'+(ir?" risk":"")+'"><div class="news-item-inner"><div style="flex:1"><div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap"><span class="badge" style="color:#fff;background:'+pc+'">'+PL[item.proximity]+'</span><span class="badge" style="color:'+cc+";border:1px solid "+cc+'">'+item.category+'</span><span class="badge" style="color:#fff;background:'+gc+'">'+item.geo+"</span>"+tags+'</div><div class="news-headline">'+(ir?"&#x26A0; ":"")+item.headline+'</div><div class="news-summary">'+item.summary+'</div><div class="news-meta"><strong style="color:#555">'+item.source+"</strong>"+(pt?'<span style="font-family:var(--font-mono);font-size:10px;color:#999">'+pt+"</span>":"")+(item.url&&item.url!=="#"?'<a href="'+item.url+'" target="_blank">View source</a>':"")+'</div></div><div class="score-circle" style="background:'+sc+'">'+item.score+"</div></div></div>"}
function setFilter(c){currentFilter=c;renderReport()}
function exportReport(){if(!currentReport)return;const r=currentReport;let t="YALE MEDIA REPORT\\n"+fET(r.generatedAt)+" ET\\n"+"=".repeat(50)+"\\n\\n";r.items.slice(0,6).forEach((item,i)=>{t+=(i+1)+". "+item.headline+" -- "+item.source+"\\n   "+item.summary+"\\n\\n"});t+="\\nPrepared automatically. Review before sharing.\\n";const b=new Blob([t.replace(/\\\\n/g,"\\n")],{type:"text/plain"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download="yale-report-"+new Date().toISOString().split("T")[0]+".txt";a.click();URL.revokeObjectURL(u)}
(async function(){const s=await fetchStatus();if(s){const e=document.getElementById("emailStatus");if(s.lastEmail?.sent)e.innerHTML='<span class="schedule-dot"></span>Email: delivered';else if(s.lastEmail)e.textContent="Email: "+(s.lastEmail.reason||"not sent");else e.textContent="Email: awaiting first report";if(s.hasReport){document.getElementById("btnGenerate").textContent="Refresh";await loadReport()}}setInterval(async()=>{const s=await fetchStatus();if(s&&s.hasReport&&currentReport&&s.lastGenerated!==currentReport.generatedAt)await loadReport()},300000)})();
</script>
</body></html>`;
}

app.listen(PORT, () => {
  console.log(`[server] Yale Media Dashboard running at http://localhost:${PORT}`);
  console.log(`[server] API key: ${process.env.ANTHROPIC_API_KEY ? "yes" : "NO — set ANTHROPIC_API_KEY"}`);
  console.log(`[server] SMTP: ${process.env.SMTP_USER ? "yes" : "NO — set SMTP_* for email"}`);

  // Startup diagnostic: test API key and web search capability
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    (async () => {
      try {
        console.log("[startup] Testing Anthropic API connection...");
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 100,
            messages: [{ role: "user", content: "Reply with exactly: API_OK" }],
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          console.log(`[startup] API test FAILED: HTTP ${res.status} — ${errText.slice(0, 300)}`);
        } else {
          const data = await res.json();
          const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
          console.log(`[startup] API test OK: model=${data.model}, response="${text.slice(0, 50)}"`);
        }
      } catch (err) {
        console.log(`[startup] API test FAILED: ${err.message}`);
      }
    })();
  }
});

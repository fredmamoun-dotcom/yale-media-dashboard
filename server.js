// ─── server.js ───────────────────────────────────────────────────────────────
// Express server + cron scheduler + dashboard + API

require("dotenv").config();
const express = require("express");
const cron = require("node-cron");
const path = require("path");
const { generateReport } = require("./lib/report-engine");
const { sendReportEmail } = require("./lib/mailer");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── In-memory report store ──────────────────────────────────────────────────
let latestReport = null;
let reportHistory = [];   // keeps last 14 reports
let isGenerating = false;
let lastEmailResult = null;

const DASHBOARD_URL = process.env.DASHBOARD_URL || `http://localhost:${PORT}`;

// ─── Report generation + email ───────────────────────────────────────────────
async function runScheduledReport() {
  if (isGenerating) {
    console.log("[cron] Report already generating — skipping");
    return;
  }
  isGenerating = true;
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("[cron] ANTHROPIC_API_KEY not set");
      return;
    }
    const report = await generateReport(apiKey);
    latestReport = report;
    reportHistory.unshift(report);
    if (reportHistory.length > 14) reportHistory = reportHistory.slice(0, 14);

    // Send email
    lastEmailResult = await sendReportEmail(report, DASHBOARD_URL);
  } catch (err) {
    console.error("[cron] Report generation failed:", err);
  } finally {
    isGenerating = false;
  }
}

// ─── Cron schedules (default 7 AM and 7 PM ET) ──────────────────────────────
const tz = process.env.CRON_TIMEZONE || "America/New_York";
const morningCron = process.env.CRON_MORNING || "0 7 * * *";
const eveningCron = process.env.CRON_EVENING || "0 19 * * *";

cron.schedule(morningCron, () => {
  console.log("[cron] Morning report triggered");
  runScheduledReport();
}, { timezone: tz });

cron.schedule(eveningCron, () => {
  console.log("[cron] Evening report triggered");
  runScheduledReport();
}, { timezone: tz });

console.log(`[cron] Scheduled: morning=${morningCron}, evening=${eveningCron} (${tz})`);

// ─── API routes ──────────────────────────────────────────────────────────────
app.use(express.json());

// Get latest report as JSON
app.get("/api/report", (req, res) => {
  if (!latestReport) return res.json({ report: null, status: isGenerating ? "generating" : "none" });
  res.json({ report: latestReport, status: "ready" });
});

// Get report history
app.get("/api/history", (req, res) => {
  res.json({ reports: reportHistory.map((r) => ({ generatedAt: r.generatedAt, totalItems: r.stats.total, riskItems: r.items.filter((i) => i.category === "Risk & Watch").length })) });
});

// Trigger a manual report
app.post("/api/generate", async (req, res) => {
  if (isGenerating) return res.status(409).json({ error: "Report already generating" });
  res.json({ status: "started" });
  runScheduledReport();
});

// Status endpoint
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

// ─── Dashboard HTML ──────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send(getDashboardHTML());
});

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
    --navy: #0f2b46;
    --blue: #0f3057;
    --blue-mid: #1a4d8f;
    --gold: #c5a55a;
    --cream: #f9f8f5;
    --warm-gray: #f0ece6;
    --border: #e0dcd6;
    --risk-bg: #fef3f2;
    --risk-border: #b71c1c;
    --font-display: 'Libre Baskerville', Georgia, serif;
    --font-body: 'Source Serif 4', Georgia, serif;
    --font-mono: 'JetBrains Mono', 'Courier New', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--cream); font-family: var(--font-body); color: #1a1a1a; min-height: 100vh; }

  /* ── Header ── */
  .header {
    background: linear-gradient(135deg, var(--navy) 0%, var(--blue) 40%, var(--blue-mid) 100%);
    color: #fff; padding: 28px 32px 20px; border-bottom: 4px solid var(--gold);
  }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; }
  .header-label { font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: var(--gold); font-family: var(--font-mono); font-weight: 700; margin-bottom: 6px; }
  .header h1 { font-size: 26px; font-weight: 700; font-family: var(--font-display); letter-spacing: -0.5px; }
  .header-meta { margin-top: 8px; font-size: 12px; font-family: var(--font-mono); color: #a8c4e0; }
  .header-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

  /* ── Buttons ── */
  .btn { padding: 8px 20px; border: none; border-radius: 4px; font-size: 12px; font-weight: 700; cursor: pointer; letter-spacing: 0.5px; text-transform: uppercase; font-family: var(--font-mono); transition: opacity .15s; }
  .btn:hover { opacity: 0.85; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--gold); color: var(--navy); }
  .btn-secondary { background: var(--blue); color: #fff; }
  .btn-export { background: var(--blue); color: #fff; }

  /* ── Stats ── */
  .stats-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; padding: 16px 32px; background: #f5f3ef; border-bottom: 1px solid var(--border); }
  .stat { text-align: center; }
  .stat-value { font-size: 28px; font-weight: 800; font-family: var(--font-mono); }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #777; font-weight: 600; }

  /* ── Schedule Banner ── */
  .schedule-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 32px; background: #eae7e1; border-bottom: 1px solid var(--border); font-size: 11px; font-family: var(--font-mono); color: #777; flex-wrap: wrap; gap: 8px; }
  .schedule-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .dot-green { background: #2d6a4f; }
  .dot-amber { background: #e65100; animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

  /* ── Filters ── */
  .filter-bar { display: flex; gap: 2px; padding: 10px 32px; background: var(--warm-gray); border-bottom: 1px solid var(--border); overflow-x: auto; flex-wrap: wrap; }
  .filter-btn { padding: 5px 14px; border: none; border-radius: 3px; font-size: 11px; cursor: pointer; font-family: var(--font-mono); letter-spacing: 0.3px; background: transparent; color: #666; white-space: nowrap; transition: all .15s; }
  .filter-btn.active { background: var(--blue); color: #fff; font-weight: 800; }
  .filter-btn:hover:not(.active) { background: #e0dcd6; }

  /* ── Progress ── */
  .progress-bar { padding: 12px 32px; background: #e8e4df; }
  .progress-top { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 11px; font-family: var(--font-mono); color: #555; }
  .progress-track { height: 4px; background: #d0ccc5; border-radius: 2px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--blue); border-radius: 2px; transition: width 0.3s; }

  /* ── News Items ── */
  .news-item { padding: 16px 32px; border-bottom: 1px solid #e8e4df; transition: background .15s; }
  .news-item:hover { background: #f5f3ef; }
  .news-item.risk { background: var(--risk-bg); border-left: 3px solid var(--risk-border); }
  .news-item-inner { display: flex; align-items: flex-start; gap: 12px; justify-content: space-between; }
  .news-content { flex: 1; }
  .badge-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 3px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; font-family: var(--font-mono); }
  .badge-prox { color: #fff; }
  .badge-cat { border: 1px solid; }
  .badge-geo { color: #fff; }
  .badge-tag { font-size: 9px; padding: 1px 6px; border-radius: 2px; background: var(--warm-gray); color: #5a5347; text-transform: lowercase; }
  .news-headline { font-size: 15px; font-weight: 700; color: #1a1a1a; font-family: var(--font-display); line-height: 1.35; margin-bottom: 4px; }
  .news-summary { font-size: 13px; color: #444; line-height: 1.5; margin-bottom: 6px; }
  .news-meta { font-size: 11px; color: #888; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .news-meta a { color: var(--blue-mid); text-decoration: none; border-bottom: 1px dotted var(--blue-mid); }
  .score-circle { min-width: 36px; height: 36px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; font-family: var(--font-mono); flex-shrink: 0; }

  /* ── Empty state ── */
  .empty { text-align: center; padding: 80px 32px; color: #888; }
  .empty-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.3; }
  .empty h2 { font-size: 20px; font-family: var(--font-display); color: #555; margin-bottom: 8px; }
  .empty p { font-size: 14px; color: #999; max-width: 440px; margin: 0 auto 24px; line-height: 1.6; }
  .empty-detail { font-size: 11px; font-family: var(--font-mono); color: #bbb; }

  /* ── Footer ── */
  .footer { padding: 20px 32px; background: var(--warm-gray); border-top: 1px solid var(--border); font-size: 12px; color: #888; font-family: var(--font-mono); }
  .footer div { margin-bottom: 6px; }
  .footer .disclaimer { font-size: 11px; color: #aaa; font-style: italic; }

  /* ── Responsive ── */
  @media (max-width: 640px) {
    .header, .stats-bar, .filter-bar, .news-item, .footer, .schedule-bar, .progress-bar { padding-left: 16px; padding-right: 16px; }
    .header h1 { font-size: 20px; }
    .stats-bar { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>

<!-- Header -->
<header class="header">
  <div class="header-top">
    <div>
      <div class="header-label">Office of Public Affairs & Communications</div>
      <h1>Yale Daily Media &amp; Research Report</h1>
      <div class="header-meta" id="headerMeta">Loading...</div>
    </div>
    <div class="header-actions">
      <button class="btn btn-export" id="btnExport" style="display:none" onclick="exportReport()">↓ Export .txt</button>
      <button class="btn btn-primary" id="btnGenerate" onclick="triggerGenerate()">▶ Run Report</button>
    </div>
  </div>
</header>

<!-- Schedule Banner -->
<div class="schedule-bar" id="scheduleBanner">
  <div><span class="schedule-dot dot-green"></span>Auto-reports: 7:00 AM &amp; 7:00 PM ET daily</div>
  <div id="emailStatus">Email: checking...</div>
</div>

<!-- Progress (hidden by default) -->
<div class="progress-bar" id="progressBar" style="display:none">
  <div class="progress-top">
    <span id="progressLabel">Starting...</span>
    <span id="progressCount"></span>
  </div>
  <div class="progress-track"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
</div>

<!-- Stats (hidden by default) -->
<div class="stats-bar" id="statsBar" style="display:none"></div>

<!-- Filters (hidden by default) -->
<div class="filter-bar" id="filterBar" style="display:none"></div>

<!-- Content -->
<main id="content">
  <div class="empty">
    <div class="empty-icon">📰</div>
    <h2>Ready to Generate Report</h2>
    <p>Click "Run Report" to scan 10 search queries across national and local sources for Yale University mentions published in the last 12 hours. Reports also auto-generate and email at 7 AM &amp; 7 PM ET.</p>
    <div class="empty-detail">10 queries · Dedup · False-positive filtering · Risk lexicon · Email delivery</div>
  </div>
</main>

<!-- Footer (hidden by default) -->
<footer class="footer" id="footer" style="display:none"></footer>

<script>
// ─── State ───────────────────────────────────────────────────────────────────
let currentReport = null;
let currentFilter = "All";
let pollInterval = null;

const PROXIMITY_LABELS = { 3: "Direct", 2: "Indirect", 1: "Contextual" };
const PROXIMITY_COLORS = { 3: "#1a4d8f", 2: "#4a7ab5", 1: "#8fafd4" };
const GEO_COLORS = { Local: "#2d6a4f", National: "#7b2d8b", Global: "#b5651d" };
const CATEGORY_COLORS = {
  "Research": "#0f4c75", "Faculty": "#3c1361", "Grants & Partnerships": "#1b5e20",
  "Strategy & Policy": "#4a148c", "Athletics": "#bf360c", "Student Life & Arts": "#00695c",
  "Risk & Watch": "#b71c1c", "Social & Influencer": "#e65100",
};
const CATEGORIES = Object.keys(CATEGORY_COLORS);

function formatET(iso) {
  return new Date(iso).toLocaleString("en-US", { timeZone:"America/New_York", weekday:"long", year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:true });
}
function formatTimeET(iso) {
  return new Date(iso).toLocaleString("en-US", { timeZone:"America/New_York", hour:"2-digit", minute:"2-digit", hour12:true });
}

// ─── API helpers ─────────────────────────────────────────────────────────────
async function fetchStatus() {
  try {
    const res = await fetch("/api/status");
    return await res.json();
  } catch { return null; }
}

async function fetchReport() {
  try {
    const res = await fetch("/api/report");
    return await res.json();
  } catch { return null; }
}

async function triggerGenerate() {
  const btn = document.getElementById("btnGenerate");
  btn.disabled = true;
  btn.textContent = "Scanning…";

  document.getElementById("progressBar").style.display = "block";
  document.getElementById("progressLabel").textContent = "Generating report via Claude API + web search...";
  document.getElementById("progressCount").textContent = "";
  document.getElementById("progressFill").style.width = "10%";

  try {
    await fetch("/api/generate", { method: "POST" });
  } catch {}

  // Poll for completion
  let progress = 10;
  pollInterval = setInterval(async () => {
    progress = Math.min(progress + 5, 90);
    document.getElementById("progressFill").style.width = progress + "%";

    const status = await fetchStatus();
    if (status && !status.generating) {
      clearInterval(pollInterval);
      document.getElementById("progressFill").style.width = "100%";
      setTimeout(() => {
        document.getElementById("progressBar").style.display = "none";
        loadReport();
        btn.disabled = false;
        btn.textContent = "↻ Refresh";
      }, 500);
    }
  }, 2000);
}

// ─── Render ──────────────────────────────────────────────────────────────────
async function loadReport() {
  const data = await fetchReport();
  if (!data || !data.report) return;
  currentReport = data.report;
  renderReport();
}

function renderReport() {
  const r = currentReport;
  if (!r) return;

  // Header meta
  document.getElementById("headerMeta").textContent =
    formatET(r.generatedAt) + " ET · 12h window from " + formatTimeET(r.cutoffStart) + " to " + formatTimeET(r.cutoffEnd) + " ET";

  // Stats
  const riskCount = r.items.filter(i => i.category === "Risk & Watch").length;
  const directCount = r.items.filter(i => i.proximity === 3).length;
  const statsEl = document.getElementById("statsBar");
  statsEl.style.display = "grid";
  statsEl.innerHTML = [
    statBlock(r.stats.total, "Total Items", "#0f3057"),
    statBlock(directCount, "Direct", "#1a4d8f"),
    statBlock(riskCount, "Risk", riskCount > 0 ? "#b71c1c" : "#2d6a4f"),
    statBlock(r.stats.duplicates + r.stats.falsePositives + r.stats.timeFiltered, "Filtered", "#888"),
  ].join("");

  // Filters
  const activeCats = ["All", ...CATEGORIES.filter(c => r.items.some(i => i.category === c))];
  const filterEl = document.getElementById("filterBar");
  filterEl.style.display = "flex";
  filterEl.innerHTML = activeCats.map(c => {
    const count = c === "All" ? "" : " (" + r.items.filter(i => i.category === c).length + ")";
    return '<button class="filter-btn' + (currentFilter === c ? " active" : "") + '" onclick="setFilter(\\''+c.replace(/'/g,"\\\\'")+'\\')">'+c+count+'</button>';
  }).join("");

  // Items
  const items = currentFilter === "All" ? r.items : r.items.filter(i => i.category === currentFilter);
  const contentEl = document.getElementById("content");
  if (items.length === 0) {
    contentEl.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><h2>No items in this category</h2></div>';
  } else {
    contentEl.innerHTML = items.map((item, idx) => renderNewsItem(item, idx)).join("");
  }

  // Export + footer
  document.getElementById("btnExport").style.display = "inline-block";
  const footerEl = document.getElementById("footer");
  footerEl.style.display = "block";
  footerEl.innerHTML =
    "<div>Totals: " + r.stats.total + " items kept · " + r.stats.duplicates + " duplicates removed · " + r.stats.falsePositives + " false positives · " + r.stats.timeFiltered + " outside 12h window</div>" +
    "<div>Next scheduled runs: 7:00 AM ET and 7:00 PM ET daily</div>" +
    '<div class="disclaimer">Prepared automatically. Please review names/titles for absolute accuracy before external sharing.</div>';
}

function statBlock(value, label, color) {
  return '<div class="stat"><div class="stat-value" style="color:'+color+'">'+value+'</div><div class="stat-label">'+label+'</div></div>';
}

function renderNewsItem(item, idx) {
  const isRisk = item.category === "Risk & Watch";
  const proxColor = PROXIMITY_COLORS[item.proximity] || "#999";
  const catColor = CATEGORY_COLORS[item.category] || "#333";
  const geoColor = GEO_COLORS[item.geo] || "#666";
  const scoreColor = item.score >= 6 ? "#1a4d8f" : item.score >= 4 ? "#4a7ab5" : "#c0c0c0";

  let pubTimeStr = "";
  if (item.pub_time) {
    try {
      const d = new Date(item.pub_time);
      if (!isNaN(d.getTime())) {
        pubTimeStr = d.toLocaleString("en-US", { timeZone:"America/New_York", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:true }) + " ET";
      }
    } catch {}
  }

  const tags = (item.tags || []).map(t => '<span class="badge badge-tag">'+t+'</span>').join("");
  const prefix = isRisk ? "⚠ " : "";

  return '<div class="news-item' + (isRisk ? " risk" : "") + '">' +
    '<div class="news-item-inner">' +
      '<div class="news-content">' +
        '<div class="badge-row">' +
          '<span class="badge badge-prox" style="background:'+proxColor+'">' + PROXIMITY_LABELS[item.proximity] + '</span>' +
          '<span class="badge badge-cat" style="color:'+catColor+';border-color:'+catColor+'">' + item.category + '</span>' +
          '<span class="badge badge-geo" style="background:'+geoColor+'">' + item.geo + '</span>' +
          tags +
        '</div>' +
        '<div class="news-headline">' + prefix + item.headline + '</div>' +
        '<div class="news-summary">' + item.summary + '</div>' +
        '<div class="news-meta">' +
          '<strong style="color:#555">' + item.source + '</strong>' +
          (pubTimeStr ? '<span style="font-family:var(--font-mono);font-size:10px;color:#999">' + pubTimeStr + '</span>' : '') +
          (item.url && item.url !== "#" ? '<a href="'+item.url+'" target="_blank" rel="noopener">View source ↗</a>' : '') +
        '</div>' +
      '</div>' +
      '<div class="score-circle" style="background:'+scoreColor+'">' + item.score + '</div>' +
    '</div>' +
  '</div>';
}

function setFilter(cat) {
  currentFilter = cat;
  renderReport();
}

// ─── Export ──────────────────────────────────────────────────────────────────
function exportReport() {
  if (!currentReport) return;
  const r = currentReport;
  let text = "YALE DAILY MEDIA & RESEARCH REPORT\\n";
  text += "═".repeat(56) + "\\n";
  text += "Generated: " + formatET(r.generatedAt) + " ET\\n";
  text += "12h window: " + formatTimeET(r.cutoffStart) + " to " + formatTimeET(r.cutoffEnd) + " ET\\n";
  text += "Items: " + r.stats.total + " kept | " + r.stats.duplicates + " dupes | " + r.stats.falsePositives + " FP | " + r.stats.timeFiltered + " outside window\\n";
  text += "═".repeat(56) + "\\n\\n";

  const riskItems = r.items.filter(i => i.category === "Risk & Watch");
  if (riskItems.length > 0) {
    text += "⚠  RISK ALERT: " + riskItems.length + " item(s)\\n";
    riskItems.forEach(ri => { text += "   • " + ri.headline + "\\n"; });
    text += "─".repeat(40) + "\\n\\n";
  }

  text += "TOP HIGHLIGHTS\\n" + "─".repeat(40) + "\\n";
  r.items.slice(0, 6).forEach((item, i) => {
    text += (i+1) + ". " + item.headline + " — " + item.source + "\\n";
    text += "   " + item.summary + "\\n";
    text += "   [" + PROXIMITY_LABELS[item.proximity] + "] [" + item.category + "] [" + item.geo + "]\\n\\n";
  });

  text += "\\n" + "═".repeat(56) + "\\n";
  text += "Prepared automatically. Review names/titles before sharing.\\n";

  const blob = new Blob([text.replace(/\\\\n/g, "\\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "yale-media-report-" + new Date().toISOString().split("T")[0] + ".txt";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Init ────────────────────────────────────────────────────────────────────
(async function init() {
  const status = await fetchStatus();
  if (status) {
    const emailEl = document.getElementById("emailStatus");
    if (status.lastEmail?.sent) {
      emailEl.innerHTML = '<span class="schedule-dot dot-green"></span>Last email: delivered';
    } else if (status.lastEmail) {
      emailEl.innerHTML = '<span class="schedule-dot dot-amber"></span>Email: ' + (status.lastEmail.reason || "not sent");
    } else {
      emailEl.textContent = "Email: awaiting first report";
    }
    if (status.hasReport) {
      document.getElementById("btnGenerate").textContent = "↻ Refresh";
      await loadReport();
    }
  }

  // Auto-refresh every 5 minutes
  setInterval(async () => {
    const s = await fetchStatus();
    if (s && s.hasReport && currentReport && s.lastGenerated !== currentReport.generatedAt) {
      await loadReport();
    }
  }, 5 * 60 * 1000);
})();
</script>
</body>
</html>`;
}

// ─── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] Yale Media Dashboard running at http://localhost:${PORT}`);
  console.log(`[server] API key configured: ${process.env.ANTHROPIC_API_KEY ? "yes" : "NO — set ANTHROPIC_API_KEY"}`);
  console.log(`[server] SMTP configured: ${process.env.SMTP_USER ? "yes" : "NO — set SMTP_* vars for email"}`);
});

// ─── lib/email-builder.js ────────────────────────────────────────────────────
// Generates HTML and plain-text email versions of the report

const PROXIMITY_LABELS = { 3: "Direct", 2: "Indirect", 1: "Contextual" };

const CATEGORY_COLORS = {
  "Research": "#0f4c75",
  "Faculty": "#3c1361",
  "Grants & Partnerships": "#1b5e20",
  "Strategy & Policy": "#4a148c",
  "Athletics": "#bf360c",
  "Student Life & Arts": "#00695c",
  "Risk & Watch": "#b71c1c",
  "Social & Influencer": "#e65100",
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

// ─── HTML Email ──────────────────────────────────────────────────────────────

function buildHtmlEmail(report, dashboardUrl) {
  const { items, stats, generatedAt, cutoffStart } = report;

  const riskItems = items.filter((i) => i.category === "Risk & Watch");
  const topItems = items.slice(0, 6);

  // Group by category
  const categories = {};
  items.forEach((item) => {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  });

  const renderItem = (item) => {
    const isRisk = item.category === "Risk & Watch";
    const prefix = isRisk ? "⚠ " : "";
    const pubTime = item.pub_time
      ? (() => { try { const d = new Date(item.pub_time); return isNaN(d.getTime()) ? "" : ` · ${formatTimeET(item.pub_time)} ET`; } catch { return ""; } })()
      : "";

    return `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #e8e4df;${isRisk ? "background:#fef3f2;border-left:3px solid #b71c1c;" : ""}">
          <div style="margin-bottom:6px;">
            <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;color:#fff;background:${PROXIMITY_COLORS[item.proximity] || "#999"};font-family:monospace;text-transform:uppercase;letter-spacing:0.5px;">${PROXIMITY_LABELS[item.proximity]}</span>
            <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;color:${CATEGORY_COLORS[item.category] || "#333"};border:1px solid ${CATEGORY_COLORS[item.category] || "#ccc"};font-family:monospace;margin-left:4px;">${item.category}</span>
            <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;color:#fff;background:#555;font-family:monospace;margin-left:4px;">${item.geo}</span>
          </div>
          <div style="font-size:15px;font-weight:700;color:#1a1a1a;font-family:Georgia,serif;margin-bottom:4px;">${prefix}${item.headline}</div>
          <div style="font-size:13px;color:#444;line-height:1.5;margin-bottom:6px;">${item.summary}</div>
          <div style="font-size:11px;color:#888;">
            <strong style="color:#555;">${item.source}</strong>${pubTime}
            ${item.url && item.url !== "#" ? ` · <a href="${item.url}" style="color:#0f4c81;">View source →</a>` : ""}
          </div>
        </td>
      </tr>`;
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

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#0f2b46,#1a4d8f);padding:24px 20px;border-bottom:4px solid #c5a55a;">
    <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#c5a55a;font-family:monospace;font-weight:700;">Office of Public Affairs & Communications</div>
    <div style="font-size:22px;font-weight:700;color:#fff;margin-top:6px;font-family:Georgia,serif;">Yale Daily Media & Research Report</div>
    <div style="font-size:11px;color:#a8c4e0;font-family:monospace;margin-top:8px;">${formatET(generatedAt)} ET · 12h window from ${formatTimeET(cutoffStart)} to ${formatTimeET(generatedAt)} ET</div>
  </td></tr>

  <!-- Stats Bar -->
  <tr><td style="background:#f5f3ef;padding:16px 20px;border-bottom:1px solid #e0dcd6;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td align="center" width="25%">
        <div style="font-size:28px;font-weight:800;color:#0f3057;font-family:monospace;">${stats.total}</div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#777;font-weight:600;">Total Items</div>
      </td>
      <td align="center" width="25%">
        <div style="font-size:28px;font-weight:800;color:#1a4d8f;font-family:monospace;">${items.filter((i) => i.proximity === 3).length}</div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#777;font-weight:600;">Direct</div>
      </td>
      <td align="center" width="25%">
        <div style="font-size:28px;font-weight:800;color:${riskItems.length > 0 ? "#b71c1c" : "#2d6a4f"};font-family:monospace;">${riskItems.length}</div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#777;font-weight:600;">Risk</div>
      </td>
      <td align="center" width="25%">
        <div style="font-size:28px;font-weight:800;color:#555;font-family:monospace;">${stats.duplicates}</div>
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#777;font-weight:600;">Filtered</div>
      </td>
    </tr></table>
  </td></tr>

  ${riskItems.length > 0 ? `
  <!-- Risk Alert -->
  <tr><td style="background:#fef3f2;padding:12px 20px;border-bottom:1px solid #f5c6cb;">
    <div style="font-size:12px;font-weight:700;color:#b71c1c;font-family:monospace;">⚠ ${riskItems.length} RISK ITEM${riskItems.length > 1 ? "S" : ""} DETECTED</div>
    <div style="font-size:12px;color:#721c24;margin-top:4px;">${riskItems.map((r) => r.headline).join(" · ")}</div>
  </td></tr>` : ""}

  <!-- Top Highlights -->
  <tr><td style="padding:16px 16px 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#0f3057;font-family:monospace;border-bottom:2px solid #0f3057;">Top Highlights</td></tr>
  ${topItems.map(renderItem).join("")}

  <!-- By Category -->
  ${categorySections}

  <!-- Dashboard Link -->
  ${dashboardUrl ? `
  <tr><td style="padding:20px;text-align:center;">
    <a href="${dashboardUrl}" style="display:inline-block;padding:10px 28px;background:#0f3057;color:#fff;text-decoration:none;border-radius:4px;font-size:12px;font-weight:700;font-family:monospace;letter-spacing:0.5px;text-transform:uppercase;">View Full Dashboard →</a>
  </td></tr>` : ""}

  <!-- Footer -->
  <tr><td style="padding:16px 20px;background:#f0ece6;border-top:1px solid #e0dcd6;font-size:11px;color:#888;font-family:monospace;">
    <div>Totals: ${stats.total} kept · ${stats.duplicates} dupes · ${stats.falsePositives} false positives · ${stats.timeFiltered} outside window</div>
    <div style="margin-top:6px;font-style:italic;color:#aaa;">Prepared automatically. Please review names/titles for absolute accuracy before external sharing.</div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ─── Plain Text Email ────────────────────────────────────────────────────────

function buildPlainTextEmail(report) {
  const { items, stats, generatedAt, cutoffStart } = report;

  let text = "";
  text += `YALE DAILY MEDIA & RESEARCH REPORT\n`;
  text += `${"═".repeat(56)}\n`;
  text += `Generated: ${formatET(generatedAt)} ET\n`;
  text += `12h window: ${formatTimeET(cutoffStart)} to ${formatTimeET(generatedAt)} ET\n`;
  text += `Items: ${stats.total} kept | ${stats.duplicates} dupes | ${stats.falsePositives} false positives | ${stats.timeFiltered} outside window\n`;
  text += `${"═".repeat(56)}\n\n`;

  const riskItems = items.filter((i) => i.category === "Risk & Watch");
  if (riskItems.length > 0) {
    text += `⚠  RISK ALERT: ${riskItems.length} item(s)\n`;
    riskItems.forEach((r) => { text += `   • ${r.headline}\n`; });
    text += `${"─".repeat(40)}\n\n`;
  }

  text += `TOP HIGHLIGHTS\n${"─".repeat(40)}\n`;
  items.slice(0, 6).forEach((item, i) => {
    text += `${i + 1}. ${item.headline} — ${item.source}\n`;
    text += `   ${item.summary}\n`;
    text += `   [${PROXIMITY_LABELS[item.proximity]}] [${item.category}] [${item.geo}]`;
    if (item.url && item.url !== "#") text += `\n   ${item.url}`;
    text += `\n\n`;
  });

  // Group by category
  const categories = {};
  items.forEach((item) => {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  });

  for (const [cat, catItems] of Object.entries(categories)) {
    text += `\n${cat.toUpperCase()} (${catItems.length})\n${"─".repeat(40)}\n`;
    catItems.forEach((item) => {
      const prefix = cat === "Risk & Watch" ? "Watch: " : "";
      text += `• ${prefix}${item.headline} — ${item.source}\n`;
      text += `  ${item.summary}\n`;
      if (item.url && item.url !== "#") text += `  ${item.url}\n`;
      text += `\n`;
    });
  }

  text += `${"═".repeat(56)}\n`;
  text += `APPENDIX: LEDGER\n`;
  text += `Source | Title | Proximity | Category | Geo\n`;
  text += `${"─".repeat(56)}\n`;
  items.forEach((item) => {
    text += `${item.source} | ${item.headline} | ${PROXIMITY_LABELS[item.proximity]} | ${item.category} | ${item.geo}\n`;
  });

  text += `\n${"─".repeat(56)}\n`;
  text += `Prepared automatically. Please review names/titles for\nabsolute accuracy before external sharing.\n`;

  return text;
}

module.exports = { buildHtmlEmail, buildPlainTextEmail };

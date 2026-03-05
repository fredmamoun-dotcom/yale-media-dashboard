// ─── lib/mailer.js ───────────────────────────────────────────────────────────
// Sends report emails via SMTP using Nodemailer

const nodemailer = require("nodemailer");
const { buildHtmlEmail, buildPlainTextEmail } = require("./email-builder");

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendReportEmail(report, dashboardUrl) {
  const recipients = (process.env.EMAIL_RECIPIENTS || "").split(",").map((e) => e.trim()).filter(Boolean);

  if (recipients.length === 0) {
    console.warn("[mailer] No EMAIL_RECIPIENTS configured — skipping send");
    return { sent: false, reason: "no recipients" };
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[mailer] SMTP credentials not configured — skipping send");
    return { sent: false, reason: "no smtp credentials" };
  }

  const transport = createTransport();
  const genDate = new Date(report.generatedAt).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
  const genTime = new Date(report.generatedAt).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });

  const riskCount = report.items.filter((i) => i.category === "Risk & Watch").length;
  const riskTag = riskCount > 0 ? ` [⚠ ${riskCount} RISK]` : "";

  const subject = `Yale Media Report — ${genDate} ${genTime} ET${riskTag} (${report.stats.total} items)`;

  const htmlBody = buildHtmlEmail(report, dashboardUrl);
  const textBody = buildPlainTextEmail(report);

  try {
    const info = await transport.sendMail({
      from: process.env.EMAIL_FROM || `"Yale Media Monitor" <${process.env.SMTP_USER}>`,
      to: recipients.join(", "),
      subject,
      text: textBody,
      html: htmlBody,
    });

    console.log(`[mailer] Sent to ${recipients.length} recipient(s): ${info.messageId}`);
    return { sent: true, messageId: info.messageId, recipients };
  } catch (err) {
    console.error("[mailer] Send failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendReportEmail };

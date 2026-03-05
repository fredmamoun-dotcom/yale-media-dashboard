# Yale Daily Media & Research Report Dashboard

A self-hosted web dashboard and automated email system that monitors news coverage of Yale University. It searches 10 targeted queries via the Claude API with web search, scores and deduplicates results, flags risk items, and delivers polished reports twice daily via email.

---

## Features

- **Live web dashboard** — browse, filter, and export the latest report from any browser
- **12-hour rolling window** — only includes items published in the last 12 hours (enforced at API prompt level, query level, and client-side)
- **Automated email delivery** — HTML + plain-text emails sent at 7:00 AM and 7:00 PM ET (configurable)
- **Smart scoring** — items ranked by proximity (Direct/Indirect/Contextual), category weight, and risk flags
- **False-positive filtering** — automatically excludes Yale Appliance, Yale Lock, etc.
- **Risk lexicon scanning** — flags items matching lawsuit, Title IX, data breach, harassment, and 18 other risk terms
- **Deduplication** — merges items with matching titles or URLs
- **One-click export** — download the full report as a structured plain-text file
- **Report history** — keeps the last 14 reports in memory for quick reference
- **Manual trigger** — run a report on demand from the dashboard or API

---

## Quick Start

### 1. Clone and install

```bash
cd yale-media-dashboard
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | Your Anthropic API key (needs web search access) |
| `SMTP_HOST` | For email | SMTP server (default: smtp.gmail.com) |
| `SMTP_PORT` | For email | SMTP port (default: 587) |
| `SMTP_USER` | For email | SMTP username / email |
| `SMTP_PASS` | For email | SMTP password or app password |
| `EMAIL_RECIPIENTS` | For email | Comma-separated recipient emails |
| `EMAIL_FROM` | For email | From address displayed on emails |
| `PORT` | No | Server port (default: 3000) |
| `CRON_MORNING` | No | Morning cron expression (default: `0 7 * * *`) |
| `CRON_EVENING` | No | Evening cron expression (default: `0 19 * * *`) |
| `CRON_TIMEZONE` | No | Timezone for cron (default: `America/New_York`) |

### 3. Start the server

```bash
npm start
```

Open `http://localhost:3000` in your browser.

---

## Gmail Setup (for email delivery)

1. Enable 2-Step Verification on your Google account
2. Go to https://myaccount.google.com/apppasswords
3. Generate an App Password for "Mail"
4. Use your Gmail address as `SMTP_USER` and the app password as `SMTP_PASS`

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Dashboard HTML page |
| `GET` | `/api/report` | Latest report as JSON |
| `GET` | `/api/history` | Report generation history |
| `GET` | `/api/status` | System status (schedules, email, generating state) |
| `POST` | `/api/generate` | Trigger a manual report generation |

---

## Deployment

### Docker (recommended)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t yale-media-dashboard .
docker run -d --env-file .env -p 3000:3000 yale-media-dashboard
```

### Railway / Render / Fly.io

Set environment variables in your provider's dashboard and deploy. The app binds to `PORT` automatically.

### Systemd (bare metal)

```ini
[Unit]
Description=Yale Media Dashboard
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/yale-media-dashboard/server.js
WorkingDirectory=/opt/yale-media-dashboard
EnvironmentFile=/opt/yale-media-dashboard/.env
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## Architecture

```
server.js              Express server + cron scheduler + dashboard HTML
lib/
  report-engine.js     Search queries → Claude API → score → filter → deduplicate
  email-builder.js     HTML + plain-text email templates
  mailer.js            Nodemailer SMTP transport + send logic
.env.example           Configuration template
```

---

## Customization

- **Add/remove search queries**: Edit `SEARCH_QUERIES` in `lib/report-engine.js`
- **Change schedule**: Set `CRON_MORNING` / `CRON_EVENING` in `.env`
- **Add risk keywords**: Edit `RISK_LEXICON` in `lib/report-engine.js`
- **Add false positives**: Edit `FALSE_POSITIVES` in `lib/report-engine.js`
- **Restyle emails**: Edit `lib/email-builder.js`



# Yale Media Dashboard — Claude Code Handoff

## Quick Start Prompt

Copy and paste everything below the line into Claude Code to get started:

---

## PROMPT FOR CLAUDE CODE

I need help fixing and completing a Node.js web dashboard deployed on Railway. Here's the full context:

### Project Overview

The **Yale Daily Media & Research Report Dashboard** is a Node.js/Express web app that:
- Searches for Yale University news using the Anthropic Claude API with web search tool
- Runs 10 targeted queries, scores/deduplicates/filters results
- Displays results on a polished web dashboard
- Auto-generates reports at 7 AM and 7 PM ET via node-cron
- Emails reports via Nodemailer/SMTP

### GitHub Repo

```
https://github.com/fredmamoun-dotcom/yale-media-dashboard
```

Public repo. Clone it to start working.

### Current Deployment

- **Platform:** Railway (railway.app)
- **Project name:** secure-comfort
- **URL:** yale-media-dashboard-production.up.railway.app
- **Status:** Active but searches return 0 results

### Environment Variables on Railway

```
ANTHROPIC_API_KEY=sk-ant-... (set, confirmed working, has credits)
PORT=3000 (set, but Railway auto-assigns port — app runs on 8080)
```

Email variables NOT yet configured (SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_RECIPIENTS, etc.)

### Architecture

The app was consolidated into a **single file** (`server.js`) to avoid module-not-found errors during deployment. It contains:
- Report engine (search queries, scoring, dedup, false-positive filtering)
- Email builder (HTML + plain text email templates)
- Mailer (Nodemailer SMTP transport)
- Express server + cron scheduler
- Full HTML/CSS/JS dashboard served inline

### File Structure on GitHub

```
yale-media-dashboard/
├── server.js          ← ALL app code (single file, ~570 lines)
├── package.json       ← dependencies: express, node-cron, nodemailer, dotenv
├── README.md
├── .env.example
└── lib/               ← exists but NOT used (server.js is self-contained)
    ├── report-engine.js
    ├── email-builder.js
    └── mailer.js
```

### package.json Dependencies

```json
{
  "dependencies": {
    "express": "^4.21.0",
    "node-cron": "^3.0.3",
    "nodemailer": "^6.9.0",
    "dotenv": "^16.4.0"
  }
}
```

### THE MAIN PROBLEM TO FIX

The dashboard loads and runs, but **all 10 API searches return 0 results**. The Deploy Logs on Railway show:

```
[report] Starting report generation at 2026-03-05T04:13:07.628Z
[report] 12-hour cutoff: 2026-03-04T16:13:07.628Z
[report] (1/10) Searching: Yale University news today
[report] (2/10) Searching: Yale University research today 2026
...
[report] (10/10) Searching: Yale student campus news today
[report] Complete: 0 items kept, 0 dupes, 0 false positives, 0 outside window
```

Key observations from the logs:
1. All 10 searches fire at nearly the same timestamp (within 1 second), suggesting the `await` calls may not be awaiting properly, or the API calls are failing silently
2. No debug/error log lines appear between searches, meaning the try/catch in `runSingleSearch` is swallowing errors
3. The API key is confirmed set (`[server] API key: yes`) and has credits
4. When the API was called without credits, the same behavior occurred (silent failure, 0 results)

### Suspected Root Causes (investigate these)

1. **Web search tool format may be wrong** — The tool is specified as `{ type: "web_search_20250305", name: "web_search" }`. Verify this is the correct format for the Anthropic API. Check Anthropic docs for the correct web search tool specification.

2. **API response parsing** — The code extracts only `type: "text"` blocks from the response. When web search is used, Claude may return `tool_use` blocks first and require a multi-turn conversation to get the final text response. The current code only sends one message and expects text back immediately.

3. **Parallel execution** — The searches appear to fire simultaneously. The `for` loop with `await` should be sequential, but verify the async flow is correct.

4. **Error swallowing** — Add comprehensive logging to see what the API actually returns (status code, response body, content block types).

### How the Search Function Works

The `runSingleSearch` function (around line 93 in server.js):
1. Builds a system prompt telling Claude to search for Yale news within a 12-hour window
2. Calls `https://api.anthropic.com/v1/messages` with:
   - Model: `claude-sonnet-4-20250514`
   - Tools: web_search
   - System prompt asking for JSON array output
3. Extracts text blocks from response
4. Parses JSON array of news items
5. Returns items or empty array on failure

### What the Search Function Should Return

Each search should return 0-5 items like:
```json
[
  {
    "headline": "Yale Researchers Discover New Cancer Biomarker",
    "source": "Yale News",
    "url": "https://news.yale.edu/...",
    "summary": "Yale School of Medicine researchers identified a novel biomarker that may improve early cancer detection.",
    "tags": ["research", "medicine"],
    "pub_time": "2026-03-04T14:00:00Z"
  }
]
```

### Scoring System

After items are collected:
- **Proximity scoring**: Direct (3pts) = "Yale University", "Yale School", etc. Indirect (2pts) = "Yale researchers", "Yale professor". Contextual (1pts) = just "Yale"
- **Category detection**: Research, Faculty, Grants & Partnerships, Strategy & Policy, Athletics, Student Life & Arts, Risk & Watch
- **Risk lexicon**: lawsuit, Title IX, arrest, harassment, plagiarism, data breach, etc.
- **False positive filtering**: Yale Appliance, Yale Lock, Yale forklift, Yale CBD
- **Deduplication**: by normalized title and URL
- **Final score** = proximity*2 + category_weight + risk_boost

### What Needs to Be Done (Priority Order)

1. **FIX: API search returning 0 results** — This is the blocking issue. Debug the API call, fix the web search tool usage, ensure proper response parsing. Test locally first.

2. **FIX: Proper error logging** — Add logging that shows the full API response (status, content types, error messages) so failures are visible in Railway logs.

3. **FIX: Sequential search execution** — Ensure searches run one at a time with delays between them (rate limiting).

4. **CONFIGURE: Email delivery** — Set up SMTP variables on Railway for automated email reports. The code already supports Gmail via app passwords.

5. **IMPROVE: 12-hour time window** — Currently the time constraint is only in the prompt. Consider whether this is reliable enough or if additional filtering is needed.

6. **IMPROVE: Consider refactoring back to multi-file** — The single-file approach was a workaround for deployment issues. If you fix the deployment, consider splitting back into lib/ modules for maintainability.

### Testing Locally

```bash
git clone https://github.com/fredmamoun-dotcom/yale-media-dashboard.git
cd yale-media-dashboard
npm install
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
npm start
# Open http://localhost:3000
# Click "Refresh" to run a report
```

### Deploying Updates

The repo is connected to Railway. Any commit to the `main` branch on GitHub auto-deploys to Railway. You can push changes via:

```bash
git add .
git commit -m "fix: description of change"
git push origin main
```

Railway will automatically rebuild and deploy within 1-2 minutes.

### Railway Environment

- Node.js v22.22.0
- Railway auto-assigns PORT (currently 8080, not 3000)
- The app reads `process.env.PORT` which Railway sets automatically
- Deploy logs visible at: Railway dashboard → service → Deploy Logs

### Key API Details

- **Anthropic API endpoint:** `https://api.anthropic.com/v1/messages`
- **Required headers:** `Content-Type`, `x-api-key`, `anthropic-version: 2023-06-01`
- **Model:** `claude-sonnet-4-20250514`
- **Web search tool:** Needs verification — check https://docs.anthropic.com for correct tool specification

### User Constraints

- The user (Fred) has a work Mac with restricted permissions — cannot install software via Terminal (no admin/sudo access)
- All code changes need to go through GitHub web interface or Claude Code
- BeyondTrust EPM is used for elevated access requests at their organization

### Original Requirements (from the user's prompt document)

- Only include items published within the last 12 hours
- Yale-specific inclusion keywords: Yale, Yale University, YNH, YNHH, Yale New Haven Hospital, Yale School of Medicine, YSM, YSPH, SEAS, Yale College, Yale Law School, YLS, YSE, SOM, YCSC, Yale Peabody Museum, Yale Athletics
- False positives to exclude: Yale Appliance, Yale Lock, Yale forklift, Yale CBD
- Output format: headline, source, publication time, link, summary, tags
- Report runs at 7:00 AM ET and 7:00 PM ET daily
- Email delivery to configured recipients
- Plain text export option

Please start by cloning the repo, examining server.js, and fixing the API search issue. Test locally before pushing to GitHub.

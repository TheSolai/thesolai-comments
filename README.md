# Sol AI Comments — Architecture Overview

**Private repo.** Two deployment options were considered:

| | Railway | Google Apps Script |
|--|---------|-------------------|
| Status | ❌ Changed — only 30 days free | ✅ Live — what we use |
| Credit card required | Yes | No |
| Server maintenance | Railway app | None |
| Complexity | Node.js server | Single script file |

We use **Google Apps Script** as the comment backend.

## How it works

```
Visitor submits form
    ↓
Google Apps Script (receives POST)
    ↓ — validates PIN server-side
    ↓ — triggers GitHub Actions
GitHub Actions workflow
    ↓ — writes comment JSON to _data/comments/{slug}-{ts}.json
    ↓ — regenerates _data/comments-index.json
    ↓ — creates PR → auto-merges
GitHub Pages rebuilds
    ↓
Comment appears on site (~1-2 min delay)
```

## Two repos involved

- **`TheSolAI/thesolai-comments`** (this repo) — source of the Google Apps Script code
- **`TheSolAI/thesolai.github.io`** — Jekyll site + GitHub Actions workflow

The workflow file lives in the Jekyll repo:
`.github/workflows/comment-handler.yml`

## Google Apps Script Setup

1. Go to **script.google.com** → New Project
2. Paste `google-apps-script.js`
3. Update the `GITHUB_TOKEN` constant with a GitHub PAT (needs `repo` scope)
4. **Deploy → New Deployment → Web App**
   - Execute as: Me
   - Who has access: Anyone
5. Copy the Web App URL
6. Add to `_config.yml` in the Jekyll repo: `commentsApi: "https://script.google.com/..."`

## GitHub Actions Setup

1. Enable Actions on `TheSolAI/thesolai.github.io`
2. The workflow at `.github/workflows/comment-handler.yml` runs automatically
3. It triggers on `repository_dispatch` events from the Google Apps Script

## PIN System

- **Amre's code: 0620** (enter as last 4 digits of a longer code, e.g. `00000620`)
- Stored as SHA-256 hash in the script: `a67ff832978f7f03192fded680d070ca2bb06b8e0bc33c1b26ee843be42a3e0c`
- Server-side validation — never in the browser

## Name Blocking

Guests cannot use: `amre`, `eoghan`, `sol`, `admin`, `anonymous`, `guest`, `moderator`, `owner`
Plus standard bad words. Checked server-side in the Apps Script.

## Email

- Collected in the form
- Passed to GitHub Actions in the dispatch payload
- Stored in the JSON file in `_data/comments/`
- **Never exposed** in the Jekyll-rendered comments list
- Displayed as email-derived username (`amrlee` from `amrlee@example.com`)

## Daily Comment Check

Runs at 9 AM Dublin time:
```
~/.openclaw/workspace/scripts/check-comments.sh
```
Checks GitHub Issues for new comments on the repo, logs them.

## Key Files

| File | Purpose |
|------|---------|
| `google-apps-script.js` | Apps Script code — paste into script.google.com |
| README.md | This file |

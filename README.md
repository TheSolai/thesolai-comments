# Sol AI Comments Webhook

Webhook server for the comment system on thesolai.github.io.

## What it does

- Validates comment form submissions (PIN check server-side)
- Posts comments to GitHub Issues (one issue per page/slug)
- Serves a `GET /comments/:slug` endpoint for loading existing comments

## Setup

### 1. Deploy to Glitch

1. Go to [glitch.com](https://glitch.com) and sign in with GitHub
2. Click **New Project** → **Import from GitHub** → enter `TheSolAI/thesolai-comments`
3. In the Glitch project, click **.env** (or Project Settings → Environment Variables)
4. Add:
   - `GITHUB_TOKEN=ghp_YOUR_TOKEN_HERE`

To create a GitHub PAT:
- Go to https://github.com/settings/tokens
- Click **Generate new token (classic)**
- Scopes needed: `repo` (full control of repositories)
- Copy the token and paste into Glitch's `GITHUB_TOKEN` env var

### 2. Update Jekyll config

Once Glitch gives you a URL (e.g. `https://your-project.glitch.me`), update `_config.yml`:

```yaml
commentsApi: "https://your-project.glitch.me"
```

Then push to GitHub — the site will redeploy with the new API URL.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/comment` | Submit a comment |
| GET | `/comments/:slug` | Fetch comments for a page |
| GET | `/` | Health check |

### POST /comment

```json
{
  "name": "Guest",
  "message": "Hello world",
  "slug": "why-i-exist",
  "pin": "1234"
}
```

- `slug`: The page identifier (e.g. post slug or "contact")
- `pin`: Last 4 digits of the 12-digit code (0620 for Amre)
- If `pin` is correct: posts as Amre with her avatar

Response:
```json
{ "success": true, "identity": "amre", "name": "Amre", "message": "Comment posted successfully" }
```

### GET /comments/:slug

Returns all comments for the given slug:

```json
{
  "slug": "why-i-exist",
  "comments": [
    {
      "id": 12345678,
      "name": "Amre",
      "avatar": "https://thesolai.github.io/images/amre-avatar.jpg",
      "asAmre": true,
      "message": "Great post.",
      "date": "2026-03-25T14:00:00Z"
    }
  ]
}
```

## PIN System

- Amre's PIN: **0620**
- The form accepts 12 digits but only the **last 4** are validated
- Server-side: `SHA-256(last4) === stored_hash` → posts as Amre
- If the 4-digit code is wrong: posts as "Guest" with no avatar

## Comment Storage

Comments are stored as GitHub Issue comments on the repo:
- One issue per page/slug
- Issue title: `comments: <slug>`
- Label: `blog-comment`
- The comment body has a metadata prefix: `[NAME:Name] [AVATAR:url] [AMRE]`

## Local Development

```bash
cd thesolai-comments
npm install
GITHUB_TOKEN=ghp_xxx PORT=3000 npm start
```

## Glitch Notes

- Glitch free tier sleeps after 5 min of inactivity
- First request after sleep takes ~5-10 seconds (cold start)
- Comments will still submit — just with a delay on the first one
- For personal use this is fine; Glitch wakes up and processes the request

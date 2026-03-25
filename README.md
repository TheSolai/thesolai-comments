# Sol AI Comments — Private Comment Backend

**Private repo.** This handles all comment logic for [thesolai.github.io](https://thesolai.github.io).

## What it does

- Accepts comment submissions from the public site
- Validates the 4-digit PIN server-side (`0620` = Amre)
- Blocks reserved names (`Amre`, `Eoghan`) and bad words from guest comments
- Stores comments in memory + posts to GitHub Issues (backup)
- Flags Amre's comments so the site can apply special styling
- Serves comment lists via `GET /comments/:slug`

## Architecture

```
Browser → Jekyll site (thesolai.github.io)
        → Railway deployment (thesolai-comments.railway.app)
        → GitHub Issues (thesolai/thesolai.github.io)
        → Local JSON memory (data/comments.json on Railway)
```

## Deploy to Railway (5 minutes)

### 1. Get a GitHub Personal Access Token

1. Go to https://github.com/settings/tokens
2. **Generate new token (classic)**
3. Scopes: check **`repo`** (full control of private and public repositories)
4. Copy the token (starts with `ghp_`)

### 2. Deploy on Railway

1. Go to [railway.app](https://railway.app) — sign up with GitHub
2. Click **New Project** → **Deploy from GitHub repo**
3. Select **`TheSolAI/thesolai-comments`** (it's private, you'll see it because you're a collaborator)
4. Railway will detect Node.js and deploy automatically
5. **Set environment variable:**
   - Click the deployment → **Variables**
   - Add: `GITHUB_TOKEN` = `ghp_YOUR_TOKEN_HERE`
6. Railway will redeploy automatically

### 3. Get your URL

- Railway gives you a URL like `https://thesolai-comments.up.railway.app`
- Click **Settings** → **Networking** → **Public Networking** → Enable
- Copy the public URL

### 4. Update Jekyll site

```bash
cd /Users/amre/Projects/thesolai.github.io
# Edit _config.yml and change:
# commentsApi: "https://thesolai-comments.up.railway.app"
git add -A && git commit -m "Enable comment API" && git push
```

Site redeploys. Comments go live.

---

## API Reference

### POST /comment

```json
{
  "name": "Guest",
  "message": "Hello!",
  "slug": "why-i-exist",
  "pin": "1234"
}
```

Response:
```json
{
  "success": true,
  "identity": "amre",
  "name": "Amre",
  "isAmre": true,
  "avatar": "https://thesolai.github.io/images/amre-avatar.jpg",
  "id": "uuid-here",
  "message": "Comment posted"
}
```

### GET /comments/:slug

```json
{
  "slug": "why-i-exist",
  "count": 3,
  "comments": [
    {
      "id": "uuid",
      "name": "Amre",
      "avatar": "https://thesolai.github.io/images/amre-avatar.jpg",
      "isAmre": true,
      "message": "Great post!",
      "date": "2026-03-25T14:00:00.000Z"
    }
  ]
}
```

### GET /

Health check.

---

## PIN System

- **Amre's code: `0620`**
- The form accepts 12 digits visually but only the **last 4** are checked
- Server-side: `SHA-256(last4) === SHA-256(0620)` → posts as Amre
- Wrong code → posts as "Guest"
- The hash in the code is not reversible for any practical purpose

## Name Blocking

Guest comments cannot use these names:
- `amre`, `eoghan`, `sol`, `admin`, `anonymous`, `guest`, `moderator`

Bad words are also blocked. The blocking is server-side — bypassing the form UI doesn't help.

## Amre's Special Styling

When `isAmre: true` in the API response, the site applies:
- Gradient text (purple → pink → gold shimmer)
- Sparkle/star decorations
- Amre's cartoon avatar next to her name  
- Gold accent on the comment card

See: `_includes/comments-list.html` in the Jekyll site for implementation.

---

## If Railway Goes Down

Comments still work:
1. The Railway server handles new submissions
2. GitHub Issues stores a permanent backup of all comments
3. When Railway comes back, it reads from local memory + syncs from GitHub

## Local Development

```bash
cd thesolai-comments
npm install
GITHUB_TOKEN=ghp_xxx npm start
# Server runs on http://localhost:3000
```

## Repository

- **Private repo**: `github.com/TheSolAI/thesolai-comments`
- **Public site**: `github.com/TheSolAI/thesolai.github.io`

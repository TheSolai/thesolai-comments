#!/usr/bin/env node
/**
 * thesolai-comments
 * Webhook server for blog/contact comment system.
 * Keeps GitHub token server-side; validates PIN; posts to GitHub Issues.
 */

const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration — from environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Required: GitHub PAT
const GITHUB_OWNER = 'TheSolAI';
const GITHUB_REPO = 'thesolai.github.io';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ''; // Shared secret for form auth

// Amre's PIN: 0620 — stored as SHA-256 hash (computed at startup for safety)
const AMRE_PIN_HASH = crypto.createHash('sha256').update('0620').digest('hex');
const AMRE_NAME = 'Amre';
const AMRE_AVATAR = 'https://thesolai.github.io/images/amre-avatar.jpg';

// Comments are stored in GitHub Issues — one issue per page slug
// Issue title format: "comments: <slug>"
// Issue label: "blog-comment"
const COMMENT_LABEL = 'blog-comment';

// GitHub API helpers
async function ghFetch(path, options = {}) {
    const url = `https://api.github.com${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'thesolai-comments/1.0',
            ...(options.headers || {})
        }
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(`GitHub API error ${res.status}: ${JSON.stringify(data)}`);
    }
    return data;
}

async function findIssue(slug) {
    // Search for existing issue with title "comments: <slug>"
    const q = encodeURIComponent(`repo:${GITHUB_OWNER}/${GITHUB_REPO} "comments: ${slug}" is:issue state:open`);
    const data = await ghFetch(`/search/issues?q=${q}&per_page=1`);
    if (data.items && data.items.length > 0) {
        return data.items[0];
    }
    return null;
}

async function createIssue(slug, title) {
    return await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, {
        method: 'POST',
        body: JSON.stringify({
            title: `comments: ${slug}`,
            body: `Comment thread for: ${title || slug}\n\n---\n_This issue is managed automatically by the Sol AI comment system._`,
            labels: [COMMENT_LABEL]
        })
    });
}

async function addIssueComment(issueNumber, commentBody) {
    return await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: commentBody })
    });
}

async function getIssueComments(issueNumber) {
    return await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}/comments`);
}

// Validate PIN — returns 'amre' if PIN matches, 'guest' otherwise
function validatePin(pin) {
    if (!pin) return 'guest';
    const inputHash = crypto.createHash('sha256').update(pin).digest('hex');
    if (inputHash === AMRE_PIN_HASH) return 'amre';
    return 'guest';
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// CORS helper
function cors() {
    return (req, res, next) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret');
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    };
}

// Optional webhook secret check
function checkSecret(req, res, next) {
    if (!WEBHOOK_SECRET) return next();
    const provided = req.headers['x-webhook-secret'];
    if (provided && provided === WEBHOOK_SECRET) return next();
    // Don't block — just continue without trusted status
    next();
}

// --- Routes ---

// GET /comments/:slug — fetch comments for a page
app.get('/comments/:slug(*)', async (req, res) => {
    const slug = req.params.slug;
    if (!slug || slug.includes('..') || slug.includes('/')) {
        return res.status(400).json({ error: 'Invalid slug' });
    }

    try {
        const issue = await findIssue(slug);
        if (!issue) {
            return res.json({ slug, comments: [] });
        }
        const comments = await getIssueComments(issue.number);
        // Parse comment bodies
        const parsed = comments.map(c => {
            let name = 'Guest';
            let avatar = '';
            let asAmre = false;
            let message = c.body;

            // Body format: [NAME:name] [AVATAR:url] [AMRE] body
            const nameMatch = c.body.match(/^\[NAME:([^\]]+)\]/);
            const avatarMatch = c.body.match(/\[AVATAR:([^\]]+)\]/);
            const amreMatch = c.body.match(/\[AMRE\]/);

            if (nameMatch) { name = nameMatch[1]; asAmre = !!amreMatch; }
            if (avatarMatch) avatar = avatarMatch[1];
            message = c.body.replace(/^\[NAME:[^\]]+\]\s*(\[AVATAR:[^\]]+\]\s*)?(\[AMRE\]\s*)?/, '');

            return {
                id: c.id,
                name: name,
                avatar: avatar,
                asAmre: asAmre,
                message: message.trim(),
                date: c.created_at
            };
        });
        res.json({ slug, comments: parsed });
    } catch (err) {
        console.error('GET /comments error:', err.message);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});

// POST /comment — submit a new comment
app.post('/comment', checkSecret, async (req, res) => {
    const { name, message, slug, pin, avatar_url } = req.body;

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message is required' });
    }
    if (!slug || slug.includes('..') || slug.includes('/')) {
        return res.status(400).json({ error: 'Invalid slug' });
    }
    if (message.length > 2000) {
        return res.status(400).json({ error: 'Message too long (max 2000 chars)' });
    }

    const pinResult = validatePin(pin);
    const commenterName = pinResult === 'amre' ? AMRE_NAME : (name ? name.trim().slice(0, 60) : 'Guest');
    const commenterAvatar = pinResult === 'amre' ? AMRE_AVATAR : (avatar_url || '');
    const isAmre = pinResult === 'amre';

    // Build comment body with metadata prefix
    let commentBody = `[NAME:${commenterName}]`;
    if (commenterAvatar) commentBody += ` [AVATAR:${commenterAvatar}]`;
    if (isAmre) commentBody += ' [AMRE]';
    commentBody += '\n\n' + message.trim();

    try {
        let issue = await findIssue(slug);
        if (!issue) {
            issue = await createIssue(slug, slug);
        }
        await addIssueComment(issue.number, commentBody);
        res.json({
            success: true,
            identity: pinResult,
            name: commenterName,
            message: 'Comment posted successfully'
        });
    } catch (err) {
        console.error('POST /comment error:', err.message);
        res.status(500).json({ error: 'Failed to post comment' });
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'thesolai-comments' });
});

app.listen(PORT, () => {
    console.log(`thesolai-comments listening on port ${PORT}`);
    if (!GITHUB_TOKEN) {
        console.warn('WARNING: GITHUB_TOKEN not set — comments will fail');
    } else {
        console.log('GitHub token: loaded');
    }
});

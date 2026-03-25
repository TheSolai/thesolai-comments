#!/usr/bin/env node
/**
 * Sol AI Comments — Private Comment Backend
 * =========================================
 * Handles comment submissions for thesolai.github.io
 * - Validates PIN server-side (0620 = Amre)
 * - Blocks reserved names from guest comments
 * - Stores comments in GitHub Issues + local JSON memory
 * - Flags Amre's comments for special styling
 * - CORS-enabled for static site calls
 *
 * Deploy: Railway.app (connect GitHub repo, set GITHUB_TOKEN env var)
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Required: GitHub PAT
const GITHUB_OWNER = 'TheSolAI';
const GITHUB_REPO = 'thesolai.github.io';
const COMMENT_LABEL = 'blog-comment';

// Amre's identity
const AMRE_NAME = 'Amre';
const AMRE_AVATAR = 'https://thesolai.github.io/images/amre-avatar.jpg';
const AMRE_PIN_HASH = crypto.createHash('sha256').update('0620').digest('hex');

// Memory store — persisted to disk
const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'comments.json');

// ─── Init ─────────────────────────────────────────────────────────────────────

const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load memory
function loadMemory() {
    if (!fs.existsSync(MEMORY_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    } catch (e) {
        console.error('Memory load error:', e.message);
        return {};
    }
}

// Save memory
function saveMemory(data) {
    try {
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Memory save error:', e.message);
    }
}

// ─── Memory ───────────────────────────────────────────────────────────────────

/**
 * Comment object shape:
 * {
 *   id: string,          // UUID
 *   slug: string,        // page slug
 *   name: string,        // display name
 *   message: string,     // comment text
 *   isAmre: boolean,     // true if PIN-verified Amre
 *   avatar: string,      // avatar URL or ''
 *   date: string,        // ISO timestamp
 *   githubIssueNumber: number | null
 * }
 */

function addComment(comment) {
    const mem = loadMemory();
    if (!mem[comment.slug]) mem[comment.slug] = [];
    comment.id = crypto.randomUUID();
    comment.date = new Date().toISOString();
    mem[comment.slug].push(comment);
    // Keep last 500 comments per slug
    if (mem[comment.slug].length > 500) {
        mem[comment.slug] = mem[comment.slug].slice(-500);
    }
    saveMemory(mem);
    return comment;
}

function getComments(slug) {
    const mem = loadMemory();
    return mem[slug] || [];
}

// ─── Name Blocking ─────────────────────────────────────────────────────────────

// Reserved names that only Amre can use
const RESERVED_NAMES = ['amre', 'eoghan', 'sol', 'admin', 'anonymous', 'guest', 'moderator'];

// Bad words — simple list, expand as needed
const BLOCKED_WORDS = [
    'fuck', 'shit', 'ass', 'bitch', 'bastard', 'cunt', 'dick', 'cock',
    'nigger', 'nigga', 'slut', 'whore', 'faggot', 'retard', 'spastic'
];

function isNameBlocked(name) {
    const lower = name.toLowerCase().trim();
    if (RESERVED_NAMES.includes(lower)) return true;
    if (BLOCKED_WORDS.some(w => lower.includes(w))) return true;
    return false;
}

// ─── GitHub Integration ────────────────────────────────────────────────────────

const GH_BASE = 'https://api.github.com';

async function ghFetch(path, options = {}) {
    const res = await fetch(`${GH_BASE}${path}`, {
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
        throw new Error(`GitHub ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data;
}

async function findIssue(slug) {
    const q = encodeURIComponent(`repo:${GITHUB_OWNER}/${GITHUB_REPO} "comments: ${slug}" in:title is:issue state:open`);
    const data = await ghFetch(`/search/issues?q=${q}&per_page=1`);
    return (data.items && data.items.length > 0) ? data.items[0] : null;
}

async function createIssue(slug) {
    const slugTitle = slug === 'contact' ? 'contact' : slug;
    return await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, {
        method: 'POST',
        body: JSON.stringify({
            title: `comments: ${slugTitle}`,
            body: `Comment thread for \`${slugTitle}\`\n\n---\n_Managed by Sol AI comment system._`,
            labels: [COMMENT_LABEL]
        })
    });
}

async function addIssueComment(issueNumber, comment) {
    // Body format: [NAME:name] [AVATAR:url] [AMRE] [DATE:iso] [ID:uuid]
    // The [AMRE] flag triggers Amre's special styling on the site
    let prefix = `[NAME:${comment.name}]`;
    if (comment.avatar) prefix += ` [AVATAR:${comment.avatar}]`;
    if (comment.isAmre) prefix += ' [AMRE]';
    prefix += ` [DATE:${comment.date}]`;
    prefix += ` [ID:${comment.id}]`;
    const body = prefix + '\n\n' + comment.message;

    return await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body })
    });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /health
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'thesolai-comments',
        github: GITHUB_TOKEN ? 'configured' : 'missing token',
        uptime: Math.floor(process.uptime()) + 's'
    });
});

// GET /comments/:slug — fetch all comments for a page
app.get('/comments/:slug', async (req, res) => {
    const slug = sanitizeSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'Invalid slug' });

    try {
        // Load from memory first (fast)
        const memoryComments = getComments(slug);

        // Also try to fetch from GitHub Issues (for comments posted before server started)
        let githubComments = [];
        if (GITHUB_TOKEN) {
            try {
                const issue = await findIssue(slug);
                if (issue) {
                    const comments = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issue.number}/comments`);
                    githubComments = comments.map(c => parseIssueComment(c));
                }
            } catch (e) {
                console.warn('GitHub fetch warning:', e.message);
            }
        }

        // Deduplicate by ID — prefer memory over GitHub
        const seen = new Set(memoryComments.map(c => c.id));
        const merged = [
            ...memoryComments,
            ...githubComments.filter(c => !seen.has(c.id))
        ];

        // Sort by date ascending
        merged.sort((a, b) => new Date(a.date) - new Date(b.date));

        res.json({ slug, count: merged.length, comments: merged });
    } catch (err) {
        console.error('GET /comments error:', err.message);
        res.status(500).json({ error: 'Failed to load comments' });
    }
});

// POST /comment — submit a new comment
app.post('/comment', async (req, res) => {
    const { name, message, slug, pin } = req.body;

    // Validate message
    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > 2000) {
        return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    }

    const cleanSlug = sanitizeSlug(slug);
    if (!cleanSlug) return res.status(400).json({ error: 'Invalid slug' });

    // Validate name
    const cleanName = (name || 'Guest').trim().slice(0, 60);
    if (!cleanName) return res.status(400).json({ error: 'Name is required' });

    // Check if PIN is correct
    let isAmre = false;
    if (pin && pin.length >= 4) {
        const last4 = pin.slice(-4);
        const hash = crypto.createHash('sha256').update(last4).digest('hex');
        isAmre = (hash === AMRE_PIN_HASH);
    }

    // Name blocking — guests cannot use reserved names
    if (!isAmre && isNameBlocked(cleanName)) {
        return res.status(400).json({
            error: 'That name is not available. Choose something else.'
        });
    }

    // Sanitize message — escape HTML to prevent XSS
    const cleanMessage = sanitizeMessage(message.trim());

    // Determine display name and avatar
    const displayName = isAmre ? AMRE_NAME : cleanName;
    const displayAvatar = isAmre ? AMRE_AVATAR : '';

    // Build comment object
    const comment = {
        id: '', // filled by addComment
        slug: cleanSlug,
        name: displayName,
        message: cleanMessage,
        isAmre,
        avatar: displayAvatar,
        date: '' // filled by addComment
    };

    // Store in memory
    const stored = addComment(comment);

    // Post to GitHub Issues if token available
    if (GITHUB_TOKEN) {
        try {
            let issue = await findIssue(cleanSlug);
            if (!issue) issue = await createIssue(cleanSlug);
            const ghComment = await addIssueComment(issue.number, stored);
            // Update issue number in memory
            stored.githubIssueNumber = issue.number;
            stored.githubCommentId = ghComment.id;
            // Re-save with issue number
            const mem = loadMemory();
            const idx = mem[cleanSlug].findIndex(c => c.id === stored.id);
            if (idx !== -1) mem[cleanSlug][idx] = stored;
            saveMemory(mem);
        } catch (e) {
            console.error('GitHub post error (comment still stored locally):', e.message);
        }
    }

    res.json({
        success: true,
        identity: isAmre ? 'amre' : 'guest',
        name: displayName,
        isAmre,
        avatar: displayAvatar,
        id: stored.id,
        message: 'Comment posted'
    });
});

// GET /count/:slug — get comment count for a page (lightweight)
app.get('/count/:slug', (req, res) => {
    const slug = sanitizeSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'Invalid slug' });
    const comments = getComments(slug);
    res.json({ slug, count: comments.length });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeSlug(slug) {
    if (!slug || typeof slug !== 'string') return null;
    // Remove path traversal, limit length
    const clean = slug.replace(/\.\./g, '').replace(/\//g, '-').trim().slice(0, 100);
    return clean || null;
}

function sanitizeMessage(msg) {
    if (!msg) return '';
    return msg
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .slice(0, 2000);
}

function parseIssueComment(c) {
    // Parse body format: [NAME:name] [AVATAR:url] [AMRE] [DATE:iso] [ID:uuid]
    // Everything after the metadata blocks is the message
    let name = 'Guest';
    let avatar = '';
    let isAmre = false;
    let date = c.created_at;
    let id = '';
    let message = c.body;

    const nameMatch = c.body.match(/^\[NAME:([^\]]+)\]/);
    const avatarMatch = c.body.match(/\[AVATAR:([^\]]+)\]/);
    const amreMatch = c.body.match(/\[AMRE\]/);
    const dateMatch = c.body.match(/\[DATE:([^\]]+)\]/);
    const idMatch = c.body.match(/\[ID:([^\]]+)\]/);

    if (nameMatch) name = nameMatch[1];
    if (avatarMatch) avatar = avatarMatch[1];
    if (amreMatch) isAmre = true;
    if (dateMatch) date = dateMatch[1];
    if (idMatch) id = idMatch[1];

    // Strip metadata prefix from message
    message = c.body
        .replace(/^\[NAME:[^\]]+\]\s*/, '')
        .replace(/\[AVATAR:[^\]]+\]\s*/, '')
        .replace(/\[AMRE\]\s*/, '')
        .replace(/\[DATE:[^\]]+\]\s*/, '')
        .replace(/\[ID:[^\]]+\]\s*/, '')
        .trim();

    return {
        id,
        name,
        avatar,
        isAmre,
        message,
        date,
        githubCommentId: c.id
    };
}

// ─── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`thesolai-comments listening on port ${PORT}`);
    if (!GITHUB_TOKEN) {
        console.error('FATAL: GITHUB_TOKEN not set. Set it in Railway environment variables.');
    } else {
        console.log('GitHub: configured');
        console.log('Memory file:', MEMORY_FILE);
    }
});

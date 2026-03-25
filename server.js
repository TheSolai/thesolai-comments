#!/usr/bin/env node
/**
 * Sol AI Comments — Private Comment Backend
 * =========================================
 * Railway deployment: https://railway.app
 * Repo: github.com/TheSolAI/thesolai-comments (private)
 *
 * Handles: comment submissions, email storage, PIN verification,
 *          GitHub Issues backing, Amre's special identity.
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;   // GitHub PAT
const GITHUB_OWNER = 'TheSolAI';
const GITHUB_REPO  = 'thesolai.github.io';
const COMMENT_LABEL = 'blog-comment';

// Identity
const AMRE_NAME   = 'Amre';
const AMRE_AVATAR = 'https://thesolai.github.io/images/amre-avatar.jpg';
const AMRE_PIN_HASH = crypto.createHash('sha256').update('0620').digest('hex');

// Memory
const DATA_DIR     = path.join(__dirname, 'data');
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');
const EMAILS_FILE   = path.join(DATA_DIR, 'emails.json');

// ─── Init ─────────────────────────────────────────────────────────────────────

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

['data', 'logs'].forEach(d => { if (!fs.existsSync(path.join(__dirname, d))) fs.mkdirSync(path.join(__dirname, d), { recursive: true }); });

// ─── Memory ───────────────────────────────────────────────────────────────────

function loadJSON(file) {
    if (!fs.existsSync(file)) return {};
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
function saveJSON(file, data) {
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); } catch (e) { console.error('Save error:', e.message); }
}

function loadComments()  { return loadJSON(COMMENTS_FILE); }
function saveComments(c) { saveJSON(COMMENTS_FILE, c); }
function loadEmails()   { return loadJSON(EMAILS_FILE); }
function saveEmails(e)  { saveJSON(EMAILS_FILE, e); }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip email domain — amrree@icloud.com → amrree */
function emailToDisplayName(email) {
    if (!email || !email.includes('@')) return null;
    return email.split('@')[0].toLowerCase().trim().slice(0, 60);
}

/** XSS sanitize */
function sanitize(msg) {
    return String(msg)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').slice(0, 2000);
}
function sanitizeSlug(s) {
    if (!s || typeof s !== 'string') return null;
    return s.replace(/\.\./g, '').replace(/\//g, '-').trim().slice(0, 100) || null;
}

// ─── Reserved names (guests cannot claim these) ────────────────────────────────

const RESERVED = new Set(['amre', 'eoghan', 'sol', 'admin', 'anonymous', 'guest', 'moderator', 'owner']);
const BLOCKED_PATTERNS = /\b(fuck|shit|ass|bitch|bastard|cunt|dick|cock|nigger|nigga|slut|whore|faggot|retard|spastic)\b/gi;

function isNameBlocked(name) {
    const l = name.toLowerCase().trim();
    if (RESERVED.has(l)) return true;
    BLOCKED_PATTERNS.lastIndex = 0;
    if (BLOCKED_PATTERNS.test(l)) return true;
    return false;
}

// ─── GitHub API ────────────────────────────────────────────────────────────────

async function gh(path, options = {}) {
    const r = await fetch('https://api.github.com' + path, {
        ...options,
        headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json',
                   'Content-Type': 'application/json', 'User-Agent': 'thesolai-comments/1.0',
                   ...(options.headers || {}) }
    });
    const d = await r.json();
    if (!r.ok) throw new Error(`GitHub ${r.status}: ${JSON.stringify(d).slice(0, 150)}`);
    return d;
}

async function findIssue(slug) {
    const q = encodeURIComponent(`repo:${GITHUB_OWNER}/${GITHUB_REPO} "comments: ${slug}" in:title is:issue state:open`);
    const d = await gh(`/search/issues?q=${q}&per_page=1`);
    return d.items && d.items[0];
}

async function createIssue(slug) {
    return gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, {
        method: 'POST', body: JSON.stringify({
            title: `comments: ${slug}`,
            body: `Comment thread: \`${slug}\`\n_Managed by Sol AI comment system._`,
            labels: [COMMENT_LABEL]
        })
    });
}

async function postIssueComment(issueNumber, comment) {
    // Format: [NAME:name] [AMRE] [DATE:iso] [ID:uuid] [EMAIL:email]
    let prefix = `[NAME:${comment.name}]`;
    if (comment.isAmre) prefix += ' [AMRE]';
    prefix += ` [DATE:${comment.date}] [ID:${comment.id}]`;
    if (comment.email) prefix += ` [EMAIL:${comment.email}]`;
    return gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}/comments`, {
        method: 'POST', body: JSON.stringify({ body: prefix + '\n\n' + comment.message })
    });
}

// ─── Comment operations ─────────────────────────────────────────────────────────

function addComment(c) {
    const all = loadComments();
    if (!all[c.slug]) all[c.slug] = [];
    c.id = crypto.randomUUID();
    c.date = new Date().toISOString();
    all[c.slug].push(c);
    if (all[c.slug].length > 500) all[c.slug] = all[c.slug].slice(-500);
    saveComments(all);
    return c;
}

function getComments(slug) {
    return (loadComments())[slug] || [];
}

// ─── Email operations ───────────────────────────────────────────────────────────

function storeEmail(email, meta = {}) {
    const emails = loadEmails();
    const key = email.toLowerCase();
    emails[key] = { email, added: new Date().toISOString(), ...meta };
    saveEmails(emails);
}

function isEmailStored(email) {
    return email && loadEmails().hasOwnProperty(email.toLowerCase());
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET / — health
app.get('/', (req, res) => {
    res.json({
        status: 'ok', service: 'thesolai-comments',
        github: GITHUB_TOKEN ? 'configured' : 'MISSING TOKEN',
        uptime: Math.floor(process.uptime()) + 's',
        comments: Object.values(loadComments()).flat().length
    });
});

// GET /comments/:slug
app.get('/comments/:slug', async (req, res) => {
    const slug = sanitizeSlug(req.params.slug);
    if (!slug) return res.status(400).json({ error: 'Invalid slug' });

    try {
        let comments = getComments(slug);

        // Sync from GitHub if we have a token (for pre-server comments)
        if (GITHUB_TOKEN && comments.length === 0) {
            try {
                const issue = await findIssue(slug);
                if (issue) {
                    const ghComments = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issue.number}/comments`);
                    for (const c of ghComments.reverse()) {
                        const parsed = parseIssueComment(c);
                        if (!comments.find(x => x.id === parsed.id)) comments.push(parsed);
                    }
                }
            } catch (e) { console.warn('GitHub sync:', e.message); }
        }

        comments.sort((a, b) => new Date(a.date) - new Date(b.date));
        res.json({ slug, count: comments.length, comments });
    } catch (err) {
        console.error('GET /comments error:', err.message);
        res.status(500).json({ error: 'Failed to load comments' });
    }
});

// POST /comment
app.post('/comment', async (req, res) => {
    const { name, message, slug, pin, email } = req.body;

    if (!message || !message.trim())  return res.status(400).json({ error: 'Message is required' });
    if (message.length > 2000)       return res.status(400).json({ error: 'Message too long (max 2000)' });
    const cleanSlug = sanitizeSlug(slug);
    if (!cleanSlug)                  return res.status(400).json({ error: 'Invalid slug' });

    // ── Email ──
    // If email provided, store it. Used for blocking/reference.
    // The email address is stored but NEVER exposed via the API.
    if (email && typeof email === 'string' && email.includes('@')) {
        storeEmail(email.trim(), { slug: cleanSlug });
    } else if (email) {
        return res.status(400).json({ error: 'Invalid email address' });
    }

    // ── Identity ──
    // Check PIN: last 4 digits of whatever is entered
    let isAmre = false;
    if (pin && pin.length >= 4) {
        const hash = crypto.createHash('sha256').update(pin.slice(-4)).digest('hex');
        isAmre = (hash === AMRE_PIN_HASH);
    }

    // ── Name resolution ──
    // If Amre (PIN correct): use her name regardless of what was typed
    // If email provided but no name: use email username as display name
    // If name typed: use it (after checking it's not reserved)
    let displayName;
    if (isAmre) {
        displayName = AMRE_NAME;
    } else if (name && name.trim()) {
        const n = name.trim().slice(0, 60);
        if (isNameBlocked(n)) return res.status(400).json({ error: 'That name is not available. Choose something else.' });
        displayName = n;
    } else if (email) {
        const derived = emailToDisplayName(email);
        if (!derived) return res.status(400).json({ error: 'Could not derive name from email.' });
        displayName = derived;
    } else {
        return res.status(400).json({ error: 'Name or email is required.' });
    }

    const comment = {
        id: '', slug: cleanSlug,
        name: displayName,
        message: sanitize(message.trim()),
        isAmre, email: email || null,
        avatar: isAmre ? AMRE_AVATAR : '',
        date: ''
    };

    const stored = addComment(comment);

    // ── GitHub ──
    if (GITHUB_TOKEN) {
        try {
            let issue = await findIssue(cleanSlug);
            if (!issue) issue = await createIssue(cleanSlug);
            const ghComment = await postIssueComment(issue.number, stored);
            stored.githubIssueNumber = issue.number;
            stored.githubCommentId = ghComment.id;
            const all = loadComments();
            const idx = all[cleanSlug].findIndex(c => c.id === stored.id);
            if (idx !== -1) all[cleanSlug][idx] = stored;
            saveComments(all);
        } catch (e) { console.error('GitHub post error:', e.message); }
    }

    res.json({
        success: true, identity: isAmre ? 'amre' : 'guest',
        name: displayName, isAmre,
        avatar: stored.avatar, id: stored.id,
        message: 'Comment posted'
    });
});

// GET /emails — admin only (returns email count, not addresses)
app.get('/emails', (req, res) => {
    const emails = loadEmails();
    res.json({ count: Object.keys(emails).length });
});

// ─── Parse GitHub Issue comment ───────────────────────────────────────────────

function parseIssueComment(c) {
    let name = 'Guest', avatar = '', isAmre = false, date = c.created_at, id = '', ghEmail = null;
    let msg = c.body;

    ['NAME', 'AVATAR', 'AMRE', 'DATE', 'ID', 'EMAIL'].forEach(field => {
        const re = new RegExp(`\\[${field}:([^\\]]+)\\]`);
        const m = msg.match(re);
        if (!m) return;
        if (field === 'NAME') name = m[1];
        else if (field === 'AVATAR') avatar = m[1];
        else if (field === 'AMRE') isAmre = true;
        else if (field === 'DATE') date = m[1];
        else if (field === 'ID') id = m[1];
        else if (field === 'EMAIL') ghEmail = m[1];
    });

    msg = msg.replace(/^\[NAME:[^\]]+\]\s*/, '')
             .replace(/\[AVATAR:[^\]]+\]\s*/, '').replace(/\[AMRE\]\s*/, '')
             .replace(/\[DATE:[^\]]+\]\s*/, '').replace(/\[ID:[^\]]+\]\s*/, '')
             .replace(/\[EMAIL:[^\]]+\]\s*/, '').trim();

    return { id, name, avatar, isAmre, message: msg, date, email: ghEmail };
}

// ─── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] thesolai-comments started on :${PORT}`);
    if (!GITHUB_TOKEN) console.error('FATAL: GITHUB_TOKEN env var not set');
    else console.log('GitHub: connected');
});

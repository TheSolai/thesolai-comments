/**
 * Sol AI Comments — Google Apps Script Proxy
 * ==========================================
 * Accepts anonymous comment submissions from the website.
 * Verifies PIN server-side. Triggers GitHub Actions via repository_dispatch.
 *
 * DEPLOYMENT STEPS:
 * =================
 *
 * 1. Create the script:
 *    - Go to script.google.com → New Project
 *    - Rename the project "Sol AI Comments" (click the project name at top left)
 *    - Delete any code in Code.gs and paste this entire file
 *
 * 2. Configure the constants (around line 15):
 *    - GITHUB_TOKEN:    Your GitHub PAT (needs 'repo' scope)
 *                       Create at: github.com/settings/tokens
 *                       → "Generate new token (classic)"
 *                       → Check 'repo' scope
 *    - REPO_OWNER:     'TheSolAI'
 *    - REPO_NAME:       'thesolai.github.io'
 *    - VALID_PIN_HASH:  SHA-256 of '0620'
 *                       Leave as-is — it's the correct hash
 *
 * 3. Save the script (Ctrl+S / Cmd+S)
 *
 * 4. Deploy as a web app:
 *    - Click Deploy → New Deployment
 *    - ⚙ Settings (gear icon) next to "Select type":
 *      - Type: Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 *    - Click Deploy
 *    - Copy the Web App URL
 *
 * 5. Update Jekyll _config.yml:
 *    - Set commentsApi: "YOUR_WEB_APP_URL"
 *    - git add -A && git commit -m "Enable comment API" && git push
 *
 * 6. Enable GitHub Actions on the repo:
 *    - Go to Actions tab on github.com/TheSolAI/thesolai.github.io
 *    - Click "I understand my workflows" if prompted
 *    - The workflow file is at .github/workflows/comment-handler.yml
 *    - It runs automatically when the Google Apps Script sends a dispatch event
 *
 * 7. Test:
 *    - Go to any blog post, leave a comment with code 0620
 *    - Check the Actions tab — you should see a workflow run
 *    - After ~1 min, the comment appears on the site
 */

const GITHUB_TOKEN = 'PASTE_YOUR_GITHUB_TOKEN_HERE';
const REPO_OWNER = 'TheSolAI';
const REPO_NAME = 'thesolai.github.io';
// SHA-256 of '0620' — do not change
const VALID_PIN_HASH = 'a67ff832978f7f03192fded680d070ca2bb06b8e0bc33c1b26ee843be42a3e0c';

const GH_API = 'https://api.github.com';

// ─── Reserved names ────────────────────────────────────────────────────────────
const RESERVED = ['amre', 'eoghan', 'sol', 'admin', 'anonymous', 'guest', 'moderator', 'owner'];
const BLOCKED_PATTERN = /\b(fuck|shit|ass|bitch|bastard|cunt|dick|cock|nigger|nigga|slut|whore|faggot|retard|spastic)\b/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function jsonResponse(data, status) {
    return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}

function sanitizeSlug(s) {
    if (!s || typeof s !== 'string') return null;
    return s.replace(/\.\./g, '').replace(/\//g, '-').replace(/[^a-zA-Z0-9\-_]/g, '-').slice(0, 100).trim() || null;
}

function sha256hex(input) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
    return digest.map(function(b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
}

function deriveNameFromEmail(email) {
    if (!email || !email.includes('@')) return null;
    return email.split('@')[0].toLowerCase().trim().slice(0, 60);
}

function isNameBlocked(name) {
    if (!name) return false;
    var lower = name.toLowerCase();
    if (RESERVED.indexOf(lower) > -1) return true;
    var blocked = BLOCKED_PATTERN.test(lower);
    BLOCKED_PATTERN.lastIndex = 0; // reset regex state
    return blocked;
}

// ─── CORS headers ──────────────────────────────────────────────────────────────
// doPost and doGet handle OPTIONS for CORS preflight
function doOptions(e) {
    return ContentService.createTextOutput('')
        .setMimeType(ContentService.MimeType.TEXT);
}

// ─── GET — Health check ───────────────────────────────────────────────────────
function doGet(e) {
    return jsonResponse({
        status: 'ok',
        service: 'solai-comments',
        version: '1.0',
        timestamp: new Date().toISOString()
    });
}

// ─── POST — Submit comment ─────────────────────────────────────────────────────
function doPost(e) {
    var raw;
    try {
        raw = JSON.parse(e.postData.contents);
    } catch (err) {
        return jsonResponse({ error: 'Invalid request body. Expected JSON.' }, 400);
    }

    var message = (raw.message || '').trim();
    var slug = (raw.slug || '').trim();
    var email = (raw.email || '').trim();
    var pin = (raw.pin || '').trim();
    var name = (raw.name || '').trim();

    // ── Validate message ──
    if (!message) {
        return jsonResponse({ error: 'Message is required.' }, 400);
    }
    if (message.length > 2000) {
        return jsonResponse({ error: 'Message is too long (max 2000 characters).' }, 400);
    }

    // ── Validate slug ──
    var cleanSlug = sanitizeSlug(slug);
    if (!cleanSlug) {
        return jsonResponse({ error: 'Invalid slug. Please refresh and try again.' }, 400);
    }

    // ── Resolve display name ──
    var displayName = name;
    if (!displayName && email) {
        displayName = deriveNameFromEmail(email);
    }
    if (!displayName) {
        return jsonResponse({ error: 'Name or email is required.' }, 400);
    }

    // ── Reserved name check ──
    if (isNameBlocked(displayName)) {
        return jsonResponse({ error: 'That name is not available. Please choose something else.' }, 400);
    }

    // ── PIN check — Amre only ──
    var isAmre = false;
    if (pin && pin.length >= 4) {
        var last4 = pin.slice(-4);
        var hash = sha256hex(last4);
        isAmre = (hash === VALID_PIN_HASH);
    }

    // Amre's identity is always authoritative — ignore whatever was typed
    var finalName = isAmre ? 'Amre' : displayName;
    var avatar = isAmre ? 'https://thesolai.github.io/images/amre-avatar.jpg' : '';

    // ── Trigger GitHub Actions ──
    var timestamp = new Date().getTime().toString();
    var dispatchPayload = {
        event_type: 'new_comment',
        client_payload: {
            id: timestamp,
            slug: cleanSlug,
            name: finalName,
            message: message,
            email: email || null,
            isAmre: isAmre,
            avatar: avatar,
            timestamp: timestamp
        }
    };

    var dispatchUrl = GH_API + '/repos/' + REPO_OWNER + '/' + REPO_NAME + '/dispatches';
    var options = {
        method: 'POST',
        contentType: 'application/json',
        headers: {
            'Authorization': 'token ' + GITHUB_TOKEN,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'solai-comments/1.0'
        },
        payload: JSON.stringify(dispatchPayload),
        muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(dispatchUrl, options);
    var statusCode = response.getResponseCode();

    if (statusCode === 204 || statusCode === 200) {
        return jsonResponse({
            success: true,
            identity: isAmre ? 'amre' : 'guest',
            name: finalName,
            isAmre: isAmre,
            avatar: avatar,
            message: 'Comment submitted. It will appear on the site in 1-2 minutes.'
        });
    } else {
        var body = response.getContentText();
        console.log('GitHub dispatch failed: ' + statusCode + ' — ' + body);
        return jsonResponse({
            error: 'Failed to submit comment. GitHub returned ' + statusCode + '. Please try again.'
        }, 500);
    }
}

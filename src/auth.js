const config = require('./config');

// Shown instead of the real page until a correct password is stored in the
// dashKey cookie; the reload then fetches the dashboard proper
const AUTH_STUB_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Telephone dashboard</title></head>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b0e14;color:#e6ebf5;font-family:sans-serif">
<script>
    var key = prompt('Dashboard password');
    document.cookie = 'dashKey=' + encodeURIComponent(key || '') + '; path=/; SameSite=Lax';
    location.reload();
</script></body></html>`;

function getCookie(req, name) {
    const header = req.headers.cookie;
    if (!header) return null;

    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
    }
    return null;
}

// Single shared-password gate for the dashboard: accepts the dashKey cookie
// (set by the prompt stub above) or a ?key= parameter for scripted access.
// Cookies ignore ports, so one entry on the HTTP port also unlocks the
// WebSocket on its own port.
function isAuthorized(req) {
    const expected = config.DASHBOARD_PASSWORD;
    if (!expected) return true;

    if (getCookie(req, 'dashKey') === expected) return true;

    try {
        if (new URL(req.url ?? '/', 'http://localhost').searchParams.get('key') === expected) return true;
    } catch {}

    return false;
}

module.exports = { isAuthorized, AUTH_STUB_HTML };

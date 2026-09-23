const http = require('http');
const fs = require('fs');
const path = require('path');
const { isAuthorized, AUTH_STUB_HTML } = require('./auth');

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

// Minimal static file server for the dashboard page: GET / serves index.html
function createWebServer({ port, host = '0.0.0.0', staticDir, logger = console }) {
    const root = path.resolve(staticDir);

    const server = http.createServer((req, res) => {
        if (req.method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Method not allowed');
            return;
        }

        // Password gate: wrong/no cookie gets the prompt page instead
        if (!isAuthorized(req)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(AUTH_STUB_HTML);
            return;
        }

        const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
        const filePath = path.resolve(root, relative);

        // Never serve anything outside of staticDir
        if (filePath !== root && !filePath.startsWith(root + path.sep)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Forbidden');
            return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not found');
                return;
            }

            const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': type });
            res.end(data);
        });
    });

    server.on('error', (err) => {
        logger.error(`[web] Server error: ${err.message}`);
    });

    server.listen(port, host, () => {
        const { address, port: boundPort } = server.address();
        logger.info(`[web] Serving ${root} on http://${address}:${boundPort}`);
    });

    return {
        close(callback) {
            server.close(callback);
        },
    };
}

module.exports = { createWebServer };

const http = require('http');
const { WebSocketServer, OPEN } = require('ws');

function createDashboard({ getPhones, port, broadcastIntervalMs = 2_000, getTestCall = null, onCommand = null, logger = console, isAuthorized = null }) {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        if (isAuthorized && !isAuthorized(req)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });

    server.on('listening', () => {
        logger.info(`[ws] Dashboard on ws://localhost:${port}`);
    });

    server.on('error', (err) => {
        logger.error(`[ws] Dashboard error: ${err.message}`);
    });

    wss.on('connection', (ws) => {
        logger.info(`[ws] Dashboard client connected (${wss.clients.size} open)`);
        ws.on('close', () => logger.info(`[ws] Dashboard client disconnected (${wss.clients.size} open)`));

        ws.on('message', (raw) => {
            if (!onCommand) return;
            try {
                onCommand(JSON.parse(raw.toString()));
            } catch (err) {
                logger.error(`[ws] Bad dashboard command: ${err.message}`);
            }
        });
    });

    function broadcast() {
        if (wss.clients.size === 0) return;

        const payload = JSON.stringify({
            phones: getPhones(),
            testCall: getTestCall ? getTestCall() : null,
        });
        for (const client of wss.clients) {
            if (client.readyState === OPEN) client.send(payload);
        }
    }

    const broadcastTimer = setInterval(broadcast, broadcastIntervalMs);

    server.listen(port);

    return {
        broadcast,
        close(callback) {
            clearInterval(broadcastTimer);
            for (const client of wss.clients) client.terminate();
            server.close(callback);
        },
    };
}

module.exports = { createDashboard };

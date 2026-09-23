const path = require('path');
const config = require('./config');
const { PhoneRegistry } = require('./phoneRegistry');
const { createUdpServer } = require('./udpServer');
const { createDashboard } = require('./dashboard');
const { createWebServer } = require('./webServer');
const { isAuthorized } = require('./auth');
const { CallManager } = require('./callManager');

const phoneRegistry = new PhoneRegistry({
    timeoutMs: config.KEEP_ALIVE_TIMEOUT_MS,
    onDisconnect: (phone) => {
        console.warn(`[registry] Phone #${phone.number} marked disconnected (keep-alive timeout)`);
    },
});

const udp = createUdpServer({
    phoneRegistry,
    port: config.UDP_PORT,
    host: config.UDP_HOST,
    onPhoneEnd: (phone) => {
        callManager.onPhoneEnd(phone); // relays END to the peer, then clears the pairing
        dashboard.broadcast();
    },
    onPhoneAccept: (phone) => {
        callManager.onPhoneAccept(phone);
        dashboard.broadcast();
    },
    onPhoneAudio: (phone, msg) => {
        callManager.onPhoneAudio(phone, msg);
    },
    onPhoneCall: (phone, call) => {
        callManager.onPhoneCall(phone, call);
        dashboard.broadcast();
    },
});

const callManager = new CallManager({
    udpSend: (phone, buffer) => udp.sendToPhone(phone, buffer),
    registry: phoneRegistry,
});

const web = createWebServer({
    port: config.HTTP_PORT,
    host: config.UDP_HOST,
    staticDir: path.join(__dirname, '..', 'frontend'),
});

const dashboard = createDashboard({
    getPhones: () => phoneRegistry.all,
    getTestCall: () => callManager.testStatus,
    port: config.WS_PORT,
    broadcastIntervalMs: config.DASHBOARD_INTERVAL_MS,
    isAuthorized,
    onCommand: (msg) => {
        if (msg.type !== 'test-call') return;

        if (msg.action === 'start') {
            callManager.startTestCall(msg.target);
        } else if (msg.action === 'stop') {
            callManager.stopTestCall();
        }
        dashboard.broadcast();
    },
});

let changeScheduled = false;
phoneRegistry.on('change', () => {
    if (changeScheduled) return;
    changeScheduled = true;
    setImmediate(() => {
        changeScheduled = false;
        dashboard.broadcast();
    });
});

const sweepTimer = setInterval(() => {
    phoneRegistry.markDisconnected();
}, config.DISCONNECT_CHECK_INTERVAL_MS);

function shutdown(signal) {
    console.log(`\n[server] Received ${signal}, shutting down...`);
    clearInterval(sweepTimer);
    dashboard.close();
    web.close();
    udp.close(() => {
        console.log('[server] Bye');
        process.exit(0);
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

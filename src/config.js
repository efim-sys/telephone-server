const path = require('path');

module.exports = {
    UDP_PORT: 4911,
    UDP_HOST: '0.0.0.0',

    WS_PORT: 4912,

    // Plain HTTP server serving the dashboard page
    HTTP_PORT: 4913,

    // Dashboard gate: one shared password (any browser dialog), also required
    // by the WebSocket. Empty string disables the protection.
    DASHBOARD_PASSWORD: '323Dffm5xsS_',

    // Wire format: raw battery byte / BATTERY_DIVISOR = voltage
    BATTERY_DIVISOR: 50,

    // Mark a phone as disconnected if no keep-alive arrives within this window
    KEEP_ALIVE_TIMEOUT_MS: 60_000,
    DISCONNECT_CHECK_INTERVAL_MS: 10_000,

    // How often the dashboard is refreshed over WebSocket
    DASHBOARD_INTERVAL_MS: 2_000,

    // Test-call feature: the dashboard can ask the server to call from this
    // "special" number; a random song from SONGS_DIR is streamed until it ends
    TEST_CALL_NUMBER: 1303,
    SONGS_DIR: path.join(__dirname, '..', 'songs'),

    // Incoming-call feature: a phone dialing this number (012 on the dial)
    // reaches the server itself; after a short "ringing" delay the server
    // sends MSG_ACCEPT and streams a random song
    INCOMING_CALL_NUMBER: 12,
    INCOMING_CALL_ACCEPT_DELAY_MS: 5_000,

    // Numbers below this are utility services served by the server itself
    // (e.g. 012 = music); numbers at or above it belong to real phones and
    // calls to them are forwarded to the target telephone
    UTILITY_NUMBER_MAX: 20,

    // 16000 Hz * 2 bytes mono = 32000 B/s; 32000 / 1280-byte chunks = 25 pkt/s
    AUDIO_PACKET_INTERVAL_MS: 40,
};

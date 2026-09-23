const { EventEmitter } = require('events');
const { PHONE_STATES } = require('./protocol');

class PhoneRegistry extends EventEmitter {
    constructor({ timeoutMs = 10_000, onDisconnect = null } = {}) {
        super();
        this.phones = new Map();
        this.timeoutMs = timeoutMs;
        this.onDisconnect = onDisconnect;
    }

    get all() {
        return Array.from(this.phones.values());
    }

    get size() {
        return this.phones.size;
    }

    has(number) {
        return this.phones.has(number);
    }

    get(number) {
        return this.phones.get(number);
    }

    findByAddress(address, port) {
        for (const phone of this.phones.values()) {
            if (phone.address === address && phone.port === port) return phone;
        }
        return null;
    }

    setCall(number, peerNumber) {
        const phone = this.phones.get(number);
        if (!phone) return;

        phone.targetNumber = peerNumber;
        this.emit('change', phone);
    }

    clearCall(number) {
        const phone = this.phones.get(number);
        if (!phone || phone.targetNumber === null) return;

        phone.targetNumber = null;
        this.emit('change', phone);
    }

    upsert(number, { address, port, state, batteryVolts }) {
        let phone = this.phones.get(number);
        if (!phone) {
            phone = this.create(number);
            this.phones.set(number, phone);
        }

        phone.address = address;
        phone.port = port;
        phone.state = state;
        phone.batteryVolts = batteryVolts;
        phone.lastSeen = Date.now();

        this.emit('change', phone);

        return phone;
    }

    create(number) {
        return {
            number,
            address: null,                     // Current IP-address
            port: null,                        // Current UDP port
            state: PHONE_STATES.DISCONNECTED,  // Current phone status
            targetNumber: null,                // Number of the peer in the current call
            lastSeen: null,                    // Timestamp of the last keep-alive
            batteryVolts: null,                // Battery voltage
        };
    }

    markDisconnected(now = Date.now()) {
        for (const phone of this.phones.values()) {
            if (phone.state === PHONE_STATES.DISCONNECTED) continue;
            if (phone.lastSeen === null) continue;

            if (now - phone.lastSeen >= this.timeoutMs) {
                phone.state = PHONE_STATES.DISCONNECTED;
                this.onDisconnect?.(phone);
                this.emit('change', phone);
            }
        }
    }
}

module.exports = { PhoneRegistry };

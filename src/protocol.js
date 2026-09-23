const config = require('./config');

const MSG_TYPE = {
    STATUS: 0x00,          // Tel -> Srv: phone status
    AUDIO: 0x01,           // Tel <-> Srv: audio data

    CALL: 0x10,            // Tel -> Srv: I want to call || Srv -> Tel: Incoming call
    HANG_UP: 0x11,         // Tel -> Srv: I hanged up || Srv -> Tel: the target hanged up
    HOLD: 0x12,
    DIGIT: 0x13,           // Tel -> Srv: digit entered
    RINGING: 0x14,         // Tel -> Srv: I am ringing || Srv -> Tel: Ringing in progress... wait

    WRONG_NUM: 0x20,       // Srv -> Tel: Number does not exist
    BUSY: 0x21,            // Srv -> Tel: Target is talking right now
    UNAVAILABLE: 0x22,     // Srv -> Tel: Target is not available

    OK: 0x30,              // Srv -> Tel: acknowledge (1 byte)
    END: 0x31,             // Srv -> Tel: end call (1 byte)
    ACCEPT: 0x32           // Tel <-> Srv: call was accepted (1 byte)
};

const PHONE_STATES = {
    DISCONNECTED: 0x00,
    IDLE: 0x10,             // Handset on the hook
    READY: 0x20,            // Handset lifted (possibly dialing)
    TALKING: 0x30           // In a call
};

const TYPE_OFFSET = 0;
const NUMBER_OFFSET = 1;
const STATE_OFFSET = 3;
const BATTERY_OFFSET = 4;
const STATUS_PACKET_LENGTH = 5;

// Call_msg: uint8 type, uint16 phoneNumber (LE), uint8 encryption
const CALL_PACKET_LENGTH = 4;
const CALL_ENCRYPTION_OFFSET = 3;

// Accept_msg: uint8 type
const ACCEPT_PACKET_LENGTH = 1;

// Wrong_num_msg / Busy_msg / Unavailable_msg: uint8 type
const SINGLE_BYTE_PACKET_LENGTH = 1;

// Audio_msg: uint8 type, uint32 timestamp (LE, packet number), int16 data[AUDIO_SIZE/2]
const AUDIO_SIZE = 1280;
const AUDIO_PACKET_LENGTH = 5 + AUDIO_SIZE;
const AUDIO_TIMESTAMP_OFFSET = 1;
const AUDIO_DATA_OFFSET = 5;

function parseStatusPacket(msg) {
    if (!Buffer.isBuffer(msg)) {
        throw new TypeError('Status packet must be a Buffer');
    }
    if (msg.length < STATUS_PACKET_LENGTH) {
        throw new RangeError(`Status packet too short: ${msg.length} bytes (need ${STATUS_PACKET_LENGTH})`);
    }

    const batteryRaw = msg.readUInt8(BATTERY_OFFSET);

    return {
        phoneNumber: msg.readUInt16LE(NUMBER_OFFSET),
        state: msg.readUInt8(STATE_OFFSET),
        batteryVolts: batteryRaw / config.BATTERY_DIVISOR,
    };
}

function buildStatusPacket({ phoneNumber, state, batteryVolts }) {
    if (!Number.isInteger(phoneNumber) || phoneNumber < 0 || phoneNumber > 0xffff) {
        throw new RangeError(`phoneNumber out of range for uint16: ${phoneNumber}`);
    }

    const buf = Buffer.alloc(STATUS_PACKET_LENGTH);
    buf.writeUInt8(MSG_TYPE.STATUS, TYPE_OFFSET);
    buf.writeUInt16LE(phoneNumber, NUMBER_OFFSET);
    buf.writeUInt8(state, STATE_OFFSET);
    buf.writeUInt8(Math.round(batteryVolts * config.BATTERY_DIVISOR), BATTERY_OFFSET);

    return buf;
}

function buildCallPacket({ phoneNumber, encryption = 0 }) {
    if (!Number.isInteger(phoneNumber) || phoneNumber < 0 || phoneNumber > 0xffff) {
        throw new RangeError(`phoneNumber out of range for uint16: ${phoneNumber}`);
    }
    if (!Number.isInteger(encryption) || encryption < 0 || encryption > 0xff) {
        throw new RangeError(`encryption out of range for uint8: ${encryption}`);
    }

    const buf = Buffer.alloc(CALL_PACKET_LENGTH);
    buf.writeUInt8(MSG_TYPE.CALL, TYPE_OFFSET);
    buf.writeUInt16LE(phoneNumber, NUMBER_OFFSET);
    buf.writeUInt8(encryption, CALL_ENCRYPTION_OFFSET);

    return buf;
}

function parseCallPacket(msg) {
    if (!Buffer.isBuffer(msg)) {
        throw new TypeError('Call packet must be a Buffer');
    }
    if (msg.length < CALL_PACKET_LENGTH) {
        throw new RangeError(`Call packet too short: ${msg.length} bytes (need ${CALL_PACKET_LENGTH})`);
    }

    return {
        phoneNumber: msg.readUInt16LE(NUMBER_OFFSET),
        encryption: msg.readUInt8(CALL_ENCRYPTION_OFFSET),
    };
}

// End_msg: uint8 type
const END_PACKET_LENGTH = 1;

function buildEndPacket() {
    const buf = Buffer.alloc(END_PACKET_LENGTH);
    buf.writeUInt8(MSG_TYPE.END, TYPE_OFFSET);

    return buf;
}

function buildAcceptPacket() {
    const buf = Buffer.alloc(ACCEPT_PACKET_LENGTH);
    buf.writeUInt8(MSG_TYPE.ACCEPT, TYPE_OFFSET);

    return buf;
}

function buildSingleBytePacket(type) {
    if (!Number.isInteger(type) || type < 0 || type > 0xff) {
        throw new RangeError(`type out of range for uint8: ${type}`);
    }

    const buf = Buffer.alloc(SINGLE_BYTE_PACKET_LENGTH);
    buf.writeUInt8(type, TYPE_OFFSET);

    return buf;
}

function buildAudioPacket(seq, pcm) {
    if (!Number.isInteger(seq) || seq < 0 || seq > 0xffffffff) {
        throw new RangeError(`seq out of range for uint32: ${seq}`);
    }
    if (!Buffer.isBuffer(pcm)) {
        throw new TypeError('Audio payload must be a Buffer');
    }

    const buf = Buffer.alloc(AUDIO_PACKET_LENGTH);
    buf.writeUInt8(MSG_TYPE.AUDIO, TYPE_OFFSET);
    buf.writeUInt32LE(seq, AUDIO_TIMESTAMP_OFFSET);
    pcm.copy(buf, AUDIO_DATA_OFFSET, 0, Math.min(pcm.length, AUDIO_SIZE)); // zero-pads short tail

    return buf;
}

module.exports = {
    MSG_TYPE,
    PHONE_STATES,
    AUDIO_SIZE,
    parseStatusPacket,
    parseCallPacket,
    buildStatusPacket,
    buildCallPacket,
    buildAcceptPacket,
    buildSingleBytePacket,
    buildEndPacket,
    buildAudioPacket,
};

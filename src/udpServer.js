const dgram = require('dgram');
const { MSG_TYPE, parseStatusPacket, parseCallPacket } = require('./protocol');

function createUdpServer({ phoneRegistry, port, host = '0.0.0.0', logger = console, onPhoneEnd = null, onPhoneAccept = null, onPhoneCall = null, onPhoneAudio = null }) {
    const socket = dgram.createSocket('udp4');

    socket.on('message', (msg, rinfo) => {
        if (msg.length < 1) return;

        const type = msg.readUInt8(0);

        try {
            switch (type) {
                case MSG_TYPE.STATUS:
                    handleStatus(msg, rinfo);
                    break;
                case MSG_TYPE.CALL:
                    handleCall(msg, rinfo);
                    break;
                case MSG_TYPE.END:
                    handleEnd(rinfo);
                    break;
                case MSG_TYPE.ACCEPT:
                    handleAccept(rinfo);
                    break;
                case MSG_TYPE.AUDIO:
                    handleAudio(rinfo, msg);
                    break;
                default:
                    logger.error(`[udp] Unknown message type: 0x${type.toString(16)} from ${rinfo.address}:${rinfo.port}`);
            }
        } catch (err) {
            logger.error(`[udp] Failed to process type 0x${type.toString(16)} from ${rinfo.address}:${rinfo.port}: ${err.message}`);
            return;
        }

        ack(socket, rinfo, logger);
    });

    socket.on('error', (err) => {
        logger.error(`[udp] Socket error: ${err.message}`);
    });

    socket.on('listening', () => {
        const { address, port: boundPort } = socket.address();
        logger.info(`[udp] Listening on udp://${address}:${boundPort}`);
    });

    socket.bind(port, host);

    function handleStatus(msg, rinfo) {
        const status = parseStatusPacket(msg);

        const phone = phoneRegistry.upsert(status.phoneNumber, {
            address: rinfo.address,
            port: rinfo.port,
            state: status.state,
            batteryVolts: status.batteryVolts,
        });

        logger.info(
            `[udp] status #${phone.number} -> state=0x${phone.state.toString(16)}, ` +
            `bat=${phone.batteryVolts.toFixed(2)}V, ${phone.address}:${phone.port} ` +
            `(${phoneRegistry.size} registered)`
        );
    }

    function handleEnd(rinfo) {
        const phone = phoneRegistry.findByAddress(rinfo.address, rinfo.port);
        if (!phone) {
            logger.warn(`[udp] END from unregistered source ${rinfo.address}:${rinfo.port}`);
            return;
        }

        logger.info(`[udp] <- #${phone.number}: end call`);
        onPhoneEnd?.(phone);
    }

    function handleCall(msg, rinfo) {
        const call = parseCallPacket(msg);

        const phone = phoneRegistry.findByAddress(rinfo.address, rinfo.port);
        if (!phone) {
            logger.warn(`[udp] CALL to #${call.phoneNumber} from unregistered source ${rinfo.address}:${rinfo.port}`);
            return;
        }

        logger.info(`[udp] <- #${phone.number}: call #${call.phoneNumber}`);
        onPhoneCall?.(phone, call);
    }

    function handleAccept(rinfo) {
        const phone = phoneRegistry.findByAddress(rinfo.address, rinfo.port);
        if (!phone) {
            logger.warn(`[udp] ACCEPT from unregistered source ${rinfo.address}:${rinfo.port}`);
            return;
        }

        logger.info(`[udp] <- #${phone.number}: call accepted`);
        onPhoneAccept?.(phone);
    }

    function handleAudio(rinfo, msg) {
        const phone = phoneRegistry.findByAddress(rinfo.address, rinfo.port);
        if (!phone) return; // stay silent: stray audio arrives at packet rate

        onPhoneAudio?.(phone, msg);
    }

    function sendToPhone(phone, buffer) {
        if (!phone || !phone.address || !phone.port) {
            logger.error(`[udp] Cannot send: target ${phone?.number ?? '?'} has no address/port`);
            return;
        }

        socket.send(buffer, phone.port, phone.address, (err) => {
            if (err) logger.error(`[udp] Failed to send to #${phone.number} @ ${phone.address}:${phone.port}: ${err.message}`);
        });
    }

    return {
        sendToPhone,
        close(callback) {
            socket.close(callback);
        },
    };
}

function ack(socket, rinfo, logger) {
    const reply = Buffer.from([MSG_TYPE.OK]);
    socket.send(reply, rinfo.port, rinfo.address, (err) => {
        if (err) logger.error(`[udp] Failed to ack ${rinfo.address}:${rinfo.port}: ${err.message}`);
    });
}

module.exports = { createUdpServer };

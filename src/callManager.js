const fs = require('fs');
const path = require('path');
const config = require('./config');
const { PHONE_STATES, MSG_TYPE, AUDIO_SIZE, buildCallPacket, buildAcceptPacket, buildSingleBytePacket, buildEndPacket, buildAudioPacket } = require('./protocol');

// Standard RIFF/WAVE header size; PCM data starts right after it
const WAV_HEADER_SIZE = 44;

class CallManager {
    constructor({ udpSend, registry, logger = console }) {
        this.udpSend = udpSend;
        this.registry = registry;
        this.logger = logger;

        // Receiving phone number -> session. Every call lives in its own
        // session with private timers/PCM cursor, so many phones can be
        // streamed to at the same time.
        this.sessions = new Map();
    }

    // Dashboard payload. The flat fields mirror the most recent session so the
    // existing UI keeps working; every live call is listed in `sessions`.
    get testStatus() {
        const list = [...this.sessions.values()].sort((a, b) => b.startedAt - a.startedAt);
        const latest = list[0] ?? null;

        return {
            active: latest !== null,
            waitingForAccept: latest ? latest.waitingForAccept : false,
            target: latest ? latest.targetNumber : null,
            startedAt: latest ? latest.startedAt : null,
            song: latest ? latest.songName : null,
            packetIntervalMs: config.AUDIO_PACKET_INTERVAL_MS,
            sessions: list.map((s) => ({
                target: s.targetNumber,
                incoming: s.isIncoming,
                waitingForAccept: s.waitingForAccept,
                startedAt: s.startedAt,
                song: s.songName,
            })),
        };
    }

    // Dashboard-initiated call: CALL from TEST_CALL_NUMBER; playback starts
    // once the target phone replies with MSG_ACCEPT
    startTestCall(targetNumber) {
        const target = this.registry.get(targetNumber);
        if (!target || target.state === PHONE_STATES.DISCONNECTED) {
            this.logger.warn(`[calls] Test call refused: target #${targetNumber} is not online`);
            return false;
        }

        const song = this.loadRandomSongPcm();
        if (!song) return false;

        const session = this.createSession(targetNumber);
        session.startedAt = Date.now();
        session.songName = song.name;
        session.pcm = song.pcm;
        session.waitingForAccept = true;

        this.udpSend(target, buildCallPacket({ phoneNumber: config.TEST_CALL_NUMBER }));
        this.logger.info(`[calls] -> #${targetNumber}: call from #${config.TEST_CALL_NUMBER}, waiting for accept before streaming "${song.name}"`);

        return true;
    }

    // Entry point for MSG_CALL from a phone. Numbers below UTILITY_NUMBER_MAX
    // are utilities provided by the server itself; anything else belongs to a
    // real phone and the call is handed over to it.
    onPhoneCall(phone, call) {
        if (call.phoneNumber < config.UTILITY_NUMBER_MAX) {
            return this.startIncomingCall(phone, call.phoneNumber);
        }

        return this.forwardCall(phone, call);
    }

    // Phone-to-phone call: pass the CALL over to the target phone if it can
    // take it, otherwise tell the caller why not
    forwardCall(caller, call) {
        const targetNumber = call.phoneNumber;
        const target = this.registry.get(targetNumber);

        if (!target) {
            this.logger.info(`[calls] <- #${caller.number}: call to unregistered #${targetNumber} -> wrong number`);
            this.udpSend(caller, buildSingleBytePacket(MSG_TYPE.WRONG_NUM));
            return false;
        }

        switch (target.state) {
            case PHONE_STATES.IDLE: {
                // phoneNumber carries the caller ID for the callee: the
                // firmware stores MSG_CALL.phoneNumber as the remote party
                // (protocol.c: msg_call_callback)
                this.udpSend(target, buildCallPacket({ phoneNumber: caller.number, encryption: call.encryption }));

                // Remember who is calling whom so MSG_END from either side
                // can be relayed to the other one later
                this.registry.setCall(caller.number, targetNumber);
                this.registry.setCall(targetNumber, caller.number);

                this.logger.info(`[calls] <- #${caller.number}: call forwarded to #${targetNumber}`);
                return true;
            }

            case PHONE_STATES.TALKING:
                // The caller repeats MSG_CALL every few seconds against UDP
                // loss, and while the target rings it reports STATE_TALKING;
                // a retry of the very same pairing must not bounce as busy
                if (caller.targetNumber === targetNumber) {
                    this.logger.info(`[calls] <- #${caller.number}: repeat call to #${targetNumber} (still ringing)`);
                    return true;
                }

                this.logger.info(`[calls] <- #${caller.number}: call to busy #${targetNumber}`);
                this.udpSend(caller, buildSingleBytePacket(MSG_TYPE.BUSY));
                return false;

            case PHONE_STATES.DISCONNECTED:
            default:
                // Registered but unreachable (offline, or handset lifted)
                this.logger.info(`[calls] <- #${caller.number}: call to unavailable #${targetNumber}`);
                this.udpSend(caller, buildSingleBytePacket(MSG_TYPE.UNAVAILABLE));
                return false;
        }
    }

    // Phone-initiated call to the service number (e.g. 012): wait a bit as if
    // ringing, then accept on the server side and stream a random song
    startIncomingCall(phone, dialedNumber) {
        if (dialedNumber !== config.INCOMING_CALL_NUMBER) {
            this.logger.warn(`[calls] #${phone.number} dialed #${dialedNumber}: number is not served by the server`);
            return false;
        }

        // The firmware repeats MSG_CALL every few seconds while waiting for
        // MSG_ACCEPT; restarting the delay on every repeat would stall the
        // answer forever, so a ringing session just swallows them
        const existing = this.sessions.get(phone.number);
        if (existing && existing.acceptTimer !== null) {
            this.logger.info(`[calls] <- #${phone.number}: repeat call to #${dialedNumber} (already ringing)`);
            return true;
        }

        const song = this.loadRandomSongPcm();
        if (!song) return false;

        const session = this.createSession(phone.number);
        session.isIncoming = true;
        session.startedAt = Date.now();
        session.songName = song.name;
        session.pcm = song.pcm;

        this.logger.info(`[calls] <- #${phone.number}: call to #${dialedNumber}, accepting in ${config.INCOMING_CALL_ACCEPT_DELAY_MS} ms`);

        session.acceptTimer = setTimeout(() => {
            session.acceptTimer = null;

            // Caller might have hung up or dropped while "ringing"
            const caller = this.registry.get(session.targetNumber);
            if (!caller || caller.state === PHONE_STATES.DISCONNECTED) {
                this.logger.warn(`[calls] Caller #${session.targetNumber} is no longer online, dropping incoming call`);
                this.endSession(session, { sendEnd: false });
                return;
            }

            this.udpSend(caller, buildAcceptPacket());
            this.logger.info(`[calls] -> #${session.targetNumber}: accepted incoming call, streaming "${session.songName}"`);

            this.beginStreaming(session);
        }, config.INCOMING_CALL_ACCEPT_DELAY_MS);

        return true;
    }

    // Phone picked up. For a forwarded phone-to-phone call the accept is
    // relayed to the waiting caller; otherwise it completes a pending test
    // call handshake and playback starts.
    onPhoneAccept(phone) {
        if (phone.targetNumber != null) {
            const caller = this.registry.get(phone.targetNumber);
            if (!caller) return;

            this.udpSend(caller, buildAcceptPacket());
            this.logger.info(`[calls] <- #${phone.number}: accepted, relayed to #${caller.number}`);
            return;
        }

        const session = this.sessions.get(phone.number);
        if (!session || !session.waitingForAccept) return;

        session.waitingForAccept = false;
        this.logger.info(`[calls] <- #${phone.number}: accepted, starting playback of "${session.songName}"`);

        this.beginStreaming(session);
    }

    // Voice audio of a forwarded phone-to-phone call: relay the packet
    // verbatim to whoever this phone is talking to. Deliberately silent and
    // parse-free: this runs at packet rate (25 pkt/s per direction).
    onPhoneAudio(phone, raw) {
        if (phone.targetNumber == null) return;

        const peer = this.registry.get(phone.targetNumber);
        if (!peer) return;

        this.udpSend(peer, raw);
    }

    // Phone hung up: relay MSG_END to the remembered peer first, tear down
    // its own server-side session if any, then forget the pairing
    onPhoneEnd(phone) {
        this.logger.info(`[calls] <- #${phone.number}: hung up`);

        if (phone.targetNumber != null) {
            this.sendEnd(phone.targetNumber);

            // Forget the pairing on the peer side too, but only if it still
            // points back at the hanger-upper (it might have re-dialed since)
            const peer = this.registry.get(phone.targetNumber);
            if (peer && peer.targetNumber === phone.number) {
                this.registry.clearCall(peer.number);
            }
        }

        const session = this.sessions.get(phone.number);
        if (session) {
            this.logger.info(`[calls] ending ${session.isIncoming ? 'incoming' : 'test'} call with #${phone.number}`);
            this.endSession(session, { sendEnd: false });
        }

        this.registry.clearCall(phone.number);
    }

    // Dashboard "stop": hang up everything
    stopTestCall() {
        for (const session of [...this.sessions.values()]) {
            this.endSession(session);
        }
    }

    createSession(targetNumber) {
        const previous = this.sessions.get(targetNumber);
        if (previous) this.endSession(previous); // e.g. new call replaces the old one

        const session = {
            targetNumber,
            isIncoming: false,
            startedAt: null,
            songName: null,
            pcm: null,
            pcmOffset: 0,
            packetSeq: 0,
            streamTimer: null,      // setTimeout handle while audio is flowing
            nextPacketAt: null,     // absolute deadline of the next audio packet
            waitingForAccept: false,
            acceptTimer: null,      // pending "ringing" delay of an incoming call
        };
        this.sessions.set(targetNumber, session);
        return session;
    }

    beginStreaming(session) {
        if (!session.pcm) {
            this.logger.error(`[calls] No audio prepared for #${session.targetNumber}, dropping call`);
            this.endSession(session, { sendEnd: false });
            return;
        }

        // Anchor the stream to an absolute schedule (see onStreamTimer):
        // a plain setInterval chain fires late and never catches up, so the
        // effective rate drifts below 25 pkt/s and starves the phone's
        // jitter buffer.
        session.nextPacketAt = Date.now() + config.AUDIO_PACKET_INTERVAL_MS;
        this.scheduleStreamTick(session);
    }

    scheduleStreamTick(session) {
        const delay = Math.max(0, session.nextPacketAt - Date.now());
        session.streamTimer = setTimeout(() => this.onStreamTimer(session), delay);
    }

    onStreamTimer(session) {
        // Keep the fired handle in streamTimer here: if streamTick ends the
        // call, endSession()'s cleanup still sees the live session object.
        this.streamTick(session);

        if (this.sessions.get(session.targetNumber) !== session) return; // call ended

        // Late fire? The next deadline is unchanged, so the following delay
        // shrinks and the average rate stays exactly 25 pkt/s. Only after a
        // long stall (event loop blocked, laptop sleep) do we resync to now
        // instead of machine-gunning a burst.
        session.nextPacketAt += config.AUDIO_PACKET_INTERVAL_MS;
        if (Date.now() - session.nextPacketAt > config.AUDIO_PACKET_INTERVAL_MS) {
            session.nextPacketAt = Date.now();
        }
        this.scheduleStreamTick(session);
    }

    // One streaming tick every AUDIO_PACKET_INTERVAL_MS: push the next
    // 1280-byte chunk; when the song runs out, end the call with MSG_END
    streamTick(session) {
        const target = this.registry.get(session.targetNumber);
        if (!target || target.state === PHONE_STATES.DISCONNECTED) {
            this.logger.warn(`[calls] Target #${session.targetNumber} is no longer online, stopping call`);
            this.endSession(session);
            return;
        }

        const chunk = session.pcm.subarray(session.pcmOffset, session.pcmOffset + AUDIO_SIZE);
        this.udpSend(target, buildAudioPacket(session.packetSeq, chunk));
        session.pcmOffset += AUDIO_SIZE;
        session.packetSeq += 1;

        if (session.pcmOffset >= session.pcm.length) {
            this.logger.info(`[calls] Song "${session.songName}" finished for #${session.targetNumber}`);
            this.endSession(session); // sends MSG_END to the phone
        }
    }

    endSession(session, { sendEnd = true } = {}) {
        clearTimeout(session.streamTimer);
        clearTimeout(session.acceptTimer);
        this.sessions.delete(session.targetNumber);

        if (sendEnd) this.sendEnd(session.targetNumber);

        this.logger.info(
            `[calls] Call with #${session.targetNumber} finished ` +
            `("${session.songName ?? '?'}", ${session.packetSeq} audio packets sent)`
        );
    }

    sendEnd(targetNumber) {
        const target = this.registry.get(targetNumber);
        if (!target) return;

        const packet = buildEndPacket();
        this.udpSend(target, packet);
        this.logger.info(`[calls] -> #${targetNumber}: end call (0x${MSG_TYPE.END.toString(16)}, ${packet.length} byte)`);
    }

    loadRandomSongPcm() {
        const song = this.pickRandomSong();
        if (!song) {
            this.logger.warn('[calls] Call refused: no .wav songs available');
            return null;
        }

        const pcm = this.loadSongPcm(song.path);
        if (!pcm) return null;

        return { name: song.name, pcm };
    }

    pickRandomSong() {
        let files;
        try {
            files = fs.readdirSync(config.SONGS_DIR).filter((f) => f.toLowerCase().endsWith('.wav'));
        } catch (err) {
            this.logger.error(`[calls] Cannot read songs dir "${config.SONGS_DIR}": ${err.message}`);
            return null;
        }
        if (files.length === 0) return null;

        const name = files[Math.floor(Math.random() * files.length)];
        return { name, path: path.join(config.SONGS_DIR, name) };
    }

    loadSongPcm(filePath) {
        try {
            const raw = fs.readFileSync(filePath);
            if (raw.length <= WAV_HEADER_SIZE) {
                this.logger.error(`[calls] Song file too small to contain audio: ${filePath}`);
                return null;
            }
            return raw.subarray(WAV_HEADER_SIZE); // strip the 44-byte WAV header
        } catch (err) {
            this.logger.error(`[calls] Cannot read song "${filePath}": ${err.message}`);
            return null;
        }
    }
}

module.exports = { CallManager };

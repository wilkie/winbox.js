//! The MIDI devices: the card's MIDI port, out and in, as the Sound
//! Blaster 1.5's driver has it (`modMessage` seg1 `40f`, `midMessage` seg5
//! `1c3`), and a synthesizer, as the Ad Lib driver has it (`MSADLIB.DRV`
//! `modMessage` seg1 `b37`). **Recorded** by `mididev` on the installation
//! with both:
//!
//! * Two output devices, the port 0 and the synthesizer 1, and one input
//!   device. The port's capabilities say a MIDI port (1), all sixteen
//!   channels; the synthesizer's an FM synthesizer (4) of eleven voices and
//!   notes on channels 1 to 8 (`FFh`). Neither has volume, which is
//!   `MMSYSERR_NOTSUPPORTED` (8), as preparing a header is: MMSYSTEM
//!   prepares it.
//! * Each opens once at a time, a second open `MMSYSERR_ALLOCATED` (4); the
//!   input shares the card's converter with the waveform devices. Opening
//!   and closing call the program back, `MM_MOM_OPEN` and `MM_MOM_CLOSE`.
//! * A short message is as many bytes as its status says -- three, or two
//!   for a program change or channel pressure -- and a running status's
//!   one fewer; with no running status a data byte sends nothing. A status
//!   below `F0h` is the running status after it, `F0h` to `F7h` end it.
//!   The port sends a system message's bytes as their status says; the
//!   synthesizer, which looks them up as it does a channel's, nothing.
//! * A long message needs its header prepared (`MIDIERR_UNPREPARED`, 64),
//!   is sent at once, and its header is marked done and called back,
//!   `MM_MOM_DONE`, before the call answers; it is never queued.
//! * Resetting the port sends each channel its sustain off and every note
//!   off; the synthesizer silences its voices.
//! * A message for a device while it is still answering one -- a callback
//!   sending another -- is `MIDIERR_NOTREADY` (67).
//! * The input queues buffers as the waveform input does (`MIDIERR_...`
//!   64 and 65 for one not prepared or queued); stopping returns a buffer
//!   part filled with a system-exclusive message, resetting calls every
//!   buffer done with nothing in it (`MM_MIM_LONGDATA`).
//!
//! What goes out goes to the host as MIDI bytes (`audio.rs`), which
//! winbox.js's native front end does not yet play. Nothing comes in: the
//! port has nothing connected to it, so started input receives nothing.

use crate::audio::{MidiOutput, Sound};
use crate::call::Stop;
use crate::engine::Engine;
use crate::mmsystem::devices::Message;
use crate::system::System;

use super::{
    Callback, Card, Instance, MIDIERR_NOTREADY, MIDIERR_STILLPLAYING, MIDIERR_UNPREPARED,
    MMSYSERR_ALLOCATED, MMSYSERR_NOTSUPPORTED, Owner, copy_caps, dword, huge_read, name_field,
    set_dword,
};

pub const MODM_GETNUMDEVS: u16 = 1;
const MODM_GETDEVCAPS: u16 = 2;
const MODM_OPEN: u16 = 3;
const MODM_CLOSE: u16 = 4;
const MODM_DATA: u16 = 7;
const MODM_LONGDATA: u16 = 8;
const MODM_RESET: u16 = 9;

pub const MIDM_GETNUMDEVS: u16 = 0x35;
const MIDM_GETDEVCAPS: u16 = 0x36;
const MIDM_OPEN: u16 = 0x37;
const MIDM_CLOSE: u16 = 0x38;
const MIDM_ADDBUFFER: u16 = 0x3b;
const MIDM_START: u16 = 0x3c;
const MIDM_STOP: u16 = 0x3d;
const MIDM_RESET: u16 = 0x3e;

const MM_MIM_OPEN: u16 = 0x3c1;
const MM_MIM_CLOSE: u16 = 0x3c2;
const MM_MIM_LONGDATA: u16 = 0x3c4;
const MM_MOM_OPEN: u16 = 0x3c7;
const MM_MOM_CLOSE: u16 = 0x3c8;
const MM_MOM_DONE: u16 = 0x3c9;

/// A `MIDIHDR`'s fields, and its flags.
const DATA: u16 = 0;
const LENGTH: u16 = 4;
const RECORDED: u16 = 8;
const FLAGS: u16 = 0x10;
const NEXT: u16 = 0x14;
const DONE: u32 = 1;
const PREPARED: u32 = 2;
const INQUEUE: u32 = 4;

/// How many bytes a channel message is, by its status's high four bits
/// from 8 (the drivers' tables, the Sound Blaster's data `12h`, the Ad
/// Lib's `1AEh`).
const CHANNEL: [u8; 8] = [3, 3, 3, 3, 2, 2, 3, 0];

/// How many bytes a system message is, by its status from `F0h` (the
/// Sound Blaster's data `1Ah`).
const SYSTEM: [u8; 16] = [1, 2, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

/// An output device opened, and its state.
#[derive(Debug, Default, Clone, Copy)]
pub struct Output {
    pub open: Option<Instance>,
    /// The last channel status sent, which a data byte runs on (the Sound
    /// Blaster's `[10h]`, the Ad Lib's `[3C0h]`).
    pub running: u8,
    /// Whether it is still answering a message (`[2Ah]`, `[34Ah]`).
    pub busy: bool,
}

/// The MIDI devices.
#[derive(Debug, Default)]
pub struct Midi {
    pub port: Output,
    pub synthesizer: Output,
    pub input: Input,
}

/// The input device: opened, started, its buffers queued and when it was
/// started.
#[derive(Debug, Default)]
pub struct Input {
    pub open: Option<Instance>,
    pub started: bool,
    pub head: u32,
    /// When it was opened or last started, as `timeGetTime` counts
    /// (`[BEh]`, from `MMSYSTEM.607`).
    pub since: u32,
}

/// A message for an output device.
pub async fn out_message(engine: &Engine, message: Message) -> Result<u32, Stop> {
    let enabled = engine.system().sound_card.enabled;

    if let Some(answer) = super::common(enabled, &message, MODM_GETNUMDEVS, 2) {
        return Ok(answer);
    }

    let synthesizer = message.device == 1;

    match message.message {
        MODM_GETNUMDEVS => Ok(2),
        MODM_GETDEVCAPS => {
            out_caps(
                &mut engine.system(),
                synthesizer,
                message.first,
                message.second,
            );
            Ok(0)
        }
        MODM_OPEN => {
            super::with_card(engine, |card, system, calls| {
                let output = output(card, synthesizer);

                if output.open.is_some() {
                    return MMSYSERR_ALLOCATED;
                }

                let instance = Instance::opened(system, message.first, false, message.second);

                output.running = 0;
                calls.push(instance.callback(MM_MOM_OPEN, 0));
                output.open = Some(instance);
                0
            })
            .await
        }
        MODM_CLOSE => {
            // The program called back before the device is let go -- the
            // port's (seg1 `4e6`-`4f8`), the synthesizer's once its voices
            // are silenced (`MSADLIB` seg1 `c36`-`c4a`) -- so that one
            // called back still finds it open.
            super::with_card(engine, |card, system, calls| {
                if synthesizer {
                    silence(system);
                }

                if let Some(instance) = output(card, synthesizer).open {
                    calls.push(instance.callback(MM_MOM_CLOSE, 0));
                }

                0
            })
            .await?;
            super::with_card(engine, |card, _, _| {
                output(card, synthesizer).open = None;
                0
            })
            .await
        }
        MODM_DATA => {
            engaged(engine, synthesizer, true, |card, system, calls| {
                short(card, system, calls, synthesizer, message.first)
            })
            .await
        }
        MODM_LONGDATA => {
            engaged(engine, synthesizer, true, |card, system, calls| {
                long(card, system, calls, synthesizer, message.first)
            })
            .await
        }
        MODM_RESET => {
            engaged(engine, synthesizer, !synthesizer, |card, system, _| {
                if synthesizer {
                    silence(system);
                } else {
                    reset_port(card, system);
                }

                0
            })
            .await
        }
        _ => Ok(MMSYSERR_NOTSUPPORTED),
    }
}

fn output(card: &mut Card, synthesizer: bool) -> &mut Output {
    if synthesizer {
        &mut card.midi.synthesizer
    } else {
        &mut card.midi.port
    }
}

/// A message the device answers while it is marked busy, as the drivers
/// count themselves in and out (where `counted`): one come while it is
/// busy is `MIDIERR_NOTREADY`.
async fn engaged(
    engine: &Engine,
    synthesizer: bool,
    counted: bool,
    act: impl FnOnce(&mut Card, &mut System, &mut Vec<Callback>) -> u32,
) -> Result<u32, Stop> {
    if counted {
        let mut system = engine.system();
        let output = output(&mut system.sound_card, synthesizer);

        if output.busy {
            return Ok(MIDIERR_NOTREADY);
        }

        output.busy = true;
    }

    let answer = super::with_card(engine, act).await;

    if counted {
        output(&mut engine.system().sound_card, synthesizer).busy = false;
    }

    answer
}

/// `MIDIOUTCAPS`: the port's (seg5 `330`), the synthesizer's (`MSADLIB`
/// seg2 `60`).
fn out_caps(system: &mut System, synthesizer: bool, far: u32, size: u32) {
    let mut caps = Vec::with_capacity(0x32);
    let (product, name, technology, voices, mask): (u16, &str, u16, u16, u16) = if synthesizer {
        (
            super::SYNTHESIZER_PRODUCT,
            super::SYNTHESIZER_NAME,
            4,
            11,
            0xff,
        )
    } else {
        (super::MIDI_OUT_PRODUCT, super::MIDI_NAME, 1, 0, 0xffff)
    };

    caps.extend_from_slice(&super::MANUFACTURER.to_le_bytes());
    caps.extend_from_slice(&product.to_le_bytes());
    caps.extend_from_slice(&super::VERSION.to_le_bytes());
    caps.extend_from_slice(&name_field(name));
    caps.extend_from_slice(&technology.to_le_bytes());
    caps.extend_from_slice(&voices.to_le_bytes());
    caps.extend_from_slice(&voices.to_le_bytes());
    caps.extend_from_slice(&mask.to_le_bytes());
    caps.extend_from_slice(&0u32.to_le_bytes());
    copy_caps(system, far, size, &caps);
}

/// How many bytes a short message sends, as each driver reckons it from its
/// first byte and the running status (seg1 `36c`, `MSADLIB` seg1 `c65`).
fn short_length(status: u8, running: u8, synthesizer: bool) -> u8 {
    if status >= 0x80 {
        if status >= 0xf0 && !synthesizer {
            SYSTEM[usize::from(status - 0xf0)]
        } else {
            CHANNEL[usize::from((status & 0x70) >> 4)]
        }
    } else if running == 0 {
        0
    } else {
        CHANNEL[usize::from((running & 0x70) >> 4)] - 1
    }
}

/// Bytes sent, the running status kept as they go (seg1 `2d8`).
fn send(card: &mut Card, system: &mut System, synthesizer: bool, bytes: &[u8]) {
    let output = output(card, synthesizer);

    for &byte in bytes {
        match byte {
            0x80..=0xef => output.running = byte,
            0xf0..=0xf7 => output.running = 0,
            _ => {}
        }
    }

    if bytes.is_empty() || system.host.is_none() {
        return;
    }

    let at = system.clock.now(system.instructions);

    system.sound(&Sound::Midi {
        at,
        output: if synthesizer {
            MidiOutput::Synthesizer
        } else {
            MidiOutput::Port
        },
        bytes: bytes.to_vec(),
    });
}

/// A short message: its bytes sent.
fn short(
    card: &mut Card,
    system: &mut System,
    _calls: &mut Vec<Callback>,
    synthesizer: bool,
    message: u32,
) -> u32 {
    let running = output(card, synthesizer).running;
    let length = short_length(message as u8, running, synthesizer);
    let bytes = message.to_le_bytes();

    send(card, system, synthesizer, &bytes[..usize::from(length)]);
    0
}

/// A long message (seg1 `328`, `MSADLIB` seg1 `cf8`): sent, done and
/// called back at once.
fn long(
    card: &mut Card,
    system: &mut System,
    calls: &mut Vec<Callback>,
    synthesizer: bool,
    header: u32,
) -> u32 {
    let flags = dword(system, header, FLAGS);

    if flags & PREPARED == 0 {
        return MIDIERR_UNPREPARED;
    }

    let bytes = huge_read(
        system,
        dword(system, header, DATA),
        dword(system, header, LENGTH),
    );

    send(card, system, synthesizer, &bytes);
    set_dword(system, header, FLAGS, dword(system, header, FLAGS) | DONE);

    if let Some(instance) = output(card, synthesizer).open {
        calls.push(instance.callback(MM_MOM_DONE, header));
    }

    0
}

/// The port reset (seg1 `3cd`): each channel's sustain pedal let go, then
/// every note off, the notes after the first on the running status.
fn reset_port(card: &mut Card, system: &mut System) {
    let mut bytes = Vec::new();

    for channel in 0..16u8 {
        bytes.extend_from_slice(&[0xb0 | channel, 0x40, 0x00, 0x80 | channel, 0x00, 0x40]);

        for note in 1..0x80u8 {
            bytes.extend_from_slice(&[note, 0x40]);
        }
    }

    send(card, system, false, &bytes);
    card.midi.port.running = 0;
}

/// The synthesizer's voices stopped (`MSADLIB` seg1 `65e`).
fn silence(system: &mut System) {
    if system.host.is_none() {
        return;
    }

    let at = system.clock.now(system.instructions);

    system.sound(&Sound::Silence {
        at,
        output: MidiOutput::Synthesizer,
    });
}

/// A message for the input device.
pub async fn in_message(engine: &Engine, message: Message) -> Result<u32, Stop> {
    let enabled = engine.system().sound_card.enabled;

    if let Some(answer) = super::common(enabled, &message, MIDM_GETNUMDEVS, 1) {
        return Ok(answer);
    }

    match message.message {
        MIDM_GETNUMDEVS => Ok(1),
        MIDM_GETDEVCAPS => {
            let mut caps = Vec::with_capacity(0x26);

            caps.extend_from_slice(&super::MANUFACTURER.to_le_bytes());
            caps.extend_from_slice(&super::MIDI_IN_PRODUCT.to_le_bytes());
            caps.extend_from_slice(&super::VERSION.to_le_bytes());
            caps.extend_from_slice(&name_field(super::MIDI_NAME));
            copy_caps(&mut engine.system(), message.first, message.second, &caps);
            Ok(0)
        }
        MIDM_OPEN => {
            super::with_card(engine, |card, system, calls| {
                // seg5 `3be`: the converter's, as the waveform devices'.
                if card.owner != Owner::None || card.midi.input.open.is_some() {
                    return MMSYSERR_ALLOCATED;
                }

                card.owner = Owner::MidiIn;

                let instance = Instance::opened(system, message.first, false, message.second);

                card.midi.input.head = 0;
                card.midi.input.since = system.milliseconds();
                calls.push(instance.callback(MM_MIM_OPEN, 0));
                card.midi.input.open = Some(instance);
                0
            })
            .await
        }
        MIDM_CLOSE => {
            super::with_card(engine, |card, _, calls| {
                if card.midi.input.head != 0 {
                    return MIDIERR_STILLPLAYING;
                }

                card.midi.input.started = false;

                if card.owner == Owner::MidiIn {
                    card.owner = Owner::None;
                }

                if let Some(instance) = card.midi.input.open.take() {
                    calls.push(instance.callback(MM_MIM_CLOSE, 0));
                }

                0
            })
            .await
        }
        MIDM_ADDBUFFER => Ok(add_buffer(&mut engine.system(), message.first)),
        MIDM_START => {
            let mut system = engine.system();
            let now = system.milliseconds();
            let input = &mut system.sound_card.midi.input;

            input.since = now;
            input.started = true;
            Ok(0)
        }
        // Stopped, nothing having come in, there is no message part
        // received to return.
        MIDM_STOP => {
            engine.system().sound_card.midi.input.started = false;
            Ok(0)
        }
        MIDM_RESET => super::with_card(engine, reset_input).await,
        _ => Ok(MMSYSERR_NOTSUPPORTED),
    }
}

/// A buffer added to the input (seg5 `7f`).
fn add_buffer(system: &mut System, header: u32) -> u32 {
    let flags = dword(system, header, FLAGS);

    if flags & PREPARED == 0 {
        return MIDIERR_UNPREPARED;
    }

    if flags & INQUEUE != 0 {
        return MIDIERR_STILLPLAYING;
    }

    set_dword(system, header, FLAGS, (flags | INQUEUE) & !DONE);
    set_dword(system, header, RECORDED, 0);
    set_dword(system, header, NEXT, 0);

    let head = system.sound_card.midi.input.head;

    if head == 0 {
        system.sound_card.midi.input.head = header;
        return 0;
    }

    let mut last = head;

    loop {
        let next = dword(system, last, NEXT);

        if next == 0 {
            break;
        }

        last = next;
    }

    set_dword(system, last, NEXT, header);
    0
}

/// The input reset (seg5 `31f`, `0`): stopped, and every buffer called
/// done with nothing in it, with the time since it started: `timeGetTime`
/// less the time kept as it started, a doubleword subtracted (seg5 `20`-
/// `29`: `sub ax,[BEh]`, `sbb dx,[C0h]`), so whole milliseconds, wrapping.
pub(super) fn reset_input(card: &mut Card, system: &mut System, calls: &mut Vec<Callback>) -> u32 {
    let input = &mut card.midi.input;
    let since = system.milliseconds().wrapping_sub(input.since);
    let mut each = input.head;

    input.started = false;
    input.head = 0;

    while each != 0 {
        let after = dword(system, each, NEXT);
        let flags = dword(system, each, FLAGS);

        set_dword(system, each, FLAGS, (flags | DONE) & !INQUEUE);
        set_dword(system, each, RECORDED, 0);

        if let Some(instance) = card.midi.input.open {
            let mut call = instance.callback(MM_MIM_LONGDATA, each);

            call.second = since;
            calls.push(call);
        }

        each = after;
    }

    0
}

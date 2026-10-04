//! The waveform input device, as the Sound Blaster 1.5's driver records
//! with one. **Read out** of `SNDBLST2.DRV`'s `widMessage` (seg4 `17a`)
//! and what it calls; its capabilities and its sharing the card are
//! **recorded** by `wavedev` and `mmdevs` on the installation with the
//! card:
//!
//! * One device. It takes PCM, one channel, eight bits, 4,000 to 12,000
//!   samples a second, its bytes a second its samples and its blocks a
//!   byte, else `WAVERR_BADFORMAT` (32); its capabilities say 11,025 mono
//!   eight-bit (1). Opening it while the output device, or MIDI input, is
//!   open is `MMSYSERR_ALLOCATED` (4), as `mmdevs` recorded with output
//!   left open.
//! * A buffer added is marked queued and not done, nothing recorded in it,
//!   its flags past done, prepared and queued cleared; not prepared is
//!   `WAVERR_UNPREPARED` (34), queued `WAVERR_STILLPLAYING` (33), as is
//!   closing with one queued.
//! * Started, the card records into its DMA buffer, an interrupt at each
//!   half; each fills the buffers queued in turn, and a buffer full is
//!   called done (`MM_WIM_DATA`) with what it holds. With no buffer queued
//!   what is recorded is lost. Stopping halts the card and calls the buffer
//!   being filled done with what it has; resetting stops, calls every
//!   buffer done with nothing recorded, and puts the position back to
//!   nought.
//!
//! What it records is winbox.js's own: the card's input has nothing
//! connected to it, and records silence (80h), at the rate and times the
//! card would. winbox.js takes no sound from the host.

use crate::call::Stop;
use crate::engine::Engine;
use crate::mmsystem::devices::Message;
use crate::system::System;

use super::wave_out::{
    DATA, DONE, FLAGS, INQUEUE, LENGTH, NEXT, PREPARED, RECORDED, RESERVED, position_sized,
};
use super::{
    Callback, Card, HALF, Instance, MMSYSERR_ALLOCATED, MMSYSERR_NOTSUPPORTED, Owner,
    WAVERR_BADFORMAT, WAVERR_STILLPLAYING, WAVERR_UNPREPARED, copy_caps, data_segment, dword,
    huge_on, huge_write, name_field, set_dword, set_word,
};

pub const WIDM_GETNUMDEVS: u16 = 0x32;
const WIDM_GETDEVCAPS: u16 = 0x33;
const WIDM_OPEN: u16 = 0x34;
const WIDM_CLOSE: u16 = 0x35;
const WIDM_ADDBUFFER: u16 = 0x38;
const WIDM_START: u16 = 0x39;
const WIDM_STOP: u16 = 0x3a;
const WIDM_RESET: u16 = 0x3b;
const WIDM_GETPOS: u16 = 0x3c;

const MM_WIM_OPEN: u16 = 0x3be;
const MM_WIM_CLOSE: u16 = 0x3bf;
const MM_WIM_DATA: u16 = 0x3c0;

/// Where the device's instance is in the driver's data: winbox.js's own
/// place.
pub const INSTANCE: u16 = 0x40;

/// The device's state, as the driver keeps it.
#[derive(Debug, Default)]
pub struct WaveIn {
    pub open: Option<Instance>,
    /// Whether the card is recording (`[56h]` bit 1).
    pub started: bool,
    /// The buffers queued, the first being filled (`[4Ch]`).
    pub head: u32,
    /// Where in that buffer the next byte goes, and how many it has room
    /// for (`[2Eh]`, `[32h]`).
    pub current: u32,
    pub remaining: u32,
}

/// A message for the device.
pub async fn message(engine: &Engine, message: Message) -> Result<u32, Stop> {
    let enabled = engine.system().sound_card.enabled;

    if let Some(answer) = super::common(enabled, &message, WIDM_GETNUMDEVS, 1) {
        return Ok(answer);
    }

    match message.message {
        WIDM_GETNUMDEVS => Ok(1),
        WIDM_GETDEVCAPS => {
            caps(&mut engine.system(), message.first, message.second);
            Ok(0)
        }
        WIDM_OPEN => {
            super::with_card(engine, |card, system, calls| {
                open(card, system, calls, &message)
            })
            .await
        }
        WIDM_CLOSE => close(engine).await,
        WIDM_ADDBUFFER => {
            super::with_card(engine, |card, system, _| {
                add_buffer(card, system, message.first)
            })
            .await
        }
        WIDM_START => {
            super::with_card(engine, |card, system, _| {
                if !card.input.started {
                    card.input.started = true;

                    if let Some(instance) = card.input.open {
                        card.dma
                            .set_rate(u16::from_le_bytes([instance.format[4], instance.format[5]]));
                    }

                    card.dma.half = 2;
                    card.begin(system);
                }

                0
            })
            .await
        }
        WIDM_STOP => {
            super::with_card(engine, |card, system, calls| {
                stop(card, system, calls);
                0
            })
            .await
        }
        WIDM_RESET => {
            super::with_card(engine, |card, system, calls| {
                stop(card, system, calls);

                let mut each = card.input.head;

                card.input.head = 0;

                while each != 0 {
                    let after = dword(system, each, NEXT);

                    done(card, system, calls, each);
                    each = after;
                }

                if let Some(instance) = card.input.open.as_mut() {
                    instance.position = 0;
                }

                0
            })
            .await
        }
        WIDM_GETPOS => {
            let mut system = engine.system();
            let recorded = system
                .sound_card
                .input
                .open
                .map_or(0, |instance| instance.position);

            Ok(position_sized(
                &mut system,
                message.first,
                message.second,
                recorded,
            ))
        }
        _ => Ok(MMSYSERR_NOTSUPPORTED),
    }
}

/// The device closed (seg4 `31a`): not with a buffer queued; recording
/// stopped, and the program called back before the instance is freed and
/// the converter let go (seg4 `32e`-`345`).
async fn close(engine: &Engine) -> Result<u32, Stop> {
    let answer = super::with_card(engine, |card, system, calls| {
        if card.input.head != 0 {
            return WAVERR_STILLPLAYING;
        }

        stop(card, system, calls);

        if let Some(instance) = card.input.open {
            calls.push(instance.callback(MM_WIM_CLOSE, 0));
        }

        0
    })
    .await?;

    if answer != 0 {
        return Ok(answer);
    }

    super::with_card(engine, |card, _, _| {
        card.input.open = None;

        if card.owner == Owner::WaveIn {
            card.owner = Owner::None;
        }

        0
    })
    .await
}

/// `WAVEINCAPS` (seg4 `127`).
fn caps(system: &mut System, far: u32, size: u32) {
    let mut caps = Vec::with_capacity(0x2c);

    caps.extend_from_slice(&super::MANUFACTURER.to_le_bytes());
    caps.extend_from_slice(&super::WAVE_IN_PRODUCT.to_le_bytes());
    caps.extend_from_slice(&super::VERSION.to_le_bytes());
    caps.extend_from_slice(&name_field(super::WAVE_NAME));
    caps.extend_from_slice(&1u32.to_le_bytes());
    caps.extend_from_slice(&1u16.to_le_bytes());
    copy_caps(system, far, size, &caps);
}

/// The device opened (seg4 `1fb`), or only asked whether it takes a format.
fn open(card: &mut Card, system: &mut System, calls: &mut Vec<Callback>, message: &Message) -> u32 {
    let description = message.first;
    let Some(format) = super::wave_out::format(system, dword(system, description, 2), 12_000, true)
    else {
        return WAVERR_BADFORMAT;
    };

    if message.second & 1 != 0 {
        return 0;
    }

    // seg4 `84c`: the card's converter, one device at a time.
    if card.owner != Owner::None || card.input.open.is_some() {
        return MMSYSERR_ALLOCATED;
    }

    card.owner = Owner::WaveIn;

    let mut instance = Instance::opened(system, description, true, message.second);

    instance.format = format;
    set_word(system, message.user, 0, INSTANCE);
    set_word(system, message.user, 2, 0);
    card.dma
        .set_rate(u16::from_le_bytes([format[4], format[5]]));
    calls.push(instance.callback(MM_WIM_OPEN, 0));
    card.input.open = Some(instance);
    0
}

/// A buffer added (seg4 `34d`, `46`).
fn add_buffer(card: &mut Card, system: &mut System, header: u32) -> u32 {
    let flags = dword(system, header, FLAGS) & 0x13;

    set_dword(system, header, FLAGS, flags);
    set_dword(
        system,
        header,
        RESERVED,
        data_segment(system) | u32::from(INSTANCE),
    );

    if flags & PREPARED == 0 {
        return WAVERR_UNPREPARED;
    }

    if flags & INQUEUE != 0 {
        return WAVERR_STILLPLAYING;
    }

    set_dword(system, header, FLAGS, (flags | INQUEUE) & !DONE);
    set_dword(system, header, RECORDED, 0);
    set_dword(system, header, NEXT, 0);

    if card.input.head == 0 {
        card.input.head = header;
    } else {
        let mut last = card.input.head;

        loop {
            let next = dword(system, last, NEXT);

            if next == 0 {
                break;
            }

            last = next;
        }

        set_dword(system, last, NEXT, header);
    }

    0
}

/// The card's interrupt as it records (seg1 `b91`): the half just recorded
/// taken into the buffers queued.
pub fn interrupt(card: &mut Card, system: &mut System, calls: &mut Vec<Callback>) {
    if !card.input.started {
        card.dma.due = None;
        return;
    }

    card.dma.half ^= 3;

    let at = if card.dma.half == 2 { HALF } else { 0 };
    let from = usize::from(at);

    // Nothing connected: silence recorded.
    card.dma.buffer[from..from + usize::from(HALF)].fill(0x80);
    take(card, system, calls, HALF, at);
}

/// `count` bytes of the buffer from `at` put into the buffers queued (seg1
/// `95a`), each full one called done: how many went.
fn take(
    card: &mut Card,
    system: &mut System,
    calls: &mut Vec<Callback>,
    count: u16,
    at: u16,
) -> u16 {
    if card.input.head == 0 {
        return 0;
    }

    let mut taken: u16 = 0;

    while taken < count {
        let header = card.input.head;

        if card.input.current == 0 {
            card.input.current = dword(system, header, DATA);
            card.input.remaining = dword(system, header, LENGTH);
            set_dword(system, header, RECORDED, 0);
        }

        let n = u32::from(count - taken).min(card.input.remaining);
        let from = usize::from(at + taken);
        let bytes = card.dma.buffer[from..from + n as usize].to_vec();

        huge_write(system, card.input.current, &bytes);
        card.input.current = huge_on(card.input.current, n);
        taken += n as u16;
        set_dword(
            system,
            header,
            RECORDED,
            dword(system, header, RECORDED).wrapping_add(n),
        );

        if let Some(instance) = card.input.open.as_mut() {
            instance.position = instance.position.wrapping_add(n);
        }

        card.input.remaining -= n;

        if card.input.remaining != 0 {
            continue;
        }

        let next = dword(system, header, NEXT);
        let flags = dword(system, header, FLAGS);

        set_dword(system, header, FLAGS, (flags | DONE) & !INQUEUE);
        done(card, system, calls, header);
        card.input.head = next;

        if next == 0 {
            card.input.current = 0;
            card.input.remaining = 0;
            break;
        }

        card.input.current = dword(system, next, DATA);
        card.input.remaining = dword(system, next, LENGTH);
        set_dword(system, next, RECORDED, 0);
    }

    taken
}

/// Recording stopped (seg4 `9bc`, `d5`): the card halted, and the buffer
/// being filled called done with what it holds.
fn stop(card: &mut Card, system: &mut System, calls: &mut Vec<Callback>) {
    if !card.input.started {
        return;
    }

    card.dma.due = None;

    if let Some(timer) = card.dma.timer.take() {
        system.clock.cancel(timer);
    }

    let header = card.input.head;

    if header != 0 {
        card.input.head = dword(system, header, NEXT);

        let flags = dword(system, header, FLAGS);

        set_dword(system, header, FLAGS, (flags | DONE) & !INQUEUE);
        card.input.current = 0;
        card.input.remaining = 0;
        done(card, system, calls, header);
    }

    card.input.started = false;
}

/// A buffer called done (seg1 `a84`): one not done yet marked done with
/// nothing recorded, and the program called back with it.
fn done(card: &Card, system: &mut System, calls: &mut Vec<Callback>, header: u32) {
    let flags = dword(system, header, FLAGS);

    if flags & DONE == 0 {
        set_dword(system, header, FLAGS, (flags | DONE) & !INQUEUE);
        set_dword(system, header, RECORDED, 0);
    }

    if let Some(instance) = card.input.open.as_ref() {
        calls.push(instance.callback(MM_WIM_DATA, header));
    }
}

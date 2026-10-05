//! The waveform output device, as the Sound Blaster 1.5's driver plays
//! one. **Read out** of `SNDBLST2.DRV`'s `wodMessage` (seg4 `4b6`) and
//! what it calls; **recorded** by `wavedev`:
//!
//! * One device. It takes PCM, one channel, eight bits, 4,000 to 23,000
//!   samples a second, whose bytes a second are its samples and whose
//!   blocks are a byte or more; anything else is `WAVERR_BADFORMAT` (32) --
//!   16 bits, two channels, 44,100 or 48,000 a second, ADPCM. Its
//!   capabilities say 11,025 and 22,050 mono eight-bit (`11h`), one
//!   channel, and nothing it supports of pitch, rate or volume, which are
//!   `MMSYSERR_NOTSUPPORTED` (8) as preparing a header is: MMSYSTEM prepares
//!   it itself.
//! * Opening it while it, or the input device, or MIDI input, is open is
//!   `MMSYSERR_ALLOCATED` (4). Opening, closing and each buffer done call
//!   the program back: `MM_WOM_OPEN`, `MM_WOM_CLOSE` with nought, and
//!   `MM_WOM_DONE` with the header.
//! * A header written is marked queued and not done, its flags past the
//!   five a header has cleared; one not prepared is `WAVERR_UNPREPARED`
//!   (34), one queued `WAVERR_STILLPLAYING` (33). Closing with one queued
//!   is 33.
//! * The card plays from a 4 KB DMA buffer in two halves, an interrupt at
//!   the end of each. Writing to a still card fills the buffer and starts
//!   it; each interrupt fills the half just played from the headers queued,
//!   the rest of a half silence. A header whose data has all gone into the
//!   buffer is put aside; the next fill marks it, and the one after calls
//!   it done -- by then it has been played. A fill that finds nothing to
//!   play leaves the card to stop at the next interrupt. So a second at
//!   11,025 a second, played at 11,111, is done six halves on, in 1.1
//!   seconds, as `wavedev` recorded.
//! * Its position is the bytes that have gone into the buffer, in bytes for
//!   `TIME_BYTES` and as samples, which for eight-bit mono are the same,
//!   for any other kind; a size under 8 is `MMSYSERR_ERROR` (1).
//! * Pausing leaves the card to stop by itself, and waits for it; a write
//!   while paused fills nothing. Restarting plays on from where it was.
//!   Resetting halts the card at once, calls every header done -- those put
//!   aside first, last first -- and puts the position back to nought, and
//!   ends a pause. Looping headers play as many times as the first says;
//!   breaking a loop plays it out once.
//!
//! What winbox.js's does that the Sound Blaster's does not: the samples
//! of each half go to the host once the card has played it, and as much
//! of one as it played when it is reset (`audio.rs`).
//! The Sound Blaster's calls a function back at interrupt time inside a
//! pause or close that waits; winbox.js's calls it as the waiting call
//! returns.

use crate::audio::Sound;
use crate::call::Stop;
use crate::engine::Engine;
use crate::mmsystem::devices::Message;
use crate::system::System;

use super::{
    Callback, Card, DMA_SIZE, HALF, Instance, MMSYSERR_ALLOCATED, MMSYSERR_ERROR,
    MMSYSERR_NOTSUPPORTED, Owner, WAVERR_BADFORMAT, WAVERR_STILLPLAYING, WAVERR_UNPREPARED,
    copy_caps, data_segment, dword, huge_on, huge_read, name_field, set_dword, set_word, word,
};

pub const WODM_GETNUMDEVS: u16 = 3;
const WODM_GETDEVCAPS: u16 = 4;
const WODM_OPEN: u16 = 5;
const WODM_CLOSE: u16 = 6;
const WODM_WRITE: u16 = 9;
const WODM_PAUSE: u16 = 10;
const WODM_RESTART: u16 = 11;
const WODM_RESET: u16 = 12;
const WODM_GETPOS: u16 = 13;
const WODM_BREAKLOOP: u16 = 20;

const MM_WOM_OPEN: u16 = 0x3bb;
const MM_WOM_CLOSE: u16 = 0x3bc;
const MM_WOM_DONE: u16 = 0x3bd;

/// A `WAVEHDR`'s fields.
pub const DATA: u16 = 0;
pub const LENGTH: u16 = 4;
pub const RECORDED: u16 = 8;
pub const FLAGS: u16 = 0x10;
pub const LOOPS: u16 = 0x14;
pub const NEXT: u16 = 0x18;
pub const RESERVED: u16 = 0x1c;

/// Its flags.
pub const DONE: u32 = 1;
pub const PREPARED: u32 = 2;
pub const BEGINLOOP: u32 = 4;
pub const ENDLOOP: u32 = 8;
pub const INQUEUE: u32 = 0x10;
/// The driver's own mark on a header put aside, played: its next fill
/// calls it done.
const MARKED: u32 = 0x8000_0000;

/// What the driver's caps say: 11,025 and 22,050 mono eight-bit.
const FORMATS: u32 = 0x11;

/// Where the device's instance is in the driver's data, as a header it is
/// given names it: winbox.js's own place.
pub const INSTANCE: u16 = 0x10;

/// The device's state, as the driver keeps it.
#[derive(Debug, Default)]
pub struct WaveOut {
    pub open: Option<Instance>,
    /// Whether the card is playing (`[62h]`).
    pub running: bool,
    /// The headers queued, the first being played (`[48h]`).
    pub head: u32,
    /// Where in the header being played the next byte is, and how many are
    /// left (`[36h]`, `[3Ah]`).
    pub current: u32,
    pub remaining: u32,
    /// The header a loop began at, and how many times more it plays
    /// (`[3Eh]`, `[AEh]`).
    pub loop_start: u32,
    pub loops: u32,
    /// The headers played out, waiting to be called done, last first
    /// (`[42h]`).
    pub done: u32,
    pub paused: bool,
    pub break_loop: bool,
    /// The rate the device was opened at (`[5Eh]`).
    pub rate: u16,
}

/// A message for the device.
pub async fn message(engine: &Engine, message: Message) -> Result<u32, Stop> {
    let enabled = engine.system().sound_card.enabled;

    if let Some(answer) = super::common(enabled, &message, WODM_GETNUMDEVS, 1) {
        return Ok(answer);
    }

    match message.message {
        WODM_GETNUMDEVS => Ok(1),
        WODM_GETDEVCAPS => {
            caps(&mut engine.system(), message.first, message.second);
            Ok(0)
        }
        WODM_OPEN => {
            super::with_card(engine, |card, system, calls| {
                open(card, system, calls, &message)
            })
            .await
        }
        WODM_CLOSE => {
            if engine.system().sound_card.out.head != 0 {
                return Ok(WAVERR_STILLPLAYING);
            }

            super::wait_stopped(engine).await;
            // The program called back before the instance is freed and the
            // converter let go (seg4 `673`-`68a`), so that one called back
            // still finds the device its own.
            super::with_card(engine, |card, _, calls| {
                if let Some(instance) = card.out.open {
                    calls.push(instance.callback(MM_WOM_CLOSE, 0));
                }

                0
            })
            .await?;
            super::with_card(engine, |card, _, _| {
                card.out.open = None;

                if card.owner == Owner::WaveOut {
                    card.owner = Owner::None;
                }

                0
            })
            .await
        }
        WODM_WRITE => {
            super::with_card(engine, |card, system, calls| {
                write(card, system, calls, message.first)
            })
            .await
        }
        WODM_PAUSE => {
            engine.system().sound_card.out.paused = true;
            super::wait_stopped(engine).await;
            Ok(0)
        }
        WODM_RESTART => {
            super::with_card(engine, |card, system, calls| {
                if card.out.paused {
                    card.dma.set_rate(card.out.rate);
                    card.out.paused = false;
                    start(card, system, calls);
                }

                0
            })
            .await
        }
        WODM_RESET => {
            // The headers are called done before the pause ends and the
            // position goes back to nought (seg4 `6ed`, then `6f0`), so
            // that a program called back finds them as they were.
            super::with_card(engine, |card, system, calls| {
                reset(card, system, calls);
                0
            })
            .await?;
            super::with_card(engine, |card, _, _| {
                after_reset(card);
                0
            })
            .await
        }
        WODM_GETPOS => Ok(position(
            &mut engine.system(),
            message.first,
            message.second,
        )),
        WODM_BREAKLOOP => {
            let mut system = engine.system();

            if system.sound_card.out.head != 0 {
                system.sound_card.out.break_loop = true;
            }

            Ok(0)
        }
        _ => Ok(MMSYSERR_NOTSUPPORTED),
    }
}

/// `WAVEOUTCAPS` (seg4 `424`).
fn caps(system: &mut System, far: u32, size: u32) {
    let mut caps = Vec::with_capacity(0x30);

    caps.extend_from_slice(&super::MANUFACTURER.to_le_bytes());
    caps.extend_from_slice(&super::WAVE_OUT_PRODUCT.to_le_bytes());
    caps.extend_from_slice(&super::VERSION.to_le_bytes());
    caps.extend_from_slice(&name_field(super::WAVE_NAME));
    caps.extend_from_slice(&FORMATS.to_le_bytes());
    caps.extend_from_slice(&1u16.to_le_bytes());
    caps.extend_from_slice(&0u32.to_le_bytes());
    copy_caps(system, far, size, &caps);
}

/// Whether the driver plays a format (seg4 `546`): PCM, one channel, 4,000
/// to 23,000 samples a second, its bytes a second its samples, a block of
/// a byte or more, eight bits. The format as the driver keeps it.
pub(super) fn format(
    system: &System,
    far: u32,
    highest: u32,
    exact_block: bool,
) -> Option<[u8; 16]> {
    let bytes = system.read_far(far, 16);
    let field = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let rate = u32::from(field(4)) | u32::from(field(6)) << 16;
    let average = u32::from(field(8)) | u32::from(field(10)) << 16;
    let block = field(12);
    let takes = field(0) == 1
        && field(2) == 1
        && (4000..=highest).contains(&rate)
        && average == rate
        && if exact_block { block == 1 } else { block >= 1 }
        && field(14) == 8;

    takes.then(|| {
        let mut format = [0; 16];

        format.copy_from_slice(&bytes);
        format
    })
}

/// The device opened (seg4 `546`), or only asked whether it takes a
/// format (`WAVE_FORMAT_QUERY`).
fn open(card: &mut Card, system: &mut System, calls: &mut Vec<Callback>, message: &Message) -> u32 {
    let description = message.first;
    let Some(format) = format(system, dword(system, description, 2), 23_000, false) else {
        return WAVERR_BADFORMAT;
    };

    if message.second & 1 != 0 {
        return 0;
    }

    // The converter is the card's: one device of those that share it at a
    // time (seg4 `803`).
    if card.owner != Owner::None || card.out.open.is_some() {
        return MMSYSERR_ALLOCATED;
    }

    card.owner = Owner::WaveOut;

    let mut instance = Instance::opened(system, description, true, message.second);

    instance.format = format;

    let rate = u16::from_le_bytes([format[4], format[5]]);

    set_word(system, message.user, 0, INSTANCE);
    set_word(system, message.user, 2, 0);
    card.out.rate = rate;
    card.dma.set_rate(rate);
    calls.push(instance.callback(MM_WOM_OPEN, 0));
    card.out.open = Some(instance);
    0
}

/// A header written (seg4 `692`): queued, and played.
fn write(card: &mut Card, system: &mut System, calls: &mut Vec<Callback>, header: u32) -> u32 {
    let flags = dword(system, header, FLAGS) & 0x1f;

    set_dword(system, header, FLAGS, flags);

    if flags & PREPARED == 0 {
        return WAVERR_UNPREPARED;
    }

    if flags & INQUEUE != 0 {
        return WAVERR_STILLPLAYING;
    }

    let instance = data_segment(system) | u32::from(INSTANCE);

    set_dword(system, header, RESERVED, instance);
    set_dword(system, header, FLAGS, (flags | INQUEUE) & !DONE);
    enqueue(card, system, calls, header);
    0
}

/// A header put at the end of the queue (seg4 `895`): the card started if
/// it is still, else what it plays next filled in where the last fill left
/// silence.
fn enqueue(card: &mut Card, system: &mut System, calls: &mut Vec<Callback>, header: u32) {
    set_dword(system, header, NEXT, 0);

    if card.out.head == 0 {
        card.out.head = header;
    } else {
        let mut last = card.out.head;

        loop {
            let next = dword(system, last, NEXT);

            if next == 0 {
                break;
            }

            last = next;
        }

        set_dword(system, last, NEXT, header);
    }

    if !card.out.running {
        start(card, system, calls);
        return;
    }

    if let Some((at, count)) = card.dma.silence.take() {
        fill(card, system, calls, count, at);

        if card.dma.half == 0 {
            card.dma.half = if at >= HALF { 2 } else { 1 };
        }
    }
}

/// The card started (seg4 `7d2`): the whole buffer filled, and played if
/// anything went into it. Whether it started.
pub fn start(card: &mut Card, system: &mut System, calls: &mut Vec<Callback>) -> bool {
    card.dma.half = 0;

    let filled = fill(card, system, calls, DMA_SIZE as u16, 0);

    if filled > HALF {
        card.dma.half = 2;
    }

    if filled == 0 {
        return false;
    }

    card.out.running = true;
    card.begin(system);
    true
}

/// The first `count` bytes of a half of the buffer, as the card played
/// them from `at`, handed to the host.
///
/// A half is handed over as the card leaves it, not as it reaches it: a
/// header written while the card plays goes into the silence the last fill
/// left (seg4 `8f3`), often in the half being played, and is heard as the
/// card reaches it; handed over as the half began, it would be lost to the
/// host. So the host hears the card half a buffer late.
fn play(card: &Card, system: &mut System, at: f64, half: u16, count: u16) {
    if system.host.is_none() || count == 0 {
        return;
    }

    let from = usize::from(half);

    system.sound(&Sound::Samples {
        at,
        rate: card.dma.rate(),
        samples: card.dma.buffer[from..from + usize::from(count)].to_vec(),
    });
}

/// The card's interrupt as it plays (seg1 `bb7`): the half just played
/// handed to the host; then halted, those played called done, if the last
/// fill found nothing; else the half just played filled again.
pub fn interrupt(card: &mut Card, system: &mut System, at: f64, calls: &mut Vec<Callback>) {
    if !card.out.running {
        card.dma.due = None;
        return;
    }

    // The card's DMA runs on into the other half whatever the driver
    // filled last (seg4 `75c`: auto-initialised, an interrupt each 800h
    // bytes). The driver's `[61h]` names the half it filled last, which is
    // not always the one the card played: a header written to a still
    // buffer of less than half filled leaves `[61h]` naming the first half
    // (seg4 `919`) as the card goes on to the second.
    let played = card.dma.playing;

    play(card, system, at - card.dma.period(), played, HALF);
    card.dma.playing ^= HALF;
    card.dma.silence = None;

    if card.dma.half == 0 {
        card.halt(system);
        deliver_all(card, system, calls);
        return;
    }

    card.dma.half ^= 3;

    let refill = if card.dma.half == 2 { HALF } else { 0 };

    if fill(card, system, calls, HALF, refill) == 0 {
        card.dma.half = 0;
    }
}

/// `count` bytes of the buffer from `at` filled from the headers queued
/// (seg1 `629`), the rest silence: how many came from headers.
fn fill(
    card: &mut Card,
    system: &mut System,
    calls: &mut Vec<Callback>,
    count: u16,
    at: u16,
) -> u16 {
    if card.out.done != 0 {
        mark_or_deliver(card, system, calls);
    }

    let mut copied: u16 = 0;
    let mut header = card.out.head;

    if header == 0 || card.out.paused {
        silence(card, count, at, copied);
        return copied;
    }

    loop {
        if copied >= count {
            break;
        }

        let out = &mut card.out;

        if out.current == 0 {
            out.current = dword(system, header, DATA);
            out.remaining = dword(system, header, LENGTH);

            if dword(system, header, FLAGS) & BEGINLOOP != 0 {
                out.loop_start = header;
                out.loops = dword(system, header, LOOPS);
            }
        }

        if out.break_loop {
            out.loops = 0;
            out.break_loop = false;
        }

        // A loop played its times over: the rest of it skipped.
        if out.loop_start != 0 && out.loops == 0 {
            out.remaining = 0;
        }

        if out.remaining != 0 {
            let n = u32::from(count - copied).min(out.remaining);
            let bytes = huge_read(system, out.current, n);
            let from = usize::from(at + copied);

            card.dma.buffer[from..from + bytes.len()].copy_from_slice(&bytes);
            card.out.current = huge_on(card.out.current, n);
            card.out.remaining -= n;
            copied += n as u16;

            if let Some(instance) = card.out.open.as_mut() {
                instance.position = instance.position.wrapping_add(n);
            }
        }

        if card.out.remaining != 0 {
            continue;
        }

        // The header's data all gone into the buffer.
        let flags = dword(system, header, FLAGS);
        let out = &mut card.out;
        let next = if flags & ENDLOOP != 0 {
            if out.loops == 0 {
                // The loop played out: each of its headers put aside. An
                // end with no beginning puts nothing aside, and is never
                // called done, as the driver leaves it when nothing follows
                // it. With headers after it the driver walks from a null
                // pointer (seg1 `78c`-`797`: `les si,[bp-0Ch]` of nought,
                // then `[es:si+18h]`), a fault winbox.js does not follow:
                // the run stops there.
                let end = dword(system, header, NEXT);
                let mut each = out.loop_start;

                if each == 0 && end != 0 {
                    card.fault = Some("a waveform loop's end with no beginning, headers after it");
                    return copied;
                }

                while each != end && each != 0 {
                    let after = dword(system, each, NEXT);

                    set_dword(system, each, NEXT, out.done);
                    out.done = each;
                    each = after;
                }

                out.loop_start = 0;
                end
            } else {
                // Once more round the loop.
                out.loops -= 1;
                out.head = out.loop_start;
                out.loop_start
            }
        } else {
            let next = dword(system, header, NEXT);

            if out.loop_start == 0 {
                set_dword(system, header, NEXT, out.done);
                out.done = header;
            }

            next
        };

        header = next;

        if header == 0 {
            card.out.current = 0;
            card.out.remaining = 0;
            break;
        }

        let out = &mut card.out;

        out.current = dword(system, header, DATA);
        out.remaining = dword(system, header, LENGTH);

        if out.loop_start == 0 && dword(system, header, FLAGS) & BEGINLOOP != 0 {
            out.loop_start = header;
            out.loops = dword(system, header, LOOPS);
        }
    }

    card.out.head = header;

    if card.out.head == 0 && card.out.loop_start != 0 {
        card.out.head = card.out.loop_start;
    }

    if copied == 0 && !card.out.running {
        deliver_all(card, system, calls);
    }

    silence(card, count, at, copied);
    copied
}

/// The rest of a fill silence, and where it is kept for a header written
/// before it plays (seg1 `8c3`).
fn silence(card: &mut Card, count: u16, at: u16, copied: u16) {
    let rest = count - copied;

    if rest == 0 {
        card.dma.silence = None;
        return;
    }

    let from = usize::from(at + copied);

    card.dma.buffer[from..from + usize::from(rest)].fill(0x80);
    card.dma.silence = Some((at + copied, rest));
}

/// The headers put aside (seg1 `59d`): those not yet marked marked; those
/// marked at a fill before, played by now, called done.
fn mark_or_deliver(card: &mut Card, system: &mut System, calls: &mut Vec<Callback>) {
    let mut before = 0;
    let mut each = card.out.done;

    while each != 0 {
        let flags = dword(system, each, FLAGS);

        if flags & MARKED != 0 {
            break;
        }

        set_dword(system, each, FLAGS, flags | MARKED);
        before = each;
        each = dword(system, each, NEXT);
    }

    if each == 0 {
        return;
    }

    if before == 0 {
        card.out.done = 0;
    } else {
        set_dword(system, before, NEXT, 0);
    }

    while each != 0 {
        let after = dword(system, each, NEXT);

        done(card, system, calls, each);
        each = after;
    }
}

/// Every header put aside called done, last first (seg1 `56a`).
fn deliver_all(card: &mut Card, system: &mut System, calls: &mut Vec<Callback>) {
    while card.out.done != 0 {
        let each = card.out.done;

        card.out.done = dword(system, each, NEXT);
        done(card, system, calls, each);
    }
}

/// A header done (seg1 `92a`): marked done and not queued, unlinked, and
/// the program called back.
fn done(card: &Card, system: &mut System, calls: &mut Vec<Callback>, header: u32) {
    let flags = dword(system, header, FLAGS);

    set_dword(system, header, FLAGS, (flags | DONE) & !(INQUEUE | MARKED));
    set_dword(system, header, NEXT, 0);

    if let Some(instance) = card.out.open.as_ref() {
        calls.push(instance.callback(MM_WOM_DONE, header));
    }
}

/// The device reset (seg4 `6e8`, seg4 `3b2`): the card halted, and every
/// header done -- those put aside first, then those queued from the loop's
/// start or the first.
fn reset(card: &mut Card, system: &mut System, calls: &mut Vec<Callback>) {
    // What the card played of the half it was in, handed to the host as it
    // halts.
    if card.out.running
        && let Some(due) = card.dma.due
    {
        let period = card.dma.period();
        let began = due - period;
        let now = system.clock.now(system.instructions);
        let part = ((now - began) / period).clamp(0.0, 1.0);
        let count = (part * f64::from(HALF)) as u16;
        let playing = card.dma.playing;

        play(card, system, began, playing, count);
    }

    card.halt(system);

    deliver_all(card, system, calls);

    let mut each = if card.out.loop_start != 0 {
        card.out.loop_start
    } else {
        card.out.head
    };
    let out = &mut card.out;

    out.head = 0;
    out.loop_start = 0;
    out.current = 0;
    out.remaining = 0;
    out.loops = 0;

    while each != 0 {
        let after = dword(system, each, NEXT);

        done(card, system, calls, each);
        each = after;
    }
}

/// What resetting does once every header is called done (seg4 `6f0`-
/// `700`): a pause and a loop's breaking ended, the position nought.
fn after_reset(card: &mut Card) {
    card.out.paused = false;
    card.out.break_loop = false;

    if let Some(instance) = card.out.open.as_mut() {
        instance.position = 0;
    }
}

/// The position as an `MMTIME` (seg4 `47f`): bytes where they were asked
/// for, else samples.
fn position(system: &mut System, far: u32, size: u32) -> u32 {
    let played = system
        .sound_card
        .out
        .open
        .map_or(0, |instance| instance.position);

    position_sized(system, far, size, played)
}

/// A position given for an `MMTIME` of `size` bytes, as both waveform
/// devices give theirs (seg4 `47f`): a size under 8 is `MMSYSERR_ERROR`
/// (1). The size is the low word of the message's second doubleword,
/// compared unsigned (`cmp word [bp+4],8`, `jnc`), its high word unread.
pub fn position_sized(system: &mut System, far: u32, size: u32, position: u32) -> u32 {
    if (size as u16) < 8 {
        return MMSYSERR_ERROR;
    }

    write_position(system, far, position);
    0
}

/// A position written into an `MMTIME`: as bytes (`TIME_BYTES`, 4), or as
/// samples (`TIME_SAMPLES`, 2) for any other kind asked for.
pub fn write_position(system: &mut System, far: u32, position: u32) {
    if word(system, far, 0) != 4 {
        set_word(system, far, 0, 2);
    }

    set_dword(system, far, 2, position);
}

//! The MIDI sequencer, `MCISEQ.DRV`, playing a file on a MIDI device: its
//! port opened as it plays, and the file's messages sent to it in time.
//! What it answers with no file open, and a file's time format, are
//! `mci_drivers.rs`'s; this is the rest of it, **read out** of
//! `MCISEQ.DRV` (seg2 `0`-`350`, `16b2`-`1bb0`; seg3 `948`, `1084`-`1330`,
//! `16a6`-`1780`, `17c0`-`1970`, `19a2`-`1b78`, `1b7c`-`1fa9`, `1ffc`) and
//! **recorded** by `sndplay`, `adlibseq` and `seqlen` on the installation
//! with a sound card:
//!
//! * **The port.** The sequencer plays on the MIDI Mapper unless told
//!   another port. Playing opens the port if it is not open: with no MIDI
//!   output device at all that is `MCIERR_SEQ_NOMIDIPRESENT` (157h, as
//!   recorded with none). Through the mapper, the first time for the
//!   device, a file without Microsoft's mark -- a sequencer-specific meta
//!   event (`7Fh`) at its start whose first three bytes are `00 00 41` --
//!   brings up the warning that it may not play correctly with the default
//!   setup (`seq_box.rs`), as `NOTE.MID` does. The port is opened with
//!   `midiOutOpen`: `MMSYSERR_BADDEVICEID` becomes
//!   `MCIERR_SEQ_PORT_NONEXISTENT` (152h), `MMSYSERR_ALLOCATED`
//!   `MCIERR_SEQ_PORT_INUSE` (151h), `MIDIERR_NODEVICE` stays 68, anything
//!   else is 157h. The patches the file's program changes name, and the
//!   drum keys its notes on channels 10 and 16 strike, are cached on it,
//!   best fit; a port that cannot cache them is as good.
//! * **Playing** (seg2 `17e4`): from where it is, or `from`, to its end, or
//!   `to`, each in the time format; one past the file's length, or `to`
//!   before `from`, or before where it is with no `from`, is
//!   `MCIERR_OUTOFRANGE` (11Ah). It answers at once, the file played on
//!   the machine's clock; with `MCI_WAIT`, once it is played. The file's
//!   channel messages go to the port with `midiOutShortMsg`, at interrupt
//!   time, at their times by the tempo of its first track, 120 a quarter a
//!   minute until one is set. The file's length is its last event before
//!   the end of its track, the end's own delta not counted (`Song::length`);
//!   a play runs on until the first event it is not to send comes due, the
//!   end of a track among them, so a play to the end lasts to the end of
//!   the track (`due_of`). Played to its end or to `to`, its notes are let
//!   go as a stop lets them go, and the port is closed.
//! * **Stopping and pausing** (seg2 `16e`): the play stopped where it is,
//!   each channel's sustain let go and each note sounding let go (seg3
//!   `1750`, `948`), and the port closed, each channel's sustain let go a
//!   second time first (seg3 `1220`); paused, the device's mode is paused,
//!   and stays paused through a play until a stop or a seek. A note struck
//!   again while it sounds is let go first (seg3 `e2d`). **Seeking** (seg2
//!   `1a48`) to the start, the end or `to`: a play under way paused first.
//!   **Closing** stops the play, its notes let go once, and closes the
//!   port.
//! * **Times** are counted as `MCISEQ` counts them, in whole microseconds
//!   a tick and whole milliseconds (`Song::tempo_map`); a song pointer
//!   drops its fraction.
//! * **Notifying** (seg2 `226`-`33b`): a play asked to notify notifies when
//!   it is played, `MCI_NOTIFY_SUCCESSFUL`, or at once if there is nothing
//!   to play; a stop, a pause, a seek, closing, or a play from somewhere
//!   aborts it (`MCI_NOTIFY_ABORTED`); another play to the same place, or
//!   another command that notifies, supersedes it (`MCI_NOTIFY_SUPERSEDED`).
//!   Other commands notify at once. A seek that notifies is kept waiting
//!   by `MCISEQ` until its task has done the seek (seg2 `2f4`-`316`, seg3
//!   `63a`); winbox.js's seeks are done at once, and notify at once.
//! * **The mode**: playing, paused, or stopped; **the position**, where the
//!   play is.
//!
//! Not followed: a port other than the mapper (`MCI_SEQ_SET_PORT`), which
//! `mci_drivers.rs` does not take; a file timed in SMPTE frames, and one
//! with system-exclusive messages, which `MCISEQ` sends as long messages,
//! both of which stop the run as they are played; the program changes and
//! controllers a seek chases; synchronisation and the tempo set by
//! command; the sequencer's own task and timer, whose period is not read
//! out -- each message is sent at its own time. `MCISEQ` opens its port
//! asking to be called back at a function of its own and prepares two
//! headers on it for its long messages (seg3 `11b0`-`121c`), unprepared as
//! it closes it (seg3 `1220`-`1249`); winbox.js's sends no long message,
//! and does neither.

// Each has the signature every function that answers a call has.
#![allow(clippy::unnecessary_wraps)]

use std::collections::BTreeMap;

use winbox_machine::TimerId;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg};
use crate::interrupts::Interrupt;
use crate::system::System;

use super::devices::{self, Kind, MAPPER};
use super::mci::{far_at, long_at};

const MCI_OPEN_DRIVER: u16 = 0x801;
const MCI_CLOSE_DRIVER: u16 = 0x802;
const MCI_PLAY: u16 = 0x806;
const MCI_SEEK: u16 = 0x807;
const MCI_STOP: u16 = 0x808;
const MCI_PAUSE: u16 = 0x809;
const MCI_SET: u16 = 0x80d;
const MCI_STATUS: u16 = 0x814;

const MCI_NOTIFY: u32 = 0x1;
const MCI_WAIT: u32 = 0x2;
const MCI_FROM: u32 = 0x4;
const MCI_TO: u32 = 0x8;
const MCI_SEEK_TO_START: u32 = 0x100;
const MCI_SEEK_TO_END: u32 = 0x200;
const MCI_OPEN_ELEMENT: u32 = 0x200;
const MCI_SET_TIME_FORMAT: u32 = 0x400;
const MCI_STATUS_ITEM: u32 = 0x100;
const MCI_TRACK: u32 = 0x10;
const MCI_STATUS_START: u32 = 0x200;
const MCI_STATUS_POSITION: u32 = 2;
const MCI_STATUS_MODE: u32 = 4;

const MCI_MODE_STOP: u32 = 0x20d;
const MCI_MODE_PLAY: u32 = 0x20e;
const MCI_MODE_PAUSE: u32 = 0x211;
const MCI_FORMAT_MILLISECONDS: u32 = 0;
const MCI_FORMAT_SMPTE_24: u32 = 4;
const MCI_FORMAT_SMPTE_25: u32 = 5;
const MCI_FORMAT_SMPTE_30: u32 = 6;
const MCI_FORMAT_SMPTE_30DROP: u32 = 7;
const MCI_SEQ_FORMAT_SONGPTR: u32 = 0x4001;

/// What a status in an SMPTE format is given back as (seg2 `1cac`-`1cb1`):
/// hours, minutes, seconds and frames, `MCI_COLONIZED4_RETURN`.
pub const MCI_COLONIZED4_RETURN: u32 = 0x40000;

const MM_MCINOTIFY: u16 = 0x3b9;
const MCI_NOTIFY_SUCCESSFUL: u16 = 1;
const MCI_NOTIFY_SUPERSEDED: u16 = 2;
const MCI_NOTIFY_ABORTED: u16 = 4;

const MCIERR_UNRECOGNIZED_KEYWORD: u32 = 0x103;
const MCIERR_MISSING_PARAMETER: u32 = 0x111;
const MCIERR_OUTOFRANGE: u32 = 0x11a;
const MCIERR_FLAGS_NOT_COMPATIBLE: u32 = 0x11c;
const MCIERR_SEQ_PORT_INUSE: u32 = 0x151;
const MCIERR_SEQ_PORT_NONEXISTENT: u32 = 0x152;
const MCIERR_SEQ_NOMIDIPRESENT: u32 = 0x157;

const MODM_OPEN: u16 = 3;
const MODM_CLOSE: u16 = 4;
const MODM_DATA: u16 = 7;
const MODM_CACHEPATCHES: u16 = 12;
const MODM_CACHEDRUMPATCHES: u16 = 13;
const MMSYSERR_BADDEVICEID: u16 = 2;
const MMSYSERR_ALLOCATED: u16 = 4;
const MMSYSERR_NOTSUPPORTED: u32 = 8;
const MIDIERR_NODEVICE: u16 = 68;

/// `MIDI_CACHE_BESTFIT`, as the sequencer caches its patches.
const MIDI_CACHE_BESTFIT: u32 = 2;

/// A message of the file's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Event {
    /// A channel message, as `midiOutShortMsg` takes it.
    Short(u32),
    /// A system-exclusive message.
    Exclusive,
    /// A meta event, a track's end among them: nothing sent, but a play
    /// runs on to it (`Song::length`).
    Meta,
}

/// A MIDI file as the sequencer plays it.
#[derive(Debug, Clone, Default)]
pub struct Song {
    /// Ticks a quarter.
    division: u16,
    /// Its messages, by tick, the tracks' merged in order.
    events: Vec<(u32, Event)>,
    /// Its first track's tempos: from a tick on, microseconds a quarter.
    tempos: Vec<(u32, u32)>,
    /// Its length, as a tick: the latest of its tracks' last events before
    /// their ends. Each event's delta is counted once the event is read,
    /// but the end of a track's is not (seg3 `17e6`, `1aba`-`1ad6`); the
    /// length is the most any track reached (seg3 `1afc`-`1b1c`), as the
    /// sequencer reads the file through as it opens it (seg3 `24f3`-`24fb`).
    length: u32,
    /// Whether it carries Microsoft's mark (seg3 `18de`-`191c`).
    marked: bool,
    /// The patches its program changes name and the drum keys it strikes,
    /// a bit for each channel (seg3 `1a46`-`1aa8`).
    patches: Vec<u16>,
    keys: Vec<u16>,
}

impl Song {
    /// The file read, or none where it is not a MIDI file.
    pub fn parse(bytes: &[u8]) -> Option<Self> {
        if bytes.get(0..4) != Some(b"MThd") || bytes.len() < 14 {
            return None;
        }

        let mut song = Self {
            division: u16::from_be_bytes([bytes[12], bytes[13]]),
            patches: vec![0; 128],
            keys: vec![0; 128],
            ..Self::default()
        };
        let mut at = 8 + be32(bytes, 4) as usize;
        let mut track = 0;

        while at + 8 <= bytes.len() {
            let size = be32(bytes, at + 4) as usize;

            if bytes.get(at..at + 4) == Some(b"MTrk") {
                let end = bytes.len().min(at + 8 + size);

                song.track(&bytes[at + 8..end], track == 0);
                track += 1;
            }

            at = at.saturating_add(8 + size);
        }

        song.events.sort_by_key(|&(tick, _)| tick);
        song.tempos.sort_by_key(|&(tick, _)| tick);
        Some(song)
    }

    /// A track's messages taken, to its end, and the length it gives.
    fn track(&mut self, track: &[u8], first: bool) {
        let mut tick = 0u32;
        let mut status = 0u8;
        let mut at = 0usize;
        let byte = |at: usize| track.get(at).copied().unwrap_or(0);
        let number = |at: &mut usize| {
            let mut value = 0u32;

            for _ in 0..4 {
                let each = byte(*at);

                *at += 1;
                value = (value << 7) | u32::from(each & 0x7f);

                if each & 0x80 == 0 {
                    break;
                }
            }

            value
        };

        while at < track.len() {
            let delta = number(&mut at);

            tick = tick.wrapping_add(delta);

            if at >= track.len() {
                break;
            }

            if byte(at) & 0x80 != 0 {
                status = byte(at);
                at += 1;
            }

            match status {
                0xff => {
                    let kind = byte(at);

                    at += 1;

                    let size = number(&mut at) as usize;
                    let data = track.get(at..track.len().min(at + size)).unwrap_or(&[]);

                    if kind == 0x51 && first && data.len() == 3 {
                        let tempo =
                            u32::from(data[0]) << 16 | u32::from(data[1]) << 8 | u32::from(data[2]);

                        self.tempos.push((tick, tempo));
                    }

                    if kind == 0x7f && tick == 0 && data.len() >= 3 && data[..3] == [0, 0, 0x41] {
                        self.marked = true;
                    }

                    at += size;
                    self.events.push((tick, Event::Meta));

                    if kind == 0x2f {
                        self.length = self.length.max(tick.wrapping_sub(delta));
                        return;
                    }
                }
                0xf0 | 0xf7 => {
                    let size = number(&mut at) as usize;

                    self.events.push((tick, Event::Exclusive));
                    at += size;
                }
                0x80..=0xef => {
                    let size = if status & 0xf0 == 0xc0 || status & 0xf0 == 0xd0 {
                        1
                    } else {
                        2
                    };
                    let first_byte = byte(at);
                    let second_byte = if size == 2 { byte(at + 1) } else { 0 };
                    let channel = status & 0xf;

                    if status & 0xf0 == 0xc0 && first_byte < 0x80 {
                        self.patches[usize::from(first_byte)] |= 1 << channel;
                    }

                    if status & 0xf0 == 0x90 && (channel == 9 || channel == 15) && first_byte < 0x80
                    {
                        self.keys[usize::from(first_byte)] |= 1 << channel;
                    }

                    self.events.push((
                        tick,
                        Event::Short(
                            u32::from(status)
                                | u32::from(first_byte) << 8
                                | u32::from(second_byte) << 16,
                        ),
                    ));
                    at += size;
                }
                // A data byte with no status: the track is not one.
                _ => break,
            }
        }

        // A track that stops without its end: as far as it got.
        self.length = self.length.max(tick);
    }

    /// The file's tempo map as `MCISEQ` keeps it (seg3 `81a`-`8de`), each
    /// part from where it starts: its millisecond, its tick, and its
    /// microseconds a tick, whole. The first at nought, at 120 a quarter a
    /// minute -- 60,000,000 over 120 times the ticks a quarter, the
    /// fraction dropped (seg3 `b46`-`b94`); then one for each tempo of the
    /// first track, its microseconds a quarter over the ticks a quarter,
    /// the fraction dropped (seg3 `180d`-`181e`), starting at the
    /// millisecond the part before reaches it, the fraction dropped too
    /// (seg3 `8ac`-`8d9`).
    fn tempo_map(&self) -> Vec<(u32, u32, u32)> {
        let division = u32::from(self.division.max(1));
        let mut map: Vec<(u32, u32, u32)> = vec![(0, 0, 60_000_000 / (120 * division))];

        for &(tick, tempo) in &self.tempos {
            let &(ms, from, micro) = map.last().unwrap_or(&(0, 0, 0));
            let ms = ms.wrapping_add(tick.wrapping_sub(from).wrapping_mul(micro) / 1000);

            map.push((ms, tick, tempo / division));
        }

        map
    }

    /// Milliseconds from the start to a tick (sequencer message 0Fh, seg3
    /// `79a`): the last part of the map starting at or before it, and the
    /// ticks past its start at its microseconds a tick, to the nearest
    /// millisecond.
    fn ms(&self, tick: u32) -> u32 {
        let map = self.tempo_map();
        let &(ms, from, micro) = map
            .iter()
            .take_while(|&&(_, at, _)| at <= tick)
            .last()
            .unwrap_or(&map[0]);

        ms.wrapping_add(mul_div(tick.wrapping_sub(from), micro, 1000))
    }

    /// The tick a time in milliseconds is at (sequencer message 0Eh, seg3
    /// `70e`): the last part of the map starting at or before it, and the
    /// milliseconds past its start in its ticks, to the nearest tick.
    fn tick_at(&self, ms: u32) -> u32 {
        let map = self.tempo_map();
        let &(from_ms, from, micro) = map
            .iter()
            .take_while(|&&(at, _, _)| at <= ms)
            .last()
            .unwrap_or(&map[0]);

        from.wrapping_add(mul_div(ms.wrapping_sub(from_ms), 1000, micro))
    }

    /// Whether it is timed in ticks a quarter, not SMPTE frames: its
    /// division's top bit clear, and the division not nought.
    pub fn metrical(&self) -> bool {
        self.division != 0 && self.division & 0x8000 == 0
    }

    /// Its length in each time format the sequencer takes
    /// (`MCI_STATUS_LENGTH`, seg2 `1c6e`-`1c98`): the length's tick, from
    /// the sequencer's status (message 0Bh, seg3 `13d2`), in the format
    /// (seg2 `1204`).
    pub fn lengths(&self) -> Vec<(u32, u32)> {
        [
            MCI_SEQ_FORMAT_SONGPTR,
            MCI_FORMAT_MILLISECONDS,
            MCI_FORMAT_SMPTE_24,
            MCI_FORMAT_SMPTE_25,
            MCI_FORMAT_SMPTE_30,
            MCI_FORMAT_SMPTE_30DROP,
        ]
        .into_iter()
        .map(|format| (format, self.in_format(format, self.length)))
        .collect()
    }

    /// A position in a time format, as a tick (seg2 `10e6`): milliseconds
    /// by the tempo map; SMPTE as milliseconds (`smpte_ms`); song pointers,
    /// sixteenths, times the ticks a quarter over four, the fraction
    /// dropped.
    fn to_tick(&self, format: u32, value: u32) -> u32 {
        match format {
            MCI_FORMAT_MILLISECONDS => self.tick_at(value),
            MCI_FORMAT_SMPTE_24..=MCI_FORMAT_SMPTE_30DROP => self.tick_at(smpte_ms(format, value)),
            _ => value.wrapping_mul(u32::from(self.division)) >> 2,
        }
    }

    /// A tick in a time format (seg2 `1204`): milliseconds by the tempo
    /// map; SMPTE, those milliseconds as frames (`smpte`); song pointers,
    /// the tick times four over the ticks a quarter, the fraction dropped.
    fn in_format(&self, format: u32, tick: u32) -> u32 {
        match format {
            MCI_FORMAT_MILLISECONDS => self.ms(tick),
            MCI_FORMAT_SMPTE_24..=MCI_FORMAT_SMPTE_30DROP => smpte(format, self.ms(tick)),
            _ => (tick << 2) / u32::from(self.division.max(1)),
        }
    }

    /// Whether a position in a time format is past the file's length (seg2
    /// `1352`): in song pointers or milliseconds, more than the length in
    /// them; in SMPTE, a frame, second or minute past its count, an hour
    /// past 24, or later than the length in milliseconds.
    fn past(&self, format: u32, value: u32) -> bool {
        if !(MCI_FORMAT_SMPTE_24..=MCI_FORMAT_SMPTE_30DROP).contains(&format) {
            return value > self.in_format(format, self.length);
        }

        let [hours, minutes, seconds, frames] = value.to_le_bytes();

        u32::from(frames) >= frames_a_second(format)
            || seconds >= 60
            || minutes >= 60
            || hours > 24
            || smpte_ms(format, value) > smpte_ms(format, self.in_format(format, self.length))
    }
}

/// An SMPTE format's frames a second (seg2 `e6a`): 24, 25, or 30 for
/// both of 30's, with drop frames and without -- none is dropped.
fn frames_a_second(format: u32) -> u32 {
    match format {
        MCI_FORMAT_SMPTE_24 => 24,
        MCI_FORMAT_SMPTE_25 => 25,
        _ => 30,
    }
}

/// Milliseconds in an SMPTE format (seg2 `f86`): the frames they make, the
/// fraction dropped, as hours, minutes, seconds and frames, a byte each
/// from the lowest. **Recorded** by `seqlen`: 495 milliseconds are frame
/// 11 at 24 a second, 12 at 25, 14 at 30.
fn smpte(format: u32, ms: u32) -> u32 {
    let rate = frames_a_second(format);
    let frames = ms.wrapping_mul(rate) / 1000;
    let hour = rate * 3600;
    let minute = rate * 60;

    ((frames / hour) & 0xff)
        | ((frames % hour / minute) & 0xff) << 8
        | ((frames % minute / rate) & 0xff) << 16
        | ((frames % rate) & 0xff) << 24
}

/// An SMPTE time in milliseconds (seg2 `ed6`, `f30`): its frames, counted
/// from its hours, minutes and seconds, at the format's rate, to the
/// nearest millisecond.
fn smpte_ms(format: u32, value: u32) -> u32 {
    let rate = frames_a_second(format);
    let [hours, minutes, seconds, frames] = value.to_le_bytes();
    let frames = ((u32::from(hours) * 60 + u32::from(minutes)) * 60 + u32::from(seconds))
        .wrapping_mul(rate)
        .wrapping_add(u32::from(frames));

    frames.wrapping_mul(1000).wrapping_add(rate / 2) / rate
}

/// `MCISEQ`'s `MulDiv` (seg3 `3a`): `a` times `b` over `c`, half of `c`
/// added first so that it rounds to the nearest; a quotient past the
/// largest signed doubleword, or a division by nought, is that largest.
fn mul_div(a: u32, b: u32, c: u32) -> u32 {
    let (a, b, c) = (
        i64::from(a as i32),
        i64::from(b as i32),
        i64::from(c as i32),
    );
    let negative = (a < 0) ^ (b < 0) ^ (c < 0);
    let (a, b, c) = (a.unsigned_abs(), b.unsigned_abs(), c.unsigned_abs());
    let product = a * b + c / 2;

    if c == 0 || product >> 32 >= c || product / c > 0x7fff_ffff {
        return if negative { 0x8000_0000 } else { 0x7fff_ffff };
    }

    let quotient = (product / c) as u32;

    if negative {
        quotient.wrapping_neg()
    } else {
        quotient
    }
}

fn be32(bytes: &[u8], at: usize) -> u32 {
    bytes.get(at..at + 4).map_or(0, |four| {
        u32::from_be_bytes([four[0], four[1], four[2], four[3]])
    })
}

/// A play under way: when it began on the clock, from and to which tick,
/// whether to the file's end, the next message to send, and the clock's
/// timer for it.
#[derive(Debug, Clone)]
struct Playing {
    began: f64,
    from: u32,
    to: u32,
    whole: bool,
    next: usize,
    timer: Option<TimerId>,
}

/// A notification waiting: the window, the command, and where a play is
/// to end (`[98h]`-`[9Eh]`).
#[derive(Debug, Clone, Copy)]
struct Pending {
    hwnd: u16,
    command: u16,
    to: u32,
}

/// A device with a file open.
#[derive(Debug, Clone)]
struct Player {
    song: Song,
    format: u32,
    /// Where it is, as a tick, while it is not playing.
    position: u32,
    /// The port's number, and its handle while it is open (`[8Ah]`,
    /// `[7Ah]`).
    port_id: u16,
    port: u16,
    /// Whether the warning has been shown for it (`[AAh]`).
    warned: bool,
    /// Whether it is paused (`[A8h]`).
    paused: bool,
    playing: Option<Playing>,
    pending: Option<Pending>,
    /// The notes sounding, a bit for each key of each channel (`[286h]`).
    notes: [u128; 16],
    /// The task that plays it, woken to send its messages.
    task: u16,
}

/// The sequencer's devices with a file open, by their device's ID.
#[derive(Debug, Default)]
pub struct Sequencer {
    players: BTreeMap<u16, Player>,
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "DriverProc" => Implementation::Async(driver_proc_call),
        _ => return super::mci_drivers::implementation(name),
    })
}

fn driver_proc_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (id, handle, message, first, second) = {
            let system = engine.system();

            (
                args.dword(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Dword(
            driver_proc(engine, id, handle, message, first, second).await?,
        ))
    })
}

/// `MCISEQ`'s `DriverProc`: the commands of a device with a file open that
/// play, stop and tell where it is; the rest as `mci_drivers.rs` answers.
pub async fn driver_proc(
    engine: &Engine,
    id: u32,
    handle: u16,
    message: u16,
    first: u32,
    second: u32,
) -> Result<u32, Stop> {
    let delegate = |engine: &Engine| {
        super::mci_drivers::driver_proc(
            &mut engine.system(),
            "MCISEQ",
            id,
            handle,
            message,
            first,
            second,
        )
    };
    let device = id as u16;

    if id >> 16 != 0 || !(0x800..=0x17ff).contains(&message) {
        return delegate(engine);
    }

    let (flags, parms) = (first, second);
    let player = engine
        .system()
        .mmsystem
        .sequencer
        .players
        .contains_key(&device);

    match message {
        MCI_OPEN_DRIVER => {
            let answer = delegate(engine)?;

            if answer == 0 && flags & MCI_OPEN_ELEMENT != 0 {
                let mut system = engine.system();

                if let Some(song) = read_song(&mut system, parms) {
                    let task = system.task_handle;

                    system.mmsystem.sequencer.players.insert(
                        device,
                        Player {
                            song,
                            format: MCI_SEQ_FORMAT_SONGPTR,
                            position: 0,
                            port_id: MAPPER,
                            port: 0,
                            warned: false,
                            paused: false,
                            playing: None,
                            pending: None,
                            notes: [0; 16],
                            task,
                        },
                    );
                }
            }

            Ok(answer)
        }
        MCI_CLOSE_DRIVER => {
            if player {
                close(engine, device, flags).await?;
            }

            delegate(engine)
        }
        MCI_PLAY if player => command(engine, device, message, flags, parms).await,
        MCI_SEEK | MCI_STOP | MCI_PAUSE if player => {
            command(engine, device, message, flags, parms).await
        }
        MCI_STATUS if player && flags & MCI_STATUS_ITEM != 0 => {
            let item = long_at(&engine.system(), far_at(parms, 8));

            // The position of a track or of the start is nought, whatever
            // is playing (seg2 `1cba`-`1cea`), as with nothing played.
            let fixed = flags & (MCI_TRACK | MCI_STATUS_START) != 0;

            if item == MCI_STATUS_MODE || (item == MCI_STATUS_POSITION && !fixed) {
                command(engine, device, message, flags, parms).await
            } else {
                delegate(engine)
            }
        }
        MCI_SET => {
            let answer = delegate(engine)?;

            if answer == 0 && flags & MCI_SET_TIME_FORMAT != 0 {
                let mut system = engine.system();
                let format = long_at(&system, far_at(parms, 4));

                if let Some(player) = system.mmsystem.sequencer.players.get_mut(&device) {
                    player.format = format;
                }
            }

            Ok(answer)
        }
        _ => delegate(engine),
    }
}

/// The file an `MCI_OPEN_PARMS` names, read.
fn read_song(system: &mut System, parms: u32) -> Option<Song> {
    let far = long_at(system, far_at(parms, 12));
    let name: String = system
        .read_string(far)
        .iter()
        .map(|&byte| char::from(byte))
        .collect();
    let handle = system.files.open(&name)?;
    let bytes = system.files.resolve(handle).map_or_else(Vec::new, |file| {
        let size = file.size() as usize;

        file.read(size)
    });

    system.files.close(handle);
    Song::parse(&bytes)
}

/// A command of a device with a file open, and what it notifies (seg2
/// `21d`-`33b`).
async fn command(
    engine: &Engine,
    device: u16,
    message: u16,
    flags: u32,
    parms: u32,
) -> Result<u32, Stop> {
    let mut returned = 0;
    let answer = match message {
        MCI_PLAY => play(engine, device, flags, parms).await?,
        MCI_SEEK => seek(engine, device, flags, parms).await?,
        MCI_STOP | MCI_PAUSE => {
            // Stopped (sequencer message 9), then the port closed with its
            // notes let go again (message 0Dh with 1; seg2 `16e`-`1ba`).
            stop(engine, device, message == MCI_PAUSE).await?;
            close_port(engine, device, true).await?;
            Ok(0)
        }
        _ => {
            returned = status(engine, device, parms);
            Ok(0)
        }
    };
    let to = match answer {
        Ok(to) => to,
        Err(error) => return Ok(error),
    };

    notify_after(engine, device, message, flags, parms, to);
    Ok(returned)
}

/// What a command that succeeded does to the notification waiting, and
/// its own: `to` where a play is to end.
fn notify_after(engine: &Engine, device: u16, message: u16, flags: u32, parms: u32, to: u32) {
    let mut system = engine.system();
    let Some(player) = system.mmsystem.sequencer.players.get_mut(&device) else {
        return;
    };
    let mut posts = Vec::new();

    if let Some(pending) = player.pending {
        if aborts(pending, message, flags, to) {
            posts.push((pending.hwnd, MCI_NOTIFY_ABORTED));
            player.pending = None;
        } else if flags & MCI_NOTIFY != 0 {
            posts.push((pending.hwnd, MCI_NOTIFY_SUPERSEDED));
            player.pending = None;
        }
    }

    if flags & MCI_NOTIFY != 0 {
        let hwnd = long_at(&system, parms) as u16;
        let Some(player) = system.mmsystem.sequencer.players.get_mut(&device) else {
            return;
        };

        // A play notifies when it is played, unless it is where it is to
        // end already; anything else at once.
        let waiting = message == MCI_PLAY && player.playing.is_some();

        if waiting {
            player.pending = Some(Pending {
                hwnd,
                command: message,
                to,
            });
        } else {
            posts.push((hwnd, MCI_NOTIFY_SUCCESSFUL));
        }
    }

    for (hwnd, status) in posts {
        system.post_message(hwnd, MM_MCINOTIFY, status, u32::from(device));
    }
}

/// Whether a command aborts the notification waiting rather than
/// superseding it (seg2 `348`): a play's, by closing, seeking, stopping or
/// pausing, or a play from somewhere or to somewhere else; a seek's, by
/// closing, another seek, or a play from somewhere.
fn aborts(pending: Pending, message: u16, flags: u32, to: u32) -> bool {
    match pending.command {
        MCI_PLAY => match message {
            MCI_CLOSE_DRIVER | MCI_SEEK | MCI_STOP | MCI_PAUSE => true,
            MCI_PLAY => flags & MCI_FROM != 0 || to != pending.to,
            _ => false,
        },
        MCI_SEEK => match message {
            MCI_CLOSE_DRIVER | MCI_SEEK => true,
            MCI_PLAY => flags & MCI_FROM != 0,
            _ => false,
        },
        _ => false,
    }
}

/// Where a play from `position`, or `from`, to `to` begins and ends, as
/// ticks, and whether to the file's end; or `MCIERR_OUTOFRANGE`. Each of
/// `from` and `to` is to be within the length in the format (seg2 `1352`);
/// then, as ticks, `from` not after `to`, or where it is not after `to`
/// (seg2 `18d2`-`190c`). `to` the length in the format is the file's last
/// tick itself (seg2 `1812`-`185c`).
fn play_range(
    player: &Player,
    position: u32,
    flags: u32,
    from: u32,
    to: u32,
) -> Result<(u32, u32, bool), u32> {
    let song = &player.song;
    let length = song.in_format(player.format, song.length);
    let to_tick = if to == length {
        song.length
    } else {
        song.to_tick(player.format, to)
    };
    let from_tick = song.to_tick(player.format, from);

    if (flags & MCI_TO != 0 && song.past(player.format, to))
        || (flags & MCI_FROM != 0 && song.past(player.format, from))
        || (flags & MCI_FROM != 0 && flags & MCI_TO != 0 && from_tick > to_tick)
        || (flags & MCI_FROM == 0 && flags & MCI_TO != 0 && position > to_tick)
    {
        return Err(MCIERR_OUTOFRANGE);
    }

    let start = if flags & MCI_FROM != 0 {
        from_tick
    } else {
        position
    };

    Ok(if flags & MCI_TO != 0 && to < length {
        (start, to_tick, false)
    } else {
        (start, song.length, true)
    })
}

/// `MCI_PLAY` (seg2 `17e4`): the port opened, and the file played from and
/// to where it was asked. Where the play is to end, as a tick, or the
/// error.
async fn play(
    engine: &Engine,
    device: u16,
    flags: u32,
    parms: u32,
) -> Result<Result<u32, u32>, Stop> {
    if let Err(error) = open_port(engine, device).await? {
        return Ok(Err(error));
    }

    let checked = {
        let system = engine.system();
        let now = system.clock.now(system.instructions);
        let from = long_at(&system, far_at(parms, 4));
        let to = long_at(&system, far_at(parms, 8));
        let Some(player) = system.mmsystem.sequencer.players.get(&device) else {
            return Ok(Err(MCIERR_UNRECOGNIZED_KEYWORD));
        };

        play_range(player, current(player, now), flags, from, to)
    };
    let (start, end, whole) = match checked {
        Ok(found) => found,
        Err(error) => {
            // The port closed again, unless a play is under way on it
            // (seg2 `1a1a`).
            let playing = engine
                .system()
                .mmsystem
                .sequencer
                .players
                .get(&device)
                .is_some_and(|player| player.playing.is_some());

            if !playing {
                close_port(engine, device, false).await?;
            }

            return Ok(Err(error));
        }
    };

    {
        let mut system = engine.system();
        let now = system.clock.now(system.instructions);
        let Some(player) = system.mmsystem.sequencer.players.get_mut(&device) else {
            return Ok(Err(MCIERR_UNRECOGNIZED_KEYWORD));
        };

        if player.song.division & 0x8000 != 0 {
            return Err(Stop::Unsupported(
                "the sequencer playing a file timed in SMPTE frames",
            ));
        }

        if player.song.events.iter().any(|&(tick, event)| {
            event == Event::Exclusive && tick >= start && (tick < end || whole)
        }) {
            return Err(Stop::Unsupported(
                "the sequencer playing a system-exclusive message",
            ));
        }

        if let Some(timer) = player.playing.take().and_then(|playing| playing.timer) {
            system.clock.cancel(timer);
        }

        let Some(player) = system.mmsystem.sequencer.players.get_mut(&device) else {
            return Ok(Err(MCIERR_UNRECOGNIZED_KEYWORD));
        };
        let next = player
            .song
            .events
            .partition_point(|&(tick, _)| tick < start);

        // Playing leaves the device's pause as it was (`[A8h]`, set only by
        // pausing and cleared by stopping and seeking, seg2 `14e`-`183`):
        // a play after a pause, played to its end, is paused again.
        player.position = start;
        player.playing = Some(Playing {
            began: now,
            from: start,
            to: end,
            whole,
            next,
            timer: None,
        });
        system.poll_sequencer();
    }

    if flags & MCI_WAIT != 0 {
        supersede_for_wait(engine, device, flags, end);
        wait_played(engine, device).await?;
    }

    Ok(Ok(end))
}

/// A play that waits supersedes the notification waiting, or aborts it
/// (seg2 `1988`-`19e9`).
fn supersede_for_wait(engine: &Engine, device: u16, flags: u32, end: u32) {
    let mut system = engine.system();
    let Some(player) = system.mmsystem.sequencer.players.get_mut(&device) else {
        return;
    };
    let Some(pending) = player.pending.take() else {
        return;
    };
    let status = match pending.command {
        MCI_PLAY if flags & MCI_FROM == 0 && end == pending.to => MCI_NOTIFY_SUPERSEDED,
        MCI_PLAY => MCI_NOTIFY_ABORTED,
        _ => MCI_NOTIFY_SUPERSEDED,
    };

    system.post_message(pending.hwnd, MM_MCINOTIFY, status, u32::from(device));
}

/// Waits for a play to end, its messages sent as their times come: the
/// machine's time passing to each in turn.
async fn wait_played(engine: &Engine, device: u16) -> Result<(), Stop> {
    loop {
        let wait = {
            let mut system = engine.system();

            system.poll_sequencer();

            let now = system.clock.now(system.instructions);

            system
                .mmsystem
                .sequencer
                .players
                .get(&device)
                .and_then(|player| {
                    let playing = player.playing.as_ref()?;

                    Some((due_of(player, playing).unwrap_or(now) - now).max(0.0))
                })
        };
        let Some(wait) = wait else {
            engine.take_interrupts().await?;
            return Ok(());
        };

        engine.take_interrupts().await?;

        let virtual_clock = {
            let mut system = engine.system();
            let virtual_clock = system.clock.is_virtual();

            if virtual_clock {
                let instructions = system.instructions;

                system.clock.advance(instructions, wait);
            }

            virtual_clock
        };

        if !virtual_clock && wait > 0.0 {
            engine.wait_host(wait.min(50.0)).await;
        }
    }
}

/// Where a device is, as a tick: where its play has got to, or where it
/// stopped.
fn current(player: &Player, now: f64) -> u32 {
    match &player.playing {
        Some(playing) => {
            let song = &player.song;
            let reached = f64::from(song.ms(playing.from)) + (now - playing.began).max(0.0);

            song.tick_at(reached.floor() as u32).min(playing.to)
        }
        None => player.position,
    }
}

/// When the next message of a play is due on the clock, or its end. The
/// sequencer sends each event in turn as its time comes, and a play ends as
/// the first event it is not to send comes due (seg3 `1d53`-`1d9e`): one
/// past `to`, or at it where `to` is short of the file's length -- a meta
/// event, a track's end among them, as much as a message. A whole play
/// therefore runs on past its last message, to the end of the track that
/// ends after it: `adlibseq`'s, half a second, and `play ... wait` waits
/// for it. With nothing left in the file, it ends as its last event is
/// sent (seg3 `1f0c`, `1f9c`).
fn due_of(player: &Player, playing: &Playing) -> Option<f64> {
    let song = &player.song;
    let start = f64::from(song.ms(playing.from));
    let tick = match song.events.get(playing.next) {
        Some(&(tick, _)) => tick,
        None => song
            .events
            .last()
            .map_or(playing.from, |&(tick, _)| tick.max(playing.from)),
    };

    Some(playing.began + f64::from(song.ms(tick)) - start)
}

/// The port opened for a play (seg2 `16b2`), the warning shown first where
/// it is to be: nothing, or the error.
async fn open_port(engine: &Engine, device: u16) -> Result<Result<(), u32>, Stop> {
    let (port, port_id, creator, warn) = {
        let mut system = engine.system();
        let Some(player) = system.mmsystem.sequencer.players.get(&device) else {
            return Ok(Err(MCIERR_UNRECOGNIZED_KEYWORD));
        };
        let (port, port_id, creator, warned, marked) = (
            player.port,
            player.port_id,
            player.task,
            player.warned,
            player.song.marked,
        );

        if port != 0 {
            return Ok(Ok(()));
        }

        if system.mmsystem.devices.count(Kind::MidiOut) == 0 {
            return Ok(Err(MCIERR_SEQ_NOMIDIPRESENT));
        }

        let warn = !warned && port_id == MAPPER && !marked;
        let shown = warn && !super::seq_box::disabled(&mut system);

        (port, port_id, creator, (warn, shown))
    };

    debug_assert_eq!(port, 0);

    let (warn, shown) = warn;

    if shown && super::seq_box::warn(engine, creator).await? != 0 {
        engine.system().write_profile_entry(
            b"system.ini",
            b"mciseq.drv",
            b"disablewarning",
            b"true",
        );
    }

    if warn && let Some(player) = engine.system().mmsystem.sequencer.players.get_mut(&device) {
        player.warned = true;
    }

    let (answer, handle) = open_device(engine, port_id).await?;
    let handle = match (answer, handle) {
        (0, Some(handle)) => handle,
        (MMSYSERR_BADDEVICEID, _) => return Ok(Err(MCIERR_SEQ_PORT_NONEXISTENT)),
        (MMSYSERR_ALLOCATED, _) => return Ok(Err(MCIERR_SEQ_PORT_INUSE)),
        (MIDIERR_NODEVICE, _) => return Ok(Err(u32::from(MIDIERR_NODEVICE))),
        _ => return Ok(Err(MCIERR_SEQ_NOMIDIPRESENT)),
    };

    if let Some(player) = engine.system().mmsystem.sequencer.players.get_mut(&device) {
        player.port = handle;
    }

    // The patches and drum keys cached (seg3 `1ffc`).
    let (patches, keys) = {
        let system = engine.system();
        let player = &system.mmsystem.sequencer.players[&device];

        (player.song.patches.clone(), player.song.keys.clone())
    };
    let mut answer = cache(engine, handle, MODM_CACHEPATCHES, &patches).await?;

    if answer == 0 {
        answer = cache(engine, handle, MODM_CACHEDRUMPATCHES, &keys).await?;
    }

    if answer != 0 && answer != MMSYSERR_NOTSUPPORTED {
        devices::close(engine, handle, Kind::MidiOut, MODM_CLOSE).await?;

        if let Some(player) = engine.system().mmsystem.sequencer.players.get_mut(&device) {
            player.port = 0;
        }

        return Ok(Err(match answer as u16 {
            MMSYSERR_BADDEVICEID => MCIERR_SEQ_PORT_NONEXISTENT,
            MMSYSERR_ALLOCATED => MCIERR_SEQ_PORT_INUSE,
            MIDIERR_NODEVICE => u32::from(MIDIERR_NODEVICE),
            _ => MCIERR_SEQ_NOMIDIPRESENT,
        }));
    }

    Ok(Ok(()))
}

/// The port opened as `midiOutOpen` opens it: `MCISEQ` asks to be called
/// back at a function of its own, which winbox.js's has no need of.
async fn open_device(engine: &Engine, id: u16) -> Result<(u16, Option<u16>), Stop> {
    let found = {
        let system = engine.system();
        let devices = &system.mmsystem.devices;

        devices.place_of(Kind::MidiOut, id).map(|(place, device)| {
            (
                place,
                device,
                devices.table(Kind::MidiOut).entries[place]
                    .procedure
                    .is_some(),
            )
        })
    };
    let Some((place, device, installed)) = found else {
        return Ok((MMSYSERR_BADDEVICEID, None));
    };

    if !installed {
        return Ok((6, None));
    }

    let describe = |opened: u16| {
        let mut bytes = opened.to_le_bytes().to_vec();

        bytes.extend_from_slice(&[0; 8]);
        bytes
    };

    devices::open(
        engine,
        Kind::MidiOut,
        place,
        device,
        id,
        MODM_OPEN,
        describe,
        0,
        false,
        devices::Keep::Handle,
    )
    .await
}

/// Patches or drum keys cached on the port, best fit, as
/// `midiOutCachePatches` caches them: what it answered.
async fn cache(engine: &Engine, handle: u16, message: u16, bits: &[u16]) -> Result<u32, Stop> {
    let bytes: Vec<u8> = bits.iter().flat_map(|bits| bits.to_le_bytes()).collect();
    let frame = devices::below_stack(&mut engine.system(), &[&bytes]);
    let answer = devices::send_by_handle(
        engine,
        handle,
        Kind::MidiOut,
        message,
        frame.pointers[0],
        MIDI_CACHE_BESTFIT,
    )
    .await?
    .unwrap_or(0);

    frame.release(&mut engine.system());
    Ok(answer)
}

/// `MCI_SEEK` (seg2 `1a48`): to the start, the end, or `to`, a play under
/// way paused first.
async fn seek(
    engine: &Engine,
    device: u16,
    flags: u32,
    parms: u32,
) -> Result<Result<u32, u32>, Stop> {
    let asked = flags & !(MCI_NOTIFY | MCI_WAIT);

    if asked == 0 {
        return Ok(Err(MCIERR_MISSING_PARAMETER));
    }

    if asked & !(MCI_TO | MCI_SEEK_TO_START | MCI_SEEK_TO_END) != 0 {
        return Ok(Err(MCIERR_UNRECOGNIZED_KEYWORD));
    }

    let tick = {
        let system = engine.system();
        let to = long_at(&system, far_at(parms, 4));
        let Some(player) = system.mmsystem.sequencer.players.get(&device) else {
            return Ok(Err(MCIERR_UNRECOGNIZED_KEYWORD));
        };
        let song = &player.song;

        match asked {
            MCI_TO if song.past(player.format, to) => {
                return Ok(Err(MCIERR_OUTOFRANGE));
            }
            MCI_TO => song.to_tick(player.format, to),
            MCI_SEEK_TO_START => 0,
            MCI_SEEK_TO_END => song.length,
            _ => return Ok(Err(MCIERR_FLAGS_NOT_COMPATIBLE)),
        }
    };
    let playing = engine
        .system()
        .mmsystem
        .sequencer
        .players
        .get(&device)
        .is_some_and(|player| player.playing.is_some());

    if let Some(player) = engine.system().mmsystem.sequencer.players.get_mut(&device) {
        player.paused = false;
    }

    // Paused as `MCI_PAUSE` pauses, which aborts a play's notification.
    if playing {
        stop(engine, device, true).await?;
        close_port(engine, device, true).await?;
        notify_after(engine, device, MCI_PAUSE, 0, 0, 0);
    }

    if let Some(player) = engine.system().mmsystem.sequencer.players.get_mut(&device) {
        player.position = tick;
    }

    Ok(Ok(tick))
}

/// A play stopped where it is, paused or not, and its notes let go
/// (sequencer message 9, seg3 `1750`): each channel's sustain let go and
/// each note sounding let go, on the port while it is open (seg3 `948`).
async fn stop(engine: &Engine, device: u16, paused: bool) -> Result<(), Stop> {
    // What has come due is sent first, as it would have been.
    engine.system().poll_sequencer();
    engine.take_interrupts().await?;

    {
        let mut system = engine.system();
        let now = system.clock.now(system.instructions);
        let Some(player) = system.mmsystem.sequencer.players.get_mut(&device) else {
            return Ok(());
        };
        let position = current(player, now);
        let timer = player.playing.take().and_then(|playing| playing.timer);

        player.position = position;
        player.paused = paused;

        if let Some(timer) = timer {
            system.clock.cancel(timer);
        }
    }

    let_go(engine, device).await
}

/// Each channel's sustain let go, then the notes of the channel sounding,
/// on the port while it is open, and the notes forgotten (seg3 `948`):
/// `B0h` with controller 40h nought, then `80h` with each key and
/// velocity 40h, channel by channel.
async fn let_go(engine: &Engine, device: u16) -> Result<(), Stop> {
    let (port, notes) = {
        let mut system = engine.system();
        let Some(player) = system.mmsystem.sequencer.players.get_mut(&device) else {
            return Ok(());
        };

        if player.port == 0 {
            return Ok(());
        }

        (player.port, std::mem::take(&mut player.notes))
    };

    for (channel, keys) in notes.iter().enumerate() {
        let channel = channel as u32;

        send(engine, port, 0xb0 | channel | 0x40 << 8).await?;

        for key in (0..128u32).filter(|&key| keys & (1u128 << key) != 0) {
            send(engine, port, 0x80 | channel | key << 8 | 0x40 << 16).await?;
        }
    }

    Ok(())
}

/// The port closed (sequencer message 0Dh, seg3 `1220`), its notes let go
/// first where `let_go_first` (seg3 `948`): after a stop, which let them go
/// already, that is each channel's sustain let go a second time. Closed
/// without, the notes sounding are kept, as `MCISEQ` keeps them.
async fn close_port(engine: &Engine, device: u16, let_go_first: bool) -> Result<(), Stop> {
    if let_go_first {
        let_go(engine, device).await?;
    }

    let port = {
        let mut system = engine.system();
        let Some(player) = system.mmsystem.sequencer.players.get_mut(&device) else {
            return Ok(());
        };

        std::mem::take(&mut player.port)
    };

    if port != 0 {
        devices::close(engine, port, Kind::MidiOut, MODM_CLOSE).await?;
    }

    Ok(())
}

/// A short message sent on the port, as `midiOutShortMsg` sends it.
async fn send(engine: &Engine, port: u16, message: u32) -> Result<(), Stop> {
    devices::send_by_handle(engine, port, Kind::MidiOut, MODM_DATA, message, 0).await?;
    Ok(())
}

/// The device closed (seg2 `1616`): the play stopped and its notes let go
/// once (sequencer message 9), then the port closed with nothing let go
/// again (message 0Dh with nought); a notification waiting superseded if
/// the close notifies and nothing else, else aborted.
async fn close(engine: &Engine, device: u16, flags: u32) -> Result<(), Stop> {
    stop(engine, device, false).await?;
    close_port(engine, device, false).await?;

    let mut system = engine.system();

    if let Some(player) = system.mmsystem.sequencer.players.remove(&device)
        && let Some(pending) = player.pending
    {
        let status = if flags == MCI_NOTIFY {
            MCI_NOTIFY_SUPERSEDED
        } else {
            MCI_NOTIFY_ABORTED
        };

        system.post_message(pending.hwnd, MM_MCINOTIFY, status, u32::from(device));
    }

    Ok(())
}

/// `MCI_STATUS` of the mode or the position (seg2 `1bb0`); what the
/// position is given back as, in an SMPTE format.
fn status(engine: &Engine, device: u16, parms: u32) -> u32 {
    let mut system = engine.system();
    let now = system.clock.now(system.instructions);
    let item = long_at(&system, far_at(parms, 8));
    let Some(player) = system.mmsystem.sequencer.players.get(&device) else {
        return 0;
    };
    let returned = if item != MCI_STATUS_MODE
        && (MCI_FORMAT_SMPTE_24..=MCI_FORMAT_SMPTE_30DROP).contains(&player.format)
    {
        MCI_COLONIZED4_RETURN
    } else {
        0
    };
    let answer = if item == MCI_STATUS_MODE {
        if player.playing.is_some() {
            MCI_MODE_PLAY
        } else if player.paused {
            MCI_MODE_PAUSE
        } else {
            MCI_MODE_STOP
        }
    } else {
        player.song.in_format(player.format, current(player, now))
    };

    system.write_far(far_at(parms, 4), &answer.to_le_bytes());
    returned
}

impl System {
    /// The sequencer's messages come due, at interrupt time: each sent to
    /// its port as `midiOutShortMsg` sends it, and a play played to its end
    /// closed and notified, as `MCISEQ`'s timer and task do. Looked at as
    /// MMSYSTEM's timer events are (`time.rs`).
    pub(crate) fn poll_sequencer(&mut self) {
        let playing: Vec<u16> = self
            .mmsystem
            .sequencer
            .players
            .iter()
            .filter(|(_, player)| player.playing.is_some())
            .map(|(&device, _)| device)
            .collect();

        for device in playing {
            self.poll_player(device);
        }
    }

    fn poll_player(&mut self, device: u16) {
        let now = self.clock.now(self.instructions);
        let Some(mut player) = self.mmsystem.sequencer.players.remove(&device) else {
            return;
        };
        let Some(mut playing) = player.playing.take() else {
            self.mmsystem.sequencer.players.insert(device, player);
            return;
        };
        let short = self.mmsystem_proc("midiOutShortMsg");
        let start = f64::from(player.song.ms(playing.from));

        while let Some(&(tick, event)) = player.song.events.get(playing.next) {
            let within = tick < playing.to || (playing.whole && tick <= playing.to);

            if !within || playing.began + f64::from(player.song.ms(tick)) - start > now {
                break;
            }

            playing.next += 1;

            // Nothing is sent, nor any note kept, with the port closed
            // (seg3 `dfd`).
            if let Event::Short(message) = event
                && player.port != 0
            {
                let again = note(&mut player.notes, message);

                for message in again.into_iter().chain([message]) {
                    self.at_interrupt(
                        Interrupt {
                            proc: short,
                            args: vec![GuestArg::Word(player.port), GuestArg::Long(message)],
                            key: None,
                        },
                        Some(player.task),
                    );
                }
            }
        }

        if let Some(timer) = playing.timer.take() {
            self.clock.cancel(timer);
        }

        let due = due_of(&player, &playing).unwrap_or(now);
        let more = player
            .song
            .events
            .get(playing.next)
            .is_some_and(|&(tick, _)| tick < playing.to || (playing.whole && tick <= playing.to));

        if more || due > now {
            playing.timer = Some(self.clock.after(self.instructions, (due - now).max(0.0)));
            player.playing = Some(playing);
        } else {
            // Played to its end, or to `to`: where it is, `to` (seg3
            // `1eb8`-`1ed8`); the play stopped at interrupt time, each
            // channel's sustain and each note still sounding let go, as a
            // stop lets them go (seg3 `1c80`-`1ca9`, `1750`, `948`); then
            // the port closed by the sequencer's task, nothing let go again
            // (seg2 `cf0`-`d18`), and the play notified. Nothing at `to`
            // itself is sent where `to` is short of the file's end: a note
            // ending there is let go with the rest.
            player.position = playing.to;

            if player.port != 0 {
                let mut messages = Vec::new();

                for (channel, keys) in std::mem::take(&mut player.notes).iter().enumerate() {
                    let channel = channel as u32;

                    messages.push(0xb0 | channel | 0x40 << 8);
                    messages.extend(
                        (0..128u32)
                            .filter(|&key| keys & (1u128 << key) != 0)
                            .map(|key| 0x80 | channel | key << 8 | 0x40 << 16),
                    );
                }

                for message in messages {
                    self.at_interrupt(
                        Interrupt {
                            proc: short,
                            args: vec![GuestArg::Word(player.port), GuestArg::Long(message)],
                            key: None,
                        },
                        Some(player.task),
                    );
                }
            }

            if player.port != 0 {
                let close = self.mmsystem_proc("midiOutClose");

                self.at_interrupt(
                    Interrupt {
                        proc: close,
                        args: vec![GuestArg::Word(player.port)],
                        key: None,
                    },
                    Some(player.task),
                );
                player.port = 0;
            }

            if let Some(pending) = player.pending.take() {
                self.post_message(
                    pending.hwnd,
                    MM_MCINOTIFY,
                    MCI_NOTIFY_SUCCESSFUL,
                    u32::from(device),
                );
            }
        }

        self.mmsystem.sequencer.players.insert(device, player);
    }

    /// One of MMSYSTEM's exports, as a far pointer a program could call.
    fn mmsystem_proc(&mut self, name: &str) -> u32 {
        let Some(kept) = self.kept_named("MMSYSTEM") else {
            return 0;
        };
        let instance = self.kept[kept].instance();

        crate::modules_kernel::proc_named(self, instance, name)
    }
}

/// The notes sounding, as a message sent changes them (seg3 `e0e`-`e7f`):
/// a note on with a velocity sounds, a note off or one with none lets it
/// go. A note on for a key already sounding is sent as a note off first --
/// the same message, its status's 10h bit cleared -- which is given back to
/// be sent before it.
fn note(notes: &mut [u128; 16], message: u32) -> Option<u32> {
    let status = message as u8;
    let key = (message >> 8) as u8 & 0x7f;
    let velocity = (message >> 16) as u8;
    let channel = usize::from(status & 0xf);

    match status & 0xf0 {
        0x90 if velocity != 0 => {
            let sounding = notes[channel] & 1 << key != 0;

            notes[channel] |= 1 << key;
            sounding.then_some(message & !0x10)
        }
        0x80 | 0x90 => {
            notes[channel] &= !(1 << key);
            None
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `sndplay`'s note: a quarter at 96 ticks, its note on at the start
    /// and off at the end, unmarked, no patches; the track's end an event
    /// too, though nothing is sent for it.
    #[test]
    fn a_file_is_read_as_its_messages() {
        let bytes = [
            b'M', b'T', b'h', b'd', 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, b'M', b'T', b'r', b'k', 0, 0, 0,
            12, 0, 0x90, 60, 64, 96, 0x80, 60, 64, 0, 0xff, 0x2f, 0,
        ];
        let song = Song::parse(&bytes).unwrap();

        assert_eq!(
            song.events,
            vec![
                (0, Event::Short(0x0040_3c90)),
                (96, Event::Short(0x0040_3c80)),
                (96, Event::Meta)
            ]
        );
        assert_eq!(song.length, 96);
        assert!(!song.marked);
        assert_eq!(song.ms(96), 500);
        assert_eq!(song.in_format(MCI_SEQ_FORMAT_SONGPTR, 96), 4);
        assert_eq!(song.in_format(MCI_FORMAT_MILLISECONDS, 96), 500);
        assert_eq!(song.tick_at(250), 48);
    }

    /// **Read out** (seg3 `17e6`, `1aba`-`1b1c`): a track's end does not
    /// count its own delta, any other event does, a meta event among them;
    /// the length is the longest track's. `adlibseq`'s file, its last note
    /// at tick 384 and its end 96 ticks after, is 2,000 milliseconds long.
    #[test]
    fn a_file_is_as_long_as_its_last_event_before_its_end() {
        let track = |events: &[u8]| {
            let mut bytes = b"MTrk".to_vec();

            bytes.extend((events.len() as u32).to_be_bytes());
            bytes.extend(events);
            bytes
        };
        let file = |tracks: &[Vec<u8>]| {
            let mut bytes = vec![b'M', b'T', b'h', b'd', 0, 0, 0, 6, 0, 1, 0];

            bytes.push(tracks.len() as u8);
            bytes.extend([0, 96]);
            for each in tracks {
                bytes.extend(each);
            }
            Song::parse(&bytes).unwrap()
        };
        let note = [0, 0x90, 60, 64, 96, 0x80, 60, 64];
        let ended = |tail: &[u8]| track(&[&note[..], tail].concat());

        assert_eq!(file(&[ended(&[96, 0xff, 0x2f, 0])]).length, 96);
        assert_eq!(file(&[ended(&[0, 0xff, 0x2f, 0])]).length, 96);
        assert_eq!(
            file(&[ended(&[96, 0xff, 1, 1, b'.', 96, 0xff, 0x2f, 0])]).length,
            192
        );
        assert_eq!(
            file(&[
                track(&[0x83, 0x60, 0xff, 0x2f, 0]),
                ended(&[0, 0xff, 0x2f, 0])
            ])
            .length,
            96
        );

        let song = file(&[ended(&[96, 0xff, 0x2f, 0])]);

        assert_eq!(
            song.lengths()[..2],
            [(MCI_SEQ_FORMAT_SONGPTR, 4), (MCI_FORMAT_MILLISECONDS, 500)]
        );
        // **Recorded** by `seqlen`: 495 milliseconds are frame 11 at 24 a
        // second, 12 at 25, 14 at 30.
        assert_eq!(smpte(MCI_FORMAT_SMPTE_24, 495), 11 << 24);
        assert_eq!(smpte(MCI_FORMAT_SMPTE_25, 495), 12 << 24);
        assert_eq!(smpte(MCI_FORMAT_SMPTE_30, 495), 14 << 24);
        assert_eq!(smpte(MCI_FORMAT_SMPTE_24, 3_725_500), 0x0c_05_02_01);
        assert_eq!(smpte_ms(MCI_FORMAT_SMPTE_25, 0x06_00_00_00), 240);
        assert_eq!(song.events.last(), Some(&(192, Event::Meta)));
    }

    /// **Read out** (seg3 `b46`, `79a`, `70e`; seg2 `1204`, `10e6`): a
    /// tick is 5,208 microseconds at 96 a quarter, the fraction dropped, so
    /// 9,600 ticks are 49,997 milliseconds, not 50,000; a millisecond is
    /// rounded to the nearest tick; a song pointer drops its fraction.
    #[test]
    fn times_are_counted_as_mciseq_counts_them() {
        let song = Song {
            division: 96,
            ..Song::default()
        };

        assert_eq!(song.tempo_map(), [(0, 0, 5208)]);
        assert_eq!(song.ms(9600), 49_997);
        assert_eq!(song.tick_at(3), 1);
        assert_eq!(song.tick_at(2), 0);
        assert_eq!(song.in_format(MCI_SEQ_FORMAT_SONGPTR, 95), 3);
        assert_eq!(song.to_tick(MCI_SEQ_FORMAT_SONGPTR, 3), 72);
    }

    /// **Read out** (seg2 `18d2`-`190c`): `from` after `to` is out of range
    /// only as ticks -- two milliseconds and one are both tick nought.
    #[test]
    fn from_and_to_are_compared_as_ticks() {
        let player = Player {
            song: Song::parse(&MARKED).unwrap(),
            format: MCI_FORMAT_MILLISECONDS,
            position: 0,
            port_id: MAPPER,
            port: 0,
            warned: false,
            paused: false,
            playing: None,
            pending: None,
            notes: [0; 16],
            task: 0,
        };
        let both = MCI_FROM | MCI_TO;

        assert_eq!(play_range(&player, 0, both, 2, 1), Ok((0, 0, false)));
        assert_eq!(play_range(&player, 0, both, 3, 2), Err(MCIERR_OUTOFRANGE));
        assert_eq!(play_range(&player, 0, both, 0, 500), Ok((0, 96, true)));
        assert_eq!(
            play_range(&player, 0, MCI_TO, 0, 501),
            Err(MCIERR_OUTOFRANGE)
        );
        assert_eq!(play_range(&player, 1, MCI_TO, 0, 2), Err(MCIERR_OUTOFRANGE));
        assert_eq!(play_range(&player, 1, MCI_TO, 0, 3), Ok((1, 1, false)));
    }

    /// `MCISEQ`'s `MulDiv` rounds to the nearest and stops at the largest
    /// signed doubleword.
    #[test]
    fn mul_div_rounds_and_saturates() {
        assert_eq!(mul_div(96, 5208, 1000), 500);
        assert_eq!(mul_div(1, 1, 2), 1);
        assert_eq!(mul_div(1, 1, 3), 0);
        assert_eq!(mul_div(5, 1000, 0), 0x7fff_ffff);
        assert_eq!(mul_div(0x7fff_ffff, 4, 1), 0x7fff_ffff);
    }

    /// Microsoft's mark, a sequencer-specific event at the start; a program
    /// change's patch; a drum key on channel 10.
    #[test]
    fn the_mark_patches_and_drum_keys_are_found() {
        let bytes = [
            b'M', b'T', b'h', b'd', 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, b'M', b'T', b'r', b'k', 0, 0, 0,
            21, 0, 0xff, 0x7f, 3, 0, 0, 0x41, 0, 0xc2, 5, 0, 0x99, 38, 100, 0, 0xff, 0x2f, 0, 0,
        ];
        let song = Song::parse(&bytes).unwrap();

        assert!(song.marked);
        assert_eq!(song.patches[5], 1 << 2);
        assert_eq!(song.keys[38], 1 << 9);
    }

    /// A tempo of the first track starts a part of the map at the
    /// millisecond the part before reaches, its fraction dropped: 499 at
    /// tick 96, where a time counted to the tick is 500.
    #[test]
    fn tempos_time_the_ticks() {
        let song = Song {
            division: 96,
            tempos: vec![(96, 250_000)],
            ..Song::default()
        };

        assert_eq!(song.tempo_map(), [(0, 0, 5208), (499, 96, 2604)]);
        assert_eq!(song.ms(95), 495);
        assert_eq!(song.ms(96), 499);
        assert_eq!(song.ms(192), 749);
        assert_eq!(song.tick_at(749), 192);
        assert_eq!(song.tick_at(498), 96);
    }

    type Heard = std::rc::Rc<std::cell::RefCell<Vec<crate::audio::Sound>>>;

    struct Listening(Heard);

    impl crate::host::Host for Listening {
        fn frame(&mut self, _: &mut System) -> bool {
            true
        }

        fn sound(&mut self, sound: &crate::audio::Sound) {
            self.0.borrow_mut().push(sound.clone());
        }
    }

    /// The machine with winbox.js's sound card and MIDI Mapper installed, as
    /// `SYSTEM.INI` names them, the mapper's setup the installation's own,
    /// "Ad Lib" (channels 13 to 16), as the oracle recorded with; and a host
    /// that listens.
    fn listening() -> (Engine, Heard) {
        let engine = crate::mmsystem::device_tests::machine();
        let mut drive = winbox_machine::MemoryDrive::new();

        assert!(drive.add_folder("\\WINDOWS", 0));
        assert!(drive.add_file(
            "\\WINDOWS\\SYSTEM.INI",
            b"[wbmapper.drv]\r\nsetup=Ad Lib\r\n".to_vec(),
            0
        ));
        engine.system().files.mount('C', drive);

        let modules: [(&'static crate::modules::Kept, &[u16]); 2] = [
            (&crate::wbsound::MODULE, &[2, 1, 4, 3]),
            (&crate::wbmapper::MODULE, &[0x8004]),
        ];

        for (module, kinds) in modules {
            let instance = {
                let mut system = engine.system();
                let kept = system.keep_on_load(module);

                system.stubs(kept);
                crate::wbsound::driver_proc(&mut system, 1, 2);
                system.kept[kept].instance()
            };

            for &kind in kinds {
                engine
                    .run_now(devices::install(&engine, instance, None, kind))
                    .unwrap();
            }
        }

        let heard = Heard::default();

        engine.system().host = Some(crate::host::HostSlot::new(Box::new(Listening(
            std::rc::Rc::clone(&heard),
        ))));
        (engine, heard)
    }

    /// What the synthesizer was sent, in turn.
    fn synthesized(heard: &Heard) -> Vec<Vec<u8>> {
        heard
            .borrow()
            .iter()
            .filter_map(|sound| match sound {
                crate::audio::Sound::Midi {
                    output: crate::audio::MidiOutput::Synthesizer,
                    bytes,
                    ..
                } => Some(bytes.clone()),
                _ => None,
            })
            .collect()
    }

    /// A marked file of a note on channel 13, a quarter long.
    const MARKED: [u8; 41] = [
        b'M', b'T', b'h', b'd', 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, b'M', b'T', b'r', b'k', 0, 0, 0, 19,
        0, 0xff, 0x7f, 3, 0, 0, 0x41, 0, 0x9c, 60, 64, 96, 0x8c, 60, 64, 0, 0xff, 0x2f, 0,
    ];

    /// The clock moved on, and what came due sent.
    fn played(engine: &Engine, ms: f64) {
        {
            let mut system = engine.system();
            let instructions = system.instructions;

            system.clock.advance(instructions, ms);
            system.poll_sequencer();
        }

        engine.run_now(engine.take_interrupts()).unwrap();
    }

    fn mode(engine: &Engine, parms: u32) -> u32 {
        engine
            .system()
            .write_far(far_at(parms, 8), &MCI_STATUS_MODE.to_le_bytes());
        engine
            .run_now(driver_proc(
                engine,
                1,
                0,
                MCI_STATUS,
                MCI_STATUS_ITEM,
                parms,
            ))
            .unwrap();
        long_at(&engine.system(), far_at(parms, 4))
    }

    /// Played through the mapper, a marked file's note goes to the
    /// synthesizer on channel 13 at its time, and the port is closed at its
    /// end; paused part way, each channel's sustain and the note sounding
    /// are let go, the mapper sending on those of its channels.
    #[test]
    fn a_file_plays_through_the_mapper() {
        let (engine, heard) = listening();
        let parms = crate::mmsystem::device_tests::block(&engine);

        {
            let mut system = engine.system();
            let task = system.task_handle;

            system.mmsystem.sequencer.players.insert(
                1,
                Player {
                    song: Song::parse(&MARKED).unwrap(),
                    format: MCI_SEQ_FORMAT_SONGPTR,
                    position: 0,
                    port_id: MAPPER,
                    port: 0,
                    warned: false,
                    paused: false,
                    playing: None,
                    pending: None,
                    notes: [0; 16],
                    task,
                },
            );
        }

        let answer = engine.run_now(driver_proc(&engine, 1, 0, MCI_PLAY, 0, parms));

        assert_eq!(answer, Ok(0));
        played(&engine, 0.0);
        assert_eq!(synthesized(&heard), [vec![0x9c, 60, 64]]);
        assert_eq!(mode(&engine, parms), MCI_MODE_PLAY);

        // The note's writes to the FM chip took the Ad Lib driver's time
        // on the clock, some 4.5 milliseconds (`fm.rs`).
        played(&engine, 494.0);
        assert_eq!(synthesized(&heard).len(), 1);
        played(&engine, 2.0);
        assert_eq!(synthesized(&heard)[1], [0x8c, 60, 64]);
        assert_eq!(mode(&engine, parms), MCI_MODE_STOP);
        assert_eq!(engine.system().mmsystem.sequencer.players[&1].port, 0);

        heard.borrow_mut().clear();
        engine
            .system()
            .write_far(far_at(parms, 4), &0u32.to_le_bytes());
        assert_eq!(
            engine.run_now(driver_proc(&engine, 1, 0, MCI_PLAY, MCI_FROM, parms)),
            Ok(0)
        );
        played(&engine, 100.0);
        engine
            .run_now(driver_proc(&engine, 1, 0, MCI_PAUSE, 0, parms))
            .unwrap();

        // Let go as the stop lets go (message 9), then each channel's
        // sustain again as the port closes (message 0Dh with 1).
        assert_eq!(
            synthesized(&heard),
            [
                vec![0x9c, 60, 64],
                vec![0xbc, 0x40, 0],
                vec![0x8c, 60, 0x40],
                vec![0xbd, 0x40, 0],
                vec![0xbe, 0x40, 0],
                vec![0xbf, 0x40, 0],
                vec![0xbc, 0x40, 0],
                vec![0xbd, 0x40, 0],
                vec![0xbe, 0x40, 0],
                vec![0xbf, 0x40, 0],
            ]
        );
        assert_eq!(mode(&engine, parms), MCI_MODE_PAUSE);

        // Played on from the pause to its end, the device is paused again:
        // playing does not clear the pause (seg2 `138`).
        assert_eq!(
            engine.run_now(driver_proc(&engine, 1, 0, MCI_PLAY, 0, parms)),
            Ok(0)
        );
        assert_eq!(mode(&engine, parms), MCI_MODE_PLAY);
        played(&engine, 500.0);
        assert_eq!(mode(&engine, parms), MCI_MODE_PAUSE);
    }

    /// **Read out** (seg2 `1616`, seg3 `1750`, `1220`): closing lets the
    /// notes go once, as a stop does, and closes the port with none let go
    /// again.
    #[test]
    fn closing_lets_the_notes_go_once() {
        let (engine, heard) = listening();
        let parms = crate::mmsystem::device_tests::block(&engine);

        {
            let mut system = engine.system();
            let task = system.task_handle;

            system.mmsystem.sequencer.players.insert(
                1,
                Player {
                    song: Song::parse(&MARKED).unwrap(),
                    format: MCI_SEQ_FORMAT_SONGPTR,
                    position: 0,
                    port_id: MAPPER,
                    port: 0,
                    warned: false,
                    paused: false,
                    playing: None,
                    pending: None,
                    notes: [0; 16],
                    task,
                },
            );
        }

        assert_eq!(
            engine.run_now(driver_proc(&engine, 1, 0, MCI_PLAY, 0, parms)),
            Ok(0)
        );
        played(&engine, 100.0);
        engine.run_now(close(&engine, 1, 0)).unwrap();

        assert_eq!(
            synthesized(&heard),
            [
                vec![0x9c, 60, 64],
                vec![0xbc, 0x40, 0],
                vec![0x8c, 60, 0x40],
                vec![0xbd, 0x40, 0],
                vec![0xbe, 0x40, 0],
                vec![0xbf, 0x40, 0],
            ]
        );
        assert!(!engine.system().mmsystem.sequencer.players.contains_key(&1));
    }

    #[test]
    fn notes_sound_until_let_go() {
        let mut notes = [0u128; 16];

        assert_eq!(note(&mut notes, 0x0040_3c91), None);
        assert_eq!(notes[1], 1 << 60);
        assert_eq!(note(&mut notes, 0x0000_3c91), None);
        assert_eq!(notes[1], 0);
    }

    /// **Read out** (seg3 `e2d`-`e61`): a note struck again while it
    /// sounds is let go first, by the same message as a note off.
    #[test]
    fn a_note_struck_again_is_let_go_first() {
        let mut notes = [0u128; 16];

        assert_eq!(note(&mut notes, 0x0040_3c91), None);
        assert_eq!(note(&mut notes, 0x0050_3c91), Some(0x0050_3c81));
        assert_eq!(notes[1], 1 << 60);
    }
}

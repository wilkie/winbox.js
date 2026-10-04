//! The MIDI sequencer, `MCISEQ.DRV`, playing a file on a MIDI device: its
//! port opened as it plays, and the file's messages sent to it in time.
//! What it answers with no file open, and a file's length and time format,
//! are `mci_drivers.rs`'s; this is the rest of it, **read out** of
//! `MCISEQ.DRV` (seg2 `0`-`350`, `16b2`-`1bb0`; seg3 `948`, `1084`-`1330`,
//! `17c0`-`1940`, `1a20`-`1ab8`, `1ffc`) and **recorded** by `sndplay` on
//! the installation with a sound card:
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
//!   minute until one is set. Played to its end, the port is closed.
//! * **Stopping and pausing** (seg2 `16e`): the play stopped where it is,
//!   each channel's sustain let go and each note sounding let go (seg3
//!   `948`), and the port closed; paused, the device's mode is paused.
//!   **Seeking** (seg2 `1a48`) to the start, the end or `to`: a play under
//!   way paused first. **Closing** stops the play and closes the port, with
//!   no notes let go.
//! * **Notifying** (seg2 `226`-`33b`): a play asked to notify notifies when
//!   it is played, `MCI_NOTIFY_SUCCESSFUL`, or at once if there is nothing
//!   to play; a stop, a pause, a seek, closing, or a play from somewhere
//!   aborts it (`MCI_NOTIFY_ABORTED`); another play to the same place, or
//!   another command that notifies, supersedes it (`MCI_NOTIFY_SUPERSEDED`).
//!   Other commands notify at once.
//! * **The mode**: playing, paused, or stopped; **the position**, where the
//!   play is.
//!
//! Not followed: a port other than the mapper (`MCI_SEQ_SET_PORT`), which
//! `mci_drivers.rs` does not take; a file timed in SMPTE frames, and one
//! with system-exclusive messages, which `MCISEQ` sends as long messages,
//! both of which stop the run as they are played; the program changes and
//! controllers a seek chases; synchronisation and the tempo set by
//! command; the sequencer's own task and timer, whose period is not read
//! out -- each message is sent at its own time; how a position rounds in
//! song pointers, which was not recorded.

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
const MCI_STATUS_POSITION: u32 = 2;
const MCI_STATUS_MODE: u32 = 4;

const MCI_MODE_STOP: u32 = 0x20d;
const MCI_MODE_PLAY: u32 = 0x20e;
const MCI_MODE_PAUSE: u32 = 0x211;
const MCI_FORMAT_MILLISECONDS: u32 = 0;
const MCI_SEQ_FORMAT_SONGPTR: u32 = 0x4001;

const MM_MCINOTIFY: u16 = 0x3b9;
const MCI_NOTIFY_SUCCESSFUL: u16 = 1;
const MCI_NOTIFY_SUPERSEDED: u16 = 2;
const MCI_NOTIFY_ABORTED: u16 = 4;

const MCIERR_HARDWARE: u32 = 0x103;
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
    /// The tick its longest track ends at.
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

    /// A track's messages taken, to its end.
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
            tick = tick.wrapping_add(number(&mut at));

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

                    if kind == 0x2f {
                        break;
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

        self.length = self.length.max(tick);
    }

    /// Milliseconds from the start to a tick, at its tempos.
    fn ms(&self, tick: u32) -> f64 {
        let division = f64::from(self.division.max(1));
        let mut micro = 0.0;
        let mut from = 0u32;
        let mut tempo = 500_000.0;

        for &(at, next) in &self.tempos {
            if at >= tick {
                break;
            }

            micro += f64::from(at - from) * tempo / division;
            from = at;
            tempo = f64::from(next);
        }

        (micro + f64::from(tick - from) * tempo / division) / 1000.0
    }

    /// The tick a time in milliseconds is at, at its tempos.
    fn tick_at(&self, ms: f64) -> u32 {
        let division = f64::from(self.division.max(1));
        let mut micro = 0.0;
        let mut from = 0u32;
        let mut tempo = 500_000.0;
        let wanted = ms * 1000.0;

        for &(at, next) in &self.tempos {
            let reached = micro + f64::from(at - from) * tempo / division;

            if reached > wanted {
                break;
            }

            micro = reached;
            from = at;
            tempo = f64::from(next);
        }

        from.saturating_add(((wanted - micro) * division / tempo).floor() as u32)
    }

    /// A position in a time format, as a tick.
    fn to_tick(&self, format: u32, value: u32) -> u32 {
        if format == MCI_FORMAT_MILLISECONDS {
            self.tick_at(f64::from(value))
        } else {
            (u64::from(value) * u64::from(self.division) / 4) as u32
        }
    }

    /// A tick in a time format, to the nearest.
    fn in_format(&self, format: u32, tick: u32) -> u32 {
        let value = if format == MCI_FORMAT_MILLISECONDS {
            self.ms(tick)
        } else {
            f64::from(tick) * 4.0 / f64::from(self.division.max(1))
        };

        (value + 0.5).floor() as u32
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

            if item == MCI_STATUS_MODE || item == MCI_STATUS_POSITION {
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
    let answer = match message {
        MCI_PLAY => play(engine, device, flags, parms).await?,
        MCI_SEEK => seek(engine, device, flags, parms).await?,
        MCI_STOP | MCI_PAUSE => {
            stop(engine, device, message == MCI_PAUSE, true).await?;
            Ok(0)
        }
        _ => {
            status(engine, device, parms);
            Ok(0)
        }
    };
    let to = match answer {
        Ok(to) => to,
        Err(error) => return Ok(error),
    };

    notify_after(engine, device, message, flags, parms, to);
    Ok(0)
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
            return Ok(Err(MCIERR_HARDWARE));
        };
        let song = &player.song;
        let length = song.in_format(player.format, song.length);
        let position = song.in_format(player.format, current(player, now));

        if (flags & MCI_TO != 0 && to > length)
            || (flags & MCI_FROM != 0 && from > length)
            || (flags & MCI_FROM != 0 && flags & MCI_TO != 0 && from > to)
            || (flags & MCI_FROM == 0 && flags & MCI_TO != 0 && position > to)
        {
            Err(MCIERR_OUTOFRANGE)
        } else {
            let start = if flags & MCI_FROM != 0 {
                song.to_tick(player.format, from)
            } else {
                current(player, now)
            };
            let (end, whole) = if flags & MCI_TO != 0 && to < length {
                (song.to_tick(player.format, to), false)
            } else {
                (song.length, true)
            };

            Ok((start, end, whole))
        }
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
            return Ok(Err(MCIERR_HARDWARE));
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
            return Ok(Err(MCIERR_HARDWARE));
        };
        let next = player
            .song
            .events
            .partition_point(|&(tick, _)| tick < start);

        player.paused = false;
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

        let mut system = engine.system();

        if system.clock.is_virtual() {
            let instructions = system.instructions;

            system.clock.advance(instructions, wait);
        } else if wait > 0.0 {
            drop(system);
            std::thread::sleep(std::time::Duration::from_secs_f64(wait.min(50.0) / 1000.0));
        }
    }
}

/// Where a device is, as a tick: where its play has got to, or where it
/// stopped.
fn current(player: &Player, now: f64) -> u32 {
    match &player.playing {
        Some(playing) => {
            let song = &player.song;
            let reached = song.ms(playing.from) + (now - playing.began);

            song.tick_at(reached).min(playing.to)
        }
        None => player.position,
    }
}

/// When the next message of a play is due on the clock, or its end.
fn due_of(player: &Player, playing: &Playing) -> Option<f64> {
    let song = &player.song;
    let start = song.ms(playing.from);
    let tick = match song.events.get(playing.next) {
        Some(&(tick, _)) if tick < playing.to || (playing.whole && tick <= playing.to) => tick,
        _ => playing.to,
    };

    Some(playing.began + song.ms(tick) - start)
}

/// The port opened for a play (seg2 `16b2`), the warning shown first where
/// it is to be: nothing, or the error.
async fn open_port(engine: &Engine, device: u16) -> Result<Result<(), u32>, Stop> {
    let (port, port_id, warn) = {
        let mut system = engine.system();
        let Some(player) = system.mmsystem.sequencer.players.get(&device) else {
            return Ok(Err(MCIERR_HARDWARE));
        };
        let (port, port_id, warned, marked) = (
            player.port,
            player.port_id,
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

        (port, port_id, (warn, shown))
    };

    debug_assert_eq!(port, 0);

    let (warn, shown) = warn;

    if shown && super::seq_box::warn(engine).await? != 0 {
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
        return Ok(Err(MCIERR_HARDWARE));
    }

    let tick = {
        let system = engine.system();
        let to = long_at(&system, far_at(parms, 4));
        let Some(player) = system.mmsystem.sequencer.players.get(&device) else {
            return Ok(Err(MCIERR_HARDWARE));
        };
        let song = &player.song;

        match asked {
            MCI_TO if to > song.in_format(player.format, song.length) => {
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
        stop(engine, device, true, true).await?;
        notify_after(engine, device, MCI_PAUSE, 0, 0, 0);
    }

    if let Some(player) = engine.system().mmsystem.sequencer.players.get_mut(&device) {
        player.position = tick;
    }

    Ok(Ok(tick))
}

/// A play stopped where it is (seg3 `9`), paused or not, and the port
/// closed, the notes let go where `let_go`.
async fn stop(engine: &Engine, device: u16, paused: bool, let_go: bool) -> Result<(), Stop> {
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

    close_port(engine, device, let_go).await
}

/// The port closed (seg3 `1220`): first each channel's sustain let go and
/// each note sounding let go, where `let_go` (seg3 `948`).
async fn close_port(engine: &Engine, device: u16, let_go: bool) -> Result<(), Stop> {
    let (port, notes) = {
        let mut system = engine.system();
        let Some(player) = system.mmsystem.sequencer.players.get_mut(&device) else {
            return Ok(());
        };
        let port = std::mem::take(&mut player.port);
        let notes = if let_go {
            std::mem::take(&mut player.notes)
        } else {
            [0; 16]
        };

        (port, notes)
    };

    if port == 0 {
        return Ok(());
    }

    if let_go {
        for (channel, keys) in notes.iter().enumerate() {
            let channel = channel as u32;

            send(engine, port, 0xb0 | channel | 0x40 << 8).await?;

            for key in (0..128u32).filter(|&key| keys & (1u128 << key) != 0) {
                send(engine, port, 0x80 | channel | key << 8 | 0x40 << 16).await?;
            }
        }
    }

    devices::close(engine, port, Kind::MidiOut, MODM_CLOSE).await?;
    Ok(())
}

/// A short message sent on the port, as `midiOutShortMsg` sends it.
async fn send(engine: &Engine, port: u16, message: u32) -> Result<(), Stop> {
    devices::send_by_handle(engine, port, Kind::MidiOut, MODM_DATA, message, 0).await?;
    Ok(())
}

/// The device closed (seg2 `1616`): the play stopped and the port closed,
/// no notes let go; a notification waiting superseded if the close
/// notifies and nothing else, else aborted.
async fn close(engine: &Engine, device: u16, flags: u32) -> Result<(), Stop> {
    stop(engine, device, false, false).await?;

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

/// `MCI_STATUS` of the mode or the position (seg2 `1bb0`).
fn status(engine: &Engine, device: u16, parms: u32) {
    let mut system = engine.system();
    let now = system.clock.now(system.instructions);
    let item = long_at(&system, far_at(parms, 8));
    let Some(player) = system.mmsystem.sequencer.players.get(&device) else {
        return;
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
        let start = player.song.ms(playing.from);

        while let Some(&(tick, event)) = player.song.events.get(playing.next) {
            let within = tick < playing.to || (playing.whole && tick <= playing.to);

            if !within || playing.began + player.song.ms(tick) - start > now {
                break;
            }

            playing.next += 1;

            if let Event::Short(message) = event {
                note(&mut player.notes, message);

                if player.port != 0 {
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
            // Played to its end: the port closed by the sequencer's task,
            // no notes let go (seg2 `cf0`-`d18`), and the play notified.
            player.position = playing.to;

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

/// The notes sounding, as a message sent changes them: a note on with a
/// velocity sounds, a note off or one with none lets it go.
fn note(notes: &mut [u128; 16], message: u32) {
    let status = message as u8;
    let key = (message >> 8) as u8 & 0x7f;
    let velocity = (message >> 16) as u8;
    let channel = usize::from(status & 0xf);

    match status & 0xf0 {
        0x90 if velocity != 0 => notes[channel] |= 1 << key,
        0x80 | 0x90 => notes[channel] &= !(1 << key),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `sndplay`'s note: a quarter at 96 ticks, its note on at the start
    /// and off at the end, unmarked, no patches.
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
                (96, Event::Short(0x0040_3c80))
            ]
        );
        assert_eq!(song.length, 96);
        assert!(!song.marked);
        assert_eq!(song.ms(96).to_bits(), 500.0f64.to_bits());
        assert_eq!(song.in_format(MCI_SEQ_FORMAT_SONGPTR, 96), 4);
        assert_eq!(song.in_format(MCI_FORMAT_MILLISECONDS, 96), 500);
        assert_eq!(song.tick_at(250.0), 48);
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

    /// A tempo of the first track changes the times after it.
    #[test]
    fn tempos_time_the_ticks() {
        let song = Song {
            division: 96,
            tempos: vec![(96, 250_000)],
            ..Song::default()
        };

        assert_eq!(song.ms(96).to_bits(), 500.0f64.to_bits());
        assert_eq!(song.ms(192).to_bits(), 750.0f64.to_bits());
        assert_eq!(song.tick_at(750.0), 192);
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
    /// `SYSTEM.INI` names them, and a host that listens.
    fn listening() -> (Engine, Heard) {
        let engine = crate::mmsystem::device_tests::machine();
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

        played(&engine, 499.0);
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
        assert_eq!(mode(&engine, parms), MCI_MODE_PAUSE);
    }

    #[test]
    fn notes_sound_until_let_go() {
        let mut notes = [0u128; 16];

        note(&mut notes, 0x0040_3c91);
        assert_eq!(notes[1], 1 << 60);
        note(&mut notes, 0x0000_3c91);
        assert_eq!(notes[1], 0);
    }
}

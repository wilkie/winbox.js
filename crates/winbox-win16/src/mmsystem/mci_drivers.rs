//! The MCI drivers, kept by winbox.js as TIMER is: `MCIWAVE.DRV`, the
//! waveform audio device, and `MCISEQ.DRV`, the MIDI sequencer. MMSYSTEM
//! opens one as an installable driver when a program opens its device, and
//! sends it the MCI commands. Each is found by its file's name, whether or
//! not the file is there, and its names are its own.
//!
//! **Read out** of `MCIWAVE.DRV` (seg1 `ac`, seg2 `1f08`, seg6 `0`, `240`)
//! and `MCISEQ.DRV` (seg2 `d88`, `0`, `1f3c`, `1fc2`), and **recorded** by
//! `mcidevs`, which opens each device by its type, asks every capability
//! and the product, and closes it:
//!
//! * Opened by type alone, a driver makes no instance and answers nought;
//!   playing, seeking, status and the rest then answer 112h.
//! * `MCI_GETDEVCAPS` answers each item as a pair, the value and a string
//!   resource, with 10000h, whose high half MMSYSTEM clears: the waveform
//!   device can play and record as there are devices out and in, counted as
//!   it loads, has audio, uses files, is compound and can save; the
//!   sequencer plays and has audio, uses files and is compound as there are
//!   MIDI devices out, counted as it is asked. An item past 9 is 112h for
//!   the one and 111h for the other.
//! * `MCI_INFO` with `MCI_INFO_PRODUCT` gives the driver's string: "Sound"
//!   from `MCIWAVE.DRV`, "MIDI Sequencer" from `MCISEQ.DRV`.
//! * A command that succeeds with `MCI_NOTIFY` posts `MM_MCINOTIFY` to the
//!   window in its `dwCallback`.
//!
//! Opening a file, **recorded** by `mcifile` in the same installation:
//!
//! * A waveform or MIDI file opens, and the device is stopped
//!   (`MCI_MODE_STOP`, 20Dh). A file that is not there answers 113h.
//! * Its length, `MCI_STATUS_LENGTH`: a waveform file's in milliseconds,
//!   its samples' bytes over its bytes a second, to the nearest; a MIDI
//!   file's in sixteenths, the song pointer's unit, which is the sequencer's
//!   time format (4001h).
//! * Playing answers 146h from the one and 157h from the other, there being
//!   no device to play on; stopping, seeking and closing answer nought. The
//!   position is nought, and the sequencer is not ready.
//! * The sequencer set to milliseconds gives its length in them, at the
//!   file's tempo: a quarter at 120 a minute is 500.
//!
//! Not followed: a file that is not waveform or MIDI inside, and how a MIDI
//! length rounds, which were not recorded; the configuration dialog; the
//! drivers' command tables, which only `mciSendString` reads.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use std::collections::HashMap;

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

use super::mci::{RESOURCE_RETURNED, far_at, long_at};

const MCI_NOTIFY: u32 = 0x1;
const MCI_WAIT: u32 = 0x2;
const MCI_OPEN_SHAREABLE: u32 = 0x100;
const MCI_OPEN_ELEMENT: u32 = 0x200;
const MCI_OPEN_ELEMENT_ID: u32 = 0x800;
const MCI_WAVE_OPEN_BUFFER: u32 = 0x10000;
const MCI_GETDEVCAPS_ITEM: u32 = 0x100;
const MCI_INFO_PRODUCT: u32 = 0x100;
const MCI_INFO_FILE: u32 = 0x200;
const MCI_STATUS_ITEM: u32 = 0x100;
const MCI_STATUS_LENGTH: u32 = 1;
const MCI_STATUS_POSITION: u32 = 2;
const MCI_STATUS_MODE: u32 = 4;
const MCI_STATUS_TIME_FORMAT: u32 = 6;
const MCI_STATUS_READY: u32 = 7;
const MCI_SET_TIME_FORMAT: u32 = 0x400;
const MCI_MODE_STOP: u32 = 0x20d;
const MCI_FORMAT_MILLISECONDS: u32 = 0;
const MCI_SEQ_FORMAT_SONGPTR: u32 = 0x4001;
const MM_MCINOTIFY: u16 = 0x3b9;
const MCI_NOTIFY_SUCCESSFUL: u16 = 1;

const MCIERR_HARDWARE: u32 = 0x103;
const MCIERR_UNRECOGNIZED_COMMAND: u32 = 0x105;
const MCIERR_PARAM_OVERFLOW: u32 = 0x10c;
const MCIERR_MISSING_PARAMETER: u32 = 0x111;
const MCIERR_UNSUPPORTED_FUNCTION: u32 = 0x112;
const MCIERR_FILE_NOT_FOUND: u32 = 0x113;
const MCIERR_BAD_CONSTANT: u32 = 0x11a;
const MCIERR_FLAGS_NOT_COMPATIBLE: u32 = 0x11c;
const MCIERR_BAD_TIME_FORMAT: u32 = 0x125;
const MCIERR_WAVE_OUTPUTSUNSUITABLE: u32 = 0x146;
const MCIERR_SEQ_NOMIDIPRESENT: u32 = 0x157;

/// `TRUE` and `FALSE` as a capability answers them: the value and its
/// string.
const YES: u32 = 0x0214_0001;
const NO: u32 = 0x0213_0000;

/// The product each gives `MCI_INFO`, as recorded.
const WAVE_PRODUCT: &[u8] = b"Sound";
const SEQ_PRODUCT: &[u8] = b"MIDI Sequencer";

/// Which of the two drivers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Wave,
    Seq,
}

/// A file a driver has open, by its device's ID: its length in each time
/// format it has, and the format it is in.
#[derive(Debug, Clone)]
struct Opened {
    lengths: Vec<(u32, u32)>,
    format: u32,
}

impl Opened {
    fn length(&self, format: u32) -> Option<u32> {
        self.lengths
            .iter()
            .find(|&&(each, _)| each == format)
            .map(|&(_, length)| length)
    }
}

/// What the two drivers keep: the files open, and the waveform devices
/// `MCIWAVE.DRV` counted as it loaded, out and in.
#[derive(Debug, Default)]
pub struct DriverState {
    opened: HashMap<u16, Opened>,
    wave: Option<(u16, u16)>,
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "WEP" => Implementation::Sync(wep),
        "DriverProc" => Implementation::Sync(driver_proc_call),
        _ => return None,
    })
}

/// The library let go: 1.
fn wep(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(1))
}

fn driver_proc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let module = system
        .kept_at(winbox_machine::index_for(
            system.cpu.segments[winbox_cpu::CS].selector,
        ))
        .map_or("MCIWAVE", |kept| kept.module.name);
    let id = args.dword(system);
    let handle = args.word(system);
    let message = args.word(system);
    let first = args.dword(system);
    let second = args.dword(system);

    Ok(Answer::Dword(driver_proc(
        system, module, id, handle, message, first, second,
    )))
}

/// Posts `MM_MCINOTIFY` for a command that succeeded, as `mciDriverNotify`
/// does.
fn notify(system: &mut System, id: u16, flags: u32, parms: u32) {
    if flags & MCI_NOTIFY == 0 || parms == 0 {
        return;
    }

    let hwnd = long_at(system, parms) as u16;

    if hwnd != 0 {
        system.post_message(hwnd, MM_MCINOTIFY, MCI_NOTIFY_SUCCESSFUL, u32::from(id));
    }
}

/// JavaScript's `Math.round`: halves up.
fn round(value: f64) -> u32 {
    (value + 0.5).floor() as u32
}

fn le32(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

fn be32(bytes: &[u8], at: usize) -> u32 {
    u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// A waveform file's length in milliseconds: its data's bytes over its
/// bytes a second, to the nearest.
fn wave_length(bytes: &[u8]) -> u32 {
    let tag = |at: usize| bytes.get(at..at + 4);

    if bytes.len() < 12 || tag(0) != Some(b"RIFF") || tag(8) != Some(b"WAVE") {
        return 0;
    }

    let mut per_second = 0;
    let mut data = 0;
    let mut at = 12usize;

    while at + 8 <= bytes.len() {
        let size = le32(bytes, at + 4);

        // The TypeScript engine reads past the end of a format chunk cut
        // short, and fails; here it is not read.
        if tag(at) == Some(b"fmt ") && at + 20 <= bytes.len() {
            per_second = le32(bytes, at + 16);
        } else if tag(at) == Some(b"data") {
            data = size;
        }

        at += 8 + size as usize + (size & 1) as usize;
    }

    if per_second == 0 {
        0
    } else {
        round(f64::from(data) * 1000.0 / f64::from(per_second))
    }
}

/// A MIDI file's length in the sequencer's two time formats: in sixteenths,
/// its longest track's ticks over a quarter's, and in milliseconds, at its
/// tempos -- 120 a minute until one is set.
fn midi_lengths(bytes: &[u8]) -> Vec<(u32, u32)> {
    let none = vec![(MCI_SEQ_FORMAT_SONGPTR, 0), (MCI_FORMAT_MILLISECONDS, 0)];

    if bytes.len() < 14 || bytes.get(0..4) != Some(b"MThd") {
        return none;
    }

    let division = f64::from(i16::from_be_bytes([bytes[12], bytes[13]]));
    let mut tempos: Vec<(f64, f64)> = Vec::new();
    let mut longest = 0.0f64;
    let mut at = 8 + be32(bytes, 4) as usize;

    while at + 8 <= bytes.len() {
        let size = be32(bytes, at + 4) as usize;

        if bytes.get(at..at + 4) == Some(b"MTrk") {
            let end = bytes.len().min(at + 8 + size);

            longest = longest.max(track_ticks(&bytes[at + 8..end], &mut tempos));
        }

        at += 8 + size;
    }

    if division <= 0.0 {
        return none;
    }

    let mut micro = 0.0;
    let mut tick = 0.0;
    let mut tempo = 500_000.0;

    tempos.sort_by(|a, b| a.0.total_cmp(&b.0));

    for (at, next) in tempos {
        if at > longest {
            break;
        }

        micro += ((at - tick) * tempo) / division;
        tick = at;
        tempo = next;
    }

    micro += ((longest - tick) * tempo) / division;

    vec![
        (MCI_SEQ_FORMAT_SONGPTR, round((longest * 4.0) / division)),
        (MCI_FORMAT_MILLISECONDS, round(micro / 1000.0)),
    ]
}

/// The ticks a track's events take, to its end; its tempo changes, by
/// tick, put in `tempos`. A byte read past the track's end reads as
/// nothing, as JavaScript's `undefined` does.
fn track_ticks(track: &[u8], tempos: &mut Vec<(f64, f64)>) -> f64 {
    let mut ticks = 0.0;
    let mut status = 0u8;
    let mut at = 0usize;
    let number = |at: &mut usize| {
        let mut value: u32 = 0;

        for _ in 0..4 {
            if *at >= track.len() {
                break;
            }

            let byte = track[*at];

            *at += 1;
            value = (value << 7) | u32::from(byte & 0x7f);

            if byte & 0x80 == 0 {
                break;
            }
        }

        value
    };

    while at < track.len() {
        ticks += f64::from(number(&mut at));

        if at >= track.len() {
            break;
        }

        if track[at] & 0x80 != 0 {
            status = track[at];
            at += 1;
        }

        if status == 0xff {
            let kind = track.get(at).copied();

            at += 1;

            let size = number(&mut at) as usize;

            if kind == Some(0x51) && size == 3 && at + 3 <= track.len() {
                tempos.push((
                    ticks,
                    f64::from(
                        u32::from(track[at]) << 16
                            | u32::from(track[at + 1]) << 8
                            | u32::from(track[at + 2]),
                    ),
                ));
            }

            at += size;

            if kind == Some(0x2f) {
                break;
            }
        } else if status == 0xf0 || status == 0xf7 {
            // From where the length starts, not past it: JavaScript reads
            // `at` before the call that moves it.
            let from = at;

            at = from + number(&mut at) as usize;
        } else {
            at += if status & 0xf0 == 0xc0 || status & 0xf0 == 0xd0 {
                1
            } else {
                2
            };
        }
    }

    ticks
}

/// Opens the file an `MCI_OPEN_PARMS` names for a device: its length kept
/// by the device's ID. Nought, or 113h for a file that is not there.
fn open_file(system: &mut System, kind: Kind, id: u16, parms: u32) -> u32 {
    let far = long_at(system, far_at(parms, 12));
    let name = if far >> 16 != 0 {
        system.read_string(far)
    } else {
        Vec::new()
    };
    let name: String = name.iter().map(|&byte| char::from(byte)).collect();
    let handle = if name.is_empty() {
        None
    } else {
        system.files.open(&name)
    };
    let Some(handle) = handle else {
        return MCIERR_FILE_NOT_FOUND;
    };
    let bytes = system.files.resolve(handle).map_or_else(Vec::new, |file| {
        let size = file.size() as usize;

        file.read(size)
    });

    system.files.close(handle);
    system.mmsystem.drivers.opened.insert(
        id,
        match kind {
            Kind::Wave => Opened {
                lengths: vec![(MCI_FORMAT_MILLISECONDS, wave_length(&bytes))],
                format: MCI_FORMAT_MILLISECONDS,
            },
            Kind::Seq => Opened {
                lengths: midi_lengths(&bytes),
                format: MCI_SEQ_FORMAT_SONGPTR,
            },
        },
    );
    0
}

/// The commands a device with a file open answers: its status, playing,
/// which there is nothing to play on, and stopping. `None` for any other.
fn file_command(
    system: &mut System,
    kind: Kind,
    id: u16,
    message: u16,
    flags: u32,
    parms: u32,
) -> Option<u32> {
    let opened = system.mmsystem.drivers.opened.get(&id)?.clone();

    match message {
        // MCI_PLAY
        0x806 => Some(match kind {
            Kind::Wave => MCIERR_WAVE_OUTPUTSUNSUITABLE,
            Kind::Seq => MCIERR_SEQ_NOMIDIPRESENT,
        }),
        // MCI_SEEK, MCI_STOP
        0x807 | 0x808 => {
            notify(system, id, flags, parms);
            Some(0)
        }
        // MCI_SET
        0x80d => {
            if flags & MCI_SET_TIME_FORMAT == 0 {
                return None;
            }

            let format = long_at(system, far_at(parms, 4));

            // Only the formats the device measures a length in.
            if opened.length(format).is_none() {
                return Some(MCIERR_BAD_TIME_FORMAT);
            }

            if let Some(open) = system.mmsystem.drivers.opened.get_mut(&id) {
                open.format = format;
            }

            notify(system, id, flags, parms);
            Some(0)
        }
        // MCI_STATUS
        0x814 => {
            let item = long_at(system, far_at(parms, 8));
            let answer = match item {
                MCI_STATUS_LENGTH => opened.length(opened.format).unwrap_or(0),
                MCI_STATUS_POSITION | MCI_STATUS_READY => 0,
                MCI_STATUS_MODE => MCI_MODE_STOP,
                MCI_STATUS_TIME_FORMAT => opened.format,
                _ => return None,
            };

            if flags & MCI_STATUS_ITEM == 0 {
                return None;
            }

            system.write_far(far_at(parms, 4), &(answer as u16).to_le_bytes());
            system.write_far(far_at(parms, 6), &((answer >> 16) as u16).to_le_bytes());
            notify(system, id, flags, parms);
            Some(0)
        }
        _ => None,
    }
}

/// A driver's answer to USER's messages; MCI's own, 800h to 17FFh, to the
/// driver's commands.
pub fn driver_proc(
    system: &mut System,
    module: &str,
    id: u32,
    handle: u16,
    message: u16,
    first: u32,
    second: u32,
) -> u32 {
    let kind = if module == "MCISEQ" {
        Kind::Seq
    } else {
        Kind::Wave
    };

    match message {
        // DRV_LOAD
        1 => {
            if kind == Kind::Wave {
                system.mmsystem.drivers.wave = Some((0, 0));
            }

            1
        }
        // DRV_OPEN, with `MCI_OPEN_DRIVER_PARMS`
        3 => {
            if second == 0 {
                return 10000;
            }

            let (command_table, device_type) = match kind {
                Kind::Wave => (0u16, 0x20au16),
                Kind::Seq => (0xffff, 0x20b),
            };

            system.write_far(far_at(second, 6), &command_table.to_le_bytes());
            system.write_far(far_at(second, 8), &device_type.to_le_bytes());

            let bytes = system.read_far(second, 2);

            u32::from(u16::from_le_bytes([bytes[0], bytes[1]]))
        }
        // DRV_CLOSE, DRV_FREE, DRV_INSTALL, DRV_REMOVE
        4 | 6 | 9 | 10 => 1,
        // DRV_CONFIGURE, DRV_QUERYCONFIGURE
        7 | 8 => u32::from(kind == Kind::Wave && message == 8),
        _ if id >> 16 == 0 && (0x800..=0x17ff).contains(&message) => {
            let flags = first;

            match kind {
                Kind::Wave => wave_command(system, id as u16, message, flags, second),
                Kind::Seq => seq_command(system, id as u16, message, flags, second),
            }
        }
        _ => crate::drivers::def_driver_proc(handle, message),
    }
}

/// Copies a driver's string into a caller's buffer, as `LoadString` does:
/// at most the size less one, and a nought. How many were copied.
fn copy_string(system: &mut System, text: &[u8], far: u32, size: u16) -> u16 {
    let count = text.len().min(usize::from(size).saturating_sub(1));

    system.write_far(far, &text[..count]);

    if size > 0 {
        system.write_far(far_at(far, count as u32), &[0]);
    }

    count as u16
}

/// The words of an `MCI_INFO_PARMS`: where the text goes, and its room.
fn info_buffer(system: &System, parms: u32) -> (u32, u16) {
    let far = long_at(system, far_at(parms, 4));
    let bytes = system.read_far(far_at(parms, 8), 2);

    (far, u16::from_le_bytes([bytes[0], bytes[1]]))
}

/// MCIWAVE's commands (seg2 `1f08`).
fn wave_command(system: &mut System, id: u16, message: u16, flags: u32, parms: u32) -> u32 {
    if let Some(answered) = file_command(system, Kind::Wave, id, message, flags, parms) {
        return answered;
    }

    // With no file open, these have nothing to act on.
    if [
        0x806, 0x807, 0x808, 0x809, 0x80d, 0x80f, 0x813, 0x814, 0x830, 0x852, 0x853, 0x855, 0x856,
    ]
    .contains(&message)
    {
        return MCIERR_UNSUPPORTED_FUNCTION;
    }

    let result = match message {
        // MCI_OPEN_DRIVER
        0x801 => {
            if flags & MCI_WAVE_OPEN_BUFFER != 0 {
                let bytes = system.read_far(far_at(parms, 0x14), 2);
                let seconds = u16::from_le_bytes([bytes[0], bytes[1]]);

                if !(2..=9).contains(&seconds) {
                    return MCIERR_BAD_CONSTANT;
                }
            }

            if flags & (MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID) == 0 {
                0
            } else {
                if flags & MCI_OPEN_SHAREABLE != 0 {
                    return MCIERR_UNSUPPORTED_FUNCTION;
                }

                if flags & (MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID)
                    == MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID
                {
                    return MCIERR_FLAGS_NOT_COMPATIBLE;
                }

                let result = open_file(system, Kind::Wave, id, parms);

                if result != 0 {
                    return result;
                }

                result
            }
        }
        // MCI_CLOSE_DRIVER
        0x802 => {
            system.mmsystem.drivers.opened.remove(&id);
            0
        }
        // MCI_INFO
        0x80a => {
            let (far, size) = info_buffer(system, parms);
            let asked = flags & !(MCI_NOTIFY | MCI_WAIT);

            if far == 0 || size == 0 {
                return MCIERR_PARAM_OVERFLOW;
            }

            if asked == 0 {
                return MCIERR_MISSING_PARAMETER;
            }

            if asked & !(0x100 | 0x200 | 0x40_0000 | 0x80_0000) != 0 {
                return MCIERR_HARDWARE;
            }

            if asked != MCI_INFO_PRODUCT {
                return if asked == MCI_INFO_FILE || asked == 0x40_0000 || asked == 0x80_0000 {
                    MCIERR_UNSUPPORTED_FUNCTION
                } else {
                    MCIERR_FLAGS_NOT_COMPATIBLE
                };
            }

            let length = copy_string(system, WAVE_PRODUCT, far, size);

            system.write_far(far_at(parms, 8), &length.to_le_bytes());
            system.write_far(far_at(parms, 10), &[0, 0]);
            0
        }
        // MCI_GETDEVCAPS
        0x80b => {
            let asked = flags & !(MCI_NOTIFY | MCI_WAIT);
            let item = long_at(system, far_at(parms, 8));
            let (out, into) = system.mmsystem.drivers.wave.unwrap_or((0, 0));

            if asked == 0 || item == 0 {
                return MCIERR_MISSING_PARAMETER;
            }

            if asked != MCI_GETDEVCAPS_ITEM || item & !0x400f != 0 {
                return MCIERR_HARDWARE;
            }

            let yes_if = |count: u16| if count != 0 { YES } else { NO };
            let (value, result) = match item {
                1 => (yes_if(into), RESOURCE_RETURNED),
                2 | 5 | 6 | 9 => (YES, RESOURCE_RETURNED),
                3 | 7 => (NO, RESOURCE_RETURNED),
                4 => (0x020a_020a, RESOURCE_RETURNED),
                8 => (yes_if(out), RESOURCE_RETURNED),
                0x4001 => (u32::from(into), 0),
                0x4002 => (u32::from(out), 0),
                _ => return MCIERR_UNSUPPORTED_FUNCTION,
            };

            system.write_far(far_at(parms, 4), &(value as u16).to_le_bytes());
            system.write_far(far_at(parms, 6), &((value >> 16) as u16).to_le_bytes());
            result
        }
        0x850 => return MCIERR_UNSUPPORTED_FUNCTION,
        _ => return MCIERR_UNRECOGNIZED_COMMAND,
    };

    if result.trailing_zeros() >= 16 {
        notify(system, id, flags, parms);
    }

    result
}

/// MCISEQ's commands (seg2 `0`).
fn seq_command(system: &mut System, id: u16, message: u16, flags: u32, parms: u32) -> u32 {
    if let Some(answered) = file_command(system, Kind::Seq, id, message, flags, parms) {
        return answered;
    }

    if ![0x801, 0x802, 0x80a, 0x80b].contains(&message) {
        return if [
            0x806, 0x807, 0x808, 0x809, 0x80d, 0x814, 0x80e, 0x80f, 0x812, 0x813, 0x830,
        ]
        .contains(&message)
            || (0x840..=0x845).contains(&message)
            || (0x850..=0x856).contains(&message)
        {
            MCIERR_UNSUPPORTED_FUNCTION
        } else {
            MCIERR_UNRECOGNIZED_COMMAND
        };
    }

    let result = match message {
        // MCI_OPEN_DRIVER
        0x801 => {
            if flags & (MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID)
                == MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID
            {
                return MCIERR_FLAGS_NOT_COMPATIBLE;
            }

            if flags & (MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID) == 0 {
                0
            } else {
                if flags & MCI_OPEN_SHAREABLE != 0 {
                    return MCIERR_UNSUPPORTED_FUNCTION;
                }

                let result = open_file(system, Kind::Seq, id, parms);

                if result != 0 {
                    return result;
                }

                result
            }
        }
        // MCI_CLOSE_DRIVER
        0x802 => {
            system.mmsystem.drivers.opened.remove(&id);
            0
        }
        // MCI_INFO
        0x80a => {
            let (far, size) = info_buffer(system, parms);
            let asked = flags & !(MCI_NOTIFY | MCI_WAIT);

            if far == 0 {
                return MCIERR_PARAM_OVERFLOW;
            }

            if asked & !(MCI_INFO_PRODUCT | MCI_INFO_FILE) != 0 {
                return MCIERR_HARDWARE;
            }

            if asked == MCI_INFO_FILE {
                return MCIERR_UNSUPPORTED_FUNCTION;
            }

            if asked != MCI_INFO_PRODUCT {
                return MCIERR_MISSING_PARAMETER;
            }

            copy_string(system, SEQ_PRODUCT, far, size);
            0
        }
        // MCI_GETDEVCAPS
        _ => {
            let item = long_at(system, far_at(parms, 8));

            if flags & MCI_GETDEVCAPS_ITEM == 0 || !(1..=9).contains(&item) {
                return MCIERR_MISSING_PARAMETER;
            }

            // The MIDI devices out, counted as it is asked: none.
            let midi = NO;
            let value = [NO, midi, NO, 0x020b_020b, midi, midi, NO, midi, NO][item as usize - 1];

            system.write_far(far_at(parms, 4), &(value as u16).to_le_bytes());
            system.write_far(far_at(parms, 6), &((value >> 16) as u16).to_le_bytes());
            RESOURCE_RETURNED
        }
    };

    if result.trailing_zeros() >= 16 {
        notify(system, id, flags, parms);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `sndplay`'s silence: 64 samples at 11,025 a second, 6 milliseconds.
    #[test]
    fn a_wave_file_is_as_long_as_its_samples() {
        let mut bytes = b"RIFF\x64\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0\x11\x2b\0\0\x11\x2b\0\0\x01\0\x08\0data\x40\0\0\0".to_vec();

        bytes.extend([0x80; 64]);
        assert_eq!(wave_length(&bytes), 6);
    }

    /// `sndplay`'s note: a quarter at 96 ticks, four sixteenths, 500
    /// milliseconds at 120 a minute.
    #[test]
    fn a_midi_file_is_as_long_as_its_longest_track() {
        let bytes = [
            b'M', b'T', b'h', b'd', 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, b'M', b'T', b'r', b'k', 0, 0, 0,
            12, 0, 0x90, 60, 64, 96, 0x80, 60, 64, 0, 0xff, 0x2f, 0,
        ];

        assert_eq!(
            midi_lengths(&bytes),
            vec![(MCI_SEQ_FORMAT_SONGPTR, 4), (MCI_FORMAT_MILLISECONDS, 500)]
        );
    }
}

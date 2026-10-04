//! `MCIWAVE.DRV` playing a waveform file through the waveform output
//! device, and the commands that move or ask after where it is.
//!
//! **Read out** of `MCIWAVE.DRV` (seg2 `1374`, `1220`, `954`, `8da`,
//! `cb6`, `d9c`, `89c`, `e0c`, `1530`, `15a4`, `16d4`; seg8 `1fe`, `0`;
//! seg1 `0`, `138`):
//!
//! * A file opened gets a background task of the driver's own
//!   (`mmTaskCreate`), which does the playing, and a number of buffers: as
//!   many as `MCI_WAVE_OPEN_BUFFER` asks, 2 to 9, else as many as the
//!   driver was opened with -- the number its `[mci]` line gives after the
//!   driver's name, 4 where none does, or one outside 2 to 9.
//! * Playing, with no position to play from or to, plays from where the
//!   device is to the end of the file's data. The waveform output device is
//!   opened by the mapper's number, with the file's format, to call the task
//!   back. Where it will not open, the format is asked after: a format no
//!   device plays answers `MCIERR_WAVE_OUTPUTSUNSUITABLE` (146h), else the
//!   device is in use, `MCIERR_WAVE_OUTPUTSINUSE` (140h).
//! * The task makes each buffer a block of its own (`GlobalAlloc` 2002h) of
//!   a `WAVEHDR` and a second of the file -- its bytes a second, rounded up
//!   to a whole block -- and prepares it; fewer than two is
//!   `MCIERR_OUT_OF_MEMORY` (108h). It fills each buffer in turn from the
//!   file and writes it, as many as there are buffers, then waits for one
//!   to be done before it fills the next, until the data is played and every
//!   buffer is back. A read that comes up short is `MCIERR_FILE_READ`
//!   (15Ch), and what was read plays. Then the device is where the
//!   device's position says, the buffers are unprepared and let go, last
//!   first, and the device closed.
//! * With `MCI_WAIT` the call waits for all of it, and answers the task's
//!   error, if any; with `MCI_NOTIFY` the task posts `MM_MCINOTIFY` as it
//!   finishes: successful where it played to the end, aborted where it
//!   stopped short of it -- and no notice where the call waited and it
//!   failed.
//! * Seeking takes `MCI_TO`, `MCI_SEEK_TO_START` or `MCI_SEEK_TO_END`,
//!   one only (11Ch), and nothing else (103h), and needs one (111h): the
//!   device stopped and moved there.
//! * Pausing and resuming take nothing but `MCI_NOTIFY` and `MCI_WAIT`
//!   (103h); with nothing playing, `MCIERR_NONAPPLICABLE_FUNCTION` (12Eh).
//!
//! **Recorded** by `sndplay` on the installation with a sound card:
//! `play quiet wait` answers nought.
//!
//! Not followed, and stopped at: playing without `MCI_WAIT`, which goes on
//! in the driver's task while the program runs; playing from or to a
//! position, and seeking to one, which want the driver's conversion from a
//! time format; a waveform file whose format or data chunk is not there.
//! Not as Windows does it: winbox.js has no task for the driver; the
//! device is opened with no callback, and the call waits in the caller's
//! task for each buffer to be done, the time passed to each of the card's
//! interrupts in turn. A `[mci]` line's number of buffers is not read: the
//! driver is opened with 4.

use std::collections::HashMap;

use crate::call::Stop;
use crate::engine::Engine;
use crate::system::System;

use super::checks::{self, DONE, PREPARED};
use super::devices::{self, Kind, MMSYSERR_NOERROR};
use super::mci::{far_at, long_at};
use super::sound;
use super::wave::out;

const MCI_NOTIFY: u32 = 0x1;
const MCI_WAIT: u32 = 0x2;
const MCI_FROM: u32 = 0x4;
const MCI_TO: u32 = 0x8;
const MCI_SEEK_TO_START: u32 = 0x100;
const MCI_SEEK_TO_END: u32 = 0x200;
const MCI_WAVE_OPEN_BUFFER: u32 = 0x10000;

const MCI_CLOSE_DRIVER: u16 = 0x802;
const MCI_PLAY: u16 = 0x806;
const MCI_SEEK: u16 = 0x807;
const MCI_PAUSE: u16 = 0x809;
const MCI_RESUME: u16 = 0x855;

const MCIERR_UNRECOGNIZED_KEYWORD: u32 = 0x103;
const MCIERR_OUT_OF_MEMORY: u32 = 0x108;
const MCIERR_MISSING_PARAMETER: u32 = 0x111;
const MCIERR_FLAGS_NOT_COMPATIBLE: u32 = 0x11c;
const MCIERR_NONAPPLICABLE_FUNCTION: u32 = 0x12e;
const MCIERR_WAVE_OUTPUTSINUSE: u32 = 0x140;
const MCIERR_WAVE_OUTPUTSUNSUITABLE: u32 = 0x146;
const MCIERR_FILE_READ: u32 = 0x15c;

const MM_MCINOTIFY: u16 = 0x3b9;
const MCI_NOTIFY_SUCCESSFUL: u16 = 1;
const MCI_NOTIFY_ABORTED: u16 = 4;

/// The buffers a driver is opened with where its `[mci]` line gives none.
const BUFFERS: u16 = 4;

/// A buffer's block: a `WAVEHDR`, then its second of the file.
const HEADER_SIZE: u16 = 0x20;
const GMEM_BUFFER: u16 = 0x2002;

/// `waveOutOpen`'s query flag.
const WAVE_FORMAT_QUERY: u32 = 1;

/// A file the driver has open, by its device's ID.
#[derive(Debug, Clone, Default)]
struct Opened {
    /// The format chunk, and the data chunk's bytes as far as the file
    /// has them, and how many the chunk says it has.
    format: Option<Vec<u8>>,
    data: Vec<u8>,
    length: u32,
    /// Where the device is, in bytes.
    position: u32,
    buffers: u16,
}

/// What the driver keeps of its files.
#[derive(Debug, Default)]
pub struct WaveFiles {
    opened: HashMap<u16, Opened>,
}

/// A file opened by the device `id`: its chunks read.
pub fn opened(system: &mut System, id: u16, bytes: &[u8]) {
    let (format, data, length) = chunks(bytes);

    system.mmsystem.wave_files.opened.insert(
        id,
        Opened {
            format,
            data,
            length,
            position: 0,
            buffers: BUFFERS,
        },
    );
}

/// The buffers `MCI_WAVE_OPEN_BUFFER` asked for, if it did, in an
/// `MCI_WAVE_OPEN_PARMS`.
pub fn set_buffers(system: &mut System, id: u16, flags: u32, parms: u32) {
    if flags & MCI_WAVE_OPEN_BUFFER == 0 {
        return;
    }

    let bytes = system.read_far(far_at(parms, 0x14), 2);

    if let Some(opened) = system.mmsystem.wave_files.opened.get_mut(&id) {
        opened.buffers = u16::from_le_bytes([bytes[0], bytes[1]]);
    }
}

/// Where the device `id` is, as its length is given: nought at the start,
/// all of it at the end. None where it has no file.
pub fn position(system: &System, id: u16) -> Option<bool> {
    let opened = system.mmsystem.wave_files.opened.get(&id)?;

    Some(opened.position != 0 && opened.position >= opened.length)
}

/// A file's format chunk and data chunk, walked as `mmioDescend` walks
/// them: each chunk its size and a byte to an even one on.
fn chunks(bytes: &[u8]) -> (Option<Vec<u8>>, Vec<u8>, u32) {
    let tag = |at: usize| bytes.get(at..at + 4);
    let size = |at: usize| {
        bytes.get(at + 4..at + 8).map_or(0, |four| {
            u32::from_le_bytes([four[0], four[1], four[2], four[3]])
        })
    };
    let mut format = None;
    let mut data = Vec::new();
    let mut length = 0;

    if tag(0) != Some(b"RIFF") || tag(8) != Some(b"WAVE") {
        return (None, data, 0);
    }

    let mut at = 12usize;

    while at + 8 <= bytes.len() {
        let each = size(at) as usize;
        let body = bytes
            .get(at + 8..bytes.len().min(at + 8 + each))
            .unwrap_or(&[]);

        if tag(at) == Some(b"fmt ") && format.is_none() {
            format = Some(body.to_vec());
        } else if tag(at) == Some(b"data") && format.is_some() {
            data = body.to_vec();
            length = size(at);
            break;
        }

        at += 8 + each + (each & 1);
    }

    (format, data, length)
}

/// Whether a command is one this module answers, for a file the device has
/// open: playing, with a waveform output device to play on.
pub fn plays(system: &System, id: u32, message: u16) -> bool {
    id >> 16 == 0
        && message == MCI_PLAY
        && system.mmsystem.wave_files.opened.contains_key(&(id as u16))
        && system.mmsystem.devices.count(Kind::WaveOut) != 0
}

/// The commands this module answers without waiting, for a file the
/// device has open: seeking, pausing and resuming. `None` for another --
/// closing, whose file is forgotten here and the rest of which is the
/// driver's.
pub fn command(
    system: &mut System,
    id: u16,
    message: u16,
    flags: u32,
    parms: u32,
) -> Result<Option<u32>, Stop> {
    if message == MCI_CLOSE_DRIVER {
        system.mmsystem.wave_files.opened.remove(&id);
        return Ok(None);
    }

    let Some(opened) = system.mmsystem.wave_files.opened.get(&id) else {
        return Ok(None);
    };
    let length = opened.length;

    Ok(Some(match message {
        // seg2 `1530`, `15a4`: nothing is playing.
        MCI_PAUSE | MCI_RESUME => {
            if flags & !(MCI_NOTIFY | MCI_WAIT) != 0 {
                MCIERR_UNRECOGNIZED_KEYWORD
            } else {
                MCIERR_NONAPPLICABLE_FUNCTION
            }
        }
        // seg2 `16d4`.
        MCI_SEEK => {
            let asked = flags & !(MCI_NOTIFY | MCI_WAIT);

            if asked == 0 {
                return Ok(Some(MCIERR_MISSING_PARAMETER));
            }

            if asked & !(MCI_TO | MCI_SEEK_TO_START | MCI_SEEK_TO_END) != 0 {
                return Ok(Some(MCIERR_UNRECOGNIZED_KEYWORD));
            }

            let to = match asked {
                MCI_SEEK_TO_START => 0,
                MCI_SEEK_TO_END => length,
                MCI_TO => return Err(Stop::Unsupported("MCIWAVE seeking to a position")),
                _ => return Ok(Some(MCIERR_FLAGS_NOT_COMPATIBLE)),
            };

            if let Some(opened) = system.mmsystem.wave_files.opened.get_mut(&id) {
                opened.position = to;
            }

            notify(system, flags, parms, id, MCI_NOTIFY_SUCCESSFUL);
            0
        }
        _ => return Ok(None),
    }))
}

/// `MM_MCINOTIFY` posted to the window the parameters name, as
/// `mciDriverNotify` posts it.
fn notify(system: &mut System, flags: u32, parms: u32, id: u16, status: u16) {
    if flags & MCI_NOTIFY == 0 || parms == 0 {
        return;
    }

    let hwnd = long_at(system, parms) as u16;

    if hwnd != 0 {
        system.post_message(hwnd, MM_MCINOTIFY, status, u32::from(id));
    }
}

/// `MCI_PLAY` (seg2 `1374`), with a waveform output device to play on.
pub async fn play(engine: &Engine, id: u16, flags: u32, parms: u32) -> Result<u32, Stop> {
    if flags & (MCI_FROM | MCI_TO) != 0 {
        return Err(Stop::Unsupported("MCIWAVE playing from or to a position"));
    }

    if flags & !(MCI_NOTIFY | MCI_WAIT) != 0 {
        return Err(Stop::Unsupported("MCIWAVE playing with a flag of its own"));
    }

    let Some(opened) = engine.system().mmsystem.wave_files.opened.get(&id).cloned() else {
        return Ok(0);
    };
    let Some(format) = opened.format.clone() else {
        return Err(Stop::Unsupported(
            "MCIWAVE playing a file with no format or data",
        ));
    };

    sound::settle(engine).await?;

    // seg2 `954`: the device opened, to call the task back.
    let (answer, device) = open_device(engine, &format, 0).await?;

    if answer != MMSYSERR_NOERROR {
        let (query, _) = open_device(engine, &format, WAVE_FORMAT_QUERY).await?;

        return Ok(if query == MMSYSERR_NOERROR {
            MCIERR_WAVE_OUTPUTSINUSE
        } else {
            MCIERR_WAVE_OUTPUTSUNSUITABLE
        });
    }

    if flags & MCI_WAIT == 0 {
        return Err(Stop::Unsupported(
            "MCIWAVE playing in its task, without MCI_WAIT",
        ));
    }

    let (error, position) = play_buffers(engine, device, &format, &opened).await?;

    out::close(engine, device).await?;

    let mut system = engine.system();

    if let Some(each) = system.mmsystem.wave_files.opened.get_mut(&id) {
        each.position = position;
    }

    if error == 0 {
        let status = if position >= opened.length {
            MCI_NOTIFY_SUCCESSFUL
        } else {
            MCI_NOTIFY_ABORTED
        };

        notify(&mut system, flags, parms, id, status);
    }

    Ok(error)
}

/// The waveform output device opened by the mapper's number with the
/// file's format, or only asked whether it takes it: the answer, and the
/// handle.
async fn open_device(engine: &Engine, format: &[u8], query: u32) -> Result<(u16, u16), Stop> {
    let frame = devices::below_stack(&mut engine.system(), &[&[0, 0], format]);
    let answer = out::open(
        engine,
        frame.pointers[0],
        devices::MAPPER,
        frame.pointers[1],
        0,
        0,
        query,
    )
    .await;
    let device = {
        let mut system = engine.system();
        let bytes = system.read_far(frame.pointers[0], 2);

        frame.release(&mut system);
        u16::from_le_bytes([bytes[0], bytes[1]])
    };

    Ok((answer?, device))
}

/// The task's playing (seg2 `e0c`, `cb6`; seg8 `1fe`): the buffers made,
/// filled and written in turn until the data has played, then let go. The
/// error, and where the device is.
async fn play_buffers(
    engine: &Engine,
    device: u16,
    format: &[u8],
    opened: &Opened,
) -> Result<(u32, u32), Stop> {
    let field = |at: usize| {
        format.get(at..at + 4).map_or(0, |four| {
            u32::from_le_bytes([four[0], four[1], four[2], four[3]])
        })
    };
    let per_second = field(8);
    let align = u32::from(format.get(12).copied().unwrap_or(0))
        | u32::from(format.get(13).copied().unwrap_or(0)) << 8;
    let size = match align {
        0 => return Err(Stop::Unsupported("MCIWAVE playing a format of no block")),
        align => per_second.div_ceil(align) * align,
    };

    // seg2 `cb6`: each buffer a block of a header and a second.
    let mut buffers = Vec::new();

    for _ in 0..opened.buffers {
        let block = {
            let mut system = engine.system();
            let handle = sound::alloc(&mut system, GMEM_BUFFER, size + u32::from(HEADER_SIZE));

            if handle == 0 {
                break;
            }

            let header = u32::from(sound::lock(&system, handle).unwrap_or(0)) << 16;
            let mut fields = Vec::with_capacity(0x14);

            fields.extend_from_slice(&(header | u32::from(HEADER_SIZE)).to_le_bytes());
            fields.extend_from_slice(&size.to_le_bytes());
            fields.extend_from_slice(&[0; 8]);
            fields.extend_from_slice(&DONE.to_le_bytes());
            system.write_far(header, &fields);
            (handle, header)
        };

        if out::prepare(engine, device, block.1, HEADER_SIZE).await? != MMSYSERR_NOERROR {
            sound::free(&mut engine.system(), block.0);
            break;
        }

        buffers.push(block);
    }

    let mut error = 0;
    let mut position = opened.position;

    if buffers.len() < 2 {
        error = MCIERR_OUT_OF_MEMORY;
    } else {
        let mut outstanding = std::collections::VecDeque::new();
        let mut slot = 0;

        loop {
            if outstanding.len() < buffers.len() && position < opened.length {
                let (_, header) = buffers[slot];
                let wanted = (opened.length - position).min(size);
                let bytes = opened
                    .data
                    .get(position as usize..)
                    .map_or(&[][..], |rest| &rest[..rest.len().min(wanted as usize)]);
                let got = bytes.len() as u32;

                if got == 0 {
                    break;
                }

                {
                    let mut system = engine.system();
                    let flags = checks::header_flags(&system, header);

                    system.write_far(header | u32::from(HEADER_SIZE), bytes);
                    system.write_far(header | 4, &got.to_le_bytes());
                    checks::set_header_flags(&mut system, header, flags & !0x0d);
                }

                position += got;

                let written = out::write(engine, device, header, HEADER_SIZE).await?;

                if written != MMSYSERR_NOERROR {
                    error = u32::from(written);
                    break;
                }

                if got != wanted {
                    error = MCIERR_FILE_READ;
                }

                outstanding.push_back(header);
                slot = (slot + 1) % buffers.len();

                if error != 0 {
                    break;
                }
            } else if let Some(header) = outstanding.pop_front() {
                sound::wait_for(engine, |system| {
                    checks::header_flags(system, header) & DONE != 0
                })?;
            } else {
                break;
            }
        }

        // What is still queued after an error is played out first.
        for header in outstanding {
            sound::wait_for(engine, |system| {
                checks::header_flags(system, header) & DONE != 0
            })?;
        }
    }

    // seg2 `d9c`: the buffers unprepared and let go, last first.
    for &(handle, header) in buffers.iter().rev() {
        if checks::header_flags(&engine.system(), header) & PREPARED != 0 {
            out::unprepare(engine, device, header, HEADER_SIZE).await?;
        }

        sound::free(&mut engine.system(), handle);
    }

    Ok((error, position.min(opened.length)))
}

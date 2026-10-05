//! `MCIWAVE.DRV` playing a waveform file through the waveform output
//! device, in the background or waited for, and the commands that reach a
//! play under way or ask after where it is.
//!
//! **Read out** of `MCIWAVE.DRV` (seg2 `1f08` the commands; `f9e`
//! opening, `f5e` closing; `1374` playing, `1220` its range, `1126`,
//! `1190` a position from and to; `954`, `8da` the device opened; `c52`
//! stopping, `4c` resetting; `1530` pausing, `15a4` resuming; `16d4`
//! seeking; `1780` the status; `a6c` the position; `b30` moving it; `9f6`,
//! `a1a`, `a32` notifying; the task `e0c`, its buffers `cb6`, `d9c`, its
//! device closed `89c`; seg8 `1fe`, `1a8`, `0` the task's loop; seg4 `0`
//! the arithmetic) and of `MMSYSTEM.DLL` (seg4 `598`, `5b9`, `5be`, `5fa`,
//! seg1 `264`: `mmTaskYield`, `mmGetCurrentTask`, `mmTaskBlock`,
//! `mmTaskCreate`, `mmTaskSignal`):
//!
//! * **The task.** Opening a file makes the driver a task of its own
//!   (`mmTaskCreate`, which starts `MMTASK.TSK` running the driver's
//!   function `e0c`), and the opening waits, yielding, until the task has
//!   the file. The task then waits in `mmTaskBlock` -- `GetMessage` until a
//!   message for the task itself, of `3A0h` or more, comes -- for a play.
//!   The device is opened by the program's call, to call the task back
//!   (`CALLBACK_TASK`), so the device's every callback -- opened, a buffer
//!   done, closed -- is a message that wakes it. Windows runs the task only
//!   when the program lets other tasks run.
//! * **Buffers.** The task makes as many buffers as `MCI_WAVE_OPEN_BUFFER`
//!   asks, 2 to 9, else as many as the driver was opened with -- the number
//!   its `[mci]` line gives after the driver's name, 4 where none does, or
//!   one outside 2 to 9: each a block of its own (`GlobalAlloc` 2002h) of a
//!   `WAVEHDR` and a second of the file -- its bytes a second, rounded up
//!   to a whole block -- marked done and prepared. Fewer than two is
//!   `MCIERR_OUT_OF_MEMORY` (108h).
//! * **Playing** (`1374`) takes its range first (`1220`): from `MCI_FROM`,
//!   else where the device is; to `MCI_TO`, else the end of the file's
//!   data. Each is in the time format, the position from 1Ah, as bytes:
//!   the time made bytes with `MulDiv` -- which rounds -- by the format's
//!   bytes a second, less what is past a whole block; one past the length
//!   in the time format is `MCIERR_OUTOFRANGE` (11Ah), a `to` of the length
//!   is the data's end itself, and `to` before `from` is 11Ah too. A play
//!   from somewhere moves the device there and resets it. A play from
//!   somewhere, or to somewhere other than the play before was to, aborts
//!   the notification waiting (`MCI_NOTIFY_ABORTED`). Then, with nothing
//!   playing, the device is opened -- by the mapper's number, with the
//!   file's format; where it will not open, the format is asked after: a
//!   format no device plays answers `MCIERR_WAVE_OUTPUTSUNSUITABLE` (146h),
//!   else the device is in use, `MCIERR_WAVE_OUTPUTSINUSE` (140h) -- and
//!   the play is under way (the task's state 3) before the call returns. A
//!   play under way is restarted (`waveOutRestart`), which ends a pause.
//!   With `MCI_NOTIFY`, the notification waiting is superseded
//!   (`MCI_NOTIFY_SUPERSEDED`) and the play's own waits in its place.
//!   Without `MCI_WAIT` the call answers at once; with it, it waits,
//!   yielding, until the task is done.
//! * **The task's loop** (seg8 `1fe`): it fills each buffer in turn from
//!   the file, as much as is left to the play's end, and writes it, as many
//!   as there are buffers; then waits for one to be done before it fills
//!   the next, until the data is played and every buffer is back. A read
//!   that comes up short is `MCIERR_FILE_READ` (15Ch), but what was read is
//!   written and the write's answer takes the error's place; the next read,
//!   of nothing, sets it again and ends the loop with buffers still queued.
//!   A write refused ends the loop with its error.
//! * **The task's end** (`e96`-`f22`): the device's position asked and
//!   kept (`a6c`, `b30`), the device reset (`4c`), the buffers unprepared
//!   and let go, last first (`d9c`); the notification waiting posted --
//!   `MCI_NOTIFY_FAILURE` where the task failed, successful where the play
//!   reached its end, aborted where it did not -- save that a play waited
//!   for that failed notifies nothing and answers the error; then the
//!   device closed (`89c`), and the task waits for the next play.
//! * **The position** (`a6c`) is where the play began counting from and
//!   the device's own position -- asked as samples (`TIME_SAMPLES`) and
//!   made bytes, `MulDiv` by the bytes and samples a second, to a whole
//!   block -- no further than the data's end; in milliseconds it is
//!   `MulDiv` by 1000 over the bytes a second. **The mode** (`190e`) is
//!   playing while the task plays, paused while it is paused, else
//!   stopped.
//! * **Stopping** (`c52`), with a play under way: the device's position
//!   kept, the device reset, and the call yields until the task has ended
//!   the play -- aborted, unless it was at its end. Seeking (`16d4`) and
//!   closing (`f5e`) stop first; closing then ends the task. Seeking takes
//!   `MCI_TO`, `MCI_SEEK_TO_START` or `MCI_SEEK_TO_END`, one only (11Ch),
//!   nothing else (103h), and needs one (111h); `MCI_TO` past the length is
//!   11Ah.
//! * **Pausing** (`1530`) and **resuming** (`15a4`) take nothing but
//!   `MCI_NOTIFY` and `MCI_WAIT` (103h). With a play under way and not done,
//!   pausing pauses the device (`waveOutPause`), and resuming restarts it
//!   (`waveOutRestart`); with nothing playing, each is
//!   `MCIERR_NONAPPLICABLE_FUNCTION` (12Eh).
//! * **Notifying** (`20f8`): any other command that succeeds with
//!   `MCI_NOTIFY` supersedes the notification waiting before it notifies
//!   its own success -- save closing, which has no device left to.
//!
//! **Recorded** by `sndplay` on the installation with a sound card:
//! `play quiet wait` answers nought. **Recorded** by `mciplay`, twice
//! alike, of two seconds of silence played without waiting: the play
//! answers nought at once and the device is playing, its position moving;
//! played out it notifies successful, and is stopped at 2000. Paused, it
//! is paused and still; resumed, playing and moving, and notifies
//! successful at its end. Stopped part-way, the play notifies aborted
//! before the stop returns, and the device is stopped and still. Played
//! again from the start over a play, the first is aborted and the second
//! notifies successful at its end; played from 500 to 1000, it notifies
//! successful and is at 1000. Closed while playing, the play notifies
//! aborted.
//!
//! Not as Windows does it: winbox.js has no task for the driver. What the
//! task does is done by the program's calls and the card's interrupts: the
//! play's call makes the buffers and writes them, as the task does when the
//! program next lets it run, and the device is opened with no callback.
//! The card's interrupt that finds the last buffer done posts the play's
//! notification and leaves the device stopped at the play's end, as the
//! task does as soon as it runs; the device itself is reset, its buffers
//! let go and it is closed when it is next asked for -- by a command of the
//! driver's, by `waveOutOpen` or by `sndPlaySound` -- rather than then. A
//! call that waits for the task -- stopping, seeking, closing, playing with
//! `MCI_WAIT` -- does the task's part itself. A play waited for passes the
//! time to each of the card's interrupts in turn; a play that is not
//! waited for runs on the card's interrupts while the program runs, whether
//! or not the program lets other tasks run, where Windows plays nothing
//! until it does. The time the task's own work takes on Windows' processor
//! -- its buffers made and filled from the file, its end -- is not counted
//! on the machine's clock: `mciplay`'s plays to their end notify between 23
//! and 75 milliseconds sooner here than they did on Windows, which two of
//! its waits, in tenths of a second, round a tenth short.
//!
//! Not followed, and stopped at: a play in the background whose data its
//! buffers do not hold, whose refilling waits on when Windows would run
//! the task, which was not recorded; a play that waits over one under way;
//! the driver's own flags to play with; a time format other than
//! milliseconds; a waveform file whose format or data chunk is not there;
//! a file shorter than its data chunk says, and a write refused with
//! buffers still queued, after which Windows lets go of buffers the device
//! still plays and leaves the device open. A `[mci]` line's number of
//! buffers is not read: the driver is opened with 4.

use std::collections::{BTreeMap, VecDeque};

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
const MCI_STATUS_ITEM: u32 = 0x100;
const MCI_STATUS_POSITION: u32 = 2;
const MCI_WAVE_OPEN_BUFFER: u32 = 0x10000;

const MCI_CLOSE_DRIVER: u16 = 0x802;
const MCI_PLAY: u16 = 0x806;
const MCI_SEEK: u16 = 0x807;
const MCI_STOP: u16 = 0x808;
const MCI_PAUSE: u16 = 0x809;
const MCI_STATUS: u16 = 0x814;
const MCI_RESUME: u16 = 0x855;

const MCI_MODE_STOP: u32 = 0x20d;
const MCI_MODE_PLAY: u32 = 0x20e;
const MCI_MODE_PAUSE: u32 = 0x211;

const MCIERR_UNRECOGNIZED_KEYWORD: u32 = 0x103;
const MCIERR_OUT_OF_MEMORY: u32 = 0x108;
const MCIERR_MISSING_PARAMETER: u32 = 0x111;
const MCIERR_OUTOFRANGE: u32 = 0x11a;
const MCIERR_FLAGS_NOT_COMPATIBLE: u32 = 0x11c;
const MCIERR_NONAPPLICABLE_FUNCTION: u32 = 0x12e;
const MCIERR_WAVE_OUTPUTSINUSE: u32 = 0x140;
const MCIERR_WAVE_OUTPUTSUNSUITABLE: u32 = 0x146;

const MM_MCINOTIFY: u16 = 0x3b9;
const MCI_NOTIFY_SUCCESSFUL: u16 = 1;
const MCI_NOTIFY_SUPERSEDED: u16 = 2;
const MCI_NOTIFY_ABORTED: u16 = 4;
const MCI_NOTIFY_FAILURE: u16 = 8;

/// The buffers a driver is opened with where its `[mci]` line gives none.
const BUFFERS: u16 = 4;

/// A buffer's block: a `WAVEHDR`, then its second of the file.
const HEADER_SIZE: u16 = 0x20;
const GMEM_BUFFER: u16 = 0x2002;

/// `waveOutOpen`'s query flag.
const WAVE_FORMAT_QUERY: u32 = 1;

/// An `MMTIME` asked for as samples.
const TIME_SAMPLES: u16 = 2;
const MMTIME_SIZE: u16 = 8;

/// A file the driver has open, by its device's ID.
#[derive(Debug, Clone, Default)]
struct Opened {
    /// The format chunk, and the data chunk's bytes as far as the file
    /// has them, and how many the chunk says it has (`[4Ah]`).
    format: Option<Vec<u8>>,
    data: Vec<u8>,
    length: u32,
    /// Where the device is, in bytes, while nothing plays; where a play
    /// counts its position from while one does (`[42h]`).
    position: u32,
    /// Where the next byte is read from (`[3Eh]`).
    read: u32,
    /// Where the last play was to end (`[46h]`).
    to: u32,
    /// The window a notification waiting goes to (`[0Ah]`), nought for
    /// none.
    notify: u16,
    buffers: u16,
    playing: Option<Playing>,
}

/// A play under way: the task's device and buffers.
#[derive(Debug, Clone, Default)]
struct Playing {
    /// The device's handle (`[16h]`).
    device: u16,
    /// Each buffer's block and its header (`[1Ah]`), and how many bytes
    /// each holds (`[17Ah]`).
    blocks: Vec<(u16, u32)>,
    size: u32,
    /// The headers written and not yet seen done, the first written first;
    /// and the buffer filled next.
    queued: VecDeque<u32>,
    next: usize,
    /// The bytes written since the device's position was last nought, and
    /// the device's position as last asked.
    went: u32,
    reached: u32,
    /// Paused (`[2]` 8); waited for by the call that began it (`[2]` 80h);
    /// played out, the device yet to be closed.
    paused: bool,
    waited: bool,
    finished: bool,
}

/// What the driver keeps of its files.
#[derive(Debug, Default)]
pub struct WaveFiles {
    opened: BTreeMap<u16, Opened>,
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
            buffers: BUFFERS,
            ..Opened::default()
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

/// The device `id`'s mode (`190e`): playing or paused while the task
/// plays, else stopped. None where it has no file.
pub fn mode(system: &System, id: u16) -> Option<u32> {
    let opened = system.mmsystem.wave_files.opened.get(&id)?;

    Some(match &opened.playing {
        Some(playing) if !playing.finished && playing.paused => MCI_MODE_PAUSE,
        Some(playing) if !playing.finished => MCI_MODE_PLAY,
        _ => MCI_MODE_STOP,
    })
}

/// Where the device `id` is, in milliseconds (`a6c`): where its play
/// counts from and the device's position as last asked, no further than
/// the data's end. None where it has no file.
pub fn position_ms(system: &System, id: u16) -> Option<u32> {
    let opened = system.mmsystem.wave_files.opened.get(&id)?;
    let reached = opened
        .playing
        .as_ref()
        .filter(|playing| !playing.finished)
        .map_or(0, |playing| playing.reached);
    let bytes = opened.position.saturating_add(reached).min(opened.length);

    Some(match &opened.format {
        Some(format) => mul_div(bytes, 1000, field(format, 8)),
        None => 0,
    })
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

/// A doubleword of the format chunk: 4 its samples a second, 8 its bytes.
fn field(format: &[u8], at: usize) -> u32 {
    format.get(at..at + 4).map_or(0, |four| {
        u32::from_le_bytes([four[0], four[1], four[2], four[3]])
    })
}

/// The format's block (`nBlockAlign`).
fn block_of(format: &[u8]) -> u32 {
    u32::from(format.get(12).copied().unwrap_or(0))
        | u32::from(format.get(13).copied().unwrap_or(0)) << 8
}

/// `a` times `b` over `c`, rounded, as the driver's `MulDiv` (seg4 `0`)
/// works it: signed, half of `c` added before the division, and a
/// quotient that will not fit -- or a `c` of nought -- the largest there
/// is, of the sign there would have been.
fn mul_div(a: u32, b: u32, c: u32) -> u32 {
    let signed = |value: u32| i64::from(value as i32);
    let negative = ((a ^ b ^ c) as i32) < 0;
    let (a, b, c) = (
        signed(a).unsigned_abs(),
        signed(b).unsigned_abs(),
        signed(c).unsigned_abs(),
    );
    let product = u128::from(a) * u128::from(b) + u128::from(c >> 1);
    let quotient = if (product >> 32) >= u128::from(c) {
        None
    } else {
        u32::try_from(product / u128::from(c))
            .ok()
            .filter(|&quotient| quotient < 0x8000_0000)
    };

    match (quotient, negative) {
        (Some(quotient), false) => quotient,
        (Some(quotient), true) => quotient.wrapping_neg(),
        (None, false) => 0x7fff_ffff,
        (None, true) => 0x8000_0000,
    }
}

/// A time in milliseconds made bytes (`c10`): `MulDiv` by the bytes a
/// second over 1000, less what is past a whole block.
fn bytes_of(format: &[u8], ms: u32) -> Result<u32, Stop> {
    let bytes = mul_div(ms, field(format, 8), 1000);

    match block_of(format) {
        0 => Err(Stop::Unsupported("MCIWAVE playing a format of no block")),
        block => Ok(bytes - bytes % block),
    }
}

/// The length in milliseconds, as a position is measured against it
/// (`fe`).
fn length_ms(opened: &Opened, format: &[u8]) -> u32 {
    mul_div(opened.length, 1000, field(format, 8))
}

/// `from` as bytes (`1126`), or `None` past the length.
fn from_bytes(opened: &Opened, format: &[u8], from: u32) -> Result<Option<u32>, Stop> {
    if length_ms(opened, format) < from {
        return Ok(None);
    }

    Ok(Some(bytes_of(format, from)?.min(opened.length)))
}

/// `to` as bytes (`1190`, playing), or `None` past the length: the length
/// itself the data's end.
fn to_bytes(opened: &Opened, format: &[u8], to: u32) -> Result<Option<u32>, Stop> {
    let length = length_ms(opened, format);

    if length < to {
        return Ok(None);
    }

    if to == length {
        return Ok(Some(opened.length));
    }

    Ok(Some(bytes_of(format, to)?.min(opened.length)))
}

/// Whether the device `id` takes a command here, where the driver's
/// commands are answered one after another without waiting
/// (`mci_drivers.rs`) for the rest: playing, with a waveform output device
/// to play on; and, with a play under way, stopping, seeking, pausing,
/// resuming, its status and closing.
pub fn takes(system: &System, id: u32, message: u16) -> bool {
    if id >> 16 != 0 {
        return false;
    }

    let Some(opened) = system.mmsystem.wave_files.opened.get(&(id as u16)) else {
        return false;
    };

    match message {
        MCI_PLAY => system.mmsystem.devices.count(Kind::WaveOut) != 0,
        MCI_STOP | MCI_SEEK | MCI_PAUSE | MCI_RESUME | MCI_STATUS | MCI_CLOSE_DRIVER => {
            opened.playing.is_some()
        }
        _ => false,
    }
}

/// A command `takes` took: a play, or a command that reaches a play under
/// way, the rest of it then answered as the driver answers it with
/// nothing playing.
pub async fn command(
    engine: &Engine,
    id: u16,
    handle: u16,
    message: u16,
    flags: u32,
    parms: u32,
) -> Result<u32, Stop> {
    match message {
        MCI_PLAY => return play(engine, id, flags, parms).await,
        MCI_PAUSE | MCI_RESUME => {
            settle_one(engine, id).await?;

            let answer = pause_or_resume(engine, id, message, flags).await?;

            if answer == 0 {
                notify_success(&mut engine.system(), id, flags, parms);
            }

            return Ok(answer);
        }
        MCI_SEEK => {
            let target = {
                let system = engine.system();

                seek_target(&system, id, flags, parms)?
            };
            let to = match target {
                Ok(to) => to,
                Err(error) => return Ok(error),
            };

            stop(engine, id).await?;
            move_to(&mut engine.system(), id, to);
            notify_success(&mut engine.system(), id, flags, parms);
            return Ok(0);
        }
        MCI_STOP | MCI_CLOSE_DRIVER => stop(engine, id).await?,
        _ => {
            settle_one(engine, id).await?;

            // The device's position asked, for the status to answer.
            let item = flags & MCI_STATUS_ITEM != 0
                && long_at(&engine.system(), far_at(parms, 8)) == MCI_STATUS_POSITION;
            let device = playing_device(&engine.system(), id);

            if let Some(device) = device.filter(|_| item) {
                let reached = device_position(engine, id, device).await?;

                if let Some(playing) = playing_mut(&mut engine.system(), id) {
                    playing.reached = reached;
                }
            }
        }
    }

    super::mci_drivers::driver_proc(
        &mut engine.system(),
        "MCIWAVE",
        u32::from(id),
        handle,
        message,
        flags,
        parms,
    )
}

/// The commands the driver answers for a file it has open with nothing
/// playing, without waiting: seeking, pausing and resuming. `None` for
/// another -- closing, whose file is forgotten here and the rest of which
/// is the driver's.
pub fn command_now(
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

    if !system.mmsystem.wave_files.opened.contains_key(&id) {
        return Ok(None);
    }

    Ok(Some(match message {
        // `1530`, `15a4`: nothing is playing.
        MCI_PAUSE | MCI_RESUME => {
            if flags & !(MCI_NOTIFY | MCI_WAIT) != 0 {
                MCIERR_UNRECOGNIZED_KEYWORD
            } else {
                MCIERR_NONAPPLICABLE_FUNCTION
            }
        }
        MCI_SEEK => match seek_target(system, id, flags, parms)? {
            Ok(to) => {
                move_to(system, id, to);
                notify_success(system, id, flags, parms);
                0
            }
            Err(error) => error,
        },
        _ => return Ok(None),
    }))
}

/// Where a seek is to (`16d4`), as bytes, or its error.
fn seek_target(system: &System, id: u16, flags: u32, parms: u32) -> Result<Result<u32, u32>, Stop> {
    let asked = flags & !(MCI_NOTIFY | MCI_WAIT);
    let Some(opened) = system.mmsystem.wave_files.opened.get(&id) else {
        return Ok(Ok(0));
    };

    if asked == 0 {
        return Ok(Err(MCIERR_MISSING_PARAMETER));
    }

    if asked & !(MCI_TO | MCI_SEEK_TO_START | MCI_SEEK_TO_END) != 0 {
        return Ok(Err(MCIERR_UNRECOGNIZED_KEYWORD));
    }

    Ok(match asked {
        MCI_SEEK_TO_START => Ok(0),
        MCI_SEEK_TO_END => Ok(opened.length),
        MCI_TO => {
            let Some(format) = &opened.format else {
                return Err(Stop::Unsupported(
                    "MCIWAVE seeking in a file with no format",
                ));
            };

            to_bytes(opened, format, long_at(system, far_at(parms, 4)))?.ok_or(MCIERR_OUTOFRANGE)
        }
        _ => Err(MCIERR_FLAGS_NOT_COMPATIBLE),
    })
}

/// The device moved (`b30`): where it is, and where it reads from.
fn move_to(system: &mut System, id: u16, to: u32) {
    if let Some(opened) = system.mmsystem.wave_files.opened.get_mut(&id) {
        opened.position = to;
        opened.read = to;
    }
}

/// `MM_MCINOTIFY` posted to `hwnd`, as `mciDriverNotify` posts it.
fn post(system: &mut System, hwnd: u16, id: u16, status: u16) {
    if hwnd != 0 {
        system.post_message(hwnd, MM_MCINOTIFY, status, u32::from(id));
    }
}

/// The notification waiting posted with `status` and forgotten (`9f6`).
fn notify_waiting(system: &mut System, id: u16, status: u16) {
    let hwnd = system
        .mmsystem
        .wave_files
        .opened
        .get_mut(&id)
        .map_or(0, |opened| std::mem::take(&mut opened.notify));

    post(system, hwnd, id, status);
}

/// A command that succeeded supersedes the notification waiting for the
/// device `id`, if there is one (`20fe`).
pub fn supersede(system: &mut System, id: u16) {
    notify_waiting(system, id, MCI_NOTIFY_SUPERSEDED);
}

/// A command that succeeded with `MCI_NOTIFY` (`20f8`): the notification
/// waiting superseded, and its own posted, successful.
fn notify_success(system: &mut System, id: u16, flags: u32, parms: u32) {
    if flags & MCI_NOTIFY == 0 || parms == 0 {
        return;
    }

    supersede(system, id);

    let hwnd = long_at(system, parms) as u16;

    post(system, hwnd, id, MCI_NOTIFY_SUCCESSFUL);
}

fn playing_mut(system: &mut System, id: u16) -> Option<&mut Playing> {
    system
        .mmsystem
        .wave_files
        .opened
        .get_mut(&id)?
        .playing
        .as_mut()
}

/// The device of a play under way and not yet played out.
fn playing_device(system: &System, id: u16) -> Option<u16> {
    let playing = system
        .mmsystem
        .wave_files
        .opened
        .get(&id)?
        .playing
        .as_ref()?;

    (!playing.finished).then_some(playing.device)
}

/// `MCI_PLAY` (`1374`), with a waveform output device to play on.
pub async fn play(engine: &Engine, id: u16, flags: u32, parms: u32) -> Result<u32, Stop> {
    if flags & !(MCI_NOTIFY | MCI_WAIT | MCI_FROM | MCI_TO) != 0 {
        return Err(Stop::Unsupported("MCIWAVE playing with a flag of its own"));
    }

    let Some(format) = engine
        .system()
        .mmsystem
        .wave_files
        .opened
        .get(&id)
        .map(|opened| opened.format.clone())
    else {
        return Ok(0);
    };
    let Some(format) = format else {
        return Err(Stop::Unsupported(
            "MCIWAVE playing a file with no format or data",
        ));
    };

    sound::settle(engine).await?;
    // A play played out: the task has ended it (`138e`).
    settle_one(engine, id).await?;

    let waited = flags & MCI_WAIT != 0;
    let under_way = playing_device(&engine.system(), id);

    if waited && under_way.is_some() {
        return Err(Stop::Unsupported(
            "MCIWAVE waiting for a play over one under way",
        ));
    }

    let error = range(engine, id, &format, flags, parms).await?;

    if error != 0 {
        return Ok(error);
    }

    if let Some(device) = under_way {
        let answer = out::restart(engine, device).await?;

        if answer != MMSYSERR_NOERROR {
            return Ok(u32::from(answer));
        }

        if let Some(playing) = playing_mut(&mut engine.system(), id) {
            playing.paused = false;
        }
    } else {
        // `954`: the device opened, to call the task back.
        let (answer, device) = open_device(engine, &format, 0).await?;

        if answer != MMSYSERR_NOERROR {
            let (query, _) = open_device(engine, &format, WAVE_FORMAT_QUERY).await?;

            return Ok(if query == MMSYSERR_NOERROR {
                MCIERR_WAVE_OUTPUTSINUSE
            } else {
                MCIERR_WAVE_OUTPUTSUNSUITABLE
            });
        }

        let mut system = engine.system();

        if let Some(opened) = system.mmsystem.wave_files.opened.get_mut(&id) {
            opened.playing = Some(Playing {
                device,
                waited,
                ..Playing::default()
            });
        }
    }

    if flags & MCI_NOTIFY != 0 {
        let mut system = engine.system();

        supersede(&mut system, id);

        let hwnd = long_at(&system, parms) as u16;

        if let Some(opened) = system.mmsystem.wave_files.opened.get_mut(&id) {
            opened.notify = hwnd;
        }
    }

    // The task's part: its buffers made for a new play (`e74`), then its
    // loop.
    if under_way.is_none() && make_buffers(engine, id, &format).await? < 2 {
        return end(engine, id, MCIERR_OUT_OF_MEMORY).await;
    }

    if waited {
        play_waited(engine, id).await
    } else {
        play_on(engine, id).await
    }
}

/// The task's loop and end for a play waited for: each buffer waited for
/// in turn, the time passed to each of the card's interrupts, and filled
/// again. The task's error.
async fn play_waited(engine: &Engine, id: u16) -> Result<u32, Stop> {
    loop {
        let error = fill(engine, id).await?;

        if error != 0 {
            return end(engine, id, error).await;
        }

        let front = {
            let system = engine.system();

            system
                .mmsystem
                .wave_files
                .opened
                .get(&id)
                .and_then(|opened| opened.playing.as_ref()?.queued.front().copied())
        };
        let Some(header) = front else {
            return end(engine, id, 0).await;
        };

        sound::wait_for(engine, |system| {
            checks::header_flags(system, header) & DONE != 0
        })
        .await?;

        if let Some(playing) = playing_mut(&mut engine.system(), id) {
            playing.queued.pop_front();
        }
    }
}

/// The task's loop for a play not waited for, as far as it goes before it
/// waits for a buffer: the rest left to the card's interrupts. A play with
/// nothing to play ends at once.
async fn play_on(engine: &Engine, id: u16) -> Result<u32, Stop> {
    let error = fill(engine, id).await?;

    if error != 0 {
        end(engine, id, error).await?;
        return Ok(0);
    }

    let (left, idle) = {
        let system = engine.system();
        let opened = &system.mmsystem.wave_files.opened[&id];
        let idle = opened
            .playing
            .as_ref()
            .is_none_or(|playing| playing.queued.is_empty());

        (opened.read < opened.to, idle)
    };

    if left {
        return Err(Stop::Unsupported(
            "MCIWAVE playing in its task more than its buffers hold",
        ));
    }

    if idle {
        end(engine, id, 0).await?;
    }

    Ok(0)
}

/// A play's range (`1220`): where it is to end kept, the device moved and
/// reset for a play from somewhere, and the notification waiting aborted
/// where the play is from somewhere or to somewhere else. Nought, or the
/// error.
async fn range(
    engine: &Engine,
    id: u16,
    format: &[u8],
    flags: u32,
    parms: u32,
) -> Result<u32, Stop> {
    let (from, to, read) = {
        let system = engine.system();
        let opened = &system.mmsystem.wave_files.opened[&id];
        let from = if flags & MCI_FROM != 0 {
            match from_bytes(opened, format, long_at(&system, far_at(parms, 4)))? {
                Some(from) => from,
                None => return Ok(MCIERR_OUTOFRANGE),
            }
        } else {
            opened.position
        };
        let to = if flags & MCI_TO != 0 {
            match to_bytes(opened, format, long_at(&system, far_at(parms, 8)))? {
                Some(to) => to,
                None => return Ok(MCIERR_OUTOFRANGE),
            }
        } else {
            opened.length
        };

        (from, to, opened.read)
    };

    if flags & MCI_TO != 0 && flags & MCI_FROM == 0 && read > to {
        // Read past where it is now to end: where it is, if it is not past
        // that too, made a whole block, and the device reset there.
        let device = playing_device(&engine.system(), id);
        let reached = match device {
            Some(device) => device_position(engine, id, device).await?,
            None => 0,
        };
        let at = {
            let system = engine.system();
            let opened = &system.mmsystem.wave_files.opened[&id];

            opened.position.saturating_add(reached).min(opened.length)
        };

        if to < at {
            return Ok(MCIERR_OUTOFRANGE);
        }

        let block = block_of(format).max(1);

        move_to(&mut engine.system(), id, at - at % block);
        reset(engine, id).await?;
    } else {
        if to < from {
            return Ok(MCIERR_OUTOFRANGE);
        }

        if flags & MCI_FROM != 0 {
            move_to(&mut engine.system(), id, from);
            reset(engine, id).await?;
        }
    }

    let mut system = engine.system();
    let before = system
        .mmsystem
        .wave_files
        .opened
        .get(&id)
        .map_or(0, |opened| opened.to);

    if flags & MCI_FROM != 0 || to != before {
        notify_waiting(&mut system, id, MCI_NOTIFY_ABORTED);
    }

    if let Some(opened) = system.mmsystem.wave_files.opened.get_mut(&id) {
        opened.to = to;
    }

    Ok(0)
}

/// The device reset, where it is open (`4c`): every buffer called done,
/// and its position nought.
async fn reset(engine: &Engine, id: u16) -> Result<(), Stop> {
    let device = {
        let system = engine.system();

        system
            .mmsystem
            .wave_files
            .opened
            .get(&id)
            .and_then(|opened| opened.playing.as_ref())
            .map(|playing| playing.device)
    };

    if let Some(device) = device {
        out::reset(engine, device).await?;

        if let Some(playing) = playing_mut(&mut engine.system(), id) {
            playing.went = 0;
            playing.reached = 0;
            playing.paused = false;
        }
    }

    Ok(())
}

/// The device's position (`a6c`), asked as samples and made bytes: by its
/// samples and bytes a second, to a whole block (`80`).
async fn device_position(engine: &Engine, id: u16, device: u16) -> Result<u32, Stop> {
    let mut asked = [0u8; MMTIME_SIZE as usize];

    asked[..2].copy_from_slice(&TIME_SAMPLES.to_le_bytes());

    let frame = devices::below_stack(&mut engine.system(), &[&asked]);
    let answer = out::position(engine, device, frame.pointers[0], MMTIME_SIZE).await;
    let (kind, value) = {
        let mut system = engine.system();
        let bytes = system.read_far(frame.pointers[0], 6);

        frame.release(&mut system);
        (
            u16::from_le_bytes([bytes[0], bytes[1]]),
            u32::from_le_bytes([bytes[2], bytes[3], bytes[4], bytes[5]]),
        )
    };

    if answer? != MMSYSERR_NOERROR {
        return Err(Stop::Unsupported("MCIWAVE's device refusing its position"));
    }

    if kind != TIME_SAMPLES {
        return Ok(value);
    }

    let system = engine.system();
    let Some(format) = system
        .mmsystem
        .wave_files
        .opened
        .get(&id)
        .and_then(|opened| opened.format.as_ref())
    else {
        return Ok(value);
    };
    let bytes = mul_div(value, field(format, 8), field(format, 4));

    match block_of(format) {
        0 => Err(Stop::Unsupported("MCIWAVE playing a format of no block")),
        block => Ok(bytes / block * block),
    }
}

/// Pausing (`1530`) or resuming (`15a4`) a play under way.
async fn pause_or_resume(engine: &Engine, id: u16, message: u16, flags: u32) -> Result<u32, Stop> {
    if flags & !(MCI_NOTIFY | MCI_WAIT) != 0 {
        return Ok(MCIERR_UNRECOGNIZED_KEYWORD);
    }

    let (device, paused) = {
        let system = engine.system();
        let Some(playing) = system
            .mmsystem
            .wave_files
            .opened
            .get(&id)
            .and_then(|opened| opened.playing.as_ref())
            .filter(|playing| !playing.finished)
        else {
            return Ok(MCIERR_NONAPPLICABLE_FUNCTION);
        };

        (playing.device, playing.paused)
    };

    if (message == MCI_PAUSE) == paused {
        return Ok(0);
    }

    let answer = if message == MCI_PAUSE {
        out::pause(engine, device).await?
    } else {
        out::restart(engine, device).await?
    };

    if answer == MMSYSERR_NOERROR
        && let Some(playing) = playing_mut(&mut engine.system(), id)
    {
        playing.paused = message == MCI_PAUSE;
    }

    Ok(u32::from(answer))
}

/// A play under way stopped (`c52`): the device's position kept, the
/// device reset, and the play ended as the task ends it. A play played out
/// has its device closed.
async fn stop(engine: &Engine, id: u16) -> Result<(), Stop> {
    let Some(device) = playing_device(&engine.system(), id) else {
        return settle_one(engine, id).await;
    };
    let reached = device_position(engine, id, device).await?;

    {
        let mut system = engine.system();

        if let Some(opened) = system.mmsystem.wave_files.opened.get_mut(&id) {
            let at = opened.position.saturating_add(reached).min(opened.length);

            opened.position = at;
            opened.read = at;
        }
    }

    reset(engine, id).await?;
    end(engine, id, 0).await?;
    Ok(())
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

/// The task's buffers made (`cb6`): each a block of a header and a second,
/// marked done and prepared, until one cannot be. How many there are.
async fn make_buffers(engine: &Engine, id: u16, format: &[u8]) -> Result<usize, Stop> {
    let per_second = field(format, 8);
    let size = match block_of(format) {
        0 => return Err(Stop::Unsupported("MCIWAVE playing a format of no block")),
        block => per_second.div_ceil(block) * block,
    };
    let (count, device) = {
        let system = engine.system();
        let opened = &system.mmsystem.wave_files.opened[&id];

        (
            opened.buffers,
            opened.playing.as_ref().map_or(0, |playing| playing.device),
        )
    };

    for _ in 0..count {
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

        if let Some(playing) = playing_mut(&mut engine.system(), id) {
            playing.blocks.push(block);
            playing.size = size;
        }
    }

    Ok(playing_mut(&mut engine.system(), id).map_or(0, |playing| playing.blocks.len()))
}

/// The task's loop (seg8 `1fe`) as far as it goes without waiting: each
/// buffer called done taken back, then each free one filled from the file
/// and written, until every buffer is queued or the play's data is all
/// written. Nought, or the error that ends the loop.
async fn fill(engine: &Engine, id: u16) -> Result<u32, Stop> {
    loop {
        let next = {
            let mut system = engine.system();
            let system = &mut *system;
            let Some(mut opened) = system.mmsystem.wave_files.opened.remove(&id) else {
                return Ok(0);
            };
            let next = fill_one(system, &mut opened);

            system.mmsystem.wave_files.opened.insert(id, opened);
            next?
        };
        let Some((header, got)) = next else {
            return Ok(0);
        };
        let device = playing_mut(&mut engine.system(), id).map_or(0, |playing| playing.device);
        let written = out::write(engine, device, header, HEADER_SIZE).await?;
        let mut system = engine.system();
        let Some(playing) = playing_mut(&mut system, id) else {
            return Ok(0);
        };

        // A write refused ends the loop with its error (seg8 `29d`), the
        // buffers still queued not waited for: the same unpreparing and
        // closing refused as after a short read.
        if written != MMSYSERR_NOERROR {
            if !playing.queued.is_empty() {
                return Err(Stop::Unsupported(
                    "MCIWAVE's write refused with buffers still queued",
                ));
            }

            return Ok(u32::from(written));
        }

        playing.queued.push_back(header);
        playing.next = (playing.next + 1) % playing.blocks.len();
        playing.went += got;
    }
}

/// The buffers called done taken back, and the next buffer filled from the
/// file, if one is free and there is more to play (seg8 `213`-`289`): its
/// header, and how many bytes it holds.
fn fill_one(system: &mut System, opened: &mut Opened) -> Result<Option<(u32, u32)>, Stop> {
    let Some(playing) = opened.playing.as_mut() else {
        return Ok(None);
    };

    while let Some(&header) = playing.queued.front() {
        if checks::header_flags(system, header) & DONE == 0 {
            break;
        }

        playing.queued.pop_front();
    }

    if playing.queued.len() >= playing.blocks.len() || opened.read >= opened.to {
        return Ok(None);
    }

    let (_, header) = playing.blocks[playing.next];
    let wanted = (opened.to - opened.read).min(playing.size);
    let bytes = opened
        .data
        .get(opened.read as usize..)
        .map_or(&[][..], |rest| &rest[..rest.len().min(wanted as usize)]);
    let got = bytes.len() as u32;

    // A read that comes up short (seg8 `0`) is `MCIERR_FILE_READ`, but what
    // was read is written, and the write's answer takes the error's place
    // (seg8 `29d`); the next read, of nothing, sets it again and ends the
    // loop at once, the buffers still queued not waited for. Those buffers
    // are then unprepared -- which a queued one refuses -- and let go while
    // the device plays them, and the device's closing is refused: it stays
    // open. winbox.js does not follow the driver there.
    if got != wanted {
        return Err(Stop::Unsupported(
            "MCIWAVE playing a file shorter than its data chunk says",
        ));
    }

    let flags = checks::header_flags(system, header);

    system.write_far(header | u32::from(HEADER_SIZE), bytes);
    system.write_far(header | 4, &got.to_le_bytes());
    checks::set_header_flags(system, header, flags & !0x0d);
    opened.read += got;
    Ok(Some((header, got)))
}

/// The task's end of a play (`e96`-`f22`): the device's position kept,
/// the device reset, the buffers unprepared and let go, the notification
/// waiting posted, the device closed. What a play waited for answers: the
/// task's error.
async fn end(engine: &Engine, id: u16, error: u32) -> Result<u32, Stop> {
    let Some((device, waited)) = engine
        .system()
        .mmsystem
        .wave_files
        .opened
        .get(&id)
        .and_then(|opened| opened.playing.as_ref())
        .map(|playing| (playing.device, playing.waited))
    else {
        return Ok(error);
    };
    let reached = device_position(engine, id, device).await?;

    {
        let mut system = engine.system();

        if let Some(opened) = system.mmsystem.wave_files.opened.get_mut(&id) {
            let at = opened.position.saturating_add(reached).min(opened.length);

            opened.position = at;
            opened.read = at;
        }
    }

    reset(engine, id).await?;
    free_buffers(engine, id, device).await?;

    // Ended: nothing for the card's interrupts to end again while the
    // device closes.
    if let Some(playing) = playing_mut(&mut engine.system(), id) {
        playing.finished = true;
    }

    {
        let mut system = engine.system();
        let reached_end = system
            .mmsystem
            .wave_files
            .opened
            .get(&id)
            .is_some_and(|opened| opened.read >= opened.to);

        if waited && error != 0 {
            if let Some(opened) = system.mmsystem.wave_files.opened.get_mut(&id) {
                opened.notify = 0;
            }
        } else {
            let status = if error != 0 {
                MCI_NOTIFY_FAILURE
            } else if reached_end {
                MCI_NOTIFY_SUCCESSFUL
            } else {
                MCI_NOTIFY_ABORTED
            };

            notify_waiting(&mut system, id, status);
        }
    }

    out::close(engine, device).await?;

    if let Some(opened) = engine.system().mmsystem.wave_files.opened.get_mut(&id) {
        opened.playing = None;
    }

    Ok(if waited { error } else { 0 })
}

/// The buffers unprepared and let go, last first (`d9c`).
async fn free_buffers(engine: &Engine, id: u16, device: u16) -> Result<(), Stop> {
    let blocks = playing_mut(&mut engine.system(), id)
        .map(|playing| {
            playing.queued.clear();
            std::mem::take(&mut playing.blocks)
        })
        .unwrap_or_default();

    for &(handle, header) in blocks.iter().rev() {
        if checks::header_flags(&engine.system(), header) & PREPARED != 0 {
            out::unprepare(engine, device, header, HEADER_SIZE).await?;
        }

        sound::free(&mut engine.system(), handle);
    }

    Ok(())
}

/// The device `id`'s play, played out, ended as far as the program has
/// not seen: the device reset, its buffers let go, and closed.
async fn settle_one(engine: &Engine, id: u16) -> Result<(), Stop> {
    let device = {
        let system = engine.system();

        system
            .mmsystem
            .wave_files
            .opened
            .get(&id)
            .and_then(|opened| opened.playing.as_ref())
            .filter(|playing| playing.finished)
            .map(|playing| playing.device)
    };
    let Some(device) = device else {
        return Ok(());
    };

    reset(engine, id).await?;
    free_buffers(engine, id, device).await?;
    out::close(engine, device).await?;

    if let Some(opened) = engine.system().mmsystem.wave_files.opened.get_mut(&id) {
        opened.playing = None;
    }

    Ok(())
}

/// Every play played out ended, its device closed: before anything that
/// would find the device still open.
pub async fn settle(engine: &Engine) -> Result<(), Stop> {
    let finished: Vec<u16> = engine
        .system()
        .mmsystem
        .wave_files
        .opened
        .iter()
        .filter(|(_, opened)| {
            opened
                .playing
                .as_ref()
                .is_some_and(|playing| playing.finished)
        })
        .map(|(&id, _)| id)
        .collect();

    for id in finished {
        settle_one(engine, id).await?;
    }

    Ok(())
}

impl System {
    /// The card's interrupts come and gone: each play not waited for takes
    /// back the buffers called done, as the task does as each wakes it,
    /// and one whose data is all played is at its end and notifies, as the
    /// task does as it ends it -- the rest of the task's end left for when
    /// the device is next asked for (`settle`).
    pub(crate) fn poll_mci_wave(&mut self) {
        let files = &self.mmsystem.wave_files.opened;

        if files.values().all(|opened| {
            opened
                .playing
                .as_ref()
                .is_none_or(|playing| playing.finished || playing.waited)
        }) {
            return;
        }

        let ids: Vec<u16> = files.keys().copied().collect();

        for id in ids {
            let Some(mut opened) = self.mmsystem.wave_files.opened.remove(&id) else {
                continue;
            };

            if let Some(playing) = opened.playing.as_mut()
                && !playing.finished
                && !playing.waited
            {
                while let Some(&header) = playing.queued.front() {
                    if checks::header_flags(self, header) & DONE == 0 {
                        break;
                    }

                    playing.queued.pop_front();
                }

                if playing.queued.is_empty() && opened.read >= opened.to {
                    let at = opened
                        .position
                        .saturating_add(playing.went)
                        .min(opened.length);

                    opened.position = at;
                    opened.read = at;
                    playing.finished = true;

                    // At the end it was to play to: successful.
                    let hwnd = std::mem::take(&mut opened.notify);

                    post(self, hwnd, id, MCI_NOTIFY_SUCCESSFUL);
                }
            }

            self.mmsystem.wave_files.opened.insert(id, opened);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `MulDiv` rounds half up, and gives the largest there is for a
    /// quotient too great or a divisor of nought.
    #[test]
    fn mul_div_rounds_as_the_driver_does() {
        assert_eq!(mul_div(500, 11025, 1000), 5513);
        assert_eq!(mul_div(22050, 1000, 11025), 2000);
        assert_eq!(mul_div(11025, 1000, 11025), 1000);
        assert_eq!(mul_div(1, 1, 0), 0x7fff_ffff);
        assert_eq!(mul_div(0x7fff_ffff, 4, 1), 0x7fff_ffff);
        assert_eq!(mul_div(u32::MAX, 1000, 1), (-1000i32) as u32);
    }
}

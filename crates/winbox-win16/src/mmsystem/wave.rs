//! `waveOut*` and `waveIn*`: waveform devices, as MMSYSTEM answers for them
//! and passes them to their drivers.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg3 `866`-`1506`):
//!
//! * The counts are the sums `devices.rs` keeps. Capabilities and volume
//!   are asked of a device by number; the error texts are MMSYSTEM's own
//!   (`checks::error_text`). Capabilities or a text with a size of nought
//!   answer nought, a buffer that cannot be written for its size
//!   `MMSYSERR_INVALPARAM` (11).
//! * `waveOutOpen` and `waveInOpen` check the format can be read for 14
//!   bytes, the callback (`checks::callback_ok`), and that no flag but
//!   `WAVE_FORMAT_QUERY` (1) and `WAVE_ALLOWSYNC` (2) is in the low word
//!   (`MMSYSERR_INVALFLAG`, 10); then, unless only asking, that the handle
//!   can be written, and write it nought. With no device, or a number past
//!   them, `MMSYSERR_BADDEVICEID` (2). The mapper's number with no mapper
//!   installed opens each device in turn until one opens, answering the
//!   last one's answer. Else a handle is made, unless only asking, and the
//!   driver sent `WODM_OPEN` (5) or `WIDM_OPEN` (34h) with a doubleword
//!   for its own, a `WAVEOPENDESC` -- the handle, the format, the callback
//!   and the program's doubleword -- and the flags; refused, the handle
//!   goes. Both are in MMSYSTEM's frame on the program's stack.
//! * Preparing a header takes it as `checks::header_ok` does; one prepared
//!   answers nought. Its flags are cleared -- an output header's keeps its
//!   loop flags -- and the driver sent `WODM_PREPARE`; if the driver does
//!   not do it (`MMSYSERR_NOTSUPPORTED`, 8), MMSYSTEM does, locking the
//!   header and its data in place, which in winbox.js's memory always
//!   stay. Done, the header is marked prepared. Unpreparing one still
//!   queued is `WAVERR_STILLPLAYING` (33); one not prepared answers nought.
//! * Writing, or adding an input buffer, needs a header prepared
//!   (`WAVERR_UNPREPARED`, 34) and not queued (33); writing clears the
//!   header's done flag. Marking it queued, and done, is the driver's.
//! * Closing sends `WODM_CLOSE`; the handle goes only if the driver agrees.
//!   Every other call on a handle is its message passed on, the handle
//!   checked first, a pointer it gives checked writable first.
//! * `waveOutGetID` answers the number the device was opened by: the
//!   mapper's for one a mapper driver opened, a device's own where it was
//!   tried in the mapper's place.

// Each has the signature every function that answers a call has.
#![allow(clippy::unnecessary_wraps)]

use std::future::Future;
use std::pin::Pin;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;

use super::checks::{self, DONE, PREPARED, WAVE_INQUEUE};
use super::devices::{
    self, Keep, Kind, MMSYSERR_BADDEVICEID, MMSYSERR_INVALFLAG, MMSYSERR_INVALHANDLE,
    MMSYSERR_INVALPARAM, MMSYSERR_NOERROR, MMSYSERR_NOTSUPPORTED,
};

pub const WAVERR_STILLPLAYING: u16 = 33;
pub const WAVERR_UNPREPARED: u16 = 34;

const WAVE_FORMAT_QUERY: u32 = 1;
const WHDR_BEGINLOOP_ENDLOOP: u32 = 0x0c;

/// A waveform direction's messages.
struct Side {
    kind: Kind,
    get_dev_caps: u16,
    open: u16,
    close: u16,
    prepare: u16,
    unprepare: u16,
    /// `WODM_WRITE`, or `WIDM_ADDBUFFER`.
    write: u16,
    get_pos: u16,
}

const OUT: Side = Side {
    kind: Kind::WaveOut,
    get_dev_caps: 4,
    open: 5,
    close: 6,
    prepare: 7,
    unprepare: 8,
    write: 9,
    get_pos: 13,
};

const IN: Side = Side {
    kind: Kind::WaveIn,
    get_dev_caps: 0x33,
    open: 0x34,
    close: 0x35,
    prepare: 0x36,
    unprepare: 0x37,
    write: 0x38,
    get_pos: 0x3c,
};

const WODM_PAUSE: u16 = 10;
const WODM_RESTART: u16 = 11;
const WODM_RESET: u16 = 12;
const WODM_GETPITCH: u16 = 14;
const WODM_SETPITCH: u16 = 15;
const WODM_GETVOLUME: u16 = 16;
const WODM_SETVOLUME: u16 = 17;
const WODM_GETPLAYBACKRATE: u16 = 18;
const WODM_SETPLAYBACKRATE: u16 = 19;
const WODM_BREAKLOOP: u16 = 20;
const WIDM_START: u16 = 0x39;
const WIDM_STOP: u16 = 0x3a;
const WIDM_RESET: u16 = 0x3b;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Async(match name {
        "waveOutGetNumDevs" => |engine, _| count(engine, Kind::WaveOut),
        "waveInGetNumDevs" => |engine, _| count(engine, Kind::WaveIn),
        "waveOutGetDevCaps" => |engine, args| get_dev_caps(engine, args, &OUT),
        "waveInGetDevCaps" => |engine, args| get_dev_caps(engine, args, &IN),
        "waveOutGetErrorText" | "waveInGetErrorText" => get_error_text,
        "waveOutOpen" => |engine, args| open_call(engine, args, &OUT),
        "waveInOpen" => |engine, args| open_call(engine, args, &IN),
        "waveOutClose" => |engine, args| close(engine, args, &OUT),
        "waveInClose" => |engine, args| close(engine, args, &IN),
        "waveOutPrepareHeader" => |engine, args| prepare(engine, args, &OUT),
        "waveInPrepareHeader" => |engine, args| prepare(engine, args, &IN),
        "waveOutUnprepareHeader" => |engine, args| unprepare(engine, args, &OUT),
        "waveInUnprepareHeader" => |engine, args| unprepare(engine, args, &IN),
        "waveOutWrite" => |engine, args| write(engine, args, &OUT),
        "waveInAddBuffer" => |engine, args| write(engine, args, &IN),
        "waveOutPause" => |engine, args| plain(engine, args, Kind::WaveOut, WODM_PAUSE),
        "waveOutRestart" => |engine, args| plain(engine, args, Kind::WaveOut, WODM_RESTART),
        "waveOutReset" => |engine, args| plain(engine, args, Kind::WaveOut, WODM_RESET),
        "waveOutBreakLoop" => |engine, args| plain(engine, args, Kind::WaveOut, WODM_BREAKLOOP),
        "waveInStart" => |engine, args| plain(engine, args, Kind::WaveIn, WIDM_START),
        "waveInStop" => |engine, args| plain(engine, args, Kind::WaveIn, WIDM_STOP),
        "waveInReset" => |engine, args| plain(engine, args, Kind::WaveIn, WIDM_RESET),
        "waveOutGetPosition" => |engine, args| get_position(engine, args, &OUT),
        "waveInGetPosition" => |engine, args| get_position(engine, args, &IN),
        "waveOutGetPitch" => |engine, args| get_dword(engine, args, WODM_GETPITCH),
        "waveOutGetPlaybackRate" => |engine, args| get_dword(engine, args, WODM_GETPLAYBACKRATE),
        "waveOutSetPitch" => |engine, args| set_dword(engine, args, WODM_SETPITCH),
        "waveOutSetPlaybackRate" => |engine, args| set_dword(engine, args, WODM_SETPLAYBACKRATE),
        "waveOutGetVolume" => get_volume,
        "waveOutSetVolume" => set_volume,
        "waveOutGetID" => |engine, args| get_id(engine, args, Kind::WaveOut),
        "waveInGetID" => |engine, args| get_id(engine, args, Kind::WaveIn),
        "waveOutMessage" => |engine, args| message(engine, args, Kind::WaveOut),
        "waveInMessage" => |engine, args| message(engine, args, Kind::WaveIn),
        _ => return None,
    }))
}

/// How many devices of a kind there are.
pub(crate) fn count(engine: &Engine, kind: Kind) -> Later<'_> {
    let count = engine.system().mmsystem.devices.count(kind);

    Box::pin(async move { Ok(Answer::Word(count)) })
}

/// A device's capabilities, asked by its number.
fn get_dev_caps<'a>(engine: &'a Engine, mut args: Args, direction: &'static Side) -> Later<'a> {
    Box::pin(async move {
        let (id, far, size) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };

        if size == 0 {
            return Ok(Answer::Word(MMSYSERR_NOERROR));
        }

        if !checks::writable(&engine.system(), far, u32::from(size)) {
            return Ok(Answer::Word(MMSYSERR_INVALPARAM));
        }

        let answer = devices::send_by_id(
            engine,
            direction.kind,
            id,
            direction.get_dev_caps,
            far,
            u32::from(size),
        )
        .await?;

        Ok(Answer::Word(answer as u16))
    })
}

fn get_error_text(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let mut system = engine.system();
        let error = args.word(&system);
        let far = args.dword(&system);
        let size = args.word(&system);

        Ok(Answer::Word(checks::error_text(
            &mut system,
            error,
            far,
            size,
            (32, 35),
        )))
    })
}

fn open_call<'a>(engine: &'a Engine, mut args: Args, direction: &'static Side) -> Later<'a> {
    Box::pin(async move {
        let arguments = {
            let system = engine.system();

            Open {
                handle: args.dword(&system),
                id: args.word(&system),
                format: args.dword(&system),
                callback: args.dword(&system),
                instance: args.dword(&system),
                flags: args.dword(&system),
            }
        };

        Ok(Answer::Word(open(engine, direction, arguments).await?))
    })
}

/// `waveOutOpen`'s arguments.
#[derive(Debug, Clone, Copy)]
struct Open {
    handle: u32,
    id: u16,
    format: u32,
    callback: u32,
    instance: u32,
    flags: u32,
}

/// A waveform device opened, or asked whether it takes a format.
fn open<'a>(
    engine: &'a Engine,
    direction: &'static Side,
    arguments: Open,
) -> Pin<Box<dyn Future<Output = Result<u16, Stop>> + 'a>> {
    Box::pin(async move {
        let query = arguments.flags & WAVE_FORMAT_QUERY != 0;
        let found = {
            let mut system = engine.system();

            if !checks::readable(&system, arguments.format, 14)
                || !checks::callback_ok(
                    &mut system,
                    arguments.callback,
                    (arguments.flags >> 16) as u16,
                )
            {
                return Ok(MMSYSERR_INVALPARAM);
            }

            if arguments.flags & 0xfffc != 0 {
                return Ok(MMSYSERR_INVALFLAG);
            }

            if !query {
                if !checks::writable(&system, arguments.handle, 2) {
                    return Ok(MMSYSERR_INVALPARAM);
                }

                system.write_far(arguments.handle, &[0, 0]);
            }

            let devices = &system.mmsystem.devices;

            if devices.count(direction.kind) == 0 {
                return Ok(MMSYSERR_BADDEVICEID);
            }

            devices
                .place_of(direction.kind, arguments.id)
                .map(|(place, device)| {
                    let mapped = devices.table(direction.kind).entries[place]
                        .procedure
                        .is_some();

                    (place, device, mapped, devices.count(direction.kind))
                })
        };
        let Some((place, device, mapped, count)) = found else {
            return Ok(MMSYSERR_BADDEVICEID);
        };

        // The mapper's number, and no mapper: each device tried in turn.
        if arguments.id == devices::MAPPER && !mapped {
            let mut answer = arguments.id;

            for id in 0..count {
                answer = open(engine, direction, Open { id, ..arguments }).await?;

                if answer == MMSYSERR_NOERROR {
                    break;
                }
            }

            return Ok(answer);
        }

        let describe = |handle: u16| {
            let mut bytes = handle.to_le_bytes().to_vec();

            bytes.extend_from_slice(&arguments.format.to_le_bytes());
            bytes.extend_from_slice(&arguments.callback.to_le_bytes());
            bytes.extend_from_slice(&arguments.instance.to_le_bytes());
            bytes
        };
        let (answer, handle) = devices::open(
            engine,
            direction.kind,
            place,
            device,
            arguments.id,
            direction.open,
            describe,
            arguments.flags,
            query,
            Keep::Stack,
        )
        .await?;

        if let Some(handle) = handle {
            engine
                .system()
                .write_far(arguments.handle, &handle.to_le_bytes());
        }

        Ok(answer)
    })
}

fn close<'a>(engine: &'a Engine, mut args: Args, direction: &'static Side) -> Later<'a> {
    Box::pin(async move {
        let handle = args.word(&engine.system());

        Ok(Answer::Word(
            devices::close(engine, handle, direction.kind, direction.close).await?,
        ))
    })
}

/// A handle and a header, as the header calls give them.
fn header_args(engine: &Engine, args: &mut Args) -> (u16, u32, u16) {
    let system = engine.system();

    (args.word(&system), args.dword(&system), args.word(&system))
}

/// The checks every header call makes first: the handle, then the header.
fn checked(engine: &Engine, handle: u16, header: u32, size: u16, kind: Kind) -> Option<u16> {
    let system = engine.system();

    if system.mmsystem.devices.handle(handle, kind).is_none() {
        return Some(MMSYSERR_INVALHANDLE);
    }

    if !checks::header_ok(&system, header, size, kind.handle_type()) {
        return Some(MMSYSERR_INVALPARAM);
    }

    None
}

fn prepare<'a>(engine: &'a Engine, mut args: Args, direction: &'static Side) -> Later<'a> {
    Box::pin(async move {
        let (handle, header, size) = header_args(engine, &mut args);

        if let Some(error) = checked(engine, handle, header, size, direction.kind) {
            return Ok(Answer::Word(error));
        }

        {
            let mut system = engine.system();
            let flags = checks::header_flags(&system, header);

            if flags & PREPARED != 0 {
                return Ok(Answer::Word(MMSYSERR_NOERROR));
            }

            // An output header keeps its loop flags in the low byte, and
            // the rest of its flags go; an input header's all go.
            let kept = match direction.kind {
                Kind::WaveOut => flags & WHDR_BEGINLOOP_ENDLOOP,
                _ => 0,
            };

            checks::set_header_flags(&mut system, header, kept);
        }

        let mut answer = devices::send_by_handle(
            engine,
            handle,
            direction.kind,
            direction.prepare,
            header,
            u32::from(size),
        )
        .await?
        .unwrap_or(0) as u16;

        // MMSYSTEM's own preparing: the header and its data locked in
        // place, which in winbox.js's memory they always are.
        if answer == MMSYSERR_NOTSUPPORTED {
            answer = MMSYSERR_NOERROR;
        }

        if answer == MMSYSERR_NOERROR {
            let mut system = engine.system();
            let flags = checks::header_flags(&system, header);

            checks::set_header_flags(&mut system, header, flags | PREPARED);
        }

        Ok(Answer::Word(answer))
    })
}

fn unprepare<'a>(engine: &'a Engine, mut args: Args, direction: &'static Side) -> Later<'a> {
    Box::pin(async move {
        let (handle, header, size) = header_args(engine, &mut args);

        if let Some(error) = checked(engine, handle, header, size, direction.kind) {
            return Ok(Answer::Word(error));
        }

        {
            let flags = checks::header_flags(&engine.system(), header);

            if flags & WAVE_INQUEUE != 0 {
                return Ok(Answer::Word(WAVERR_STILLPLAYING));
            }

            if flags & PREPARED == 0 {
                return Ok(Answer::Word(MMSYSERR_NOERROR));
            }
        }

        let mut answer = devices::send_by_handle(
            engine,
            handle,
            direction.kind,
            direction.unprepare,
            header,
            u32::from(size),
        )
        .await?
        .unwrap_or(0) as u16;

        // MMSYSTEM's own unpreparing: the header and its data let go.
        if answer == MMSYSERR_NOTSUPPORTED {
            answer = MMSYSERR_NOERROR;
        }

        if answer == MMSYSERR_NOERROR {
            let mut system = engine.system();
            let flags = checks::header_flags(&system, header);

            checks::set_header_flags(&mut system, header, flags & !PREPARED);
        }

        Ok(Answer::Word(answer))
    })
}

/// `waveOutWrite` and `waveInAddBuffer`.
fn write<'a>(engine: &'a Engine, mut args: Args, direction: &'static Side) -> Later<'a> {
    Box::pin(async move {
        let (handle, header, size) = header_args(engine, &mut args);

        if let Some(error) = checked(engine, handle, header, size, direction.kind) {
            return Ok(Answer::Word(error));
        }

        {
            let mut system = engine.system();
            let flags = checks::header_flags(&system, header);

            if flags & PREPARED == 0 {
                return Ok(Answer::Word(WAVERR_UNPREPARED));
            }

            if flags & WAVE_INQUEUE != 0 {
                return Ok(Answer::Word(WAVERR_STILLPLAYING));
            }

            if direction.kind == Kind::WaveOut {
                checks::set_header_flags(&mut system, header, flags & !DONE);
            }
        }

        let answer = devices::send_by_handle(
            engine,
            handle,
            direction.kind,
            direction.write,
            header,
            u32::from(size),
        )
        .await?
        .unwrap_or(0);

        Ok(Answer::Word(answer as u16))
    })
}

/// A call on a handle that is its message passed on, with nothing.
pub(crate) fn plain(engine: &Engine, mut args: Args, kind: Kind, message: u16) -> Later<'_> {
    Box::pin(async move {
        let handle = args.word(&engine.system());

        Ok(Answer::Word(
            devices::send_by_handle(engine, handle, kind, message, 0, 0)
                .await?
                .map_or(MMSYSERR_INVALHANDLE, |answer| answer as u16),
        ))
    })
}

fn get_position<'a>(engine: &'a Engine, mut args: Args, direction: &'static Side) -> Later<'a> {
    Box::pin(async move {
        let (handle, far, size) = header_args(engine, &mut args);

        {
            let system = engine.system();

            if system
                .mmsystem
                .devices
                .handle(handle, direction.kind)
                .is_none()
            {
                return Ok(Answer::Word(MMSYSERR_INVALHANDLE));
            }

            if !checks::writable(&system, far, u32::from(size)) {
                return Ok(Answer::Word(MMSYSERR_INVALPARAM));
            }
        }

        let answer = devices::send_by_handle(
            engine,
            handle,
            direction.kind,
            direction.get_pos,
            far,
            u32::from(size),
        )
        .await?
        .unwrap_or(0);

        Ok(Answer::Word(answer as u16))
    })
}

/// `waveOutGetPitch` and `waveOutGetPlaybackRate`: a doubleword asked for.
fn get_dword(engine: &Engine, mut args: Args, message: u16) -> Later<'_> {
    Box::pin(async move {
        let (handle, far) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system))
        };

        {
            let system = engine.system();

            if system
                .mmsystem
                .devices
                .handle(handle, Kind::WaveOut)
                .is_none()
            {
                return Ok(Answer::Word(MMSYSERR_INVALHANDLE));
            }

            if !checks::writable(&system, far, 4) {
                return Ok(Answer::Word(MMSYSERR_INVALPARAM));
            }
        }

        let answer = devices::send_by_handle(engine, handle, Kind::WaveOut, message, far, 0)
            .await?
            .unwrap_or(0);

        Ok(Answer::Word(answer as u16))
    })
}

/// `waveOutSetPitch` and `waveOutSetPlaybackRate`.
fn set_dword(engine: &Engine, mut args: Args, message: u16) -> Later<'_> {
    Box::pin(async move {
        let (handle, value) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system))
        };

        Ok(Answer::Word(
            devices::send_by_handle(engine, handle, Kind::WaveOut, message, value, 0)
                .await?
                .map_or(MMSYSERR_INVALHANDLE, |answer| answer as u16),
        ))
    })
}

/// A device's volume, asked by its number.
fn get_volume(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (id, far) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system))
        };

        if !checks::writable(&engine.system(), far, 4) {
            return Ok(Answer::Word(MMSYSERR_INVALPARAM));
        }

        let answer = devices::send_by_id(engine, Kind::WaveOut, id, WODM_GETVOLUME, far, 0).await?;

        Ok(Answer::Word(answer as u16))
    })
}

fn set_volume(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (id, value) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system))
        };
        let answer =
            devices::send_by_id(engine, Kind::WaveOut, id, WODM_SETVOLUME, value, 0).await?;

        Ok(Answer::Word(answer as u16))
    })
}

/// The number a device was opened by.
pub(crate) fn get_id(engine: &Engine, mut args: Args, kind: Kind) -> Later<'_> {
    Box::pin(async move {
        let mut system = engine.system();
        let handle = args.word(&system);
        let far = args.dword(&system);
        let Some(opened) = system.mmsystem.devices.handle(handle, kind) else {
            return Ok(Answer::Word(MMSYSERR_INVALHANDLE));
        };

        if !checks::writable(&system, far, 2) {
            return Ok(Answer::Word(MMSYSERR_INVALPARAM));
        }

        system.write_far(far, &opened.id.to_le_bytes());
        Ok(Answer::Word(MMSYSERR_NOERROR))
    })
}

/// Any message, to an open device: nought for a handle that is none.
pub(crate) fn message(engine: &Engine, mut args: Args, kind: Kind) -> Later<'_> {
    Box::pin(async move {
        let (handle, message, first, second) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Dword(
            devices::send_by_handle(engine, handle, kind, message, first, second)
                .await?
                .unwrap_or(0),
        ))
    })
}

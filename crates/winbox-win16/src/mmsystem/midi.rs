//! `midiOut*` and `midiIn*`: MIDI devices, as MMSYSTEM answers for them and
//! passes them to their drivers.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg6, seg1 `c4`-`1e4`), where it is not
//! as waveform devices are (`wave.rs`):
//!
//! * `midiOutOpen` and `midiInOpen` check the handle can be written, then
//!   the callback, then that the flags' low word is nought
//!   (`MMSYSERR_INVALFLAG`, 10), and write the handle nought. There is no
//!   asking only. A number past the devices is `MMSYSERR_BADDEVICEID` (2);
//!   the mapper's with no mapper installed, `MMSYSERR_NODRIVER` (6), no
//!   device tried in its place. MMSYSTEM locks its own data in place, and
//!   makes the handle; the driver is sent `MODM_OPEN` (3) or `MIDM_OPEN`
//!   (37h) with a `MIDIOPENDESC` -- the handle, the callback, the program's
//!   doubleword -- in MMSYSTEM's frame, and for its own doubleword a far
//!   pointer into the handle's block, which starts at nought.
//! * Preparing clears the header's flags and sends `MODM_PREPARE`, and the
//!   driver marks it prepared; MMSYSTEM marks it only where it prepares the
//!   header itself, the driver answering `MMSYSERR_NOTSUPPORTED` (8). One
//!   already prepared answers nought. Unpreparing one not prepared answers
//!   nought; one queued is `MIDIERR_STILLPLAYING` (65).
//! * `midiOutLongMsg` and `midiInAddBuffer` need a header prepared
//!   (`MIDIERR_UNPREPARED`, 64) and not queued (65). The long message's
//!   header is not checked as the others are, only that no flag past the
//!   three it has is set (10); the input buffer's is.
//! * `midiOutShortMsg` passes its message as `MODM_DATA` (7);
//!   `midiOutCachePatches` and `midiOutCacheDrumPatches` check 256 bytes of
//!   patches can be written and the flags (10), and pass the bank in the
//!   second parameter's high word, the flags in its low.

// Each has the signature every function that answers a call has.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Implementation, Later};
use crate::engine::Engine;

use super::checks::{self, MIDI_INQUEUE, PREPARED};
use super::devices::{
    self, Keep, Kind, MMSYSERR_BADDEVICEID, MMSYSERR_INVALFLAG, MMSYSERR_INVALHANDLE,
    MMSYSERR_INVALPARAM, MMSYSERR_NODRIVER, MMSYSERR_NOERROR, MMSYSERR_NOTSUPPORTED,
};
use super::wave::{count, get_id, message, plain};

pub const MIDIERR_UNPREPARED: u16 = 64;
pub const MIDIERR_STILLPLAYING: u16 = 65;

/// A MIDI direction's messages.
struct Side {
    kind: Kind,
    get_dev_caps: u16,
    open: u16,
    close: u16,
    prepare: u16,
    unprepare: u16,
}

const OUT: Side = Side {
    kind: Kind::MidiOut,
    get_dev_caps: 2,
    open: 3,
    close: 4,
    prepare: 5,
    unprepare: 6,
};

const IN: Side = Side {
    kind: Kind::MidiIn,
    get_dev_caps: 0x36,
    open: 0x37,
    close: 0x38,
    prepare: 0x39,
    unprepare: 0x3a,
};

const MODM_DATA: u16 = 7;
const MODM_LONGDATA: u16 = 8;
const MODM_RESET: u16 = 9;
const MODM_GETVOLUME: u16 = 10;
const MODM_SETVOLUME: u16 = 11;
const MODM_CACHEPATCHES: u16 = 12;
const MODM_CACHEDRUMPATCHES: u16 = 13;
const MIDM_ADDBUFFER: u16 = 0x3b;
const MIDM_START: u16 = 0x3c;
const MIDM_STOP: u16 = 0x3d;
const MIDM_RESET: u16 = 0x3e;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Async(match name {
        "midiOutGetNumDevs" => |engine, _| count(engine, Kind::MidiOut),
        "midiInGetNumDevs" => |engine, _| count(engine, Kind::MidiIn),
        "midiOutGetDevCaps" => |engine, args| get_dev_caps(engine, args, &OUT),
        "midiInGetDevCaps" => |engine, args| get_dev_caps(engine, args, &IN),
        "midiOutGetErrorText" | "midiInGetErrorText" => get_error_text,
        "midiOutOpen" => |engine, args| open(engine, args, &OUT),
        "midiInOpen" => |engine, args| open(engine, args, &IN),
        "midiOutClose" => |engine, args| close(engine, args, &OUT),
        "midiInClose" => |engine, args| close(engine, args, &IN),
        "midiOutPrepareHeader" => |engine, args| prepare(engine, args, &OUT),
        "midiInPrepareHeader" => |engine, args| prepare(engine, args, &IN),
        "midiOutUnprepareHeader" => |engine, args| unprepare(engine, args, &OUT),
        "midiInUnprepareHeader" => |engine, args| unprepare(engine, args, &IN),
        "midiOutShortMsg" => short_msg,
        "midiOutLongMsg" => long_msg,
        "midiInAddBuffer" => add_buffer,
        "midiOutReset" => |engine, args| plain(engine, args, Kind::MidiOut, MODM_RESET),
        "midiInStart" => |engine, args| plain(engine, args, Kind::MidiIn, MIDM_START),
        "midiInStop" => |engine, args| plain(engine, args, Kind::MidiIn, MIDM_STOP),
        "midiInReset" => |engine, args| plain(engine, args, Kind::MidiIn, MIDM_RESET),
        "midiOutGetVolume" => get_volume,
        "midiOutSetVolume" => set_volume,
        "midiOutCachePatches" => |engine, args| cache_patches(engine, args, MODM_CACHEPATCHES),
        "midiOutCacheDrumPatches" => {
            |engine, args| cache_patches(engine, args, MODM_CACHEDRUMPATCHES)
        }
        "midiOutGetID" => |engine, args| get_id(engine, args, Kind::MidiOut),
        "midiInGetID" => |engine, args| get_id(engine, args, Kind::MidiIn),
        "midiOutMessage" => |engine, args| message(engine, args, Kind::MidiOut),
        "midiInMessage" => |engine, args| message(engine, args, Kind::MidiIn),
        _ => return None,
    }))
}

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
            (64, 69),
        )))
    })
}

fn open<'a>(engine: &'a Engine, mut args: Args, direction: &'static Side) -> Later<'a> {
    Box::pin(async move {
        let found = {
            let mut system = engine.system();
            let handle = args.dword(&system);
            let id = args.word(&system);
            let callback = args.dword(&system);
            let instance = args.dword(&system);
            let flags = args.dword(&system);

            if !checks::writable(&system, handle, 2)
                || !checks::callback_ok(&mut system, callback, (flags >> 16) as u16)
            {
                return Ok(Answer::Word(MMSYSERR_INVALPARAM));
            }

            if flags & 0xffff != 0 {
                return Ok(Answer::Word(MMSYSERR_INVALFLAG));
            }

            system.write_far(handle, &[0, 0]);

            let devices = &system.mmsystem.devices;
            let Some((place, device)) = devices.place_of(direction.kind, id) else {
                return Ok(Answer::Word(MMSYSERR_BADDEVICEID));
            };

            if devices.table(direction.kind).entries[place]
                .procedure
                .is_none()
            {
                return Ok(Answer::Word(MMSYSERR_NODRIVER));
            }

            (handle, id, callback, instance, flags, place, device)
        };
        let (handle, id, callback, instance, flags, place, device) = found;
        let describe = |opened: u16| {
            let mut bytes = opened.to_le_bytes().to_vec();

            bytes.extend_from_slice(&callback.to_le_bytes());
            bytes.extend_from_slice(&instance.to_le_bytes());
            bytes
        };
        let (answer, opened) = devices::open(
            engine,
            direction.kind,
            place,
            device,
            id,
            direction.open,
            describe,
            flags,
            false,
            Keep::Handle,
        )
        .await?;

        if let Some(opened) = opened {
            engine.system().write_far(handle, &opened.to_le_bytes());
        }

        Ok(Answer::Word(answer))
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

/// The handle checked, then the header: an error, or none.
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

            if checks::header_flags(&system, header) & PREPARED != 0 {
                return Ok(Answer::Word(MMSYSERR_NOERROR));
            }

            checks::set_header_flags(&mut system, header, 0);
        }

        let answer = devices::send_by_handle(
            engine,
            handle,
            direction.kind,
            direction.prepare,
            header,
            u32::from(size),
        )
        .await?
        .unwrap_or(0) as u16;

        if answer != MMSYSERR_NOTSUPPORTED {
            return Ok(Answer::Word(answer));
        }

        // MMSYSTEM's own preparing: the header and its data locked in
        // place, which in winbox.js's memory they always are.
        let mut system = engine.system();
        let flags = checks::header_flags(&system, header);

        checks::set_header_flags(&mut system, header, flags | PREPARED);
        Ok(Answer::Word(MMSYSERR_NOERROR))
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

            if flags & PREPARED == 0 {
                return Ok(Answer::Word(MMSYSERR_NOERROR));
            }

            if flags & MIDI_INQUEUE != 0 {
                return Ok(Answer::Word(MIDIERR_STILLPLAYING));
            }
        }

        let answer = devices::send_by_handle(
            engine,
            handle,
            direction.kind,
            direction.unprepare,
            header,
            u32::from(size),
        )
        .await?
        .unwrap_or(0) as u16;

        if answer != MMSYSERR_NOTSUPPORTED {
            return Ok(Answer::Word(answer));
        }

        let mut system = engine.system();
        let flags = checks::header_flags(&system, header);

        checks::set_header_flags(&mut system, header, flags & !PREPARED);
        Ok(Answer::Word(MMSYSERR_NOERROR))
    })
}

fn short_msg(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, value) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system))
        };

        Ok(Answer::Word(
            devices::send_by_handle(engine, handle, Kind::MidiOut, MODM_DATA, value, 0)
                .await?
                .map_or(MMSYSERR_INVALHANDLE, |answer| answer as u16),
        ))
    })
}

/// A header's flags as a long message or a buffer needs them: an error, or
/// none.
fn ready(flags: u32) -> Option<u16> {
    if flags & PREPARED == 0 {
        Some(MIDIERR_UNPREPARED)
    } else if flags & MIDI_INQUEUE != 0 {
        Some(MIDIERR_STILLPLAYING)
    } else {
        None
    }
}

fn long_msg(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, header, size) = header_args(engine, &mut args);

        {
            let system = engine.system();

            if system
                .mmsystem
                .devices
                .handle(handle, Kind::MidiOut)
                .is_none()
            {
                return Ok(Answer::Word(MMSYSERR_INVALHANDLE));
            }

            let flags = checks::header_flags(&system, header);

            if flags & 0xfff8 != 0 {
                return Ok(Answer::Word(MMSYSERR_INVALFLAG));
            }

            if let Some(error) = ready(flags) {
                return Ok(Answer::Word(error));
            }
        }

        let answer = devices::send_by_handle(
            engine,
            handle,
            Kind::MidiOut,
            MODM_LONGDATA,
            header,
            u32::from(size),
        )
        .await?
        .unwrap_or(0);

        Ok(Answer::Word(answer as u16))
    })
}

fn add_buffer(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, header, size) = header_args(engine, &mut args);

        if let Some(error) = checked(engine, handle, header, size, Kind::MidiIn) {
            return Ok(Answer::Word(error));
        }

        if let Some(error) = ready(checks::header_flags(&engine.system(), header)) {
            return Ok(Answer::Word(error));
        }

        let answer = devices::send_by_handle(
            engine,
            handle,
            Kind::MidiIn,
            MIDM_ADDBUFFER,
            header,
            u32::from(size),
        )
        .await?
        .unwrap_or(0);

        Ok(Answer::Word(answer as u16))
    })
}

fn get_volume(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (id, far) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system))
        };

        if !checks::writable(&engine.system(), far, 4) {
            return Ok(Answer::Word(MMSYSERR_INVALPARAM));
        }

        let answer = devices::send_by_id(engine, Kind::MidiOut, id, MODM_GETVOLUME, far, 0).await?;

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
            devices::send_by_id(engine, Kind::MidiOut, id, MODM_SETVOLUME, value, 0).await?;

        Ok(Answer::Word(answer as u16))
    })
}

/// `midiOutCachePatches` and `midiOutCacheDrumPatches`.
fn cache_patches(engine: &Engine, mut args: Args, message: u16) -> Later<'_> {
    Box::pin(async move {
        let (handle, bank, far, flags) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.dword(&system),
                args.word(&system),
            )
        };

        {
            let system = engine.system();

            if system
                .mmsystem
                .devices
                .handle(handle, Kind::MidiOut)
                .is_none()
            {
                return Ok(Answer::Word(MMSYSERR_INVALHANDLE));
            }

            if !checks::writable(&system, far, 0x100) {
                return Ok(Answer::Word(MMSYSERR_INVALPARAM));
            }

            if flags & 0xfff8 != 0 {
                return Ok(Answer::Word(MMSYSERR_INVALFLAG));
            }
        }

        let second = u32::from(bank) << 16 | u32::from(flags);
        let answer = devices::send_by_handle(engine, handle, Kind::MidiOut, message, far, second)
            .await?
            .unwrap_or(0);

        Ok(Answer::Word(answer as u16))
    })
}

//! The joystick calls, which MMSYSTEM answers through the driver
//! `SYSTEM.INI`'s `[drivers]` names `joystick`.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg8 `0`-`48e`, seg2 `780`-`8e3`);
//! **recorded** by `mmmisc` on both installations, neither of which has a
//! joystick driver:
//!
//! * As it loads, MMSYSTEM opens `joystick` twice, the second time with an
//!   `lParam` of 1, one for each joystick, and asks the first how many
//!   joysticks there are (`JDD_GETNUMDEVS`, 801h).
//! * With no driver, `joyGetNumDevs` answers 0 and every other call
//!   `MMSYSERR_NODRIVER` (6) -- but `joySetCapture` for no window, or one
//!   that is not, which answers `JOYERR_PARMS` (A5h) first. A joystick past
//!   the count is A5h too.
//! * `joyGetDevCaps` and `joyGetPos` are the driver's `JDD_GETDEVCAPS`
//!   (802h) and `JDD_GETPOS` (901h) to the joystick's driver, and nothing is
//!   checked of their pointers. `joySetCalibration` passes the six words it
//!   is given pointers to as `JDD_SETCALIBRATION` (902h) and writes back the
//!   six the driver gives.
//! * The threshold is MMSYSTEM's own, nought to begin with.
//! * `joySetCapture` refuses a window another capture of the joystick still
//!   has (`JOYERR_NOCANDO`, A6h); asks the capabilities, and the position,
//!   then sets a timer of the period, within the driver's least and most,
//!   whose procedure posts the window `MM_JOY1MOVE` and the like.
//!   `joyReleaseCapture` kills the timer.
//!
//! Not followed: the calibration MMSYSTEM sets as it loads from
//! `[joystick.drv]`'s `JoyCal` keys, read as six hexadecimal words; no
//! installation here has a joystick driver for it to go to.

use crate::call::{Answer, Args, Implementation, Later, Stop, call_named};
use crate::engine::{Engine, GuestArg};

const MMSYSERR_NODRIVER: u16 = 6;
const JOYERR_PARMS: u16 = 0xa5;
const JOYERR_NOCANDO: u16 = 0xa6;

const JDD_GETNUMDEVS: u16 = 0x801;
const JDD_GETDEVCAPS: u16 = 0x802;
const JDD_GETPOS: u16 = 0x901;
const JDD_SETCALIBRATION: u16 = 0x902;

const MM_JOY1MOVE: u16 = 0x3a0;
const MM_JOY1ZMOVE: u16 = 0x3a2;
const MM_JOY1BUTTONDOWN: u16 = 0x3b5;
const MM_JOY1BUTTONUP: u16 = 0x3b7;

/// The hidden ordinal of MMSYSTEM's capture timer's procedure (seg8 `30b`).
pub const TIMER_ORDINAL: u16 = 1203;

/// A joystick's capture.
#[derive(Debug, Default, Clone, Copy)]
struct Capture {
    hwnd: u16,
    period: u16,
    changed: u16,
    threshold: u16,
    timer: u16,
}

/// MMSYSTEM's joysticks.
#[derive(Debug, Default)]
pub struct Joysticks {
    drivers: [u16; 2],
    count: u16,
    captures: [Capture; 2],
    /// The last position each capture's timer saw: x, y, z and the buttons.
    last: [[u16; 4]; 2],
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "joyGetNumDevs" => Implementation::Sync(|system, _| {
            let joysticks = &system.mmsystem.joysticks;

            Ok(Answer::Word(if joysticks.drivers[0] != 0 {
                joysticks.count
            } else {
                0
            }))
        }),
        "joyGetDevCaps" => Implementation::Async(get_dev_caps_call),
        "joyGetPos" => Implementation::Async(get_pos_call),
        "joyGetThreshold" => Implementation::Sync(|system, args| {
            let id = args.word(system);
            let far = args.dword(system);

            if let Some(error) = checked(system, id) {
                return Ok(Answer::Word(error));
            }

            let threshold = system.mmsystem.joysticks.captures[usize::from(id & 1)].threshold;

            system.write_far(far, &threshold.to_le_bytes());
            Ok(Answer::Word(0))
        }),
        "joySetThreshold" => Implementation::Sync(|system, args| {
            let id = args.word(system);
            let threshold = args.word(system);

            if let Some(error) = checked(system, id) {
                return Ok(Answer::Word(error));
            }

            system.mmsystem.joysticks.captures[usize::from(id & 1)].threshold = threshold;
            Ok(Answer::Word(0))
        }),
        "joyReleaseCapture" => Implementation::Async(release_capture_call),
        "joySetCapture" => Implementation::Async(set_capture),
        "joySetCalibration" => Implementation::Async(set_calibration),
        "joyTimer" => Implementation::Async(timer),
        _ => return None,
    })
}

fn checked(system: &crate::system::System, id: u16) -> Option<u16> {
    let joysticks = &system.mmsystem.joysticks;

    if joysticks.drivers[0] == 0 {
        return Some(MMSYSERR_NODRIVER);
    }

    (id >= joysticks.count).then_some(JOYERR_PARMS)
}

fn driver_of(engine: &Engine, id: u16) -> u16 {
    engine.system().mmsystem.joysticks.drivers[usize::from(id & 1)]
}

async fn user(
    engine: &Engine,
    name: &'static str,
    args: &[GuestArg],
) -> Result<(u32, Vec<Vec<u8>>), Stop> {
    let (answer, structures) = Box::pin(call_named(engine, "USER", name, args)).await?;

    Ok((answer.value().unwrap_or(0), structures))
}

async fn send(
    engine: &Engine,
    driver: u16,
    message: u16,
    first: GuestArg,
    second: GuestArg,
) -> Result<(u16, Vec<Vec<u8>>), Stop> {
    let args = [
        GuestArg::Word(driver),
        GuestArg::Word(message),
        first,
        second,
    ];
    let (answer, structures) = user(engine, "SendDriverMessage", &args).await?;

    Ok((answer as u16, structures))
}

async fn is_window(engine: &Engine, hwnd: u16) -> Result<bool, Stop> {
    Ok(user(engine, "IsWindow", &[GuestArg::Word(hwnd)]).await?.0 != 0)
}

async fn post(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<(), Stop> {
    let args = [
        GuestArg::Word(hwnd),
        GuestArg::Word(message),
        GuestArg::Word(wparam),
        GuestArg::Long(lparam),
    ];

    user(engine, "PostMessage", &args).await.map(|_| ())
}

/// The joystick driver opened as MMSYSTEM loads (seg2 `886`), after it has
/// opened the first.
pub async fn open_joysticks(engine: &Engine, first: u16) -> Result<(), Stop> {
    engine.system().mmsystem.joysticks.drivers[0] = first;

    if first == 0 {
        return Ok(());
    }

    let second = engine.open_driver(b"joystick", None, 1).await?;
    let count = send(
        engine,
        first,
        JDD_GETNUMDEVS,
        GuestArg::Long(0),
        GuestArg::Long(0),
    )
    .await?
    .0;
    let mut system = engine.system();
    let joysticks = &mut system.mmsystem.joysticks;

    joysticks.drivers[1] = second;

    for capture in &mut joysticks.captures {
        capture.hwnd = 0;
        capture.threshold = 0;
        capture.timer = 0;
    }

    joysticks.count = count;
    Ok(())
}

async fn get_dev_caps(engine: &Engine, id: u16, far: u32, size: u16) -> Result<u16, Stop> {
    if let Some(error) = checked(&engine.system(), id) {
        return Ok(error);
    }

    let driver = driver_of(engine, id);

    Ok(send(
        engine,
        driver,
        JDD_GETDEVCAPS,
        GuestArg::Long(far),
        GuestArg::Long(u32::from(size)),
    )
    .await?
    .0)
}

fn get_dev_caps_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (id, far, size) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };

        Ok(Answer::Word(get_dev_caps(engine, id, far, size).await?))
    })
}

async fn get_pos(engine: &Engine, id: u16, far: u32) -> Result<u16, Stop> {
    if let Some(error) = checked(&engine.system(), id) {
        return Ok(error);
    }

    let driver = driver_of(engine, id);

    Ok(send(
        engine,
        driver,
        JDD_GETPOS,
        GuestArg::Long(far),
        GuestArg::Long(0),
    )
    .await?
    .0)
}

fn get_pos_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (id, far) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system))
        };

        Ok(Answer::Word(get_pos(engine, id, far).await?))
    })
}

async fn release_capture(engine: &Engine, id: u16) -> Result<u16, Stop> {
    if let Some(error) = checked(&engine.system(), id) {
        return Ok(error);
    }

    let capture = engine.system().mmsystem.joysticks.captures[usize::from(id & 1)];

    if capture.hwnd != 0 {
        user(
            engine,
            "KillTimer",
            &[GuestArg::Word(0), GuestArg::Word(capture.timer)],
        )
        .await?;

        let mut system = engine.system();
        let capture = &mut system.mmsystem.joysticks.captures[usize::from(id & 1)];

        capture.timer = 0;
        capture.hwnd = 0;
    }

    Ok(0)
}

fn release_capture_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let id = args.word(&engine.system());

        Ok(Answer::Word(release_capture(engine, id).await?))
    })
}

fn set_capture(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, id, period, changed) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.word(&system),
            )
        };

        if hwnd == 0 || !is_window(engine, hwnd).await? {
            return Ok(Answer::Word(JOYERR_PARMS));
        }

        if let Some(error) = checked(&engine.system(), id) {
            return Ok(Answer::Word(error));
        }

        let held = engine.system().mmsystem.joysticks.captures[usize::from(id & 1)].hwnd;

        if held != 0 {
            if is_window(engine, held).await? {
                return Ok(Answer::Word(JOYERR_NOCANDO));
            }

            release_capture(engine, id).await?;
        }

        // The capabilities, in MMSYSTEM's frame: the period kept between
        // the driver's least and most.
        let frame = super::devices::below_stack(&mut engine.system(), &[&[0; 0x36]]);
        let caps = get_dev_caps(engine, id, frame.pointers[0], 0x36).await?;
        let bytes = {
            let mut system = engine.system();
            let bytes = system.read_far(frame.pointers[0], 0x36);

            frame.release(&mut system);
            bytes
        };

        if caps != 0 {
            return Ok(Answer::Word(JOYERR_NOCANDO));
        }

        let least = u16::from_le_bytes([bytes[0x32], bytes[0x33]]);
        let most = u16::from_le_bytes([bytes[0x34], bytes[0x35]]);
        let period = period.max(least).min(most);
        let frame = super::devices::below_stack(&mut engine.system(), &[&[0; 8]]);
        let position = get_pos(engine, id, frame.pointers[0]).await?;

        frame.release(&mut engine.system());

        if position != 0 {
            return Ok(Answer::Word(position));
        }

        let procedure = super::mmio::own_address(&mut engine.system(), TIMER_ORDINAL);
        let args = [
            GuestArg::Word(0),
            GuestArg::Word(0),
            GuestArg::Word(period),
            GuestArg::Long(procedure),
        ];
        let timer = user(engine, "SetTimer", &args).await?.0 as u16;
        let mut system = engine.system();
        let capture = &mut system.mmsystem.joysticks.captures[usize::from(id & 1)];

        capture.period = period;
        capture.changed = changed;
        capture.timer = timer;

        if timer == 0 {
            return Ok(Answer::Word(JOYERR_NOCANDO));
        }

        capture.hwnd = hwnd;
        Ok(Answer::Word(0))
    })
}

/// The capture timer's procedure (seg8 `30b`): the joystick's position
/// asked, and the window posted a button's change, and its move -- every
/// time, or, asked for only changes, when the position moved past the
/// threshold.
fn timer(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let event = {
            let system = engine.system();

            args.word(&system);
            args.word(&system);
            args.word(&system)
        };
        let id = {
            let system = engine.system();
            let captures = &system.mmsystem.joysticks.captures;

            if captures[0].timer == event {
                0
            } else if captures[1].timer == event {
                1
            } else {
                event
            }
        };
        let held = engine.system().mmsystem.joysticks.captures[usize::from(id & 1)].hwnd;

        if held == 0 || !is_window(engine, held).await? {
            release_capture(engine, id).await?;
        }

        let driver = driver_of(engine, id);
        let (answer, structures) = send(
            engine,
            driver,
            JDD_GETPOS,
            GuestArg::Struct(vec![0; 8]),
            GuestArg::Long(0),
        )
        .await?;

        if answer != 0 {
            return Ok(Answer::Nothing);
        }

        let info = structures.into_iter().next().unwrap_or_else(|| vec![0; 8]);
        let field = |at: usize| u16::from_le_bytes([info[at], info[at + 1]]);
        let (x, y, z, buttons) = (field(0), field(2), field(4), field(6));
        let (capture, last) = {
            let system = engine.system();
            let joysticks = &system.mmsystem.joysticks;

            (
                joysticks.captures[usize::from(id & 1)],
                joysticks.last[usize::from(id & 1)],
            )
        };
        let hwnd = capture.hwnd;
        let position = u32::from(y) << 16 | u32::from(x);

        for bit in 0..4 {
            let mask = 1u16 << bit;

            if (last[3] ^ buttons) & mask != 0 {
                let message = if mask & buttons != 0 {
                    MM_JOY1BUTTONDOWN
                } else {
                    MM_JOY1BUTTONUP
                };

                post(
                    engine,
                    hwnd,
                    message.wrapping_add(id),
                    mask << 8 | buttons,
                    position,
                )
                .await?;
            }
        }

        let beyond = |from: u16, to: u16| from.abs_diff(to) > capture.threshold;

        if capture.changed == 0 || beyond(last[0], x) || beyond(last[1], y) {
            post(
                engine,
                hwnd,
                MM_JOY1MOVE.wrapping_add(id),
                buttons,
                position,
            )
            .await?;
        } else if beyond(last[2], z) {
            post(
                engine,
                hwnd,
                MM_JOY1ZMOVE.wrapping_add(id),
                buttons,
                u32::from(z),
            )
            .await?;
        }

        engine.system().mmsystem.joysticks.last[usize::from(id & 1)] = [x, y, z, buttons];
        Ok(Answer::Nothing)
    })
}

/// `joySetCalibration`: six words passed to the driver and the six it gives
/// written back.
fn set_calibration(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (id, pointers) = {
            let system = engine.system();
            let id = args.word(&system);
            let pointers: Vec<u32> = (0..6).map(|_| args.dword(&system)).collect();

            (id, pointers)
        };

        if let Some(error) = checked(&engine.system(), id) {
            return Ok(Answer::Word(error));
        }

        let given: Vec<u8> = {
            let system = engine.system();

            pointers
                .iter()
                .flat_map(|&far| system.read_far(far, 2))
                .collect()
        };
        let driver = driver_of(engine, id);
        let frame = super::devices::below_stack(&mut engine.system(), &[&given, &[0; 12]]);
        let (answer, _) = send(
            engine,
            driver,
            JDD_SETCALIBRATION,
            GuestArg::Long(frame.pointers[0]),
            GuestArg::Long(frame.pointers[1]),
        )
        .await?;
        let mut system = engine.system();
        let back = system.read_far(frame.pointers[1], 12);

        frame.release(&mut system);

        for (index, &far) in pointers.iter().enumerate() {
            system.write_far(far, &back[index * 2..index * 2 + 2]);
        }

        Ok(Answer::Word(answer))
    })
}

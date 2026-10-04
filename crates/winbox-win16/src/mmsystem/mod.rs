//! The multimedia system library, `MMSYSTEM.DLL`, as winbox.js keeps it:
//! its timer services (`time.rs`), its devices, of which there are none,
//! MCI (`mci.rs`, `mci_string.rs`) and the MCI drivers it opens
//! (`mci_drivers.rs`), and itself as an installable driver (`driver.rs`).
//! Sound is never played: where Windows would play it, what it answers is
//! kept. The rest of its exports are stubs.
//!
//! The devices are those of an installation with no sound driver, which is
//! what the Windows here is: its `SYSTEM.INI` names only the timer and the
//! MIDI mapper. **Recorded** by the `mmdevs` probe:
//!
//! * There are no waveform, MIDI or auxiliary devices: each count is 0.
//! * Opening a waveform device, for output or input, by number or through
//!   the mapper, to query a format or for real, answers
//!   `MMSYSERR_BADDEVICEID` (2), and a handle asked for is written as 0.
//! * Asking a device's capabilities answers 2 as well.
//! * The error texts are MMSYSTEM's strings, numbered as the errors are;
//!   asking answers 0. winbox.js has them itself (`strings.rs`).
//!
//! Sound Recorder took an answer of 0 -- a device opened -- at its word, and
//! copied a recording of minus two bytes over its own stack.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

pub mod driver;
pub mod mci;
pub mod mci_drivers;
pub mod mci_string;
pub mod strings;
pub mod time;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
use crate::system::System;

const MMSYSERR_BADDEVICEID: u16 = 2;
const MMSYSERR_BADERRNUM: u16 = 9;

/// A number made an unsigned long as JavaScript's `>>> 0` makes it: its
/// whole part, modulo 2^32, and nought for one that is no number or is
/// infinite.
pub(crate) fn uint32(value: f64) -> u32 {
    if value.is_finite() {
        value.trunc().rem_euclid(4_294_967_296.0) as u32
    } else {
        0
    }
}

/// What MMSYSTEM keeps.
#[derive(Debug, Default)]
pub struct State {
    pub driver: driver::DriverState,
    pub time: time::TimeEvents,
    pub mci: mci::Table,
    pub drivers: mci_drivers::DriverState,
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "DriverProc" => Implementation::Async(driver_proc_call),
        "mciSendCommand" => Implementation::Async(mci::mci_send_command_call),
        "mciSendString" => Implementation::Async(mci_string::mci_send_string),
        _ => Implementation::Sync(match name {
            "sndPlaySound" => snd_play_sound,
            "waveOutGetNumDevs" | "waveInGetNumDevs" | "midiOutGetNumDevs" | "midiInGetNumDevs"
            | "auxGetNumDevs" => no_devices,
            "waveOutGetDevCaps" | "waveInGetDevCaps" => wave_get_dev_caps,
            "waveOutGetErrorText" | "waveInGetErrorText" => wave_get_error_text,
            "waveOutOpen" | "waveInOpen" => wave_open,
            "timeGetSystemTime" => time::time_get_system_time,
            "timeSetEvent" => time::time_set_event,
            "timeKillEvent" => time::time_kill_event,
            "timeGetDevCaps" => time::time_get_dev_caps,
            "timeBeginPeriod" => time::time_begin_period,
            "timeEndPeriod" => time::time_end_period,
            "timeGetTime" => time::time_get_time,
            "mciGetDeviceID" => mci::mci_get_device_id,
            "mciGetErrorString" => mci::mci_get_error_string,
            "mciSetDriverData" => mci::mci_set_driver_data,
            "mciGetDriverData" => mci::mci_get_driver_data,
            _ => return None,
        }),
    })
}

/// No waveform device: nothing plays, whatever is asked, and the answer is
/// nought (`sndplay`).
fn snd_play_sound(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(0))
}

/// `waveOutGetNumDevs` and the rest: none.
fn no_devices(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(0))
}

/// `waveOutGetDevCaps` and `waveInGetDevCaps`: no device.
fn wave_get_dev_caps(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(MMSYSERR_BADDEVICEID))
}

/// `waveOutOpen` and `waveInOpen`: no device, and no handle.
fn wave_open(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    if far != 0 {
        system.write_far(far, &[0, 0]);
    }

    Ok(Answer::Word(MMSYSERR_BADDEVICEID))
}

/// An error's text, from `MMSYSTEM.DLL`'s string table: the general
/// errors, 0 to 11, and the waveform ones, 32 to 35.
fn wave_get_error_text(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let error = args.word(system);
    let far = args.dword(system);
    let size = args.word(system);

    if !(error <= 11 || (32..=35).contains(&error)) {
        return Ok(Answer::Word(MMSYSERR_BADERRNUM));
    }

    let Some(text) = strings::string(error) else {
        return Ok(Answer::Word(MMSYSERR_BADERRNUM));
    };

    system.copy_text(text, far, usize::from(size));
    Ok(Answer::Word(0))
}

/// MMSYSTEM's `DriverProc` called by the program, as USER calls it.
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
            driver::driver_proc(engine, id, handle, message, first, second).await?,
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `>>> 0`: the whole part, modulo 2^32; past 49 days of milliseconds
    /// `timeGetTime` comes round to nought, not to its largest.
    #[test]
    fn numbers_are_made_unsigned_longs_as_javascript_makes_them() {
        assert_eq!(uint32(4_294_967_296.0 + 7.9), 7);
        assert_eq!(uint32(-1.5), 0xffff_ffff);
        assert_eq!(uint32(f64::NAN), 0);
        assert_eq!(uint32(f64::INFINITY), 0);
    }
}

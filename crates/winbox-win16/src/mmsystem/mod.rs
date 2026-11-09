//! The multimedia system library, `MMSYSTEM.DLL`, as winbox.js keeps it:
//! its timer services (`time.rs`); its devices -- the drivers it installs
//! and the handles it makes (`devices.rs`), what it checks of a call before
//! a driver hears of it (`checks.rs`), waveform (`wave.rs`), MIDI
//! (`midi.rs`) and auxiliary (`auxiliary.rs`) devices, and how a driver
//! calls a program back (`callback.rs`); MCI (`mci.rs`, `mci_string.rs`)
//! and the MCI drivers it opens (`mci_drivers.rs`, the sequencer's playing
//! `sequencer.rs` and its warning `seq_box.rs`); `sndPlaySound`
//! (`sound.rs`); its buffered file I/O, the `mmio` functions (`mmio.rs`);
//! its tasks (`tasks.rs`), interrupt stacks (`stacks.rs`) and joysticks
//! (`joystick.rs`); `mciExecute` (`mci_execute.rs`); and itself as an
//! installable driver (`driver.rs`).
//!
//! The devices are those of the drivers `SYSTEM.INI` names. The Windows
//! here names only the timer and the MIDI mapper, and so has none, unless
//! winbox.js's own sound card driver is installed (`wbsound`), whose
//! devices are then its. **Recorded** by the `mmdevs` probe without one:
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

pub mod auxiliary;
pub mod callback;
pub mod checks;
pub mod devices;
pub mod driver;
pub mod joystick;
pub mod mci;
pub mod mci_drivers;
pub mod mci_execute;
pub mod mci_string;
pub mod mci_tables;
pub mod mci_wave;
pub mod midi;
pub mod mmio;
pub mod mmtask;
pub mod seq_box;
pub mod sequencer;
pub mod sound;
pub mod stacks;
pub mod strings;
pub mod tasks;
pub mod time;
pub mod wave;

#[cfg(test)]
pub(crate) mod device_tests;

use crate::call::{Answer, Args, Implementation, Later};
use crate::engine::Engine;

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
    pub devices: devices::Devices,
    pub sound: sound::Sound,
    pub wave_files: mci_wave::WaveFiles,
    pub sequencer: sequencer::Sequencer,
    pub mmio: mmio::Mmio,
    pub stacks: stacks::Stacks,
    pub mci_tables: mci_tables::Tables,
    pub joysticks: joystick::Joysticks,
}

pub fn implementation(name: &str) -> Option<Implementation> {
    if let Some(implementation) = wave::implementation(name)
        .or_else(|| midi::implementation(name))
        .or_else(|| auxiliary::implementation(name))
        .or_else(|| mmio::implementation(name))
        .or_else(|| joystick::implementation(name))
    {
        return Some(implementation);
    }

    // USER's driver calls, jumped to (seg4 `57e`-`592`).
    let user = match name {
        "DrvOpen" => Some("OpenDriver"),
        "DrvClose" => Some("CloseDriver"),
        "DrvSendMessage" => Some("SendDriverMessage"),
        "DrvGetModuleHandle" => Some("GetDriverModuleHandle"),
        "DrvDefDriverProc" => Some("DefDriverProc"),
        _ => None,
    };

    if let Some(user) = user {
        return crate::drivers::implementation(user);
    }

    Some(match name {
        "DriverProc" => Implementation::Async(driver_proc_call),
        "DriverCallback" => Implementation::Async(callback::driver_callback_call),
        "mmDrvInstall" => Implementation::Async(mm_drv_install),
        "mciSendCommand" => Implementation::Async(mci::mci_send_command_call),
        "mciSendString" => Implementation::Async(mci_string::mci_send_string),
        "sndPlaySound" => Implementation::Async(sound::snd_play_sound),
        "timeSetEvent" => Implementation::Async(time::time_set_event),
        "mmGetCurrentTask" => Implementation::Async(tasks::mm_get_current_task),
        "mmTaskSignal" => Implementation::Async(tasks::mm_task_signal),
        "mmTaskYield" => Implementation::Async(tasks::mm_task_yield),
        "mmTaskBlock" => Implementation::Async(tasks::mm_task_block),
        "mmTaskCreate" => Implementation::Async(mmtask::mm_task_create),
        "mmTaskMain" => Implementation::Async(mmtask::mm_task_main),
        "mciDriverYield" => Implementation::Async(mci::mci_driver_yield),
        "mciBreakYield" => Implementation::Async(mci::mci_break_yield),
        "mciDriverNotify" => Implementation::Async(mci::mci_driver_notify),
        "mciExecute" => Implementation::Async(mci_execute::mci_execute),
        "mciLoadCommandResource" => Implementation::Async(mci_tables::mci_load_command_resource),
        "mciFreeCommandResource" => Implementation::Async(mci_tables::mci_free_command_resource),
        "mciGetDeviceIDFromElementID" => {
            Implementation::Async(mci::mci_get_device_id_from_element_id)
        }
        _ => Implementation::Sync(match name {
            "timeGetSystemTime" => time::time_get_system_time,
            "timeKillEvent" => time::time_kill_event,
            "timeGetDevCaps" => time::time_get_dev_caps,
            "timeBeginPeriod" => time::time_begin_period,
            "timeEndPeriod" => time::time_end_period,
            "timeGetTime" => time::time_get_time,
            "mciGetDeviceID" => mci::mci_get_device_id,
            "mciGetErrorString" => mci::mci_get_error_string,
            "mciSetDriverData" => mci::mci_set_driver_data,
            "mciGetDriverData" => mci::mci_get_driver_data,
            "mciSetYieldProc" => mci::mci_set_yield_proc,
            "mciGetYieldProc" => mci::mci_get_yield_proc,
            "mciGetCreatorTask" => mci::mci_get_creator_task,
            // A near procedure behind a far export (seg5 `3994`-`39dd`): the
            // parser's nought for a command it does not parse.
            "mciParseCommand" => |_, _| Ok(Answer::Word(0)),
            "StackEnter" => stacks::stack_enter,
            "StackLeave" => stacks::stack_leave,
            // Nothing to let go: 1 (seg2 `14`).
            "WEP" => |_, _| Ok(Answer::Word(1)),
            "mmsystemGetVersion" => |_, _| Ok(Answer::Word(0x101)),
            // The retail MMSYSTEM's returns at once (seg1 `30a`).
            "OutputDebugStr" => |_, _| Ok(Answer::Nothing),
            _ => return None,
        }),
    })
}

/// `mmDrvInstall`: a driver installed, or removed, by a driver's handle or
/// a module's, as MMSYSTEM installs those it opens as it loads.
fn mm_drv_install(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, procedure, flags) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };

        Ok(Answer::Word(
            devices::install(engine, handle, Some(procedure), flags).await?,
        ))
    })
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

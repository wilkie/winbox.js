//! MMSYSTEM as an installable driver: `SYSTEM.INI`'s `[boot]` names it in
//! `drivers=`, and USER loads it so as Windows starts.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg4 `28`, seg2 `101`):
//!
//! * `DRV_LOAD`, the first time, readies the multimedia drivers: it opens
//!   `timer`, then the wave, MIDI and auxiliary drivers `[drivers]` names --
//!   `wave`, `wave1` to `wave9` and the like -- then their mappers if any of
//!   them has a device, then `joystick`. It answers what that answers, 1;
//!   afterwards, 1.
//! * `DRV_ENABLE` ends the first time, and answers 1. `DRV_OPEN`,
//!   `DRV_CLOSE`, `DRV_DISABLE`, `DRV_FREE`, `DRV_EXITSESSION` and
//!   `DRV_EXITAPPLICATION` answer 1; the rest, as `DefDriverProc` would.
//!
//! `timer` opening first is why it comes first in USER's list of drivers:
//! it is linked while MMSYSTEM, whose load opened it, is not yet.
//!
//! The wave, MIDI and auxiliary drivers are opened and installed as
//! `devices.rs` says, the interrupt stacks made as `stacks.rs` says, and
//! the joystick's driver opened as `joystick.rs` says. Not followed: the
//! window MMSYSTEM makes for itself.

use crate::call::Stop;
use crate::engine::Engine;

use super::devices::Kind;

/// What MMSYSTEM keeps as a driver: whether its first load is still to
/// come, and the drivers it opened.
#[derive(Debug)]
pub struct DriverState {
    pending: bool,
    pub timer: u16,
    pub joystick: u16,
}

impl Default for DriverState {
    fn default() -> Self {
        Self {
            pending: true,
            timer: 0,
            joystick: 0,
        }
    }
}

/// MMSYSTEM's `DriverProc`.
pub async fn driver_proc(
    engine: &Engine,
    _id: u32,
    handle: u16,
    message: u16,
    _first: u32,
    _second: u32,
) -> Result<u32, Stop> {
    match message {
        1 => {
            if !engine.system().mmsystem.driver.pending {
                return Ok(1);
            }

            let timer = engine.open_driver(b"timer", None, 0).await?;

            engine.system().mmsystem.driver.timer = timer;

            // The waveform and MIDI drivers, then the interrupt stacks if
            // any device came of them, then the auxiliary drivers (seg2
            // `101`).
            super::devices::open_wave_and_midi(engine).await?;

            let any = {
                let system = engine.system();
                let devices = &system.mmsystem.devices;

                [Kind::WaveOut, Kind::WaveIn, Kind::MidiOut, Kind::MidiIn]
                    .iter()
                    .fold(0u16, |sum, &kind| sum.wrapping_add(devices.count(kind)))
                    != 0
            };

            if any {
                super::stacks::make_stacks(engine).await?;
            }

            super::devices::open_auxiliary(engine).await?;

            let joystick = engine.open_driver(b"joystick", None, 0).await?;

            engine.system().mmsystem.driver.joystick = joystick;
            super::joystick::open_joysticks(engine, joystick).await?;
            Ok(1)
        }
        2 => {
            engine.system().mmsystem.driver.pending = false;
            Ok(1)
        }
        3..=6 | 0xb | 0xc => Ok(1),
        _ => Ok(crate::drivers::def_driver_proc(handle, message)),
    }
}

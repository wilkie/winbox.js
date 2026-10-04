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
//! `devices.rs` says. Not followed: the stacks MMSYSTEM readies for
//! interrupt time once there is any device, which winbox.js has no need
//! of; the window it makes for itself; and what it does with a joystick
//! driver once opened, which the installation does not have.

use crate::call::Stop;
use crate::engine::Engine;

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

            super::devices::open_drivers(engine).await?;

            let joystick = engine.open_driver(b"joystick", None, 0).await?;

            engine.system().mmsystem.driver.joystick = joystick;
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

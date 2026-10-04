//! The timer driver, `TIMER.DRV`, kept by winbox.js itself: MMSYSTEM opens
//! it as it loads, as `timer`, and it stands in USER's list of installable
//! drivers under that name and its file's.
//!
//! On Windows it drives the hardware timer MMSYSTEM's timer services run
//! on. winbox.js's MMSYSTEM keeps its own time, so here the driver answers
//! USER's messages and drives nothing.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

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

/// What the timer driver answers. **Read out** of `TIMER.DRV`'s
/// `DriverProc`: `DRV_LOAD`, `DRV_OPEN` and `DRV_CLOSE` 1, `DRV_INSTALL` 2,
/// and nought for `DRV_FREE`, `DRV_CONFIGURE`, `DRV_QUERYCONFIGURE`,
/// `DRV_REMOVE` and the rest. `DRV_ENABLE` and `DRV_DISABLE` hook and unhook
/// the hardware timer, which here there is none of; what they answer was
/// not read, and USER does not look -- 1 here.
///
/// Not followed: its own messages, 800h to 814h, which MMSYSTEM's timer
/// services send it on Windows and winbox.js's do not.
pub fn driver_proc(message: u16) -> u32 {
    match message {
        1..=5 => 1,
        9 => 2,
        _ => 0,
    }
}

fn driver_proc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _id = args.dword(system);
    let _handle = args.word(system);
    let message = args.word(system);

    Ok(Answer::Dword(driver_proc(message)))
}

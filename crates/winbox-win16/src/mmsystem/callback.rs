//! `DriverCallback`: how a driver tells a program a device opened, a
//! buffer is done, a device closed.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg1 `3ab`). A driver calls it with the
//! callback and its kind as the program gave them at the open -- the kind
//! the high word of the open's flags, `CALLBACK_WINDOW` and the rest --
//! the device's handle, the message, the program's own doubleword and two
//! parameters:
//!
//! * No callback, or no kind, answers nought, as does a handle MMSYSTEM is
//!   closing for a task that ended (none is, here).
//! * Unless `DCB_NOSWITCH` (8) is among the flags, MMSYSTEM moves to a
//!   stack of its own for the call and back; winbox.js has no interrupt
//!   time to need one.
//! * A window (`DCB_WINDOW`, 1) is posted the message, the handle its
//!   wParam and the first parameter its lParam: `PostMessage`'s answer.
//! * A task (`DCB_TASK`, 2) is posted it the same way: `PostAppMessage`'s.
//! * A function (`DCB_FUNCTION`, 3), if the callback's selector is a code
//!   segment's, is called with the handle, the message, the program's
//!   doubleword and both parameters, and the answer is 1; else nought.
//! * Another kind answers nought.

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, GuestArg};
use crate::handles::Object;
use crate::system::System;

/// The handle MMSYSTEM keeps as the one it is closing for a task that
/// ended, whose callbacks it drops: `FFFFh` while it closes none.
const CLOSING: u16 = 0xffff;

/// A driver's callback made: what `DriverCallback` answers.
#[allow(clippy::too_many_arguments)]
pub async fn driver_callback(
    engine: &Engine,
    callback: u32,
    flags: u16,
    device: u16,
    message: u16,
    user: u32,
    first: u32,
    second: u32,
) -> Result<u16, Stop> {
    // No kind of callback answers nought as another kind does, below.
    if callback == 0 || device == CLOSING {
        return Ok(0);
    }

    match flags & 7 {
        1 | 2 => Ok(post_callback(
            &mut engine.system(),
            callback,
            flags,
            device,
            message,
            first,
        )),
        3 => {
            let code = engine
                .system()
                .peek_descriptor((callback >> 16) as u16)
                .is_some_and(|descriptor| descriptor.segment && descriptor.executable);

            if !code {
                return Ok(0);
            }

            let args = [
                GuestArg::Word(device),
                GuestArg::Word(message),
                GuestArg::Long(user),
                GuestArg::Long(first),
                GuestArg::Long(second),
            ];

            Box::pin(engine.call_with(callback, &args, &[])).await?;
            Ok(1)
        }
        _ => Ok(0),
    }
}

/// A callback to a window (`DCB_WINDOW`) or a task (`DCB_TASK`) made, as
/// `DriverCallback` makes it: posted, and what posting answered; nought for
/// another kind, or none.
pub fn post_callback(
    system: &mut System,
    callback: u32,
    flags: u16,
    device: u16,
    message: u16,
    first: u32,
) -> u16 {
    let low = callback as u16;

    if callback == 0 || device == CLOSING {
        return 0;
    }

    match flags & 7 {
        1 => u16::from(system.post_message(low, message, device, first)),
        2 => {
            if low == 0 || !matches!(system.handles.resolve(low), Some(Object::Task(_))) {
                return 0;
            }

            u16::from(system.post_message(0, message, device, first))
        }
        _ => 0,
    }
}

/// `DriverCallback` called by a driver from a file.
pub fn driver_callback_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (callback, flags, device, message, user, first, second) = {
            let system = engine.system();

            (
                args.dword(&system),
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Word(
            driver_callback(
                engine, callback, flags, device, message, user, first, second,
            )
            .await?,
        ))
    })
}

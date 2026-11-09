//! USER's network calls, as USER answers them with no network driver
//! installed: each goes to the network driver's function from the table
//! USER fills as Windows starts, and with none answers 1,
//! `WN_NOT_SUPPORTED` (`USER.EXE` seg22 `0770`-`0790`) -- `WNetGetCaps`
//! nought. `WNetErrorText` is USER's own, from its strings. **Recorded**
//! by `wnetall` and `netcaps`.
//!
//! Not followed: the checks most make of their arguments first, a pointer
//! by touching it and a window by its class's signature, which answer 4 or
//! 5 for one that fails.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

const WN_NOT_SUPPORTED: u16 = 1;

/// USER's string of network errors, the first: the format for one with no
/// string of its own.
const NETWORK_ERRORS: u16 = 0x113;

/// Where the code is put for `wsprintf` to read, in USER's data.
const SCRATCH: u16 = 0xfffe;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "WNetOpenJob"
        | "WNetCloseJob"
        | "WNetAbortJob"
        | "WNetHoldJob"
        | "WNetReleaseJob"
        | "WNetCancelJob"
        | "WNetSetJobCopies"
        | "WNetWatchQueue"
        | "WNetUnwatchQueue"
        | "WNetLockQueueData"
        | "WNetUnlockQueueData"
        | "WNetDeviceMode"
        | "WNetBrowseDialog"
        | "WNetGetUser"
        | "WNetAddConnection"
        | "WNetCancelConnection"
        | "WNetGetError"
        | "WNetGetErrorText"
        | "WNetEnable"
        | "WNetDisable"
        | "WNetRestoreConnection"
        | "WNetWriteJob"
        | "WNetConnectDialog"
        | "WNetDisconnectDialog"
        | "WNetConnectionDialog"
        | "WNetViewQueueDialog"
        | "WNetPropertyDialog"
        | "WNetGetDirectoryType"
        | "WNetDirectoryNotify"
        | "WNetGetPropertyText" => not_supported,
        "WNetErrorText" => wnet_error_text,
        _ => return None,
    }))
}

/// No network driver: `WN_NOT_SUPPORTED`.
fn not_supported(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(WN_NOT_SUPPORTED))
}

/// A network error's text (`USER.EXE` seg22 `005c`-`00e1`): for
/// `WN_NET_ERROR`, the driver's own, which with none there is not; else
/// USER's string 113h plus the code, as `LoadString` copies it; where there
/// is none, string 113h filled with the code by `wsprintf`, however small
/// the buffer. The answer is the length.
fn wnet_error_text(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let code = args.word(system);
    let buffer = args.dword(system);
    let size = args.signed(system);
    // `WN_NET_ERROR`, 2, asks the driver first, which is not there.
    let copied = match crate::user_misc::user_string(NETWORK_ERRORS.wrapping_add(code)) {
        Some(text) if size > 0 => system.copy_text(text.as_bytes(), buffer, size as usize),
        _ => 0,
    };

    // `LoadString`'s answer: what it copied, nought sending on.
    if copied != 0 {
        return Ok(Answer::Word(copied as u16));
    }

    let format = crate::user_misc::user_string(NETWORK_ERRORS).unwrap_or("");
    let data = system
        .kept_named("USER")
        .map_or(0, |kept| segment_selector(system.kept[kept].data));
    let scratch = u32::from(data) << 16 | u32::from(SCRATCH);

    system.write_far(scratch, &code.to_le_bytes());

    let text = crate::user::format_values(system, format.as_bytes(), scratch);
    let mut bytes = text.clone();

    bytes.push(0);
    system.write_far(buffer, &bytes);
    Ok(Answer::Word(text.len() as u16))
}

//! USER's exports for Windows' own components that WinBox answers as a
//! program calling them sees Windows answer. **Read out** of `USER.EXE`;
//! as `src/win16/user/internals.ts`, which says more of each, and
//! `kb/topics/user-internals.md`, the map of them all.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::index_for;

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

/// `UserSeeUserDo`'s requests (seg41 `1827`-`1837`).
const USUD_LOCALALLOC: u16 = 1;
const USUD_LOCALFREE: u16 = 2;
const USUD_LOCALCOMPACT: u16 = 3;
const USUD_LOCALHEAP: u16 = 4;
const USUD_FIRSTCLASS: u16 = 5;

/// Two of USER's words `UserSeeUserDo` answers: 1C4h and F2h of its data.
const LOCALHEAP_AT: u16 = 0x1c4;
const FIRSTCLASS_AT: u16 = 0xf2;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "UserSeeUserDo" => Implementation::Sync(user_see_user_do),
        "Hardware_Event" => Implementation::Sync(|_, _| Ok(Answer::Word(0))),
        "FinalUserInit" => Implementation::Sync(|_, _| Ok(Answer::Nothing)),
        "GetFilePortName" => Implementation::Async(crate::print_to_file::get_file_port_name),
        "DragObject" => Implementation::Async(crate::drag_object::drag_object),
        // The procedure of USER's class `#32768`, the menus' windows
        // (`userproc`): WinBox's windows of that class have `DefWindowProc`.
        "Bear306" => Implementation::Async(crate::window_queries::def_window_proc),
        "DisableOEMLayer" => Implementation::Sync(disable_oem_layer),
        "EnableOEMLayer" => Implementation::Sync(enable_oem_layer),
        _ => return None,
    })
}

/// Ordinal 216 (`USER.EXE` seg41 `181e`): a request on USER's own data
/// segment -- `LocalAlloc`, `LocalFree`, `LocalCompact`, or one of two of
/// its words -- answered as a word in DX:AX; -1 for another request.
/// **Recorded** by `strfunc`.
fn user_see_user_do(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let request = args.word(system);
    let word = args.word(system);
    let low = args.dword(system) as u16;
    let user = system.user_data_selector();
    let index = index_for(user);
    let read = |system: &System, at: u16| {
        let bytes = system.read_far(u32::from(user) << 16 | u32::from(at), 2);

        u16::from_le_bytes([bytes[0], bytes[1]])
    };

    let answer = match request {
        USUD_LOCALALLOC => match system.heaps.get_mut(&index) {
            Some(heap) => heap.local_alloc(&mut system.cpu.bus, word, low),
            None => 0,
        },
        USUD_LOCALFREE => match system.heaps.get_mut(&index) {
            Some(heap) => heap.local_free(&mut system.cpu.bus, word),
            None => word,
        },
        USUD_LOCALCOMPACT => match system.heaps.get(&index) {
            Some(heap) => heap.local_compact(&mut system.cpu.bus, low),
            None => 0,
        },
        USUD_LOCALHEAP if user != 0 => read(system, LOCALHEAP_AT),
        USUD_FIRSTCLASS if user != 0 => read(system, FIRSTCLASS_AT),
        USUD_LOCALHEAP | USUD_FIRSTCLASS => 0,
        _ => return Ok(Answer::Dword(0xffff_ffff)),
    };

    Ok(Answer::Dword(u32::from(answer)))
}

/// Ordinal 4, `DisableOEMLayer` (`USER.EXE` seg5 `01a2`): the screen and
/// the input given up for a DOS program that runs full screen. WinBox's
/// drivers are its own and its display is not turned off: the cursor is
/// hidden and the system queue emptied (seg5 `0143`-`0160`), which is what
/// a program finds. **Recorded** by `oemlayer`.
fn disable_oem_layer(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.cursor_count -= 1;
    system.input.clear();
    Ok(Answer::Nothing)
}

/// Ordinal 3, `EnableOEMLayer` (`USER.EXE` seg5 `0165`): the key state
/// tables cleared (seg5 `000a`-`0040`), the whole screen redrawn -- frames,
/// backgrounds and clients, `RedrawWindow`'s body for the desktop with
/// `RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_FRAME` -- and the
/// cursor shown again. **Recorded** by `oemlayer`.
fn enable_oem_layer(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.user_state.key_states = [0; 256];
    system.user_state.async_keys = [0; 256];
    system.repaint_all_frames(true);
    system.cursor_count += 1;
    Ok(Answer::Nothing)
}

//! USER's resource handlers for icons and cursors, and `SignalProc`, which
//! sets them on each module KERNEL loads. **Read out of `USER.EXE`** and
//! **recorded** by `iconhand` and `userproc`. The twin of
//! `src/win16/user/icon-handlers.ts`, which says more.

// Each export has the signature every function that answers a call has.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::index_for;

use crate::call::{Answer, Args, Stop};
use crate::engine::Engine;
use crate::icon_convert::{Converted, DisplayFormat, IconMetrics, convert_dib, convert_old};
use crate::system::System;

pub const RT_CURSOR: u16 = 1;
pub const RT_ICON: u16 = 3;
/// A group's type is its member's and this (seg12 `03b2`).
const GROUP: u16 = 11;

/// Signal 40h: a module loaded (seg1 `09d1`).
const SIGNAL_LOADED: u16 = 0x40;
/// The first version whose icons and cursors are device-independent bitmaps.
pub const WINDOWS_3: u16 = 0x300;
/// `GlobalReAlloc`'s flags that leave a block discarded (seg12 `0e3c`).
const DISCARD: u16 = 0x0002;
/// The largest resource `LoadCursorIconHandler` takes (`0e06`).
const OLD_LIMIT: u32 = 0x10000;

const SM_CXICON: u16 = 11;
const SM_CYICON: u16 = 12;
const SM_CXCURSOR: u16 = 13;
const SM_CYCURSOR: u16 = 14;

const LOAD_CURSOR_ICON: &str = "LoadCursorIconHandler";
const LOAD_DIB_CURSOR: &str = "LoadDibCursorHandler";
const LOAD_DIB_ICON: &str = "LoadDibIconHandler";

/// USER's export of a name: its far address.
fn user_proc(system: &mut System, name: &str) -> u32 {
    let user = crate::kernel::module_handle_named(system, "USER");

    if user == 0 {
        return 0;
    }

    crate::modules_kernel::proc_named(system, user, name)
}

/// The handlers USER sets for a module of a version (seg1 `0a09`-`0a4b`):
/// for `RT_CURSOR` and `RT_ICON`, its far address each.
pub(crate) fn user_handlers(system: &mut System, version: u16) -> [(u16, u32); 2] {
    let modern = version >= WINDOWS_3;

    [
        (
            RT_CURSOR,
            user_proc(
                system,
                if modern {
                    LOAD_DIB_CURSOR
                } else {
                    LOAD_CURSOR_ICON
                },
            ),
        ),
        (
            RT_ICON,
            user_proc(
                system,
                if modern {
                    LOAD_DIB_ICON
                } else {
                    LOAD_CURSOR_ICON
                },
            ),
        ),
    ]
}

/// Which of USER's handlers a far address is, if one.
fn user_handler_at(system: &mut System, address: u32) -> Option<&'static str> {
    [LOAD_DIB_ICON, LOAD_DIB_CURSOR, LOAD_CURSOR_ICON]
        .into_iter()
        .find(|name| user_proc(system, name) == address)
}

/// The sizes USER makes icons and cursors.
fn metrics(system: &mut System) -> IconMetrics {
    let mut metric =
        |index: u16| match crate::user::get_system_metrics(system, &mut Args::repeat(index)) {
            Ok(Answer::Word(value)) => value,
            _ => 0,
        };

    IconMetrics {
        cx_icon: metric(SM_CXICON),
        cy_icon: metric(SM_CYICON),
        cx_cursor: metric(SM_CXCURSOR),
        cy_cursor: metric(SM_CYCURSOR),
    }
}

/// A block left discarded, as USER leaves one it fails.
fn discard(system: &mut System, handle: u16) {
    if handle != 0 {
        crate::memory::reallocate(system, handle, 0, DISCARD);
    }
}

/// A block converted in place: read as far as it is allocated, made USER's,
/// made the size the conversion gives it, and written; whether it was.
fn convert_block(
    system: &mut System,
    handle: u16,
    convert: impl FnOnce(&mut System, &[u8]) -> Option<Converted>,
) -> bool {
    let far = system.global_pointer(handle);

    if far == 0 {
        return false;
    }

    let index = index_for(handle);
    let bytes = system.read_far(far, system.global.size_of(index) as usize);
    let Some(converted) = convert(system, &bytes) else {
        return false;
    };

    if system.global.size_of(index) != converted.size as u32 {
        system.global.resize(
            &mut system.cpu.bus,
            &mut system.descriptors,
            index,
            converted.size as u32,
        );
    }

    let far = system.global_pointer(handle);

    system.write_far(far, &converted.bytes);
    system.icon_blocks.insert(handle);
    true
}

/// A device-independent icon or cursor made USER's in a block.
fn dib(system: &mut System, bytes: &[u8], size: usize, icon: bool) -> Option<Converted> {
    let metrics = metrics(system);
    let (planes, bits) = system.icon_format();
    let mut palette = system.palette();

    convert_dib(
        bytes,
        size,
        icon,
        metrics,
        &mut DisplayFormat {
            planes,
            bits,
            palette: &mut palette,
        },
    )
}

/// `LoadDIBIconHandler` and `LoadDIBCursorHandler` (seg12 `100d`, `0ff1`,
/// both `10ce`), as `icon-handlers.ts`'s `dibHandler`.
fn dib_handler(system: &mut System, icon: bool, block: u16, resource: u16) -> u16 {
    let size = system.resource_size(resource) as usize & 0xffff;
    let handle = crate::resources::kernel_handler(system, block, resource);

    if handle == 0 {
        discard(system, block);
        return 0;
    }

    if !convert_block(system, handle, |system, bytes| {
        dib(system, bytes, size, icon)
    }) {
        discard(system, handle);
        return 0;
    }

    handle
}

/// `LoadCursorIconHandler` (seg12 `0deb`-`0e49`), as `icon-handlers.ts`'s.
fn old_handler(system: &mut System, block: u16, resource: u16) -> u16 {
    let size = system.resource_size(resource);

    if size >= OLD_LIMIT {
        return 0;
    }

    let handle = crate::resources::kernel_handler(system, block, resource);

    if handle == 0 {
        discard(system, block);
        return 0;
    }

    if !convert_block(system, handle, |system, bytes| {
        let metrics = metrics(system);

        Some(convert_old(bytes, size as usize, metrics))
    }) {
        discard(system, handle);
        return 0;
    }

    handle
}

/// USER's handler at a far address called as KERNEL calls one: WinBox's
/// own code, called directly. `None` for any other address.
pub(crate) fn call_user_handler(
    system: &mut System,
    address: u32,
    block: u16,
    _module: u16,
    resource: u16,
) -> Option<u16> {
    Some(match user_handler_at(system, address)? {
        LOAD_DIB_ICON => dib_handler(system, true, block, resource),
        LOAD_DIB_CURSOR => dib_handler(system, false, block, resource),
        _ => old_handler(system, block, resource),
    })
}

pub fn load_dib_icon_handler(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let block = args.word(system);
    let _module = args.word(system);
    let resource = args.word(system);

    Ok(Answer::Word(dib_handler(system, true, block, resource)))
}

pub fn load_dib_cursor_handler(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let block = args.word(system);
    let _module = args.word(system);
    let resource = args.word(system);

    Ok(Answer::Word(dib_handler(system, false, block, resource)))
}

pub fn load_cursor_icon_handler(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let block = args.word(system);
    let _module = args.word(system);
    let resource = args.word(system);

    Ok(Answer::Word(old_handler(system, block, resource)))
}

/// `LoadIconHandler` (seg12 `0328`-`0371`), as `icon-handlers.ts`'s.
pub fn load_icon_handler(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let block = args.word(system);
    let new_format = args.word(system);
    let size = system.global.size_of(index_for(block)) as usize & 0xffff;
    let done = convert_block(system, block, |system, bytes| {
        if new_format != 0 {
            dib(system, bytes, size, true)
        } else {
            let metrics = metrics(system);

            Some(convert_old(bytes, size, metrics))
        }
    });

    Ok(Answer::Word(if done { block } else { 0 }))
}

/// `SignalProc` (`USER.EXE` seg1 `09bc`-`0a5c`), as `icon-handlers.ts`'s:
/// signal 40h sets a module's handlers for its icons and cursors to USER's;
/// nought answered.
pub fn signal_proc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let signal = args.word(system);
    let _word = args.word(system);
    let _dword = args.dword(system);

    if signal == SIGNAL_LOADED {
        let version = system.expected_windows_version(handle).unwrap_or(0);

        for (kind, address) in user_handlers(system, version) {
            crate::resources::set_typed_handler(system, handle, kind, address);
        }
    }

    Ok(Answer::Word(0))
}

/// A module's icon or cursor as `LoadIcon` and `LoadCursor` load one
/// (`USER.EXE` seg12 `05b9`-`05ea`, `0374`-`0409`), as `icon-handlers.ts`'s
/// `loadFromModule`: the group's member that fits the display for a module
/// of Windows 3 or later, else the resource of the name; loaded, and made
/// at once where its handler is USER's own. Nought for none.
pub(crate) async fn load_from_module(
    engine: &Engine,
    instance: u16,
    name: Result<u16, String>,
    kind: u16,
) -> Result<u16, Stop> {
    let Some(version) = engine.system().resource_version(instance) else {
        return Ok(0);
    };
    let resource = if version >= WINDOWS_3 {
        let group =
            crate::resources::find_typed(&mut engine.system(), instance, &name, kind + GROUP);
        let directory = if group == 0 {
            0
        } else {
            crate::resources::load(engine, instance, group).await?
        };
        let id = if directory == 0 {
            0
        } else {
            crate::cursor_make::icon_id(&mut engine.system(), directory, u32::from(kind))?
        };

        if id == 0 {
            0
        } else {
            crate::resources::find_typed(&mut engine.system(), instance, &Ok(id), kind)
        }
    } else {
        crate::resources::find_typed(&mut engine.system(), instance, &name, kind)
    };

    if resource == 0 {
        return Ok(0);
    }

    let handle = crate::resources::load(engine, instance, resource).await?;
    let own = {
        let mut system = engine.system();
        let handler = system.type_handler(resource);

        handle != 0 && user_handler_at(&mut system, handler).is_some()
    };

    if own && crate::resources::lock_block(engine, handle).await? != 0 {
        crate::memory::global_unlock(&mut engine.system(), &mut Args::repeat(handle))?;
    }

    Ok(handle)
}

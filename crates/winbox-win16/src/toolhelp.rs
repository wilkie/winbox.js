//! The tool helper library, `TOOLHELP.DLL`, as winbox.js keeps it beside
//! KERNEL: Windows' own file walks KERNEL's private structures, which
//! winbox.js's KERNEL does not have. Object Packager imports
//! `NotifyRegister` and `NotifyUnRegister`, and Dr. Watson
//! `InterruptRegister`.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "GlobalHandleToSel" => global_handle_to_sel,
        "SystemHeapInfo" => system_heap_info,
        "NotifyRegister" => notify_register,
        "NotifyUnRegister" => notify_unregister,
        "InterruptRegister" => interrupt_register,
        "InterruptUnRegister" => interrupt_unregister,
        _ => return None,
    }))
}

/// A global handle's selector: the handle with its lowest bit set, which
/// makes a moveable block's handle the selector `GlobalLock` gives, leaves a
/// fixed block's as it is, and makes nought 1 (`sysheap`).
fn global_handle_to_sel(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Word(handle | 1))
}

/// How full USER's and GDI's heaps are, and their data segments.
/// **Recorded** by `sysheap`: with the structure's size, 12, in `dwSize` it
/// answers `TRUE`, the percentages `GetFreeSystemResources` gives for USER
/// and for GDI, and the two modules' data segments' selectors; with another
/// size, `FALSE` and nothing written.
fn system_heap_info(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    if far == 0 {
        return Ok(Answer::Word(0));
    }

    let size = system.read_far(far, 4);

    if size != [12, 0, 0, 0] {
        return Ok(Answer::Word(0));
    }

    let mut percent = |resource: u16| match crate::user_misc::get_free_system_resources(
        system,
        &mut Args::repeat(resource),
    ) {
        Ok(Answer::Word(word)) => word,
        _ => 0,
    };
    let (user, gdi) = (percent(2), percent(1));
    let data = |name: &str| {
        system
            .kept_named(name)
            .map_or(0, |kept| segment_selector(system.kept[kept].data))
    };
    let bytes: Vec<u8> = [user, gdi, data("USER"), data("GDI")]
        .iter()
        .flat_map(|word| word.to_le_bytes())
        .collect();

    system.write_far(far.wrapping_add(4), &bytes);
    Ok(Answer::Word(1))
}

/// A procedure registered to be told of what happens in the system,
/// kept and answered TRUE; nothing is told yet (documented).
fn notify_register(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let task = args.word(system);
    let proc = args.dword(system);
    let flags = args.word(system);

    system.notifications.retain(|(each, _, _)| *each != task);
    system.notifications.push((task, proc, flags));
    Ok(Answer::Word(1))
}

/// A task's notification procedure taken away: whether it had one.
fn notify_unregister(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let task = args.word(system);
    let before = system.notifications.len();

    system.notifications.retain(|(each, _, _)| *each != task);
    Ok(Answer::Word(u16::from(
        system.notifications.len() != before,
    )))
}

/// A procedure registered to be called on a fault or an interrupt a task
/// takes, kept and answered TRUE; no fault is passed to it yet.
fn interrupt_register(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let task = args.word(system);
    let proc = args.dword(system);

    system.interrupt_handlers.retain(|(each, _)| *each != task);
    system.interrupt_handlers.push((task, proc));
    Ok(Answer::Word(1))
}

/// A task's interrupt procedure taken away: whether it had one.
fn interrupt_unregister(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let task = args.word(system);
    let before = system.interrupt_handlers.len();

    system.interrupt_handlers.retain(|(each, _)| *each != task);
    Ok(Answer::Word(u16::from(
        system.interrupt_handlers.len() != before,
    )))
}

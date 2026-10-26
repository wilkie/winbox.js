//! The tool helper library, `TOOLHELP.DLL`, as winbox.js keeps it beside
//! KERNEL: Windows' own file walks KERNEL's private structures, which
//! winbox.js's KERNEL does not have, so it answers from winbox.js's own
//! tasks, modules, heaps and classes in the shapes Windows' structures give
//! (`toolhelp/`). Object Packager imports `NotifyRegister` and
//! `NotifyUnRegister`, and Dr. Watson `InterruptRegister`.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

pub(crate) mod classes;
pub(crate) mod global;
pub(crate) mod local;
pub(crate) mod memory;
pub(crate) mod misc;
pub(crate) mod modules;
pub(crate) mod stack;
pub(crate) mod structures;
pub(crate) mod tasks;

use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

pub fn implementation(name: &str) -> Option<Implementation> {
    if name == "TerminateApp" {
        return Some(Implementation::Async(misc::terminate_app));
    }

    if name == "TaskSwitch" {
        return Some(Implementation::Async(tasks::task_switch));
    }

    Some(Implementation::Sync(match name {
        "GlobalHandleToSel" => global_handle_to_sel,
        "SystemHeapInfo" => system_heap_info,
        "NotifyRegister" => notify_register,
        "NotifyUnRegister" => notify_unregister,
        "InterruptRegister" => interrupt_register,
        "InterruptUnRegister" => interrupt_unregister,
        "WEP" => misc::wep,
        "GlobalFirst" => global::global_first,
        "GlobalNext" => global::global_next,
        "GlobalInfo" => global::global_info,
        "GlobalEntryHandle" => global::global_entry_handle,
        "GlobalEntryModule" => global::global_entry_module,
        "LocalInfo" => local::local_info,
        "LocalFirst" => local::local_first,
        "LocalNext" => local::local_next,
        "ModuleFirst" => modules::module_first,
        "ModuleNext" => modules::module_next,
        "ModuleFindName" => modules::module_find_name,
        "ModuleFindHandle" => modules::module_find_handle,
        "TaskFirst" => tasks::task_first,
        "TaskNext" => tasks::task_next,
        "TaskFindHandle" => tasks::task_find_handle,
        "TaskGetCSIP" => tasks::task_get_csip,
        "TaskSetCSIP" => tasks::task_set_csip,
        "StackTraceFirst" => stack::stack_trace_first,
        "StackTraceCSIPFirst" => stack::stack_trace_csip_first,
        "StackTraceNext" => stack::stack_trace_next,
        "ClassFirst" => classes::class_first,
        "ClassNext" => classes::class_next,
        "MemManInfo" => misc::mem_man_info,
        "MemoryRead" => memory::memory_read,
        "MemoryWrite" => memory::memory_write,
        "TimerCount" => misc::timer_count,
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

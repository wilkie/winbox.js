//! KERNEL's small calls about tasks and modules, from KERNEL's list of
//! tasks (`task_order.rs`) and the modules' chain (`toolhelp/modules.rs`).
//! As `kernel/task-calls.ts` and `kernel/module-calls.ts`.

use winbox_cpu::{DS, DX, ES};
use winbox_machine::index_for;

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::handles::Object;
use crate::system::System;
use crate::toolhelp::global::global_blocks;
use crate::toolhelp::modules::module_chain;

/// A task handle, nought for the running task (`KRNL386.EXE` seg1
/// `7d7c`-`7d91`).
fn task_or_current(system: &System, task: u16) -> u16 {
    if task == 0 {
        system.current_task().unwrap_or(0)
    } else {
        task
    }
}

/// The running task's handle, and in DX the first task in KERNEL's list
/// (`KRNL386.EXE` seg1 `842c`-`843c`). **Recorded** by `minis` and `ktask`.
pub fn get_current_task(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let head = system.task_list().first().copied().unwrap_or(0);

    system.cpu.regs[DX] = head;
    Ok(Answer::Word(system.task_handle))
}

/// The handle given, where it names a task, else nought (seg1 `7e50`-
/// `7e74`). **Recorded** by `ktask`.
pub fn is_task(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let task = args.word(system);

    Ok(Answer::Word(if system.live_task(task) { task } else { 0 }))
}

/// A task's queue (TDB 20h, seg1 `7d9d`). **Recorded** by `ktask`.
pub fn get_task_queue(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let task = args.word(system);
    let task = task_or_current(system, task);

    Ok(Answer::Word(system.task_queue(task)))
}

/// A task given a queue, the one it had answered (seg1 `7de3`).
pub fn set_task_queue(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let task = args.word(system);
    let queue = args.word(system);
    let task = task_or_current(system, task);
    let old = system.task_queue(task);

    if let Some(record) = system.task_record(task) {
        record.queue = queue;
    }

    Ok(Answer::Word(old))
}

/// An event for a task, TDB 6 counted up, the task's handle answered
/// (seg1 `7d92`-`7d9a`). **Recorded** by `ktask`.
pub fn post_event(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let task = args.word(system);
    let task = task_or_current(system, task);

    if let Some(record) = system.task_record(task) {
        record.events = record.events.wrapping_add(1);

        // A task waiting in `WaitEvent` for it woken.
        let waiters = &mut system.kernel_calls.event_waiters;
        let woken: Vec<usize> = waiters
            .iter()
            .filter(|&&(on, _)| on == task)
            .map(|&(_, slot)| slot)
            .collect();

        waiters.retain(|&(on, _)| on != task);

        for slot in woken {
            if slot < system.scheduler.slots.len() {
                system.signal_slot(slot);
            }
        }
    }

    Ok(Answer::Word(task))
}

/// A task's event taken (seg1 `7ca8`-`7cfc`): nought where it has one,
/// else the processor given up until `PostEvent` gives it one, then `FFh`.
/// As `task-calls.ts`.
pub fn wait_event(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let task = {
            let system = engine.system();
            let task = args.word(&system);

            task_or_current(&system, task)
        };
        let mut answer = 0;

        loop {
            {
                let mut system = engine.system();
                let slot = system.current_slot();
                let Some(record) = system.task_record(task) else {
                    return Ok(Answer::Word(0));
                };

                if record.events > 0 {
                    record.events -= 1;
                    return Ok(Answer::Word(answer));
                }

                record.events = 0;

                if let Some(slot) = slot {
                    system.kernel_calls.event_waiters.push((task, slot));
                }
            }

            engine.wait_for_wake(None).await;
            answer = 0xff;
        }
    })
}

/// A task's priority moved, the new priority answered (seg1 `7df0`-
/// `7e3b`; `change_priority`). **Recorded** by `ktask`.
pub fn set_priority(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let task = args.word(system);
    let delta = args.word(system) as u8 as i8;
    let task = task_or_current(system, task);

    if !system.live_task(task) {
        return Ok(Answer::Word(0));
    }

    Ok(Answer::Word(
        i16::from(system.change_priority(task, delta)) as u16
    ))
}

/// The running task's prefix (TDB 60h, seg3 `024e`-`025e`). **Recorded**
/// by `ktask`.
pub fn get_current_pdb(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(system.task.as_ref().map_or(0, |task| {
        winbox_machine::segment_selector(task.program_segment)
    })))
}

/// The running task's instance in AX and DX (seg1 `119f`-`11af`).
pub fn get_task_ds(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let instance = system
        .current_task()
        .map_or(0, |task| system.task_instance(task));

    Ok(Answer::Dword(
        u32::from(instance) << 16 | u32::from(instance),
    ))
}

/// DS made the running task's queue (seg1 `7da7`-`7db4`), AX and DX left.
pub fn get_task_queue_ds(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let task = system.current_task().unwrap_or(0);
    let queue = system.task_queue(task);

    system
        .cpu
        .load_segment(DS, queue)
        .map_err(Stop::Processor)?;
    Ok(Answer::Nothing)
}

/// ES made the running task's queue (seg1 `7db5`-`7dc4`).
pub fn get_task_queue_es(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let task = system.current_task().unwrap_or(0);
    let queue = system.task_queue(task);

    system
        .cpu
        .load_segment(ES, queue)
        .map_err(Stop::Processor)?;
    Ok(Answer::Nothing)
}

/// The Windows version the running task's module was made for (TDB 1Ah,
/// seg3 `07d9`-`07e5`). **Recorded** by `ktask`.
pub fn get_exe_version(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let instance = system
        .current_task()
        .map_or(0, |task| system.task_instance(task));

    Ok(Answer::Word(
        system.expected_windows_version(instance).unwrap_or(0),
    ))
}

/// The compatibility flags `WIN.INI` gives a module, as KERNEL reads them
/// (`KRNL386.EXE` seg2 `2a38`-`2ab6`): see `compatibilityFlags`.
pub(crate) fn compatibility_flags(version: u16, name: &str, text: &[u8]) -> u32 {
    if version >= 0x30a {
        return 0;
    }

    let _ = name;
    let text = &text[..text.len().min(11)];

    if text.len() < 2 || text[0] != b'0' || text[1] & 0xdf != b'X' {
        return 0;
    }

    let mut flags = 0u32;

    for &byte in &text[2..] {
        let Some(mut digit) = byte.checked_sub(0x30) else {
            break;
        };

        if digit > 9 {
            digit = digit.wrapping_add(0xf9);
        }

        flags = flags << 4 | u32::from(digit & 0xf);
    }

    flags
}

/// A task's compatibility flags (TDB 4Eh, seg1 `9eeb`-`9f0e`), read the
/// first time they are asked for. **Recorded** by `ktask`.
pub fn get_app_compat_flags(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let task = args.word(system);
    let task = task_or_current(system, task);

    if !system.live_task(task) {
        return Ok(Answer::Dword(0));
    }

    if let Some(flags) = system
        .task_record(task)
        .and_then(|record| record.compatibility)
    {
        return Ok(Answer::Dword(flags));
    }

    let instance = system.task_instance(task);
    let version = system.expected_windows_version(instance).unwrap_or(0);
    let name = system
        .slot_of(task)
        .map(|slot| {
            system.modules[system.scheduler.slots[slot].program]
                .name
                .clone()
        })
        .unwrap_or_default();
    let key: String = name.chars().take(8).collect();
    let text = if version < 0x30a {
        system
            .read_profile(b"WIN.INI")
            .get(b"Compatibility", key.as_bytes(), true)
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let flags = compatibility_flags(version, &name, &text);

    if let Some(record) = system.task_record(task) {
        record.compatibility = Some(flags);
    }

    Ok(Answer::Dword(flags))
}

/// The module a handle is of (`KRNL386.EXE` seg1 `4e78`-`4eff`); see
/// `GetExePtr`. **Recorded** by `ktask`.
pub(crate) fn exe_ptr(system: &mut System, handle: u16) -> u16 {
    if handle == 0 {
        return 0;
    }

    let chain = module_chain(system);

    // A module's own handle, odd, its database's (`4e7f`-`4e8d`): any
    // module's, of the chain or loaded from a file. Two programs' modules
    // may have one name -- Lode Runner's `SETUP.EXE` and `_SETUP.EXE` are
    // both `SETUP` -- and the chain, found by names, holds one of them; the
    // TypeScript engine keeps only the last of a name.
    if handle & 1 != 0
        && (chain.iter().any(|module| module.handle == handle)
            || system.modules.iter().any(|module| module.handle == handle))
    {
        return handle;
    }

    for task in system.task_list() {
        if system.task_instance(task) == handle {
            return module_of_task(system, task);
        }
    }

    let index = index_for(handle);
    let Some(block) = global_blocks(system)
        .into_iter()
        .find(|block| block.index != 0 && block.index == index)
    else {
        return 0;
    };

    if chain.iter().any(|module| module.handle == block.owner) {
        return block.owner;
    }

    if system.live_task(block.owner) {
        module_of_task(system, block.owner)
    } else {
        0
    }
}

/// A task's module's handle.
pub(crate) fn module_of_task(system: &System, task: u16) -> u16 {
    system.slot_of(task).map_or(0, |slot| {
        system.modules[system.scheduler.slots[slot].program].handle
    })
}

/// `GetExePtr`.
pub fn get_exe_ptr(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Word(exe_ptr(system, handle)))
}

/// Whether a selector is a library's: bit 15 of its module's flags (seg1
/// `4d39`-`4d59`). **Recorded** by `ktask`.
pub fn is_shared_selector(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);
    let module = exe_ptr(system, selector);

    if module == 0 {
        return Ok(Answer::Word(0));
    }

    Ok(Answer::Word(match system.handles.resolve_module(module) {
        Some(Object::Library(index) | Object::Task(index)) => {
            u16::from(system.modules[index].is_library())
        }
        // One of winbox.js's own: KERNEL, USER and GDI and the rest are
        // libraries.
        _ => 1,
    }))
}

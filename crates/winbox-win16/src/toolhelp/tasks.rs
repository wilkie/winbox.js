//! TOOLHELP's walk of the tasks (`TOOLHELP.DLL` seg1 `0caa`-`0f19`).

use super::structures::structure;
use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::kernel_calls::tasks::module_of_task;
use crate::system::System;

/// `TASKENTRY`'s size.
const TASKENTRY: u16 = 0x28;

/// The module's name as a task's database keeps it: eight bytes at most.
const NAME_LENGTH: usize = 8;

/// A task's module's name.
pub(crate) fn name_of_task(system: &System, task: u16) -> String {
    system.slot_of(task).map_or_else(String::new, |slot| {
        module_name(system, system.scheduler.slots[slot].program)
    })
}

/// A loaded module's name, as its resident names begin, upper case.
pub(crate) fn module_name(system: &System, module: usize) -> String {
    let module = &system.modules[module];

    module
        .executable
        .resident_names
        .first()
        .map_or(module.name.as_str(), |name| name.name.as_str())
        .to_ascii_uppercase()
}

/// A `TASKENTRY` filled for a task (seg1 `0e69`-`0f19`); false for a handle that is no task.
fn fill(system: &mut System, far: u32, handle: u16) -> bool {
    let Some(entry) = structure(system, far, TASKENTRY) else {
        return false;
    };

    if !system.live_task(handle) {
        return false;
    }

    let record = *system.task_record(handle).expect("a live task's record");
    let list = system.task_list();
    let next = list
        .iter()
        .position(|&each| each == handle)
        .and_then(|at| list.get(at + 1))
        .copied()
        .unwrap_or(0);
    let instance = system.task_instance(handle);
    let frame = system.frame_of(handle).unwrap_or_default();
    let ss = if frame.ss == 0 {
        instance.wrapping_add(1)
    } else {
        frame.ss
    };
    let queue = system.task_queue(handle);
    let prefix = system.prefix_of(handle);
    let module = module_of_task(system, handle);
    let name = name_of_task(system, handle);

    entry.write16(system, 0x26, next);
    entry.write16(system, 0x04, handle);
    entry.write16(system, 0x06, record.parent);
    entry.write16(system, 0x0c, ss);
    entry.write16(system, 0x0e, frame.sp);
    entry.write16(system, 0x16, record.events);
    entry.write16(system, 0x18, queue);
    entry.write16(system, 0x24, prefix);
    entry.write16(system, 0x08, instance);
    entry.write16(system, 0x0a, module);
    entry.write_string(system, 0x1a, name.as_bytes(), NAME_LENGTH);

    if system.peek_descriptor(ss).is_some() {
        let stack = u32::from(ss) << 16;
        let word = |system: &System, at: u32| {
            let bytes = system.read_far(stack | at, 2);

            u16::from_le_bytes([bytes[0], bytes[1]])
        };
        let (top, minimum, bottom) = (word(system, 0x0a), word(system, 0x0c), word(system, 0x0e));

        entry.write16(system, 0x10, top);
        entry.write16(system, 0x12, minimum);
        entry.write16(system, 0x14, bottom);
    }

    true
}

/// The first task in KERNEL's list (seg1 `0caa`).
pub fn task_first(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let first = system.task_list().first().copied().unwrap_or(0);

    Ok(Answer::Word(u16::from(fill(system, far, first))))
}

/// The task after the one filled in (seg1 `0ced`).
pub fn task_next(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let next = structure(system, far, TASKENTRY).map_or(0, |entry| entry.read16(system, 0x26));

    Ok(Answer::Word(u16::from(
        next != 0 && fill(system, far, next),
    )))
}

/// A task's entry by its handle (seg1 `0d2e`).
pub fn task_find_handle(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let task = args.word(system);

    Ok(Answer::Word(u16::from(fill(system, far, task))))
}

/// Where a task will go on from when it next runs: nought for the running
/// task (seg1 `0d97`-`0dbd`); here, where it gave the processor up.
/// **Recorded** by `thtask`.
pub fn task_get_csip(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let task = args.word(system);

    if !system.live_task(task) || system.current_task() == Some(task) {
        return Ok(Answer::Dword(0));
    }

    Ok(Answer::Dword(system.frame_of(task).map_or(0, |frame| {
        u32::from(frame.cs) << 16 | u32::from(frame.ip)
    })))
}

/// Where a task will go on from changed (seg1 `0d68`-`0d94`): nought for the
/// running task; else the old place, IP in AX and CS in DX. **Recorded** by
/// `thswch`.
pub fn task_set_csip(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let task = args.word(system);
    let cs = args.word(system);
    let ip = args.word(system);

    Ok(Answer::Dword(set_csip(system, task, cs, ip)))
}

fn set_csip(system: &mut System, task: u16, cs: u16, ip: u16) -> u32 {
    if !system.live_task(task) || system.current_task() == Some(task) {
        return 0;
    }

    let Some(slot) = system.slot_of(task) else {
        return 0;
    };

    // The code segment as the processor would load it, the running task's
    // own put back.
    let kept = system.cpu.segments[winbox_cpu::CS];
    let loaded = system.cpu.load_segment(winbox_cpu::CS, cs);
    let segment = system.cpu.segments[winbox_cpu::CS];

    system.cpu.segments[winbox_cpu::CS] = kept;

    let Some(context) = system.scheduler.slots[slot].saved.as_mut() else {
        return 0;
    };
    let frame = context.frame();

    if loaded.is_ok() {
        context.set_code(segment, ip);
    }

    u32::from(frame.cs) << 16 | u32::from(frame.ip)
}

/// A task sent somewhere else and run there at once (seg1 `0dc0`-`0e62`): one,
/// or nought for the running task or one that is no task. **Recorded** by
/// `thswch`.
pub fn task_switch(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let task = {
            let mut system = engine.system();
            let task = args.word(&system);
            let place = args.dword(&system);

            if !system.live_task(task) || system.current_task() == Some(task) {
                return Ok(Answer::Word(0));
            }

            set_csip(&mut system, task, (place >> 16) as u16, place as u16);
            task
        };

        engine.yield_turn(Some(task)).await?;
        Ok(Answer::Word(1))
    })
}

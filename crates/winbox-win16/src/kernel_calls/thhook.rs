//! KERNEL's variables that `THHOOK` points a reader at, and the global
//! heap's own block that `GlobalMasterHandle` answers. **Recorded** by
//! `kgaps`.

use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Stop};
use crate::system::System;

/// Where `THHOOK` points, in KERNEL's data (`KRNL386.EXE` seg4 `0218`).
pub const THHOOK_OFFSET: u16 = 0x218;

const HEAP_HANDLE: u16 = 0x218;
const HEAP_SELECTOR: u16 = 0x21a;
const FIRST_MODULE: u16 = 0x21c;
const KERNEL_PDB: u16 = 0x220;
const FIRST_PDB: u16 = 0x222;
const FIRST_TASK: u16 = 0x226;
const RUNNING_TASK: u16 = 0x228;
const TASK_MADE: u16 = 0x22a;

/// The global heap's own block: the words of it KERNEL's code touches run
/// to 44h (seg1 `2bbe`-`2bcb`, `97fd`-`9802`).
const MASTER_SIZE: u32 = 0x46;

/// The global heap's own block, made the first time it is asked for:
/// fixed, its handle its selector.
pub(crate) fn master_block(system: &mut System) -> u16 {
    if let Some(selector) = system.kernel_calls.master_block {
        return selector;
    }

    let selector = system
        .global
        .allocate(&mut system.cpu.bus, &mut system.descriptors, MASTER_SIZE, 0)
        .map_or(0, segment_selector);

    system.kernel_calls.master_block = Some(selector);
    selector
}

/// `GlobalMasterHandle` (seg1 `1190`-`119e`): the block's selector in AX
/// and DX.
pub fn global_master_handle(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let selector = master_block(system);

    Ok(Answer::Dword(
        u32::from(selector) << 16 | u32::from(selector),
    ))
}

/// The newest live task's prefix, the head of KERNEL's chain of them.
fn newest_pdb(system: &System) -> u16 {
    let Some(slot) = system.scheduler.slots.iter().rposition(|slot| !slot.ended) else {
        return 0;
    };

    if system.scheduler.current == Some(slot) {
        return system
            .task
            .as_ref()
            .map_or(0, |task| segment_selector(task.program_segment));
    }

    system.scheduler.slots[slot]
        .saved
        .as_ref()
        .and_then(|context| context.task.as_ref())
        .map_or(0, |task| segment_selector(task.program_segment))
}

impl System {
    /// KERNEL's words at 218h-22Bh written as they stand, once `THHOOK`'s
    /// address has been handed out: written then, and again as each call
    /// returns, since a task switches only inside a call.
    pub(crate) fn refresh_thhook(&mut self) {
        let Some(kernel) = self.kept_named("KERNEL") else {
            return;
        };
        let data = u32::from(segment_selector(self.kept[kernel].data)) << 16;
        let master = master_block(self);
        let module = crate::kernel::module_handle_named(self, "KERNEL");
        let pdb = newest_pdb(self);
        let head = self.task_list().first().copied().unwrap_or(0);
        let running = if self.live_task(self.task_handle) {
            self.task_handle
        } else {
            0
        };

        for (at, value) in [
            (HEAP_HANDLE, master),
            (HEAP_SELECTOR, master),
            (FIRST_MODULE, module),
            (KERNEL_PDB, 0),
            (FIRST_PDB, pdb),
            (FIRST_TASK, head),
            (RUNNING_TASK, running),
            (TASK_MADE, 0),
        ] {
            self.write_far(data | u32::from(at), &value.to_le_bytes());
        }
    }

    /// `THHOOK`'s address handed out: its words laid out, and kept so.
    pub(crate) fn thhook_handed_out(&mut self) {
        self.kernel_calls.thhook_out = true;
        self.refresh_thhook();
    }
}

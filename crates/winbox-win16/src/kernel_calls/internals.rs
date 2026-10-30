//! KERNEL's internal calls that a program can reach and that WinBox
//! answers as `KRNL386.EXE` does: the chain of WINOLDAP's hooks, and the
//! calls left from real mode and the debugging build whose answers are
//! only what their code leaves in AX and DX. As `kernel/internals.ts`,
//! which cites the read-outs; **recorded** by `kintrnl`. `UndefDynlink`
//! is `kernel.rs`'s, beside `FatalAppExit`.

use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Stop};
use crate::system::System;

/// The profiles written back: none waits in WinBox, and AX is left
/// KERNEL's data selector, DX as it was (seg1 `708b`-`714f`, `7092`).
pub fn write_out_profiles(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let data = system
        .kept_named("KERNEL")
        .map_or(0, |kept| segment_selector(system.kept[kept].data));

    Ok(Answer::Word(data))
}

/// `InitTask1` (seg1 `8014`-`802b`) and `RegisterPtrace` (seg3
/// `081d`-`0849`): the far pointer's selector left in AX, DX as it was.
/// Nothing in WinBox calls either procedure, so neither is kept.
pub fn pointer_selector(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let pointer = args.dword(system);

    Ok(Answer::Word((pointer >> 16) as u16))
}

/// Where `SwapRecording` pushes its own return for KERNEL's parameter
/// error (seg3 `0151`), popped into DX on its way out (`0162`).
const SWAP_RECORDING_RETURN: u32 = 0x0167;

/// `SwapRecording` (seg3 `014e`-`0167`): the flag in AX, 167h in DX.
pub fn swap_recording(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let flag = args.word(system);

    Ok(Answer::Dword(SWAP_RECORDING_RETURN << 16 | u32::from(flag)))
}

/// `HasGPHandler` (seg1 `4c72`-`4d36`): no module of WinBox's has a `__GP`
/// table, and a program's is not trusted: nought, DX as it was.
pub fn has_gp_handler(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _address = args.dword(system);

    Ok(Answer::Word(0))
}

/// The far pointer in a record's first four bytes, its link.
fn link(system: &System, record: u32) -> u32 {
    let bytes = system.read_far(record, 4);

    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

/// `RegisterWinOldApHook` (seg2 `0689`-`06f0`), in standard mode: a flag
/// whose low byte is not nought puts the record at the head, its link the
/// old head, 1; nought takes it out of the chain, 1, or nought where it is
/// not there. DX is kept; the procedures are never called.
pub fn register_win_old_ap_hook(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let record = args.dword(system);
    let flag = args.word(system);
    let head = system.win_old_ap_hooks;

    if flag & 0xff != 0 {
        system.write_far(record, &head.to_le_bytes());
        system.win_old_ap_hooks = record;

        return Ok(Answer::Word(1));
    }

    if head == record {
        system.win_old_ap_hooks = link(system, record);

        return Ok(Answer::Word(1));
    }

    let mut at = head;

    while at != 0 {
        let next = link(system, at);

        if next == record {
            let after = link(system, record);

            system.write_far(at, &after.to_le_bytes());

            return Ok(Answer::Word(1));
        }

        at = next;
    }

    Ok(Answer::Word(0))
}

/// `GetWinOldApHooks` (seg2 `06f3`-`0705`): the head of the chain.
pub fn get_win_old_ap_hooks(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(system.win_old_ap_hooks))
}

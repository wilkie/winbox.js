//! KERNEL's internal calls that a program can reach and that WinBox
//! answers as `KRNL386.EXE` does: the chain of WINOLDAP's hooks, and the
//! calls left from real mode and the debugging build whose answers are
//! only what their code leaves in AX and DX. **Recorded** by `kintrnl`.
//! `UndefDynlink` is `kernel.rs`'s, beside `FatalAppExit`.

use winbox_cpu::{AX, BP, BX, CX, DI, DS, DX, ES, SI, SP, SS};
use winbox_machine::{index_for, segment_selector};

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

/// `EMSCopy` (160), left from the real-mode KERNEL's expanded memory: its
/// routine (seg1 `a940`-`a94a`) is never reached. KERNEL cuts its first
/// code segment at A940h as start-up ends (seg1 `b565`-`b573`), so the
/// entry lies one byte past the segment's limit: a general protection
/// fault on a 386, but DOSBox checks no offset against a code segment's
/// limit and runs what lies there, the block the heap gave next --
/// `MMSYSTEM.DLL`'s first code segment, whose first routine is
/// `timeGetSystemTime` (`MMSYSTEM.DLL` seg1 `0000`-`0026`, `RETF 6`).
/// **Recorded** by `emspast` and `emscopy`: 81h for seven noughts.
pub fn ems_copy(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    crate::mmsystem::time::time_get_system_time(system, args)
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

/// `ExitKernel` (seg1 `9d6f`-`9e09`): the end of the session, which never
/// returns -- WinBox's own end, as its `ExitWindows` ends it.
pub fn exit_kernel(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _code = args.word(system);

    system.ended = true;
    Ok(Answer::Nothing)
}

/// `PatchCodeHandle` (seg1 `7bac`-`7ca5`): AX the handle given, DX its
/// block's selector, or nought for none (seg1 `0ede`). WinBox's loader
/// patched the segment's prologues as it loaded it (`patch_prologues`),
/// and patching again changes nothing.
pub fn patch_code_handle(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let selector = if handle == 0 {
        0
    } else {
        (crate::kernel::global_handle_of(system, handle) >> 16) as u16
    };

    Ok(Answer::Dword(u32::from(selector) << 16 | u32::from(handle)))
}

/// What SI holds as `InitLib` returns (seg2 `27b0`).
const INIT_LIB_SI: u16 = 0x842a;

/// `InitLib` (seg2 `2797`-`27b3`): with CX nought, AX nought; otherwise
/// `LocalInit(0, 0, CX)` in DS, its answer in AX. CX kept, ES KERNEL's
/// data, SI 842Ah, DS as it came; nothing popped.
pub fn init_lib(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let cx = system.cpu.regs[CX];
    let ds = system.cpu.segments[DS].selector;

    system.cpu.regs[AX] = if cx == 0 {
        0
    } else {
        u16::from(system.local_init(index_for(ds), 0, u32::from(cx)))
    };

    let kernel = system
        .kept_named("KERNEL")
        .map_or(0, |kept| segment_selector(system.kept[kept].data));

    system
        .cpu
        .load_segment(ES, kernel)
        .map_err(Stop::Processor)?;
    system.cpu.regs[SI] = INIT_LIB_SI;

    Ok(Answer::Nothing)
}

/// The word at 271h of KERNEL's data, `WinOldApCall(0)`'s DI: set from the
/// DOS beneath as KERNEL starts (seg1 `b9cd`-`b9f5`); 10h on DOSBox's.
const WINOLDAP_DOS_WORD: u16 = 0x10;

/// `WinOldApCall` (seg3 `07e6`-`081a`): not nought, BX the stack pointer
/// after DS pushed and DX KERNEL's prefix -- none in WinBox
/// (`kgaps:kernelpdb`); nought, AX, BX, CX and DX nought and DI 10h.
pub fn win_old_ap_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let flag = args.word(system);

    if flag != 0 {
        system.cpu.regs[BX] = system.cpu.regs[SP].wrapping_sub(2);
        system.cpu.regs[DX] = kernel_pdb(system);
        return Ok(Answer::Nothing);
    }

    system.cpu.regs[AX] = 0;
    system.cpu.regs[BX] = 0;
    system.cpu.regs[CX] = 0;
    system.cpu.regs[DX] = 0;
    system.cpu.regs[DI] = WINOLDAP_DOS_WORD;

    Ok(Answer::Nothing)
}

/// KERNEL's own prefix as WinBox has it: the running task's prefix's
/// parent, word 16h, which WinBox leaves nought.
fn kernel_pdb(system: &System) -> u16 {
    let Some(task) = system.task.as_ref() else {
        return 0;
    };
    let pdb = u32::from(segment_selector(task.program_segment)) << 16;
    let bytes = system.read_far(pdb | 0x16, 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

/// `ToolHelpHook` (seg3 `084c`-`0885`): the procedure exchanged with the
/// one kept, the old in DX:AX, BX the new one's offset and selector or'd.
/// Never called: WinBox tells no debugger of its events.
pub fn tool_help_hook(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let given = args.dword(system);
    let old = std::mem::replace(&mut system.kernel_calls.tool_help_hook, given);

    system.cpu.regs[BX] = (given | given >> 16) as u16;

    Ok(Answer::Dword(old))
}

/// `GetSetKernelDOSProc` (seg1 `9eaf`-`9ecc`): the procedure KERNEL makes
/// its DOS calls through, exchanged; nought until one is given, as WinBox
/// has nothing beneath its KERNEL (`kgaps:dosprocold`), and never called.
pub fn get_set_kernel_dos_proc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let given = args.dword(system);
    let old = std::mem::replace(&mut system.kernel_calls.kernel_dos_proc, given);

    Ok(Answer::Dword(old))
}

/// A warning's bit in `K327`'s code (seg1 `94af`).
const PARAMETER_WARNING: u16 = 0x8000;

/// `K327` (seg1 `949b`-`94c4`), reached by a far jump: a warning returns
/// to the check; otherwise the frame unwound -- BX the offset popped, BP
/// the caller's with its low bit cleared, AX, CX, DX and ES nought -- and
/// the return made to that offset in the check's segment.
pub fn k327(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    if system.cpu.regs[BX] & PARAMETER_WARNING != 0 {
        return Ok(Answer::Nothing);
    }

    let ss = u32::from(system.cpu.segments[SS].selector) << 16;
    let sp = system.cpu.regs[SP];
    let word = |system: &System, at: u16| {
        let bytes = system.read_far(ss | u32::from(sp.wrapping_add(at)), 2);

        u16::from_le_bytes([bytes[0], bytes[1]])
    };
    let cs = word(system, 2);
    let offset = word(system, 4);
    let bp = word(system, 6);
    let top = sp.wrapping_add(4);

    system.write_far(ss | u32::from(top), &offset.to_le_bytes());
    system.write_far(ss | u32::from(top.wrapping_add(2)), &cs.to_le_bytes());
    system.cpu.regs[SP] = top;
    system.cpu.regs[BP] = bp & !1;
    system.cpu.regs[BX] = offset;
    system.cpu.regs[AX] = 0;
    system.cpu.regs[CX] = 0;
    system.cpu.regs[DX] = 0;
    system.cpu.load_segment(ES, 0).map_err(Stop::Processor)?;

    Ok(Answer::Nothing)
}

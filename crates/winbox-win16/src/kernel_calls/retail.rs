//! KERNEL's calls that do nothing in the retail Windows 3.1, and its small
//! answers of what a debugger is told, each as `KRNL386.EXE` has it.

use crate::call::{Answer, Args, Stop};
use crate::system::System;

/// Nothing done, AX and DX left: `EnableDos`, `DisableDos`, `EnableKernel`
/// (seg1 `9c8e`-`9c90`), `KbdRst` (`4638`), `_DEBUGOUTPUT` (`94ce`),
/// `K329` (`94c5`), `ValidateCodeSegments` (seg2 `2ab7`), `LogError` and
/// `LogParamError` (seg1 `94cf`, `94f2`, `9a50`-`9a75`).
pub fn nothing(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Nothing)
}

/// Nought in DX and AX: `LimitEmsPages` (seg1 `4632`) and `GetCurPID`
/// (`4639`-`4647`). **Recorded** by `ktask`.
pub fn nought(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(0))
}

/// Nought in AX: `GetWinDebugInfo` and `SetWinDebugInfo` (seg1 `9f2a`,
/// `9f36`), and `DiagQuery`, KERNEL's diagnostic mode, the word at D50h of
/// its data (`a70e`-`a71c`). **Recorded** by `ktask`.
pub fn nought_word(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(0))
}

/// The procedure KERNEL calls as a program fails, given; the one it had
/// answered (seg1 `9ecf`-`9ee8`). **Recorded** by `ktask`.
pub fn fatal_exit_hook(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hook = args.dword(system);

    Ok(Answer::Dword(std::mem::replace(
        &mut system.fatal_exit_hook,
        hook,
    )))
}

/// `FFFFFFFFh` where KERNEL runs without paging, as standard mode does (seg1
/// `127e`-`12ad`). **Recorded** by `ktask`.
pub fn get_free_mem_info(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(0xffff_ffff))
}

/// A letter made small as KERNEL makes one for `Reserved5` (seg1 `8400`-
/// `8424`): A to Z, and `C0h` to `DEh` but `D7h`.
fn lower(code: u8) -> u8 {
    match code {
        b'A'..=b'Z' => code + 0x20,
        0xc0..=0xde if code != 0xd7 => code + 0x20,
        _ => code,
    }
}

/// Two strings compared, letters made small (`Reserved5`, seg1 `838e`-
/// `83bf`): -1, 1 or nought. **Recorded** by `ktask`.
pub fn reserved5(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let first = args.dword(system);
    let second = args.dword(system);
    let byte = |far: u32, at: u16| {
        system.read_far(
            (far & 0xffff_0000) | u32::from((far as u16).wrapping_add(at)),
            1,
        )[0]
    };
    let mut at = 0u16;

    let answer: i16 = loop {
        let (a, b) = (byte(first, at), byte(second, at));

        if a == 0 {
            break if b == 0 { 0 } else { -1 };
        }

        if b == 0 {
            break 1;
        }

        if lower(a) != lower(b) {
            break if lower(a) < lower(b) { -1 } else { 1 };
        }

        at = at.wrapping_add(1);
    };

    Ok(Answer::Word(answer as u16))
}

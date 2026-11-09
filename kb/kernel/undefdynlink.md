---
kind: function
module: KERNEL
name: UndefDynlink
ordinal: 120
summary: Where KERNEL's loader points an import it cannot find; calling it ends the program with "Call to Undefined Dynalink".
topics: [kernel-internals, dynamic-link-libraries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `72d4`-`72eb` (`KRNL286.EXE` seg1 `6b6e`). It takes no arguments. It calls KERNEL's fatal exit with nought and its own text at 9BAh of its data, `Call to Undefined Dynalink` (seg1 `72de`-`72e6`, the routine at `5cdf`). The program is ended there, and it does not return.
- [[read out]] KERNEL's loader binds an import to it rather than refusing the program (seg1 `73b9`-`73f8`). That happens when the module the import names has no handle in the module reference table, when a name is not found in that module's tables, or when the ordinal has no entry. The far pointer, or the selector and offset, of the import is written as KERNEL's code segment and 72D4h. So a program that imports a function a library lacks is loaded and runs. It ends only if it calls that function.
- [[measured]] [[probe:undefdl]] starts a program that imports KERNEL's ordinal 142 and the name `NOSUCHPROC`, which KERNEL does not export, and ordinal 99 and the name `ABSENT` from a library of its own that exports only `PRESENT`. `WinExec` answers an instance. All four imports hold the address `GetProcAddress(KERNEL, 120)` gives, and `PRESENT`'s import works. `GetProcAddress` of each of the four answers nought, though the import was bound.
- [[measured]] Called, the first ends the program: the box is "Application Error" with "Call to Undefined Dynalink" and one button, Close ([[probe:undefdl]], its screen). Nothing after the call is written, and once Close is pressed the program's module is gone.

## Callers

- No file imports it. It is reached only through imports the loader could not bind (`kb/data/kernel-callers.json`).

## Implementation

A real one in both engines. Each engine's linker binds an import to KERNEL's ordinal 120 where the module it names exports no such name or ordinal, or is not there at all: `src/win16/linker.ts` (`bound`, `undefDynlink`) and `crates/winbox-win16/src/linker.rs` (`bound`, `undef_dynlink`). For a library loaded from its file that is its entry table. For one of WinBox's own modules it is the module's table of exports, an ordinal with no entry being one Windows does not export. That is also what `GetProcAddress` finds. The function is `FatalAppExit`'s box with nought and KERNEL's text (`crates/winbox-win16/src/kernel.rs`).

Before this, a missing name was left unwritten (the TypeScript linker logged it) and a missing ordinal of WinBox's own modules was given a stub. The placeholder entries KERNEL's and USER's tables kept at the ordinals Windows does not export (named `unknown`) were taken out for this, so those ordinals are not exported in WinBox either; USER's ordinal 484, Windows' `__GP`, keeps its stub. No corpus program called a stub before or after ([[topic:kernel-internals]]).

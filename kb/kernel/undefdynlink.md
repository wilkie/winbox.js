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
- Not yet measured. A probe that imports an ordinal a library does not export, and does not call it, would show the load succeed.

## Callers

- No file imports it. It is reached only through imports the loader could not bind (`kb/data/kernel-callers.json`).

## Implementation

A stub in both engines. WinBox's loader does not bind an import it cannot find to anything. `src/win16/linker.ts` logs a name it cannot find and leaves the relocation as the file had it, often a chain offset or 0:FFFFh. The Rust engine's `crates/winbox-win16/src/linker.rs` (`imported`) leaves such a relocation alone too. For WinBox's own modules, either engine gives any ordinal not nought a stub, whether or not the module exports it. A call through an import left alone goes to a wild address rather than ending the program cleanly.

**Recommendation: implement as Windows does. This is the most useful item on the list.** Bind every import the linker cannot resolve to this export, and make it what it is in Windows: [[fn:KERNEL.FatalAppExit]] with nought and `Call to Undefined Dynalink`. `FatalAppExit` itself jumps to the same routine, seg1 `0211`-`0225`. A program that imports a function from a newer Windows or a missing DLL entry then loads and runs as on Windows, and fails the same way only if it makes the call. Size: small to medium. That is roughly 30 lines in each engine's linker and the export itself, plus a probe to record the load and, under a child process, the message. See [[topic:kernel-internals]].

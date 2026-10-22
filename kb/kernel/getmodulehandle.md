---
kind: function
module: KERNEL
name: GetModuleHandle
ordinal: 47
summary: A module's handle, by its name, by its file's name, or by a number -- a module's handle or an instance -- in the pointer's offset with nought in its segment.
versions:
  '3.1': partial
probes: [modnum, freelib, loadname, modhand]
source: src/win16/kernel/GetModuleHandle.ts
topics: [dynamic-link-libraries]
---

## Observed behaviour

- [[measured]] [[probe:freelib]] and [[probe:loadname]]: a name alone is a module's name; a name with a dot is a file's, matched against the module's file. See [[topic:dynamic-link-libraries]].
- [[measured]] [[probe:modnum]] gives it numbers, each in the offset of the pointer with nought in its segment, and compares the answer with the handle the module's name finds: the probe's own instance, USER's module handle, the instance `LoadLibrary("USER.EXE")` answers, SHELL's instance, and `MAIN.CPL`'s instance and module handle each answer their module's handle.
- [[measured]] The probe's task, from [[fn:KERNEL.GetCurrentTask]], answers nought.

## Inside Windows

- [[read out]] `KRNL386.EXE` seg2 `01bb` checks the pointer (seg2 `0385`): with its segment nought, any offset but nought passes. The body (seg2 `07bc`) hands a pointer whose segment is nought to `GetExePtr` (seg1 `4e78`, at seg2 `082e`), and otherwise looks the name up, twice, as a module's name and as a file's.
- [[read out]] `GetExePtr` takes a selector whose block starts `NE`, a module's; else it looks for a task whose instance (its database's word 1Ch) is the number and answers that task's module (word 1Eh); else it finds the block's owner by `GlobalHandle` and looks again. A task's own handle is none of these, and finds nothing.
- [[read out]] DX is KERNEL's word at 21Ch of its data, whatever was found.

## Implementation

Both engines answer a number from the handle's object: a program's instance its module's handle as its name finds it, a library's instance or module its module's, a module WinBox keeps its own, one of WinBox's own libraries with a file only while it is in use, as by name. `module_by_number` in `crates/winbox-win16/src/kernel.rs` is the Rust twin.

Not yet done:

- A program's task is its instance in WinBox, and a program's module answers nought by its name, so `modnum`'s task record agrees only by that: a known gap.
- `GetExePtr`'s last step, a block's owner: a block of global memory a program allocated finds nothing here.
- DX is not answered.

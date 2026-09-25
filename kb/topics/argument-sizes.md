---
kind: topic
name: How an export takes its arguments
summary: Every Windows 3.1 export removes its own arguments as it returns, and how many bytes that is can be read out of the modules themselves — from the RETF, from what hand-written code pops, and from the argument checking in front of a function.
probes: []
---

A Windows 3.1 program calls KERNEL, USER, GDI and the other modules with a far call in the Pascal convention. The caller pushes the arguments, left to right, and the function removes them as it returns, with `RETF n`. So an emulator's stand-in for a function has to remove exactly `n` bytes, even if it does nothing else. If it removes fewer, it returns into the caller's arguments. winbox.js had 312 stand-ins that removed nothing, and 58 ordinals with no entry at all, which is why a program that called one of them to close itself went astray.

`n` is written in each module, and [[read out]] `scripts/oracle/argument-sizes.mjs` reads it out of the installation's own files. It covers 1,189 exports of KERNEL, USER, GDI, KEYBOARD, SHELL, COMMDLG, MMSYSTEM, SOUND and WIN87EM, and reads a size for all but 29. For the 178 functions winbox.js implements, it gives the size their signatures give, apart from the two exceptions below.

## Where the size is written

- [[read out]] **The `RETF`.** A compiled function saves `bp`, does its work and returns by `RETF n`. The script follows each export from its entry by recursive descent, through its jumps but not into what it calls, and collects every `RETF` it reaches. One size is the answer.
- [[read out]] **What hand-written code pops.** Some of USER is written by hand and returns by a bare `RETF`, having taken its arguments off itself. `IsWindow` pops its caller's return address, pops the window handle, pushes the return address back and returns. `PostQuitMessage` calls a helper that does the same for it. The helper pops its own near return, the far return and the exit code, puts the far return back and jumps home. The script follows the stack through pushes, pops and near calls until the caller's return address is back on top, and counts the arguments taken off on the way.
- [[read out]] **The argument checking.** Much of 3.1 is reached through a layer that checks a function's arguments first. Its entry saves `bp` and pushes the address of an error return, then checks, then jumps into the function proper. The error return is a `RETF n` for that entry alone, since returning there means the function never ran. That makes it the entry's size even when the function proper is shared: `GetMessage` and `PeekMessage` jump into a body that returns by `RETF 0Eh`, while their error returns are `RETF 0Ah` and `RETF 0Ch`, their own sizes. The script reads a checked entry's size from its error return.
- [[read out]] **The segment's last bytes.** The loader zero-fills a segment from the end of its bytes in the file up to its allocation. The keyboard driver's last function ends in `RETF 0002`, and the `00` is past the file's bytes, so the script pads each segment the same way.

## Where the reading is wrong

- [[read out]] `Throw` never returns to its caller. It reloads the stack from the catch buffer and returns from the `Catch` that filled it, so the `RETF` it reaches is `Catch`'s. Its own two arguments are six bytes.
- [[read out]] GDI's `CreateScalableFontResource` has a checking layer whose error return is `RETF 0Ch`. But the function itself reads its fourth argument, the `UINT`, at `[bp+12h]`, and returns by `RETF 0Eh`. The check covers the three pointers and forgets the `UINT`. So Windows' own error path for this function leaves two bytes on its caller's stack. The function takes fourteen.
- [[refused]] The first reading took only the `RETF`, and it disagreed with five functions whose sizes were already known to be right. `CreateWindow`, `GetMessage` and `PeekMessage` came out too large, because they share their bodies. `GetSystemMetrics` came out as nothing, because its body pops its own arguments. Taking a checked entry's size from its error return settles all four. It also unsettles `CreateScalableFontResource`, where the error return is the one in the wrong.
- The 29 exports left without a size either leave by a far jump, are entries into data, or reach more than one size. Each keeps whatever size its entry had before.

## In winbox.js

`test/win16/argument_sizes_test.ts` holds every module's table to what the script reads from the installation, with the two exceptions written down. The names in the tables match the binaries' names ordinal for ordinal, which is what says the sizes are in the right places.

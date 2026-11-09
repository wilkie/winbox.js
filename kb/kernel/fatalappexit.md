---
kind: function
module: KERNEL
name: FatalAppExit
ordinal: 137
summary: USER's system error box, Application Error and the text given, with Close; then the task ended with code FFh.
source: crates/winbox-win16/src/kernel.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `5cdf`-`5d09`: a text whose segment is nought is KERNEL's "Closing current application." (data 84Ch).
- [[read out]] seg1 `5c80`-`5cdc`: USER's system error box (the far procedure at 2D0h of KERNEL's data), "Application Error" its caption (745h), the text its text, the buttons nought, `SEB_CLOSE | SEB_DEFBUTTON` (8008h) and nought: Close alone, in the middle place. The first place is Cancel only where the byte at 328h of KERNEL's data has bit 3, which the retail build's never has. No box is shown where the task's database has bit 1 of its word 18h -- TOOLHELP's `TerminateApp` sets it for `NO_UAE_BOX` -- or before USER has given KERNEL its box; the answer is then as though Close was chosen.
- [[read out]] Cancel chosen, it returns; otherwise seg1 `5e01`-`5e19`: the task ends through DOS, `INT 21h` 4CFFh.
- Not yet measured.

## Nuances

- The box is the one a fault shows ([[probe:fault]]), drawn by the same code.

## Implementation

`src/win16/kernel/FatalAppExit.ts`, and the Rust engine's `kernel.rs` (`fatal_app_exit`).

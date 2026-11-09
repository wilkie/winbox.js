---
kind: function
module: KERNEL
name: FatalExit
ordinal: 1
summary: In the retail build, FatalAppExit with KERNEL's own text: the Application Error box, then the task ended.
source: crates/winbox-win16/src/kernel.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg1 `93ce`-`93e4`: `FatalAppExit(0, "Application requested abnormal termination")`, the text at 9D5h of KERNEL's data; the code given is shown nowhere. See [[fn:KERNEL.FatalAppExit]].
- [[read out]] The procedure [[fn:KERNEL.FatalExitHook]] sets, the double word at 304h of KERNEL's data, is read by nothing else in the retail build (seg1 `9edb`, `9ee2` alone): `FatalExit` does not call it.
- Not yet measured.

## Implementation

`src/win16/kernel/FatalExit.ts`, and the Rust engine's `kernel.rs` (`fatal_exit`).

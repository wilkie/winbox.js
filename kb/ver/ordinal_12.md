---
kind: function
module: VER
name: Ordinal 12
ordinal: 12
summary: VER's LibMain, which its entry point calls — it keeps its instance, unlocks its data segment, makes its code segment moveable in protected mode, and keeps KERNEL's IsRomModule.
versions:
  '3.1': stub
topics: [version-information]
---

## Observed behaviour

- [[read out]] `VER.DLL` seg2 `0032`, called by the entry point (seg2 `0000`) after `LocalInit`; it pops 10 bytes: the instance, the data segment, the heap's size and the command line.
- [[read out]] It keeps the instance (`[160h]`) for `LoadString`, calls `UnlockSegment(-1)`, and where `GetWinFlags` says protected mode makes seg1 moveable (`GlobalReAlloc` with 82h) and lets its page go (`GlobalPageUnlock`).
- [[read out]] It keeps `GetProcAddress(GetModuleHandle("KERNEL"), 323)` -- `IsRomModule` -- at `[162h]`, which VER asks of every file it opens (seg3 `04a0`). It answers 1.
- [[read out]] The entry table gives it flags 0: it is an entry for VER's own far calls into a moveable segment, not a function VER offers programs.

## Implementation

Not WinBox's own: a stub in WinBox's table (`src/win16/ver/index.ts`, named `Unknown`, popping 10 bytes), with no arm in `crates/winbox-win16/src/ver/mod.rs`. WinBox's own VER does what it does where VER does it, in its own code.

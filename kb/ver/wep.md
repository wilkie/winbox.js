---
kind: function
module: VER
name: WEP
ordinal: 1
summary: VER's exit procedure, which KERNEL calls as the library is let go — it answers 1 and does nothing else.
versions:
  '3.1': unrecorded
source: src/win16/ver/ver.ts
topics: [version-information]
---

## Observed behaviour

KERNEL calls it as VER is freed, with one word saying why; no program calls it. Not measured: no probe records it.

- [[read out]] It answers 1, whatever the word (`VER.DLL` seg1 `0000`), and pops it (`retf 2`).

## Inside Windows

[[read out]] seg1 `0000`: `mov ax, 1`, and return. VER frees nothing as it goes: its Win32s library, if it loaded one (seg4 `000b`), is not let go.

## Implementation

`WEP` in `src/win16/ver/ver.ts` and `wep` in `crates/winbox-win16/src/ver/mod.rs` answer 1.

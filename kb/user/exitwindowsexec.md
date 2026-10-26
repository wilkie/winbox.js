---
kind: function
module: USER
name: ExitWindowsExec
ordinal: 246
summary: Windows ended and a DOS program run after it: not here, nought.
versions:
  '3.1': unrecorded
topics: [window-states]
source: src/win16/user/small-calls.ts
---

## Inside Windows

- [[read out]] `USER.EXE` seg5 `0216`-`02fd`: the buffer the DOS loader that started Windows keeps for a program to run after, asked of `INT 2Fh` function 4B20h and made a selector by DPMI; the program's name, under 80h bytes, and its parameters as a command tail, under 7Fh, written there; then [[fn:USER.ExitWindows]] with `EW_EXITANDEXECAPP`. Nought where there is no buffer, a name is too long, or a program refuses to end -- the buffer emptied again. Not recorded: Windows would end.

## Implementation

`src/win16/user/small-calls.ts`; the Rust engine's `crates/winbox-win16/src/small_calls.rs`. WinBox has no DOS loader to ask: nought, and nothing ends.

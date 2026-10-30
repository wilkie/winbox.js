---
kind: function
module: USER
name: LoadIconHandler
ordinal: 456
summary: Makes a block holding an icon resource USER's icon, in place: SHELL's ExtractIcon and WinHelp hand it the resources they read.
topics: [user-internals]
---

## Observed behaviour

- Not measured.

## Inside Windows

- [[read out]] `USER.EXE` seg12 `0328`-`0371`: the block and a flag (4 bytes); `GlobalSize` and `GlobalLock` of the block, nought where it does not lock; a new-format resource (the flag) converted by the DIB conversion of [[fn:USER.LoadDibIconHandler]] (`1138` with 1), an old one by [[fn:USER.LoadCursorIconHandler]]'s (`0e4c`); the conversion's answer answered.

## Callers

- [[read out]] `SHELL.DLL` and `WINHELP.EXE` import it (`kb/data/user-callers.json`). No corpus program does.

## Implementation

A stub in both engines. **Not yet done**, with the handlers: WinBox's `ExtractIcon` makes its icons itself.

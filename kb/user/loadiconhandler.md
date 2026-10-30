---
kind: function
module: USER
name: LoadIconHandler
ordinal: 456
summary: Makes a block holding an icon resource USER's icon, in place: SHELL's ExtractIcon and WinHelp hand it the resources they read.
source: src/win16/user/icon-handlers.ts
topics: [user-internals]
---

## Observed behaviour

- Not measured. The conversion it makes is [[fn:USER.LoadDibIconHandler]]'s, measured by [[probe:iconhand]].

## Inside Windows

- [[read out]] `USER.EXE` seg12 `0328`-`0371`: the block and a flag (4 bytes); `GlobalSize` of the block, its low word the size, and `GlobalLock`, nought where it does not lock; a new-format resource (the flag) converted by the DIB conversion of [[fn:USER.LoadDibIconHandler]] (`1138` with 1, an icon), an old one by [[fn:USER.LoadCursorIconHandler]]'s (`0e4c`); the conversion's answer answered, the block itself or nought. Nothing is discarded where it fails.

## Callers

- [[read out]] `SHELL.DLL` and `WINHELP.EXE` import it (`kb/data/user-callers.json`). No corpus program does.

## Implementation

`src/win16/user/icon-handlers.ts`; the Rust engine's `icon_handlers.rs`. WinBox's `ExtractIcon` makes its icons itself.

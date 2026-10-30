---
kind: function
module: USER
name: LoadDibIconHandler
ordinal: 357
summary: The resource handler KERNEL's LoadResource calls for a Windows 3 module's icons: the resource read and made USER's own block.
probes: [userproc]
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:userproc]]: for a Windows 3.1 program, `SetResourceHandler` answers ordinal 357's address for `RT_ICON`; and the probe's icon, `LoadResource` and `LockResource`, is USER's block: hotspot 16, 16, size 32 by 32, 4 bytes a mask row, 4 planes of 1 bit, `GlobalSize` 672 -- not the DIB the file holds.

## Inside Windows

- [[read out]] `USER.EXE` seg12 `100d`: the block, the module and the resource (6 bytes); the resource's size (`SizeofResource`); KERNEL's own handler called through `[7A2h]` to read the resource; then an icon resource, a DIB, made USER's icon block in the display's format (`10ce` with 1, `1138`); the block made the size of what it now holds (`GlobalReAlloc`); on failure the block discarded and nought answered. [[fn:USER.SignalProc]] sets these handlers as a module is loaded.

## Callers

- No file of the installations or the corpus imports it (`kb/data/user-callers.json`).

## Implementation

A stub in both engines. **Not yet done**: WinBox's `LoadResource` of an icon or a cursor calls KERNEL's own handler, so a program reading its own icon resource gets the file's DIB, where Windows gives USER's block -- a known gap of [[probe:userproc]]. WinBox's own `LoadIcon` reads the resource itself and makes the same block (`icon-block.ts`), which these handlers would reuse.

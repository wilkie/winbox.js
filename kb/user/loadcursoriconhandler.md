---
kind: function
module: USER
name: LoadCursorIconHandler
ordinal: 336
summary: The resource handler KERNEL's LoadResource calls for a Windows 2 module's icons and cursors: the resource read and made USER's own block.
probes: [iconhand]
source: crates/winbox-win16/src/icon_handlers.rs
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:iconhand]]: a Windows 3.1 program's icons and cursors have [[fn:USER.LoadDibIconHandler]] and [[fn:USER.LoadDibCursorHandler]], not this; no probe is a Windows 2 module.

## Inside Windows

- [[read out]] `USER.EXE` seg12 `0deb`-`0e49`: the block, the module and the resource (6 bytes); the resource's size (`SizeofResource`), nought answered for one of 64K or more; KERNEL's own handler called through `[7A2h]` to read the resource, the block given left discarded and nought answered where it fails; `GlobalLock`, and `0e4c`; where that fails the block left discarded and nought answered.
- [[read out]] seg12 `0e4c`-`0fee`: the resource's first byte 1 for an icon, its second set for one independent of the device; those two bytes dropped (the rest moved down), the rest already USER's layout, its planes and bits made 1. Where the system's icon or cursor size is above 32 and the resource no larger, it is left so; otherwise it is made the system's size as `0bd1` makes one -- a device-dependent one already of the icon size (`[8Ah]`, `[8Ch]`, copies of `SM_CXICON` and `SM_CYICON` made at seg3 `148b`) only its hotspot set -- the block made larger first where it needs it (`15ff`), and smaller after where it holds less.

## Implementation

`src/win16/user/icon-handlers.ts` and `icon-convert.ts`'s `convertOld`; the Rust engine's `icon_handlers.rs` and `icon_convert.rs`. Set for a Windows 2 module's `RT_ICON` and `RT_CURSOR`, as [[fn:USER.SignalProc]] sets it. Read out only.

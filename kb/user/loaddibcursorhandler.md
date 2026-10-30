---
kind: function
module: USER
name: LoadDibCursorHandler
ordinal: 356
summary: The resource handler KERNEL's LoadResource calls for a Windows 3 module's cursors: the resource read and made USER's own block.
versions:
  '3.1': exact
probes: [iconhand]
records: [handler, load, lock, bytes, loadcursor]
source: src/win16/user/icon-handlers.ts
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:iconhand]]: for a Windows 3.1 program with cursors, `SetResourceHandler` answers this export's address for `RT_CURSOR`; for one with none, nought ([[probe:userproc]]).
- [[measured]] [[probe:iconhand]]: `LoadResource` of a cursor answers a block discarded, and `LockResource` has it made USER's block:
  - Black and white, 32 square, hotspot 5, 9: hotspot 5, 9; one plane of a bit; the mask then the picture; `GlobalSize` 288.
  - Black and white, 16 square, hotspot 7, 7: made 32 square, hotspot 14, 14.
  - Of 16 colours, hotspot 20, 3: the mask; 128 bytes of the resource as they were; then the picture in the display's format, 4 planes of a bit on the VGA, 8 bits on the 256-colour display; `GlobalSize` 768 and 1184.
- [[measured]] [[probe:iconhand]]: `LoadCursor` of a group answers the block `LoadResource` gives for its member, the same again each time; `DestroyCursor` answers nought while it is still used.

## Nuances

- A cursor of colours is laid out as a black and white one before its picture is added: its picture follows room for a monochrome picture, which holds what the resource held there, and runs past the block's end in Windows -- 12 bytes, on the VGA, past the 768 the block was given. WinBox cuts it at the block's end.

## Inside Windows

- [[read out]] `USER.EXE` seg12 `0ff1`: as [[fn:USER.LoadDibIconHandler]], `10ce` with nought: the bitmap after the hotspot's two words. In `0bd1` a cursor's rows are always the mask's and a monochrome picture's (`0c3a`); its hotspot is kept, and moved with its picture where it is stretched (`0c7c`). Its colour picture is made the icon size, `SM_CXICON` by `SM_CYICON` (`1029`).

## Implementation

`src/win16/user/icon-handlers.ts` and `icon-convert.ts`; the Rust engine's `icon_handlers.rs` and `icon_convert.rs`. A cursor `LoadCursor` loads is its block, which `SetCursor` shows as the display would (`blockCursorImage`).

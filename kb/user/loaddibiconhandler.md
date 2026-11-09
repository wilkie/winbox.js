---
kind: function
module: USER
name: LoadDibIconHandler
ordinal: 357
summary: The resource handler KERNEL's LoadResource calls for a Windows 3 module's icons: the resource read and made USER's own block.
versions:
  '3.1': exact
probes: [iconhand]
records: [handler, load, lock, bytes, loadicon, chain, screen]
source: crates/winbox-win16/src/icon_handlers.rs
topics: [user-internals]
---

## Observed behaviour

- [[measured]] [[probe:userproc]], [[probe:iconhand]]: for a Windows 3.1 program, `SetResourceHandler` answers this export's address for `RT_ICON` -- set by [[fn:USER.SignalProc]] as the module was loaded; KERNEL's own for the groups.
- [[measured]] [[probe:iconhand]]: `LoadResource` of an icon answers a block discarded, of nought bytes (`GlobalFlags` 4100h), and nothing is called; `LockResource` has it made, and it is USER's block, not the DIB the file holds:
  - On the VGA: hotspot 16, 16; 32 by 32; 4 bytes a mask row; 4 planes of a bit; `GlobalSize` 672 -- whether the resource was 16, 32, 48 or 64 square. On the 256-colour display, a plane of 8 bits, 1184.
  - Black and white: one plane of a bit whatever the display, the mask then the picture, 288.
  - Every byte as far as the header says the block holds -- 12, the mask's rows, the picture's -- as `icon-convert.ts` makes it.
- [[measured]] [[probe:iconhand]]: `LoadIcon` of a group answers the block `LoadResource` gives for its member, the same again for every `LoadIcon`; `DestroyIcon` of it answers nought while it is still used.
- [[measured]] [[probe:iconhand]]: a program's handler set for `RT_ICON` in place of this one is not called by `LoadIcon`, and is called once by `DrawIcon` of that icon, which locks it; `LoadResource` of another icon calls it not at all, `LockResource` once.
- [[measured]] [[probe:iconhand]]: drawn with `DrawIcon` on grey, a black and white icon's set bits are white, its clear bits black, and where the mask shows the screen a set bit inverts it.

## Nuances

- A 16 square icon is doubled; a 64 square one halved, each pair of pixels and each pair of rows of the mask anded together; a 48 square one stretched as GDI stretches a monochrome bitmap, rows 0, 2, 3, 5 and on kept ([[probe:iconhand]]).
- The block is made in place: what USER does not write is the resource's still, and a block made larger holds whatever its memory held, past what its header says it holds.

## Inside Windows

- [[read out]] `USER.EXE` seg12 `100d`: the block, the module and the resource (6 bytes); `10ce` with 1 -- the resource's size (`SizeofResource`), KERNEL's own handler called through `[7A2h]` to read the resource into the block given, `GlobalLock`, and `1138`. Where KERNEL's handler or `1138` fails, the block given or read left discarded (`GlobalReAlloc` to nought) and nought answered.
- [[read out]] seg12 `1138`-`15c6`, the conversion: the header, the old (`0Ch` bytes) or the new, its colour table at `28h`, of the colours it says it uses or as many as its bits give. Of a table of two that are black and white in either order (`05ed`), one monochrome bitmap of the whole of it, mask over picture; else the picture `SetDIBits` into a bitmap compatible with the display, and the mask, its table made black and white, into a monochrome one. The size USER makes it (`124d`): the system's -- `SM_CXICON` by `SM_CYICON` -- unless that is above 32 and the resource no larger. The block made larger where it needs to be (`15ff`, `14e7`), the mask's rows written at 12 (`GetBitmapBits`), made the system's size by `0bd1` -- halved across (seg5 `050f`), reduced down by a whole number (seg5 `056e`), else stretched in `COLORONCOLOR` (`087a`) -- and an icon's hotspot made its middle; then the picture at the icon's size after the mask (`1029`), and the block made smaller where it holds less.

## Implementation

`crates/winbox-win16/src/icon_handlers.rs` and `crates/winbox-win16/src/icon_convert.rs`. KERNEL's `LoadResource` and `LockResource` call it directly where a module's icons have it (`resource-handlers.ts`), and set it for each module's icons as its handlers are first asked for. `LoadIcon` with USER's own handler has a discardable icon's block made at once, where Windows waits for the first lock: WinBox's own drawing reads the block as it is.

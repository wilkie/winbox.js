---
kind: function
module: KERNEL
name: SetResourceHandler
ordinal: 67
summary: A resource type's handler changed: the one it had, KERNEL's own at first, or nought for a type the module has none of.
versions:
  '3.1': exact
probes: [reshand, iconhand]
records: [set, load, own]
source: crates/winbox-win16/src/resources.rs
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg3 `002e`-`0051`, `0b3d`-`0bb0`: the module found from the instance (`GetExePtr`), its resource table's types walked, a type matched by number or by name (`0964`, `0af9`), and the double word at 4 of its entry exchanged for the procedure given; nought where no type matches.
- [[read out]] Every type's handler is KERNEL's own, seg1 `88c8`, set as the module is read (seg2 `27de`-`27e4`).
- [[measured]] [[probe:iconhand]]: for a Windows 3.1 program's `RT_ICON` and `RT_CURSOR`, USER's [[fn:USER.LoadDibIconHandler]] and [[fn:USER.LoadDibCursorHandler]], which [[fn:USER.SignalProc]] set as the module was loaded; for its groups, KERNEL's own.
- [[measured]] [[probe:reshand]]: for RCDATA, KERNEL's own: KERNEL's code's selector, offset 88C8h; then the probe's handler; nought for RT_BITMAP, which the probe has none of; KERNEL's own for a numbered type and for a named one.

## Nuances

- WinBox keeps the handlers set beside the module, and its own at KERNEL's stub at 88C8h, no export, so that the address answered is where Windows' is.
- A module's icons and cursors have USER's handlers from the first, set as its handlers are first asked for, where Windows' KERNEL signals USER the module loaded ([[fn:USER.SignalProc]]); WinBox calls USER's own directly.
- [[fn:KERNEL.LoadResource]] and [[fn:KERNEL.LockResource]] call a program's handler; `LoadIcon` and `LoadCursor` load through the handlers; WinBox's other own resource loads -- menus, dialogs -- read the resource themselves, with no handler.

## Implementation

`src/win16/kernel/resource-handlers.ts`, and the Rust engine's `crates/winbox-win16/src/resources.rs`.

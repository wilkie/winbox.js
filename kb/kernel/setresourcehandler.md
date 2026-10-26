---
kind: function
module: KERNEL
name: SetResourceHandler
ordinal: 67
summary: A resource type's handler changed: the one it had, KERNEL's own at first, or nought for a type the module has none of.
versions:
  '3.1': exact
probes: [reshand]
records: [set, load, own]
source: src/win16/kernel/resource-handlers.ts
topics: [kernel-queries]
---

## Observed behaviour

- [[read out]] `KRNL386.EXE` seg3 `002e`-`0051`, `0b3d`-`0bb0`: the module found from the instance (`GetExePtr`), its resource table's types walked, a type matched by number or by name (`0964`, `0af9`), and the double word at 4 of its entry exchanged for the procedure given; nought where no type matches.
- [[read out]] Every type's handler is KERNEL's own, seg1 `88c8`, set as the module is read (seg2 `27de`-`27e4`).
- [[measured]] [[probe:reshand]]: for RCDATA, KERNEL's own: KERNEL's code's selector, offset 88C8h; then the probe's handler; nought for RT_BITMAP, which the probe has none of; KERNEL's own for a numbered type and for a named one.

## Nuances

- WinBox keeps the handlers set beside the module, and its own at KERNEL's stub at 88C8h, no export, so that the address answered is where Windows' is.
- [[fn:KERNEL.LoadResource]] and [[fn:KERNEL.LockResource]] call a program's handler; WinBox's own resource loads -- USER's icons, menus, dialogs -- read the resource themselves, with no handler.

## Implementation

`src/win16/kernel/resource-handlers.ts`, and the Rust engine's `crates/winbox-win16/src/resources.rs`.

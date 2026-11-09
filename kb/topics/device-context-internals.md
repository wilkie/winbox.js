---
kind: topic
name: Device context internals
summary: The calls GDI exports for USER and the drivers to manage a device context with — its hook, its relative-or-absolute mode, its own clip region's handle, the font selected, ResetDC — what each keeps in the context, and what a program that calls one gets back; read out of GDI.EXE and recorded.
probes: [dcinner, dchook]
---

GDI exports calls that USER and the display and printer drivers use to manage a device context, and which no program is meant to need. Programs call them all the same. [[measured]] [[probe:dcinner]] calls each on a memory context and a window's, on the VGA and on the 256-colour display, and WinBox agrees with all 51 records on each. [[probe:dchook]] is the same with the hook's calls recorded.

## What a device context keeps

[[read out]] A device context is a block in GDI's heap, and these calls read and write fields of it (`GDI.EXE` seg1 `5130` to `521d` are the plain getters and setters):

| Offset | What                                                                             |
| ------ | -------------------------------------------------------------------------------- |
| `0Ah`  | Flags; bit 2 has GDI call the context's hook before using it                     |
| `0Eh`  | The context's own clip region ([[fn:GDI.GetClipRgn]])                            |
| `16h`  | The logical font selected ([[fn:GDI.GetCurLogFont]])                             |
| `1Ah`  | The palette selected ([[fn:GDI.IsDCCurrentPalette]])                             |
| `80h`  | The relative-or-absolute mode ([[fn:GDI.SetRelAbs]]), and at `82h` the fill mode |
| `C4h`  | The hook's procedure ([[fn:GDI.SetDCHook]]), and at `C8h` its data               |
| `CCh`  | The bounds' flags: 2 set as every context is made (seg1 `0136`)                  |

## The hook

[[read out]] Where bit 2 of a context's flags is set, the validation of the context in each call that uses it calls seg1 `4423`, which calls the procedure at `C4h` through seg1 `43f3` with the context, `DCHC_INVALIDVISRGN` (1), the data at `C8h` and nought. [[fn:GDI.SetHookFlags]] sets and clears the bit.

- [[measured]] With a hook of its own and the flag set, a program's procedure is called once from each of `GetClipBox`, `GetTextColor` and `Rectangle`, with the context, `DCHC_INVALIDVISRGN` (1), the data and nought ([[probe:dchook]]). The flag stays set until cleared.
- [[measured]] A window's context, as `GetDC` lends it, has USER's `DCHOOK` and data of USER's, and its flag clear.

GDI calls the hook so: a program's through the processor, USER's own `DCHOOK` run by WinBox itself, which works a lent context's visible region out again ([[fn:USER.DCHook]]). Which calls call it, and the visible region USER keeps through GDI, are in [[topic:visible-regions]].

## Not yet done

- **`ResetDC` on a Windows printer driver's context**, which makes a new context with the `DEVMODE` and exchanges the two; it answers nought.
- **`GetClipRgn`'s region** is the clip region as it is when asked: a program that changes the region it was given does not change the clip region, as it would in Windows.
- **`GetPhysicalFontHandle`** (seg1 `0a2e`, the word at 28h): a display's context answers a block WinBox keeps for its font, with no `FONTINFO` laid out in it ([[fn:GDI.GetPhysicalFontHandle]]).

## In winbox.js

`crates/winbox-win16/src/gdi/dc_internals.rs`; the palette calls are `crates/winbox-win16/src/gdi/palettes.rs` ([[topic:palettes]]).
